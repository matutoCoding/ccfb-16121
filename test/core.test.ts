import { describe, expect, it } from 'vitest';
import {
  analyticBoomTip,
  boomLengthOf,
  defaultJointState,
  extArray,
  forwardKinematics,
  luffFromRadius,
  radiusFromLuff,
  ratedCapacity,
} from '../src/dynamics/crane';
import type { CraneModel, CranePlacement } from '../src/types';
import { outriggerReactions } from '../src/dynamics/statics';
import { mat4Multiply, mat4RotationY, mat4Translation, mat4TransformPoint } from '../src/core/mat4';

const model: CraneModel = {
  id: 'crane-test',
  name: '测试160t',
  ratedCapacityT: 160,
  selfWeightT: 108,
  slewBaseHeight: 2.4,
  boomFoot: [0, 1.2, 1.6],
  boomSections: [
    { id: 's0', name: '基节', minLen: 13.5, maxLen: 13.5 },
    { id: 's1', name: '二节', minLen: 0, maxLen: 12 },
    { id: 's2', name: '三节', minLen: 0, maxLen: 10 },
  ],
  luffMinDeg: 20,
  luffMaxDeg: 80,
  hookBlockMassT: 2,
  outriggerBase: [
    [-4.4, 0, 3.6],
    [4.4, 0, 3.6],
    [-4.4, 0, -3.6],
    [4.4, 0, -3.6],
  ],
  padSize: 1.2,
  padThickness: 0.1,
  speedLimits: { slewDegPerSec: 1.5, luffDegPerSec: 1, hoistMPerSec: 0.5, extendMPerSec: 0.4 },
  loadCharts: [
    {
      state: 'full',
      label: '全伸',
      radii: [4, 6, 8, 10, 12, 16],
      boomLengths: [13.5, 25.5, 35.5],
      grid: [
        [160, 120, 90],
        [120, 105, 85],
        [95, 88, 78],
        [75, 72, 68],
        [60, 59, 56],
        [40, 42, 44],
      ],
    },
  ],
};

function placement(heading = 0): CranePlacement {
  return {
    id: 'p1',
    craneModelId: model.id,
    position: [0, 0, 0],
    headingDeg: heading,
    outriggers: model.outriggerBase.map((p, i) => ({ position: p, woodLayers: i % 2 })),
    chartState: 'full',
  };
}

describe('矩阵层级', () => {
  it('平移旋转复合与手算一致', () => {
    const m = mat4Multiply(mat4Translation(10, 0, 0), mat4RotationY(Math.PI / 2));
    const p = mat4TransformPoint(m, [0, 0, 5]);
    // Ry(90°) 把 +z 转到 +x，再叠加 x 向平移 10
    expect(p[0]).toBeCloseTo(15, 10);
    expect(p[2]).toBeCloseTo(0, 10);
  });
});

describe('起重机正运动学', () => {
  it('矩阵链路臂头与解析手算误差 < 1 厘米（多组姿态/航向）', () => {
    const headings = [0, 37, 125, 270];
    const slews = [-180, -45, 0, 60, 179];
    const luffs = [20, 45, 60, 80];
    const extRatios = [0, 0.5, 1];
    let maxErr = 0;
    for (const h of headings)
      for (const s of slews)
        for (const l of luffs)
          for (const er of extRatios) {
            const joint = { ...defaultJointState(), slewDeg: s, luffDeg: l, extensions: extArray(model, er) };
            const fk = forwardKinematics(model, placement(h), joint);
            const analytic = analyticBoomTip(model, placement(h), joint);
            const err = Math.hypot(
              fk.boomTipWorld[0] - analytic[0],
              fk.boomTipWorld[1] - analytic[1],
              fk.boomTipWorld[2] - analytic[2],
            );
            maxErr = Math.max(maxErr, err);
            expect(err).toBeLessThan(0.01);
          }
    // 留档：典型浮点级误差
    expect(maxErr).toBeLessThan(0.001);
  });

  it('工作半径 = 臂根水平偏移 + 臂长 × cos(变幅角)', () => {
    const joint = { ...defaultJointState(), luffDeg: 55, extensions: extArray(model, 0.7) };
    const fk = forwardKinematics(model, placement(), joint);
    expect(fk.boomLength).toBeCloseTo(boomLengthOf(model, joint.extensions), 9);
    // 臂根相对回转中心的水平偏移（与姿态无关的结构量）+ 臂投影
    const footHorizontal = Math.hypot(model.boomFoot[0], model.boomFoot[2]);
    const expected = footHorizontal + radiusFromLuff(fk.boomLength, 55);
    // 三角运算浮点误差在亚毫米级，远小于 1cm 工程要求
    expect(Math.abs(fk.radius - expected)).toBeLessThan(0.01);
    expect(fk.radius).toBeCloseTo(expected, 5);
  });

  it('吊钩位置与手算半径/臂长几何互验误差 < 1 厘米', () => {
    const joint = { ...defaultJointState(), slewDeg: 72, luffDeg: 48, extensions: extArray(model, 0.6), hookHeight: 4.5 };
    const fk = forwardKinematics(model, placement(15), joint);
    // 手算：吊钩与回转中心水平距离
    const handRadius = Math.hypot(
      fk.hookWorld[0] - fk.slewCenterWorld[0],
      fk.hookWorld[2] - fk.slewCenterWorld[2],
    );
    expect(Math.abs(handRadius - fk.radius)).toBeLessThan(0.01);
    // 臂头到吊钩竖直距离 = 绳长
    expect(fk.ropeLength).toBeCloseTo(fk.boomTipWorld[1] - 4.5, 9);
  });

  it('吊钩 xz 与臂头一致、高度等于指令值', () => {
    const joint = { ...defaultJointState(), slewDeg: 33, luffDeg: 40, hookHeight: 3.21, extensions: extArray(model, 0.4) };
    const fk = forwardKinematics(model, placement(20), joint);
    expect(fk.hookWorld[0]).toBeCloseTo(fk.boomTipWorld[0], 12);
    expect(fk.hookWorld[2]).toBeCloseTo(fk.boomTipWorld[2], 12);
    expect(fk.hookWorld[1]).toBeCloseTo(3.21, 12);
    expect(fk.ropeLength).toBeCloseTo(fk.boomTipWorld[1] - 3.21, 9);
  });

  it('反解变幅角与正解互逆', () => {
    const L = 25;
    for (const r of [5, 10, 18, 23]) {
      const a = luffFromRadius(L, r);
      expect(radiusFromLuff(L, a)).toBeCloseTo(r, 9);
    }
  });

  it('性能表双线性插值落在合理区间', () => {
    const c = ratedCapacity(model, 'full', 9, 20);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(160);
    // 表点精确命中
    expect(ratedCapacity(model, 'full', 8, 13.5)).toBeCloseTo(95, 9);
  });
});

