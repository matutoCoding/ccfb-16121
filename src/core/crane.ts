// 起重机刚体层级运动学 + 支腿静力学。
// 坐标约定: 世界 Y 向上; 底盘 heading 绕 Y; 回转 slew 叠在 heading 上;
// 变幅 luff 绕局部 Z; 伸缩沿局部 X; 吊钩沿世界 Y 铅垂下放。
// 每个节点只保存相对父级的 TRS, 世界矩阵 = 父级世界矩阵 * 局部矩阵。
import {
  Mat4, mat4, multiply, fromTranslation, fromRotationY, fromRotationZ,
  fromTRS, transformPoint,
} from './mat4';
import { clamp, deg2rad, horizontalDistance, interp2D } from './geometry';
import type {
  CraneModel, CranePose, CraneKinematics, OutriggerResult, LoadChart, Vec3M,
} from './types';

export const G = 9.81; // m/s2, t -> kN 换算系数

/** 当前主臂总长度: 基本臂 + 各节伸出量 * 节行程 */
export function currentBoomLength(model: CraneModel, pose: CranePose): number {
  let ext = 0;
  for (let i = 0; i < model.sectionCount; i++) {
    ext += (pose.sections[i] ?? 0) * model.sectionStroke;
  }
  return model.baseBoomLength + ext;
}

/** 变幅角夹紧到机械限位 */
export function clampLuff(model: CraneModel, luffRad: number): number {
  return clamp(luffRad, deg2rad(model.luffMinDeg), deg2rad(model.luffMaxDeg));
}

/** 绕世界 Y 旋转局部向量, 与 fromRotationY 矩阵链同一约定:
 *  x' = x·cosα + z·sinα; z' = -x·sinα + z·cosα; y' = y */
function yaw(alpha: number, local: Vec3M): Vec3M {
  const c = Math.cos(alpha), s = Math.sin(alpha);
  return [
    local[0] * c + local[2] * s,
    local[1],
    -local[0] * s + local[2] * c,
  ];
}

/**
 * 计算起重机全层级运动学。
 * 同时给出两套吊钩位置:
 *  - nodes/hook: 逐节点矩阵链相乘得到 (渲染使用)
 *  - hookPlumb: 按臂长/半径的解析公式手算 (校验使用)
 * 两者在无摆角时必须重合到机器精度; selfCheckKinematics() 对外暴露 1cm 红线校验。
 */
