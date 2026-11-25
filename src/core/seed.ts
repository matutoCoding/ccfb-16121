// 内置数据生成: 车型库 (敞/棚/罐/机车)、160t 救援起重机、典型脱轨现场。
// 参数按铁路常用车型公开量级设定, 可在页面中修改; 距离内部统一 m。
import type { CarType, CraneModel, SiteParams, AccidentScene, CranePose } from './types';
import { deg2rad } from './geometry';

function defaultOutriggerPose(): CranePose['outriggers'] {
  return [
    { deployed: true, blocks: 3 },
    { deployed: true, blocks: 3 },
    { deployed: true, blocks: 3 },
    { deployed: true, blocks: 3 },
  ];
}

export function defaultCranePose(position: [number, number, number] = [0, 0, -5], heading = 0): CranePose {
  return {
    position,
    heading,
    slew: 0,
    luff: deg2rad(70),
    sections: [0.2, 0.2, 0.2, 0.2, 0.2],
    hoist: 8,
    swingAlong: 0,
    swingAcross: 0,
    outriggers: defaultOutriggerPose(),
  };
}

// ---------------- 车型 ----------------

export function seedCarTypes(): CarType[] {
  return [
    {
      id: 'car-c70',
      name: 'C70 型通用敞车',
      bodyType: 'open',
      length: 13.976, width: 3.18, height: 3.31,
      bogieSpacing: 8.7,
      builtIn: true,
      parts: [
        { id: 'body', name: '车体(车斗+底架)', kind: 'body', mass: 18.6, cog: [0, 1.7, 0], halfSize: [6.7, 1.4, 1.55], origin: [0, 1.1, 0] },
        { id: 'bogie1', name: '前转向架', kind: 'bogie', mass: 2.4, cog: [-4.35, 0.45, 0], halfSize: [1.1, 0.45, 1.1], origin: [-4.35, 0, 0] },
        { id: 'bogie2', name: '后转向架', kind: 'bogie', mass: 2.4, cog: [4.35, 0.45, 0], halfSize: [1.1, 0.45, 1.1], origin: [4.35, 0, 0] },
        { id: 'coupler1', name: '前车钩', kind: 'coupler', mass: 0.35, cog: [-7.1, 0.85, 0], halfSize: [0.4, 0.2, 0.2], origin: [-7.1, 0, 0] },
        { id: 'coupler2', name: '后车钩', kind: 'coupler', mass: 0.35, cog: [7.1, 0.85, 0], halfSize: [0.4, 0.2, 0.2], origin: [7.1, 0, 0] },
      ],
      liftPoints: [
        { id: 'lp-fl', name: '前端左吊点', offset: [-6.0, 1.3, -1.2] },
        { id: 'lp-fr', name: '前端右吊点', offset: [-6.0, 1.3, 1.2] },
        { id: 'lp-rl', name: '后端左吊点', offset: [6.0, 1.3, -1.2] },
        { id: 'lp-rr', name: '后端右吊点', offset: [6.0, 1.3, 1.2] },
      ],
    },
    {
      id: 'car-p70',
      name: 'P70 型棚车',
      bodyType: 'covered',
      length: 16.0, width: 3.18, height: 4.5,
      bogieSpacing: 10.1,
      builtIn: true,
      parts: [
        { id: 'body', name: '车体(侧墙+车顶+底架)', kind: 'body', mass: 21.8, cog: [0, 2.1, 0], halfSize: [7.7, 2.1, 1.55], origin: [0, 1.1, 0] },
        { id: 'bogie1', name: '前转向架', kind: 'bogie', mass: 2.5, cog: [-5.05, 0.45, 0], halfSize: [1.1, 0.45, 1.1], origin: [-5.05, 0, 0] },
        { id: 'bogie2', name: '后转向架', kind: 'bogie', mass: 2.5, cog: [5.05, 0.45, 0], halfSize: [1.1, 0.45, 1.1], origin: [5.05, 0, 0] },
        { id: 'coupler1', name: '前车钩', kind: 'coupler', mass: 0.35, cog: [-8.1, 0.85, 0], halfSize: [0.4, 0.2, 0.2], origin: [-8.1, 0, 0] },
        { id: 'coupler2', name: '后车钩', kind: 'coupler', mass: 0.35, cog: [8.1, 0.85, 0], halfSize: [0.4, 0.2, 0.2], origin: [8.1, 0, 0] },
      ],
      liftPoints: [
        { id: 'lp-fl', name: '前端左吊点', offset: [-7.0, 1.3, -1.2] },
        { id: 'lp-fr', name: '前端右吊点', offset: [-7.0, 1.3, 1.2] },
        { id: 'lp-rl', name: '后端左吊点', offset: [7.0, 1.3, -1.2] },
        { id: 'lp-rr', name: '后端右吊点', offset: [7.0, 1.3, 1.2] },
      ],
    },
    {
      id: 'car-g70',
      name: 'G70 型轻油罐车',
      bodyType: 'tank',
      tankLoad: 'half',
      length: 11.8, width: 3.0, height: 4.2,
      bogieSpacing: 7.9,
      builtIn: true,
      tank: {
        radius: 1.42,
        cylinderLength: 10.2,
        loadCogY: { empty: 1.95, half: 1.72, full: 2.05 },
        loadMass: { empty: 0, half: 30.5, full: 61.0 },
      },
      parts: [
        { id: 'body', name: '罐体+底架', kind: 'body', mass: 20.6, cog: [0, 1.95, 0], halfSize: [5.6, 1.5, 1.5], origin: [0, 1.1, 0] },
        { id: 'bogie1', name: '前转向架', kind: 'bogie', mass: 2.4, cog: [-3.95, 0.45, 0], halfSize: [1.1, 0.45, 1.1], origin: [-3.95, 0, 0] },
        { id: 'bogie2', name: '后转向架', kind: 'bogie', mass: 2.4, cog: [3.95, 0.45, 0], halfSize: [1.1, 0.45, 1.1], origin: [3.95, 0, 0] },
        { id: 'coupler1', name: '前车钩', kind: 'coupler', mass: 0.35, cog: [-6.0, 0.85, 0], halfSize: [0.4, 0.2, 0.2], origin: [-6.0, 0, 0] },
        { id: 'coupler2', name: '后车钩', kind: 'coupler', mass: 0.35, cog: [6.0, 0.85, 0], halfSize: [0.4, 0.2, 0.2], origin: [6.0, 0, 0] },
      ],
      liftPoints: [
        { id: 'lp-fl', name: '前端左吊座', offset: [-4.8, 1.6, -1.1] },
        { id: 'lp-fr', name: '前端右吊座', offset: [-4.8, 1.6, 1.1] },
        { id: 'lp-rl', name: '后端左吊座', offset: [4.8, 1.6, -1.1] },
        { id: 'lp-rr', name: '后端右吊座', offset: [4.8, 1.6, 1.1] },
      ],
    },
    {
      id: 'car-hxd',
      name: 'HXD 系列电力机车',
      bodyType: 'locomotive',
      length: 20.8, width: 3.1, height: 4.1,
      bogieSpacing: 9.0,
      builtIn: true,
      parts: [
        { id: 'body', name: '车体(含设备间)', kind: 'body', mass: 84.0, cog: [0, 1.8, 0], halfSize: [10.0, 1.9, 1.5], origin: [0, 1.1, 0] },
        { id: 'bogie1', name: '前转向架(三轴)', kind: 'bogie', mass: 14.0, cog: [-4.5, 0.5, 0], halfSize: [1.8, 0.5, 1.1], origin: [-4.5, 0, 0] },
        { id: 'bogie2', name: '后转向架(三轴)', kind: 'bogie', mass: 14.0, cog: [4.5, 0.5, 0], halfSize: [1.8, 0.5, 1.1], origin: [4.5, 0, 0] },
        { id: 'coupler1', name: '前车钩', kind: 'coupler', mass: 0.5, cog: [-10.6, 0.85, 0], halfSize: [0.5, 0.2, 0.2], origin: [-10.6, 0, 0] },
        { id: 'coupler2', name: '后车钩', kind: 'coupler', mass: 0.5, cog: [10.6, 0.85, 0], halfSize: [0.5, 0.2, 0.2], origin: [10.6, 0, 0] },
      ],
      liftPoints: [
        { id: 'lp-fl', name: '前端左吊销', offset: [-9.0, 1.4, -1.2] },
        { id: 'lp-fr', name: '前端右吊销', offset: [-9.0, 1.4, 1.2] },
        { id: 'lp-rl', name: '后端左吊销', offset: [9.0, 1.4, -1.2] },
        { id: 'lp-rr', name: '后端右吊销', offset: [9.0, 1.4, 1.2] },
      ],
    },
  ];
}