describe('支腿支反力', () => {
  it('四点反力之和恒等于自重+吊重（误差 < 1N），含拔腿工况', () => {
    for (const lifted of [0, 25, 60, 90]) {
      for (const ang of [0, 45, 90, 180, 270]) {
        const joint = { ...defaultJointState(), slewDeg: ang, luffDeg: 50, extensions: extArray(model, 0.5) };
        const fk = forwardKinematics(model, placement(), joint);
        const off: [number, number, number] = [
          fk.hookWorld[0] - fk.slewCenterWorld[0],
          0,
          fk.hookWorld[2] - fk.slewCenterWorld[2],
        ];
        const r = outriggerReactions(model, placement(), lifted + model.hookBlockMassT, off);
        // 无论是否拔腿，着地腿反力之和必须严格等于总竖向力
        expect(r.balanceErrorKN).toBeLessThan(1e-6);
        expect(r.sumKN).toBeCloseTo(r.expectedKN, 9);
        expect(r.expectedKN).toBeCloseTo((model.selfWeightT + lifted + model.hookBlockMassT) * 9.81, 9);
        r.forces.forEach((f) => expect(f.reactionKN).toBeGreaterThanOrEqual(-1e-9));
      }
    }
  });

  it('压力中心在支腿矩形内时，四个支腿全部受压且弯矩严格平衡', () => {
    const r = outriggerReactions(model, placement(), 40, [0, 0, 2]);
    expect(r.uplift).toBe(false);
    const mx = r.forces.reduce((s, f) => s + f.reactionKN * f.position[0], 0);
    const mz = r.forces.reduce((s, f) => s + f.reactionKN * f.position[2], 0);
    const totalMass = model.selfWeightT + 40;
    const pz = (40 / totalMass) * 2;
    expect(mz).toBeCloseTo(r.expectedKN * pz, 9);
    expect(mx).toBeCloseTo(0, 9);
  });

  it('吊重偏向一侧时该侧支腿反力增大', () => {
    const joint = { ...defaultJointState(), slewDeg: 0, luffDeg: 60, extensions: extArray(model, 0) };
    const fk = forwardKinematics(model, placement(), joint);
    const off: [number, number, number] = [0, 0, fk.hookWorld[2] - fk.slewCenterWorld[2]];
    const r = outriggerReactions(model, placement(), 50, off);
    // 0 度回转时臂朝 +z（前侧：支腿 0、1）
    expect(r.forces[0].reactionKN).toBeGreaterThan(r.forces[2].reactionKN);
    expect(r.forces[1].reactionKN).toBeGreaterThan(r.forces[3].reactionKN);
  });

  it('极端偏心出现拔腿时，着地腿反力之和仍等于总竖向力，反力点落在支腿边界', () => {
    // 合力作用点偏心 ez = 吊重比 × 输入偏心；取吊重 150t、偏心 8m
    // ez ≈ 150/260 × 8 ≈ 4.6m，超出支腿前沿 b=3.6m，后腿离地
    const r = outriggerReactions(model, placement(), 150, [0, 0, 8]);
    expect(r.uplift).toBe(true);
    expect(r.balanceErrorKN).toBeLessThan(1e-6);
    expect(r.sumKN).toBeCloseTo(r.expectedKN, 9);
    r.forces.forEach((f) => expect(f.reactionKN).toBeGreaterThanOrEqual(-1e-9));
    // 拔腿后反力由前侧两腿承担（后侧两腿为 0）
    expect(r.forces[2].reactionKN).toBeCloseTo(0, 9);
    expect(r.forces[3].reactionKN).toBeCloseTo(0, 9);
    expect(r.forces[0].reactionKN + r.forces[1].reactionKN).toBeCloseTo(r.expectedKN, 9);
    // 可提供的最大抗倾覆弯矩 = F × b，越界部分即倾覆裕度告警依据
    const mz = r.forces.reduce((s, f) => s + f.reactionKN * f.position[2], 0);
    expect(mz).toBeCloseTo(r.expectedKN * 3.6, 9);
    expect(r.expectedKN * 4.6).toBeGreaterThan(mz); // 外力矩超过支承能力 → 必须报警
  });
});
