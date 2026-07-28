import { extractFrames, vectorizeFrame } from './analysis'
import { dtwConfidence } from './dtw'
import { clamp, uid } from './math'
import {
  ClimbSession,
  ClimbMode,
  FeatureFrame,
  RecognitionEvent,
  RecognitionSnapshot,
  RouteTemplate,
  SensorSample,
} from './types'

const MATCH_THRESHOLD = 0.72
const MIN_PROGRESS = 0.65

export class RouteRecognizer {
  private template: RouteTemplate
  private segmentIndex = 0
  private observed: number[][] = []
  private observedSteps = 0
  private events: RecognitionEvent[] = []
  private totalSteps = 0
  private floorSplits: ClimbSession['floorSplits'] = []
  private interruptions: ClimbSession['interruptions'] = []
  private startedAt: number
  private paused = false
  private lastFrame?: FeatureFrame
  private lastTurnAt = -Infinity
  private currentConfidence = 0

  constructor(template: RouteTemplate, startedAt = Date.now()) {
    this.template = template
    this.startedAt = startedAt
  }

  pushFrame(frame: FeatureFrame): RecognitionSnapshot {
    if (this.paused || this.segmentIndex >= this.template.segments.length) {
      return this.snapshot()
    }
    const segment = this.template.segments[this.segmentIndex]
    this.observed.push(vectorizeFrame(frame))
    this.observedSteps += frame.steps
    this.totalSteps += frame.steps
    this.lastFrame = frame

    if (Math.abs(frame.turnRad) > 0.58 && frame.startMs - this.lastTurnAt > 1200) {
      const direction = frame.turnRad >= 0 ? 'left' : 'right'
      this.lastTurnAt = frame.startMs
      this.events.push({
        t: frame.startMs,
        type: 'turn',
        direction,
        confidence: clamp(Math.abs(frame.turnRad) / 1.2, 0.5, 0.98),
      })
    }

    const templateLength = Math.max(1, segment.features.length)
    const progress = this.observed.length / templateLength
    const stepProgress = this.observedSteps / Math.max(1, segment.stepCount)
    this.currentConfidence = dtwConfidence(this.observed, segment.features)

    if (
      progress >= MIN_PROGRESS &&
      stepProgress >= 0.58 &&
      this.currentConfidence >= MATCH_THRESHOLD
    ) {
      const elapsedMs = frame.endMs
      this.events.push({
        t: elapsedMs,
        type: 'floor',
        floor: segment.floorTo,
        confidence: this.currentConfidence,
      })
      this.floorSplits.push({
        floor: segment.floorTo,
        atMs: elapsedMs,
        elapsedMs,
      })
      this.segmentIndex += 1
      this.observed = []
      this.observedSteps = 0
    }
    return this.snapshot()
  }

  pushSamples(samples: SensorSample[]): RecognitionSnapshot {
    extractFrames(samples).forEach((frame) => this.pushFrame(frame))
    return this.snapshot()
  }

  pause(atMs: number): void {
    if (this.paused) return
    this.paused = true
    this.interruptions.push({ startMs: atMs, endMs: atMs })
    this.events.push({ t: atMs, type: 'gap', confidence: 1 })
  }

  resume(atMs: number): void {
    if (!this.paused) return
    this.paused = false
    const current = this.interruptions.at(-1)
    if (current) current.endMs = atMs
    this.events.push({ t: atMs, type: 'resume', confidence: 1 })
  }

  snapshot(): RecognitionSnapshot {
    const completed = this.template.segments.slice(0, this.segmentIndex)
    const currentFloor = completed.at(-1)?.floorTo ?? this.template.startFloor
    const complete = this.segmentIndex >= this.template.segments.length
    return {
      currentFloor,
      floorsCompleted: completed.length,
      ascentM: completed.reduce((sum, segment) => sum + segment.ascentM, 0),
      steps: this.totalSteps,
      confidence: complete ? 1 : this.currentConfidence,
      status: complete
        ? 'complete'
        : this.paused
          ? 'paused'
          : this.currentConfidence > 0 && this.currentConfidence < MATCH_THRESHOLD
            ? 'low_confidence'
            : 'matching',
      lastTurn: this.events.filter((event) => event.type === 'turn').at(-1)?.direction,
    }
  }

  finish(endedAt = Date.now(), mode: ClimbMode = 'formal'): ClimbSession {
    const snapshot = this.snapshot()
    const durationMs = Math.max(0, endedAt - this.startedAt)
    const splitDurations = this.floorSplits.map((split, index) =>
      Math.max(0, split.elapsedMs - (this.floorSplits[index - 1]?.elapsedMs ?? 0)),
    )
    return {
      id: uid('session'),
      templateId: this.template.id,
      templateVersion: this.template.version,
      startedAt: this.startedAt,
      endedAt,
      startFloor: this.template.startFloor,
      finalFloor: snapshot.currentFloor,
      floorsCompleted: snapshot.floorsCompleted,
      ascentM: snapshot.ascentM,
      steps: snapshot.steps,
      confidence: snapshot.confidence,
      complete:
        snapshot.status === 'complete' && this.interruptions.length === 0,
      events: this.events,
      floorSplits: this.floorSplits,
      interruptions: this.interruptions,
      mode,
      routeSnapshot: {
        name: this.template.name,
        locationName: this.template.location?.name ?? this.template.name,
        startFloor: this.template.startFloor,
        endFloor: this.template.endFloor,
        totalAscentM: this.template.totalAscentM,
      },
      durationMs,
      averageFloorMs: snapshot.floorsCompleted
        ? Math.round(durationMs / snapshot.floorsCompleted)
        : 0,
      bestFloorSplitMs: splitDurations.length ? Math.min(...splitDurations) : 0,
    }
  }
}

export function replayTemplate(
  template: RouteTemplate,
  samples: SensorSample[],
  startedAt = Date.now(),
): ClimbSession {
  const recognizer = new RouteRecognizer(template, startedAt)
  recognizer.pushSamples(samples)
  return recognizer.finish(startedAt + (samples.at(-1)?.t ?? 0) - (samples[0]?.t ?? 0))
}
