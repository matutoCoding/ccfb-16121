// 全系统领域模型。单位约定: 长度 mm 输入、内部统一 m; 质量 t; 力 kN; 角度内部弧度、界面度。

export type Vec3M = [number, number, number];

export interface LiftingPoint {
  id: string;
  name: string;
  /** 相对车体坐标系 (车钩连线为 X, 竖直向上为 Y), m */
  offset: Vec3M;
}

export type CarBodyType = 'open' | 'covered' | 'tank' | 'locomotive';
export type TankLoad = 'empty' | 'half' | 'full';

export interface CarPart {
  id: string;
  name: string;
  kind: 'body' | 'bogie' | 'coupler';
  /** 质量 t */
  mass: number;
  /** 重心相对部件原点, m */
  cog: Vec3M;
  /** 包围盒半尺寸, m (干涉检测用) */
  halfSize: Vec3M;
  /** 部件原点相对车辆原点 */
  origin: Vec3M;
}

export interface CarType {
  id: string;
  name: string;
  bodyType: CarBodyType;
  /** 车体长度 m */
  length: number;
  width: number;
  height: number;
  /** 转向架中心距 m */
  bogieSpacing: number;
  parts: CarPart[];
  liftPoints: LiftingPoint[];
  /** 罐车专用: 罐体半径与长度, 三种装载的重心高度系数 */
  tank?: {
    radius: number;
    cylinderLength: number;
    loadCogY: Record<TankLoad, number>; // 相对车体原点的重心高
    loadMass: Record<TankLoad, number>; // 货物质量 t
  };
  tankLoad?: TankLoad;
  builtIn?: boolean;
}

/** 起重性能表: 支腿工况 -> 半径(m) x 臂长(m) 的额定起重量(t) 矩阵 */
export interface LoadChart {
  outriggerMode: string; // 'full' | 'extended' | 'retracted'
  radii: number[];
  boomLengths: number[];
  /** capacities[臂长序号][半径序号], t */
  capacities: number[][];
}

export interface SpeedLimits {
  /** 回转速度上限 rad/s */
  slew: number;
  /** 变幅角速度上限 rad/s */
  luff: number;
  /** 伸缩速度 m/s */
  telescope: number;
  /** 起升速度 m/s */
  hoist: number;
}

export interface OutriggerSpec {
  id: string;
  name: string; // 左前/右前/左后/右后
  /** 完全伸出时相对回转中心的水平位置 m */
  position: Vec3M;
  /** 支腿盘尺寸 m (方形边长) */
  padSize: number;
  /** 垫木可选层数 */
  blockOptions: number[];
}

export interface CraneModel {
  id: string;
  name: string;
  /** 额定起重能力 t */
  ratedCapacity: number;
  /** 底盘质量 t */
  chassisMass: number;
  /** 转台(含配重)质量 t */
  superstructureMass: number;
  /** 主臂单位长度质量 t/m */
  boomMassPerMeter: number;
  /** 吊钩组质量 t */
  hookMass: number;
  /** 转台回转中心相对底盘原点高度 m */
  slewBaseHeight: number;
  /** 臂根铰点相对回转中心偏移 m */
  boomFootOffset: Vec3M;
  /** 基本臂长 / 每节伸缩行程 / 节数 */
  baseBoomLength: number;
  sectionStroke: number;
  sectionCount: number;
  /** 变幅角范围 度 */
  luffMinDeg: number;
  luffMaxDeg: number;
  /** 起升绳最大长度 m */
  maxHoist: number;
  speedLimits: SpeedLimits;
  outriggers: OutriggerSpec[];
  loadCharts: LoadChart[];
  /** 配重相对回转中心位置 m */
  counterweightOffset: Vec3M;
  counterweightMass: number;
  builtIn?: boolean;
}

/** 起重机运行姿态 (方案与推演的状态量) */
export interface CranePose {
  /** 底盘世界位置 (回转中心水平投影处) m */
  position: Vec3M;
  /** 底盘朝向 (弧度, 0 时臂指向 +X) */
  heading: number;
  /** 回转角 弧度 */
  slew: number;
  /** 变幅角 弧度 (相对水平面) */
  luff: number;
  /** 伸缩节伸出量, 每节 0..1 */
  sections: number[];
  /** 起升绳长度 m */
  hoist: number;
  /** 吊钩摆角 (顺臂/垂直臂方向), 弧度 */
  swingAlong: number;
  swingAcross: number;
  /** 每条支腿: 已伸到位、垫木层数 */
  outriggers: { deployed: boolean; blocks: number }[];
}

