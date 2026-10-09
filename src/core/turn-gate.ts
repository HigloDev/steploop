import { FeatureFrame, TurnDirection } from './types'
import { BARO_V1 } from './sensor-params'

// 半层平台上的一个完整转向，陀螺仪累计角度至少约 60° 才算。
// 这能过滤掉手持手机晃动或走楼梯时的细小摆动。
const TURNING_FRAME_THRESHOLD_RAD = BARO_V1.turningFrameRad
const COMPLETE_TURN_THRESHOLD_RAD = BARO_V1.completeTurnRad
const TURN_GAP_MS = BARO_V1.turnGapMs

export interface CompletedTurn {
  direction: TurnDirection
  atMs: number
  confidence: number
}

/**
 * 把连续若干帧的转向合并成一个“整拐”。
 * 楼梯的一个完整楼层由两个整拐组成；调用方在推进楼层后 reset()。
 */
export class StairTurnGate {
  private active = false
  private accumulatedRad = 0
  private startedAt = 0
  private lastFrameEnd = -Infinity
  private completedCount = 0

  push(frame: FeatureFrame): CompletedTurn | undefined {
    const turnRad = Number.isFinite(frame.headingTurnRad)
      ? frame.headingTurnRad!
      : frame.turnRad
    const isTurning = Math.abs(turnRad) >= TURNING_FRAME_THRESHOLD_RAD
    const hasLongGap = frame.startMs - this.lastFrameEnd > TURN_GAP_MS
    this.lastFrameEnd = frame.endMs
    let completed: CompletedTurn | undefined

    if (!isTurning || (this.active && hasLongGap)) {
      completed = this.flush(frame.startMs)
      if (!isTurning) return completed
    }

    if (!this.active) {
      this.active = true
      this.accumulatedRad = 0
      this.startedAt = frame.startMs
    }

    // 一次拐弯中方向不应反复切换。方向反向时，把前一段结算并重新开始。
    if (
      this.accumulatedRad !== 0 &&
      Math.sign(this.accumulatedRad) !== Math.sign(turnRad)
    ) {
      const completed = this.flush(frame.startMs)
      this.active = true
      this.accumulatedRad = turnRad
      this.startedAt = frame.startMs
      return completed
    }

    this.accumulatedRad += turnRad
    return completed
  }

  get completedTurns(): number {
    return this.completedCount
  }

  /** 一层只消费两个整拐，保留多余证据供漏识别后的楼层追赶使用。 */
  consume(count: number): void {
    this.completedCount = Math.max(0, this.completedCount - Math.max(0, count))
  }

  reset(): void {
    this.active = false
    this.accumulatedRad = 0
    this.startedAt = 0
    this.completedCount = 0
  }

  private flush(atMs: number): CompletedTurn | undefined {
    if (!this.active) return undefined
    const absolute = Math.abs(this.accumulatedRad)
    const direction: TurnDirection =
      this.accumulatedRad >= 0 ? 'left' : 'right'
    this.active = false
    this.accumulatedRad = 0

    if (absolute < COMPLETE_TURN_THRESHOLD_RAD) return undefined
    this.completedCount += 1
    return {
      direction,
      atMs: this.startedAt || atMs,
      confidence: Math.min(0.98, Math.max(0.65, absolute / Math.PI)),
    }
  }
}