// ---------------- 起重机 ----------------

export function seedCrane(): CraneModel {
  // 性能表 (t): 全伸支腿。行=臂长(m), 列=工作半径(m), 数据按 160t 级救援吊典型包络生成。
  const radii = [3, 4, 5, 6, 8, 10, 12, 16, 20, 24];
  const boomLengths = [13.5, 18, 22.5, 27, 31.5, 36];
  // 基准: 半径 3m 主臂 13.5m 起 160t, 随半径与臂长递减
  const capacities = boomLengths.map((L) => radii.map((r) => {
    const base = 160 * (3 / r) ** 1.15;
    const lengthFactor = 1 - 0.028 * (L - 13.5);
    return Math.max(5.5, Math.round(base * lengthFactor * 10) / 10);
  }));

  return {
    id: 'crane-ns1600',
    name: 'NS1600 型 160t 铁路救援起重机',
    ratedCapacity: 160,
    chassisMass: 42,
    superstructureMass: 28,
    boomMassPerMeter: 0.85,
    hookMass: 1.8,
    slewBaseHeight: 2.1,
    boomFootOffset: [0, 1.1, 0],
    baseBoomLength: 13.5,
    sectionStroke: 4.5,
    sectionCount: 5,
    luffMinDeg: 15,
    luffMaxDeg: 78,
    maxHoist: 26,
    speedLimits: {
      slew: deg2rad(1.5),   // 1.5 °/s
      luff: deg2rad(2.0),   // 2 °/s
      telescope: 0.25,      // m/s
      hoist: 0.6,           // m/s
    },
    outriggers: [
      { id: 'og-fl', name: '左前支腿', position: [-2.6, 0, -3.1], padSize: 1.6, blockOptions: [0, 1, 2, 3] },
      { id: 'og-fr', name: '右前支腿', position: [2.6, 0, -3.1], padSize: 1.6, blockOptions: [0, 1, 2, 3] },
      { id: 'og-rl', name: '左后支腿', position: [-2.6, 0, 3.1], padSize: 1.6, blockOptions: [0, 1, 2, 3] },
      { id: 'og-rr', name: '右后支腿', position: [2.6, 0, 3.1], padSize: 1.6, blockOptions: [0, 1, 2, 3] },
    ],
    loadCharts: [
      { outriggerMode: 'full', radii, boomLengths, capacities },
      {
        outriggerMode: 'extended',
        radii, boomLengths,
        capacities: capacities.map((row) => row.map((v) => Math.round(v * 0.65 * 10) / 10)),
      },
      {
        outriggerMode: 'retracted',
        radii, boomLengths,
        capacities: capacities.map((row) => row.map((v) => Math.round(v * 0.35 * 10) / 10)),
      },
    ],
    counterweightOffset: [0, 0.8, 4.2],
    counterweightMass: 42,
    builtIn: true,
  };
}

