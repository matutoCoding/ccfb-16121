import type {
  CraneFrameSnapshot,
  DangerMark,
  DerailedCar,
  FrameSnapshot,
  RescuePlan,
  SlingSnapshot,
} from '../types';
import type { CarModel, CraneModel, AccidentScene } from '../types';
import { DEG, G, clamp } from '../core/mathutil';
import type { Vec3 } from '../core/mat4';
import { add, angleDeg, lerp, normalize, sub } from '../core/vec3';
import {
  approachJoint,
  defaultJointState,
  evaluateLoad,
  forwardKinematics,
  jointReached,
  jointTargetFromAction,
  outriggerLabel,
  type CraneFKResult,
  type CraneJointState,
} from './crane';
import {
  carCogWorld,
  carTotalMass,
  dualCraneShare,
  liftPointWorld,
  markBearing,
  outriggerReactions,
  ropeTension,
  slingGeometry,
  slingHitsCarBody,
} from './statics';
import { boomCatenaryClearance, SAFE_CLEARANCE_M } from './scene';

export const FIXED_DT = 0.1; // 秒，固定步长
export const SLING_ANGLE_WARN = 90; // 吊索两绳夹角告警阈值（度）
export const BEARING_WARN_FACTOR = 0.9;

interface RigLink {
  placementId: string;
  carId: string;
  liftPointId: string;
}

interface CarRuntime {
  initial: DerailedCar;
  current: DerailedCar;
  /** 挂钩时记录的吊钩高度与车体 y 之差，用于车体随吊钩升降 */
  rigHookToCarY: number;
  lifted: boolean;
  rigs: RigLink[];
}

export interface EngineContext {
  craneModels: Map<string, CraneModel>;
  carModels: Map<string, CarModel>;
  scene: AccidentScene;
}

export interface SimulationResult {
  frames: FrameSnapshot[];
  dangers: DangerMark[];
  durationSec: number;
}