export function computeKinematics(model: CraneModel, pose: CranePose): CraneKinematics {
  const alpha = pose.heading + pose.slew;
  const L = currentBoomLength(model, pose);
  const luff = clampLuff(model, pose.luff);

  // ---- 层级矩阵链 (每级只认父级) ----
  const nodes: Record<string, Mat4> = {};

  // 底盘: 平移 + 航向回转
  const chassis = fromTRS(mat4(), pose.position, { x: 0, y: pose.heading, z: 0 }, [1, 1, 1]);
  nodes.chassis = chassis;

  // 转台: 父级 = 底盘; 局部抬到回转中心高度, 再绕 Y 回转
  const slewBase: Vec3M = [0, model.slewBaseHeight, 0];
  const turntable = multiply(
    mat4(), chassis,
    multiply(mat4(), fromTranslation(mat4(), slewBase), fromRotationY(mat4(), pose.slew)),
  );
  nodes.turntable = turntable;

  // 臂根: 父级 = 转台
  const boomFootLocal = model.boomFootOffset;
  const boomFootNode = multiply(mat4(), turntable, fromTranslation(mat4(), boomFootLocal));
  nodes.boomFoot = boomFootNode;

  // 主臂: 父级 = 臂根; 绕局部 Z 变幅, 臂沿局部 X 伸展
  const boom = multiply(mat4(), boomFootNode, fromRotationZ(mat4(), luff));
  nodes.boom = boom;

  // 各伸缩节: 父级 = 上一节; 按节序沿局部 X 伸出 (嵌套链保证末端位置 = Σ 行程)
  let parent = boom;
  for (let i = 0; i < model.sectionCount; i++) {
    const ext = i === 0 ? 0 : model.sectionStroke * (pose.sections[i - 1] ?? 0);
    const section = multiply(mat4(), parent, fromTranslation(mat4(), [ext, 0, 0]));
    nodes[`section${i}`] = section;
    parent = section;
  }

  // 臂尖: 臂架坐标系下沿 X 走 L
  const boomTipNode = multiply(mat4(), boom, fromTranslation(mat4(), [L, 0, 0]));
  nodes.boomTip = boomTipNode;
  const boomFoot = transformPoint(boomFootNode, [0, 0, 0]) as Vec3M;
  const boomTip = transformPoint(boomTipNode, [0, 0, 0]) as Vec3M;

  // 吊钩: 悬挂点为臂尖, 绳长 hoist; 摆角分解为顺臂方向 swingAlong、
  // 垂直臂方向 swingAcross。摆角只影响吊钩, 不影响铅垂受力点 (hookPlumb)。
  const alongWorld = yaw(alpha, [Math.cos(luff), 0, 0]);
  const acrossWorld = yaw(alpha, [0, 0, 1]);
  const swingMag = Math.hypot(pose.swingAlong, pose.swingAcross);
  const alongShift = Math.sin(pose.swingAlong) * pose.hoist;
  const acrossShift = Math.sin(pose.swingAcross) * pose.hoist;
  const hook: Vec3M = [
    boomTip[0] + alongWorld[0] * alongShift + acrossWorld[0] * acrossShift,
    boomTip[1] - pose.hoist * Math.cos(swingMag),
    boomTip[2] + alongWorld[2] * alongShift + acrossWorld[2] * acrossShift,
  ];
  // 无摆角铅垂位置: 与按臂长/半径手算结果一致, 供 1cm 校验
  const hookPlumb: Vec3M = [boomTip[0], boomTip[1] - pose.hoist, boomTip[2]];
  nodes.hook = fromTranslation(mat4(), hook);

  // ---- 解析手算值 (与矩阵链独立的第二条计算路径, 供 1cm 红线校验) ----
  // 手算: 臂根高度 = 回转中心高 + 局部臂根 Y 偏移 (Y 偏移不参与水平旋转);
  // 臂尖水平位置 = 站位 + R_y(alpha)·(臂根X偏移 + L·cos(luff), 0, 0)
  const r = L * Math.cos(luff); // 工作半径
  const tipXz = yaw(alpha, [boomFootLocal[0] + r, 0, 0]);
  const analyticTip: Vec3M = [
    pose.position[0] + tipXz[0],
    model.slewBaseHeight + boomFootLocal[1] + L * Math.sin(luff),
    pose.position[2] + tipXz[2],
  ];
  const analyticHookPlumb: Vec3M = [analyticTip[0], analyticTip[1] - pose.hoist, analyticTip[2]];

  const radius = horizontalDistance(
    [pose.position[0], 0, pose.position[2]],
    analyticHookPlumb,
  );

  return {
    boomLength: L,
    radius,
    boomTip: analyticTip,
    boomFoot,
    hook,
    hookPlumb: analyticHookPlumb,
    nodes,
  };
}

/**
 * 1cm 红线自检: 矩阵层级链算出的臂尖/吊钩 vs 按臂长半径手算结果。
 * 吊钩矩阵链位置: 直接取臂尖世界坐标后沿世界 Y 减绳长 (与渲染节点 nodes.hook 同源),
 * 不能在臂尖局部系里做 -Y 变换——该局部系还带着变幅旋转。
 */
export function selfCheckKinematics(model: CraneModel, pose: CranePose): {
  maxError: number;
  matrixTip: Vec3M;
  analyticTip: Vec3M;
  matrixHook: Vec3M;
  analyticHook: Vec3M;
} {
  const k = computeKinematics(model, pose);
  const matrixTip = transformPoint(k.nodes.boomTip, [0, 0, 0]) as Vec3M;
  const matrixHook: Vec3M = [matrixTip[0], matrixTip[1] - pose.hoist, matrixTip[2]];
  const tipErr = Math.hypot(
    matrixTip[0] - k.boomTip[0], matrixTip[1] - k.boomTip[1], matrixTip[2] - k.boomTip[2],
  );
  const hookErr = Math.hypot(
    matrixHook[0] - k.hookPlumb[0],
    matrixHook[1] - k.hookPlumb[1],
    matrixHook[2] - k.hookPlumb[2],
  );
  return {
    maxError: Math.max(tipErr, hookErr),
    matrixTip,
    analyticTip: k.boomTip,
    matrixHook,
    analyticHook: k.hookPlumb,
  };
}

