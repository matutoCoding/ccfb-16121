import type { AccidentScene, CatenaryPole } from '../types';
import { DEG, clamp } from '../core/mathutil';
import type { Vec3 } from '../core/mat4';
import { add, scale, segmentSegmentDist, sub } from '../core/vec3';

/** 线路方向单位向量（水平面，绕 y） */
export function lineDirection(scene: AccidentScene): Vec3 {
  const yaw = scene.lineHeadingDeg * DEG;
  return [Math.sin(yaw), 0, Math.cos(yaw)];
}

/** 接触网导线：相邻立柱悬挂点之间的线段集合 */
export function catenaryWires(scene: AccidentScene): { a: Vec3; b: Vec3 }[] {
  const wires: { a: Vec3; b: Vec3 }[] = [];
  const sorted = [...scene.poles].sort((p, q) => p.position[2] - q.position[2]);
  for (let i = 0; i < sorted.length - 1; i++) {
    wires.push({ a: wireHangPoint(scene, sorted[i]), b: wireHangPoint(scene, sorted[i + 1]) });
  }
  return wires;
}

/** 单根立柱的导线悬挂点世界坐标 */
export function wireHangPoint(scene: AccidentScene, pole: CatenaryPole): Vec3 {
  const dir = lineDirection(scene);
  const top: Vec3 = [pole.position[0], pole.position[1] + pole.height, pole.position[2]];
  // 横臂从立柱向线路侧（-dir 的垂直方向，简化为沿 x 向线路中心）
  const toTrack: Vec3 = [dir[2], 0, -dir[0]];
  return add(top, scale(toTrack, pole.wireArm));
}

export interface ClearanceResult {
  /** 最近净空（米） */
  minDistance: number;
  /** 最近对象类型 */
  nearestObject: 'pole' | 'wire' | null;
  nearestId: string | null;
  /** 臂上最近点与对象最近点 */
  boomPoint: Vec3 | null;
  objectPoint: Vec3 | null;
  /** 是否小于安全距离（米） */
  violation: boolean;
}

export const SAFE_CLEARANCE_M = 2.0; // 接触网带电体安全距离工程取值

/**
 * 逐帧计算主臂（臂根→臂头线段）与邻线接触网立柱、导线的最小净空。
 */
export function boomCatenaryClearance(
  scene: AccidentScene,
  boomFoot: Vec3,
  boomTip: Vec3,
): ClearanceResult {
  let min = Infinity;
  let nearestObject: ClearanceResult['nearestObject'] = null;
  let nearestId: string | null = null;
  let boomPoint: Vec3 | null = null;
  let objectPoint: Vec3 | null = null;

  const consider = (dist: number, kind: 'pole' | 'wire', id: string, bp: Vec3, op: Vec3) => {
    if (dist < min) {
      min = dist;
      nearestObject = kind;
      nearestId = id;
      boomPoint = bp;
      objectPoint = op;
    }
  };

  for (const pole of scene.poles) {
    const bottom: Vec3 = [pole.position[0], pole.position[1], pole.position[2]];
    const top: Vec3 = [pole.position[0], pole.position[1] + pole.height, pole.position[2]];
    const d = segmentSegmentDist(boomFoot, boomTip, bottom, top);
    consider(d, 'pole', pole.id, boomFoot, top);
  }
  for (const [i, wire] of catenaryWires(scene).entries()) {
    const d = segmentSegmentDist(boomFoot, boomTip, wire.a, wire.b);
    consider(d, 'wire', `wire-${i}`, boomFoot, wire.a);
  }

  if (!Number.isFinite(min)) {
    return { minDistance: Infinity, nearestObject: null, nearestId: null, boomPoint: null, objectPoint: null, violation: false };
  }
  return { minDistance: min, nearestObject, nearestId, boomPoint, objectPoint, violation: min < SAFE_CLEARANCE_M };
}

/** 路堤边坡上的地面高度（米），路肩范围外按 1:1.5 边坡下降 */
export function groundHeightAt(scene: AccidentScene, trackCenter: Vec3, x: number, z: number): number {
  const dir = lineDirection(scene);
  const rel = sub([x, 0, z], [trackCenter[0], 0, trackCenter[2]]);
  // 横向距离（垂直线路方向）
  const lateral = Math.abs(rel[0] * dir[2] - rel[2] * dir[0]);
  const halfWidth = scene.shoulderWidth / 2;
  if (lateral <= halfWidth) return trackCenter[1];
  const slope = 1 / 1.5;
  return Math.max(0, trackCenter[1] - (lateral - halfWidth) * slope);
}

/** 支腿位置处的地面高（用于判断沉陷与垫木需求） */
export function outriggerGroundHeight(scene: AccidentScene, trackCenter: Vec3, p: Vec3): number {
  return groundHeightAt(scene, trackCenter, p[0], p[2]);
}

/** 线路中心线在给定纵向里程处的点（曲线段按圆弧） */
export function trackCenterAt(scene: AccidentScene, origin: Vec3, alongM: number): Vec3 {
  if (scene.curveRadius <= 0) {
    const d = lineDirection(scene);
    return add(origin, scale(d, alongM));
  }
  const R = scene.curveRadius;
  const theta = alongM / R;
  const d = lineDirection(scene);
  // 圆心在左侧
  const center = add(origin, [d[2] * R, 0, -d[0] * R]);
  const a0 = Math.atan2(origin[2] - center[2], origin[0] - center[0]);
  return [center[0] + R * Math.cos(a0 + theta), origin[1], center[2] + R * Math.sin(a0 + theta)];
}

export function clampToRange(v: number, min: number, max: number): number {
  return clamp(v, min, max);
}
