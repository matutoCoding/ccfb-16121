// 列主序 4x4 矩阵 (与 WebGL 一致): m[col*4 + row]
// 所有角度均为弧度。
export type Mat4 = Float32Array;
export type Vec3 = [number, number, number] | Float32Array | number[];

export function mat4(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

export function identity(out: Mat4): Mat4 {
  out.fill(0);
  out[0] = 1; out[5] = 1; out[10] = 1; out[15] = 1;
  return out;
}

export function clone(a: Mat4): Mat4 {
  return new Float32Array(a);
}

export function copy(out: Mat4, a: Mat4): Mat4 {
  out.set(a);
  return out;
}

/** out = a * b */
export function multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

  let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
  out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  return out;
}

export function fromTranslation(out: Mat4, v: Vec3): Mat4 {
  identity(out);
  out[12] = v[0]; out[13] = v[1]; out[14] = v[2];
  return out;
}

export function fromScaling(out: Mat4, v: Vec3): Mat4 {
  identity(out);
  out[0] = v[0]; out[5] = v[1]; out[10] = v[2];
  return out;
}

/** 绕 X 轴旋转 */
export function fromRotationX(out: Mat4, rad: number): Mat4 {
  const s = Math.sin(rad), c = Math.cos(rad);
  identity(out);
  out[5] = c; out[6] = s;
  out[9] = -s; out[10] = c;
  return out;
}

/** 绕 Y 轴旋转 */
export function fromRotationY(out: Mat4, rad: number): Mat4 {
  const s = Math.sin(rad), c = Math.cos(rad);
  identity(out);
  out[0] = c; out[2] = -s;
  out[8] = s; out[10] = c;
  return out;
}

/** 绕 Z 轴旋转 */
export function fromRotationZ(out: Mat4, rad: number): Mat4 {
  const s = Math.sin(rad), c = Math.cos(rad);
  identity(out);
  out[0] = c; out[1] = s;
  out[4] = -s; out[5] = c;
  return out;
}

/** 欧拉角 XYZ 顺序 (内旋), 单位弧度 */
export function fromEuler(out: Mat4, x: number, y: number, z: number): Mat4 {
  const sx = Math.sin(x), cx = Math.cos(x);
  const sy = Math.sin(y), cy = Math.cos(y);
  const sz = Math.sin(z), cz = Math.cos(z);

  out[0] = cy * cz;
  out[1] = cy * sz;
  out[2] = -sy;
  out[3] = 0;

  out[4] = sx * sy * cz - cx * sz;
  out[5] = sx * sy * sz + cx * cz;
  out[6] = sx * cy;
  out[7] = 0;

  out[8] = cx * sy * cz + sx * sz;
  out[9] = cx * sy * sz - sx * cz;
  out[10] = cx * cy;
  out[11] = 0;

  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
}

/**
 * TRS 组合: out = T * Rz * Ry * Rx * S
 * 渲染节点统一走这条路径, 保证物理与渲染使用同一套层级变换。
 */
export function fromTRS(
  out: Mat4,
  t: Vec3,
  rot: { x: number; y: number; z: number },
  s: Vec3,
): Mat4 {
  fromEuler(out, rot.x, rot.y, rot.z);
  out[0] *= s[0]; out[1] *= s[0]; out[2] *= s[0];
  out[4] *= s[1]; out[5] *= s[1]; out[6] *= s[1];
  out[8] *= s[2]; out[9] *= s[2]; out[10] *= s[2];
  out[12] = t[0]; out[13] = t[1]; out[14] = t[2];
  return out;
}

export function transformPoint(m: Mat4, v: Vec3): [number, number, number] {
  const x = v[0], y = v[1], z = v[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

export function perspective(out: Mat4, fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1.0 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

/** 仅含平移与旋转的逆矩阵 (刚体/层级链全部满足), 比通用求逆快且数值稳定 */
export function invertRigid(out: Mat4, a: Mat4): Mat4 {
  const a00 = a[0], a01 = a[1], a02 = a[2];
  const a10 = a[4], a11 = a[5], a12 = a[6];
  const a20 = a[8], a21 = a[9], a22 = a[10];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a01 * a12 - a02 * a11;
  const det = b00 * a22 - b01 * a21 + b02 * a20;
  if (Math.abs(det) < 1e-12) return identity(out);
  const invDet = 1 / det;

  out[0] = (a11 * a22 - a12 * a21) * invDet;
  out[1] = (a02 * a21 - a01 * a22) * invDet;
  out[2] = (a01 * a12 - a02 * a11) * invDet;
  out[3] = 0;
  out[4] = (a12 * a20 - a10 * a22) * invDet;
  out[5] = (a00 * a22 - a02 * a20) * invDet;
  out[6] = (a02 * a10 - a00 * a12) * invDet;
  out[7] = 0;
  out[8] = (a10 * a21 - a11 * a20) * invDet;
  out[9] = (a01 * a20 - a00 * a21) * invDet;
  out[10] = (a00 * a11 - a01 * a10) * invDet;
  out[11] = 0;

  out[12] = -(a[12] * out[0] + a[13] * out[4] + a[14] * out[8]);
  out[13] = -(a[12] * out[1] + a[13] * out[5] + a[14] * out[9]);
  out[14] = -(a[12] * out[2] + a[13] * out[6] + a[14] * out[10]);
  out[15] = 1;
  return out;
}

export function lookAt(out: Mat4, eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz);
  if (len === 0) { zx = 0; zy = 0; zz = 1; } else { zx /= len; zy /= len; zz /= len; }

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz);
  if (len === 0) { xx = 1; xy = 0; xz = 0; } else { xx /= len; xy /= len; xz /= len; }

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

export function multiplyVec3(m: Mat4, v: Vec3): [number, number, number] {
  return transformPoint(m, v);
}
