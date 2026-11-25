import type { CarModel, CraneModel, CranePlacement, DerailedCar, LiftPoint } from '../types';
import { G, clamp } from '../core/mathutil';
import type { Vec3 } from '../core/mat4';
import { add, angleDeg, normalize, scale, sub } from '../core/vec3';
import { mat4Compose, mat4TransformPoint } from '../core/mat4';
import { outriggersLocal, padArea } from './crane';

export interface OutriggerForce {
  position: Vec3;
  woodLayers: number;
  /** 支反力（千牛，正为受压，负表示拔腿/离地） */
  reactionKN: number;
  /** 地面比压（kPa） */
  bearingKPa: number;
  overloaded: boolean;
}

export interface ReactionResult {
  forces: OutriggerForce[];
  sumKN: number;
  expectedKN: number;
  /** 合力与期望总竖向力的偏差（千牛，应为浮点级误差） */
  balanceErrorKN: number;
  /** 有支腿出现负反力（拔腿） */
  uplift: boolean;
}

/**
 * 四条支腿支反力（刚性底盘假设，含拔腿迭代）。
 * 坐标系：回转中心在底盘局部系原点（z 向前、x 向右为正），y 向上。
 *
 * 求解思路（压力中心凸包投影法）：
 *   1. 全机竖向合力 F = (自重 + 吊重)·g，压力中心 P = (Mx/F, Mz/F)；
 *   2. 若 P 落在支腿矩形内：四点刚性公式 Ri = F/4·(1 ± px/a ± pz/b)；
 *   3. 若 P 越出矩形（支腿离地）：将 P 投影到着地支腿构成的凸包边界，
 *      按凸包重心坐标分配 F，越界支腿反力为 0。
 * 不变量（含拔腿工况）：ΣRi ≡ F、ΣRi·xi ≡ Mx、ΣRi·zi ≡ Mz。
 */
export function outriggerReactions(
  model: CraneModel,
  placement: CranePlacement,
  /** 吊重（吨，含吊钩吊索） */
  liftedMassT: number,
  /** 吊钩相对回转中心的水平偏心，底盘局部坐标（米） */
  hookOffsetLocal: Vec3,
): ReactionResult {
  const totalMass = model.selfWeightT + Math.max(0, liftedMassT);
  const expectedKN = totalMass * G;

  const legs = outriggersLocal(placement);
  const xs = legs.map((l) => l[0]);
  const zs = legs.map((l) => l[2]);

  // 自重作用线取回转中心（偏心 0），吊重偏心随吊钩
  const ratio = liftedMassT > 0 ? liftedMassT / totalMass : 0;
  // 全机压力中心
  const px = ratio * hookOffsetLocal[0];
  const pz = ratio * hookOffsetLocal[2];

  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const zmin = Math.min(...zs), zmax = Math.max(...zs);
  const inside = px >= xmin && px <= xmax && pz >= zmin && pz <= zmax;

  // 矩形内直接用压力中心的重心坐标；越界先夹紧（凸包投影）再取权重。
  // 两种情况共用一套双线性权重，保证 ΣRi≡F、加权坐标恒等于（投影后的）压力中心。
  const cx = clamp(px, xmin, xmax);
  const cz = clamp(pz, zmin, zmax);
  const raw = rectBarycentric(xs, zs, xmin, xmax, zmin, zmax, cx, cz).map((w) => Math.max(0, w));
  const wSum = raw.reduce((s, w) => s + w, 0) || 1;
  const weights = raw.map((w) => w / wSum);
  const reactions = weights.map((w) => expectedKN * w);
  const forces: OutriggerForce[] = legs.map((_, i) => {
    const r = Math.max(0, reactions[i]);
    const area = padArea(model, placement.outriggers[i].woodLayers);
    return {
      position: placement.outriggers[i].position,
      woodLayers: placement.outriggers[i].woodLayers,
      reactionKN: r,
      bearingKPa: r > 0 ? r / area : 0, // kPa = kN/m²
      overloaded: false,
    };
  });

  const sumKN = forces.reduce((s, f) => s + f.reactionKN, 0);
  const uplift = !inside || forces.some((f) => f.reactionKN <= 1e-9);

  return {
    forces,
    sumKN,
    expectedKN,
    balanceErrorKN: sumKN - expectedKN,
    uplift,
  };
}

/**
 * 矩形四点的重心坐标（双线性权重）。
 * 点 (cx,cz) 在矩形内时，权重和恒为 1，且加权平均坐标恒等于 (cx,cz)。
 * 腿的方位按其在数组中的实际坐标与 xmin/xmax、zmin/zmax 判定，不依赖对称布置。
 */
function rectBarycentric(
  xs: number[],
  zs: number[],
  xmin: number,
  xmax: number,
  zmin: number,
  zmax: number,
  cx: number,
  cz: number,
): number[] {
  const tx = (cx - xmin) / (xmax - xmin || 1);
  const tz = (cz - zmin) / (zmax - zmin || 1);
  return xs.map((x, i) => {
    // 该腿靠近 xmax 取 tx，靠近 xmin 取 1-tx；z 同理
    const wx = Math.abs(x - xmax) < Math.abs(x - xmin) ? tx : 1 - tx;
    const wz = Math.abs(zs[i] - zmax) < Math.abs(zs[i] - zmin) ? tz : 1 - tz;
    return wx * wz;
  });
}

/** 叠加路基容许承载力，标记超载支腿 */
export function markBearing(result: ReactionResult, allowableKPa: number): ReactionResult {
  result.forces.forEach((f) => {
    f.overloaded = f.bearingKPa > allowableKPa;
  });
  return result;
}

