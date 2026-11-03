import type { State } from '#lib/types.js';
import { notify } from '../notify';
import { sanitizeConfig } from '../sanitize';
import { defaultState, inputState, updateCodeStore } from '../state.svelte';
import {
  DIAGRAM_PICKER_TYPE,
  downloadText,
  ensurePermission,
  MMD_PICKER_TYPE,
  pickDirectoryHandle,
  pickFileHandle,
  pickFileWithInput,
  pickSaveHandle,
  supportsDirectories,
  supportsFileHandles,
  writeText
} from './fileAccess';
import {
  contentFingerprint,
  createDiagramFile,
  DIAGRAM_EXTENSION,
  DiagramFileError,
  isDiagramFileName,
  isMmdFileName,
  LISTING_PREFIX_LENGTH,
  MAX_FILE_SIZE,
  nameFromFileName,
  parseDiagramFile,
  peekDiagramListing,
  stringifyDiagramFile,
  toFileStem,
  toMmd,
  type LoadedDiagram
} from './format';
import { loadDirectoryHandle, saveDirectoryHandle } from './handleStore';

type FileKind = LoadedDiagram['kind'];

export interface CurrentFile {
  createdAt?: string;
  fileName: string;
  /** Missing when the browser cannot write files back (download fallback). */
  handle?: FileSystemFileHandle;
  inDirectory: boolean;
  kind: FileKind;
  name: string;
  savedFingerprint: string;
}

export interface DirectoryEntry {
  fileName: string;
  invalid: boolean;
  kind: FileKind;
  lastModified: number;
  name: string;
}

export type DirectoryAccess = 'none' | 'granted' | 'prompt';

let current = $state.raw<CurrentFile | undefined>();
let directory = $state.raw<FileSystemDirectoryHandle | undefined>();
let directoryAccess = $state<DirectoryAccess>('none');
let entries = $state.raw<DirectoryEntry[]>([]);
let busy = $state(false);

const fingerprintOf = (kind: FileKind): string =>
  contentFingerprint(
    {
      code: inputState.code,
      grid: inputState.grid,
      mermaid: inputState.mermaid,
      panZoom: inputState.panZoom,
      rough: inputState.rough
    },
    kind
  );

const dirty = $derived(current ? fingerprintOf(current.kind) !== current.savedFingerprint : false);

export const fileSession = {
  get busy() {
    return busy;
  },
  get current() {
    return current;
  },
  get directory() {
    return directory;
  },
  get directoryAccess() {
    return directoryAccess;
  },
  get dirty() {
    return dirty;
  },
  get entries() {
    return entries;
  },
  supportsDirectories,
  supportsFileHandles
};

const kindOf = (fileName: string): FileKind => (isMmdFileName(fileName) ? 'mmd' : 'json');

const extensionOf = (kind: FileKind): string => (kind === 'mmd' ? '.mmd' : DIAGRAM_EXTENSION);

const describeError = (error: unknown): string => {
  if (error instanceof DiagramFileError) {
    return error.message;
  }
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Permission to access the file was denied.';
  }
  return error instanceof Error ? error.message : String(error);
};

/** Runs a file operation, reporting failures as a toast instead of throwing. */
const run = async <T>(action: () => Promise<T>): Promise<T | undefined> => {
  if (busy) {
    return undefined;
  }
  busy = true;
  try {
    return await action();
  } catch (error) {
    console.error(error);
    notify(describeError(error));
    return undefined;
  } finally {
    busy = false;
  }
};

const confirmDiscard = (): boolean =>
  !current ||
  !dirty ||
  confirm(`"${current.name}" has unsaved changes. Discard them and open another diagram?`);

const readFile = async (file: File): Promise<LoadedDiagram> => {
  if (file.size > MAX_FILE_SIZE) {
    throw new DiagramFileError(`${file.name} is too large.`);
  }
  return parseDiagramFile(await file.text(), file.name);
};

