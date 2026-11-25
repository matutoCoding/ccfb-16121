// IndexedDB 持久化。车型、起重机、现场、方案分四个 store, 内置数据带 builtIn 标记只读复制。
import type { AccidentScene, CarType, CraneModel, RescuePlan, SiteParams } from '../core/types';

const DB_NAME = 'rescue-crane-sim';
const DB_VERSION = 2;
const SEED_VERSION = 3; // 内置参数调整时递增, 触发内置数据刷新 (用户自建数据不动)
const STORES = ['carTypes', 'cranes', 'sites', 'scenes', 'plans', 'meta'] as const;
type StoreName = typeof STORES[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
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
  return openDB().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export async function idbPut<T extends { id: string }>(store: StoreName, value: T): Promise<void> {
  await tx(store, 'readwrite', (s) => s.put(value));
}

export async function idbPutMany<T extends { id: string }>(store: StoreName, values: T[]): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    values.forEach((v) => s.put(v));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function idbGetAll<T>(store: StoreName): Promise<T[]> {
  return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}

export async function idbGet<T>(store: StoreName, id: string): Promise<T | undefined> {
  return tx<T | undefined>(store, 'readonly', (s) => s.get(id) as IDBRequest<T | undefined>);
}

export async function idbDelete(store: StoreName, id: string): Promise<void> {
  await tx(store, 'readwrite', (s) => s.delete(id));
}

export async function ensureSeedData(
  cars: CarType[], crane: CraneModel, sites: SiteParams[], scenes: AccidentScene[],
): Promise<void> {
  const existingCars = await idbGetAll<CarType>('carTypes');
  const meta = await idbGet<{ id: string; seedVersion: number }>('meta', 'seed').catch(() => undefined);
  const needRefresh = existingCars.length === 0 || (meta?.seedVersion ?? 0) < SEED_VERSION;
  if (needRefresh) {
    // 只覆盖内置数据, 保留用户自建 (builtIn !== true) 的记录
    const userCars = existingCars.filter((c) => !c.builtIn);
    await idbPutMany('carTypes', [...cars, ...userCars]);
    const userCranes = (await idbGetAll<CraneModel>('cranes')).filter((c) => !c.builtIn);
    await idbPutMany('cranes', [crane, ...userCranes]);
    const userSites = (await idbGetAll<SiteParams>('sites')).filter((s) => !s.builtIn);
    await idbPutMany('sites', [...sites, ...userSites]);
    const userScenes = (await idbGetAll<AccidentScene>('scenes')).filter((s) => !s.name.endsWith('(副本)'));
    // 内置场景随种子整体重建; 用户复制出的场景按命名约定保留
    await idbPutMany('scenes', [...scenes, ...userScenes]);
    await idbPut('meta', { id: 'seed', seedVersion: SEED_VERSION });
  }
}

export type { StoreName };

export async function listPlans(): Promise<RescuePlan[]> {
  return idbGetAll<RescuePlan>('plans');
}
