import { TID } from '#lib/constants.ts';
import type { Page } from '@playwright/test';
import { expect, test } from './test';
import { cmd } from './utils';

interface FakeFileSystem {
  /** Files reachable through the open/save pickers. */
  disk: Record<string, string>;
  /** Files inside the folder returned by the directory picker. */
  folder: Record<string, string>;
  /** File the next open picker returns. */
  nextOpen: string;
}

declare global {
  interface Window {
    fakeFs: FakeFileSystem;
  }
}

// In-memory stand-in for the File System Access API: native pickers cannot be
// driven by Playwright.
const installFakeFileSystem = () => {
  const fs: FakeFileSystem = { disk: {}, folder: {}, nextOpen: '' };
  window.fakeFs = fs;
  const permission = {
    queryPermission: () => Promise.resolve('granted'),
    requestPermission: () => Promise.resolve('granted')
  };
  const fileHandle = (files: Record<string, string>, name: string) => ({
    ...permission,
    createWritable: () => {
      let content = '';
      return Promise.resolve({
        close: () => {
          files[name] = content;
          return Promise.resolve();
        },
        write: (data: string) => {
          content = data;
          return Promise.resolve();
        }
      });
    },
    getFile: () => Promise.resolve(new File([files[name] ?? ''], name)),
    kind: 'file',
    name
  });
  const folder = {
    ...permission,
    getFileHandle: (name: string, options?: { create?: boolean }) => {
      if (!(name in fs.folder)) {
        if (!options?.create) {
          return Promise.reject(new DOMException('missing', 'NotFoundError'));
        }
        fs.folder[name] = '';
      }
      return Promise.resolve(fileHandle(fs.folder, name));
    },
    kind: 'directory',
    name: 'diagrams',
    removeEntry: (name: string) => {
      fs.folder = Object.fromEntries(Object.entries(fs.folder).filter(([key]) => key !== name));
      return Promise.resolve();
    },
    async *values() {
      for (const name of Object.keys(fs.folder)) {
        yield await Promise.resolve(fileHandle(fs.folder, name));
      }
    }
  };
  Object.assign(window, {
    showDirectoryPicker: () => Promise.resolve(folder),
    showOpenFilePicker: () => Promise.resolve([fileHandle(fs.disk, fs.nextOpen)]),
    showSaveFilePicker: ({ suggestedName }: { suggestedName: string }) =>
      Promise.resolve(fileHandle(fs.disk, suggestedName))
  });
};

const diagramFile = (name: string, code: string, config: object = {}) =>
  JSON.stringify({ code, config, format: 'mermaid-live-editor', name, options: {}, version: 1 });

const readFake = (page: Page) => page.evaluate(() => window.fakeFs);

const clickMenuItem = async (page: Page, testId: string) => {
  await page.getByTestId(TID.fileMenuButton).click();
  await page.getByTestId(testId).click();
};

test.describe('File storage', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(installFakeFileSystem);
    await page.reload();
  });

  test('opens a diagram file with its config', async ({ editPage, page }) => {
    await page.evaluate(
      ([file]) => {
        window.fakeFs.disk['orders.mermaid.json'] = file;
        window.fakeFs.nextOpen = 'orders.mermaid.json';
      },
      [diagramFile('Orders', 'flowchart TD\n  A[Order placed] --> B[Shipped]', { fontSize: 20 })]
    );
    await clickMenuItem(page, TID.fileMenuOpen);

    await editPage.checkTextInView('Order placed');
    await expect(page.getByTestId(TID.fileMenuButton)).toContainText('Orders');
    await editPage.setEditorMode('Config');
    await editPage.checkInEditor('"fontSize": 20');
  });

  test('saves as a new file and overwrites it on Ctrl+S', async ({ editPage, page }) => {
    await clickMenuItem(page, TID.fileMenuSaveAs);
    await expect
      .poll(async () => Object.keys((await readFake(page)).disk))
      .toEqual(['diagram.mermaid.json']);
    const saved = JSON.parse((await readFake(page)).disk['diagram.mermaid.json']) as {
      code: string;
      config: Record<string, unknown>;
      format: string;
    };
    expect(saved.format).toBe('mermaid-live-editor');
    expect(saved.code).toContain('Christmas');
    expect(saved.config).not.toHaveProperty('theme');

    await editPage.typeInEditor('Z[Saved again]', { newline: true });
    await expect(page.getByLabel('Unsaved changes')).toBeVisible();
    await page.keyboard.press(`${cmd}+KeyS`);
    await expect(page.getByLabel('Unsaved changes')).toBeHidden();
    expect((await readFake(page)).disk['diagram.mermaid.json']).toContain('Saved again');
  });

  test('saves to and opens from a folder', async ({ editPage, page }) => {
    await page.evaluate(
      ([file]) => {
        window.fakeFs.folder['flow.mermaid.json'] = file;
        window.fakeFs.folder['notes.txt'] = 'ignored';
      },
      [diagramFile('Existing flow', 'flowchart LR\n  X[From folder] --> Y')]
    );
    await clickMenuItem(page, TID.fileMenuOpenFolder);
    const browser = page.getByTestId(TID.directoryBrowser);
    await browser.getByRole('button', { name: 'Choose folder' }).click();

    const entries = browser.getByTestId(TID.directoryEntry);
    await expect(entries).toHaveCount(1);
    await expect(entries).toContainText('Existing flow');

    await browser.getByTestId(TID.directorySaveName).fill('我的图');
    await browser.getByTestId(TID.directorySaveButton).click();
    await expect(entries).toHaveCount(2);
    expect((await readFake(page)).folder['我的图.mermaid.json']).toContain('Christmas');

    await entries.filter({ hasText: 'Existing flow' }).getByRole('button').first().click();
    await expect(browser).toBeHidden();
    await editPage.checkTextInView('From folder');
    await expect(page.getByTestId(TID.fileMenuButton)).toContainText('Existing flow');
  });
});
