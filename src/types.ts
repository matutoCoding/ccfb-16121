import type { Vec3 } from './core/mat4';

// ---------- 通用 ----------

export type ID = string;

export interface NamedItem {
  id: ID;
  name: string;
}

/** 可编辑的物理部件：车体/转向架/车钩等 */
export interface RigidPart {
  id: ID;
  name: string;
  /** 外形尺寸（米），用于渲染与碰撞粗检 */
  size: Vec3;
  /** 相对所属部件原点的局部偏移 */
  offset: Vec3;
  /** 质量（吨） */
  massT: number;
  /** 重心相对部件原点的局部坐标（米） */
  cogLocal: Vec3;
}

/** 吊点定义（相对车体原点的局部坐标） */
export interface LiftPoint {
  id: ID;
  name: string;
  position: Vec3;
}

// ---------- 车型库 ----------

export type CarKind = 'open' | 'covered' | 'tank' | 'locomotive';
export type TankLoad = 'empty' | 'half' | 'full';

export interface CarModel extends NamedItem {
  kind: CarKind;
  /** 车长/宽/高（米） */
  length: number;
  width: number;
  height: number;
  body: RigidPart;
  bogies: RigidPart[];
  couplers: RigidPart[];
  liftPoints: LiftPoint[];
  /** 罐车专用：三种装载下的整备质量（吨）与重心高度偏移（米，相对空车重心） */
  tankLoads?: Record<TankLoad, { totalMassT: number; cogShiftY: number }>;
  /** 当前装载（仅罐车用） */
  tankLoad?: TankLoad;
  /** 轨距（米），标准轨距 1.435 */
  gauge: number;
  /** 定距（前后转向架中心距，米） */
  bogieSpacing: number;
  /** 轮径（米） */
  wheelDiameter: number;
}

// ---------- 起重机 ----------

/** 性能表一个支腿状态 */
export interface OutriggerStatePerf {
  /** 支腿跨距状态标识，如 'full' | 'half' | 'none' */
  state: string;
  label: string;
  radii: number[];
  boomLengths: number[];
  /** grid[r][b] 额定起重量（吨） */
  grid: number[][];
}

export interface SpeedLimits {
  /** 回转速度上限（度/秒） */
  slewDegPerSec: number;
  /** 变幅速度上限（度/秒） */
  luffDegPerSec: number;
  /** 起升速度上限（米/秒） */
  hoistMPerSec: number;
  /** 伸缩臂速度上限（米/秒） */
  extendMPerSec: number;
}

export interface CraneModel extends NamedItem {
  /** 额定起重力矩标识，如 160t */
  ratedCapacityT: number;
  /** 整机自重（吨，含吊钩） */
  selfWeightT: number;
  /** 上部回转中心相对底盘原点高度（米） */
  slewBaseHeight: number;
  /** 主臂根铰点相对回转中心的局部位置（米） */
  boomFoot: Vec3;
  /** 主臂节配置：base 第一节固定，其余可伸缩 */
  boomSections: { id: ID; name: string; minLen: number; maxLen: number }[];
  /** 变幅角范围（度，相对水平面） */
  luffMinDeg: number;
  luffMaxDeg: number;
  /** 吊钩/吊具自重（吨） */
  hookBlockMassT: number;
  /** 四条支腿相对底盘中心的标准位置（米），顺序: 左前 右前 左后 右后 */
  outriggerBase: Vec3[];
  /** 支腿垫板单块尺寸（米）与单块厚度（米） */
  padSize: number;
  padThickness: number;
  speedLimits: SpeedLimits;
  loadCharts: OutriggerStatePerf[];
}

/** 起重机在现场中的一个站位实例 */
export interface CranePlacement {
  id: ID;
  craneModelId: ID;
  /** 底盘中心世界坐标（米，y 为地面高） */
  position: Vec3;
  /** 底盘朝向（度，绕 y，0 时臂沿 +z） */
  headingDeg: number;
  /** 每条支腿的实际位置（世界坐标 xy，米）与垫木块数 */
  outriggers: { position: Vec3; woodLayers: number }[];
  /** 采用的性能表支腿状态 */
  chartState: string;
}

// ---------- 事故现场 ----------

export interface CatenaryPole {
  id: ID;
  /** 世界坐标（米） */
  position: Vec3;
  /** 立柱高度（米） */
  height: number;
  /** 导线悬挂点相对柱顶偏移（米），向线路侧伸出 */
  wireArm: number;
  /** 导线高度（米，轨面以上） */
  wireHeight: number;
}

