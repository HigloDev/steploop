import { clamp } from './math'
import { PressureTrend } from './pressure-trend'
import { SensorSample } from './types'

export type SensorMotionActivity =
  | 'waiting'
  | 'still'
  | 'climbing'
  | 'turning_left'
  | 'turning_right'
  | 'descending_stairs'
  | 'elevator_down'
  | 'elevator_up'
  | 'walking'
  | 'uncertain'

export interface SensorWavePoint {
  t: number
  motion: number
  turn: number
  height: number
}

export interface SensorVisualizationState {
  activity: SensorMotionActivity
  confidence: number
  motionLevel: number
  turnRate: number
  relativeHeightM: number
  verticalSpeedMps: number
  pressureReliable?: boolean
  pressureDirection?: 'up' | 'down' | 'level' | 'unknown'
  stepPulse: number
  waves: SensorWavePoint[]
}

export type SensorMovementPhase = 'ascending' | 'returning'

interface MotionPoint extends SensorWavePoint {
  step: boolean
}

const STEP_THRESHOLD = 0.13
const STEP_REFRACTORY_MS = 260
const ANALYSIS_WINDOW_MS = 3500
// 波形显示刷新间隔：400ms 约 2.5 帧/秒。波形图只是训练辅助提示，
// 过高频率会让 SVG 动态元素每秒重建上百个原生视图（Fabric 下会持续
// 增长内存，真机长训会触发系统杀进程）。2.5fps 肉眼仍可跟读。
const DISPLAY_INTERVAL_MS = 400
const DISPLAY_POINTS = 48
// points 压缩阈值：窗口点数（采样率×3.5s）远小于该值时不拷贝数组。
// 50Hz 时窗口约 175 点，压缩间隔约 1.5 秒一次，避免每秒 50 次 filter。
const POINTS_COMPACT_THRESHOLD = 240

export function emptySensorVisualization(): SensorVisualizationState {
  return {
    activity: 'waiting',
    confidence: 0,
    motionLevel: 0,
    turnRate: 0,
    relativeHeightM: 0,
    verticalSpeedMps: 0,
    stepPulse: 0,
    waves: [],
  }
}

/**
 * 把同一批原始传感器样本旁路翻译成“波形 + 人体动作”。
 *
 * 这不替代正式路线识别器，也不会改写训练成绩；它只负责让用户看懂
 * 当前传感器认为真人正在做什么。
 */
export class SensorMotionInterpreter {
  private gravity = 1
  private smoothMotion = 0
  private previousMotion = 0
  private lastStepAt = -Infinity
  private stepPulse = 0
  private pressure = new PressureTrend()
  private relativeHeightM = 0
  private points: MotionPoint[] = []
  private displayPoints: SensorWavePoint[] = []
  private lastDisplayAt = 0

  constructor(private readonly movementPhase: SensorMovementPhase = 'ascending') {}

  reset(): void {
    this.gravity = 1
    this.smoothMotion = 0
    this.previousMotion = 0
    this.lastStepAt = -Infinity
    this.stepPulse = 0
    this.pressure = new PressureTrend()
    this.relativeHeightM = 0
    this.points = []
    this.displayPoints = []
    this.lastDisplayAt = 0
  }

