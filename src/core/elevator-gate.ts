import {
  ELEVATOR_MAX_STEPS,
  ELEVATOR_MIN_ACTIVE_FRAMES,
  ELEVATOR_MIN_FLOORS,
  ELEVATOR_WINDOW_MS,
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
