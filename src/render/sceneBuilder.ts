// 场景装配: 把现场/车辆/起重机领域对象翻译成渲染节点。
// 起重机节点直接消费 computeKinematics() 的层级世界矩阵, 保证渲染与受力同一套变换。
import { mat4, multiply, fromTranslation, fromTRS, transformPoint, type Mat4 } from '../core/mat4';
import { nodeMatrix, Renderer, RenderNode } from './renderer';
import type {
  AccidentScene, CarType, CraneKinematics, CraneModel, CranePose, SiteParams, Vec3M,
} from '../core/types';
import { computeKinematics } from '../core/crane';

export const COLORS = {
  ground: [0.45, 0.5, 0.42] as [number, number, number],
  embank: [0.55, 0.48, 0.38] as [number, number, number],
  rail: [0.35, 0.36, 0.4] as [number, number, number],
  sleeper: [0.4, 0.32, 0.25] as [number, number, number],
  mast: [0.25, 0.28, 0.32] as [number, number, number],
  wire: [0.9, 0.75, 0.2] as [number, number, number],
  chassis: [0.85, 0.5, 0.1] as [number, number, number],
  turntable: [0.9, 0.55, 0.12] as [number, number, number],
  boom: [0.95, 0.7, 0.15] as [number, number, number],
  hook: [0.2, 0.2, 0.22] as [number, number, number],
  outrigger: [0.6, 0.62, 0.65] as [number, number, number],
  outriggerBad: [0.9, 0.15, 0.1] as [number, number, number],
  outriggerWarn: [0.95, 0.75, 0.1] as [number, number, number],
  body: [0.2, 0.45, 0.7] as [number, number, number],
  tank: [0.75, 0.3, 0.25] as [number, number, number],
  bogie: [0.25, 0.25, 0.28] as [number, number, number],
  sling: [0.15, 0.15, 0.15] as [number, number, number],
  block: [0.55, 0.4, 0.25] as [number, number, number],
};

export interface BuiltScene {
  nodes: RenderNode[];
  /** 车辆可拾取部件中心 (用于拖拽), key = pickId-1 */
  pickables: { center: Vec3M; half: Vec3M; ref: string }[];
}

function push(r: Renderer, list: RenderNode[], mesh: ReturnType<Renderer['box']>, world: Mat4, color: RenderNode['color'], pickId?: number): RenderNode {
  const node: RenderNode = { mesh, world, color, pickId };
  r.addNode(node);
  list.push(node);
  return node;
}

/** 现场: 路基面、两轨、枕木、接触网立柱与导线 */
export function buildSite(r: Renderer, site: SiteParams): RenderNode[] {
  const out: RenderNode[] = [];
  const L = 120;
  // 路堤台体 (简化为分层盒)
  const embH = Math.max(0.1, site.embankmentHeight);
  push(r, out, r.box(9, embH, L), nodeMatrix([0, -embH / 2, 0]), COLORS.embank);
  // 路肩/道床顶面
  push(r, out, r.box(4.2, 0.15, L), nodeMatrix([0, 0.02, 0]), COLORS.ground);

  // 钢轨
  const railZ = site.gauge / 2;
  for (const z of [-railZ, railZ]) {
    push(r, out, r.box(L, 0.12, 0.07), nodeMatrix([0, 0.18, z]), COLORS.rail);
  }
  // 枕木, 间距 0.6m
  for (let x = -L / 2; x <= L / 2; x += 0.6) {
    push(r, out, r.box(0.2, 0.1, 2.4), nodeMatrix([x, 0.1, 0]), COLORS.sleeper);
  }

  // 接触网立柱与导线
  const { masts, wireFrom, wireTo } = catenary(site);
  for (const m of masts) {
    push(r, out, r.cylinder(0.12, site.wireHeight + 0.5, 10), nodeMatrix([m[0], (site.wireHeight + 0.5) / 2, m[2]]), COLORS.mast);
    // 横臂
    push(r, out, r.box(Math.abs(site.mastOffset) - railZ + 0.5, 0.08, 0.08),
      nodeMatrix([(m[0] + railZ) / 2, site.wireHeight + 0.25, m[2]]), COLORS.mast);
  }
  const wireMesh = r.lines([wireFrom, wireTo]);
  push(r, out, wireMesh, mat4(), COLORS.wire);
  return out;
}

export function catenary(site: SiteParams) {
  const L = 120;
  const masts: Vec3M[] = [];
  for (let z = -L / 2; z <= L / 2 + 0.1; z += site.mastSpacing) {
    masts.push([site.mastOffset, 0, z]);
  }
  return {
    masts,
    wireFrom: [site.mastOffset, site.wireHeight, -L / 2] as Vec3M,
    wireTo: [site.mastOffset, site.wireHeight, L / 2] as Vec3M,
  };
}

