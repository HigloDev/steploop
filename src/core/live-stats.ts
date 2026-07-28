import { SensorSample } from './types'

export interface LiveMotionState {
  steps: number
  energy: number
  turn: 'left' | 'right' | ''
  stepDetected: boolean
}

export class LiveMotionStats {
  private gravity = 1
  private smooth = 0
  private previous = 0
  private lastStepAt = -Infinity
  private steps = 0
  private turnSum = 0
  private lastSampleAt = 0

  push(sample: SensorSample): LiveMotionState {
    const magnitude = Math.sqrt(sample.ax ** 2 + sample.ay ** 2 + sample.az ** 2)
    this.gravity = this.gravity * 0.985 + magnitude * 0.015
    const linear = Math.abs(magnitude - this.gravity)
    this.smooth = this.smooth * 0.72 + linear * 0.28
    const stepDetected =
      this.smooth > 0.13 && this.previous <= 0.13 && sample.t - this.lastStepAt >= 260
    if (stepDetected) {
      this.steps += 1
      this.lastStepAt = sample.t
    }
    const dt = this.lastSampleAt
      ? Math.min(0.1, Math.max(0, (sample.t - this.lastSampleAt) / 1000))
      : 0
    this.turnSum += sample.gz * dt
    let turn: LiveMotionState['turn'] = ''
    if (Math.abs(this.turnSum) >= 0.65) {
      turn = this.turnSum > 0 ? 'left' : 'right'
      this.turnSum = 0
    }
    this.previous = this.smooth
    this.lastSampleAt = sample.t
    return {
      steps: this.steps,
      energy: Math.min(1, this.smooth / 0.35),
      turn,
      stepDetected,
    }
  }
}
