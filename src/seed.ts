import type { AccidentScene, CarModel, CraneModel, DerailedCar, RescuePlan } from './types';

// ============ 起重机：参照 NS160 型 160t 铁路救援起重机 ============

export function seedCrane(): CraneModel {
  return {
    id: 'crane-ns160',
    name: 'NS160 救援起重机（160t）',
    ratedCapacityT: 160,
    selfWeightT: 108,
    slewBaseHeight: 2.4,
    boomFoot: [0, 1.2, 1.6],
    boomSections: [
      { id: 'base', name: '基节', minLen: 13.5, maxLen: 13.5 },
      { id: 'sec2', name: '二节臂', minLen: 6, maxLen: 12 },
      { id: 'sec3', name: '三节臂', minLen: 5, maxLen: 10 },
      { id: 'sec4', name: '四节臂', minLen: 4, maxLen: 8 },
    ],
    luffMinDeg: 20,
    luffMaxDeg: 80,
    hookBlockMassT: 2.5,
    outriggerBase: [
      [-4.4, 0, 3.6],
      [4.4, 0, 3.6],
      [-4.4, 0, -3.6],
      [4.4, 0, -3.6],
    ],
    padSize: 1.4,
    padThickness: 0.12,
    speedLimits: { slewDegPerSec: 1.5, luffDegPerSec: 1.2, hoistMPerSec: 0.45, extendMPerSec: 0.4 },
    loadCharts: [
      {
        state: 'full',
        label: '支腿全伸 8.8×7.2m',
        radii: [4, 5, 6, 8, 10, 12, 16, 20, 24],
        boomLengths: [13.5, 22, 30, 38, 43.5],
        // 额定起重量（吨），随半径增大、臂长增长而下降
        grid: [
          [160, 140, 115, 95, 80],
          [142, 128, 108, 90, 76],
          [125, 115, 98, 84, 72],
          [95, 90, 82, 72, 64],
          [75, 72, 68, 62, 56],
          [60, 59, 56, 52, 48],
          [40, 42, 42, 40, 38],
          [0, 30, 31, 31, 30],
          [0, 0, 23, 24, 23],
        ],
      },
      {
        state: 'half',
        label: '支腿半伸 6×5m',
        radii: [4, 5, 6, 8, 10, 12, 16],
        boomLengths: [13.5, 22, 30, 38],
        grid: [
          [95, 85, 70, 58],
          [85, 78, 66, 55],
          [75, 70, 60, 51],
          [58, 55, 50, 44],
          [45, 44, 41, 38],
          [36, 36, 34, 32],
          [0, 24, 24, 23],
        ],
      },
      {
        state: 'none',
        label: '不打支腿（仅低速微动）',
        radii: [4, 5, 6, 8],
        boomLengths: [13.5, 22],
        grid: [
          [28, 22],
          [22, 18],
          [17, 14],
          [10, 9],
        ],
      },
    ],
  };
}

// ============ 车型库 ============