/** 把方案的每步动作按速度上限展开成关键帧轨迹，逐固定步长采样 */
export function simulate(plan: RescuePlan, ctx: EngineContext): SimulationResult {
  const dt = FIXED_DT;
  // ---- 初始化各起重机关节 ----
  const joints = new Map<string, CraneJointState>();
  const fkCache = new Map<string, CraneFKResult>();
  for (const pl of plan.cranePlacements) {
    const j = defaultJointState();
    const model = ctx.craneModels.get(pl.craneModelId);
    if (model) j.extensions = model.boomSections.map(() => 0);
    joints.set(pl.id, j);
  }

  // ---- 初始化车辆运行态 ----
  const cars = new Map<string, CarRuntime>();
  for (const dc of plan.derailedCars) {
    cars.set(dc.id, {
      initial: structuredClone(dc),
      current: structuredClone(dc),
      rigHookToCarY: 0,
      lifted: false,
      rigs: [],
    });
  }

  const frames: FrameSnapshot[] = [];
  const dangers: DangerMark[] = [];
  let t = 0;

  const sample = (hazards: string[]): void => {
    const frame = buildFrame(t, plan, ctx, joints, fkCache, cars, hazards);
    frames.push(frame);
    for (const h of hazards) {
      const severity = h.startsWith('【危险】') ? 'danger' : 'warn';
      dangers.push({ frameIndex: frames.length - 1, t, reason: h.replace('【危险】', '').replace('【警告】', ''), severity });
    }
  };

  sample([]); // 第 0 帧

  for (const step of plan.steps) {
    // 挂/摘钩
    if (step.rigging?.length) {
      for (const r of step.rigging) {
        const rt = cars.get(r.carId);
        if (rt && !rt.rigs.some((x) => x.placementId === r.placementId)) {
          rt.rigs.push({ placementId: r.placementId, carId: r.carId, liftPointId: r.liftPointId });
          const fk = fkCache.get(r.placementId);
          if (fk) rt.rigHookToCarY = fk.hookWorld[1] - rt.current.position[1];
          rt.lifted = true;
        }
      }
    }

    // 每台起重机的动作串：转成目标队列
    const queues = new Map<string, Partial<CraneJointState>[]>();
    for (const pl of plan.cranePlacements) {
      const model = ctx.craneModels.get(pl.craneModelId);
      const acts = step.actions[pl.id];
      if (!model || !acts?.length) {
        queues.set(pl.id, []);
        continue;
      }
      queues.set(pl.id, acts.map((a) => jointTargetFromAction(model, a.type, a.target)));
    }

    // 同步推进：每台起重机各自朝当前目标走，全部到达后进入下一动作
    const progress = new Map<string, number>(plan.cranePlacements.map((p) => [p.id, 0]));
    // 每台起重机的连续锁定计数：锁定满 10 帧（1 秒）判定动作不可达，跳过该动作避免死循环
    const lockStreak = new Map<string, number>(plan.cranePlacements.map((p) => [p.id, 0]));
    let guard = 0;
    const maxIter = 100000;
    while (guard++ < maxIter) {
      let allDone = true;
      const hazards: string[] = [];
      for (const pl of plan.cranePlacements) {
        const model = ctx.craneModels.get(pl.craneModelId)!;
        const q = queues.get(pl.id)!;
        const pi = progress.get(pl.id)!;
        if (pi >= q.length) continue;
        allDone = false;
        const cur = joints.get(pl.id)!;
        const next = approachJoint(model, cur, q[pi], dt);
        // 超载锁定：危险级别禁止继续动作（但允许记录帧用于回放分析）
        const fk0 = forwardKinematics(model, pl, next);
        const gross = currentLiftedMass(pl.id, cars, ctx);
        const ev = evaluateLoad(model, pl, gross + model.hookBlockMassT, fk0.radius, fk0.boomLength);
        if (ev.locked) {
          hazards.push(`【危险】${pl.id} 吊载率 ${ev.ratioPct.toFixed(0)}% 超过 100%，操作已锁定`);
          const streak = (lockStreak.get(pl.id) ?? 0) + 1;
          lockStreak.set(pl.id, streak);
          if (streak >= 10) {
            // 持续锁定：该动作不可达，跳过并解除计数，防止推演永不结束
            progress.set(pl.id, pi + 1);
            lockStreak.set(pl.id, 0);
            hazards.push(`【危险】${pl.id} 动作持续超载被跳过，请调整站位/臂长/变幅后重推`);
          }
          // 锁定：不推进关节
          continue;
        }
        lockStreak.set(pl.id, 0);
        joints.set(pl.id, next);
        if (jointReached(next, q[pi])) progress.set(pl.id, pi + 1);
      }

      // 车体随吊钩运动
      updateCarMotion(cars, fkCache, joints, plan, ctx, dt);

      t += dt;
      sample(hazards);
      if (allDone) break;
    }

    if (step.unrigAfter) {
      for (const rt of cars.values()) {
        rt.rigs = [];
        rt.lifted = false;
      }
      // 补零时长末帧反映摘钩状态（t 不递增，帧时间仍与序号语义一致）
      sample([]);
    }
  }

  return { frames, dangers: dedupeDangers(dangers), durationSec: t };
}

