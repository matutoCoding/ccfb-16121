// 吊索与双机分担、推演步进的数值正确性测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedCrane, seedSites, seedScenes, defaultCranePose } from '../src/core/seed';
import { evaluateSling, slingTension, dualCraneShare } from '../src/core/rigging';
import { stepPose } from '../src/core/simulator';
import { deg2rad, rad2deg } from '../src/core/geometry';

const model = seedCrane();

test('对称双索: 夹角 0 时索力 = W/2, 夹角增大索力上升', () => {
  const W = 40;
  const t0 = slingTension(W, 0, 2);
  const t90 = slingTension(W, 90, 2);
  const t120 = slingTension(W, 120, 2);
  assert.ok(Math.abs(t0 - (W * 9.81) / 2) < 1e-9);
  assert.ok(t90 > t0);
  assert.ok(t120 > t90);
  // 120° 时单索拉力等于总重力
  assert.ok(Math.abs(t120 - W * 9.81) < 1e-6);
});

test('吊索蹭车体: 净距接近 0 时给出危险提示', () => {
  const sling = evaluateSling({
    hook: [0, 4, 0],
    carPointIds: ['a', 'b'],
    pointWorlds: [[-1, 2.5, 0], [1, 2.5, 0]],
    carHalfSize: [6, 1.4, 1.5],
    carCenter: [0, 2.5, 0],
  });
  // 吊钩在车体包围盒内部正上方, 线段必然穿盒
  assert.ok(sling.clearance < 0.05);
  assert.ok(sling.includedAngleDeg > 0);
});

test('双机分担: 吊钩对称布置时各担 50%', () => {
  const r = dualCraneShare(80, [-4, 6, 0], [4, 6, 0], [0, 1.5, 0]);
  assert.ok(Math.abs(r.ratio1 - 0.5) < 1e-9);
  assert.ok(Math.abs(r.share1 - 40) < 1e-9);
});

test('双机分担: 吊钩靠近重心一侧分担更多', () => {
  const r = dualCraneShare(80, [-1, 6, 0], [-7, 6, 0], [0, 1.5, 0]);
  assert.ok(r.ratio1 > r.ratio2);
  assert.ok(Math.abs((r.ratio1 + r.ratio2) - 1) < 1e-9);
});

test('机构步进受速度上限约束, 不会一步跳到目标', () => {
  const p = defaultCranePose();
  const target = { slew: p.slew + deg2rad(30) };
  const dt = 0.1;
  const next = stepPose(model, p, target, dt);
  const maxMove = model.speedLimits.slew * dt;
  assert.ok(Math.abs(next.slew - p.slew) <= maxMove + 1e-12);
  assert.ok(Math.abs(rad2deg(next.slew - p.slew) - rad2deg(maxMove)) < 1e-6);
});

test('变幅不会超出机械限位', () => {
  const p = defaultCranePose();
  const next = stepPose(model, p, { luff: deg2rad(89) }, 100);
  assert.ok(next.luff <= deg2rad(model.luffMaxDeg) + 1e-12);
  const next2 = stepPose(model, p, { luff: deg2rad(-5) }, 100);
  assert.ok(next2.luff >= deg2rad(model.luffMinDeg) - 1e-12);
});

test('现场与场景种子数据完整', () => {
  const sites = seedSites();
  const scenes = seedScenes(sites);
  assert.equal(sites.length, 4);
  assert.equal(scenes.length, 4);
  for (const s of scenes) {
    assert.ok(s.cars.length >= 1);
    assert.ok(s.cranePoses[0].outriggers.length === 4);
  }
});
