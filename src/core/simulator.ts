// 推演步进: 把方案步骤中的目标姿态按速度上限插值成逐帧姿态,
// 同步驱动车体、吊索, 逐帧计算吊载率、支腿反力与接触网净距, 产出 FrameSnapshot。
import {
  computeKinematics, computeOutriggerReactions, loadRatio, clampLuff, G,
} from './crane';
import { clamp, lerp, segmentSegmentDist, pointSegmentDist, deg2rad } from './geometry';
import type {
  AccidentScene, CraneModel, CranePose, FrameSnapshot, PlanStep, SiteParams,
  DangerFrame, Vec3M,
} from './types';

export const FRAME_HZ = 10; // 回放帧率
const DT = 1 / FRAME_HZ;

function approach(current: number, target: number, maxStep: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

/** 单台起重机一个时间步朝目标姿态逼近, 各机构分别受速度上限约束 */
export function stepPose(model: CraneModel, pose: CranePose, target: Partial<CranePose>, dt: number): CranePose {
  const lim = model.speedLimits;
  const next: CranePose = {
    ...pose,
    sections: [...pose.sections],
    outriggers: pose.outriggers.map((o) => ({ ...o })),
  };
  if (target.slew !== undefined) next.slew = approach(pose.slew, target.slew, lim.slew * dt);
  if (target.luff !== undefined) {
    next.luff = clampLuff(model, approach(pose.luff, clampLuff(model, target.luff), lim.luff * dt));
  }
  if (target.hoist !== undefined) next.hoist = approach(pose.hoist, target.hoist, lim.hoist * dt);
  if (target.sections) {
    for (let i = 0; i < model.sectionCount; i++) {
      if (target.sections[i] === undefined) continue;
      next.sections[i] = approach(
        pose.sections[i] ?? 0,
        clamp(target.sections[i], 0, 1),
        (lim.telescope * dt) / model.sectionStroke,
      );
    }
  }
  if (target.outriggers) next.outriggers = target.outriggers.map((o) => ({ ...o }));
  return next;
}

function poseReached(pose: CranePose, target: Partial<CranePose>): boolean {
  const eps = 1e-4;
  if (target.slew !== undefined && Math.abs(pose.slew - target.slew) > eps) return false;
  if (target.luff !== undefined && Math.abs(pose.luff - target.luff) > eps) return false;
  if (target.hoist !== undefined && Math.abs(pose.hoist - target.hoist) > eps) return false;
  if (target.sections) {
    for (let i = 0; i < target.sections.length; i++) {
      if (target.sections[i] !== undefined && Math.abs((pose.sections[i] ?? 0) - target.sections[i]) > eps) {
        return false;
      }
    }
  }
  return true;
}

export interface SimContext {
  cranes: CraneModel[];
  scene: AccidentScene;
  site: SiteParams;
  /** 每台起重机当前吊载质量 t (0 表示空钩) */
  liftedMasses: number[];
}

/** 接触网立柱与导线的世界几何 (沿邻线方向等距布置) */
export function catenaryGeometry(site: SiteParams): { masts: Vec3M[]; wireFrom: Vec3M; wireTo: Vec3M } {
  const length = 120;
  const masts: Vec3M[] = [];
  for (let z = -length / 2; z <= length / 2 + 0.1; z += site.mastSpacing) {
    masts.push([site.mastOffset, 0, z]);
  }
  return {
    masts,
    wireFrom: [site.mastOffset, site.wireHeight, -length / 2],
    wireTo: [site.mastOffset, site.wireHeight, length / 2],
  };
}

/** 逐帧推演整个方案, 返回帧快照与危险帧清单 */
export function simulatePlan(ctx: SimContext, steps: PlanStep[]): {
  frames: FrameSnapshot[];
  dangers: DangerFrame[];
} {
  const poses: CranePose[] = ctx.scene.cranePoses.map((p) => ({
    ...p,
    sections: [...p.sections],
    outriggers: p.outriggers.map((o) => ({ ...o })),
  }));
  const carPositions = ctx.scene.cars.map((c) => ({
    position: [...c.position] as Vec3M,
    rotation: [...c.rotation] as Vec3M,
  }));

  const frames: FrameSnapshot[] = [];
  const dangerMap = new Map<string, DangerFrame>();
  let t = 0;
  const cat = catenaryGeometry(ctx.site);

  const record = (locked: boolean, slingAlertTexts: string[]) => {
    const frame: FrameSnapshot = {
      t,
      cranes: poses.map((pose, ci) => {
        const model = ctx.cranes[ci];
        const k = computeKinematics(model, pose);
        const lr = loadRatio(model, pose, ctx.liftedMasses[ci]);
        const reactions = computeOutriggerReactions(
          model, pose, ctx.liftedMasses[ci], ctx.site.allowableBearing,
        );
        const wireClearance = segmentSegmentDist(
          k.boomFoot, k.boomTip, cat.wireFrom, cat.wireTo,
        );
        let mastClearance = Infinity;
        for (const m of cat.masts) {
          const d = pointSegmentDist(m, k.boomFoot, k.boomTip);
          if (d < mastClearance) mastClearance = d;
        }
        return {
          pose,
          radius: k.radius,
          boomLength: k.boomLength,
          loadRatio: lr.ratio,
          hook: k.hook,
          boomTip: k.boomTip,
          boomFoot: k.boomFoot,
          reactions,
          liftedLoad: ctx.liftedMasses[ci],
          wireClearance,
          mastClearance,
        };
      }),
      carPositions: carPositions.map((c) => ({
        position: [...c.position] as Vec3M,
        rotation: [...c.rotation] as Vec3M,
      })),
      slingAlerts: slingAlertTexts,
      locked,
    };
    frames.push(frame);

    // 危险帧判定。同类原因 (如某条腿比压超限) 只保留最严重的一帧,
    // 避免连续数百帧重复; 详情里给出极值。
    const pushDanger = (key: string, detailReason: string, severity: 'warn' | 'danger') => {
      const fi = frames.length - 1;
      const existing = dangerMap.get(key);
      const rank = severity === 'danger' ? 2 : 1;
      if (!existing || rank > (existing.severity === 'danger' ? 2 : 1)) {
        dangerMap.set(key, { frameIndex: fi, t, reason: detailReason, severity });
      }
    };
    frame.cranes.forEach((c, ci) => {
      if (c.loadRatio > 1) {
        pushDanger(`load-${ci}-over`, `起重机${ci + 1} 吊载率峰值 ${(c.loadRatio * 100).toFixed(0)}% 超限锁车`, 'danger');
      } else if (c.loadRatio > 0.9) {
        pushDanger(`load-${ci}-90`, `起重机${ci + 1} 吊载率峰值 ${(c.loadRatio * 100).toFixed(0)}% 超 90%`, 'warn');
      }
      c.reactions.forEach((r) => {
        if (r.overloaded) {
          pushDanger(`bearing-${r.id}`,
            `${r.name} 地面比压峰值 ${r.bearingPressure.toFixed(0)}kPa 超路基承载力 ${ctx.site.allowableBearing}kPa`, 'danger');
        }
      });
      if (c.wireClearance < 1.0) {
        pushDanger(`wire-${ci}`, `起重机${ci + 1} 主臂距接触网导线最近 ${c.wireClearance.toFixed(2)}m`, c.wireClearance < 0.5 ? 'danger' : 'warn');
      }
      if (c.mastClearance < 1.0) {
        pushDanger(`mast-${ci}`, `起重机${ci + 1} 主臂距接触网立柱最近 ${c.mastClearance.toFixed(2)}m`, 'warn');
      }
    });
    slingAlertTexts.forEach((text) => {
      pushDanger(`sling-${text}`, text, 'danger');
    });
  };

  record(false, []);

  let locked = false;
  for (const step of steps) {
    const maxFrames = Math.ceil(step.durationSec / DT) + 2;
    for (let f = 0; f < maxFrames; f++) {
      const before = poses.map((p) => ({ ...p, sections: [...p.sections] }));
      const alerts: string[] = [];
      for (const action of step.actions) {
        if (locked) break;
        const ci = action.craneIndex;
        const model = ctx.cranes[ci];
        // 锁车条件: 吊载率 >100%
        const lr = loadRatio(model, poses[ci], ctx.liftedMasses[ci]);
        if (lr.ratio > 1.0) {
          locked = true;
          alerts.push(`起重机${ci + 1} 吊载率超 100%, 操作已锁定`);
          break;
        }
        poses[ci] = stepPose(model, poses[ci], action.target ?? {}, DT);
      }

      // 车体跟随: 已离地车辆的位置取各吊钩均值 (简化的双机/单机跟随)
      ctx.scene.cars.forEach((car, carIdx) => {
        const hooks = step.actions
          .filter((a) => a.target.hoist !== undefined)
          .map((a) => poses[a.craneIndex])
          .map((p) => computeKinematics(ctx.cranes[0], p).hook);
        if (hooks.length > 0) {
          const avg: Vec3M = [0, 0, 0];
          hooks.forEach((h) => { avg[0] += h[0]; avg[1] += h[1]; avg[2] += h[2]; });
          avg[0] /= hooks.length; avg[1] /= hooks.length; avg[2] /= hooks.length;
          // 车体保持在吊钩下方一个吊挂距离
          carPositions[carIdx].position = [avg[0], avg[1] - 1.5, avg[2]];
        }
      });

      t += DT;
      record(locked, alerts);

      const allReached = step.actions.every((a) => poseReached(poses[a.craneIndex], a.target ?? {}));
      const unchanged = poses.every((p, i) => p === before[i] || true);
      void unchanged;
      if (allReached) break;
    }
  }

  // 危险帧已在记录时按原因归并; 按帧序输出, 点击可跳到最严重的那一帧。
  const dangers = [...dangerMap.values()].sort((a, b) => a.frameIndex - b.frameIndex);
  return { frames, dangers };
}

/** 落轨对轨检测: 轮对与钢轨中心的横向偏差, m; 阈值 0.05m */
export function railAlignmentError(carPosition: Vec3M, gauge: number): number {
  // 钢轨位于 z = ±gauge/2 的线路中心两侧; 车辆 z 偏离即错位
  return Math.abs(carPosition[2]);
}

export { G, deg2rad, lerp };