const applyDiagram = (
  loaded: LoadedDiagram,
  source: Pick<CurrentFile, 'fileName' | 'handle' | 'inDirectory'>
): void => {
  const next: Partial<State> = {
    code: loaded.code,
    grid: loaded.options.grid ?? defaultState.grid,
    mermaid: sanitizeConfig(loaded.mermaid, confirm),
    pan: undefined,
    panZoom: loaded.options.panZoom ?? defaultState.panZoom,
    rough: loaded.options.rough ?? defaultState.rough,
    updateDiagram: true,
    zoom: undefined
  };
  updateCodeStore(next);
  current = {
    ...source,
    createdAt: loaded.createdAt,
    kind: loaded.kind,
    name: loaded.name,
    savedFingerprint: fingerprintOf(loaded.kind)
  };
};

const buildContent = (kind: FileKind, name: string, createdAt?: string): string => {
  if (kind === 'mmd') {
    const { configDropped, content } = toMmd(inputState.code, inputState.mermaid);
    if (configDropped) {
      notify('The code already has a frontmatter config, so the editor config was not saved.');
    }
    return content;
  }
  return stringifyDiagramFile(
    createDiagramFile(
      {
        code: inputState.code,
        grid: inputState.grid,
        mermaid: inputState.mermaid,
        panZoom: inputState.panZoom,
        rough: inputState.rough
      },
      { createdAt, name }
    )
  );
};

const mimeOf = (kind: FileKind): string => (kind === 'mmd' ? 'text/plain' : 'application/json');

const markSaved = (file: Omit<CurrentFile, 'savedFingerprint'>): void => {
  current = { ...file, savedFingerprint: fingerprintOf(file.kind) };
};

export const openFile = (): Promise<void> =>
  run(async () => {
    if (!confirmDiscard()) {
      return;
    }
    if (!supportsFileHandles()) {
      const file = await pickFileWithInput();
      if (file) {
        applyDiagram(await readFile(file), { fileName: file.name, inDirectory: false });
      }
      return;
    }
    const handle = await pickFileHandle();
    if (handle) {
      applyDiagram(await readFile(await handle.getFile()), {
        fileName: handle.name,
        handle,
        inDirectory: false
      });
    }
  }).then(() => undefined);

/**
 * Saves through a file picker (or a download when file handles are not
 * supported). With `associate`, the new file becomes the current file.
 */
const saveWithPicker = async (kind: FileKind, associate: boolean): Promise<void> => {
  const createdAt = current?.createdAt;
  const suggestedName = `${toFileStem(current?.name ?? 'diagram')}${extensionOf(kind)}`;
  if (!supportsFileHandles()) {
    const name = nameFromFileName(suggestedName);
    downloadText(suggestedName, buildContent(kind, name, createdAt), mimeOf(kind));
    if (associate) {
      markSaved({ createdAt, fileName: suggestedName, inDirectory: false, kind, name });
    }
    return;
  }
  const types = kind === 'mmd' ? [MMD_PICKER_TYPE] : [DIAGRAM_PICKER_TYPE, MMD_PICKER_TYPE];
  const handle = await pickSaveHandle(suggestedName, types);
  if (!handle) {
    return;
  }
  const savedKind = kindOf(handle.name);
  const name = nameFromFileName(handle.name);
  await writeText(handle, buildContent(savedKind, name, createdAt));
  if (associate) {
    markSaved({
      createdAt,
      fileName: handle.name,
      handle,
      inDirectory: false,
      kind: savedKind,
      name
    });
  }
  notify(`Saved ${handle.name}`);
};

export const saveFileAs = (): Promise<void> =>
  run(() => saveWithPicker(current?.kind ?? 'json', true)).then(() => undefined);

export const exportMmd = (): Promise<void> =>
  run(() => saveWithPicker('mmd', false)).then(() => undefined);

export const saveFile = (): Promise<void> =>
  run(async () => {
    const target = current;
    if (!target?.handle) {
      await saveWithPicker(target?.kind ?? 'json', true);
      return;
    }
    if (!(await ensurePermission(target.handle, true))) {
      throw new DiagramFileError(`Permission to write ${target.fileName} was denied.`);
    }
    await writeText(target.handle, buildContent(target.kind, target.name, target.createdAt));
    markSaved({ ...target });
    notify(`Saved ${target.fileName}`);
    if (target.inDirectory && directoryAccess === 'granted') {
      await refreshEntries();
    }
  }).then(() => undefined);

