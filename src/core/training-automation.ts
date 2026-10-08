import { TrackingMode, WorkoutPhase } from './types'

/** Raw input timestamps are wall-clock milliseconds, never timer-generated samples. */
export interface TrainingAutomationObservation {
  t: number
  relativeHeightM?: number
  barometerAvailable: boolean
  pressureReliable?: boolean
  pressureDirection?: 'up' | 'down' | 'level' | 'unknown'
  /** Cumulative steps within the current sensor owner. */
  steps: number
  targetReached?: boolean
  reliableTarget?: boolean
}

export type TrainingAutomationAction =
  | { type: 'finish_round'; at: number; cause: 'elevator_down' }
  | { type: 'returned_to_start'; at: number }
  | { type: 'begin_next_round'; at: number; climbStartedAt: number }

export interface TrainingAutomationUpdate {
  status: string
  action?: TrainingAutomationAction
  elevatorDescending?: boolean
}

export interface TrainingAutomationConfig {
  floorHeightM?: number
  returnHoldMs?: number
  maxSampleGapMs?: number
}

interface HeightPoint {
  t: number
  h: number
  steps: number
}

/** Legacy return assistance maps to confirmation mode; existing checkpoints remain readable. */
export function resolveTrackingMode(
  mode?: TrackingMode,
  returnMode: 'manual' | 'assisted' = 'manual',
): TrackingMode {
  return mode ?? (returnMode === 'assisted' ? 'automatic' : 'manual')
}

/** Immediate phase guidance also works while a sensor stream is idle or being handed off. */
export function trainingPhasePrompt(mode: TrackingMode, phase: WorkoutPhase, paused = false): string {
  if (paused) return '自动衔接已暂停，请确认实际楼层；传感器仍在记录'
  if (phase === 'round_complete') return mode === 'full_auto'
    ? '本轮已保存，等待返回起点；可随时手动确认返回'
    : '本轮已保存，返回起点后再开始下一轮'
  if (phase === 'returning' || phase === 'start_confirmation') return mode === 'manual'
    ? '手动记录：到达起点后确认返回'
    : '正在监测返回，可随时确认已到起点'
  if (phase === 'round_ready' || phase === 'recovering') return mode === 'full_auto'
    ? '已到起点，等待向上脚步；等待和休息不计入爬楼'
    : '按自己的节奏休息，准备好后开始下一轮'
  if (phase === 'ascending') return mode === 'manual'
    ? '手动记录：可随时确认实际楼层并结束本轮'
    : mode === 'full_auto' ? '自动记录爬升，持续识别终点和电梯下行' : '自动识别中，本轮结束由你确认'
  if (phase === 'workout_complete') return '训练已结束'
  return '准备记录训练'
}

/**
 * One-way automation for a stair/elevator/stair cycle. Pressure noise alone never starts
 * a round: it needs a sustained upward trend AND real steps. Returning to the start
 * only records arrival; active climbing begins with a separate action.
 */
export class TrainingAutomation {
  private phase: WorkoutPhase = 'setup'
  private mode: TrackingMode
  private points: HeightPoint[] = []
  private nearSince?: number
  private elevatorSince?: number
  private emitted = false
  private sawAway = false
  private peakHeight = 0
  private peakAt = 0
  private lastT = 0
  private floorHeightM: number
  private returnHoldMs: number
  private maxSampleGapMs: number

  constructor(mode: TrackingMode, config: TrainingAutomationConfig = {}) {
    this.mode = mode
    this.floorHeightM = Math.max(2, Math.min(6, config.floorHeightM ?? 3))
    this.returnHoldMs = config.returnHoldMs ?? 2000
    this.maxSampleGapMs = config.maxSampleGapMs ?? 1800
  }

  setMode(mode: TrackingMode): void {
    if (mode === this.mode) return
    this.mode = mode
    this.resetWindow()
  }

  enterPhase(phase: WorkoutPhase): void {
    if (this.phase === phase) return
    this.phase = phase
    this.resetWindow()
    if (phase === 'ascending' || phase === 'setup') {
      this.peakHeight = 0
      this.peakAt = 0
      this.sawAway = false
    }
    if (phase === 'recovering' || phase === 'round_ready') {
      this.peakHeight = 0
      this.peakAt = 0
    }
  }

  /** A sensor discontinuity invalidates all holds and motion evidence. */
  gap(): void {
    this.resetWindow()
    this.sawAway = false
    this.peakAt = 0
  }

