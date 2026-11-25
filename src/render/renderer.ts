// 原生 WebGL2 渲染器 (无任何第三方引擎): 着色器、网格、场景节点、轨道相机、射线拾取。
import { Mat4, mat4, perspective, lookAt, multiply, invertRigid, transformPoint, fromTRS } from '../core/mat4';
import { clamp, type V3 } from '../core/geometry';

export interface RenderNode {
  mesh: Mesh;
  /** 每帧更新的世界矩阵 */
  world: Mat4;
  color: [number, number, number];
  /** 可选拾取 id (>=0 时写入拾取缓冲) */
  pickId?: number;
  hidden?: boolean;
  /** 线框模式 */
  wireframe?: boolean;
}

export interface Mesh {
  vao: WebGLVertexArrayObject;
  vertexCount: number;
  mode: number;
}

const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uViewProj * world;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
uniform vec3 uColor;
uniform vec3 uLightDir;
uniform float uAlpha;
uniform int uPick;
uniform int uPicking;
out vec4 frag;
void main() {
  if (uPicking == 1) {
    frag = vec4(float((uPick >>  0) & 255) / 255.0,
                float((uPick >>  8) & 255) / 255.0,
                float((uPick >> 16) & 255) / 255.0, 1.0);
    return;
  }
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(-uLightDir)), 0.0);
  vec3 base = uColor * (0.35 + 0.65 * diff);
  frag = vec4(base, uAlpha);
}`;

export class Renderer {
  gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private uViewProj: WebGLUniformLocation | null = null;
  private uModel: WebGLUniformLocation | null = null;
  private uColor: WebGLUniformLocation | null = null;
  private uLight: WebGLUniformLocation | null = null;
  private uAlpha: WebGLUniformLocation | null = null;
  private uPick: WebGLUniformLocation | null = null;
  private uPicking: WebGLUniformLocation | null = null;
  private nodes: RenderNode[] = [];
  private pickFramebuffer: WebGLFramebuffer | null = null;
  private pickTexture: WebGLTexture | null = null;
  private pickW = 0;
  private pickH = 0;
  viewProj: Mat4 = mat4();

  camera = {
    target: [0, 2, 0] as V3,
    distance: 28,
    azimuth: Math.PI * 0.25,
    elevation: Math.PI * 0.28,
  };

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.program = this.link(VERT, FRAG);
    gl.useProgram(this.program);
    this.uViewProj = gl.getUniformLocation(this.program, 'uViewProj')!;
    this.uModel = gl.getUniformLocation(this.program, 'uModel')!;
    this.uColor = gl.getUniformLocation(this.program, 'uColor')!;
    this.uLight = gl.getUniformLocation(this.program, 'uLightDir')!;
    this.uAlpha = gl.getUniformLocation(this.program, 'uAlpha')!;
    this.uPick = gl.getUniformLocation(this.program, 'uPick')!;
    this.uPicking = gl.getUniformLocation(this.program, 'uPicking')!;
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.78, 0.83, 0.87, 1);
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
      }
      return sh;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
    }
    return p;
  }

  private makeMesh(positions: Float32Array, normals: Float32Array, indices: Uint16Array, mode: number): Mesh {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = (data: Float32Array, loc: number) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    };
    buf(positions, 0);
    buf(normals, 1);
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, vertexCount: indices.length, mode };
  }

  box(w: number, h: number, d: number): Mesh {
    const x = w / 2, y = h / 2, z = d / 2;
    const p: number[] = [];
    const n: number[] = [];
    const face = (pts: V3[], normal: V3) => {
      pts.forEach((q) => { p.push(...q); n.push(...normal); });
    };
    face([[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]], [0, 0, 1]);
    face([[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]], [0, 0, -1]);
    face([[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]], [1, 0, 0]);
    face([[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]], [-1, 0, 0]);
    face([[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]], [0, 1, 0]);
    face([[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]], [0, -1, 0]);
    const idx: number[] = [];
    for (let f = 0; f < 6; f++) {
      const b = f * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    return this.makeMesh(new Float32Array(p), new Float32Array(n), new Uint16Array(idx), this.gl.TRIANGLES);
  }

  cylinder(r: number, h: number, segments = 16): Mesh {
    const p: number[] = [], n: number[] = [], idx: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const cx = Math.cos(a), cz = Math.sin(a);
      p.push(cx * r, -h / 2, cz * r); n.push(cx, 0, cz);
      p.push(cx * r, h / 2, cz * r); n.push(cx, 0, cz);
    }
    for (let i = 0; i < segments; i++) {
      const b = i * 2;
      idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
    }
    // 上下盖
    const topCenter = p.length / 3; p.push(0, h / 2, 0); n.push(0, 1, 0);
    const botCenter = p.length / 3; p.push(0, -h / 2, 0); n.push(0, -1, 0);
    for (let i = 0; i < segments; i++) {
      const b = i * 2;
      idx.push(topCenter, b + 3, b + 5);
      idx.push(botCenter, b + 4, b + 2);
    }
    return this.makeMesh(new Float32Array(p), new Float32Array(n), new Uint16Array(idx), this.gl.TRIANGLES);
  }

  /** 线段网格: 每两个顶点一条线 */
  lines(points: V3[]): Mesh {
    const p: number[] = [];
    const n: number[] = [];
    points.forEach((q) => { p.push(...q); n.push(0, 1, 0); });
    const idx = points.map((_, i) => i);
    return this.makeMesh(new Float32Array(p), new Float32Array(n), new Uint16Array(idx), this.gl.LINES);
  }

  addNode(node: RenderNode): RenderNode {
    this.nodes.push(node);
    return node;
  }

  clearNodes(): void {
    this.nodes = [];
  }

  eye(): V3 {
    const { distance, azimuth, elevation, target } = this.camera;
    const ce = Math.cos(elevation);
    return [
      target[0] + distance * ce * Math.cos(azimuth),
      target[1] + distance * Math.sin(elevation),
      target[2] + distance * ce * Math.sin(azimuth),
    ];
  }

  /** 屏幕坐标 -> 世界射线 (用于拖拽拾取) */
  screenRay(clientX: number, clientY: number): { origin: V3; dir: V3 } {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const eye = this.eye();
    const inv = invertRigid(mat4(), this.viewProj);
    const near = transformPoint(inv, [nx, ny, -1]) as V3;
    const far = transformPoint(inv, [nx, ny, 1]) as V3;
    const dx = far[0] - near[0], dy = far[1] - near[1], dz = far[2] - near[2];
    const l = Math.hypot(dx, dy, dz);
    return { origin: eye, dir: [dx / l, dy / l, dz / l] };
  }

  /** 射线与 AABB 求交, 返回最近距离 */
  rayAABB(origin: V3, dir: V3, center: V3, half: V3): number | null {
    let tmin = -Infinity, tmax = Infinity;
    for (let i = 0; i < 3; i++) {
      const lo = center[i] - half[i], hi = center[i] + half[i];
      if (Math.abs(dir[i]) < 1e-9) {
        if (origin[i] < lo || origin[i] > hi) return null;
      } else {
        let t1 = (lo - origin[i]) / dir[i];
        let t2 = (hi - origin[i]) / dir[i];
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmin > 0 ? tmin : tmax > 0 ? 0 : null;
  }

  private ensurePickTarget(w: number, h: number): void {
    const gl = this.gl;
    if (this.pickFramebuffer && this.pickW === w && this.pickH === h) return;
    this.pickW = w; this.pickH = h;
    if (this.pickFramebuffer) gl.deleteFramebuffer(this.pickFramebuffer);
    if (this.pickTexture) gl.deleteTexture(this.pickTexture);
    this.pickFramebuffer = gl.createFramebuffer();
    this.pickTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.pickTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTexture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** 拾取屏幕点下的节点 pickId, 无命中返回 -1 */
  pick(clientX: number, clientY: number): number {
    const gl = this.gl;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width)), h = Math.max(1, Math.floor(rect.height));
    this.ensurePickTarget(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFramebuffer);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.draw(true);
    const px = clamp(Math.floor(clientX - rect.left), 0, w - 1);
    const py = clamp(h - 1 - Math.floor(clientY - rect.top), 0, h - 1);
    const pxArr = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pxArr);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.resize();
    const id = pxArr[0] | (pxArr[1] << 8) | (pxArr[2] << 16);
    return id === 0xffffff ? -1 : id - 1;
  }

  private draw(picking: boolean): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uViewProj, false, this.viewProj);
    gl.uniform3f(this.uLight, 0.4, -0.8, 0.35);
    gl.uniform1i(this.uPicking, picking ? 1 : 0);
    for (const node of this.nodes) {
      if (node.hidden) continue;
      if (picking && node.pickId === undefined) continue;
      gl.bindVertexArray(node.mesh.vao);
      gl.uniformMatrix4fv(this.uModel, false, node.world);
      if (picking) {
        gl.uniform1i(this.uPick, (node.pickId ?? -1) + 1);
        gl.uniform3f(this.uColor, 1, 1, 1);
        gl.uniform1f(this.uAlpha, 1);
      } else {
        gl.uniform3f(this.uColor, ...node.color);
        gl.uniform1f(this.uAlpha, 1);
      }
      if (node.wireframe) gl.polygonOffset(1, 1);
      gl.drawElements(node.mesh.mode, node.mesh.vertexCount, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  render(): void {
    const gl = this.gl;
    this.resize();
    const aspect = this.canvas.width / this.canvas.height;
    const proj = perspective(mat4(), Math.PI / 4, aspect, 0.1, 500);
    const view = lookAt(mat4(), this.eye(), this.camera.target, [0, 1, 0]);
    this.viewProj = multiply(mat4(), proj, view);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.draw(false);
  }
}

/** 便捷构造: 平移+欧拉旋转的节点世界矩阵 */
export function nodeMatrix(pos: V3, rot?: V3, scale: V3 = [1, 1, 1]): Mat4 {
  return fromTRS(mat4(), pos, { x: rot?.[0] ?? 0, y: rot?.[1] ?? 0, z: rot?.[2] ?? 0 }, scale);
}
