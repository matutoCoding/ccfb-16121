export interface Mesh {
  vao: WebGLVertexArrayObject;
  vertexCount: number;
}

export interface LineMesh {
  vao: WebGLVertexArrayObject;
  vertexCount: number;
}

/** 生成立方体网格（单位尺寸，局部中心在原点） */
export function boxMesh(gl: WebGL2RenderingContext): Mesh {
  // 24 个顶点（每面独立顶点以获得正确法线），36 个索引
  const p: number[] = [];
  const n: number[] = [];
  const idx: number[] = [];
  const faces: { normal: [number, number, number]; corners: [number, number, number][] }[] = [
    { normal: [1, 0, 0], corners: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
    { normal: [-1, 0, 0], corners: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
    { normal: [0, 1, 0], corners: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
    { normal: [0, -1, 0], corners: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]] },
    { normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { normal: [0, 0, -1], corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  ];
  let base = 0;
  for (const f of faces) {
    for (const c of f.corners) {
      p.push(c[0] * 0.5, c[1] * 0.5, c[2] * 0.5);
      n.push(...f.normal);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    base += 4;
  }
  return buildIndexed(gl, p, n, idx);
}

/** 圆柱体（沿 +z 轴，用于臂节、吊索、立柱的简化） */
export function cylinderMesh(gl: WebGL2RenderingContext, segments = 12): Mesh {
  const p: number[] = [];
  const n: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a), y = Math.sin(a);
    p.push(x * 0.5, y * 0.5, 0, x * 0.5, y * 0.5, 1);
    n.push(x, y, 0, x, y, 0);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, c, d, b);
  }
  return buildIndexed(gl, p, n, idx);
}

/** 球体（低面数，用于吊钩/标记点） */
export function sphereMesh(gl: WebGL2RenderingContext, lat = 8, lon = 12): Mesh {
  const p: number[] = [];
  const n: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= lat; i++) {
    const theta = (i / lat) * Math.PI;
    for (let j = 0; j <= lon; j++) {
      const phi = (j / lon) * Math.PI * 2;
      const x = Math.sin(theta) * Math.cos(phi);
      const y = Math.cos(theta);
      const z = Math.sin(theta) * Math.sin(phi);
      p.push(x * 0.5, y * 0.5, z * 0.5);
      n.push(x, y, z);
    }
  }
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      const a = i * (lon + 1) + j;
      const b = a + lon + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return buildIndexed(gl, p, n, idx);
}

function buildIndexed(gl: WebGL2RenderingContext, positions: number[], normals: number[], indices: number[]): Mesh {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const nrmBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

  gl.bindVertexArray(null);
  return { vao, vertexCount: indices.length };
}

/** 线段批量网格（位置两两成对） */
export function buildLines(gl: WebGL2RenderingContext, positions: number[]): LineMesh {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, vertexCount: positions.length / 3 };
}

/** 地面网格线（以原点为中心的方格） */
export function groundGrid(gl: WebGL2RenderingContext, extent: number, step: number, y = 0): LineMesh {
  const p: number[] = [];
  for (let v = -extent; v <= extent; v += step) {
    p.push(v, y, -extent, v, y, extent);
    p.push(-extent, y, v, extent, y, v);
  }
  return buildLines(gl, p);
}
