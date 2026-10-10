/**
 * fusion-v1 训练引擎：标定轮 + 自动轮的完整状态机（纯 TypeScript，可离线回放与合成测试）。
 *
 * 阶段（phase）：
 *   calibrating      标定轮爬楼中：用户每到一层点“到了一层”，到顶点“到顶了”
 *   calibration_top  标定轮已到顶：等待电梯/楼梯下行（自动切轮）或手动“开始下一轮”
 *   waiting          在楼下准备：一开始爬（有步数 + 高度上升）就自动开始新一轮
 *   climbing         自动轮爬楼中：多证据融合自动计层
 *   descending       本轮完成 · 下行中：等待高度平台稳定（到达楼下）
 *   finished         训练结束
 *
 * 证据：
 *   - 气压：只用真实气压事件及其自身时间戳（BaroAltimeter），停更 > 2s 不参与判定；
 *   - 步数：自适应阈值 + 迟滞计步；
 *   - 拐弯：StairTurnGate 的整拐；
 *   - 模板：标定轮得到的每层高度、步数、拐弯数。
 * 主计数 = 本轮累计气压高度对照模板每层高度分段（每轮在楼下重新归零，消除天气漂移）；
 * 步数/拐弯与模板交叉核对；证据冲突或不足时该层标“估算”，不强行确认。
 * 气压缺失/停更时退回“步数 + 拐弯”计层。
 */
import { BaroAltimeter } from './baro-altimeter'
import {
  BuildingTemplate,
  cumulativeHeightAt,
  floorHeightAt,
  floorStepsAt,
  floorTurnsAt,
  medianFloorHeightM,
  medianStepsPerFloor,
  templateTotalAscentM,
} from './building-template'
import { ElevatorDetector, VerticalTransit } from './elevator-gate'
import { buildTemplateFromCalibration } from './fusion-calibration'
import { floorAfter, normalizeFloorNumber } from './floors'
import { clamp, uid } from './math'
import { MotionSignalProcessor } from './motion-signal'
import {
  ACTIVE_GAP_MAX_MS,
  AUTO_START_RISE_M,
  AUTO_START_STEPS,
  AUTO_START_STEPS_NO_BARO,
  AUTO_START_WINDOW_MS,
  CAL_TOP_MERGE_MS,
  CAL_TOP_MERGE_STEPS,
  DEFAULT_FLOOR_HEIGHT_M,
  DRIFT_CLOSURE_MAX_RATIO,
  DRIFT_IDLE_MS,
  DRIFT_MAX_SPEED_MPS,
  FLOOR_DWELL_MS,
  FLOOR_ESTIMATE_BELOW,
  FLOOR_FORCE_RATIO,
  FLOOR_MIN_STEP_RATIO,
  FLOOR_REACH_RATIO,
  MARK_HEIGHT_WINDOW_MS,
  MOTION_FLOOR_STEP_RATIO,
  MOTION_FLOOR_STEP_RATIO_NO_TURN,
  NO_BARO_IDLE_END_MS,
  PLATEAU_MS,
  PLATEAU_SPEED_MPS,
  STAIRS_DOWN_MIN_M,
} from './sensor-params'
import { StairTurnGate } from './turn-gate'
import type { FeatureFrame, SensorSample } from './types'

export type FusionPhase = 'calibrating' | 'calibration_top' | 'waiting' | 'climbing' | 'descending' | 'finished'
export type FusionRoundKind = 'calibration' | 'auto'
export type FusionFloorSource = 'manual' | 'baro' | 'baro_forced' | 'motion' | 'split' | 'closure'
export type FusionRoundEndReason = 'elevator_down' | 'stairs_down' | 'idle' | 'manual' | 'workout_end'

export interface FusionFloorRecord {
  floorTo: number
  reachedAt: number
  steps: number
  turns: number
  /** 到达时相对本轮起点的高度（米）。 */
  heightM?: number
  source: FusionFloorSource
  confidence: number
  estimated: boolean
}

export interface FusionRoundResult {
  id: string
  roundNumber: number
  kind: FusionRoundKind
  startedAt: number
  /** 到达本轮最高层的时刻；顶层停留、下行都不计入本轮用时。 */
  topAt: number
  endedAt: number
  startFloor: number
  finalFloor: number
  floors: number
  ascentM: number
  steps: number
  /** 有步伐的活动时间（毫秒）。 */
  activeMs: number
  /** 起爬到登顶的墙钟时间（毫秒）。 */
  durationMs: number
  estimated: boolean
  confidence: number
  floorRecords: FusionFloorRecord[]
  endReason: FusionRoundEndReason
  interruptions: Array<{ startMs: number; endMs: number }>
  /** 本轮气压有效覆盖率 0~1。 */
  baroCoverage: number
  notes: string[]
}

export interface FusionStatus {
  tone: 'info' | 'good' | 'warn'
  text: string
}

export interface FusionSnapshot {
  phase: FusionPhase
  /** 当前（或即将开始的）轮次编号，从 1 开始。 */
  roundNumber: number
  roundKind: FusionRoundKind
  startFloor: number
  /** 当前所在楼层（绝对楼层号）。 */
  currentFloor: number
  /** 本轮已爬层数。 */
  roundFloors: number
  /** 全部轮次累计层数（含本轮）。 */
  totalFloors: number
  completedRounds: number
  templateFloors?: number
  elapsedMs: number
  activeMs: number
  steps: number
  /** 累计上行高度，包含尚未结束的这一轮；下行与等候不增加。 */
  ascentM?: number
  /** 累计上行用时，包含上行时的短暂停留，不包含轮间等候与下行。 */
  ascentMs?: number
  /** 本轮相对起点高度（米），无气压时 undefined。 */
  heightM?: number
  baro: 'ok' | 'stale' | 'none' | 'pending'
  /** 本轮目前是否只能估算。 */
  estimated: boolean
  canUndo: boolean
  canMarkTop: boolean
  status: FusionStatus
  lastFloorAt?: number
}

