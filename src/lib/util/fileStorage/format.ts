import type { State } from '#lib/types.js';
import type { MermaidConfig } from 'mermaid';
import { isManagedTheme } from '../mermaid';

export const FILE_FORMAT = 'mermaid-live-editor';
export const FILE_VERSION = 1;
export const DIAGRAM_EXTENSION = '.mermaid.json';
export const MMD_EXTENSIONS = ['.mmd', '.mermaid'] as const;
export const MAX_FILE_SIZE = 5 * 1024 * 1024;
/** How much of a diagram file the folder listing reads to find its name. */
export const LISTING_PREFIX_LENGTH = 8 * 1024;

export type DiagramOptions = Partial<Pick<State, 'grid' | 'panZoom' | 'rough'>>;

export interface DiagramFile {
  format: typeof FILE_FORMAT;
  version: number;
  name: string;
  code: string;
  config: MermaidConfig;
  options: DiagramOptions;
  createdAt: string;
  updatedAt: string;
}

/** A diagram read from disk, ready to be applied to the editor state. */
export interface LoadedDiagram {
  kind: 'json' | 'mmd';
  name: string;
  code: string;
  /** JSON string, as stored in `State.mermaid`. Not yet sanitized. */
  mermaid: string;
  options: DiagramOptions;
  createdAt?: string;
}

export class DiagramFileError extends Error {
  override name = 'DiagramFileError';
}

const OPTION_KEYS = ['rough', 'panZoom', 'grid'] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isMmdFileName = (fileName: string): boolean => {
  const lower = fileName.toLowerCase();
  return MMD_EXTENSIONS.some((extension) => lower.endsWith(extension));
};

export const isDiagramFileName = (fileName: string): boolean =>
  fileName.toLowerCase().endsWith(DIAGRAM_EXTENSION) || isMmdFileName(fileName);

/** File name without any of the supported extensions. */
export const nameFromFileName = (fileName: string): string => {
  const lower = fileName.toLowerCase();
  for (const extension of [DIAGRAM_EXTENSION, '.json', ...MMD_EXTENSIONS]) {
    if (lower.endsWith(extension)) {
      return fileName.slice(0, -extension.length);
    }
  }
  return fileName;
};

/** Turns a display name into a safe file name stem, keeping non-ASCII letters. */
export const toFileStem = (name: string): string => {
  const stem = name
    // eslint-disable-next-line no-control-regex
    .replaceAll(/[\u0000-\u001F<>:"/\\|?*]+/g, '-')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replaceAll(/^[.\s-]+|[.\s-]+$/g, '');
  return stem.slice(0, 100) || 'diagram';
};

/**
 * The editor sets the theme on its own (see `syncManagedTheme`); such a theme
 * depends on the site's light/dark mode and must not be pinned in a file.
 */
export const stripManagedTheme = (config: MermaidConfig): MermaidConfig => {
  if (!isManagedTheme(config.theme)) {
    return config;
  }
  const rest = { ...config };
  delete rest.theme;
  return rest;
};

export const parseConfig = (mermaid: string): MermaidConfig => {
  try {
    const parsed: unknown = JSON.parse(mermaid);
    return isPlainObject(parsed) ? (parsed as MermaidConfig) : {};
  } catch {
    throw new DiagramFileError('The Mermaid config is not valid JSON. Fix it before saving.');
  }
};

const pickOptions = (source: Partial<State>): DiagramOptions => {
  const options: DiagramOptions = {};
  for (const key of OPTION_KEYS) {
    if (typeof source[key] === 'boolean') {
      options[key] = source[key];
    }
  }
  return options;
};

export const createDiagramFile = (
  state: Pick<State, 'code' | 'mermaid'> & DiagramOptions,
  { createdAt, name, now = new Date() }: { createdAt?: string; name: string; now?: Date }
): DiagramFile => {
  const timestamp = now.toISOString();
  // Kept separate so these fields come first in saved files.
  const header = { format: FILE_FORMAT, version: FILE_VERSION, name } as const;
  return {
    ...header,
    code: state.code,
    config: stripManagedTheme(parseConfig(state.mermaid)),
    createdAt: createdAt ?? timestamp,
    options: pickOptions(state),
    updatedAt: timestamp
  };
};

export const stringifyDiagramFile = (file: DiagramFile): string =>
  `${JSON.stringify(file, undefined, 2)}\n`;

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Plain mermaid code for a `.mmd` file. The config is merged into the
 * frontmatter (YAML accepts JSON flow syntax) unless the code already defines
 * its own `config`, in which case the editor config is dropped.
 */
export const toMmd = (
  code: string,
  mermaid: string
): { content: string; configDropped: boolean } => {
  const config = stripManagedTheme(parseConfig(mermaid));
  if (Object.keys(config).length === 0) {
    return { configDropped: false, content: code };
  }
  const configLine = `config: ${JSON.stringify(config)}`;
  const frontmatter = FRONTMATTER.exec(code);
  if (!frontmatter) {
    return { configDropped: false, content: `---\n${configLine}\n---\n${code}` };
  }
  if (/^config\s*:/m.test(frontmatter[1])) {
    return { configDropped: true, content: code };
  }
  const firstLineEnd = code.indexOf('\n') + 1;
  return {
    configDropped: false,
    content: `${code.slice(0, firstLineEnd)}${configLine}\n${code.slice(firstLineEnd)}`
  };
};

const parseJsonFile = (text: string, fileName: string): LoadedDiagram => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new DiagramFileError(`${fileName} is not valid JSON.`);
  }
  if (!isPlainObject(data) || data.format !== FILE_FORMAT) {
    throw new DiagramFileError(`${fileName} is not a Mermaid Live Editor diagram file.`);
  }
  if (typeof data.version !== 'number' || data.version < 1) {
    throw new DiagramFileError(`${fileName} has an invalid format version.`);
  }
  if (data.version > FILE_VERSION) {
    throw new DiagramFileError(
      `${fileName} was saved by a newer editor (format version ${data.version}).`
    );
  }
  if (typeof data.code !== 'string') {
    throw new DiagramFileError(`${fileName} has no diagram code.`);
  }
  if (data.config !== undefined && !isPlainObject(data.config)) {
    throw new DiagramFileError(`${fileName} has an invalid config.`);
  }
  return {
    code: data.code,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
    kind: 'json',
    mermaid: JSON.stringify(data.config ?? {}),
    name:
      typeof data.name === 'string' && data.name.trim()
        ? data.name.trim()
        : nameFromFileName(fileName),
    options: isPlainObject(data.options) ? pickOptions(data.options as Partial<State>) : {}
  };
};

