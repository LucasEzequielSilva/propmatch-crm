/**
 * Archivos del Estudio de Instagram (fotos y videos propios) en IndexedDB.
 * localStorage no aguanta archivos (tope de ~5 MB), así que los blobs viven acá y los
 * metadatos de cada publicación en `postStore.ts`. Todo queda en ESTE navegador: no hay copia
 * en ningún servidor ni se sincroniza entre dispositivos.
 *
 * Migrar más adelante: reemplazar estas funciones por subidas a un bucket de Storage con la
 * misma firma (put/get/delete/list) y guardar la URL/clave en `PostMedia.id`. Las pantallas
 * solo conocen este módulo.
 *
 * Nada acá lanza: si IndexedDB no existe (modo privado de algunos navegadores, políticas)
 * las funciones devuelven `false`/`null`/`[]` y `mediaAvailable()` lo informa.
 */

const DB_NAME = "propmatch-instagram";
const STORE = "media";
const VERSION = 1;

export interface StoredMedia {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  createdAt: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, fallback: T): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve) => {
        if (!db) return resolve(fallback);
        try {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          let result: T = fallback;
          req.onsuccess = () => {
            result = req.result;
          };
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => resolve(fallback);
          tx.onabort = () => resolve(fallback);
        } catch {
          resolve(fallback);
        }
      }),
  );
}

/** `false` si no hay IndexedDB utilizable: la pantalla avisa que no se podrán guardar archivos. */
export const mediaAvailable = async (): Promise<boolean> => (await openDb()) !== null;

/** `false` si no se pudo guardar (cuota llena, sin IndexedDB). */
export async function putMedia(id: string, blob: Blob, name: string): Promise<boolean> {
  const rec: StoredMedia = { id, blob, name, type: blob.type, createdAt: new Date().toISOString() };
  const done = await run<IDBValidKey | null>("readwrite", (s) => s.put(rec) as IDBRequest<IDBValidKey | null>, null);
  return done !== null;
}

export const getMedia = (id: string): Promise<StoredMedia | null> => run<StoredMedia | null>("readonly", (s) => s.get(id) as IDBRequest<StoredMedia | null>, null).then((r) => r ?? null);

export async function deleteMedia(id: string): Promise<void> {
  await run<undefined>("readwrite", (s) => s.delete(id), undefined);
}

export async function deleteMedias(ids: string[]): Promise<void> {
  for (const id of ids) await deleteMedia(id);
}

/** Lista todo lo guardado (sin los blobs en memoria más de lo necesario: el navegador los referencia). */
export const listMedia = (): Promise<StoredMedia[]> => run<StoredMedia[]>("readonly", (s) => s.getAll() as IDBRequest<StoredMedia[]>, []).then((r) => r ?? []);

/** Estimación de cuota del navegador (a verificar por navegador; puede no existir). */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e?.usage != null && e.quota != null ? { usage: e.usage, quota: e.quota } : null;
  } catch {
    return null;
  }
}
