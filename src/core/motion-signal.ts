import { clamp } from './math'
import { FeatureFrame, SensorSample } from './types'

export interface TimedMotionSignal {
  t: number
  motion: number
  turn: number
  headingTurn: number
  step: boolean
}

/** One continuous signal history, shared by recording, live use and replay. */
export class MotionSignalProcessor {
  private lastAt?: number
  private gravity = 0
  private gravityX = 0
  private gravityY = 0
  private gravityZ = 0
  private smooth = 0
  private lastStepAt = -Infinity

  push(sample: SensorSample): TimedMotionSignal | undefined {
    if (![sample.t, sample.ax, sample.ay, sample.az].every(Number.isFinite) ||
        (this.lastAt !== undefined && sample.t <= this.lastAt)) return undefined
    const magnitude = Math.hypot(sample.ax, sample.ay, sample.az)
    if (this.lastAt === undefined || sample.t - this.lastAt > 1800) {
      this.gravity = magnitude
      this.gravityX = sample.ax
      this.gravityY = sample.ay
      this.gravityZ = sample.az
      this.smooth = 0
      this.lastStepAt = -Infinity
    }
    // The original coefficients describe 20 ms input. Preserve their time span
    // when measured samples arrive more slowly; do not invent missing samples.
    const scale = this.lastAt === undefined ? 1 : clamp(sample.t - this.lastAt, 1, 250) / 20
    this.lastAt = sample.t
    const gravityWeight = Math.pow(0.985, scale)
    const motionWeight = Math.pow(0.72, scale)
    const directionWeight = Math.pow(0.97, scale)
    this.gravity = this.gravity * gravityWeight + magnitude * (1 - gravityWeight)
    const previous = this.smooth
    this.smooth = this.smooth * motionWeight + Math.abs(magnitude - this.gravity) * (1 - motionWeight)
    const step = this.smooth > 0.13 && previous <= 0.13 && sample.t - this.lastStepAt >= 260
    if (step) this.lastStepAt = sample.t
    this.gravityX = this.gravityX * directionWeight + sample.ax * (1 - directionWeight)
    this.gravityY = this.gravityY * directionWeight + sample.ay * (1 - directionWeight)
    this.gravityZ = this.gravityZ * directionWeight + sample.az * (1 - directionWeight)
    const norm = Math.max(0.001, Math.hypot(this.gravityX, this.gravityY, this.gravityZ))
    return { t: sample.t, motion: this.smooth, step,
      turn: Number.isFinite(sample.gz) ? sample.gz : 0,
      headingTurn: ((sample.gx || 0) * this.gravityX + (sample.gy || 0) * this.gravityY +
        (sample.gz || 0) * this.gravityZ) / norm }
  }
}

/** Frames have a fixed clock; opening a new frame never resets the signal. */
export class MotionFrameStream {
  private readonly signal = new MotionSignalProcessor()
  private origin?: number
  private frameStart = 0
  private points: Array<TimedMotionSignal & { turnDelta: number; headingDelta: number }> = []
  private previous?: TimedMotionSignal

  constructor(private readonly onFrame: (frame: FeatureFrame) => void) {}

  push(sample: SensorSample): void {
    const point = this.signal.push(sample)
    if (!point) return
    if (this.origin === undefined) this.origin = this.frameStart = point.t
    if (point.t >= this.frameStart + 500) {
      this.emit(this.frameStart + 500)
      this.frameStart = this.origin + Math.floor((point.t - this.origin) / 500) * 500
    }
    // Include the interval crossing a frame boundary. Dropping it in every
    // frame systematically undercounts turns, especially in sparse old exports.
    const dt = this.previous && point.t - this.previous.t <= 250 ? (point.t - this.previous.t) / 1000 : 0
    this.points.push({ ...point,
      turnDelta: this.previous ? (this.previous.turn + point.turn) * dt / 2 : 0,
      headingDelta: this.previous ? (this.previous.headingTurn + point.headingTurn) * dt / 2 : 0 })
    this.previous = point
  }

  flush(): void {
    const last = this.points.at(-1)
    if (last && last.t > this.frameStart) this.emit(last.t)
  }

  private emit(end: number): void {
    const points = this.points
    this.points = []
    if (!points.length || this.origin === undefined) return
    const steps = points.filter(point => point.step).length
    const energy = points.reduce((sum, point) => sum + point.motion, 0) / points.length
    const turnRad = points.reduce((sum, point) => sum + point.turnDelta, 0)
    const headingTurnRad = points.reduce((sum, point) => sum + point.headingDelta, 0)
    this.onFrame({ startMs: this.frameStart - this.origin, endMs: end - this.origin,
      steps, cadence: steps * 120, energy, turnRad, headingTurnRad,
      paused: steps === 0 && energy < 0.045 ? 1 : 0 })
  }
}