const FORMAT_IN_PREFIX = /"format"\s*:\s*"mermaid-live-editor"/;
const NAME_IN_PREFIX = /"name"\s*:\s*"((?:\\.|[^"\\])*)"/;

export interface DiagramListingPeek {
  invalid: boolean;
  name: string;
  /** The prefix was cut off before a format field, so the whole file still has to be parsed. */
  uncertain: boolean;
}

/**
 * Reads a folder-listing decision out of the start of a `.mermaid.json` file.
 * A truncated prefix that does not contain `format` is `uncertain` rather than
 * invalid, so a file with an unusual key order is not hidden from the list.
 */
export const peekDiagramListing = (
  prefix: string,
  fileName: string,
  truncated: boolean
): DiagramListingPeek => {
  const fallback = nameFromFileName(fileName);
  if (!FORMAT_IN_PREFIX.test(prefix)) {
    return { invalid: !truncated, name: fallback, uncertain: truncated };
  }
  const nameMatch = NAME_IN_PREFIX.exec(prefix);
  if (!nameMatch) {
    return { invalid: false, name: fallback, uncertain: false };
  }
  try {
    const parsed: unknown = JSON.parse(`"${nameMatch[1]}"`);
    if (typeof parsed === 'string' && parsed.trim()) {
      return { invalid: false, name: parsed.trim(), uncertain: false };
    }
  } catch {
    // Keep the file name when the captured text is not a JSON string.
  }
  return { invalid: false, name: fallback, uncertain: false };
};

export const parseDiagramFile = (text: string, fileName: string): LoadedDiagram => {
  if (text.length > MAX_FILE_SIZE) {
    throw new DiagramFileError(`${fileName} is too large.`);
  }
  if (isMmdFileName(fileName)) {
    return {
      code: text,
      kind: 'mmd',
      mermaid: '{}',
      name: nameFromFileName(fileName),
      options: {}
    };
  }
  return parseJsonFile(text, fileName);
};

/** What a file stores for the given state, used to detect unsaved changes. */
export const contentFingerprint = (
  state: Pick<State, 'code' | 'mermaid'> & DiagramOptions,
  kind: LoadedDiagram['kind']
): string => {
  try {
    if (kind === 'mmd') {
      return toMmd(state.code, state.mermaid).content;
    }
    const config = stripManagedTheme(parseConfig(state.mermaid));
    return JSON.stringify([state.code, config, pickOptions(state)]);
  } catch {
    return JSON.stringify([state.code, state.mermaid]);
  }
};