/** 车辆: 车体/转向架/车钩独立部件, 各自可拾取编辑 */
export function buildCar(
  r: Renderer,
  car: CarType,
  position: Vec3M,
  rotation: Vec3M,
  pickBase: number,
): { nodes: RenderNode[]; pickables: BuiltScene['pickables'] } {
  const out: RenderNode[] = [];
  const pickables: BuiltScene['pickables'] = [];
  const carRoot = fromTRS(mat4(), position, { x: rotation[0], y: rotation[1], z: rotation[2] }, [1, 1, 1]);

  car.parts.forEach((part, i) => {
    let mesh: ReturnType<Renderer['box']>;
    if (car.bodyType === 'tank' && part.kind === 'body') {
      mesh = r.cylinder(car.tank!.radius, car.tank!.cylinderLength, 20);
      // 罐体沿车长 X: 圆柱默认沿 Y, 绕 Z 转 90°
      const cylRot = multiply(mat4(), fromTRS(mat4(), part.origin, { x: 0, y: 0, z: Math.PI / 2 }, [1, 1, 1]), mat4());
      void cylRot;
    } else {
      mesh = r.box(part.halfSize[0] * 2, part.halfSize[1] * 2, part.halfSize[2] * 2);
    }
    const local = car.bodyType === 'tank' && part.kind === 'body'
      ? fromTRS(mat4(), part.origin, { x: 0, y: 0, z: Math.PI / 2 }, [1, 1, 1])
      : fromTranslation(mat4(), part.origin);
    const world = multiply(mat4(), carRoot, local);
    const color = part.kind === 'body'
      ? (car.bodyType === 'tank' ? COLORS.tank : COLORS.body)
      : part.kind === 'bogie' ? COLORS.bogie : COLORS.rail;
    const id = pickBase + i;
    push(r, out, mesh, world, color, id);
    const center = transformPoint(carRoot, part.cog) as Vec3M;
    pickables.push({ center, half: part.halfSize, ref: part.id });
  });
  return { nodes: out, pickables };
}

/**
 * 起重机: 严格按底盘→转台→臂根→主臂→伸缩节→臂尖→吊钩的父级链渲染,
 * 节点矩阵全部取自 computeKinematics, 不另算一套。
 */
export function buildCrane(
  r: Renderer,
  model: CraneModel,
  pose: CranePose,
  reactionStates?: { overloaded: boolean; lifted: boolean }[],
): { nodes: RenderNode[]; kinematics: CraneKinematics } {
  const out: RenderNode[] = [];
  const k = computeKinematics(model, pose);

  // 底盘
  push(r, out, r.box(5.4, 1.4, 7.6), k.nodes.chassis, COLORS.chassis);
  // 转台
  push(r, out, r.cylinder(1.6, 0.8, 18),
    multiply(mat4(), k.nodes.turntable, fromTranslation(mat4(), [0, 0.4, 0])), COLORS.turntable);
  // 配重
  push(r, out, r.box(1.2, 1.4, 1.6),
    multiply(mat4(), k.nodes.turntable, fromTranslation(mat4(), model.counterweightOffset)), COLORS.mast);

  // 主臂 (基本臂), 沿局部 X 的细长桁架盒
  const L = k.boomLength;
  push(r, out, r.box(model.baseBoomLength, 0.7, 0.8),
    multiply(mat4(), k.nodes.boom, fromTranslation(mat4(), [model.baseBoomLength / 2, 0, 0])), COLORS.boom);
  // 伸缩节: 嵌套在层级链中, 逐节变细
  for (let i = 0; i < model.sectionCount; i++) {
    const ext = (pose.sections[i] ?? 0) * model.sectionStroke;
    if (ext < 0.05) continue;
    const w = 0.62 - i * 0.08;
    push(r, out, r.box(model.sectionStroke + 0.4, w, w),
      multiply(mat4(), k.nodes[`section${i}`], fromTranslation(mat4(), [model.sectionStroke / 2, 0, 0])),
      COLORS.boom);
  }
  void L;

  // 吊钩
  push(r, out, r.box(0.5, 0.7, 0.5), k.nodes.hook, COLORS.hook);
  // 起升绳 (臂尖到吊钩)
  const tip = k.boomTip;
  const rope = r.lines([tip, k.hook]);
  push(r, out, rope, mat4(), COLORS.sling);

  // 四条支腿 + 垫木
  model.outriggers.forEach((spec, i) => {
    const state = pose.outriggers[i];
    if (!state?.deployed) return;
    const legWorld = multiply(mat4(), k.nodes.chassis, fromTranslation(mat4(), spec.position));
    const status = reactionStates?.[i];
    const color = status?.overloaded ? COLORS.outriggerBad
      : status?.lifted ? COLORS.outriggerWarn : COLORS.outrigger;
    push(r, out, r.box(0.35, 1.2, 0.35),
      multiply(mat4(), legWorld, fromTranslation(mat4(), [0, 0.6, 0])), color);
    push(r, out, r.box(spec.padSize, 0.12, spec.padSize),
      multiply(mat4(), legWorld, fromTranslation(mat4(), [0, 0.06, 0])), color);
    // 垫木层
    for (let b = 0; b < state.blocks; b++) {
      const side = spec.padSize + 0.2 * (b + 1);
      push(r, out, r.box(side, 0.08, side),
        multiply(mat4(), legWorld, fromTranslation(mat4(), [0, -0.04 - b * 0.08, 0])), COLORS.block);
    }
  });

  return { nodes: out, kinematics: k };
}

/** 吊索: 吊钩到各吊点的线段 */
export function buildSlings(r: Renderer, hook: Vec3M, points: Vec3M[]): RenderNode[] {
  const out: RenderNode[] = [];
  for (const p of points) {
    const mesh = r.lines([hook, p]);
    const node = r.addNode({ mesh, world: mat4(), color: COLORS.sling });
    out.push(node);
  }
  return out;
}

export function buildFullScene(
  r: Renderer,
  scene: AccidentScene,
  site: SiteParams,
  cars: CarType[],
  craneModel: CraneModel,
  cranePose: CranePose,
  reactions?: { overloaded: boolean; lifted: boolean }[],
): BuiltScene {
  r.clearNodes();
  buildSite(r, site);
  const pickables: BuiltScene['pickables'] = [];
  scene.cars.forEach((dc, idx) => {
    const car = cars.find((c) => c.id === dc.carTypeId);
    if (!car) return;
    const built = buildCar(r, car, dc.position, dc.rotation, idx * 10 + 1);
    pickables.push(...built.pickables);
  });
  buildCrane(r, craneModel, cranePose, reactions);
  return { nodes: [], pickables };
}