function dedupeDangers(d: DangerMark[]): DangerMark[] {
  const seen = new Set<string>();
  return d.filter((x) => {
    const key = `${x.reason}@${Math.round(x.t)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 当前某台起重机分担的吊重（吨，不含吊钩自重） */
function currentLiftedMass(placementId: string, cars: Map<string, CarRuntime>, ctx: EngineContext): number {
  let sum = 0;
  for (const rt of cars.values()) {
    const myRigs = rt.rigs.filter((r) => r.placementId === placementId);
    if (!myRigs.length) continue;
    const carModel = ctx.carModels.get(rt.current.carModelId);
    if (!carModel) continue;
    const total = carTotalMass(carModel);
    if (rt.rigs.length === 1) {
      sum += total;
    } else {
      // 双机抬吊：按吊点与重心的杠杆法则分担
      const pts = rt.rigs.map((r) => {
        const lp = carModel.liftPoints.find((p) => p.id === r.liftPointId)!;
        return liftPointWorld(carModel, rt.current, lp);
      });
      const share = dualCraneShare(carModel, rt.current, pts[0], pts[1]);
      const idx = rt.rigs.findIndex((r) => r.placementId === placementId);
      sum += idx === 0 ? share.massA : share.massB;
    }
  }
  return sum;
}

/** 车体运动：单钩跟随吊钩高度；多钩时取平均，并保持挂钩时的相对姿态差 */
function updateCarMotion(
  cars: Map<string, CarRuntime>,
  fkCache: Map<string, CraneFKResult>,
  joints: Map<string, CraneJointState>,
  plan: RescuePlan,
  ctx: EngineContext,
  dt: number,
): void {
  void joints;
  void plan;
  void dt;
  for (const rt of cars.values()) {
    if (!rt.rigs.length) continue;
    const hookYs: number[] = [];
    for (const r of rt.rigs) {
      const fk = fkCache.get(r.placementId);
      if (fk) hookYs.push(fk.hookWorld[1]);
    }
    if (!hookYs.length) continue;
    const avgHookY = hookYs.reduce((a, b) => a + b, 0) / hookYs.length;
    // 车体 y 跟随吊钩，保持挂钩瞬间的高差
    rt.current.position = [rt.current.position[0], avgHookY - rt.rigHookToCarY, rt.current.position[2]];
    // 水平位置：向吊钩正下方缓动（模拟悬吊居中），仅在离地状态
    const carModel = ctx.carModels.get(rt.current.carModelId);
    if (carModel && rt.lifted) {
      const target = averageHookXZ(rt, fkCache);
      rt.current.position[0] += (target[0] - rt.current.position[0]) * 0.2;
      rt.current.position[2] += (target[2] - rt.current.position[2]) * 0.2;
    }
  }
}

function averageHookXZ(rt: CarRuntime, fkCache: Map<string, CraneFKResult>): Vec3 {
  const pts = rt.rigs.map((r) => fkCache.get(r.placementId)?.hookWorld).filter(Boolean) as Vec3[];
  if (!pts.length) return rt.current.position;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, rt.current.position[1], pts.reduce((s, p) => s + p[2], 0) / pts.length];
}

function buildFrame(
  t: number,
  plan: RescuePlan,
  ctx: EngineContext,
  joints: Map<string, CraneJointState>,
  fkCache: Map<string, CraneFKResult>,
  cars: Map<string, CarRuntime>,
  priorHazards: string[],
): FrameSnapshot {
  const hazards = [...priorHazards];
  const craneSnaps: CraneFrameSnapshot[] = [];
  const slingSnaps: SlingSnapshot[] = [];

  for (const pl of plan.cranePlacements) {
    const model = ctx.craneModels.get(pl.craneModelId)!;
    const joint = joints.get(pl.id)!;
    const fk = forwardKinematics(model, pl, joint);
    fkCache.set(pl.id, fk);

    const liftedT = currentLiftedMass(pl.id, cars, ctx);
    const grossT = liftedT + model.hookBlockMassT;
    const ev = evaluateLoad(model, pl, grossT, fk.radius, fk.boomLength);
    if (ev.level === 'warn') hazards.push(`【警告】${pl.id} 吊载率 ${ev.ratioPct.toFixed(0)}% 超过 90%`);

    // 吊钩相对回转中心的局部偏心（转到底盘坐标系）
    const yaw = pl.headingDeg * DEG;
    const dx = fk.hookWorld[0] - fk.slewCenterWorld[0];
    const dz = fk.hookWorld[2] - fk.slewCenterWorld[2];
    const localOff: Vec3 = [dx * Math.cos(-yaw) - dz * Math.sin(-yaw), 0, dx * Math.sin(-yaw) + dz * Math.cos(-yaw)];

    const reaction = markBearing(
      outriggerReactions(model, pl, grossT, localOff),
      ctx.scene.allowableBearingKPa,
    );
    if (reaction.uplift) hazards.push(`【危险】${pl.id} 出现支腿离地（拔腿），有倾覆风险`);
    reaction.forces.forEach((f, i) => {
      if (f.overloaded) {
        hazards.push(
          `【危险】${pl.id} ${outriggerLabel(i)}支腿比压 ${f.bearingKPa.toFixed(0)}kPa 超过路基容许 ${ctx.scene.allowableBearingKPa}kPa`,
        );
      } else if (f.bearingKPa > ctx.scene.allowableBearingKPa * BEARING_WARN_FACTOR) {
        hazards.push(`【警告】${pl.id} ${outriggerLabel(i)}支腿比压接近路基承载力上限`);
      }
    });

    const clearance = boomCatenaryClearance(ctx.scene, fk.boomFootWorld, fk.boomTipWorld);
    if (clearance.violation) {
      hazards.push(
        `【危险】${pl.id} 主臂距${clearance.nearestObject === 'pole' ? '接触网立柱' : '导线'}仅 ${clearance.minDistance.toFixed(2)}m（安全距离 ${SAFE_CLEARANCE_M}m）`,
      );
    }

    craneSnaps.push({
      placementId: pl.id,
      slewDeg: joint.slewDeg,
      luffDeg: joint.luffDeg,
      boomLength: fk.boomLength,
      radius: fk.radius,
      hookPosition: fk.hookWorld,
      hookHeight: fk.hookWorld[1],
      liftedMassT: grossT,
      ratedCapacityT: ev.ratedT,
      loadRatioPct: ev.ratioPct,
      locked: ev.locked,
      outriggers: reaction.forces.map((f) => ({
        position: f.position,
        woodLayers: f.woodLayers,
        reactionKN: f.reactionKN,
        bearingKPa: f.bearingKPa,
        overloaded: f.overloaded,
      })),
      reactionSumKN: reaction.sumKN,
      expectedTotalKN: reaction.expectedKN,
      catenaryClearanceM: clearance.minDistance,
    });
  }

  // 吊索快照
  for (const rt of cars.values()) {
    if (!rt.rigs.length) continue;
    const carModel = ctx.carModels.get(rt.current.carModelId)!;
    const rigGroups = new Map<string, RigLink[]>();
    for (const r of rt.rigs) {
      const g = rigGroups.get(r.placementId) ?? [];
      g.push(r);
      rigGroups.set(r.placementId, g);
    }
    for (const [placementId, rigs] of rigGroups) {
      const fk = fkCache.get(placementId)!;
      const pts = rigs.map((r) => {
        const lp = carModel.liftPoints.find((p) => p.id === r.liftPointId)!;
        return liftPointWorld(carModel, rt.current, lp);
      });
      const geo = slingGeometry(fk.hookWorld, pts);
      const massT = currentLiftedMass(placementId, cars, ctx);
      const tension = ropeTension(massT, geo.includedAngleDeg, pts.length);
      const interference = pts.some((p) => slingHitsCarBody(fk.hookWorld, p, carModel, rt.current));
      const angleWarn = geo.includedAngleDeg > SLING_ANGLE_WARN;
      if (angleWarn) hazards.push(`【警告】${placementId} 吊索夹角 ${geo.includedAngleDeg.toFixed(0)}° 大于 ${SLING_ANGLE_WARN}°`);
      if (interference) hazards.push(`【危险】${placementId} 吊索与车体干涉`);
      slingSnaps.push({
        placementId,
        carId: rt.current.id,
        liftPointId: rigs[0].liftPointId,
        includedAngleDeg: geo.includedAngleDeg,
        ropeTensionKN: tension,
        bodyInterference: interference,
        angleWarning: angleWarn,
      });
    }
  }

  const carSnaps = [...cars.values()].map((rt) => ({
    carId: rt.current.id,
    position: [...rt.current.position] as Vec3,
    rotationDeg: [...rt.current.rotationDeg] as Vec3,
    lifted: rt.lifted,
  }));

  return { t, cranes: craneSnaps, slings: slingSnaps, cars: carSnaps, hazards: [...new Set(hazards)] };
}

/** 落轨对轨检测：轮对与钢轨的横向偏差（米） */
export function railAlignmentError(carModel: CarModel, car: DerailedCar, railGauge: number): number {
  void carModel;
  // 简化：车体原点横向偏移的绝对值（线路坐标系）
  const yaw = car.rotationDeg[1] * DEG;
  void yaw;
  void railGauge;
  return Math.abs(car.position[0]);
}

export function cogOfCar(carModel: CarModel, car: DerailedCar): Vec3 {
  return carCogWorld(carModel, car);
}

export { add, angleDeg, lerp, normalize, sub, G, clamp };
