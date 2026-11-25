export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const G = 9.81; // m/s^2

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function lerp1(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 单调升序数组上的一维插值，x 越界取端点值 */
export function interp1(xs: number[], ys: number[], x: number): number {
  if (xs.length === 0) return 0;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 0; i < xs.length - 1; i++) {
    if (x >= xs[i] && x <= xs[i + 1]) {
      const t = (x - xs[i]) / (xs[i + 1] - xs[i] || 1);
      return lerp1(ys[i], ys[i + 1], t);
    }
  }
  return ys[ys.length - 1];
}

/**
 * 双线性插值查性能表。
 * rows: 按工作半径升序的 [{r, capacities: 与臂长列对齐}]
 */
export function interp2(
  radii: number[],
  boomLengths: number[],
  grid: number[][], // grid[iRadius][jBoom]，单位吨
  r: number,
  boom: number,
): number {
  const clampR = clamp(r, radii[0], radii[radii.length - 1]);
  const clampB = clamp(boom, boomLengths[0], boomLengths[boomLengths.length - 1]);
  // 区间定位：夹紧后必落在 [0, n-2] 号区间内（等值归到右侧区间不影响插值结果）
  let i = 0;
  while (i < radii.length - 2 && clampR >= radii[i + 1]) i++;
  let j = 0;
  while (j < boomLengths.length - 2 && clampB >= boomLengths[j + 1]) j++;
  const tr = (clampR - radii[i]) / (radii[i + 1] - radii[i] || 1);
  const tb = (clampB - boomLengths[j]) / (boomLengths[j + 1] - boomLengths[j] || 1);
  const c00 = grid[i][j];
  const c10 = grid[i + 1][j];
  const c01 = grid[i][j + 1];
  const c11 = grid[i + 1][j + 1];
  return lerp1(lerp1(c00, c10, tr), lerp1(c01, c11, tr), tb);
}

export function approx(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol;
}

export function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

/** 角度归一化到 0~360 */
export function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}