export function seedCars(): CarModel[] {
  return [
    {
      id: 'car-c70',
      name: 'C70 敞车',
      kind: 'open',
      length: 13.976,
      width: 3.18,
      height: 3.14,
      gauge: 1.435,
      bogieSpacing: 9.21,
      wheelDiameter: 0.84,
      body: { id: 'body', name: '车体', size: [13.976, 2.6, 3.0], offset: [0, 1.7, 0], massT: 21.4, cogLocal: [0, 1.9, 0] },
      bogies: [
        { id: 'b1', name: '前转向架', size: [2.4, 1.1, 2.2], offset: [0, 0.55, 4.605], massT: 2.4, cogLocal: [0, 0.55, 4.605] },
        { id: 'b2', name: '后转向架', size: [2.4, 1.1, 2.2], offset: [0, 0.55, -4.605], massT: 2.4, cogLocal: [0, 0.55, -4.605] },
      ],
      couplers: [
        { id: 'c1', name: '前车钩', size: [0.8, 0.4, 0.4], offset: [0, 1.05, 7.3], massT: 0.3, cogLocal: [0, 1.05, 7.3] },
        { id: 'c2', name: '后车钩', size: [0.8, 0.4, 0.4], offset: [0, 1.05, -7.3], massT: 0.3, cogLocal: [0, 1.05, -7.3] },
      ],
      liftPoints: [
        { id: 'lp-fl', name: '前端左吊点', position: [-1.2, 2.5, 5.5] },
        { id: 'lp-fr', name: '前端右吊点', position: [1.2, 2.5, 5.5] },
        { id: 'lp-rl', name: '后端左吊点', position: [-1.2, 2.5, -5.5] },
        { id: 'lp-rr', name: '后端右吊点', position: [1.2, 2.5, -5.5] },
      ],
    },
    {
      id: 'car-p70',
      name: 'P70 棚车',
      kind: 'covered',
      length: 16.0,
      width: 3.3,
      height: 4.7,
      gauge: 1.435,
      bogieSpacing: 11.0,
      wheelDiameter: 0.84,
      body: { id: 'body', name: '车体', size: [16.0, 4.0, 3.1], offset: [0, 2.3, 0], massT: 24.6, cogLocal: [0, 2.4, 0] },
      bogies: [
        { id: 'b1', name: '前转向架', size: [2.4, 1.1, 2.2], offset: [0, 0.55, 5.5], massT: 2.5, cogLocal: [0, 0.55, 5.5] },
        { id: 'b2', name: '后转向架', size: [2.4, 1.1, 2.2], offset: [0, 0.55, -5.5], massT: 2.5, cogLocal: [0, 0.55, -5.5] },
      ],
      couplers: [
        { id: 'c1', name: '前车钩', size: [0.8, 0.4, 0.4], offset: [0, 1.05, 8.3], massT: 0.3, cogLocal: [0, 1.05, 8.3] },
        { id: 'c2', name: '后车钩', size: [0.8, 0.4, 0.4], offset: [0, 1.05, -8.3], massT: 0.3, cogLocal: [0, 1.05, -8.3] },
      ],
      liftPoints: [
        { id: 'lp-fl', name: '前端左吊点', position: [-1.3, 3.6, 6.4] },
        { id: 'lp-fr', name: '前端右吊点', position: [1.3, 3.6, 6.4] },
        { id: 'lp-rl', name: '后端左吊点', position: [-1.3, 3.6, -6.4] },
        { id: 'lp-rr', name: '后端右吊点', position: [1.3, 3.6, -6.4] },
      ],
    },
    {
      id: 'car-g70',
      name: 'G70 罐车',
      kind: 'tank',
      length: 11.9,
      width: 3.0,
      height: 4.1,
      gauge: 1.435,
      bogieSpacing: 7.9,
      wheelDiameter: 0.84,
      tankLoad: 'full',
      tankLoads: {
        empty: { totalMassT: 22.8, cogShiftY: -0.35 },
        half: { totalMassT: 42.0, cogShiftY: -0.05 },
        full: { totalMassT: 62.8, cogShiftY: 0.28 },
      },
      body: { id: 'body', name: '罐体+底架', size: [11.5, 3.2, 3.0], offset: [0, 2.1, 0], massT: 17.6, cogLocal: [0, 2.2, 0] },
      bogies: [
        { id: 'b1', name: '前转向架', size: [2.4, 1.1, 2.2], offset: [0, 0.55, 3.95], massT: 2.3, cogLocal: [0, 0.55, 3.95] },
        { id: 'b2', name: '后转向架', size: [2.4, 1.1, 2.2], offset: [0, 0.55, -3.95], massT: 2.3, cogLocal: [0, 0.55, -3.95] },
      ],
      couplers: [
        { id: 'c1', name: '前车钩', size: [0.8, 0.4, 0.4], offset: [0, 1.05, 6.3], massT: 0.3, cogLocal: [0, 1.05, 6.3] },
        { id: 'c2', name: '后车钩', size: [0.8, 0.4, 0.4], offset: [0, 1.05, -6.3], massT: 0.3, cogLocal: [0, 1.05, -6.3] },
      ],
      liftPoints: [
        { id: 'lp-fl', name: '前端左吊点', position: [-1.1, 3.0, 4.4] },
        { id: 'lp-fr', name: '前端右吊点', position: [1.1, 3.0, 4.4] },
        { id: 'lp-rl', name: '后端左吊点', position: [-1.1, 3.0, -4.4] },
        { id: 'lp-rr', name: '后端右吊点', position: [1.1, 3.0, -4.4] },
      ],
    },
    {
      id: 'car-hxn5',
      name: 'HXN5 内燃机车',
      kind: 'locomotive',
      length: 21.1,
      width: 3.1,
      height: 4.8,
      gauge: 1.435,
      bogieSpacing: 13.9,
      wheelDiameter: 1.05,
      body: { id: 'body', name: '车体', size: [21.0, 3.6, 3.0], offset: [0, 2.4, 0], massT: 138, cogLocal: [0, 2.2, 0] },
      bogies: [
        { id: 'b1', name: '前转向架', size: [4.2, 1.3, 2.4], offset: [0, 0.65, 6.95], massT: 12, cogLocal: [0, 0.65, 6.95] },
        { id: 'b2', name: '后转向架', size: [4.2, 1.3, 2.4], offset: [0, 0.65, -6.95], massT: 12, cogLocal: [0, 0.65, -6.95] },
      ],
      couplers: [
        { id: 'c1', name: '前车钩', size: [1.0, 0.5, 0.5], offset: [0, 1.1, 10.9], massT: 0.5, cogLocal: [0, 1.1, 10.9] },
        { id: 'c2', name: '后车钩', size: [1.0, 0.5, 0.5], offset: [0, 1.1, -10.9], massT: 0.5, cogLocal: [0, 1.1, -10.9] },
      ],
      liftPoints: [
        { id: 'lp-fl', name: '前端左吊点', position: [-1.2, 3.8, 8.2] },
        { id: 'lp-fr', name: '前端右吊点', position: [1.2, 3.8, 8.2] },
        { id: 'lp-rl', name: '后端左吊点', position: [-1.2, 3.8, -8.2] },
        { id: 'lp-rr', name: '后端右吊点', position: [1.2, 3.8, -8.2] },
      ],
    },
  ];
}

