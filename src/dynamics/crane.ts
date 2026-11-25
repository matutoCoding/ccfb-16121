import type { CraneModel, CranePlacement, OutriggerStatePerf } from '../types';
import { DEG, clamp, interp2 } from '../core/mathutil';
import {
  mat4Compose,
  mat4Identity,
  mat4Multiply,
  mat4RotationX,
  mat4RotationY,
  mat4Translation,
  mat4TransformPoint,
  type Mat4,
  type Vec3,
} from '../core/mat4';
import { add, scale } from '../core/vec3';

/** 起重机关节状态：回转角、变幅角、各伸缩节伸出量、吊钩世界高度 */
export interface CraneJointState {
  slewDeg: number;
  luffDeg: number;
  extensions: number[];
  hookHeight: number;
}

export interface CraneFKResult {
  /** 各刚体节点的世界矩阵 */
  world: Record<string, Mat4>;
  /** 臂根铰点世界坐标 */
  boomFootWorld: Vec3;
  /** 臂头世界坐标 */
  boomTipWorld: Vec3;
  /** 吊钩世界坐标 */
  hookWorld: Vec3;
  /** 回转中心世界坐标 */
  slewCenterWorld: Vec3;
  /** 实际臂长（米，臂根到臂头） */
  boomLength: number;
  /** 工作半径（米，吊钩相对回转中心的水平距离） */
  radius: number;
  /** 钢丝绳长度（米，臂头到吊钩） */
  ropeLength: number;
  /** 各臂节当前长度 */
  sectionLengths: number[];
}

export function defaultJointState(): CraneJointState {
  return { slewDeg: 0, luffDeg: 60, extensions: [], hookHeight: 2 };
}

/** 按节序计算各臂节长度（第 0 节为固定基节） */
export function sectionLengths(model: CraneModel, extensions: number[]): number[] {
  return model.boomSections.map((s, i) => {
    const ext = clamp(extensions[i] ?? 0, 0, s.maxLen - s.minLen);
    return s.minLen + ext;
  });
}

export function boomLengthOf(model: CraneModel, extensions: number[]): number {
  return sectionLengths(model, extensions).reduce((a, b) => a + b, 0);
}

/** 由工作半径与臂长反解变幅角（度） */
export function luffFromRadius(boomLength: number, radius: number): number {
  const c = clamp(radius / boomLength, -1, 1);
  return (Math.acos(c) * 180) / Math.PI;
}

/** 由变幅角与臂长正解工作半径 */
export function radiusFromLuff(boomLength: number, luffDeg: number): number {
  return boomLength * Math.cos(luffDeg * DEG);
}

/**
 * 起重机正运动学。
 * 层级（每级只认父级局部坐标）：
 *   chassis -> slew(绕y回转) -> boomFoot(铰点) -> boom(绕x变幅)
 *          -> section_i(沿臂轴 +z 顺序伸出) -> rope(竖直) -> hook
 */
