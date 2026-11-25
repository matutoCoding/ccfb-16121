// 全局数据仓库: 启动时载入内置数据到 IndexedDB, 页面共享同一份内存状态。
import { seedCarTypes, seedCrane, seedSites, seedScenes } from '../core/seed';
import { ensureSeedData, idbGetAll, idbPut, idbDelete } from '../data/idb';
import type { AccidentScene, CarType, CraneModel, RescuePlan, SiteParams } from '../core/types';

interface AppState {
  cars: CarType[];
  cranes: CraneModel[];
  sites: SiteParams[];
  scenes: AccidentScene[];
  plans: RescuePlan[];
  ready: boolean;
}

export const state: AppState = {
  cars: [],
  cranes: [],
  sites: [],
  scenes: [],
  plans: [],
  ready: false,
};

export async function initState(): Promise<void> {
  if (state.ready) return;
  const cars = seedCarTypes();
  const crane = seedCrane();
  const sites = seedSites();
  const scenes = seedScenes(sites);
  await ensureSeedData(cars, crane, sites, scenes);
  state.cars = await idbGetAll<CarType>('carTypes');
  state.cranes = await idbGetAll<CraneModel>('cranes');
  state.sites = await idbGetAll<SiteParams>('sites');
  state.scenes = await idbGetAll<AccidentScene>('scenes');
  state.plans = await idbGetAll<RescuePlan>('plans');
  state.ready = true;
}

export async function saveCar(car: CarType): Promise<void> {
  await idbPut('carTypes', car);
  const i = state.cars.findIndex((c) => c.id === car.id);
  if (i >= 0) state.cars[i] = car; else state.cars.push(car);
}

export async function deleteCar(id: string): Promise<void> {
  await idbDelete('carTypes', id);
  state.cars = state.cars.filter((c) => c.id !== id);
}

export async function saveCrane(crane: CraneModel): Promise<void> {
  await idbPut('cranes', crane);
  const i = state.cranes.findIndex((c) => c.id === crane.id);
  if (i >= 0) state.cranes[i] = crane; else state.cranes.push(crane);
}

export async function saveSite(site: SiteParams): Promise<void> {
  await idbPut('sites', site);
  const i = state.sites.findIndex((s) => s.id === site.id);
  if (i >= 0) state.sites[i] = site; else state.sites.push(site);
}

export async function deleteSite(id: string): Promise<void> {
  await idbDelete('sites', id);
  state.sites = state.sites.filter((s) => s.id !== id);
}

export async function saveScene(scene: AccidentScene): Promise<void> {
  await idbPut('scenes', scene);
  const i = state.scenes.findIndex((s) => s.id === scene.id);
  if (i >= 0) state.scenes[i] = scene; else state.scenes.push(scene);
}

export async function deleteScene(id: string): Promise<void> {
  await idbDelete('scenes', id);
  state.scenes = state.scenes.filter((s) => s.id !== id);
}

export async function savePlan(plan: RescuePlan): Promise<void> {
  plan.updatedAt = Date.now();
  await idbPut('plans', plan);
  const i = state.plans.findIndex((p) => p.id === plan.id);
  if (i >= 0) state.plans[i] = plan; else state.plans.push(plan);
}

export async function deletePlan(id: string): Promise<void> {
  await idbDelete('plans', id);
  state.plans = state.plans.filter((p) => p.id !== id);
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
