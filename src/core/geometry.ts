// 几何工具: 插值、夹角、距离、线段-物体净距等。全部为纯函数, 物理与回放共用。

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

export function rad2deg(r: number): number {
  return (r * 180) / Math.PI;
}

/** 两点间距离 */
export function distance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** 水平距离 (工作半径用) */
export function horizontalDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

/**
 * 双线性插值查表 (如起重性能表: 半径 x 臂长 -> 额定起重量)。
 * xs/ys 必须升序; 越界自动夹紧到端点。
 */
export function interp2D(
  xs: number[],
  ys: number[],
  table: number[][],
  x: number,
  y: number,
): number {
  const cx = clamp(x, xs[0], xs[xs.length - 1]);
  const cy = clamp(y, ys[0], ys[ys.length - 1]);

  let i = 0;
  while (i < xs.length - 2 && cx > xs[i + 1]) i++;
  let j = 0;
  while (j < ys.length - 2 && cy > ys[j + 1]) j++;

  const tx = (cx - xs[i]) / (xs[i + 1] - xs[i] || 1);
  const ty = (cy - ys[j]) / (ys[j + 1] - ys[j] || 1);

  const q00 = table[j][i];
  const q10 = table[j][i + 1];
  const q01 = table[j + 1][i];
  const q11 = table[j + 1][i + 1];
  return lerp(lerp(q00, q10, tx), lerp(q01, q11, tx), ty);
}

/** 一维线性插值, 越界夹紧 */
export function interp1D(xs: number[], ys: number[], x: number): number {
  const cx = clamp(x, xs[0], xs[xs.length - 1]);
  let i = 0;
  while (i < xs.length - 2 && cx > xs[i + 1]) i++;
  const t = (cx - xs[i]) / (xs[i + 1] - xs[i] || 1);
  return lerp(ys[i], ys[i + 1], t);
}

export type V3 = [number, number, number];

export function v3add(a: V3, b: V3): V3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function v3sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function v3scale(a: V3, s: number): V3 { return [a[0] * s, a[1] * s, a[2] * s]; }
export function v3dot(a: V3, b: V3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function v3cross(a: V3, b: V3): V3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
export function v3len(a: V3): number { return Math.hypot(a[0], a[1], a[2]); }
export function v3norm(a: V3): V3 {
  const l = v3len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** 两向量夹角 (度) */
export function angleBetweenDeg(a: V3, b: V3): number {
  const d = v3dot(a, b) / ((v3len(a) || 1) * (v3len(b) || 1));
  return rad2deg(Math.acos(clamp(d, -1, 1)));
}

/** 点到线段最短距离 */
export function pointSegmentDist(p: V3, a: V3, b: V3): number {
  const ab = v3sub(b, a);
  const t = clamp(v3dot(v3sub(p, a), ab) / (v3dot(ab, ab) || 1), 0, 1);
  const closest = v3add(a, v3scale(ab, t));
  return v3len(v3sub(p, closest));
}

/** 两线段最短距离 (接触网导线 vs 主臂中心线用) */
export function segmentSegmentDist(p1: V3, q1: V3, p2: V3, q2: V3): number {
  const d1 = v3sub(q1, p1);
  const d2 = v3sub(q2, p2);
  const r = v3sub(p1, p2);
  const a = v3dot(d1, d1);
  const e = v3dot(d2, d2);
  const f = v3dot(d2, r);
  let s: number, t: number;
  const c = v3dot(d1, r);
  const b = v3dot(d1, d2);
  const denom = a * e - b * b;

  if (denom !== 0) {
    s = clamp((b * f - c * e) / denom, 0, 1);
  } else s = 0;
  t = (b * s + f) / (e || 1);
  if (t < 0) { t = 0; s = clamp(-c / (a || 1), 0, 1); }
  else if (t > 1) { t = 1; s = clamp((b - c) / (a || 1), 0, 1); }

  const c1 = v3add(p1, v3scale(d1, s));
  const c2 = v3add(p2, v3scale(d2, t));
  return v3len(v3sub(c1, c2));
}

/** 线段与轴对齐包围盒的最短距离 (吊索蹭车体检测用)。
 * endInset: 跳过两端各占 tEndInset 比例的段 (挂点本身贴在车体表面, 不算干涉)。 */
export function segmentAABBDist(p1: V3, p2: V3, min: V3, max: V3, endInset = 0.12): number {
  // 采样 + 端点夹紧的稳健近似: 24 段采样, 跳过挂点附近的端点区域
  let minDist = Infinity;
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const raw = i / N;
    if (raw < endInset || raw > 1 - endInset) continue;
    const p = v3add(p1, v3scale(v3sub(p2, p1), raw));
    const cx = clamp(p[0], min[0], max[0]);
    const cy = clamp(p[1], min[1], max[1]);
    const cz = clamp(p[2], min[2], max[2]);
    const d = v3len(v3sub(p, [cx, cy, cz]));
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/** 角度归一化到 [-180, 180] 度 */
export function normDeg(d: number): number {
  let x = d % 360;
  if (x > 180) x -= 360;
  if (x < -180) x += 360;
  return x;
}