export function forwardKinematics(
  model: CraneModel,
  placement: CranePlacement,
  joint: CraneJointState,
): CraneFKResult {
  const world: Record<string, Mat4> = {};

  // 1. 底盘：世界平移 + 航向
  const chassis = mat4Compose(placement.position, [0, placement.headingDeg * DEG, 0]);
  world.chassis = chassis;

  // 2. 转台：底盘之上，绕自身 y 轴回转
  const slew = mat4Multiply(
    chassis,
    mat4Multiply(mat4Translation(0, model.slewBaseHeight, 0), mat4RotationY(joint.slewDeg * DEG)),
  );
  world.slew = slew;
  const slewCenterWorld = mat4TransformPoint(chassis, [0, model.slewBaseHeight, 0]);

  // 3. 臂根铰点（转台局部坐标）
  const boomFoot = mat4Multiply(slew, mat4Translation(...model.boomFoot));
  world.boomFoot = boomFoot;
  const boomFootWorld = mat4TransformPoint(boomFoot, [0, 0, 0]);

  // 4. 主臂变幅：绕铰点局部 x 轴
  const boomBase = mat4Multiply(boomFoot, mat4RotationX(-joint.luffDeg * DEG));
  world.boom = boomBase;

  // 5. 伸缩臂按节序沿臂轴 +z 排列：每节原点 = 父节末端
  const lengths = sectionLengths(model, joint.extensions);
  let parent = boomBase;
  lengths.forEach((_len, i) => {
    // section0 原点在臂根；section i(i>0) 沿父节局部 +z 平移父节长度
    const node = i === 0 ? boomBase : mat4Multiply(parent, mat4Translation(0, 0, lengths[i - 1]));
    world[`section${i}`] = node;
    parent = node;
  });
  const boomLength = lengths.reduce((a, b) => a + b, 0);
  const boomTipWorld = mat4TransformPoint(boomBase, [0, 0, boomLength]);

  // 6. 钢丝绳竖直下垂（重力方向），吊钩 xz 与臂头一致
  const ropeLength = Math.max(0, boomTipWorld[1] - joint.hookHeight);
  const hookWorld: Vec3 = [boomTipWorld[0], joint.hookHeight, boomTipWorld[2]];
  world.rope = mat4Multiply(
    boomBase,
    mat4Translation(0, 0, boomLength), // 臂头局部
  );
  world.hook = mat4Translation(hookWorld[0], hookWorld[1], hookWorld[2]);

  const dx = hookWorld[0] - slewCenterWorld[0];
  const dz = hookWorld[2] - slewCenterWorld[2];
  const radius = Math.hypot(dx, dz);

  return {
    world,
    boomFootWorld,
    boomTipWorld,
    hookWorld,
    slewCenterWorld,
    boomLength,
    radius,
    ropeLength,
    sectionLengths: lengths,
  };
}

/**
 * 解析手算值（独立于矩阵链路，用于互验）。
 * 严格按同一层级手算：
 *   1) 回转中心 O = 底盘位置 + (0, slewBaseHeight, 0)
 *   2) 臂根 F = O + Ry(航向+回转)·boomFoot
 *   3) 臂头 T = F + Ry(航向+回转)·(0, L·sinα, L·cosα)
 * 与 forwardKinematics 的矩阵链路是两套独立写法。
 */
export function analyticBoomTip(
  model: CraneModel,
  placement: CranePlacement,
  joint: CraneJointState,
): Vec3 {
  const L = boomLengthOf(model, joint.extensions);
  const a = joint.luffDeg * DEG;
  const yaw = (placement.headingDeg + joint.slewDeg) * DEG;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const rotY = (v: Vec3): Vec3 => [
    v[0] * cy + v[2] * sy,
    v[1],
    -v[0] * sy + v[2] * cy,
  ];
  const center: Vec3 = [
    placement.position[0],
    placement.position[1] + model.slewBaseHeight,
    placement.position[2],
  ];
  const foot = add(center, rotY(model.boomFoot));
  const boomDelta = rotY([0, L * Math.sin(a), L * Math.cos(a)]);
  return add(foot, boomDelta);
}

/** 查起重机在指定支腿状态下的性能表 */
export function getChart(model: CraneModel, chartState: string): OutriggerStatePerf {
  return model.loadCharts.find((c) => c.state === chartState) ?? model.loadCharts[0];
}

/** 按工作半径、臂长双线性插值求额定起重量（吨） */
export function ratedCapacity(
  model: CraneModel,
  chartState: string,
  radius: number,
  boomLength: number,
): number {
  const chart = getChart(model, chartState);
  return interp2(chart.radii, chart.boomLengths, chart.grid, radius, boomLength);
}

export interface LoadEval {
  ratedT: number;
  /** 吊载率 % */
  ratioPct: number;
  level: 'normal' | 'warn' | 'danger';
  /** 超过 100% 时锁住操作 */
  locked: boolean;
}

/** 吊载率评估：>90% 黄，>100% 红并锁定 */
export function evaluateLoad(model: CraneModel, placement: CranePlacement, liftedGrossT: number, radius: number, boomLength: number): LoadEval {
  const ratedT = ratedCapacity(model, placement.chartState, radius, boomLength);
  const ratioPct = ratedT > 0 ? (liftedGrossT / ratedT) * 100 : 999;
  const level: LoadEval['level'] = ratioPct > 100 ? 'danger' : ratioPct > 90 ? 'warn' : 'normal';
  return { ratedT, ratioPct, level, locked: ratioPct > 100 };
}