export interface FusionEngineOptions {
  startedAt: number
  startFloor?: number
  /** 选用已保存的楼栋模板：跳过标定，直接进入自动轮。 */
  template?: BuildingTemplate
  /** 恢复训练：已完成的轮次。 */
  resumeRounds?: FusionRoundResult[]
  templateName?: string
}

interface FrameAccumulator {
  start: number
  steps: number
  energy: number
  count: number
  turnRad: number
  headingTurnRad: number
}

interface LogEntry { t: number; steps: number; turns: number; active: number }

interface RoundTracker {
  id: string
  number: number
  kind: FusionRoundKind
  startedAt: number
  baselineAlt?: number
  baselineFrozen: boolean
  driftOffset: number
  lastDriftAlt?: number
  stepsAtStart: number
  turnsAtStart: number
  activeAtStart: number
  lastAdvanceSteps: number
  lastAdvanceTurns: number
  floors: FusionFloorRecord[]
  aboveSince?: number
  maxRelH: number
  maxRawAlt?: number
  maxAt: number
  marks: Array<{ t: number; steps: number; turns: number }>
  topAt?: number
  interruptions: Array<{ startMs: number; endMs: number }>
  baroFreshMs: number
  observedMs: number
  usedFallback: boolean
  notes: string[]
}

const FRAME_MS = 500

function median(values: number[]): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

export class FusionWorkoutEngine {
  private readonly signal = new MotionSignalProcessor()
  private readonly turnGate = new StairTurnGate()
  private readonly baro = new BaroAltimeter()
  private readonly elevator = new ElevatorDetector()
  private frame?: FrameAccumulator
  private previousPoint?: { t: number; turn: number; headingTurn: number }
  private log: LogEntry[] = []
  private stepTimes: number[] = []
  private stepsTotal = 0
  private turnsTotal = 0
  private activeTotal = 0
  private lastStepAt = -Infinity
  private lastSampleAt?: number
  private lastPressureT?: number
  private lastLegacyPressure?: number
  private now: number
  private phase: FusionPhase
  private round?: RoundTracker
  private rounds: FusionRoundResult[]
  private template?: BuildingTemplate
  private readonly startFloor: number
  private readonly startedAt: number
  private plateauSince?: number
  private descendingSince?: number
  private bottomAlt?: number
  private closurePending = false
  private lastTransit?: VerticalTransit
  private calibrationWarnings: string[] = []
  private readonly templateName?: string
  private onRoundListeners: Array<(round: FusionRoundResult) => void> = []

  constructor(options: FusionEngineOptions) {
    this.startedAt = options.startedAt
    this.now = options.startedAt
    this.template = options.template
    this.startFloor = normalizeFloorNumber(options.template?.startFloor ?? options.startFloor ?? 1)
    if (this.template && this.template.startFloor !== this.startFloor) {
      this.template = { ...this.template, startFloor: this.startFloor,
        floors: this.template.floors.map((floor, index) => ({ ...floor,
          floorFrom: floorAfter(this.startFloor, index), floorTo: floorAfter(this.startFloor, index + 1) })) }
    }
    this.rounds = [...(options.resumeRounds ?? [])]
    this.templateName = options.templateName
    if (this.template && this.template.floors.length > 0) {
      this.phase = 'waiting'
    } else {
      this.phase = 'calibrating'
      this.round = this.newRound('calibration', options.startedAt)
    }
  }

  // ===================== 输入 =====================

  /** 每轮完成时回调（含标定轮）。 */
  onRound(listener: (round: FusionRoundResult) => void): void {
    this.onRoundListeners.push(listener)
  }

  /**
   * 送入一个传感器样本（加速度/陀螺仪）。
   * 若样本带 pressureT（原生端气压事件自身时间戳），只有 pressureT 递增时才算新的气压事件；
   * 旧数据没有 pressureT：只有气压值变化才算新事件，重复值不会被当成“新时间戳 + 旧值”。
   */
  pushSample(sample: SensorSample): void {
    if (!Number.isFinite(sample.t)) return
    if (this.lastSampleAt !== undefined && sample.t <= this.lastSampleAt) return
    if (this.lastSampleAt !== undefined && sample.t - this.lastSampleAt > 1500) {
      this.round?.interruptions.push({ startMs: this.lastSampleAt, endMs: sample.t })
      this.closeFrame(this.lastSampleAt)
      this.previousPoint = undefined
    }
    this.lastSampleAt = sample.t
    if (sample.pressure !== undefined && Number.isFinite(sample.pressure) && sample.pressure > 0) {
      if (sample.pressureT !== undefined && Number.isFinite(sample.pressureT)) {
        if (this.lastPressureT === undefined || sample.pressureT > this.lastPressureT) {
          this.lastPressureT = sample.pressureT
          this.pushBarometer(sample.pressureT, sample.pressure)
        }
      } else if (sample.pressure !== this.lastLegacyPressure) {
        this.lastLegacyPressure = sample.pressure
        this.pushBarometer(sample.t, sample.pressure)
      }
    }
    const point = this.signal.push(sample)
    if (!point) return
    this.advanceClock(point.t)
    if (this.frame && point.t >= this.frame.start + FRAME_MS) this.closeFrame(this.frame.start + FRAME_MS)
    if (!this.frame) this.frame = { start: point.t, steps: 0, energy: 0, count: 0, turnRad: 0, headingTurnRad: 0 }
    const dt = this.previousPoint && point.t - this.previousPoint.t <= 250 ? (point.t - this.previousPoint.t) / 1000 : 0
    if (this.previousPoint) {
      this.frame.turnRad += (this.previousPoint.turn + point.turn) * dt / 2
      this.frame.headingTurnRad += (this.previousPoint.headingTurn + point.headingTurn) * dt / 2
    }
    this.previousPoint = { t: point.t, turn: point.turn, headingTurn: point.headingTurn }
    this.frame.count += 1
    this.frame.energy += point.motion
    if (point.step) {
      this.frame.steps += 1
      this.stepsTotal += 1
      this.lastStepAt = point.t
      this.stepTimes.push(point.t)
      while (this.stepTimes.length && this.stepTimes[0] < point.t - 120000) this.stepTimes.shift()
      this.elevator.pushSteps(point.t, 1)
    }
  }

