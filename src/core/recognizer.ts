import { extractFrames, vectorizeFrame } from './analysis'
import { dtwConfidence } from './dtw'
import { getFloorTransitionCount } from './floors'
import { clamp, uid } from './math'
import { StairTurnGate } from './turn-gate'
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
const BAROMETER_BASELINE_SAMPLES = 5
const BAROMETER_SMOOTH_SAMPLES = 10
const METERS_PER_HPA = 8.3
// 气压只作“已经爬够一层高度”的辅助确认；真正推进必须完成两个整拐。
const FLOOR_HEIGHT_CONFIRM_RATIO = 0.88
const TURNS_REQUIRED_PER_FLOOR = 2
const BAROMETER_STEP_CONFIRM_RATIO = 0.65

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
  private readonly turnGate = new StairTurnGate()
  private currentConfidence = 0
  private baselinePressure?: number
  private baselineSamples: number[] = []
  private pressureWindow: number[] = []
  private hasBarometer = false
  private estimatedHeightM = 0

  constructor(template: RouteTemplate, startedAt = Date.now()) {
    this.template = template
    this.startedAt = startedAt
  }

  pushFrame(frame: FeatureFrame): RecognitionSnapshot {
    if (this.paused || this.segmentIndex >= this.segmentCount) {
      return this.snapshot()
    }
    const segment = this.template.segments[this.segmentIndex]
    this.observed.push(vectorizeFrame(frame))
    // 防呆：observed 只用于与模板段匹配，超出模板长度 2 倍后丢弃最早帧。
    // 匹配长期失败（原地等待、乘电梯、站在楼层里）时，DTW 的 O(n·m) 分配
    // 会随数组无限增长，导致 JS 堆持续攀升直至系统杀进程。
    const observedCap = Math.max(24, segment.features.length * 2)
    if (this.observed.length > observedCap) {
      this.observed.splice(0, this.observed.length - observedCap)
    }
    this.observedSteps += frame.steps
    this.totalSteps += frame.steps
    this.lastFrame = frame

    const completedTurn = this.turnGate.push(frame)
    if (completedTurn) {
      this.events.push({
        t: completedTurn.atMs,
        type: 'turn',
        direction: completedTurn.direction,
        confidence: completedTurn.confidence,
      })
    }

    const templateLength = Math.max(1, segment.features.length)
    const progress = this.observed.length / templateLength
    const stepProgress = this.observedSteps / Math.max(1, segment.stepCount)
    this.currentConfidence = dtwConfidence(this.observed, segment.features)

    if (
      progress >= MIN_PROGRESS &&
      stepProgress >= 0.58 &&
      this.currentConfidence >= MATCH_THRESHOLD &&
      this.hasCompletedFloorRoute() &&
      (!this.hasBarometer || this.hasReachedCurrentFloorHeight())
    ) {
      this.advanceSegment(frame.endMs, this.currentConfidence)
    }
    return this.snapshot()
  }

  /**
   * 正式训练也接收气压。动作模板负责识别节奏，气压负责守住整层边界并
   * 在模板局部对不上时脱困，避免第二轮永远卡在第一段。
   */
  pushBarometer(pressure: number): RecognitionSnapshot {
    if (!Number.isFinite(pressure) || pressure <= 0 || this.paused) {
      return this.snapshot()
    }
    this.hasBarometer = true
    if (this.baselinePressure === undefined) {
      this.baselineSamples.push(pressure)
      if (this.baselineSamples.length >= BAROMETER_BASELINE_SAMPLES) {
        this.baselinePressure =
          this.baselineSamples.reduce((sum, value) => sum + value, 0) /
          this.baselineSamples.length
      }
      return this.snapshot()
    }

    this.pressureWindow.push(pressure)
    if (this.pressureWindow.length > BAROMETER_SMOOTH_SAMPLES) {
      this.pressureWindow.shift()
    }
    const smoothed =
      this.pressureWindow.reduce((sum, value) => sum + value, 0) /
      this.pressureWindow.length
    this.estimatedHeightM = Math.max(
      0,
      (this.baselinePressure - smoothed) * METERS_PER_HPA,
    )

    if (this.segmentIndex >= this.segmentCount) return this.snapshot()
    const segment = this.template.segments[this.segmentIndex]
    if (!segment || !this.hasReachedCurrentFloorHeight()) return this.snapshot()

    // 气压只负责确认高度，不能单独推进楼层。
    const minimumSteps = Math.max(
      8,
      Math.round(segment.stepCount * BAROMETER_STEP_CONFIRM_RATIO),
    )
    if (
      this.observedSteps < minimumSteps ||
      !this.hasCompletedFloorRoute()
    ) {
      return this.snapshot()
    }

    const elapsedMs = Math.max(0, Date.now() - this.startedAt)
    // 气压兜底的置信度略低于动作完整匹配，但足以让路线继续向前。
    this.advanceSegment(elapsedMs, Math.max(0.74, this.currentConfidence))
    return this.snapshot()
  }

  private hasReachedCurrentFloorHeight(): boolean {
    const current = this.template.segments[this.segmentIndex]
    if (!current) return false
    const expectedFlights = this.segmentCount
    const learnedHeightPerFloor =
      expectedFlights > 0 && this.template.totalAscentM > 0
        ? this.template.totalAscentM / expectedFlights
        : Math.max(0, current.ascentM)
    const threshold =
      (this.segmentIndex + FLOOR_HEIGHT_CONFIRM_RATIO) *
      learnedHeightPerFloor
    return threshold > 0 && this.estimatedHeightM >= threshold
  }

  private hasCompletedFloorRoute(): boolean {
    return this.turnGate.completedTurns >= TURNS_REQUIRED_PER_FLOOR
  }

  /**
   * 1 层到 15 层实际只有 14 次跨层。旧版路线曾可能多存一段，
   * 训练时必须以起终层为上限，不能因为多余模板段而冲到 16 层。
   */
  private get segmentCount(): number {
    const expected = getFloorTransitionCount(
      this.template.startFloor,
      this.template.endFloor,
    )
    return expected > 0
      ? Math.min(expected, this.template.segments.length)
      : this.template.segments.length
  }

  private advanceSegment(elapsedMs: number, confidence: number): void {
    const segment = this.template.segments[this.segmentIndex]
    if (!segment) return
    this.events.push({
      t: elapsedMs,
      type: 'floor',
      floor: segment.floorTo,
      confidence,
    })
    this.floorSplits.push({
      floor: segment.floorTo,
      atMs: elapsedMs,
      elapsedMs,
    })
    this.segmentIndex += 1
    this.observed = []
    this.observedSteps = 0
    this.turnGate.reset()
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
    const complete = this.segmentIndex >= this.segmentCount
    const canonicalAscent =
      this.segmentCount > 0 && this.template.totalAscentM > 0
        ? (this.template.totalAscentM * completed.length) / this.segmentCount
        : completed.reduce((sum, segment) => sum + segment.ascentM, 0)
    return {
      currentFloor,
      floorsCompleted: completed.length,
      ascentM: Number(canonicalAscent.toFixed(1)),
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
    // 净用时：扣除中断期间（锁屏、切出应用、传感器断流）
    const interruptedMs = this.interruptions.reduce(
      (sum, gap) => sum + Math.max(0, gap.endMs - gap.startMs),
      0,
    )
    const durationMs = Math.max(0, endedAt - this.startedAt - interruptedMs)
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
