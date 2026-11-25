import type { Mat4, Vec3 } from './mat4';
import { mat4TransformDir, mat4TransformPoint } from './mat4';

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

export function normalize(a: Vec3): Vec3 {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/** 两向量夹角（度），0~180 */
export function angleDeg(a: Vec3, b: Vec3): number {
  const la = length(a), lb = length(b);
  if (!la || !lb) return 0;
  const c = Math.min(1, Math.max(-1, dot(a, b) / (la * lb)));
  return (Math.acos(c) * 180) / Math.PI;
}

export function toWorld(m: Mat4, p: Vec3): Vec3 {
  return mat4TransformPoint(m, p);
}

export function dirToWorld(m: Mat4, d: Vec3): Vec3 {
  return mat4TransformDir(m, d);
}

/** 点到线段最近点与距离 */
export function pointSegmentDist(p: Vec3, a: Vec3, b: Vec3): { point: Vec3; dist: number; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2));
  const point = add(a, scale(ab, t));
  return { point, dist: distance(p, point), t };
}

/** 两线段最短距离（用于吊索/臂与接触网导线的净空检查） */
export function segmentSegmentDist(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  const eps = 1e-12;
  let s: number, t: number;
  if (a <= eps && e <= eps) return distance(p1, p2);
  if (a <= eps) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = dot(d1, r);
    if (e <= eps) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const c1 = add(p1, scale(d1, s));
  const c2 = add(p2, scale(d2, t));
  return distance(c1, c2);
}