  /** 送入一个真实的气压事件（t 为气压事件自身的时间戳）。 */
  pushBarometer(t: number, pressureHpa: number): void {
    const point = this.baro.push(t, pressureHpa)
    if (!point) return
    this.advanceClock(t)
    this.onAltitude(point.t, point.altM)
  }

  /** 定时调用（UI 计时器）：推进时钟，处理停更与无气压的空闲结束。 */
  tick(now: number): void {
    this.advanceClock(now)
    // 样本落后于墙钟（锁屏后原生日志正在回放）时只推进时钟，不做“空闲结束”等判定，
    // 等回放的样本按各自时间戳送达后再判断。
    if (this.lastSampleAt !== undefined && now - this.lastSampleAt > 1500) return
    this.evaluateMotion(now)
  }

  /** 标定轮：到了一层。 */
  markFloor(t: number): void {
    if (this.phase !== 'calibrating' || !this.round) return
    this.advanceClock(t)
    this.round.marks.push({ t, steps: this.stepsAt(t), turns: this.turnsAt(t) })
  }

  /** 标定轮：撤销最后一次“到了一层”。 */
  undoMark(): void {
    if (this.phase === 'calibrating' && this.round?.marks.length) this.round.marks.pop()
  }

  /** 标定轮：到顶了（= 到达新的一层并结束标定爬楼；紧跟在“到了一层”之后则只确认顶层）。 */
  markTop(t: number): void {
    if (this.phase !== 'calibrating' || !this.round) return
    this.advanceClock(t)
    const last = this.round.marks.at(-1)
    const steps = this.stepsAt(t)
    const merge = last && t - last.t <= CAL_TOP_MERGE_MS && steps - last.steps <= CAL_TOP_MERGE_STEPS
    if (!merge) this.round.marks.push({ t, steps, turns: this.turnsAt(t) })
    this.round.topAt = this.round.marks.at(-1)!.t
    this.phase = 'calibration_top'
  }

  /** 手动开始下一轮（无气压设备的兜底，或用户想立即切轮）。 */
  nextRound(t: number): void {
    this.advanceClock(t)
    if (this.phase === 'calibrating' || this.phase === 'calibration_top') {
      if (this.round?.marks.length) this.endCalibration('manual', t)
      return
    }
    if (this.phase === 'climbing' && this.round) {
      this.endAutoRound('manual', t)
      this.phase = 'waiting'
      this.bottomAlt = undefined
    } else if (this.phase === 'descending') {
      this.phase = 'waiting'
      this.bottomAlt = undefined
    }
  }

  /** 结束训练：未完成的轮次按已爬层数结算（0 层的空轮丢弃）。 */
  finish(t: number): FusionRoundResult[] {
    this.advanceClock(t)
    if ((this.phase === 'calibrating' || this.phase === 'calibration_top') && this.round?.marks.length) {
      this.endCalibration(this.phase === 'calibration_top' ? 'manual' : 'workout_end', t)
    } else if (this.phase === 'climbing' && this.round && this.round.floors.length > 0) {
      this.endAutoRound('workout_end', t)
    }
    this.round = undefined
    this.phase = 'finished'
    return this.getRounds()
  }

  // ===================== 输出 =====================

  getRounds(): FusionRoundResult[] {
    return this.rounds.map(round => ({ ...round, floorRecords: round.floorRecords.map(r => ({ ...r })) }))
  }

  getTemplate(): BuildingTemplate | undefined {
    return this.template
  }

  getCalibrationWarnings(): string[] {
    return [...this.calibrationWarnings]
  }

  getPhase(): FusionPhase {
    return this.phase
  }