  push(sample: SensorSample): void {
    const magnitude = Math.sqrt(
      sample.ax ** 2 + sample.ay ** 2 + sample.az ** 2,
    )
    if (!this.points.length) this.gravity = magnitude || 1
    this.gravity = this.gravity * 0.985 + magnitude * 0.015
    const linear = Math.abs(magnitude - this.gravity)
    this.smoothMotion = this.smoothMotion * 0.72 + linear * 0.28

    const step =
      this.smoothMotion > STEP_THRESHOLD &&
      this.previousMotion <= STEP_THRESHOLD &&
      sample.t - this.lastStepAt >= STEP_REFRACTORY_MS
    if (step) {
      this.lastStepAt = sample.t
      this.stepPulse += 1
    }
    this.previousMotion = this.smoothMotion

    if (sample.pressure !== undefined && sample.pressure > 0) {
      this.relativeHeightM = this.pressure.push(sample.pressure, sample.t).relativeHeightM
    }

    const point: MotionPoint = {
      t: sample.t,
      motion: clamp(this.smoothMotion / 0.36, 0, 1),
      turn: clamp(sample.gz / 2.2, -1, 1),
      height: this.relativeHeightM,
      step,
    }
    this.points.push(point)
    // 按需压缩：窗口内点数是（采样率×3.5s），远小于压缩上限时不做
    // 数组拷贝，避免每秒几十次 filter 分配（真机上会持续增长内存）。
    if (this.points.length > POINTS_COMPACT_THRESHOLD) {
      const cutoff = sample.t - ANALYSIS_WINDOW_MS
      this.points = this.points.filter((item) => item.t >= cutoff)
    }

    if (
      !this.lastDisplayAt ||
      sample.t - this.lastDisplayAt >= DISPLAY_INTERVAL_MS
    ) {
      this.lastDisplayAt = sample.t
      this.displayPoints.push({
        t: point.t,
        motion: point.motion,
        turn: point.turn,
        height: point.height,
      })
      if (this.displayPoints.length > DISPLAY_POINTS) {
        this.displayPoints.splice(
          0,
          this.displayPoints.length - DISPLAY_POINTS,
        )
      }
    }
  }

  snapshot(now = Date.now()): SensorVisualizationState {
    const recent = this.points.filter((point) => point.t >= now - 1100)
    const pressure = this.pressure.snapshot(now)
    const motionLevel = recent.length
      ? recent.reduce((sum, point) => sum + point.motion, 0) / recent.length
      : 0
    const turnRate = recent.length
      ? recent.reduce((sum, point) => sum + point.turn, 0) / recent.length
      : 0
    const recentSteps = recent.filter((point) => point.step).length

    const verticalSpeedMps = pressure.reliable ? pressure.speedMps : 0

    let activity: SensorMotionActivity = 'waiting'
    let confidence = 0
    if (this.points.length >= 4) {
      const elevatorDown =
        this.movementPhase === 'returning' &&
        verticalSpeedMps < -0.48 &&
        recentSteps === 0 &&
        motionLevel < 0.28
      const descendingStairs =
        this.movementPhase === 'returning' &&
        verticalSpeedMps < -0.12 &&
        recentSteps > 0
      const unexpectedDescent =
        this.movementPhase === 'ascending' && verticalSpeedMps < -0.12
      const turning = recentSteps > 0 && Math.abs(turnRate) > 0.16
      if (elevatorDown) {
        activity = 'elevator_down'
        confidence = clamp(
          Math.abs(verticalSpeedMps) / 1.4 +
            (0.28 - motionLevel) * 0.8,
          0.55,
          0.98,
        )
      } else if (turning) {
        activity = turnRate > 0 ? 'turning_left' : 'turning_right'
        confidence = clamp(Math.abs(turnRate) * 2.8, 0.5, 0.96)
      } else if (descendingStairs) {
        activity = 'descending_stairs'
        confidence = clamp(
          0.48 + recentSteps * 0.12 + Math.abs(verticalSpeedMps) * 0.3,
          0.5,
          0.96,
        )
      } else if (unexpectedDescent) {
        // 正在爬楼时锁定向上逻辑。短暂气压回落只让角色停住，
        // 不允许画面出现“上楼/下楼”来回跳变。
        activity = 'still'
        confidence = 0.55
      } else if (recentSteps > 0) {
        activity = !pressure.reliable ? 'uncertain' : pressure.direction === 'level' ? 'walking'
          : pressure.direction === 'down' ? 'descending_stairs' : 'climbing'
        confidence = clamp(
          0.48 + recentSteps * 0.12 + motionLevel * 0.5,
          0.5,
          0.97,
        )
      } else if (pressure.reliable && pressure.speedMps > 0.48 && motionLevel < 0.28) {
        activity = 'elevator_up'
        confidence = 0.65
      } else {
        activity = 'still'
        confidence = clamp(0.82 - motionLevel, 0.55, 0.9)
      }
    }

    return {
      activity,
      confidence,
      motionLevel,
      turnRate,
      relativeHeightM: this.relativeHeightM,
      verticalSpeedMps,
      pressureReliable: pressure.reliable,
      pressureDirection: pressure.direction,
      stepPulse: this.stepPulse,
      waves: [...this.displayPoints],
    }
  }
}