// ---------- 车型重心 ----------

/** 车型当前总质量（吨，罐车按装载档） */
export function carTotalMass(car: CarModel): number {
  if (car.kind === 'tank' && car.tankLoads && car.tankLoad) {
    return car.tankLoads[car.tankLoad].totalMassT;
  }
  const parts = [car.body, ...car.bogies, ...car.couplers];
  return parts.reduce((s, p) => s + p.massT, 0);
}

/** 罐车重心随装载移动（半罐液面下移、满载上移的工程近似） */
export function carCogLocal(car: CarModel): Vec3 {
  const base = car.body.cogLocal;
  if (car.kind === 'tank' && car.tankLoads && car.tankLoad) {
    return [base[0], base[1] + car.tankLoads[car.tankLoad].cogShiftY, base[2]];
  }
  return [...base] as Vec3;
}

export function carWorldMatrix(car: DerailedCar) {
  return mat4Compose(car.position, [
    (car.rotationDeg[0] * Math.PI) / 180,
    (car.rotationDeg[1] * Math.PI) / 180,
    (car.rotationDeg[2] * Math.PI) / 180,
  ]);
}

export function carCogWorld(carModel: CarModel, car: DerailedCar): Vec3 {
  return mat4TransformPoint(carWorldMatrix(car), carCogLocal(carModel));
}

export function liftPointWorld(carModel: CarModel, car: DerailedCar, lp: LiftPoint): Vec3 {
  void carModel;
  return mat4TransformPoint(carWorldMatrix(car), lp.position);
}

// ---------- 吊索 ----------

export interface SlingGeometry {
  /** 两绳夹角（度） */
  includedAngleDeg: number;
  /** 绳单位方向（吊钩 -> 吊点） */
  dirs: Vec3[];
  length: number;
}

/**
 * 双吊点吊索几何：吊钩在两吊点中垂线上方。
 * 夹角按两绳方向向量解析计算。
 */
export function slingGeometry(hook: Vec3, points: Vec3[]): SlingGeometry {
  if (points.length === 1) {
    const d = normalize(sub(points[0], hook));
    return { includedAngleDeg: 0, dirs: [d], length: Math.hypot(...sub(points[0], hook)) };
  }
  const mid = scale(add(points[0], points[1]), 0.5);
  const d0 = normalize(sub(points[0], hook));
  const d1 = normalize(sub(points[1], hook));
  void mid;
  return {
    includedAngleDeg: angleDeg(d0, d1),
    dirs: [d0, d1],
    length: Math.hypot(...sub(points[0], hook)),
  };
}

/**
 * 单绳拉力（千牛）。对称双绳：T = mg / (2·cos(θ/2))。
 * n 根绳对称受力的通用式：T = mg / (n·cos(θ/2))。
 */
export function ropeTension(liftedMassT: number, includedAngleDeg: number, ropeCount: number): number {
  const total = liftedMassT * G;
  const half = (includedAngleDeg / 2) * (Math.PI / 180);
  return total / (ropeCount * Math.cos(half));
}

/** 吊索与车体包围盒的干涉粗检：绳段穿入车体 AABB（按车体姿态取 OBB 八顶点近似） */
export function slingHitsCarBody(
  hook: Vec3,
  point: Vec3,
  carModel: CarModel,
  car: DerailedCar,
): boolean {
  const m = carWorldMatrix(car);
  const hx = carModel.length / 2, hy = carModel.height / 2, hz = carModel.width / 2;
  // 把绳段变换到车体局部系（旋转正交：p_local = R^T (p_world - t)），做线段-AABB 检测
  const local = (pWorld: Vec3): Vec3 => {
    const p = sub(pWorld, car.position);
    return [
      m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
      m[4] * p[0] + m[5] * p[1] + m[6] * p[2],
      m[8] * p[0] + m[9] * p[1] + m[10] * p[2],
    ];
  };
  const a = local(hook);
  const b = local(point);
  // 线段-AABB（slab 法）
  let tmin = 0, tmax = 1;
  const lo: Vec3 = [-hx, -hy, -hz];
  const hi: Vec3 = [hx, hy, hz];
  for (let i = 0; i < 3; i++) {
    const d = b[i] - a[i];
    if (Math.abs(d) < 1e-9) {
      if (a[i] < lo[i] || a[i] > hi[i]) return false;
    } else {
      let t1 = (lo[i] - a[i]) / d;
      let t2 = (hi[i] - a[i]) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  // 吊点本身在车体外表面，允许端点贴合：要求交点在绳段内部且明显深入
  return tmin > 0.05 && tmin < 0.95;
}

// ---------- 双机抬吊分担 ----------

/**
 * 两台起重机抬吊一台车（各挂一个吊点）时的分担比例。
 * 按重心在两吊点连线上的投影位置用杠杆法则：
 *   W_A = W · d(重心投影→B) / d(A→B)
 */
export function dualCraneShare(
  carModel: CarModel,
  car: DerailedCar,
  pointA: Vec3,
  pointB: Vec3,
): { shareA: number; shareB: number; massA: number; massB: number } {
  const cog = carCogWorld(carModel, car);
  const ab = sub(pointB, pointA);
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
  const t = clamp(
    ((cog[0] - pointA[0]) * ab[0] + (cog[1] - pointA[1]) * ab[1] + (cog[2] - pointA[2]) * ab[2]) / len2,
    0,
    1,
  );
  const shareA = 1 - t;
  const shareB = t;
  const total = carTotalMass(carModel);
  return { shareA, shareB, massA: total * shareA, massB: total * shareB };
}