// ---------------- 现场 ----------------

export function seedSites(): SiteParams[] {
  return [
    {
      id: 'site-straight-embank',
      name: '直线高路堤单线脱轨',
      curveRadius: 0,
      embankmentHeight: 6.5,
      shoulderWidth: 0.8,
      gauge: 1.435,
      mastSpacing: 55,
      mastOffset: 6.5,
      wireHeight: 6.3,
      allowableBearing: 180,
      builtIn: true,
    },
    {
      id: 'site-curve-shoulder',
      name: '曲线窄路肩脱轨',
      curveRadius: 600,
      embankmentHeight: 3.0,
      shoulderWidth: 0.5,
      gauge: 1.435,
      mastSpacing: 50,
      mastOffset: 5.6,
      wireHeight: 6.3,
      allowableBearing: 150,
      builtIn: true,
    },
    {
      id: 'site-double-track',
      name: '双线区间邻线带电脱轨',
      curveRadius: 0,
      embankmentHeight: 4.0,
      shoulderWidth: 1.0,
      gauge: 1.435,
      mastSpacing: 60,
      mastOffset: 4.8,
      wireHeight: 6.4,
      allowableBearing: 200,
      builtIn: true,
    },
    {
      id: 'site-station-siding',
      name: '站场股道平地基脱轨',
      curveRadius: 0,
      embankmentHeight: 0.6,
      shoulderWidth: 1.6,
      gauge: 1.435,
      mastSpacing: 65,
      mastOffset: 8.0,
      wireHeight: 6.5,
      allowableBearing: 220,
      builtIn: true,
    },
  ];
}

/** 为每个现场生成一套典型事故编排 (单台车 + 一台救援吊) */
export function seedScenes(sites: SiteParams[]): AccidentScene[] {
  return sites.map((site, i) => {
    const cars: AccidentScene['cars'] = [
      {
        carTypeId: i === 2 ? 'car-g70' : 'car-c70',
        position: [0, 0.9, 0],
        rotation: [0, deg2rad(8), i === 1 ? deg2rad(35) : deg2rad(12)],
        bogieDetached: i === 3,
      },
    ];
    const pose = defaultCranePose([0, 0, -5.5], 0);
    return {
      id: `scene-${site.id}`,
      name: site.name,
      siteId: site.id,
      cars,
      craneIds: ['crane-ns1600'],
      cranePoses: [pose],
    };
  });
}
