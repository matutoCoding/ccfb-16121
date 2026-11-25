import type { Vec3 } from '../core/mat4';
import { mat4LookAt, mat4Perspective } from '../core/mat4';
import { add, normalize, scale, sub } from '../core/vec3';

/** 轨道相机：绕目标点偏航/俯仰，滚轮缩放，右键/中键平移 */
export class OrbitCamera {
  target: Vec3 = [0, 2, 0];
  yawDeg = 35;
  pitchDeg = 32;
  distance = 38;
  fovDeg = 50;
  near = 0.1;
  far = 500;

  eye(): Vec3 {
    const yaw = (this.yawDeg * Math.PI) / 180;
    const pitch = (this.pitchDeg * Math.PI) / 180;
    const cp = Math.cos(pitch);
    const offset: Vec3 = [
      this.distance * cp * Math.sin(yaw),
      this.distance * Math.sin(pitch),
      this.distance * cp * Math.cos(yaw),
    ];
    return add(this.target, offset);
  }

  view(): Float32Array {
    return mat4LookAt(this.eye(), this.target, [0, 1, 0]);
  }

  proj(aspect: number): Float32Array {
    return mat4Perspective((this.fovDeg * Math.PI) / 180, aspect, this.near, this.far);
  }

  /** 屏幕拖动旋转 */
  orbit(dxPx: number, dyPx: number): void {
    this.yawDeg -= dxPx * 0.25;
    this.pitchDeg = Math.min(85, Math.max(2, this.pitchDeg + dyPx * 0.2));
  }

  zoom(delta: number): void {
    this.distance = Math.min(200, Math.max(4, this.distance * (1 + delta * 0.001)));
  }

  /** 平移（沿相机右/上方向） */
  pan(dxPx: number, dyPx: number): void {
    const eye = this.eye();
    const fwd = normalize(sub(this.target, eye));
    const right = normalize([fwd[2], 0, -fwd[0]]);
    const up: Vec3 = [0, 1, 0];
    const k = this.distance * 0.0016;
    this.target = add(this.target, add(scale(right, -dxPx * k), scale(up, dyPx * k)));
  }

  /** 屏幕像素坐标 → 地面 y=planeY 的世界坐标射线交点 */
  screenToGround(px: number, py: number, width: number, height: number, planeY: number): Vec3 | null {
    const ndcX = (px / width) * 2 - 1;
    const ndcY = 1 - (py / height) * 2;
    const eye = this.eye();
    const yaw = (this.yawDeg * Math.PI) / 180;
    const pitch = (this.pitchDeg * Math.PI) / 180;
    const f = 1 / Math.tan((this.fovDeg * Math.PI) / 360);
    const aspect = width / height;
    // 相机朝向
    const cp = Math.cos(pitch);
    const dir: Vec3 = normalize([cp * Math.sin(yaw), Math.sin(pitch), cp * Math.cos(yaw)]);
    const right: Vec3 = normalize([dir[2], 0, -dir[0]]);
    const up: Vec3 = [
      -dir[1] * right[2],
      cp,
      dir[1] * right[0],
    ];
    const ray = normalize([
      dir[0] * f + right[0] * ndcX * aspect * f + up[0] * ndcY * f,
      dir[1] * f + right[1] * ndcX * aspect * f + up[1] * ndcY * f,
      dir[2] * f + right[2] * ndcX * aspect * f + up[2] * ndcY * f,
    ]);
    if (Math.abs(ray[1]) < 1e-6) return null;
    const t = (planeY - eye[1]) / ray[1];
    if (t < 0) return null;
    return add(eye, scale(ray, t));
  }
}
