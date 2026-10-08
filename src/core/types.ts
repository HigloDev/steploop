export type CarryMode = 'pocket' | 'waist'
export type MarkerType = 'turn' | 'landing' | 'pause' | 'manual_turn' | 'manual_floor'
export type TurnDirection = 'left' | 'right'
export type RouteStatus = 'draft' | 'needs_validation' | 'verified'
// free：首次开张轮次，无模板对照，仅基于气压计估楼层；结束后用采集数据生成模板
export type ClimbMode = 'validation' | 'formal' | 'free'
export type RecognitionQuality = 'stable' | 'degraded' | 'invalid'
export type RecognitionEvidenceSource =
  | 'motion'
  | 'barometer'
  | 'turn'
  | 'route_template'
  | 'manual'

export interface RecognitionEvidence {
  source: RecognitionEvidenceSource
  score: number
  observedAt: number
  reasonCode: string
}

export interface RecognitionDecision {
  type: 'candidate_floor' | 'confirmed_floor' | 'route_complete' | 'rejected'
  floor: number
  confidence: number
  evidence: RecognitionEvidence[]
  quality: RecognitionQuality
  negative_gate?: 'elevator'
}

// 人工标记：用户在采集过程中点击「标记拐弯」或「到达新楼层」时记录
export interface ManualMark {
  id: string
  type: 'turn' | 'floor'
  atMs: number          // 相对采集开始的毫秒时间戳
  floor?: number        // type='floor' 时为该标记对应的楼层
  estimatedFloor?: number // 标记之前的估计值，供独立核对，不被人工值覆盖。
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
  // 陀螺仪在“重力方向”上的旋转分量。它代表人绕竖直方向转弯，
  // 不受手机横放、竖放或在口袋里倾斜的影响；旧模板仍使用 turnRad 匹配。
  headingTurnRad?: number
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
  turnCount?: number
  boundaryConfirmed?: boolean
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
  preparation?: import('./route-preparation').RoutePreparation
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
  modelVersion?: 3
  algorithmVersion?: string
  // DTW 特征向量空间：'heading' 用重力轴转向，'device' 用设备 Z 轴。
  // 缺省视为旧模板（device）或尚未标记；新学习/导入默认 heading。
  featureSpace?: 'heading' | 'device'
  // 新训练生成的模板只按合格轮次统计学习；缺省保留旧模板的初始学习基线。
  learningProvenance?: 'training_rounds'
  learning?: RouteLearningModel
  motionReference?: {
    version: 1
    carryMode: CarryMode
    allBoundariesMarked: boolean
    checkedRuns: number
    checkedDays: string[]
    checkedSessionIds?: string[]
    floorAnchors: Array<{ floor: number; atMs: number }>
  }
  deviceCapabilities?: {
    barometerAvailable: boolean | 'unknown'
    effectiveSamplingHz: number | null
  }
}

export interface DistributionSummary {
  count: number
  mean: number
  standardDeviation: number
  minimum: number
  maximum: number
}

export interface RouteLearningModel {
  sampleCount: number
  stability: number
  lastLearnedAt?: number
  state: 'unlearned' | 'learning' | 'usable' | 'verified' | 'needs_review'
  reasonCode:
    | 'no_eligible_samples'
    | 'collecting_samples'
    | 'consistent_samples'
    | 'verified_samples'
    | 'sample_conflict'
  floorHeightM: DistributionSummary
  stepsPerFloor: DistributionSummary
  durationPerFloorMs: DistributionSummary
  turnsPerFloor: DistributionSummary
}

export interface RouteSeed {
  routeId?: string
  name: string
  carryMode: CarryMode
  /**
   * 建筑起点位置。
   * 可选：自由训练/拒绝定位/飞行模式下的首轮建模板没有地点，
   * 仍然要能生成可用的路线模板（只是不进入地图统计）。
   */
  location?: RouteLocation
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
  // 楼层推进的轻量诊断信息，便于真机复盘，不保存整段原始传感器数据。
  source?: 'motion' | 'barometer'
  heightM?: number
  stepEvidence?: number
  turnEvidence?: number
  evidence?: RecognitionEvidence[]
  reasonCode?: string
}

export interface RecognitionEndState {
  segmentIndex: number
  expectedSegments: number
  currentFloor: number
  estimatedHeightM: number
  requiredHeightM: number
  pendingSteps: number
  pendingTurns: number
  barometerAvailable: boolean
}

