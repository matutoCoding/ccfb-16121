import type { DataBundle } from './services/repository';

export type Route = 'cars' | 'cranes' | 'scene' | 'plan' | 'playback' | 'sheet';

export interface AppState {
  route: Route;
  data: DataBundle;
  /** 当前选中的各类实体 id */
  selectedCarId: string | null;
  selectedCraneId: string | null;
  selectedSceneId: string | null;
  selectedPlanId: string | null;
  /** 最近一次仿真结果（跨页面共享给回放） */
  lastSimulation: { planId: string; frames: import('./types').FrameSnapshot[]; dangers: import('./types').DangerMark[]; durationSec: number } | null;
}

type Listener = (state: AppState) => void;

let state: AppState | null = null;
const listeners = new Set<Listener>();

export function initState(data: DataBundle): AppState {
  state = {
    route: 'plan',
    data,
    selectedCarId: data.carModels[0]?.id ?? null,
    selectedCraneId: data.cranes[0]?.id ?? null,
    selectedSceneId: data.scenes[0]?.id ?? null,
    selectedPlanId: data.plans[0]?.id ?? null,
    lastSimulation: null,
  };
  return state;
}

export function getState(): AppState {
  if (!state) throw new Error('状态未初始化');
  return state;
}

export function setState(patch: Partial<AppState>): void {
  if (!state) return;
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state!));
}

export function updateData(patch: Partial<DataBundle>): void {
  if (!state) return;
  state = { ...state, data: { ...state.data, ...patch } };
  listeners.forEach((l) => l(state!));
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const ROUTE_LABELS: Record<Route, string> = {
  cars: '车型库',
  cranes: '起重机',
  scene: '事故现场',
  plan: '吊复方案',
  playback: '推演回放',
  sheet: '方案单',
};
