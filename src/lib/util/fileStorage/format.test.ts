import { describe, expect, it } from 'vitest';
import {
  contentFingerprint,
  createDiagramFile,
  DiagramFileError,
  FILE_FORMAT,
  FILE_VERSION,
  isDiagramFileName,
  nameFromFileName,
  parseDiagramFile,
  peekDiagramListing,
  stringifyDiagramFile,
  stripManagedTheme,
  toFileStem,
  toMmd
} from './format';

const now = new Date('2026-11-02T10:00:00.000Z');

describe('createDiagramFile', () => {
  it('stores code, config as an object and render options', () => {
    const file = createDiagramFile(
      {
        code: 'flowchart TD\n  A --> B',
        grid: false,
        mermaid: '{"flowchart":{"curve":"basis"}}',
        panZoom: true,
        rough: true
      },
      { name: 'Orders', now }
    );
    expect(file).toEqual({
      code: 'flowchart TD\n  A --> B',
      config: { flowchart: { curve: 'basis' } },
      createdAt: '2026-11-02T10:00:00.000Z',
      format: FILE_FORMAT,
      name: 'Orders',
      options: { grid: false, panZoom: true, rough: true },
      updatedAt: '2026-11-02T10:00:00.000Z',
      version: FILE_VERSION
    });
  });

  it('keeps the original creation time', () => {
    const file = createDiagramFile(
      { code: 'graph TD', mermaid: '{}' },
      { createdAt: '2020-01-01T00:00:00.000Z', name: 'x', now }
    );
    expect(file.createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(file.updatedAt).toBe(now.toISOString());
  });

  it('rejects an invalid config', () => {
    expect(() => createDiagramFile({ code: '', mermaid: '{' }, { name: 'x' })).toThrow(
      DiagramFileError
    );
  });
});

describe('stripManagedTheme', () => {
  it('drops themes the editor manages', () => {
    expect(stripManagedTheme({ fontSize: 12, theme: 'dark' })).toEqual({ fontSize: 12 });
    expect(stripManagedTheme({ theme: 'redux-color' })).toEqual({});
  });

  it('keeps a theme the user chose', () => {
    expect(stripManagedTheme({ theme: 'forest' })).toEqual({ theme: 'forest' });
  });
});

describe('parseDiagramFile', () => {
  it('round-trips a saved diagram', () => {
    const text = stringifyDiagramFile(
      createDiagramFile(
        { code: 'sequenceDiagram\n  A->>B: hi', mermaid: '{"theme":"forest"}', rough: true },
        { name: '时序图', now }
      )
    );
    expect(parseDiagramFile(text, 'seq.mermaid.json')).toEqual({
      code: 'sequenceDiagram\n  A->>B: hi',
      createdAt: now.toISOString(),
      kind: 'json',
      mermaid: '{"theme":"forest"}',
      name: '时序图',
      options: { rough: true }
    });
  });

  it('reads .mmd files as plain code', () => {
    expect(parseDiagramFile('graph LR\n  A --> B', 'flow.mmd')).toEqual({
      code: 'graph LR\n  A --> B',
      kind: 'mmd',
      mermaid: '{}',
      name: 'flow',
      options: {}
    });
  });

  it('falls back to the file name when the name is missing', () => {
    const text = JSON.stringify({ code: 'graph TD', format: FILE_FORMAT, version: 1 });
    expect(parseDiagramFile(text, 'plan.mermaid.json').name).toBe('plan');
  });

  it.each([
    ['not json', '{'],
    ['another format', JSON.stringify({ code: '', format: 'other', version: 1 })],
    ['a newer version', JSON.stringify({ code: '', format: FILE_FORMAT, version: 99 })],
    ['missing code', JSON.stringify({ format: FILE_FORMAT, version: 1 })],
    [
      'a non-object config',
      JSON.stringify({ code: '', config: [], format: FILE_FORMAT, version: 1 })
    ]
  ])('rejects %s', (_, text) => {
    expect(() => parseDiagramFile(text, 'a.mermaid.json')).toThrow(DiagramFileError);
  });

  it('ignores unknown option values', () => {
    const text = JSON.stringify({
      code: '',
      format: FILE_FORMAT,
      options: { grid: 'yes', rough: false, zoom: 3 },
      version: 1
    });
    expect(parseDiagramFile(text, 'a.mermaid.json').options).toEqual({ rough: false });
  });
});

describe('toMmd', () => {
  it('returns the code unchanged without a config', () => {
    expect(toMmd('graph TD', '{"theme":"dark"}')).toEqual({
      configDropped: false,
      content: 'graph TD'
    });
  });

  it('adds a frontmatter with the config', () => {
    expect(toMmd('graph TD', '{"theme":"forest"}').content).toBe(
      '---\nconfig: {"theme":"forest"}\n---\ngraph TD'
    );
  });

  it('merges the config into an existing frontmatter', () => {
    expect(toMmd('---\ntitle: T\n---\ngraph TD', '{"theme":"forest"}').content).toBe(
      '---\nconfig: {"theme":"forest"}\ntitle: T\n---\ngraph TD'
    );
  });

  it('does not override a config already in the frontmatter', () => {
    const code = '---\nconfig:\n  theme: neutral\n---\ngraph TD';
    expect(toMmd(code, '{"theme":"forest"}')).toEqual({ configDropped: true, content: code });
  });
});

describe('peekDiagramListing', () => {
  const file = (name: string) =>
    JSON.stringify({ code: 'graph TD', format: 'mermaid-live-editor', name, version: 1 });

  it('reads the name from the prefix', () => {
    expect(peekDiagramListing(file('订单'), 'a.mermaid.json', false)).toEqual({
      invalid: false,
      name: '订单',
      uncertain: false
    });
  });

  it('unescapes a name', () => {
    expect(peekDiagramListing(file('say "hi"'), 'a.mermaid.json', false).name).toBe('say "hi"');
  });

  it('keeps the file name when the format is present but the name is not', () => {
    const prefix = '{"format":"mermaid-live-editor","version":1}';
    expect(peekDiagramListing(prefix, 'plan.mermaid.json', true)).toEqual({
      invalid: false,
      name: 'plan',
      uncertain: false
    });
  });

  it('marks a complete file without the format as invalid', () => {
    expect(peekDiagramListing('{"code":""}', 'a.mermaid.json', false)).toEqual({
      invalid: true,
      name: 'a',
      uncertain: false
    });
  });

  it('defers to a full parse when a truncated prefix has no format yet', () => {
    expect(peekDiagramListing('{"code":"graph', 'a.mermaid.json', true)).toEqual({
      invalid: false,
      name: 'a',
      uncertain: true
    });
  });
});

describe('file names', () => {
  it('recognises supported extensions', () => {
    expect(isDiagramFileName('a.mermaid.json')).toBe(true);
    expect(isDiagramFileName('a.MMD')).toBe(true);
    expect(isDiagramFileName('a.json')).toBe(false);
    expect(nameFromFileName('a.b.mermaid.json')).toBe('a.b');
  });

  it('builds safe file stems', () => {
    expect(toFileStem('  订单/流程: v2?  ')).toBe('订单-流程- v2');
    expect(toFileStem('...')).toBe('diagram');
  });
});

describe('contentFingerprint', () => {
  it('ignores managed theme changes', () => {
    const light = contentFingerprint({ code: 'graph TD', mermaid: '{"theme":"default"}' }, 'json');
    const dark = contentFingerprint({ code: 'graph TD', mermaid: '{"theme":"dark"}' }, 'json');
    expect(light).toBe(dark);
  });

  it('changes when the code changes', () => {
    expect(contentFingerprint({ code: 'a', mermaid: '{}' }, 'json')).not.toBe(
      contentFingerprint({ code: 'b', mermaid: '{}' }, 'json')
    );
  });
});