export interface ClimbSession {
  floorConfirmation?: 'automatic' | 'manual' | 'pending'
  recognitionVersion?: 'motion-v3'
  manualFloorMarks?: ManualMark[]
  id: string
  evidenceId?: string
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
  recognitionEndState?: RecognitionEndState
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
  quality: RecognitionQuality
  statusReason: string
  candidateFloor?: number
  canAutoComplete: boolean
  activeSensorSources: RecognitionEvidenceSource[]
  floorStatus?: 'estimated' | 'needs_confirmation'
  pressureDirection?: 'up' | 'down' | 'level' | 'unknown'
  pressureReliable?: boolean
  motionActivity?: 'stairs_up' | 'stairs_down' | 'walking' | 'elevator' | 'waiting' | 'uncertain'
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

/** 用户选择的流程自动化程度，与 free/formal 识别算法模式分开。 */
export type TrackingMode = 'manual' | 'automatic' | 'full_auto'

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

/** 成绩来源：算法自动识别 / 用户人工修正 / 中断恢复。 */
export type RoundResultSource = 'automatic' | 'manual' | 'recovered'

/**
 * 一次人工修正的前后快照。
 * 契约：原值永不覆盖，只追加到 `WorkoutRound.corrections`；
 * 修正不得提高算法置信度，且默认让该轮退出算法学习。
 */
export interface RoundCorrectionSnapshot {
  finalFloor: number
  floorsCompleted: number
  ascentM: number
  complete: boolean
  confidence: number
}

export interface RoundCorrection {
  id: string
  at: number
  /** 修正前的值（原始算法输出，用于审计与展示「原值 → 修正值」）。 */
  before: RoundCorrectionSnapshot
  /** 修正后的值。 */
  after: RoundCorrectionSnapshot
  reason?: string
  /** 该轮是否因这次修正退出学习。默认 true。 */
  excludeFromLearning: boolean
}

export interface WorkoutRound {
  floorConfirmation?: 'automatic' | 'manual' | 'pending'
  recognitionVersion?: 'motion-v3'
  manualFloorMarks?: ManualMark[]
  id: string
  /** 新训练按实际楼层差计算；未标记的历史记录保留原成绩口径。 */
  floorCounting?: 'transitions'
  /** 原始传感器证据文件引用，不把大数组写入检查点。 */
  evidenceId?: string
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
  recognitionEndState?: RecognitionEndState
  userCorrectionCount?: number
  completionSource?: 'automatic' | 'manual' | 'recovered'
  trustworthy?: boolean
  /**
   * 人工修正链（append-only，按时间顺序）。
   * 旧数据没有该字段即为空链；`userCorrectionCount` 应等于链长度。
   */
  corrections?: RoundCorrection[]
}

export interface ClimbWorkout {
  id: string
  trackingMode?: TrackingMode
  floorCounting?: 'transitions'
  bodyWeightKg?: number
  /** 语音观察/播放日志单独落盘，记录这里只保留引用。 */
  voiceJournalId?: string
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
  trustQuality?: RecognitionQuality
  userCorrectionCount?: number
  personalBestEligible?: boolean
  completionSource?: 'automatic' | 'manual' | 'mixed' | 'recovered'
  weeklyContribution?: {
    workouts: number
    floors: number
    ascentM: number
  }
}

export interface TrainingPersonalBest {
  routeId: string
  workoutId: string
  durationMs: number
  floors: number
  ascentM: number
  achievedAt: number
}

export interface TrainingProgress {
  weekStart: number
  weekEnd: number
  validWorkouts: number
  floors: number
  ascentM: number
  consecutiveWeeks: number
  personalBests: Record<string, TrainingPersonalBest>
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
  /** 本次训练里人工修正过的轮数（含修正链的轮）。旧数据为 undefined。 */
  correctedRounds?: number
  /** 本次训练人工修正次数合计（修正链长度之和）。旧数据为 undefined。 */
  manualCorrectionCount?: number
  /** 热身阶段净时长（D07）；无计划/旧数据为 undefined，且**不计入** activeDurationMs。 */
  warmupDurationMs?: number
}

export interface ActiveWorkoutCheckpoint {
  workoutId: string
  trackingMode?: TrackingMode
  floorCounting?: 'transitions'
  bodyWeightKg?: number
  phase: WorkoutPhase
  currentRoundNumber: number
  savedAt: number
  completedRounds: WorkoutRound[]
  /** D07：本次训练使用的计划（可选；旧检查点没有该字段仍可恢复）。 */
  plan?: WorkoutPlan
  /** D07：计划游标（阶段索引/已完成与已跳过阶段）。 */
  planProgress?: PlanProgress
  /**
   * D07b/F18：已累计的热身净时长（只含已结算的热身段）。
   * 无计划训练不写该字段；旧检查点没有该字段时按 0 处理。
   * 注意：正在进行的**未结算**热身段无法持久化，被杀后该段会从 0 重新累计。
   */
  warmupDurationMs?: number
  /** D07b/F18：计划走完后是否已进入「自由加练」。无计划/旧检查点为 undefined。 */
  extraRounds?: boolean
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

// === D07 训练计划结构（总控预置类型，worker 只读使用）===
// 计划由「阶段序列」描述：热身 → 上爬 → 返回 → 恢复，可多轮重复。
// 休息/返回时长永远不计入上爬成绩（activeDurationMs 只累计 climb 阶段）。

export type PlanPhaseKind = 'warmup' | 'climb' | 'return' | 'recovery'

export interface WorkoutPlanPhase {
  kind: PlanPhaseKind
  /** 目标时长；与 targetFloors 至少有一个。 */
  targetDurationMs?: number
  /** 目标楼层。 */
  targetFloors?: number
  /** 热身/恢复通常可跳过；上爬不可跳过。 */
  skippable: boolean
}

export interface WorkoutPlan {
  id: string
  name: string
  /** 每轮重复「上爬 + 返回」；'until_goal' 表示由 goal 决定轮数。 */
  rounds: number | 'until_goal'
  warmup?: WorkoutPlanPhase
  climbPerRound: WorkoutPlanPhase
  returnPerRound?: WorkoutPlanPhase
  recoveryPerRound?: WorkoutPlanPhase
  /** 兼容字段：旧目标（open/rounds/floors/ascent/duration）继续可用。 */
  goal: WorkoutGoal
  createdAt: number
  updatedAt: number
  schemaVersion: 1
}

export interface PlanProgress {
  phaseIndex: number
  roundNumber: number
  completedPhases: PlanPhaseKind[]
  skippedPhases: PlanPhaseKind[]
  /** 剩余轮数；轮数由目标决定时为 'unknown'。 */
  remainingRounds: number | 'unknown'
}