export interface AccidentScene extends NamedItem {
  /** 线路走向（度，绕 y） */
  lineHeadingDeg: number;
  /** 直线/曲线（米，0 为直线，否则曲率半径） */
  curveRadius: number;
  /** 路堤高度（米） */
  embankmentHeight: number;
  /** 路肩宽度（米） */
  shoulderWidth: number;
  /** 线间距（米） */
  trackSpacing: number;
  /** 路基容许承载力（kPa） */
  allowableBearingKPa: number;
  /** 接触网立柱（邻线） */
  poles: CatenaryPole[];
  /** 相邻立柱间距（米），用于生成导线 */
  poleSpacing: number;
}

/** 脱轨车辆实例 */
export interface DerailedCar {
  id: ID;
  carModelId: ID;
  /** 车体原点世界坐标 */
  position: Vec3;
  /** 车体姿态（度）：侧滚 roll / 航向 yaw / 俯仰 pitch */
  rotationDeg: Vec3;
  /** 转向架是否已与车体分离 */
  bogiesDetached: boolean;
  /** 分离时转向架位置（未分离忽略） */
  bogiePositions?: Vec3[];
}

// ---------- 吊复方案 ----------

export type CraneActionType = 'slew' | 'luff' | 'hoist' | 'extend';

export interface CraneAction {
  type: CraneActionType;
  /** 目标值：slew/luff 为度，hoist 为吊钩高度（世界 y，米），extend 为臂节伸出量数组（米） */
  target: number | number[];
  /** 该动作时长（秒），0 表示按速度上限自动计算 */
  durationSec: number;
}

export interface PlanStep {
  id: ID;
  name: string;
  /** 每台起重机的动作串，key 为 placementId */
  actions: Record<ID, CraneAction[]>;
  /** 本步涉及的吊点连接（placementId -> 车体吊点 id），空数组表示保持不变 */
  rigging?: { placementId: ID; carId: ID; liftPointId: ID }[];
  /** 本步结束后是否摘除吊钩 */
  unrigAfter?: boolean;
}

export interface RescuePlan extends NamedItem {
  sceneId: ID;
  cranePlacements: CranePlacement[];
  derailedCars: DerailedCar[];
  steps: PlanStep[];
  createdAt: number;
  updatedAt: number;
}

// ---------- 推演帧快照 ----------

export interface OutriggerSnapshot {
  position: Vec3;
  woodLayers: number;
  /** 支反力（千牛，正为受压） */
  reactionKN: number;
  /** 地面比压（kPa） */
  bearingKPa: number;
  overloaded: boolean;
}

export interface CraneFrameSnapshot {
  placementId: ID;
  slewDeg: number;
  luffDeg: number;
  boomLength: number;
  radius: number;
  hookPosition: Vec3;
  hookHeight: number;
  /** 实际吊重（吨，含吊钩与索具） */
  liftedMassT: number;
  /** 额定起重量（吨） */
  ratedCapacityT: number;
  /** 吊载率（%） */
  loadRatioPct: number;
  locked: boolean;
  outriggers: OutriggerSnapshot[];
  /** 支反力合计（千牛） */
  reactionSumKN: number;
  /** 理论应承受总竖向力（千牛）：自重+吊重 */
  expectedTotalKN: number;
  /** 主臂与最近接触网立柱/导线的净空（米） */
  catenaryClearanceM: number;
}

export interface SlingSnapshot {
  placementId: ID;
  carId: ID;
  liftPointId: ID;
  /** 两绳夹角（度） */
  includedAngleDeg: number;
  /** 单绳拉力（千牛） */
  ropeTensionKN: number;
  /** 是否与车体干涉 */
  bodyInterference: boolean;
  angleWarning: boolean;
}

export interface FrameSnapshot {
  /** 帧时间（秒） */
  t: number;
  cranes: CraneFrameSnapshot[];
  slings: SlingSnapshot[];
  /** 被吊车体位置/姿态 */
  cars: { carId: ID; position: Vec3; rotationDeg: Vec3; lifted: boolean }[];
  /** 本帧危险项 */
  hazards: string[];
}

// ---------- 回放与方案单 ----------

export interface DangerMark {
  frameIndex: number;
  t: number;
  reason: string;
  severity: 'warn' | 'danger';
}
