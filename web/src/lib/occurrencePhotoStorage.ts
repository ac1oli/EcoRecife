export type StoredOccurrencePhoto = {
  id: string;
  occurrenceId: number;
  blob: Blob;
  name: string;
  type: string;
  createdAt: number;
};

const DATABASE_NAME = 'ecorecife';
const DATABASE_VERSION = 1;
const STORE_NAME = 'occurrencePhotos';

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('occurrenceId', 'occurrenceId');
    }
  };

  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Não foi possível acessar o armazenamento de imagens.'));
});

export async function saveOccurrencePhotos(occurrenceId: number, files: File[]): Promise<void> {
  if (files.length === 0) return;

  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const createdAt = Date.now();

      files.forEach((file, index) => {
        const photo: StoredOccurrencePhoto = {
          id: `${occurrenceId}:${createdAt}:${index}`,
          occurrenceId,
          blob: file,
          name: file.name,
          type: file.type,
          createdAt: createdAt + index
        };
        store.add(photo);
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível salvar as imagens.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('O salvamento das imagens foi cancelado.'));
    });
  } finally {
    database.close();
  }
}

export async function getOccurrencePhotos(occurrenceId: number): Promise<StoredOccurrencePhoto[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const index = transaction.objectStore(STORE_NAME).index('occurrenceId');
      const request = index.getAll(IDBKeyRange.only(occurrenceId));

      request.onsuccess = () => resolve(
        (request.result as StoredOccurrencePhoto[]).sort((a, b) => a.createdAt - b.createdAt)
      );
      request.onerror = () => reject(request.error ?? new Error('Não foi possível carregar as imagens.'));
    });
  } finally {
    database.close();
  }
}
