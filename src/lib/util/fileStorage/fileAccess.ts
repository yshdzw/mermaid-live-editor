import { DIAGRAM_EXTENSION, MMD_EXTENSIONS } from './format';

export const supportsFileHandles = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.showOpenFilePicker === 'function' &&
  typeof window.showSaveFilePicker === 'function';

export const supportsDirectories = (): boolean =>
  typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

const PICKER_ID = 'mermaid-diagrams';

export const DIAGRAM_PICKER_TYPE: FilePickerAcceptType = {
  accept: { 'application/json': [DIAGRAM_EXTENSION] },
  description: 'Mermaid Live Editor diagram'
};

export const MMD_PICKER_TYPE: FilePickerAcceptType = {
  accept: { 'text/plain': [...MMD_EXTENSIONS] },
  description: 'Mermaid code'
};

export const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

/** Resolves to undefined when the user cancels the picker. */
export const pickFileHandle = async (): Promise<FileSystemFileHandle | undefined> => {
  try {
    const handles = await window.showOpenFilePicker?.({
      id: PICKER_ID,
      types: [
        {
          accept: { 'application/json': [DIAGRAM_EXTENSION], 'text/plain': [...MMD_EXTENSIONS] },
          description: 'Mermaid diagrams'
        }
      ]
    });
    return handles?.[0];
  } catch (error) {
    if (isAbortError(error)) {
      return undefined;
    }
    throw error;
  }
};

export const pickSaveHandle = async (
  suggestedName: string,
  types: FilePickerAcceptType[]
): Promise<FileSystemFileHandle | undefined> => {
  try {
    return await window.showSaveFilePicker?.({ id: PICKER_ID, suggestedName, types });
  } catch (error) {
    if (isAbortError(error)) {
      return undefined;
    }
    throw error;
  }
};

export const pickDirectoryHandle = async (): Promise<FileSystemDirectoryHandle | undefined> => {
  try {
    return await window.showDirectoryPicker?.({ id: PICKER_ID, mode: 'readwrite' });
  } catch (error) {
    if (isAbortError(error)) {
      return undefined;
    }
    throw error;
  }
};

/** Opens a file with a plain `<input type=file>`, for browsers without file handles. */
export const pickFileWithInput = (): Promise<File | undefined> =>
  new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = [DIAGRAM_EXTENSION, '.json', ...MMD_EXTENSIONS].join(',');
    let settled = false;
    const finish = (file: File | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0]));
    input.addEventListener('cancel', () => finish(undefined));
    // Registered after click() so the focus caused by opening the picker is ignored.
    // Browsers that never fire `cancel` still release `busy` once the window returns.
    input.click();
    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => finish(input.files?.[0]), 500);
      },
      { once: true }
    );
  });

export const downloadText = (fileName: string, content: string, type: string): void => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

export const writeText = async (handle: FileSystemFileHandle, content: string): Promise<void> => {
  const writable = await handle.createWritable();
  try {
    await writable.write(content);
    await writable.close();
  } catch (error) {
    // close() commits the temporary file over the original; abort() discards it.
    await writable.abort().catch(() => undefined);
    throw error;
  }
};

/** Asks for read/write access, prompting only when `prompt` is set (needs a user gesture). */
export const ensurePermission = async (
  handle: FileSystemHandle,
  prompt: boolean
): Promise<boolean> => {
  const descriptor: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };
  if (!handle.queryPermission || (await handle.queryPermission(descriptor)) === 'granted') {
    return true;
  }
  return prompt && (await handle.requestPermission?.(descriptor)) === 'granted';
};
