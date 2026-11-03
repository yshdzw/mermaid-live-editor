// File system handles cannot be serialized to localStorage, but IndexedDB can
// store them (structured clone), so the chosen directory survives reloads.

const DB_NAME = 'mermaid-live-editor';
const STORE_NAME = 'fileHandles';
const DIRECTORY_KEY = 'directory';

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore(STORE_NAME);
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB error')));
  });

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest
): Promise<T> => {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      request.addEventListener('success', () => resolve(request.result as T));
      request.addEventListener('error', () =>
        reject(request.error ?? new Error('IndexedDB error'))
      );
    });
  } finally {
    database.close();
  }
};

export const loadDirectoryHandle = async (): Promise<FileSystemDirectoryHandle | undefined> => {
  if (typeof indexedDB === 'undefined') {
    return undefined;
  }
  try {
    return await withStore<FileSystemDirectoryHandle | undefined>('readonly', (store) =>
      store.get(DIRECTORY_KEY)
    );
  } catch (error) {
    console.error('Failed to restore the diagram folder', error);
    return undefined;
  }
};

export const saveDirectoryHandle = async (
  handle: FileSystemDirectoryHandle | undefined
): Promise<void> => {
  if (typeof indexedDB === 'undefined') {
    return;
  }
  await withStore<unknown>('readwrite', (store) =>
    handle ? store.put(handle, DIRECTORY_KEY) : store.delete(DIRECTORY_KEY)
  );
};