// ============ 典型脱轨现场 ============

export function seedScenes(): AccidentScene[] {
  const makePoles = (trackX: number, spacing: number, count: number, startZ: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `pole-${i}`,
      position: [trackX, 0, startZ + i * spacing] as [number, number, number],
      height: 9.0,
      wireArm: 3.1,
      wireHeight: 6.5,
    }));

  return [
    {
      id: 'scene-straight',
      name: '直线段单线脱轨（低路堤）',
      lineHeadingDeg: 0,
      curveRadius: 0,
      embankmentHeight: 2.0,
      shoulderWidth: 4.2,
      trackSpacing: 5.0,
      allowableBearingKPa: 150,
      poleSpacing: 50,
      poles: makePoles(8.0, 50, 6, -50),
    },
    {
      id: 'scene-curve',
      name: '曲线区段脱轨（高路堤）',
      lineHeadingDeg: 15,
      curveRadius: 800,
      embankmentHeight: 6.0,
      shoulderWidth: 3.6,
      trackSpacing: 5.0,
      allowableBearingKPa: 120,
      poleSpacing: 45,
      poles: makePoles(8.5, 45, 6, -45),
    },
    {
      id: 'scene-double',
      name: '双线区间邻线侧翻（接触网受限）',
      lineHeadingDeg: 0,
      curveRadius: 0,
      embankmentHeight: 3.5,
      shoulderWidth: 4.0,
      trackSpacing: 4.4,
      allowableBearingKPa: 130,
      poleSpacing: 40,
      poles: makePoles(6.2, 40, 7, -60),
    },
    {
      id: 'scene-cutting',
      name: '路堑段脱轨（软土路基）',
      lineHeadingDeg: -10,
      curveRadius: 0,
      embankmentHeight: -2.5,
      shoulderWidth: 4.5,
      trackSpacing: 5.0,
      allowableBearingKPa: 90,
      poleSpacing: 55,
      poles: makePoles(8.2, 55, 5, -55),
    },
  ];
}

/** 与现场配套的脱轨车辆初始布置 */
export function seedDerailedCars(carId: string): DerailedCar[] {
  return [
    {
      id: 'dc-1',
      carModelId: carId,
      position: [0.8, 0.6, 0],
      rotationDeg: [0, 8, 12],
      bogiesDetached: false,
    },
  ];
}

/** 生成一份可直接推演的示例方案（单机吊复 C70 敞车） */
export function seedPlan(sceneId: string, carId: string): RescuePlan {
  const now = Date.now();
  return {
    id: `plan-${now}`,
    name: '示例：单机顶吊复位方案',
    sceneId,
    cranePlacements: [
      {
        id: 'crane-1',
        craneModelId: 'crane-ns160',
        position: [5.5, 0, -2],
        headingDeg: 0,
        chartState: 'full',
        outriggers: [
          { position: [1.1, 0, 1.6], woodLayers: 2 },
          { position: [9.9, 0, 1.6], woodLayers: 2 },
          { position: [1.1, 0, -5.6], woodLayers: 3 },
          { position: [9.9, 0, -5.6], woodLayers: 3 },
        ],
      },
    ],
    derailedCars: seedDerailedCars(carId),
    steps: [
      {
        id: 's1',
        name: '就位挂钩：转台回转至车体上方',
        actions: {
          'crane-1': [
            { type: 'extend', target: [0, 2, 1, 0], durationSec: 0 },
            { type: 'slew', target: 180, durationSec: 0 },
            { type: 'luff', target: 65, durationSec: 0 },
            { type: 'hoist', target: 5.2, durationSec: 0 },
          ],
        },
        rigging: [{ placementId: 'crane-1', carId: 'dc-1', liftPointId: 'lp-fr' }],
      },
      {
        id: 's2',
        name: '垂直起吊：车体离地 0.5m',
        actions: {
          'crane-1': [{ type: 'hoist', target: 6.0, durationSec: 0 }],
        },
      },
      {
        id: 's3',
        name: '回转对位：移至钢轨上方',
        actions: {
          'crane-1': [
            { type: 'slew', target: 150, durationSec: 0 },
            { type: 'luff', target: 68, durationSec: 0 },
          ],
        },
      },
      {
        id: 's4',
        name: '落车复轨',
        actions: {
          'crane-1': [{ type: 'hoist', target: 1.2, durationSec: 0 }],
        },
        unrigAfter: true,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}