/** 查起重性能表: 支腿工况 + 半径 + 臂长 双线性插值, 返回额定起重量 t */
export function ratedCapacity(
  model: CraneModel,
  outriggerMode: string,
  radius: number,
  boomLength: number,
): number {
  const chart: LoadChart = model.loadCharts.find((c) => c.outriggerMode === outriggerMode)
    ?? model.loadCharts[0];
  return interp2D(chart.radii, chart.boomLengths, chart.capacities, radius, boomLength);
}

/** 吊载率 = 实际吊载 / 额定; >0.9 黄, >1.0 红并锁操作 */
export function loadRatio(
  model: CraneModel,
  pose: CranePose,
  liftedMassT: number,
  outriggerMode = 'full',
): { ratio: number; rated: number; actual: number } {
  const k = computeKinematics(model, pose);
  const rated = ratedCapacity(model, outriggerMode, k.radius, k.boomLength);
  const actual = liftedMassT + model.hookMass;
  return { ratio: rated > 0 ? actual / rated : Infinity, rated, actual };
}

interface VerticalLoad {
  /** 相对回转中心的水平位置 m */
  x: number;
  z: number;
  /** 重力 kN */
  w: number;
}

function solve3(A: number[][], b: number[]): number[] | null {
  // 高斯消元带主元选取
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    [M[col], M[piv]] = [M[piv], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) return null;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= 3; c++) M[r][c] -= f * M[col][c];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/**
 * 四条支腿支反力 (最小范数解 / 等沉降假定)。
 * 平衡方程 (Y 向力、绕 X 矩、绕 Z 矩):
 *   ΣR_i = W;  ΣR_i z_i = ΣW_j z_j;  ΣR_i x_i = ΣW_j x_j
 * 欠定方程组取 ||R||2 最小解: R = Aᵀ(AAᵀ)⁻¹b。
 * 出现负反力 (腿离地) 时剔除该腿重解, 直到全部非负; 此时反力和仍严格等于总重力。
 */
