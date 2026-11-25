import { describe, expect, it } from 'vitest';
import { simulate } from '../src/dynamics/engine';
import { seedCars, seedCrane, seedPlan, seedScenes } from '../src/seed';
import type { DataBundle } from '../src/services/repository';

function buildContext() {
  const cranes = [seedCrane()];
  const cars = seedCars();
  const scenes = seedScenes();
  const plan = seedPlan(scenes[0].id, cars[0].id);
  const bundle: DataBundle = { carModels: cars, cranes, scenes, plans: [plan] };
  const ctx = {
    craneModels: new Map(cranes.map((c) => [c.id, c])),
    carModels: new Map(cars.map((c) => [c.id, c])),
    scene: scenes[0],
  };
  return { plan, ctx, bundle };
}

describe('仿真引擎端到端', () => {
  it('完整推演产出逐帧快照，除零时长末帧外帧时间严格按固定步长递增', () => {
    const { plan, ctx } = buildContext();
    const result = simulate(plan, ctx);
    expect(result.frames.length).toBeGreaterThan(10);
    result.frames.slice(0, -1).forEach((f, i) => {
      expect(f.t).toBeCloseTo(i * 0.1, 9);
    });
    // 末帧为摘钩零时长帧，时刻与前一帧相同
    const lastTwo = result.frames.slice(-2);
    expect(lastTwo[1].t).toBeCloseTo(lastTwo[0].t, 9);
    expect(result.durationSec).toBeCloseTo((result.frames.length - 2) * 0.1, 9);
  });

  it('每一帧每台起重机支腿反力之和都等于自重+吊重', () => {
    const { plan, ctx } = buildContext();
    const { frames } = simulate(plan, ctx);
    for (const f of frames) {
      for (const c of f.cranes) {
        expect(Math.abs(c.reactionSumKN - c.expectedTotalKN)).toBeLessThan(1e-6);
        for (const o of c.outriggers) expect(o.reactionKN).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it('挂钩后吊载率与吊重为正，摘钩后吊重回到仅吊钩自重', () => {
    const { plan, ctx } = buildContext();
    const { frames } = simulate(plan, ctx);
    const craneId = plan.cranePlacements[0].id;
    const mid = frames[Math.floor(frames.length * 0.4)];
    const midSnap = mid.cranes.find((c) => c.placementId === craneId)!;
    expect(midSnap.liftedMassT).toBeGreaterThan(20); // 含车体质量
    // 末步摘钩
    const last = frames[frames.length - 1].cranes.find((c) => c.placementId === craneId)!;
    expect(last.liftedMassT).toBeCloseTo(seedCrane().hookBlockMassT, 6);
  });

  it('危险帧清单的帧索引都能在 frames 中定位且原帧含告警', () => {
    const { plan, ctx } = buildContext();
    const { frames, dangers } = simulate(plan, ctx);
    for (const d of dangers) {
      expect(d.frameIndex).toBeGreaterThanOrEqual(0);
      expect(d.frameIndex).toBeLessThan(frames.length);
      expect(frames[d.frameIndex].hazards.length).toBeGreaterThan(0);
    }
  });

  it('车辆快照数量与方案脱轨车一致，且位置随帧变化（起吊生效）', () => {
    const { plan, ctx } = buildContext();
    const { frames } = simulate(plan, ctx);
    expect(frames[0].cars).toHaveLength(plan.derailedCars.length);
    const y0 = frames[0].cars[0].position[1];
    const raised = frames.some((f) => f.cars[0].position[1] > y0 + 0.3);
    expect(raised).toBe(true);
  });
});