  private resetWindow(): void {
    this.points = []
    this.nearSince = undefined
    this.elevatorSince = undefined
    this.emitted = false
    this.lastT = 0
  }

  observe(input: TrainingAutomationObservation): TrainingAutomationUpdate {
    if (this.mode === 'manual') {
      return { status: trainingPhasePrompt(this.mode, this.phase) }
    }
    if (input.targetReached && this.mode === 'automatic' && this.phase === 'ascending') {
      return { status: '已识别到路线终点，请确认实际楼层并结束本轮' }
    }
    if (
      !input.barometerAvailable ||
      input.relativeHeightM === undefined ||
      !Number.isFinite(input.relativeHeightM)
    ) {
      this.resetWindow()
      return { status: '气压计不可用，请手动确认楼层、返回和下一轮' }
    }
    if (!Number.isFinite(input.t) || input.t <= this.lastT) {
      return { status: '等待连续的传感器数据，可随时手动接管' }
    }
    if (this.lastT && input.t - this.lastT > this.maxSampleGapMs) this.gap()
    this.lastT = input.t
    const h = input.relativeHeightM
    const newSteps = input.steps > (this.points.at(-1)?.steps ?? input.steps)
    this.points.push({ t: input.t, h, steps: Math.max(0, input.steps) })
    this.points = this.points.filter((point) => point.t >= input.t - 4500)
    const first = this.points[0]
    const dt = input.t - first.t
    const rise = h - first.h
    const speed = dt > 0 ? rise / (dt / 1000) : 0
    const steps = Math.max(0, input.steps - first.steps)
    const hasWindow = dt >= 2200
    const reliable = hasWindow && input.pressureReliable !== false
    const up = reliable && (input.pressureDirection === 'up' ||
      (input.pressureDirection === undefined && speed >= 0.1))
    const down = reliable && (input.pressureDirection === 'down' ||
      (input.pressureDirection === undefined && speed < -0.45))
    if (up && steps >= 3) {
      this.sawAway = true
      if (newSteps) this.peakAt = input.t
    }
    const recent = this.points.filter((point) => point.t >= input.t - 1200)
    const recentFirst = recent[0]
    const recentSpeed = recentFirst && input.t > recentFirst.t
      ? (h - recentFirst.h) / ((input.t - recentFirst.t) / 1000)
      : 0

    if (this.phase === 'ascending') {
      const elevatorDown = down && this.sawAway && speed < -0.45 && steps <= 2
      this.elevatorSince = elevatorDown
        ? (this.elevatorSince ?? input.t)
        : undefined
      if (this.elevatorSince !== undefined && input.t - this.elevatorSince >= 800) {
        if (this.mode === 'full_auto' && !this.emitted) {
          this.emitted = true
          return {
            status: '可能正在乘电梯下行，本轮已保存，请确认实际楼层',
            elevatorDescending: true,
            action: { type: 'finish_round', at: this.peakAt || input.t, cause: 'elevator_down' },
          }
        }
        return { status: '可能正在乘电梯下行，请确认实际楼层并结束本轮', elevatorDescending: true }
      }
      return { status: this.mode === 'full_auto'
        ? '自动记录爬升，持续识别终点和电梯下行'
        : '自动识别中，本轮结束由你确认' }
    }

    if (this.phase === 'returning' || this.phase === 'start_confirmation') {
      // 气压停止变化只说明停下了，不能证明已经到了哪一层。
      if (reliable && Math.abs(recentSpeed) < 0.22) {
        return { status: '已经停稳；到了起点请点“确认返回”' }
      }
      return { elevatorDescending: down && speed < -0.45 && steps <= 2,
        status: down && speed < -0.45 && steps <= 2
        ? '正在乘电梯下行，电梯不计入爬升'
        : '返回监测中，可手动确认已到起点' }
    }

    if (this.phase === 'recovering' || this.phase === 'round_ready') {
      const actualClimb = up &&
        speed >= 0.1 && speed <= 1.4 && steps >= 4
      if (actualClimb) {
        if (this.mode === 'full_auto' && !this.emitted) {
          this.emitted = true
          const firstStep = this.points.find((point) => point.steps > first.steps)
          return { status: '已识别真实向上爬升，开始新一轮',
            action: { type: 'begin_next_round', at: input.t,
              climbStartedAt: firstStep ? Math.max(first.t, firstStep.t - 400) : first.t } }
        }
        return { status: '识别到向上爬升，请开始下一轮' }
      }
      return { status: '已到起点，等待向上脚步；等待和休息不计入爬楼' }
    }
    return { status: '自动记录已就绪' }
  }
}
