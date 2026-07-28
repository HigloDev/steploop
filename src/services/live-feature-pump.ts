import { extractFrames } from '../core/analysis'
import { FeatureFrame, SensorSample } from '../core/types'

export class LiveFeaturePump {
  private buffer: SensorSample[] = []
  private origin = 0
  private onFrame: (frame: FeatureFrame) => void

  constructor(onFrame: (frame: FeatureFrame) => void) {
    this.onFrame = onFrame
  }

  push(sample: SensorSample): void {
    if (!this.origin) this.origin = sample.t
    this.buffer.push(sample)
    if (this.buffer.length < 2) return
    const duration = sample.t - this.buffer[0].t
    if (duration < 540) return
    const frames = extractFrames(this.buffer)
    if (!frames.length) return
    const first = frames[0]
    const offset = this.buffer[0].t - this.origin
    this.onFrame({
      ...first,
      startMs: first.startMs + offset,
      endMs: first.endMs + offset,
    })
    const cutoff = this.buffer[0].t + 500
    this.buffer = this.buffer.filter((point) => point.t >= cutoff)
  }
}
