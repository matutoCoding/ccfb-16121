import type {
  AccidentScene,
  CarModel,
  CraneModel,
  CranePlacement,
  DerailedCar,
  FrameSnapshot,
} from '../types';
import type { Vec3 } from '../core/mat4';
import { mat4Compose, mat4Multiply, mat4RotationX, mat4RotationZ, mat4Scaling, mat4Translation, mat4TransformPoint } from '../core/mat4';
import { add, sub } from '../core/vec3';
import { DEG } from '../core/mathutil';
import { OrbitCamera } from './camera';
import { boxMesh, cylinderMesh, groundGrid, sphereMesh, type LineMesh, type Mesh } from './mesh';
import { createGl, createLineProgram, createMeshProgram, type ShaderProgram } from './shader';
import { forwardKinematics, type CraneJointState } from '../dynamics/crane';
import { carWorldMatrix } from '../dynamics/statics';
import { catenaryWires, wireHangPoint } from '../dynamics/scene';

export interface RenderColors {
  crane: [number, number, number];
  car: [number, number, number];
  danger: [number, number, number];
  warn: [number, number, number];
  ok: [number, number, number];
}

const COLORS: RenderColors = {
  crane: [0.95, 0.62, 0.12],
  car: [0.2, 0.45, 0.85],
  danger: [0.9, 0.18, 0.18],
  warn: [0.95, 0.75, 0.15],
  ok: [0.3, 0.8, 0.4],
};

