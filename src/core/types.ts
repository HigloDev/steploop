export type CarryMode = 'pocket' | 'waist'
export type MarkerType = 'turn' | 'landing' | 'pause' | 'manual_turn' | 'manual_floor'
export type TurnDirection = 'left' | 'right'
export type RouteStatus = 'draft' | 'needs_validation' | 'verified'
// free：首次开张轮次，无模板对照，仅基于气压计估楼层；结束后用采集数据生成模板
export type ClimbMode = 'validation' | 'formal' | 'free'

// 人工标记：用户在采集过程中点击「标记拐弯」或「到达新楼层」时记录
export interface ManualMark {
  id: string
  type: 'turn' | 'floor'
  atMs: number          // 相对采集开始的毫秒时间戳
  floor?: number        // type='floor' 时为该标记对应的楼层
  note?: string
}

export interface SensorSample {
  t: number
  ax: number
  ay: number
  az: number
  gx: number
  gy: number
  gz: number
  alpha: number
  beta: number
  gamma: number
  // 气压（hPa）。部分设备无气压计，缺失时为 undefined
  pressure?: number
}

// 气压计状态：用于 UI 提示用户气压计是否连上
export interface BarometerStatus {
  available: boolean     // 设备是否有气压计
  running: boolean       // 是否正在采样
  pressure: number       // 最新气压值（hPa）
  lastSampleAt: number   // 上次采样时间戳
}

export interface FeatureFrame {
  startMs: number
  endMs: number
  steps: number
  cadence: number
  energy: number
  turnRad: number
  paused: number
}

export interface RouteMarker {
  id: string
  type: MarkerType
  atMs: number
  endMs?: number
  direction?: TurnDirection
  confidence: number
}

export interface RouteSegment {
  id: string
  type: 'flight'
  startMs: number
  endMs: number
  floorFrom: number
  floorTo: number
  ascentM: number
  stepCount: number
  features: number[][]
}

export interface DeviceFingerprint {
  platform: string
  model: string
  system: string
}

export interface RouteLocation {
  name: string
  address: string
  latitude: number
  longitude: number
  accuracy: number
  source: 'gps' | 'map'
  confirmedAt: number
}

export interface InferredRoute {
  estimatedFloorCount: number
  estimatedStepCount: number
  estimatedAscentM: number
  defaultRiserM: number
  floorBoundaries: number[]
  turnCount: number
  landingCount: number
  confidence: {
    floors: number
    height: number
    overall: number
  }
}

export interface RouteTemplate {
  id: string
  name: string
  startFloor: number
  endFloor: number
  carryMode: CarryMode
  floorHeightM: number
  totalAscentM: number
  device: DeviceFingerprint
  segments: RouteSegment[]
  markers: RouteMarker[]
  createdAt: number
  updatedAt: number
  version: number
  status: RouteStatus
  verifiedAt?: number
  location?: RouteLocation
}

export interface RouteSeed {
  routeId?: string
  name: string
  carryMode: CarryMode
  location: RouteLocation
}

export interface CalibrationDraft {
  seed: RouteSeed
  samples: SensorSample[]
  frames: FeatureFrame[]
  markers: RouteMarker[]
  boundaries: number[]
  inferred: InferredRoute
  startedAt: number
  endedAt: number
  gaps: Array<{ startMs: number; endMs: number }>
  manualMarks: ManualMark[]
  // 垂直位移估算（基于加速度二次积分，单位 m）
  estimatedAscentM?: number
  // 楼层边界来源：人工标记 / 气压计 / 算法估算（缺失视为 inferred）
  boundarySource?: 'manual' | 'barometer' | 'inferred'
  // 爬升估算来源：气压反算 / 步数估算（缺失视为 step）
  ascentSource?: 'barometer' | 'step'
}

export interface RecognitionEvent {
  t: number
  type: 'floor' | 'turn' | 'pause' | 'resume' | 'gap'
  floor?: number
  direction?: TurnDirection
  confidence: number
}

export interface ClimbSession {
  id: string
  templateId: string
  templateVersion: number
  startedAt: number
  endedAt: number
  startFloor: number
  finalFloor: number
  floorsCompleted: number
  ascentM: number
  steps: number
  confidence: number
  complete: boolean
  events: RecognitionEvent[]
  floorSplits: Array<{ floor: number; atMs: number; elapsedMs: number }>
  interruptions: Array<{ startMs: number; endMs: number }>
  mode?: ClimbMode
  routeSnapshot?: {
    name: string
    locationName: string
    startFloor: number
    endFloor: number
    totalAscentM: number
  }
  durationMs?: number
  averageFloorMs?: number
  bestFloorSplitMs?: number
  sharePosterCreatedAt?: number
  // 仅 mode='free' 时填充：第一轮采集的原始样本，用于结束后生成路线模板。
  // 其他模式下不填，避免持久化时写入大量数据。
  samples?: SensorSample[]
}

export interface RecognitionSnapshot {
  currentFloor: number
  floorsCompleted: number
  ascentM: number
  steps: number
  confidence: number
  status: 'matching' | 'low_confidence' | 'paused' | 'complete'
  lastTurn?: TurnDirection
  // 本轮净爬楼时间（毫秒）：只累计有真实动作的帧（步数>0 或能量达标），
  // 原地等待、休息、电梯等静止时间不计入。用于卡路里与净用时统计。
  activeMs: number
}