/** Forgets the associated file; the diagram itself stays in the editor. */
export const closeFile = (): void => {
  current = undefined;
};

// --- Directory mode ---------------------------------------------------------

const requireDirectory = (): FileSystemDirectoryHandle => {
  if (!directory || directoryAccess !== 'granted') {
    throw new DiagramFileError('Choose a folder first.');
  }
  return directory;
};

const fileExists = async (folder: FileSystemDirectoryHandle, fileName: string) => {
  try {
    await folder.getFileHandle(fileName);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      return false;
    }
    throw error;
  }
};

const MAX_NAME_ATTEMPTS = 1000;

const uniqueFileName = async (
  folder: FileSystemDirectoryHandle,
  stem: string,
  extension: string
): Promise<string> => {
  for (let index = 0; index < MAX_NAME_ATTEMPTS; index++) {
    const fileName = `${stem}${index === 0 ? '' : `-${index}`}${extension}`;
    if (!(await fileExists(folder, fileName))) {
      return fileName;
    }
  }
  throw new DiagramFileError(`Too many files named ${stem}${extension}.`);
};

const unavailableEntry = (fileName: string): DirectoryEntry => ({
  fileName,
  invalid: true,
  kind: kindOf(fileName),
  lastModified: 0,
  name: nameFromFileName(fileName)
});

const readEntry = async (handle: FileSystemFileHandle): Promise<DirectoryEntry> => {
  const file = await handle.getFile();
  const kind = kindOf(handle.name);
  const entry: DirectoryEntry = {
    fileName: handle.name,
    invalid: false,
    kind,
    lastModified: file.lastModified,
    name: nameFromFileName(handle.name)
  };
  if (file.size > MAX_FILE_SIZE) {
    entry.invalid = true;
    return entry;
  }
  if (kind === 'mmd') {
    return entry;
  }
  const prefix = await file.slice(0, LISTING_PREFIX_LENGTH).text();
  const peeked = peekDiagramListing(prefix, handle.name, file.size > LISTING_PREFIX_LENGTH);
  if (peeked.uncertain) {
    try {
      entry.name = (await readFile(file)).name;
    } catch {
      entry.invalid = true;
    }
    return entry;
  }
  entry.invalid = peeked.invalid;
  entry.name = peeked.name;
  return entry;
};

const refreshEntries = async (): Promise<void> => {
  const folder = requireDirectory();
  const listed: DirectoryEntry[] = [];
  for await (const handle of folder.values()) {
    if (handle.kind !== 'file' || !isDiagramFileName(handle.name)) {
      continue;
    }
    try {
      listed.push(await readEntry(handle));
    } catch {
      listed.push(unavailableEntry(handle.name));
    }
  }
  entries = listed.toSorted((a, b) => b.lastModified - a.lastModified);
};

/** Asks before a folder change drops the link to a file that still has unsaved edits. */
const confirmDropFileLink = (): boolean => {
  if (!current?.inDirectory || !dirty) {
    return true;
  }
  return confirm(
    `"${current.name}" has unsaved changes. They stay in the editor, but the link to ${current.fileName} will be dropped. Continue?`
  );
};

const useDirectory = async (folder: FileSystemDirectoryHandle, prompt: boolean) => {
  const switching = Boolean(directory && directory !== folder);
  if (switching && !confirmDropFileLink()) {
    return;
  }
  if (switching && current?.inDirectory) {
    current = undefined;
  }
  directory = folder;
  entries = [];
  directoryAccess = (await ensurePermission(folder, prompt)) ? 'granted' : 'prompt';
  if (directoryAccess === 'granted') {
    await refreshEntries();
  }
};

/** Restores the folder chosen in a previous session, without prompting. */
export const restoreDirectory = async (): Promise<void> => {
  if (!supportsDirectories() || directory) {
    return;
  }
  const folder = await loadDirectoryHandle();
  if (folder) {
    await run(() => useDirectory(folder, false));
  }
};