/** 带速度上限的关节增量（单步 dt 内可达的最接近目标值） */
export function approachJoint(
  model: CraneModel,
  current: CraneJointState,
  target: Partial<CraneJointState>,
  dt: number,
): CraneJointState {
  const lim = model.speedLimits;
  const next: CraneJointState = { ...current, extensions: [...current.extensions] };
  if (target.slewDeg !== undefined) {
    const d = target.slewDeg - current.slewDeg;
    const step = clamp(d, -lim.slewDegPerSec * dt, lim.slewDegPerSec * dt);
    next.slewDeg = current.slewDeg + step;
  }
  if (target.luffDeg !== undefined) {
    const d = target.luffDeg - current.luffDeg;
    const step = clamp(d, -lim.luffDegPerSec * dt, lim.luffDegPerSec * dt);
    next.luffDeg = clamp(current.luffDeg + step, model.luffMinDeg, model.luffMaxDeg);
  }
  if (target.hookHeight !== undefined) {
    const d = target.hookHeight - current.hookHeight;
    const step = clamp(d, -lim.hoistMPerSec * dt, lim.hoistMPerSec * dt);
    next.hookHeight = current.hookHeight + step;
  }
  if (target.extensions) {
    target.extensions.forEach((t, i) => {
      const sec = model.boomSections[i];
      const cur = current.extensions[i] ?? 0;
      const maxExt = sec ? sec.maxLen - sec.minLen : 0;
      const tt = clamp(t, 0, maxExt);
      const d = tt - cur;
      const step = clamp(d, -lim.extendMPerSec * dt, lim.extendMPerSec * dt);
      next.extensions[i] = cur + step;
    });
  }
  return next;
}

export function jointReached(current: CraneJointState, target: Partial<CraneJointState>): boolean {
  const epsA = 0.01, epsL = 0.005;
  if (target.slewDeg !== undefined && Math.abs(target.slewDeg - current.slewDeg) > epsA) return false;
  if (target.luffDeg !== undefined && Math.abs(target.luffDeg - current.luffDeg) > epsA) return false;
  if (target.hookHeight !== undefined && Math.abs(target.hookHeight - current.hookHeight) > epsL) return false;
  if (target.extensions && target.extensions.some((t, i) => Math.abs(t - (current.extensions[i] ?? 0)) > epsL)) return false;
  return true;
}

/** 支腿在底盘局部系下的位置 */
export function outriggersLocal(placement: CranePlacement): Vec3[] {
  const inv = mat4Identity(); // 占位以保持导入结构清晰
  void inv;
  const hy = placement.headingDeg * DEG;
  const ch = Math.cos(-hy), sh = Math.sin(-hy);
  return placement.outriggers.map((o) => {
    const dx = o.position[0] - placement.position[0];
    const dz = o.position[2] - placement.position[2];
    return [dx * ch - dz * sh, o.position[1], dx * sh + dz * ch];
  });
}

export function padArea(model: CraneModel, woodLayers: number): number {
  // 垫木每一层按厚度向四周扩散受力面
  const side = model.padSize + 2 * woodLayers * model.padThickness;
  return side * side;
}

export function outriggerLabel(i: number): string {
  return ['左前', '右前', '左后', '右后'][i] ?? `支腿${i + 1}`;
}

export function jointTargetFromAction(
  model: CraneModel,
  type: string,
  value: number | number[],
): Partial<CraneJointState> {
  switch (type) {
    case 'slew':
      return { slewDeg: value as number };
    case 'luff':
      return { luffDeg: clamp(value as number, model.luffMinDeg, model.luffMaxDeg) };
    case 'hoist':
      return { hookHeight: value as number };
    case 'extend':
      return { extensions: value as number[] };
    default:
      return {};
  }
}

export function extArray(model: CraneModel, ratio: number): number[] {
  return model.boomSections.map((s, i) => (i === 0 ? 0 : (s.maxLen - s.minLen) * clamp(ratio, 0, 1)));
}

export { scale };