// 爬楼路线图：基于人工楼层标记分段后的单层数据
export interface FloorSplit {
  floor: number                 // 该层楼层号
  startMs: number               // 该段起始时间（相对采集开始）
  endMs: number                 // 该段结束时间
  durationMs: number            // 该段用时
  stepCount: number             // 该段步数（自动检测）
  turnCount: number             // 该段拐弯次数（自动+人工）
  ascentM: number               // 该段爬升估算
}

// ===== 多轮训练（Workout）类型 =====
// 一次训练 ClimbWorkout 包含一轮或多轮 WorkoutRound。
// 旧 ClimbSession 保留不动，新增类型平行存在。

export type RoundCompletionReason =
  | 'route_complete'
  | 'manual_finish'
  | 'interrupted'
  | 'cancelled'

export type WorkoutStatus = 'planned' | 'active' | 'completed' | 'cancelled'

export type WorkoutGoalType = 'open' | 'rounds' | 'floors' | 'ascent' | 'duration'

export type WorkoutGoal =
  | { type: 'open' }
  | { type: 'rounds'; targetRounds: number }
  | { type: 'floors'; targetFloors: number }
  | { type: 'ascent'; targetAscentM: number }
  | { type: 'duration'; targetActiveDurationMs: number }

export type ReturnConfirmationMode = 'manual' | 'assisted'

// 训练阶段。放 types.ts 避免与 ActiveWorkoutCheckpoint 循环依赖。
// 'countdown' 为遗留阶段：倒计时功能已移除，仅旧检查点中可能出现，
// 恢复训练时一律视为 round_ready。
export type WorkoutPhase =
  | 'setup'
  | 'round_ready'
  | 'countdown'
  | 'ascending'
  | 'round_complete'
  | 'returning'
  | 'start_confirmation'
  | 'recovering'
  | 'workout_complete'

export interface WorkoutRound {
  id: string
  roundNumber: number
  startedAt: number
  endedAt: number
  durationMs: number
  startFloor: number
  targetFloor: number
  finalFloor: number
  floorsCompleted: number
  ascentM: number
  steps: number
  confidence: number
  complete: boolean
  completionReason: RoundCompletionReason
  floorSplits: Array<{
    floorFrom: number
    floorTo: number
    reachedAtMs: number
    splitDurationMs: number
    steps?: number
    confidence?: number
  }>
  events: RecognitionEvent[]
  interruptions: Array<{ startMs: number; endMs: number }>
  averageFloorMs?: number
  bestFloorSplitMs?: number
  returnedToStartAt?: number
  returnDurationMs?: number
  recoveryDurationMs?: number
}

export interface ClimbWorkout {
  id: string
  templateId: string
  templateVersion: number
  routeSnapshot: {
    name: string
    locationName: string
    startFloor: number
    endFloor: number
    floorsPerRound: number
    ascentPerRoundM: number
  }
  goal: WorkoutGoal
  returnConfirmationMode: ReturnConfirmationMode
  // @deprecated 倒计时功能已移除，保留字段仅为读取旧训练数据
  countdownSeconds?: number
  status: WorkoutStatus
  startedAt: number
  endedAt?: number
  rounds: WorkoutRound[]
  currentRoundNumber: number
  totalRoundsCompleted: number
  totalFloorsCompleted: number
  totalAscentM: number
  totalSteps: number
  activeDurationMs: number
  returnDurationMs: number
  recoveryDurationMs: number
  totalElapsedMs: number
  bestRoundMs?: number
  averageRoundMs?: number
  latestRoundMs?: number
  sharePosterCreatedAt?: number
  createdAt: number
  updatedAt: number
}

export interface WorkoutSummary {
  totalRounds: number
  completeRounds: number
  totalFloors: number
  totalAscentM: number
  totalSteps: number
  activeDurationMs: number
  returnDurationMs: number
  recoveryDurationMs: number
  totalElapsedMs: number
  bestRoundMs?: number
  worstRoundMs?: number
  averageRoundMs?: number
  latestRoundMs?: number
  firstHalfAvgMs?: number
  secondHalfAvgMs?: number
  secondHalfDeclinePct?: number   // 后半程衰减百分比
  coefficientOfVariation?: number // 变异系数
}

export interface ActiveWorkoutCheckpoint {
  workoutId: string
  phase: WorkoutPhase
  currentRoundNumber: number
  savedAt: number
  completedRounds: WorkoutRound[]
  // 恢复训练所需的最小参数快照
  templateId: string
  goal: WorkoutGoal
  returnConfirmationMode: ReturnConfirmationMode
  // @deprecated 倒计时功能已移除，保留字段仅为读取旧检查点
  countdownSeconds?: number
  startedAt: number
  // ascending 阶段本轮开始时间。应用被杀导致中断时，恢复流程据此构造
  // completionReason='interrupted' 的轮次记录（旧检查点无此字段，用 savedAt 兜底）
  currentRoundStartedAt?: number
}

export type HistoryItem =
  | { type: 'legacy_session'; session: ClimbSession }
  | { type: 'workout'; workout: ClimbWorkout }
