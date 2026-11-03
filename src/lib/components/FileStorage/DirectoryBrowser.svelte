<script lang="ts">
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Dialog from '#lib/components/ui/dialog/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { TID } from '#lib/constants.js';
  import {
    chooseDirectory,
    deleteFromDirectory,
    fileSession,
    forgetDirectory,
    openFromDirectory,
    reconnectDirectory,
    refreshDirectory,
    renameInDirectory,
    saveToDirectory
  } from '#lib/util/fileStorage/session.svelte.js';
  import dayjs from 'dayjs';
  import dayjsRelativeTime from 'dayjs/plugin/relativeTime';
  import CheckIcon from '~icons/material-symbols/check-rounded';
  import CloseIcon from '~icons/material-symbols/close-rounded';
  import DeleteIcon from '~icons/material-symbols/delete-outline-rounded';
  import EditIcon from '~icons/material-symbols/edit-outline-rounded';
  import FolderIcon from '~icons/material-symbols/folder-outline-rounded';
  import LinkOffIcon from '~icons/material-symbols/link-off-rounded';
  import UnlockIcon from '~icons/material-symbols/lock-open-outline-rounded';
  import RefreshIcon from '~icons/material-symbols/refresh-rounded';

  dayjs.extend(dayjsRelativeTime);

  let { open = $bindable(false) }: { open: boolean } = $props();

  let search = $state('');
  let newName = $state('');
  let renaming = $state<{ fileName: string; name: string } | undefined>();

  const granted = $derived(fileSession.directoryAccess === 'granted');
  const filtered = $derived.by(() => {
    const query = search.trim().toLowerCase();
    return query
      ? fileSession.entries.filter(
          ({ fileName, name }) =>
            name.toLowerCase().includes(query) || fileName.toLowerCase().includes(query)
        )
      : fileSession.entries;
  });

  const openEntry = async (fileName: string) => {
    if (await openFromDirectory(fileName)) {
      open = false;
    }
  };

  const saveNew = async () => {
    if (await saveToDirectory(newName)) {
      newName = '';
    }
  };

  const commitRename = async () => {
    if (renaming && (await renameInDirectory(renaming.fileName, renaming.name))) {
      renaming = undefined;
    }
  };
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="flex max-h-[85vh] flex-col sm:max-w-2xl"
    data-testid={TID.directoryBrowser}>
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2 text-xl">
        <FolderIcon class="size-5" />
        {fileSession.directory ? fileSession.directory.name : 'Diagram folder'}
      </Dialog.Title>
      <Dialog.Description>
        Diagrams are read from and saved to this folder on your computer.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={fileSession.busy} onclick={chooseDirectory}>
        <FolderIcon />
        {fileSession.directory ? 'Change folder' : 'Choose folder'}
      </Button>
      {#if fileSession.directory}
        {#if granted}
          <Button size="sm" variant="ghost" disabled={fileSession.busy} onclick={refreshDirectory}>
            <RefreshIcon />
            Refresh
          </Button>
        {/if}
        <Button size="sm" variant="ghost" disabled={fileSession.busy} onclick={forgetDirectory}>
          <LinkOffIcon />
          Forget folder
        </Button>
      {/if}
    </div>

    {#if fileSession.directory && !granted}
      <div class="flex flex-col items-start gap-2 rounded-md border p-4 text-sm">
        <p>The browser needs your permission again to access this folder.</p>
        <Button size="sm" disabled={fileSession.busy} onclick={reconnectDirectory}>
          <UnlockIcon />
          Allow access
        </Button>
      </div>
    {:else if granted}
      <Input placeholder="Search diagrams" bind:value={search} />
      <ul class="-mx-2 min-h-24 flex-1 overflow-y-auto">
        {#each filtered as entry (entry.fileName)}
          {@const isCurrent =
            fileSession.current?.inDirectory && fileSession.current.fileName === entry.fileName}
          <li
            class="group/entry flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted"
            data-testid={TID.directoryEntry}>
            {#if renaming?.fileName === entry.fileName}
              <form
                class="flex flex-1 items-center gap-1"
                onsubmit={(event) => {
                  event.preventDefault();
                  void commitRename();
                }}>
                <Input class="h-8" autofocus bind:value={renaming.name} />
                <Button size="icon" variant="ghost" type="submit" title="Rename">
                  <CheckIcon />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Cancel"
                  onclick={() => (renaming = undefined)}>
                  <CloseIcon />
                </Button>
              </form>
            {:else}
              <button
                class="flex min-w-0 flex-1 flex-col items-start text-left disabled:opacity-50"
                disabled={entry.invalid || fileSession.busy}
                title={entry.invalid ? 'Not a valid diagram file' : `Open ${entry.fileName}`}
                onclick={() => openEntry(entry.fileName)}>
                <span class={['truncate', isCurrent && 'font-semibold']}>
                  {entry.name}
                  {#if isCurrent}<span class="text-xs text-muted-foreground">(open)</span>{/if}
                </span>
                <span class="truncate text-xs text-muted-foreground">
                  {entry.fileName} · {dayjs(entry.lastModified).fromNow()}
                </span>
              </button>
              <div class="flex opacity-0 group-hover/entry:opacity-100 focus-within:opacity-100">
                <Button
                  size="icon"
                  variant="ghost"
                  title="Rename"
                  disabled={entry.invalid || fileSession.busy}
                  onclick={() => (renaming = { fileName: entry.fileName, name: entry.name })}>
                  <EditIcon />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Delete"
                  disabled={fileSession.busy}
                  onclick={() => deleteFromDirectory(entry.fileName)}>
                  <DeleteIcon />
                </Button>
              </div>
            {/if}
          </li>
        {:else}
          <li class="p-4 text-center text-sm text-muted-foreground">
            {search ? 'No matching diagrams.' : 'No diagrams in this folder yet.'}
          </li>
        {/each}
      </ul>
      <form
        class="flex items-center gap-2 border-t pt-4"
        onsubmit={(event) => {
          event.preventDefault();
          void saveNew();
        }}>
        <Input
          placeholder="Name for the current diagram"
          data-testid={TID.directorySaveName}
          bind:value={newName} />
        <Button
          type="submit"
          disabled={fileSession.busy || !newName.trim()}
          data-testid={TID.directorySaveButton}>
          Save here
        </Button>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