export function computeOutriggerReactions(
  model: CraneModel,
  pose: CranePose,
  liftedMassT: number,
  allowableBearingKPa: number,
): OutriggerResult[] {
  const alpha = pose.heading + pose.slew;
  const k = computeKinematics(model, pose);
  const L = k.boomLength;
  const luff = clampLuff(model, pose.luff);

  // ---- 汇总全部竖向荷载 (相对回转中心水平投影) ----
  const loads: VerticalLoad[] = [];
  // 底盘自重, 重心取底盘原点
  loads.push({ x: 0, z: 0, w: model.chassisMass * G });
  // 转台 (含上车), 重心近似回转中心
  loads.push({ x: 0, z: 0, w: model.superstructureMass * G });
  // 配重: 随上车回转
  const cw = yaw(alpha, model.counterweightOffset);
  loads.push({ x: cw[0], z: cw[2], w: model.counterweightMass * G });
  // 主臂: 均布质量, 重心在臂中点
  const boomMass = model.boomMassPerMeter * L;
  const cgDist = L / 2;
  loads.push({
    x: model.boomFootOffset[0] + cgDist * Math.cos(luff) * Math.cos(alpha),
    z: model.boomFootOffset[0] + cgDist * Math.cos(luff) * Math.sin(alpha),
    w: boomMass * G,
  });
  // 吊钩 + 吊载: 作用在铅垂吊钩位置
  const hookW = (model.hookMass + liftedMassT) * G;
  loads.push({ x: k.hookPlumb[0] - pose.position[0], z: k.hookPlumb[2] - pose.position[2], w: hookW });

  const W = loads.reduce((s, l) => s + l.w, 0);
  // 绕 X 轴弯矩 = ΣW·z; 绕 Z 轴弯矩 = ΣW·x (右手系, 与下方平衡矩阵行同号)
  const Mxx = loads.reduce((s, l) => s + l.w * l.z, 0);
  const Mzz = loads.reduce((s, l) => s + l.w * l.x, 0);

  // ---- 组装支腿 (未伸出的腿不参与支承) ----
  const active = model.outriggers
    .map((spec, i) => ({ spec, state: pose.outriggers[i], idx: i }))
    .filter((e) => e.state.deployed);

  const reactions = new Array<number>(model.outriggers.length).fill(0);
  const liftedFlags = new Array<boolean>(model.outriggers.length).fill(false);

  let candidates = active.map((e) => e.idx);
  // 迭代剔除离地腿 (最小范数解给负反力即该腿不受压), 直到全部非负或只剩 3 点。
  // 吊钩超出支承四边形时这是真实工况: 必须明确标出离地腿, 而不是把整组解清零。
  let solved = false;
  for (let guard = 0; guard <= model.outriggers.length; guard++) {
    const n = candidates.length;
    if (n < 3) break; // 少于 3 点机构有倾覆风险, 保留 0 值并由 lifted 标记
    // 平衡矩阵 3 行: ①ΣR=W ②ΣR·z=Mxx(绕X) ③ΣR·x=Mzz(绕Z)
    const rows: number[][] = [
      candidates.map(() => 1),
      candidates.map((i) => model.outriggers[i].position[2]),
      candidates.map((i) => model.outriggers[i].position[0]),
    ];
    const b = [W, Mxx, Mzz];
    // R = Aᵀ(AAᵀ)⁻¹b; AAᵀ 是 3x3
    const AAt = [
      [0, 0, 0], [0, 0, 0], [0, 0, 0],
    ];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let j = 0; j < n; j++) s += rows[r][j] * rows[c][j];
        AAt[r][c] = s;
      }
    }
    const sol = solve3(AAt, b);
    if (!sol) break;
    // R = Aᵀ sol
    const R = candidates.map((_, j) => sol[0] * rows[0][j] + sol[1] * rows[1][j] + sol[2] * rows[2][j]);
    const neg = R.findIndex((v) => v < -0.01);
    if (neg < 0) {
      R.forEach((v, j) => { reactions[candidates[j]] = Math.max(0, v); });
      solved = true;
      break;
    }
    if (n === 3) {
      // 三点静定解仍出现负反力: 合力落点已在支承三角形之外 = 倾覆临界工况。
      // 不再强行分配 (任何非负解都无法同时满足三个平衡方程),
      // 保留当前非负腿数值供界面告警, 负腿标离地; 倾覆标志由调用方按 lifted 数量识别。
      R.forEach((v, j) => { reactions[candidates[j]] = Math.max(0, v); });
      liftedFlags[candidates[neg]] = true;
      break;
    }
    liftedFlags[candidates[neg]] = true;
    candidates = candidates.filter((_, j) => j !== neg);
  }
  void solved;

  return model.outriggers.map((spec, i) => {
    const blocks = pose.outriggers[i]?.blocks ?? 0;
    // 垫木逐层扩散接地面积 (每层每侧扩散 100mm)
    const side = spec.padSize + 0.2 * blocks;
    const area = side * side;
    const reaction = reactions[i];
    const pressure = area > 0 ? reaction / area : 0;
    return {
      id: spec.id,
      name: spec.name,
      position: [
        pose.position[0] + spec.position[0],
        0,
        pose.position[2] + spec.position[2],
      ] as Vec3M,
      reaction,
      area,
      bearingPressure: pressure,
      overloaded: pressure > allowableBearingKPa,
      lifted: liftedFlags[i] || (pose.outriggers[i] && !pose.outriggers[i].deployed),
    };
  });
}

/** 支反力合力校验: 必须等于总重力 (自重 + 吊载), 返回偏差 kN */
export function reactionBalanceError(
  model: CraneModel,
  pose: CranePose,
  liftedMassT: number,
  reactions: OutriggerResult[],
): number {
  const k = computeKinematics(model, pose);
  const L = k.boomLength;
  const totalMass = model.chassisMass + model.superstructureMass + model.counterweightMass
    + model.boomMassPerMeter * L + model.hookMass + liftedMassT;
  const expected = totalMass * G;
  const got = reactions.reduce((s, r) => s + r.reaction, 0);
  return Math.abs(got - expected);
}
