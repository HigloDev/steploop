import {
  ELEVATOR_MAX_STEPS,
  ELEVATOR_MIN_ACTIVE_FRAMES,
  ELEVATOR_MIN_FLOORS,
  ELEVATOR_WINDOW_MS,
  ELEVATOR_MAX_STEPS_FUSION,
  ELEVATOR_MIN_MS,
  ELEVATOR_SPEED_MPS,
} from './sensor-params'
import { FeatureFrame } from './types'

const ACTIVE_FRAME_ENERGY = 0.06
const MIN_WINDOW_FRAMES = 4

/**
 * 电梯/扶梯负样本门控：近 N 秒高度快速上升，却几乎没有脚步、
 * 没有整拐、也没有持续动作能量 → 判为 elevator_suspect，拒绝推进。
 * 持续有 energy 的慢爬会被宽恕（activeIn 达标即放行）。
 */
export class ElevatorGate {
  private frames: FeatureFrame[] = []
  private heights: Array<{ t: number; h: number }> = []
  private turns: number[] = []

  pushFrame(frame: FeatureFrame, estimatedHeightM: number): void {
    this.frames.push(frame)
    this.heights.push({ t: frame.endMs, h: estimatedHeightM })
    const cutoff = frame.endMs - ELEVATOR_WINDOW_MS
    while (this.frames.length && this.frames[0].endMs < cutoff) {
      this.frames.shift()
    }
    while (this.heights.length && this.heights[0].t < cutoff) {
      this.heights.shift()
    }
  }

  pushTurn(atMs: number): void {
    this.turns.push(atMs)
  }

  isSuspect(floorHeightM: number, currentHeightM: number): boolean {
    const last = this.frames.at(-1)
    if (!last || this.frames.length < MIN_WINDOW_FRAMES) return false
    const cutoff = last.endMs - ELEVATOR_WINDOW_MS
    while (this.turns.length && this.turns[0] < cutoff) {
      this.turns.shift()
    }
    let stepsIn = 0
    let activeIn = 0
    for (const frame of this.frames) {
      if (frame.endMs < cutoff) continue
      stepsIn += frame.steps
      if (frame.steps > 0 || frame.energy >= ACTIVE_FRAME_ENERGY) {
        activeIn += 1
      }
    }
    const heightThen = this.heights[0]?.h ?? 0
    const heightRise = currentHeightM - heightThen
    const minHeightRise =
      ELEVATOR_MIN_FLOORS * (floorHeightM > 0 ? floorHeightM : 3)
    return (
      heightRise >= minHeightRise &&
      stepsIn <= ELEVATOR_MAX_STEPS &&
      this.turns.length === 0 &&
      activeIn < ELEVATOR_MIN_ACTIVE_FRAMES
    )
  }
}


export type VerticalTransit = 'elevator_down' | 'elevator_up'

/**
 * fusion-v1 电梯识别：基于气压垂直速度 + 步数。
 * - 垂直速度 < −0.7 m/s 持续 ≥ 2s，且这段时间步数 ≤ 2 → 电梯下行（用于自动切轮）；
 * - 同样条件取正 → 电梯上行（期间不计层）。
 * 速度来自 BaroAltimeter（只用真实气压事件），气压停更时调用方传 undefined，状态清零。
 */
export class ElevatorDetector {
  private downSince?: number
  private upSince?: number
  private stepTimes: number[] = []

  pushSteps(t: number, count: number): void {
    for (let i = 0; i < count; i += 1) this.stepTimes.push(t)
    while (this.stepTimes.length && this.stepTimes[0] < t - 30000) this.stepTimes.shift()
  }

  private stepsSince(t: number): number {
    return this.stepTimes.filter(time => time >= t).length
  }

  /** 送入一个速度读数，返回当前识别到的电梯运动（没有时 undefined）。 */
  observe(t: number, speedMps: number | undefined): VerticalTransit | undefined {
    if (speedMps === undefined || !Number.isFinite(speedMps)) {
      this.downSince = undefined
      this.upSince = undefined
      return undefined
    }
    if (speedMps < -ELEVATOR_SPEED_MPS) this.downSince ??= t
    else this.downSince = undefined
    if (speedMps > ELEVATOR_SPEED_MPS) this.upSince ??= t
    else this.upSince = undefined
    // 回归斜率本身有 ~2s 滞后，所以步数窗口向前多看 1s。
    if (this.downSince !== undefined && t - this.downSince >= ELEVATOR_MIN_MS &&
        this.stepsSince(this.downSince - 1000) <= ELEVATOR_MAX_STEPS_FUSION) return 'elevator_down'
    if (this.upSince !== undefined && t - this.upSince >= ELEVATOR_MIN_MS &&
        this.stepsSince(this.upSince - 1000) <= ELEVATOR_MAX_STEPS_FUSION) return 'elevator_up'
    return undefined
  }

  /** 电梯下行开始的时刻（用于把本轮结束时间回溯到下行之前）。 */
  get descentStartedAt(): number | undefined {
    return this.downSince
  }

  reset(): void {
    this.downSince = undefined
    this.upSince = undefined
  }
}
