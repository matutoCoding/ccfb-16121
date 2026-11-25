// 硬指标测试:
// 1) 任意回转/变幅/伸缩组合下, 矩阵层级链吊钩位置与按臂长/半径手算结果误差 < 1cm
// 2) 四条支腿反力之和 = 起重机自重 + 吊载 (总重力), 误差 < 1N
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedCrane, defaultCranePose } from '../src/core/seed';
import {
  computeKinematics, selfCheckKinematics, computeOutriggerReactions,
  reactionBalanceError, currentBoomLength, G,
} from '../src/core/crane';
import { deg2rad } from '../src/core/geometry';
import { transformPoint } from '../src/core/mat4';

const model = seedCrane();

function pose(over: Partial<ReturnType<typeof defaultCranePose>> = {}) {
  return { ...defaultCranePose(), sections: [0.5, 0.5, 0.5, 0.5, 0.5], ...over };
}

test('臂长 = 基本臂 + 各节行程之和', () => {
  const p = pose({ sections: [0, 0.25, 0.5, 0.75, 1] });
  const expectL = model.baseBoomLength
    + model.sectionStroke * (0 + 0.25 + 0.5 + 0.75 + 1);
  assert.ok(Math.abs(currentBoomLength(model, p) - expectL) < 1e-9);
});

test('吊钩矩阵链 vs 手算: 全姿态扫描误差 < 1cm', () => {
  let maxErr = 0;
  for (const slewDeg of [-170, -90, -30, 0, 45, 90, 160]) {
    for (const luffDeg of [15, 25, 40, 55, 68, 78]) {
      for (const sec of [[0, 0, 0, 0, 0], [1, 1, 1, 1, 1], [0.3, 0.6, 0.2, 0.9, 0.5]]) {
        for (const headingDeg of [0, 37, 125]) {
          const p = pose({
            slew: deg2rad(slewDeg), luff: deg2rad(luffDeg),
            heading: deg2rad(headingDeg), sections: [...sec], hoist: 6.5,
          });
          const check = selfCheckKinematics(model, p);
          maxErr = Math.max(maxErr, check.maxError);
          assert.ok(check.maxError <= 0.01,
            `超差 slew=${slewDeg} luff=${luffDeg} err=${check.maxError}m`);
        }
      }
    }
  }
  // 远小于 1cm 红线: 独立两条计算路径的浮点残差在 1e-5 m 量级
  assert.ok(maxErr < 1e-5, `最大误差 ${maxErr}m 应远小于 1cm 红线`);
});

test('工作半径与解析公式一致', () => {
  const p = pose({ slew: deg2rad(33), luff: deg2rad(48), heading: deg2rad(20) });
  const k = computeKinematics(model, p);
  const rExpect = k.boomLength * Math.cos(deg2rad(48));
  assert.ok(Math.abs(k.radius - rExpect) < 1e-9);
});

test('无摆角时吊钩铅垂点 = 臂尖正下方绳长处', () => {
  const p = pose({ hoist: 9.3, swingAlong: 0, swingAcross: 0 });
  const k = computeKinematics(model, p);
  assert.ok(Math.abs(k.hookPlumb[0] - k.boomTip[0]) < 1e-9);
  assert.ok(Math.abs(k.hookPlumb[2] - k.boomTip[2]) < 1e-9);
  assert.ok(Math.abs(k.hookPlumb[1] - (k.boomTip[1] - 9.3)) < 1e-9);
  // 摆角为 0 时带摆动的实际吊钩也必须与铅垂点重合 (矩阵链为 Float32, 留 1e-6 容差)
  assert.ok(Math.abs(k.hook[0] - k.hookPlumb[0]) < 1e-6);
  assert.ok(Math.abs(k.hook[1] - k.hookPlumb[1]) < 1e-6);
  assert.ok(Math.abs(k.hook[2] - k.hookPlumb[2]) < 1e-6);
});

test('四腿支反力之和 = 自重+吊载总重力 (安全工况误差 < 0.001 kN)', () => {
  // 收臂 + 高变幅 (半径约 6m), 吊钩落在支腿支承四边形内, 四腿均受压
  for (const lifted of [0, 20, 40]) {
    for (const slewDeg of [0, 60, 120, 180]) {
      const p = pose({
        slew: deg2rad(slewDeg), luff: deg2rad(72),
        sections: [0, 0, 0, 0, 0],
      });
      const reactions = computeOutriggerReactions(model, p, lifted, 180);
      assert.ok(reactions.every((r) => !r.lifted), `安全工况四腿均应受压 (slew=${slewDeg})`);
      const err = reactionBalanceError(model, p, lifted, reactions);
      assert.ok(err < 0.001, `lifted=${lifted} slew=${slewDeg} 合力偏差 ${err} kN`);
      for (const r of reactions) assert.ok(r.reaction >= -1e-6);
    }
  }
});

test('倾覆临界工况: 合力超出支承四边形时明确标出离地腿而非给出虚假平衡', () => {
  const p = pose({ luff: deg2rad(15) }); // 大半径前伸
  const reactions = computeOutriggerReactions(model, p, 20, 180);
  assert.ok(reactions.some((r) => r.lifted), '应有支腿标记离地');
});

test('吊载越重、越偏向某侧, 该侧支腿反力越大', () => {
  const p = pose({ slew: 0, luff: deg2rad(72), sections: [0, 0, 0, 0, 0] }); // 臂指向 +X (右侧腿 x>0)
  const r0 = computeOutriggerReactions(model, p, 0, 180);
  const rHeavy = computeOutriggerReactions(model, p, 40, 180);
  assert.ok(rHeavy.every((r) => !r.lifted));
  const right0 = r0.filter((r) => r.position[0] > 0).reduce((s, r) => s + r.reaction, 0);
  const rightHeavy = rHeavy.filter((r) => r.position[0] > 0).reduce((s, r) => s + r.reaction, 0);
  assert.ok(rightHeavy > right0);
});

test('收起的支腿不参与受力, 剩余腿合力仍等于总重力', () => {
  const p = pose({ luff: deg2rad(72), sections: [0, 0, 0, 0, 0] });
  p.outriggers[0].deployed = false;
  const reactions = computeOutriggerReactions(model, p, 20, 180);
  assert.equal(reactions[0].reaction, 0);
  const err = reactionBalanceError(model, p, 20, reactions);
  assert.ok(err < 0.001);
});

test('比压 = 反力 / 扩散后接地面积, 超承载被标记', () => {
  const p = pose({ luff: deg2rad(72), sections: [0, 0, 0, 0, 0] });
  const reactions = computeOutriggerReactions(model, p, 40, 100); // 低承载力
  for (const r of reactions) {
    assert.ok(Math.abs(r.bearingPressure - r.reaction / r.area) < 1e-9);
    if (r.bearingPressure > 100) assert.equal(r.overloaded, true);
  }
});

test('总重力数值核对 (t*g = kN)', () => {
  const p = pose({ luff: deg2rad(72), sections: [0, 0, 0, 0, 0] });
  const L = currentBoomLength(model, p);
  const totalMass = model.chassisMass + model.superstructureMass + model.counterweightMass
    + model.boomMassPerMeter * L + model.hookMass + 30;
  const reactions = computeOutriggerReactions(model, p, 30, 180);
  const sum = reactions.reduce((s, r) => s + r.reaction, 0);
  assert.ok(Math.abs(sum - totalMass * G) < 0.001);
  void transformPoint;
});
