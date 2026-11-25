const DB_NAME = 'rescue-crane-sim';
const DB_VERSION = 2; // 种子结构调整时升版本，onupgradeneeded 清库重种

export type StoreName = 'carModels' | 'cranes' | 'scenes' | 'plans';

const STORES: StoreName[] = ['carModels', 'cranes', 'scenes', 'plans'];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // 版本升级：清掉旧结构后重建，保证种子数据与最新模型一致
      for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function idbPut<T extends { id: string }>(store: StoreName, value: T): Promise<void> {
  await tx(store, 'readwrite', (s) => s.put(structuredClone(value)) as IDBRequest<IDBValidKey>);
}

export async function idbPutAll<T extends { id: string }>(store: StoreName, values: T[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const v of values) s.put(structuredClone(v));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function idbGet<T>(store: StoreName, id: string): Promise<T | undefined> {
  return tx<T | undefined>(store, 'readonly', (s) => s.get(id) as IDBRequest<T | undefined>);
}

export async function idbGetAll<T>(store: StoreName): Promise<T[]> {
  return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}

export async function idbDelete(store: StoreName, id: string): Promise<void> {
  await tx(store, 'readwrite', (s) => s.delete(id) as IDBRequest<undefined>);
}

export async function idbClear(store: StoreName): Promise<void> {
  await tx(store, 'readwrite', (s) => s.clear() as IDBRequest<undefined>);
}

/** 首次启动时写入种子数据（已存在则跳过） */
export async function ensureSeeded(seed: Record<StoreName, { id: string }[]>): Promise<void> {
  for (const store of STORES) {
    const existing = await idbGetAll(store);
    if (existing.length === 0) {
      await idbPutAll(store, seed[store]);
    }
  }
}
