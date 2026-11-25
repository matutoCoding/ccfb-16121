export function createGl(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) throw new Error('当前浏览器不支持 WebGL2');
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.clearColor(0.09, 0.11, 0.14, 1);
  return gl;
}

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uProj * uView * world;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
uniform vec3 uColor;
uniform vec3 uLightDir;
uniform float uAlpha;
uniform vec3 uCamPos;
out vec4 frag;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(uLightDir)), 0.0);
  float ambient = 0.35;
  // 距离雾，增强纵深
  float fog = clamp(distance(vWorld, uCamPos) / 90.0, 0.0, 0.55);
  vec3 base = uColor * (ambient + 0.75 * diff);
  vec3 fogged = mix(base, vec3(0.09, 0.11, 0.14), fog);
  frag = vec4(fogged, uAlpha);
}`;

const LINE_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uView;
uniform mat4 uProj;
void main() { gl_Position = uProj * uView * vec4(aPos, 1.0); }`;

const LINE_FRAG = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 frag;
void main() { frag = uColor; }`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader 编译失败: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('program 链接失败: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

export interface ShaderProgram {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

export function createMeshProgram(gl: WebGL2RenderingContext): ShaderProgram {
  const programObj = program(gl, VERT, FRAG);
  const names = ['uModel', 'uView', 'uProj', 'uColor', 'uLightDir', 'uAlpha', 'uCamPos'];
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (const n of names) uniforms[n] = gl.getUniformLocation(programObj, n);
  return { program: programObj, uniforms };
}

export function createLineProgram(gl: WebGL2RenderingContext): ShaderProgram {
  const programObj = program(gl, LINE_VERT, LINE_FRAG);
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (const n of ['uView', 'uProj', 'uColor']) uniforms[n] = gl.getUniformLocation(programObj, n);
  return { program: programObj, uniforms };
}
