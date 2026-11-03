<script lang="ts">
  import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
  import * as Popover from '#lib/components/ui/popover/index.js';
  import { Separator } from '#lib/components/ui/separator/index.js';
  import { TID } from '#lib/constants.js';
  import {
    closeFile,
    exportMmd,
    fileSession,
    openFile,
    restoreDirectory,
    saveFile,
    saveFileAs
  } from '#lib/util/fileStorage/session.svelte.js';
  import { cn } from '#lib/utils.js';
  import { onMount, type Component } from 'svelte';
  import CloseIcon from '~icons/material-symbols/close-rounded';
  import FileIcon from '~icons/material-symbols/description-outline-rounded';
  import DownloadIcon from '~icons/material-symbols/download-rounded';
  import OpenFileIcon from '~icons/material-symbols/file-open-outline-rounded';
  import FolderIcon from '~icons/material-symbols/folder-open-outline-rounded';
  import SaveAsIcon from '~icons/material-symbols/save-as-outline-rounded';
  import SaveIcon from '~icons/material-symbols/save-outline-rounded';
  import DirectoryBrowser from './DirectoryBrowser.svelte';

  let menuOpen = $state(false);
  let browserOpen = $state(false);
  let modLabel = $state('Ctrl');

  const title = $derived(
    fileSession.current
      ? `${fileSession.current.fileName}${fileSession.dirty ? ' (unsaved changes)' : ''}`
      : 'Open or save the diagram as a file'
  );

  onMount(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) {
      modLabel = '⌘';
    }
    void restoreDirectory();
  });

  const runAndClose = (action: () => unknown) => () => {
    menuOpen = false;
    void action();
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (event.repeat || !(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest('[role="dialog"]')) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      void (event.shiftKey ? saveFileAs() : saveFile());
    } else if (key === 'o' && !event.shiftKey) {
      event.preventDefault();
      void openFile();
    }
  };

  interface MenuItem {
    action: () => unknown;
    icon: Component;
    label: string;
    shortcut?: string;
    testId: string;
  }

  const shortcutFor = (key: 'O' | 'S' | 'Shift+S') => {
    if (modLabel === '⌘') {
      return key === 'Shift+S' ? '⌘⇧S' : `⌘${key}`;
    }
    return key === 'Shift+S' ? 'Ctrl+Shift+S' : `Ctrl+${key}`;
  };

  const fileItems = $derived.by((): MenuItem[] => [
    {
      action: openFile,
      icon: OpenFileIcon,
      label: 'Open file…',
      shortcut: shortcutFor('O'),
      testId: TID.fileMenuOpen
    },
    {
      action: saveFile,
      icon: SaveIcon,
      label: 'Save',
      shortcut: shortcutFor('S'),
      testId: TID.fileMenuSave
    },
    {
      action: saveFileAs,
      icon: SaveAsIcon,
      label: 'Save as…',
      shortcut: shortcutFor('Shift+S'),
      testId: TID.fileMenuSaveAs
    },
    {
      action: exportMmd,
      icon: DownloadIcon,
      label: 'Export as .mmd…',
      testId: TID.fileMenuExportMmd
    }
  ]);
</script>

<svelte:window onkeydown={onKeydown} />

<Popover.Root bind:open={menuOpen}>
  <Popover.Trigger
    class={cn(buttonVariants({ variant: 'ghost' }), 'max-w-48 px-2')}
    {title}
    disabled={fileSession.busy}
    data-testid={TID.fileMenuButton}>
    <FileIcon />
    <span class="truncate">{fileSession.current?.name ?? 'File'}</span>
    {#if fileSession.dirty}
      <span class="size-2 shrink-0 rounded-full bg-accent" aria-label="Unsaved changes"></span>
    {/if}
  </Popover.Trigger>
  <Popover.Content class="flex w-64 flex-col p-1" align="end">
    {#each fileItems as item (item.testId)}
      <Button
        variant="ghost"
        class="justify-start"
        data-testid={item.testId}
        disabled={fileSession.busy}
        onclick={runAndClose(item.action)}>
        <item.icon />
        <span class="flex-1 text-left">{item.label}</span>
        {#if item.shortcut}
          <span class="text-xs text-muted-foreground">{item.shortcut}</span>
        {/if}
      </Button>
    {/each}
    {#if fileSession.supportsDirectories()}
      <Separator class="my-1" />
      <Button
        variant="ghost"
        class="justify-start"
        data-testid={TID.fileMenuOpenFolder}
        onclick={() => {
          menuOpen = false;
          browserOpen = true;
        }}>
        <FolderIcon />
        <span class="flex-1 truncate text-left">
          {fileSession.directory ? `Folder: ${fileSession.directory.name}` : 'Open folder…'}
        </span>
      </Button>
    {/if}
    {#if fileSession.current}
      <Separator class="my-1" />
      <Button
        variant="ghost"
        class="justify-start"
        data-testid={TID.fileMenuClose}
        onclick={runAndClose(closeFile)}>
        <CloseIcon />
        <span class="flex-1 truncate text-left">Detach from {fileSession.current.fileName}</span>
      </Button>
    {/if}
  </Popover.Content>
</Popover.Root>

{#if fileSession.supportsDirectories()}
  <DirectoryBrowser bind:open={browserOpen} />
{/if}
