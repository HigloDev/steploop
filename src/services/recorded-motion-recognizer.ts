import { FreeRecognizer } from '../core/free-recognizer'
import { RouteRecognizer } from '../core/recognizer'
import { ClimbMode, FeatureFrame, RouteTemplate } from '../core/types'
import { WorkoutEvidenceJournal } from './workout-evidence-store'

/** Record the inputs actually consumed, in call order, before producing a result. */
export class RecordedMotionRecognizer {
  private readonly recognizer: RouteRecognizer | FreeRecognizer
  private inputCount = 0

  constructor(template: RouteTemplate, private readonly startedAt: number,
    private readonly mode: ClimbMode, private readonly journal?: WorkoutEvidenceJournal) {
    const reference = JSON.parse(JSON.stringify(template)) as RouteTemplate
    this.recognizer = mode === 'free' ? new FreeRecognizer(reference, startedAt) : new RouteRecognizer(reference, startedAt)
    this.journal?.event('recognition_reference', startedAt, {
      format: 1, algorithmVersion: 'motion-v3', processingVersion: 'continuous-motion-1',
      mode, startedAt, template: reference,
    })
  }

  pushFrame(frame: FeatureFrame) {
    this.recordInput(frame.endMs, { type: 'frame', frame: { ...frame } })
    return this.recognizer.pushFrame(frame)
  }

  pushBarometer(pressure: number, atMs: number) {
    this.recordInput(atMs, { type: 'pressure', pressure, atMs })
    return this.recognizer.pushBarometer(pressure, atMs)
  }

  pause(atMs: number) {
    this.recordInput(atMs, { type: 'pause', atMs })
    this.recognizer.pause(atMs)
  }

  resume(atMs: number) {
    this.recordInput(atMs, { type: 'resume', atMs })
    this.recognizer.resume(atMs)
  }

  confirmFloor(floor: number, atMs: number) {
    this.recordInput(atMs, { type: 'confirm_floor', floor, atMs })
    return this.recognizer.confirmFloor(floor, atMs)
  }

  snapshot() { return this.recognizer.snapshot() }

  private recordInput(atMs: number, input: object) {
    this.inputCount++
    this.journal?.event('recognition_input', this.startedAt + atMs, { ...input, sequence: this.inputCount })
  }

  finish(endedAt = Date.now(), mode = this.mode) {
    this.journal?.event('recognition_checkpoint', endedAt, { inputCount: this.inputCount, snapshot: this.snapshot() })
    return this.recognizer.finish(endedAt, mode)
  }
}
