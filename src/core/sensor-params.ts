// 传感器算法参数单一来源。
// analysis / free-recognizer / recognizer 必须从这里 import，禁止就地魔改数值。

export const METERS_PER_HPA = 8.3
export const BARO_FLOOR_M = 3
// 实时识别气压层阈值：约 3m 一层。旧值 0.3hPa≈2.5m 会在半层
// 转弯后的气压滞后点提前报层。
export const BARO_EPS = BARO_FLOOR_M / METERS_PER_HPA
// 标定离线切分用的气压阈值，比实时更敏感（0.3hPa≈2.5m）：
// 离线可回溯修正，且现有标定流程与诊断基线依赖该值。
export const BARO_EPS_CALIBRATE = 0.3
export const BARO_SMOOTH_WINDOW = 10
export const BARO_FLOOR_COOLDOWN_MS = 2000
export const BARO_BASELINE_SAMPLE_COUNT = 5
export const P0_HPA = 1013.25
export const BARO_EXP = 0.190263
export const STEPS_PER_FLOOR_CALIBRATE = 18
export const STEPS_PER_FLOOR_FREE = 32
export const DEFAULT_FLOOR_HEIGHT_M = 3
// 电梯/扶梯负样本：近窗内高度上升却几乎无脚步、无整拐、无持续能量
export const ELEVATOR_WINDOW_MS = 6000
export const ELEVATOR_MIN_FLOORS = 0.6
export const ELEVATOR_MAX_STEPS = 1
export const ELEVATOR_MIN_ACTIVE_FRAMES = 4

export type FeatureSpace = 'heading' | 'device'
export const DEFAULT_FEATURE_SPACE: FeatureSpace = 'heading'

// baro-v1: durations are milliseconds, distances metres, pressure hPa.
export const BARO_V1 = {
  staleMs: 2000, medianMs: 1000, averageMs: 3000, velocityMs: 4000,
  altitudeScale: 44330, altitudeExponent: 0.190263,
  anchorRadiusMs: 1000, minFloorM: 1.8, maxFloorM: 6,
  missedFloorRatioMin: 1.65, missedFloorRatioMax: 2.35,
  plateauMs: 3000, plateauRangeM: 0.18, startRiseM: 0.12, startSteps: 3,
  advanceHeightMargin: 0.3, advanceStepsRatio: 0.4, fallbackStepsRatio: 0.85,
  extraFloorRatio: 0.7, elevatorSpeedMps: 0.8, elevatorMs: 2000, elevatorMaxSteps: 2,
  descentMs: 2000, descentDropM: 0.18, descentSpeedMps: 0.03,
  recentStepsMs: 4000, learningRounds: 5, historyMs: 16000,
  defaultFloorM: 3, defaultSteps: 18, defaultTurns: 2,
  maxWeatherDriftMps: 0.012, gravity: 9.81, efficiency: 0.2, joulesPerKcal: 4184,
  horizontalMET: 3, calorieReferenceSpeedMps: 0.35,
  activeEnergy: 0.06,
  peakToleranceM: 0.02,
  driftConsistencyMps: 0.001,
  turningFrameRad: 0.1, completeTurnRad: 1.05, turnGapMs: 900,
  selfTestMs: 3200, selfTestIntervalMs: 200,
} as const
