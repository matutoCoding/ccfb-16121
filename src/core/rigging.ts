// 吊索/吊装计算: 夹角、干涉、双机抬吊分担比例 (按吊点位置力矩分配)。
import { G } from './crane';
import { angleBetweenDeg, segmentAABBDist, v3sub, type V3 } from './geometry';
import type { CarType, SlingState, Vec3M } from './types';

export interface SlingInput {
  hook: Vec3M;
  carPointIds: string[];
  /** 吊点世界坐标 */
  pointWorlds: Vec3M[];
  carHalfSize: Vec3M;
  /** 车体包围盒世界中心 */
  carCenter: Vec3M;
}

/**
 * 单钩多吊点: 由吊钩与吊点几何反算每根吊索长度与夹角,
 * 并检测吊索与车体包围盒的净距 (蹭车体判定)。
 */
export function evaluateSling(input: SlingInput): SlingState {
  const lengths = input.pointWorlds.map((p) => Math.hypot(
    p[0] - input.hook[0], p[1] - input.hook[1], p[2] - input.hook[2],
  ));

  let includedAngleDeg = 0;
  if (input.pointWorlds.length >= 2) {
    const v1 = v3sub(input.pointWorlds[0], input.hook) as V3;
    const v2 = v3sub(input.pointWorlds[1], input.hook) as V3;
    includedAngleDeg = angleBetweenDeg(v1, v2);
  }

  // 车体 AABB (用半尺寸近似, 偏安全)
  const min: V3 = [
    input.carCenter[0] - input.carHalfSize[0],
    input.carCenter[1] - input.carHalfSize[1],
    input.carCenter[2] - input.carHalfSize[2],
  ];
  const max: V3 = [
    input.carCenter[0] + input.carHalfSize[0],
    input.carCenter[1] + input.carHalfSize[1],
    input.carCenter[2] + input.carHalfSize[2],
  ];
  let clearance = Infinity;
  for (const p of input.pointWorlds) {
    const d = segmentAABBDist(input.hook as V3, p as V3, min, max);
    if (d < clearance) clearance = d;
  }

  return {
    carPointIds: input.carPointIds,
    lengths,
    includedAngleDeg,
    clearance,
  };
}

/** 吊索安全提示: 夹角超限 (>90° 警告, >120° 危险) 或蹭车体 */
export function slingAlerts(state: SlingState): { level: 'warn' | 'danger'; text: string }[] {
  const out: { level: 'warn' | 'danger'; text: string }[] = [];
  if (state.includedAngleDeg > 120) {
    out.push({ level: 'danger', text: `吊索夹角 ${state.includedAngleDeg.toFixed(1)}° > 120°, 索力激增禁止作业` });
  } else if (state.includedAngleDeg > 90) {
    out.push({ level: 'warn', text: `吊索夹角 ${state.includedAngleDeg.toFixed(1)}° > 90°, 注意索力增大` });
  }
  if (state.clearance < 0.05) {
    out.push({ level: 'danger', text: '吊索蹭到车体, 需调整吊钩位置或加护角' });
  }
  return out;
}

/**
 * 单根吊索拉力 (kN): 对称双索假定。
 * T = W / (2·cos(θ/2)), θ 为两索夹角; 单索时 T = W。
 */
export function slingTension(totalMassT: number, includedAngleDeg: number, legs: number): number {
  const W = totalMassT * G;
  if (legs <= 1) return W;
  const half = (includedAngleDeg * Math.PI / 180) / 2;
  return W / (legs * Math.cos(half));
}

/**
 * 双机抬吊分担比例: 按各起重机吊钩相对车体重心的水平距离做力矩分配。
 * 距重心近的一侧分担多: share_i = d_other / (d1 + d2)。
 * 返回两台各自承担的质量 t。
 */
export function dualCraneShare(
  totalMassT: number,
  hook1: Vec3M,
  hook2: Vec3M,
  carCog: Vec3M,
): { share1: number; share2: number; ratio1: number; ratio2: number } {
  const d1 = Math.hypot(hook1[0] - carCog[0], hook1[2] - carCog[2]);
  const d2 = Math.hypot(hook2[0] - carCog[0], hook2[2] - carCog[2]);
  const denom = d1 + d2 || 1;
  const ratio1 = d2 / denom;
  const ratio2 = d1 / denom;
  return {
    share1: totalMassT * ratio1,
    share2: totalMassT * ratio2,
    ratio1,
    ratio2,
  };
}

/** 罐车装载变化后重算重心与总质量 (空/半载/满载) */
export function tankCarMassAndCog(car: CarType): { mass: number; cogY: number } {
  if (car.bodyType !== 'tank' || !car.tank) {
    const mass = car.parts.reduce((s, p) => s + p.mass, 0);
    const body = car.parts.find((p) => p.kind === 'body');
    return { mass, cogY: body?.cog[1] ?? 1 };
  }
  const load = car.tankLoad ?? 'empty';
  const tare = car.parts.reduce((s, p) => s + p.mass, 0);
  const cargo = car.tank.loadMass[load];
  return { mass: tare + cargo, cogY: car.tank.loadCogY[load] };
}