export interface OutriggerResult {
  id: string;
  name: string;
  position: Vec3M;
  /** 支反力 kN */
  reaction: number;
  /** 接地面积 m2 (含垫木扩散) */
  area: number;
  /** 地面比压 kPa */
  bearingPressure: number;
  /** 超过路基承载力 */
  overloaded: boolean;
  /** 最小范数解给出负值时表示该腿离地 */
  lifted: boolean;
}

export interface CraneKinematics {
  /** 当前臂长 m */
  boomLength: number;
  /** 工作半径 m (回转中心到吊钩/臂尖水平距离) */
  radius: number;
  /** 臂尖世界坐标 */
  boomTip: Vec3M;
  /** 臂根世界坐标 */
  boomFoot: Vec3M;
  /** 吊钩世界坐标 (含摆动) */
  hook: Vec3M;
  /** 不计摆角的铅垂吊钩坐标 — 与按臂长半径手算结果一致, 供 1cm 校验 */
  hookPlumb: Vec3M;
  /** 各节点世界变换 (渲染直接消费) */
  nodes: Record<string, Float32Array>;
}

export interface SlingState {
  carPointIds: string[];
  /** 吊索长度 m */
  lengths: number[];
  /** 两索夹角 度 */
  includedAngleDeg: number;
  /** 与车体包围盒最小净距 m (<0 即蹭到) */
  clearance: number;
}

export interface SiteParams {
  id: string;
  name: string;
  /** 直线/曲线 (曲线半径 m, 0 为直线) */
  curveRadius: number;
  /** 路堤高度 m */
  embankmentHeight: number;
  /** 路肩宽度 m */
  shoulderWidth: number;
  /** 轨距 m */
  gauge: number;
  /** 邻线接触网立柱间距/距本线中心距离 m */
  mastSpacing: number;
  mastOffset: number;
  /** 导线高度 m */
  wireHeight: number;
  /** 路基容许承载力 kPa */
  allowableBearing: number;
  builtIn?: boolean;
}

export interface DerailedCar {
  carTypeId: string;
  /** 车体世界位置 m */
  position: Vec3M;
  /** 姿态角 弧度 (侧翻主要体现为 roll/z) */
  rotation: Vec3M;
  /** 是否转向架与车体分离吊 */
  bogieDetached: boolean;
}

export interface AccidentScene {
  id: string;
  name: string;
  siteId: string;
  cars: DerailedCar[];
  /** 现场起重机配置 */
  craneIds: string[];
  cranePoses: CranePose[];
}

export type CraneActionType = 'slew' | 'luff' | 'telescope' | 'hoist' | 'combined';

export interface CraneAction {
  type: CraneActionType;
  craneIndex: number;
  /** 目标姿态字段 */
  target: Partial<CranePose>;
  /** 备注 (如 "车体抬离轨面 200mm") */
  note?: string;
}

export interface PlanStep {
  id: string;
  name: string;
  durationSec: number;
  actions: CraneAction[];
}

export interface RescuePlan {
  id: string;
  name: string;
  sceneId: string;
  steps: PlanStep[];
  createdAt: number;
  updatedAt: number;
}

/** 推演每帧快照 (回放与危险帧清单的数据源) */
export interface FrameSnapshot {
  t: number;
  cranes: {
    pose: CranePose;
    radius: number;
    boomLength: number;
    loadRatio: number;
    hook: Vec3M;
    boomTip: Vec3M;
    boomFoot: Vec3M;
    reactions: OutriggerResult[];
    liftedLoad: number;
    /** 臂架到接触网导线/立柱最小净距 m */
    wireClearance: number;
    mastClearance: number;
  }[];
  carPositions: { position: Vec3M; rotation: Vec3M }[];
  slingAlerts: string[];
  locked: boolean;
}

export interface DangerFrame {
  frameIndex: number;
  t: number;
  reason: string;
  severity: 'warn' | 'danger';
}
