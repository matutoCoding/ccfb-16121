import type { AccidentScene, CarModel, CraneModel, RescuePlan } from '../types';
import { ensureSeeded, idbDelete, idbGetAll, idbPut, type StoreName } from './db';
import { seedCars, seedCrane, seedPlan, seedScenes } from '../seed';

export interface DataBundle {
  carModels: CarModel[];
  cranes: CraneModel[];
  scenes: AccidentScene[];
  plans: RescuePlan[];
}

export async function loadAll(): Promise<DataBundle> {
  const [carModels, cranes, scenes, plans] = await Promise.all([
    idbGetAll<CarModel>('carModels'),
    idbGetAll<CraneModel>('cranes'),
    idbGetAll<AccidentScene>('scenes'),
    idbGetAll<RescuePlan>('plans'),
  ]);
  return { carModels, cranes, scenes, plans };
}

export async function seedIfEmpty(): Promise<DataBundle> {
  const cars = seedCars();
  const crane = seedCrane();
  const scenes = seedScenes();
  const plan = seedPlan(scenes[0].id, cars[0].id);
  await ensureSeeded({
    carModels: cars,
    cranes: [crane],
    scenes,
    plans: [plan],
  });
  return loadAll();
}

export async function saveItem<T extends { id: string }>(store: StoreName, item: T): Promise<void> {
  await idbPut(store, item);
}

export async function removeItem(store: StoreName, id: string): Promise<void> {
  await idbDelete(store, id);
}

export function uid(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