  snapshot(now = this.now): FusionSnapshot {
    const round = this.round
    const completedFloors = this.rounds.reduce((sum, r) => sum + r.floors, 0)
    const roundFloors = round ? (round.kind === 'calibration' ? round.marks.length : round.floors.length) : 0
    const baroState: FusionSnapshot['baro'] = !this.baro.hasData
      ? (now - this.startedAt < 4000 ? 'pending' : 'none')
      : this.baro.isStale(now) ? 'stale' : 'ok'
    const rel = round ? this.relativeHeight(round) : undefined
    const ascentEndAt = round?.topAt ?? now
    const active = this.rounds.reduce((sum, r) => sum + r.activeMs, 0) +
      (round ? Math.max(0, this.activeAt(ascentEndAt) - round.activeAtStart) : 0)
    const steps = this.rounds.reduce((sum, r) => sum + r.steps, 0) +
      (round ? Math.max(0, this.stepsAt(ascentEndAt) - round.stepsAtStart) : 0)
    const roundNumber = round ? round.number : this.rounds.length + 1
    const kind: FusionRoundKind = round?.kind ?? (this.template ? 'auto' : 'calibration')
    return {
      phase: this.phase,
      roundNumber,
      roundKind: kind,
      startFloor: this.startFloor,
      currentFloor: this.phase === 'descending' || this.phase === 'waiting'
        ? (this.phase === 'waiting' ? this.startFloor : this.rounds.at(-1)?.finalFloor ?? this.startFloor)
        : floorAfter(this.startFloor, roundFloors),
      roundFloors,
      totalFloors: completedFloors + (round ? roundFloors : 0),
      completedRounds: this.rounds.length,
      templateFloors: this.template?.floors.length,
      elapsedMs: Math.max(0, now - this.startedAt),
      activeMs: active,
      steps,
      ascentM: this.rounds.reduce((sum, result) => sum + result.ascentM, 0) +
        (round ? round.kind === 'calibration'
          ? (this.phase === 'calibration_top' && round.baselineAlt !== undefined
            ? Math.max(0, (this.baro.altitudeCentered(ascentEndAt, MARK_HEIGHT_WINDOW_MS) ?? round.baselineAlt) - round.baselineAlt)
            : baroState === 'ok' && rel !== undefined ? Math.max(0, rel) : roundFloors * DEFAULT_FLOOR_HEIGHT_M)
          : this.ascentFor(roundFloors) : 0),
      ascentMs: this.rounds.reduce((sum, result) => sum + result.durationMs, 0) +
        (round ? Math.max(0, ascentEndAt - round.startedAt) : 0),
      heightM: rel !== undefined ? Number(rel.toFixed(1)) : undefined,
      baro: baroState,
      estimated: round ? (round.usedFallback || round.floors.some(f => f.estimated)) : false,
      canUndo: this.phase === 'calibrating' && !!round?.marks.length,
      canMarkTop: this.phase === 'calibrating',
      status: this.status(baroState),
      lastFloorAt: round?.kind === 'calibration' ? round.marks.at(-1)?.t : round?.floors.at(-1)?.reachedAt,
    }
  }

  // ===================== 内部：时钟、帧、日志 =====================

  private advanceClock(t: number): void {
    if (Number.isFinite(t) && t > this.now) this.now = t
  }

  private closeFrame(end: number): void {
    const frame = this.frame
    if (!frame) return
    this.frame = undefined
    const featureFrame: FeatureFrame = {
      startMs: frame.start, endMs: end, steps: frame.steps, cadence: 0,
      energy: frame.count ? frame.energy / frame.count : 0,
      turnRad: frame.turnRad, headingTurnRad: frame.headingTurnRad,
      paused: frame.steps === 0 && (frame.count ? frame.energy / frame.count : 0) < 0.045 ? 1 : 0,
    }
    const turn = this.turnGate.push(featureFrame)
    if (turn) this.turnsTotal += 1
    // 活动时间：最近 ACTIVE_GAP_MAX_MS 内有步伐的帧才计入（休息、电梯、站立不计）。
    if (end - this.lastStepAt <= ACTIVE_GAP_MAX_MS && this.recentSteps(end, ACTIVE_GAP_MAX_MS * 2) >= 2) {
      this.activeTotal += Math.max(0, end - frame.start)
    }
    this.log.push({ t: end, steps: this.stepsTotal, turns: this.turnsTotal, active: this.activeTotal })
    while (this.log.length > 8000) this.log.shift()
    this.evaluateMotion(end)
  }