export class Renderer {
  gl: WebGL2RenderingContext;
  camera = new OrbitCamera();
  private meshProg: ShaderProgram;
  private lineProg: ShaderProgram;
  private box: Mesh;
  private cyl: Mesh;
  private sphere: Mesh;
  private grid: LineMesh;
  private dynamicLineVao: WebGLVertexArrayObject | null = null;
  private dynamicLineBuf: WebGLBuffer | null = null;
  private dynamicLineCount = 0;
  width = 1;
  height = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.gl = createGl(canvas);
    this.meshProg = createMeshProgram(this.gl);
    this.lineProg = createLineProgram(this.gl);
    this.box = boxMesh(this.gl);
    this.cyl = cylinderMesh(this.gl);
    this.sphere = sphereMesh(this.gl);
    this.grid = groundGrid(this.gl, 40, 2);
    this.resize(canvas.clientWidth || 800, canvas.clientHeight || 600);
  }

  resize(w: number, h: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = w;
    this.height = h;
    this.gl.canvas.width = Math.round(w * dpr);
    this.gl.canvas.height = Math.round(h * dpr);
    this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
  }

  drawBox(world: Float32Array, size: Vec3, color: Vec3, alpha = 1): void {
    const gl = this.gl;
    const model = mat4Multiply(world, mat4Scaling(size[0], size[1], size[2]));
    gl.uniformMatrix4fv(this.meshProg.uniforms.uModel, false, model);
    gl.uniform3fv(this.meshProg.uniforms.uColor, color);
    gl.uniform1f(this.meshProg.uniforms.uAlpha, alpha);
    gl.bindVertexArray(this.box.vao);
    gl.drawElements(gl.TRIANGLES, this.box.vertexCount, gl.UNSIGNED_SHORT, 0);
  }

  drawCyl(world: Float32Array, radius: number, length: number, color: Vec3): void {
    const gl = this.gl;
    // 圆柱网格沿 +z、半径 0.5、长度 1
    const model = mat4Multiply(world, mat4Scaling(radius * 2, radius * 2, length));
    gl.uniformMatrix4fv(this.meshProg.uniforms.uModel, false, model);
    gl.uniform3fv(this.meshProg.uniforms.uColor, color);
    gl.uniform1f(this.meshProg.uniforms.uAlpha, 1);
    gl.bindVertexArray(this.cyl.vao);
    gl.drawElements(gl.TRIANGLES, this.cyl.vertexCount, gl.UNSIGNED_SHORT, 0);
  }

  drawSphere(world: Float32Array, radius: number, color: Vec3): void {
    const gl = this.gl;
    const model = mat4Multiply(world, mat4Scaling(radius * 2, radius * 2, radius * 2));
    gl.uniformMatrix4fv(this.meshProg.uniforms.uModel, false, model);
    gl.uniform3fv(this.meshProg.uniforms.uColor, color);
    gl.uniform1f(this.meshProg.uniforms.uAlpha, 1);
    gl.bindVertexArray(this.sphere.vao);
    gl.drawElements(gl.TRIANGLES, this.sphere.vertexCount, gl.UNSIGNED_SHORT, 0);
  }

  drawLineSegments(positions: number[], color: [number, number, number, number]): void {
    const gl = this.gl;
    if (!this.dynamicLineVao) {
      this.dynamicLineVao = gl.createVertexArray();
      this.dynamicLineBuf = gl.createBuffer();
      gl.bindVertexArray(this.dynamicLineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicLineBuf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    }
    gl.bindVertexArray(this.dynamicLineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicLineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
    this.dynamicLineCount = positions.length / 3;
    gl.useProgram(this.lineProg.program);
    gl.uniformMatrix4fv(this.lineProg.uniforms.uView, false, this.camera.view());
    gl.uniformMatrix4fv(this.lineProg.uniforms.uProj, false, this.camera.proj(this.width / this.height));
    gl.uniform4fv(this.lineProg.uniforms.uColor, color);
    gl.drawArrays(gl.LINES, 0, this.dynamicLineCount);
    // 切回网格 program，否则后续 uniform 调用会作用到错误的 program
    this.useMeshProgram();
  }

  /** 绑定网格 program 并恢复视口相关 uniform */
  private useMeshProgram(): void {
    const gl = this.gl;
    gl.useProgram(this.meshProg.program);
    gl.uniformMatrix4fv(this.meshProg.uniforms.uView, false, this.camera.view());
    gl.uniformMatrix4fv(this.meshProg.uniforms.uProj, false, this.camera.proj(this.width / this.height));
    gl.uniform3fv(this.meshProg.uniforms.uLightDir, new Float32Array([0.5, 1, 0.35]));
    gl.uniform3fv(this.meshProg.uniforms.uCamPos, this.camera.eye());
  }

  begin(): void {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // 地面网格
    gl.useProgram(this.lineProg.program);
    gl.uniformMatrix4fv(this.lineProg.uniforms.uView, false, this.camera.view());
    gl.uniformMatrix4fv(this.lineProg.uniforms.uProj, false, this.camera.proj(this.width / this.height));
    gl.uniform4fv(this.lineProg.uniforms.uColor, new Float32Array([0.3, 0.35, 0.42, 0.6]));
    gl.bindVertexArray(this.grid.vao);
    gl.drawArrays(gl.LINES, 0, this.grid.vertexCount);
    this.useMeshProgram();
  }

  /** 事故现场：路堤、钢轨、接触网立柱与导线 */
  drawScene(scene: AccidentScene): void {
    const gl = this.gl;
    gl.useProgram(this.meshProg.program);
    // 路堤主体（长 80m 带状）
    const groundY = scene.embankmentHeight > 0 ? 0 : scene.embankmentHeight;
    void groundY;
    const topY = Math.max(0, scene.embankmentHeight);
    const shoulder = scene.shoulderWidth;
    this.drawBox(mat4Compose([0, topY - 0.15, 0], [0, scene.lineHeadingDeg * DEG, 0]), [shoulder + 6, 0.3, 80], [0.32, 0.3, 0.26]);
    if (scene.embankmentHeight > 0) {
      // 边坡简化体
      this.drawBox(mat4Compose([0, scene.embankmentHeight / 2, 0], [0, scene.lineHeadingDeg * DEG, 0]), [shoulder + 14, scene.embankmentHeight, 80], [0.28, 0.26, 0.22]);
      this.drawBox(mat4Compose([0, topY - 0.15, 0], [0, scene.lineHeadingDeg * DEG, 0]), [shoulder + 6, 0.3, 80], [0.36, 0.34, 0.3]);
    }

    // 两条钢轨（本线）+ 邻线
    const trackLines: number[] = [];
    const gauge = 1.435;
    for (const trackX of [0, scene.trackSpacing]) {
      for (const off of [-gauge / 2, gauge / 2]) {
        trackLines.push(trackX + off, topY + 0.08, -40, trackX + off, topY + 0.08, 40);
      }
      // 轨枕
      for (let z = -38; z <= 38; z += 0.6) {
        trackLines.push(trackX - 1.25, topY + 0.04, z, trackX + 1.25, topY + 0.04, z);
      }
    }
    this.drawLineSegments(trackLines, [0.75, 0.78, 0.82, 1]);

    // 接触网立柱与导线
    for (const pole of scene.poles) {
      const m = mat4Compose([pole.position[0], pole.position[1] + pole.height / 2, pole.position[2]], [0, 0, 0]);
      this.drawCyl(m, 0.09, pole.height, [0.45, 0.48, 0.52]);
      const hang = wireHangPoint(scene, pole);
      this.drawBox(mat4Translation((pole.position[0] + hang[0]) / 2, pole.position[1] + pole.height, (pole.position[2] + hang[2]) / 2), [Math.abs(hang[0] - pole.position[0]) || 0.1, 0.08, 0.08], [0.45, 0.48, 0.52]);
    }
    const wireLines: number[] = [];
    for (const w of catenaryWires(scene)) {
      wireLines.push(...w.a, ...w.b);
    }
    this.drawLineSegments(wireLines, [0.9, 0.55, 0.2, 1]);
  }

  /** 起重机整机：严格按 forwardKinematics 的世界矩阵绘制各刚体节点 */
  drawCrane(
    model: CraneModel,
    placement: CranePlacement,
    joint: CraneJointState,
    frame?: FrameSnapshot['cranes'][number],
  ): void {
    const gl = this.gl;
    gl.useProgram(this.meshProg.program);
    const fk = forwardKinematics(model, placement, joint);
    const w = fk.world;

    // 底盘
    this.drawBox(w.chassis, [3.2, 1.4, 6.5], COLORS.crane);
    // 转台
    this.drawBox(w.slew, [2.6, 1.0, 3.0], [0.85, 0.5, 0.1]);
    // 臂根铰点支座
    this.drawBox(w.boomFoot, [0.9, 0.9, 0.9], [0.7, 0.42, 0.08]);

    // 各臂节（沿父级 +z 排列，长度取当前节长）
    fk.sectionLengths.forEach((len, i) => {
      const node = w[`section${i}`];
      const shade = 0.85 - i * 0.12;
      this.drawBox(mat4Multiply(node, mat4Translation(0, 0, len / 2)), [0.55 - i * 0.06, 0.55 - i * 0.06, len], [COLORS.crane[0] * shade, COLORS.crane[1] * shade, COLORS.crane[2] * shade]);
    });

    // 吊钩与钢丝绳
    this.drawSphere(w.hook, 0.35, [0.25, 0.25, 0.28]);
    const ropeLines = [fk.boomTipWorld[0], fk.boomTipWorld[1], fk.boomTipWorld[2], fk.hookWorld[0], fk.hookWorld[1], fk.hookWorld[2]];
    this.drawLineSegments(ropeLines, [0.2, 0.2, 0.22, 1]);

    // 四条支腿：横梁 + 垂直油缸 + 垫板，超载红色/接近黄色/正常绿色
    placement.outriggers.forEach((leg, i) => {
      const snap = frame?.outriggers[i];
      const beam = mat4Compose([leg.position[0], 0.9, leg.position[2]], [0, placement.headingDeg * DEG, 0]);
      this.drawBox(beam, [Math.abs(leg.position[0] - placement.position[0]) * 2 || 0.4, 0.25, 0.35], [0.6, 0.4, 0.1]);
      this.drawCyl(mat4Compose([leg.position[0], 0.5, leg.position[2]], [0, 0, 0]), 0.14, 1.0, [0.55, 0.55, 0.58]);
      // 垫木分层
      for (let k = 0; k <= leg.woodLayers; k++) {
        const s = model.padSize + k * model.padThickness * 2;
        this.drawBox(mat4Translation(leg.position[0], 0.05 + k * model.padThickness, leg.position[2]), [s, model.padThickness, s], k === 0 ? [0.3, 0.3, 0.33] : [0.55, 0.4, 0.22]);
      }
      if (snap?.overloaded) {
        this.drawSphere(mat4Translation(leg.position[0], 1.6, leg.position[2]), 0.28, COLORS.danger);
      }
    });
  }

  /** 脱轨车辆：车体 + 转向架 + 车钩 + 吊点标记 */
  drawCar(carModel: CarModel, car: DerailedCar, showLiftPoints = true, highlightLift?: string): void {
    const gl = this.gl;
    gl.useProgram(this.meshProg.program);
    const bodyM = mat4Multiply(carWorldMatrix(car), mat4Translation(...carModel.body.offset));
    const kindColor: Vec3 =
      carModel.kind === 'tank' ? [0.35, 0.6, 0.55] : carModel.kind === 'locomotive' ? [0.75, 0.3, 0.3] : carModel.kind === 'covered' ? [0.45, 0.55, 0.4] : COLORS.car;
    if (carModel.kind === 'tank') {
      this.drawCyl(mat4Multiply(bodyM, mat4RotationX(Math.PI / 2)), carModel.width * 0.45, carModel.length * 0.92, kindColor);
    } else {
      this.drawBox(bodyM, carModel.body.size, kindColor);
    }

    const bogieMatrix = (offset: Vec3) =>
      mat4Multiply(carWorldMatrix(car), mat4Translation(...offset));
    for (const b of carModel.bogies) {
      if (car.bogiesDetached) continue;
      this.drawBox(bogieMatrix(b.offset), b.size, [0.18, 0.18, 0.2]);
      // 轮对
      for (const dz of [-0.55, 0.55]) {
        const wheelM = mat4Multiply(bogieMatrix(b.offset), mat4Compose([0, -0.2, dz], [0, 0, Math.PI / 2]));
        this.drawCyl(wheelM, carModel.wheelDiameter / 2, 0.12, [0.12, 0.12, 0.14]);
        this.drawCyl(mat4Multiply(bogieMatrix(b.offset), mat4Compose([0, -0.2, dz], [0, 0, -Math.PI / 2])), carModel.wheelDiameter / 2, 0.12, [0.12, 0.12, 0.14]);
      }
    }
    for (const c of carModel.couplers) {
      this.drawBox(mat4Multiply(carWorldMatrix(car), mat4Translation(...c.offset)), c.size, [0.3, 0.3, 0.32]);
    }

    if (showLiftPoints) {
      for (const lp of carModel.liftPoints) {
        const wp = mat4TransformPoint(carWorldMatrix(car), lp.position);
        this.drawSphere(mat4Translation(...wp), lp.id === highlightLift ? 0.34 : 0.22, lp.id === highlightLift ? COLORS.warn : [0.95, 0.95, 0.95]);
      }
    }
  }

  /** 吊索：吊钩到各吊点 */
  drawSlings(hook: Vec3, points: Vec3[], interference: boolean): void {
    const lines: number[] = [];
    for (const p of points) lines.push(...hook, ...p);
    this.drawLineSegments(lines, interference ? [0.9, 0.18, 0.18, 1] : [0.9, 0.9, 0.85, 1]);
  }

  /** 标记线段（净空测量线等） */
  drawMark(a: Vec3, b: Vec3, color: [number, number, number, number]): void {
    this.drawLineSegments([...a, ...b], color);
  }

  /** 落轨对轨辅助：轮对与钢轨的偏差放大显示 */
  drawRailAlignment(car: DerailedCar, gauge: number, topY: number): void {
    const lines: number[] = [];
    for (const off of [-gauge / 2, gauge / 2]) {
      lines.push(car.position[0] + off, topY + 0.1, car.position[2] - 2, car.position[0] + off, topY + 0.1, car.position[2] + 2);
    }
    this.drawLineSegments(lines, [0.95, 0.4, 0.4, 1]);
  }

  end(): void {
    const gl = this.gl;
    gl.bindVertexArray(null);
  }
}

export { COLORS };
export function vecAdd(a: Vec3, b: Vec3): Vec3 {
  return add(a, b);
}
export function vecSub(a: Vec3, b: Vec3): Vec3 {
  return sub(a, b);
}
export function rotX(rad: number) {
  return mat4RotationX(rad);
}
export function rotZ(rad: number) {
  return mat4RotationZ(rad);
}