export const chooseDirectory = (): Promise<void> =>
  run(async () => {
    const folder = await pickDirectoryHandle();
    if (folder) {
      await useDirectory(folder, true);
      // Only the reload restore depends on this; the folder is usable either way.
      await saveDirectoryHandle(folder).catch((error: unknown) => {
        console.error('Failed to remember the diagram folder', error);
      });
    }
  }).then(() => undefined);

export const reconnectDirectory = (): Promise<void> =>
  run(async () => {
    if (directory) {
      await useDirectory(directory, true);
    }
  }).then(() => undefined);

export const forgetDirectory = (): Promise<void> =>
  run(async () => {
    if (!confirmDropFileLink()) {
      return;
    }
    if (current?.inDirectory) {
      current = undefined;
    }
    directory = undefined;
    directoryAccess = 'none';
    entries = [];
    await saveDirectoryHandle(undefined);
  }).then(() => undefined);

export const refreshDirectory = (): Promise<void> => run(refreshEntries).then(() => undefined);

export const openFromDirectory = (fileName: string): Promise<boolean> =>
  run(async () => {
    if (!confirmDiscard()) {
      return false;
    }
    const handle = await requireDirectory().getFileHandle(fileName);
    applyDiagram(await readFile(await handle.getFile()), {
      fileName,
      handle,
      inDirectory: true
    });
    return true;
  }).then(Boolean);

/** Saves the current diagram as a new file in the folder. */
export const saveToDirectory = (name: string): Promise<boolean> =>
  run(async () => {
    const folder = requireDirectory();
    const trimmed = name.trim() || 'diagram';
    const fileName = await uniqueFileName(folder, toFileStem(trimmed), DIAGRAM_EXTENSION);
    const handle = await folder.getFileHandle(fileName, { create: true });
    await writeText(handle, buildContent('json', trimmed));
    markSaved({ fileName, handle, inDirectory: true, kind: 'json', name: trimmed });
    await refreshEntries();
    notify(`Saved ${fileName}`);
    return true;
  }).then(Boolean);

const renamedContent = (text: string, kind: FileKind, name: string): string => {
  if (kind === 'mmd') {
    return text;
  }
  const data = JSON.parse(text) as Record<string, unknown>;
  data.name = name;
  return `${JSON.stringify(data, undefined, 2)}\n`;
};

export const renameInDirectory = (fileName: string, newName: string): Promise<boolean> =>
  run(async () => {
    const folder = requireDirectory();
    const name = newName.trim();
    if (!name) {
      return false;
    }
    const kind = kindOf(fileName);
    const oldHandle = await folder.getFileHandle(fileName);
    const content = renamedContent(await (await oldHandle.getFile()).text(), kind, name);
    const stem = toFileStem(name);
    const extension = extensionOf(kind);
    const sameFile = nameFromFileName(fileName) === stem;
    const newFileName = sameFile ? fileName : await uniqueFileName(folder, stem, extension);
    const newHandle = sameFile
      ? oldHandle
      : await folder.getFileHandle(newFileName, { create: true });
    await writeText(newHandle, content);
    if (!sameFile) {
      try {
        await folder.removeEntry(fileName);
      } catch {
        await refreshEntries().catch(() => undefined);
        throw new DiagramFileError(
          `Saved the renamed copy as ${newFileName}, but ${fileName} could not be deleted.`
        );
      }
    }
    if (current?.inDirectory && current.fileName === fileName) {
      current = { ...current, fileName: newFileName, handle: newHandle, name };
    }
    await refreshEntries();
    return true;
  }).then(Boolean);

export const deleteFromDirectory = (fileName: string): Promise<boolean> =>
  run(async () => {
    if (!confirm(`Delete ${fileName}? This cannot be undone.`)) {
      return false;
    }
    await requireDirectory().removeEntry(fileName);
    if (current?.inDirectory && current.fileName === fileName) {
      current = undefined;
    }
    await refreshEntries();
    return true;
  }).then(Boolean);