  private lookup(t: number): LogEntry | undefined {
    let lo = 0, hi = this.log.length - 1, found: LogEntry | undefined
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.log[mid].t <= t) { found = this.log[mid]; lo = mid + 1 } else hi = mid - 1
    }
    return found
  }

  private stepsAt(t: number): number {
    if (t >= this.now) return this.stepsTotal
    return this.stepTimes.length && t >= this.stepTimes[0]
      ? this.stepsTotal - this.stepTimes.filter(time => time > t).length
      : this.lookup(t)?.steps ?? 0
  }

  private turnsAt(t: number): number {
    return t >= this.now ? this.turnsTotal : this.lookup(t)?.turns ?? 0
  }

  private activeAt(t: number): number {
    return t >= this.now ? this.activeTotal : this.lookup(t)?.active ?? 0
  }

  private recentSteps(t: number, windowMs: number): number {
    let count = 0
    for (let i = this.stepTimes.length - 1; i >= 0 && this.stepTimes[i] > t - windowMs; i -= 1) {
      if (this.stepTimes[i] <= t) count += 1
    }
    return count
  }

  private newRound(kind: FusionRoundKind, startedAt: number): RoundTracker {
    const steps = this.stepsAt(startedAt)
    const turns = this.turnsAt(startedAt)
    return {
      id: uid('round'), number: this.rounds.length + 1, kind, startedAt,
      baselineFrozen: false, driftOffset: 0,
      stepsAtStart: steps, turnsAtStart: turns, activeAtStart: this.activeAt(startedAt),
      lastAdvanceSteps: steps, lastAdvanceTurns: turns,
      floors: [], maxRelH: 0, maxAt: startedAt, marks: [], interruptions: [],
      baroFreshMs: 0, observedMs: 0, usedFallback: false, notes: [],
    }
  }

  /** at：判定停更所用的时刻。气压事件驱动时传事件自身时间戳（原生端后台回放时墙钟已超前）。 */
  private relativeHeight(round: RoundTracker, at = this.now): number | undefined {
    const latest = this.baro.latest()
    if (!latest || round.baselineAlt === undefined || this.baro.isStale(at)) return undefined
    return latest.altM - round.baselineAlt - round.driftOffset
  }

  private baroUsable(t: number): boolean {
    return this.baro.hasData && !this.baro.isStale(t)
  }

  private templateHasHeights(): boolean {
    return !!this.template?.barometer && this.template.floors.some(floor => floor.heightM !== undefined)
  }

  // ===================== 内部：气压驱动 =====================

  private onAltitude(t: number, altM: number): void {
    const speed = this.baro.speedAt(t)
    this.lastTransit = this.elevator.observe(t, speed)
    const round = this.round
    if (round && (this.phase === 'calibrating' || this.phase === 'calibration_top' || this.phase === 'climbing')) {
      // 基线：起爬前持续跟随，出现第一步（或已回溯起点）后冻结。
      if (round.baselineAlt === undefined || !round.baselineFrozen) {
        if (round.kind === 'calibration') {
          const firstStep = this.stepTimes.find(time => time >= round.startedAt)
          round.baselineAlt = firstStep !== undefined
            ? this.baro.altitudeCentered(firstStep - 1500, 1500) ?? altM
            : this.baro.altitudeBetween(t - 3000, t) ?? altM
          if (firstStep !== undefined) round.baselineFrozen = true
        } else {
          round.baselineAlt = altM
          round.baselineFrozen = true
        }
      }
      this.updateDrift(round, t, altM, speed)
      if (this.lastTransit !== 'elevator_up') {
        const rel = altM - round.baselineAlt! - round.driftOffset
        if (rel > round.maxRelH) {
          round.maxRelH = rel
          round.maxAt = t
          round.maxRawAlt = altM
        }
      }
    }
    switch (this.phase) {
      case 'calibrating':
        if (this.lastTransit === 'elevator_down' && round?.marks.length) {
          round.notes.push('未点“到顶了”，已按最后一次“到了一层”作为顶层')
          round.topAt = round.marks.at(-1)!.t
          this.endCalibration('elevator_down', t)
        }
        break
      case 'calibration_top':
        if (round && this.isDescending(round, t, speed)) {
          this.endCalibration(this.lastTransit === 'elevator_down' ? 'elevator_down' : 'stairs_down', t)
        }
        break
      case 'climbing':
        if (round) this.evaluateBaroFloors(round, t)
        if (round && this.isDescending(round, t, speed)) {
          this.endAutoRound(this.lastTransit === 'elevator_down' ? 'elevator_down' : 'stairs_down', t)
          this.enterDescending(t)
        }
        break
      case 'descending':
        this.evaluateDescending(t, speed)
        break
      case 'waiting':
        this.evaluateWaiting(t, altM, speed)
        break
      default:
        break
    }
  }

  private updateDrift(round: RoundTracker, t: number, altM: number, speed: number | undefined): void {
    // 中途休息（近 8s 无步数、几乎不动）期间的高度变化只能是气压漂移，累计进 driftOffset。
    if (round.lastDriftAlt !== undefined && this.recentSteps(t, DRIFT_IDLE_MS) === 0 &&
        speed !== undefined && Math.abs(speed) < DRIFT_MAX_SPEED_MPS && t - round.startedAt > DRIFT_IDLE_MS &&
        this.phase !== 'calibration_top') {
      round.driftOffset += altM - round.lastDriftAlt
    }
    round.lastDriftAlt = altM
  }

  private isDescending(round: RoundTracker, t: number, speed: number | undefined): boolean {
    if (this.lastTransit === 'elevator_down') return true
    const rel = this.relativeHeight(round, t)
    if (rel === undefined || speed === undefined) return false
    const floorH = this.template ? medianFloorHeightM(this.template) : DEFAULT_FLOOR_HEIGHT_M
    return rel < round.maxRelH - Math.max(STAIRS_DOWN_MIN_M, 0.8 * floorH) &&
      this.recentSteps(t, 6000) >= 4 && speed < -0.1
  }

  /** 气压主计数：当前高度 ≥ H_k − 0.3·h_k 持续 1.2s，并用步数交叉核对。 */
  private evaluateBaroFloors(round: RoundTracker, t: number): void {
    const template = this.template
    if (!template || !this.templateHasHeights()) return
    const rel = this.relativeHeight(round, t)
    if (rel === undefined) return
    const k = round.floors.length
    const threshold = cumulativeHeightAt(template, k) - FLOOR_REACH_RATIO * floorHeightAt(template, k)
    if (rel < threshold || this.lastTransit === 'elevator_up') {
      round.aboveSince = undefined
      return
    }
    round.aboveSince ??= t
    if (t - round.aboveSince < FLOOR_DWELL_MS) return
    // 可能一次越过多层（停更恢复后追赶）：一次结算所有已越过的层，并把步数按层均分。
    let reached = k + 1
    while (rel >= cumulativeHeightAt(template, reached) - FLOOR_REACH_RATIO * floorHeightAt(template, reached)) reached += 1
    const count = reached - k
    const stepsSince = this.stepsTotal - round.lastAdvanceSteps
    let need = 0
    for (let i = k; i < reached; i += 1) need += FLOOR_MIN_STEP_RATIO * floorStepsAt(template, i)
    const motionWorking = this.stepsTotal - round.stepsAtStart > 0
    const clearlyAbove = rel >= cumulativeHeightAt(template, reached - 1) + FLOOR_FORCE_RATIO * floorHeightAt(template, reached - 1)
    if (stepsSince >= need || !motionWorking) {
      this.advance(round, t, count, 'baro', rel)
    } else if (clearlyAbove) {
      // 气压明显越过但步数不足（可能计步漏检）：推进但标“估算”，不强行确认。
      this.advance(round, t, count, 'baro_forced', rel)
    }
  }

  private evaluateDescending(t: number, speed: number | undefined): void {
    if (speed !== undefined && Math.abs(speed) < PLATEAU_SPEED_MPS) this.plateauSince ??= t
    else this.plateauSince = undefined
    if (this.plateauSince !== undefined && t - this.plateauSince >= PLATEAU_MS && this.lastTransit !== 'elevator_down') {
      this.bottomAlt = this.baro.altitudeBetween(this.plateauSince, t)
      this.phase = 'waiting'
      this.applyClosure(t)
    }
  }

  private evaluateWaiting(t: number, altM: number, speed: number | undefined): void {
    if (this.lastTransit === 'elevator_down') {
      this.enterDescending(t)
      return
    }
    const recent = this.baro.altitudeBetween(t - 3000, t) ?? altM
    if (this.bottomAlt === undefined) this.bottomAlt = recent
    // 楼下基线：比基线更低时立即跟随；只有站立不动（近 8s 无步数）时才允许向上跟随，
    // 否则慢速起爬（0.06 m/s）会被基线“追着走”，永远达不到起爬门限。
    if (recent < this.bottomAlt) this.bottomAlt = recent
    else if (this.recentSteps(t, AUTO_START_WINDOW_MS) === 0 && altM - this.bottomAlt < 0.3) this.bottomAlt = recent
    const rise = altM - this.bottomAlt
    if (rise < 0.3) {
      if (this.closurePending && speed !== undefined && Math.abs(speed) < PLATEAU_SPEED_MPS) this.applyClosure(t)
      return
    }
    if (rise < AUTO_START_RISE_M || this.lastTransit === 'elevator_up') return
    // 本轮起点回溯到最后一次处于楼下基线的时刻。
    const history = this.baro.history(t - 120000)
    let startAt = t - AUTO_START_WINDOW_MS
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i].altM <= this.bottomAlt + 0.15) { startAt = history[i].t; break }
    }
    // 上升 0.6m 约等于 3~4 级台阶，与速度无关；电梯上行没有步数。
    if (this.stepsTotal - this.stepsAt(startAt - 1500) >= AUTO_START_STEPS) {
      this.startAutoRound(startAt, this.bottomAlt)
    }
  }

  private enterDescending(t: number): void {
    this.phase = 'descending'
    this.plateauSince = undefined
    this.descendingSince = t
    this.bottomAlt = undefined
  }

  private startAutoRound(startedAt: number, baselineAlt?: number): void {
    if (!this.template) return
    const round = this.newRound('auto', startedAt)
    if (baselineAlt !== undefined) {
      round.baselineAlt = baselineAlt
      round.baselineFrozen = true
    } else {
      round.usedFallback = true
    }
    this.round = round
    this.phase = 'climbing'
    this.closurePending = false
  }

  // ===================== 内部：步数驱动（含无气压退化） =====================

  private evaluateMotion(t: number): void {
    const round = this.round
    const baroOk = this.baroUsable(t)
    if (round && (this.phase === 'climbing' || this.phase === 'calibrating')) {
      round.observedMs += FRAME_MS
      if (baroOk) round.baroFreshMs += FRAME_MS
    }
    if (this.phase === 'climbing' && round && this.template) {
      const baroPath = baroOk && round.baselineAlt !== undefined && this.templateHasHeights()
      if (!baroPath) this.evaluateMotionFloors(round, t)
      const atTop = round.floors.length >= this.template.floors.length
      if (!baroOk && atTop && t - this.lastStepAt >= NO_BARO_IDLE_END_MS && round.floors.length > 0) {
        this.endAutoRound('idle', t)
        this.phase = 'waiting'
        this.bottomAlt = undefined
      }
      return
    }
    if (this.phase === 'waiting' && !baroOk && this.template) {
      if (this.recentSteps(t, 6000) >= AUTO_START_STEPS_NO_BARO) {
        const first = this.stepTimes.find(time => time > t - 6000) ?? t
        this.startAutoRound(first, undefined)
      }
      return
    }
    if (this.phase === 'descending' && !baroOk && this.descendingSince !== undefined && t - this.descendingSince > 20000) {
      // 下行途中气压长时间停更：回到楼下等待，用步数兜底起爬。
      this.phase = 'waiting'
      this.bottomAlt = undefined
    }
  }

  /** 退化计层：本层步数达到模板 85% 且拐弯数达到模板数量（拐弯漏检时步数达到 130%）。 */
  private evaluateMotionFloors(round: RoundTracker, t: number): void {
    const template = this.template!
    const k = round.floors.length
    const stepsSince = this.stepsTotal - round.lastAdvanceSteps
    const turnsSince = this.turnsTotal - round.lastAdvanceTurns
    const tmplSteps = floorStepsAt(template, k)
    const tmplTurns = floorTurnsAt(template, k) ?? 0
    const enoughSteps = stepsSince >= MOTION_FLOOR_STEP_RATIO * tmplSteps
    const turnsOk = tmplTurns === 0 || turnsSince >= tmplTurns
    if ((enoughSteps && turnsOk) || stepsSince >= MOTION_FLOOR_STEP_RATIO_NO_TURN * tmplSteps) {
      round.usedFallback = true
      this.advance(round, t, 1, 'motion', this.relativeHeight(round, t))
    }
  }

  private advance(round: RoundTracker, t: number, count: number, source: FusionFloorSource, heightM?: number): void {
    const stepsSince = this.stepsTotal - round.lastAdvanceSteps
    const turnsSince = this.turnsTotal - round.lastAdvanceTurns
    for (let i = 0; i < count; i += 1) {
      const index = round.floors.length
      round.floors.push({
        floorTo: floorAfter(this.startFloor, index + 1),
        reachedAt: t,
        steps: Math.round(stepsSince / count),
        turns: Math.round(turnsSince / count),
        heightM: heightM !== undefined ? Number(heightM.toFixed(2)) : undefined,
        source,
        confidence: 0,
        estimated: source !== 'baro',
      })
    }
    round.lastAdvanceSteps = this.stepsTotal
    round.lastAdvanceTurns = this.turnsTotal
    round.aboveSince = undefined
    round.topAt = t
  }

  // ===================== 内部：结束一轮 =====================

  private endCalibration(reason: FusionRoundEndReason, t: number): void {
    const round = this.round
    if (!round) return
    if (!round.marks.length) {
      this.round = undefined
      this.phase = 'waiting'
      return
    }
    const topAt = round.topAt ?? round.marks.at(-1)!.t
    const baseline = round.baselineAlt
    const heightAt = (time: number): number | undefined => {
      if (baseline === undefined) return undefined
      // 点击时刻 ±1s 中位数；点击前后气压停更则该点没有高度。
      const value = this.baro.altitudeCentered(time, MARK_HEIGHT_WINDOW_MS)
      return value !== undefined ? value - baseline : undefined
    }
    const boundaries = [
      { t: round.startedAt, steps: round.stepsAtStart, turns: round.turnsAtStart, heightM: baseline !== undefined ? 0 : undefined },
      ...round.marks.map(mark => ({ t: mark.t, steps: mark.steps, turns: mark.turns, heightM: heightAt(mark.t) })),
    ]
    const result = buildTemplateFromCalibration({
      startFloor: this.startFloor, boundaries, barometer: this.baro.hasData, name: this.templateName, now: t,
    })
    this.template = result.template
    this.calibrationWarnings = result.warnings
    const floors = result.template.floors
    let cursor = round.startedAt
    const floorRecords: FusionFloorRecord[] = floors.map((floor, index) => {
      cursor += floor.durationMs
      return {
        floorTo: floor.floorTo, reachedAt: cursor, steps: floor.steps, turns: floor.turns,
        heightM: floor.heightM, source: floor.warning === '漏点拆分' ? 'split' : 'manual',
        confidence: floor.estimated && floor.warning === '漏点拆分' ? 0.5 : 1,
        estimated: floor.warning === '漏点拆分',
      }
    })
    const steps = this.stepsAt(topAt) - round.stepsAtStart
    const activeMs = this.activeAt(topAt) - round.activeAtStart
    const ascentM = templateTotalAscentM(result.template)
    const estimated = result.splitFloors > 0
    this.pushRound({
      id: round.id, roundNumber: round.number, kind: 'calibration', startedAt: round.startedAt, topAt, endedAt: t,
      startFloor: this.startFloor, finalFloor: floorAfter(this.startFloor, floors.length), floors: floors.length,
      ascentM, steps: Math.max(0, steps), activeMs: Math.max(0, activeMs),
      durationMs: Math.max(0, topAt - round.startedAt), estimated,
      confidence: floorRecords.length ? floorRecords.reduce((s, r) => s + r.confidence, 0) / floorRecords.length : 0,
      floorRecords, endReason: reason, interruptions: round.interruptions,
      baroCoverage: round.observedMs ? round.baroFreshMs / round.observedMs : 0,
      notes: [...round.notes, ...result.warnings, ...(!result.template.barometer ? ['无气压数据，层高按 3 米估算'] : [])],
    })
    this.round = undefined
    if (reason === 'elevator_down' || reason === 'stairs_down') this.enterDescending(t)
    else { this.phase = 'waiting'; this.bottomAlt = undefined }
  }

  private endAutoRound(reason: FusionRoundEndReason, t: number): void {
    const round = this.round
    if (!round || !this.template) return
    this.round = undefined
    if (!round.floors.length) return
    const template = this.template
    // 登顶时刻：最后一层到达后，高度第一次接近该层顶部（H_k − 0.1·h_k）的时刻；否则用到达时刻。
    let topAt = round.floors.at(-1)!.reachedAt
    if (round.baselineAlt !== undefined && this.templateHasHeights()) {
      const lastIndex = round.floors.length - 1
      const target = cumulativeHeightAt(template, lastIndex) - 0.1 * floorHeightAt(template, lastIndex)
      const hit = this.baro.history(topAt).find(point => point.t <= round.maxAt + 1 &&
        point.altM - round.baselineAlt! - round.driftOffset >= target)
      if (hit) topAt = Math.max(topAt, hit.t)
    }
    const hasTurnInfo = template.floors.some(floor => floor.turns > 0)
    const records = round.floors.map((floor, index) => {
      const tmplSteps = floorStepsAt(template, index)
      const ratio = Math.max(1, floor.steps) / Math.max(1, tmplSteps)
      const stepScore = this.stepsTotal - round.stepsAtStart > 0 ? Math.exp(-1.2 * Math.abs(Math.log(ratio))) : undefined
      const tmplTurns = floorTurnsAt(template, index)
      const turnDiff = tmplTurns !== undefined ? Math.abs(floor.turns - tmplTurns) : undefined
      const turnScore = hasTurnInfo && turnDiff !== undefined ? (turnDiff === 0 ? 1 : turnDiff === 1 ? 0.6 : 0.25) : undefined
      const reachedHeight = round.baselineAlt !== undefined && this.templateHasHeights() &&
        round.maxRelH >= cumulativeHeightAt(template, index) - 0.15 * floorHeightAt(template, index)
      let baroScore: number | undefined
      if (floor.source === 'baro') baroScore = reachedHeight ? 1 : 0.6
      else if (floor.source === 'baro_forced') baroScore = 0.7
      else if (floor.source === 'motion' && reachedHeight) baroScore = 0.85
      const parts: Array<[number | undefined, number]> = [[baroScore, 0.55], [stepScore, 0.3], [turnScore, 0.15]]
      let weight = 0, sum = 0
      for (const [score, w] of parts) if (score !== undefined) { weight += w; sum += score * w }
      let confidence = weight ? sum / weight : 0.3
      if (baroScore === undefined) confidence = Math.min(confidence, 0.55)
      if (floor.source === 'baro_forced') confidence = Math.min(confidence, 0.5)
      confidence = clamp(Number(confidence.toFixed(2)), 0, 1)
      return { ...floor, confidence, estimated: confidence < FLOOR_ESTIMATE_BELOW }
    })
    const steps = Math.max(0, this.stepsAt(topAt) - round.stepsAtStart)
    const activeMs = Math.max(0, this.activeAt(topAt) - round.activeAtStart)
    const floors = records.length
    this.pushRound({
      id: round.id, roundNumber: round.number, kind: 'auto', startedAt: round.startedAt, topAt, endedAt: t,
      startFloor: this.startFloor, finalFloor: floorAfter(this.startFloor, floors), floors,
      ascentM: this.ascentFor(floors), steps, activeMs, durationMs: Math.max(0, topAt - round.startedAt),
      estimated: records.some(r => r.estimated),
      confidence: Number((records.reduce((s, r) => s + r.confidence, 0) / floors).toFixed(2)),
      floorRecords: records, endReason: reason, interruptions: round.interruptions,
      baroCoverage: round.observedMs ? Number((round.baroFreshMs / round.observedMs).toFixed(2)) : 0,
      notes: round.notes,
    })
    if (round.baselineAlt !== undefined && round.maxRawAlt !== undefined && (reason === 'elevator_down' || reason === 'stairs_down')) {
      this.closurePending = true
      this.closureRound = { baselineAlt: round.baselineAlt, startedAt: round.startedAt, maxAt: round.maxAt, maxRawAlt: round.maxRawAlt }
    }
  }

  private closureRound?: { baselineAlt: number; startedAt: number; maxAt: number; maxRawAlt: number }

  /**
   * 闭合漂移修正：回到楼下平台时，平台气压高度与本轮起点之差就是这一轮累计的气压漂移。
   * 按时间线性分摊到登顶时刻，重新核对本轮最高层；结果有变化时标“估算”。
   */
  private applyClosure(t: number): void {
    const info = this.closureRound
    const last = this.rounds.at(-1)
    if (!this.closurePending || !info || !last || last.kind !== 'auto' || this.bottomAlt === undefined || !this.template) return
    this.closurePending = false
    const drift = this.bottomAlt - info.baselineAlt
    const floorH = medianFloorHeightM(this.template)
    if (Math.abs(drift) < 0.4 || Math.abs(drift) > DRIFT_CLOSURE_MAX_RATIO * floorH) return
    const fraction = clamp((info.maxAt - info.startedAt) / Math.max(1, t - info.startedAt), 0, 1)
    const correctedMax = info.maxRawAlt - info.baselineAlt - drift * fraction
    let floors = 0
    while (correctedMax >= cumulativeHeightAt(this.template, floors) - FLOOR_REACH_RATIO * floorHeightAt(this.template, floors)) floors += 1
    if (floors === last.floors || Math.abs(floors - last.floors) > 1) return
    // 交叉核对：修正后的层数必须与“步数 ÷ 模板每层步数”相差不超过 1 层才采用，
    // 避免把“回到了别的楼层（例如地下一层）”误当成漂移。
    const stepFloors = last.steps / Math.max(1, medianStepsPerFloor(this.template))
    if (Math.abs(floors - stepFloors) > 1) return
    const records = last.floorRecords.slice(0, floors)
    while (records.length < floors) {
      records.push({ floorTo: floorAfter(this.startFloor, records.length + 1), reachedAt: last.topAt, steps: 0, turns: 0,
        source: 'closure', confidence: 0.5, estimated: true })
    }
    const updated: FusionRoundResult = {
      ...last, floors, finalFloor: floorAfter(this.startFloor, floors), ascentM: this.ascentFor(floors), floorRecords: records,
      estimated: true, notes: [...last.notes, `回到楼下后按气压闭合修正了约 ${drift.toFixed(1)} 米漂移`],
    }
    this.rounds[this.rounds.length - 1] = updated
    for (const listener of this.onRoundListeners) listener(updated)
  }

  private ascentFor(floors: number): number {
    if (!this.template) return floors * DEFAULT_FLOOR_HEIGHT_M
    let total = 0
    for (let i = 0; i < floors; i += 1) total += floorHeightAt(this.template, i)
    return Number(total.toFixed(1))
  }

  private pushRound(result: FusionRoundResult): void {
    this.rounds.push(result)
    for (const listener of this.onRoundListeners) listener(result)
  }

  private status(baro: FusionSnapshot['baro']): FusionStatus {
    const noBaro = baro === 'none'
    switch (this.phase) {
      case 'calibrating':
        return { tone: 'info', text: '标定轮 · 每到一层点一下“到了一层”' }
      case 'calibration_top':
        return noBaro
          ? { tone: 'info', text: '已到顶 · 回到楼下后点“开始下一轮”' }
          : { tone: 'good', text: '已到顶 · 坐电梯下楼，自动进入下一轮' }
      case 'waiting':
        return { tone: 'info', text: noBaro ? '在楼下准备 · 开始爬就按步数计层' : '在楼下准备 · 开始爬就自动计层' }
      case 'climbing':
        if (baro === 'stale') return { tone: 'warn', text: '气压暂时停更 · 按步数和拐弯估算' }
        if (noBaro || !this.templateHasHeights()) return { tone: 'warn', text: '无气压数据 · 按步数和拐弯估算' }
        return { tone: 'good', text: `第 ${this.round?.number ?? this.rounds.length + 1} 轮 · 自动计层中` }
      case 'descending':
        return { tone: 'good', text: `第 ${this.rounds.length} 轮完成 · 下行中` }
      case 'finished':
        return { tone: 'info', text: '训练已结束' }
    }
  }
}

/** 恢复训练用：已完成轮次中的最后一轮编号。 */
export function lastRoundNumber(rounds: FusionRoundResult[]): number {
  return rounds.reduce((max, round) => Math.max(max, round.roundNumber), 0)
}

export { median as fusionMedian }
