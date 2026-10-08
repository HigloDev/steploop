import { MotionFrameStream } from '../core/motion-signal'
import { FeatureFrame, SensorSample } from '../core/types'

export class LiveFeaturePump {
  private readonly stream: MotionFrameStream

  constructor(onFrame: (frame: FeatureFrame) => void) {
    this.stream = new MotionFrameStream(onFrame)
  }

  push(sample: SensorSample): void {
    this.stream.push(sample)
  }
}
