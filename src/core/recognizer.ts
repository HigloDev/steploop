import { extractFrames, vectorizeFrame } from './analysis'
import { fuseConfidence, fusedQuality } from './confidence'
import { dtwConfidence } from './dtw'
import { ElevatorGate } from './elevator-gate'
import { getFloorTransitionCount } from './floors'
import { clamp, uid } from './math'
import { StairTurnGate } from './turn-gate'
import {
  DEFAULT_FEATURE_SPACE,
  DEFAULT_FLOOR_HEIGHT_M,
  METERS_PER_HPA,
  type FeatureSpace,
} from './sensor-params'
import {
  ClimbSession,
  ClimbMode,
  FeatureFrame,
  RecognitionEvent,
  RecognitionDecision,
  RecognitionEvidence,
  RecognitionSnapshot,
  RouteTemplate,
  SensorSample,
} from './types'

const MATCH_THRESHOLD = 0.72
const MIN_PROGRESS = 0.65
const BAROMETER_BASELINE_SAMPLES = 5
const BAROMETER_SMOOTH_SAMPLES = 10
// 气压只作“已经爬够一层高度”的辅助确认；真正推进必须完成两个整拐。
const FLOOR_HEIGHT_CONFIRM_RATIO = 0.88
const TURNS_REQUIRED_PER_FLOOR = 2
const BAROMETER_STEP_CONFIRM_RATIO = 0.65
// 净爬楼时间判定：帧内有步数或动作能量达标才计入（与 analysis.ts 的活动帧口径一致）。
// 原地等待/休息/电梯等静止时间不进入卡路里与净用时统计。
const ACTIVE_FRAME_ENERGY = 0.06

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
  private readonly elevatorGate = new ElevatorGate()
  private elevatorSuspect = false
  private currentConfidence = 0
  private baselinePressure?: number
  private baselineSamples: number[] = []
  private pressureWindow: number[] = []
  private hasBarometer = false
  private estimatedHeightM = 0
  private activeMs = 0
  private lastDecision?: RecognitionDecision
  // 旧模板 featureSpace 缺省时按 heading 匹配：新向量化已统一 heading，
  // turn-gate/markers 也早已走重力轴；存量 device 模板重标定后自动对齐。
  private readonly featureSpace: FeatureSpace

  constructor(template: RouteTemplate, startedAt = Date.now()) {
    this.template = template
    this.startedAt = startedAt
    this.featureSpace = template.featureSpace ?? DEFAULT_FEATURE_SPACE
  }

  pushFrame(frame: FeatureFrame): RecognitionSnapshot {
    if (this.paused || this.segmentIndex >= this.segmentCount) {
      return this.snapshot()
    }
    // 净爬楼时间：只累计真实动作帧（LiveFeaturePump 输出的帧是连续的 500ms 窗口）
    if (frame.steps > 0 || frame.energy >= ACTIVE_FRAME_ENERGY) {
      this.activeMs += frame.endMs - frame.startMs
    }
    const segment = this.template.segments[this.segmentIndex]
    this.observed.push(vectorizeFrame(frame, this.featureSpace))
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
    this.elevatorGate.pushFrame(frame, this.estimatedHeightM)

    const completedTurn = this.turnGate.push(frame)
    if (completedTurn) {
      this.elevatorGate.pushTurn(completedTurn.atMs)
      this.events.push({
        t: completedTurn.atMs,
        type: 'turn',
        direction: completedTurn.direction,
        confidence: completedTurn.confidence,
      })
    }

    const templateLength = Math.max(1, segment.features.length)
    const progress = this.observed.length / templateLength
    const stepProgress =
      this.observedSteps / Math.max(1, this.effectiveSegmentSteps(segment))
    this.currentConfidence = dtwConfidence(this.observed, segment.features)
    const floorHeight =
      this.template.floorHeightM > 0
        ? this.template.floorHeightM
        : DEFAULT_FLOOR_HEIGHT_M
    this.elevatorSuspect = this.elevatorGate.isSuspect(
      floorHeight,
      this.estimatedHeightM,
    )

    if (
      progress >= MIN_PROGRESS &&
      stepProgress >= 0.58 &&
      this.currentConfidence >= MATCH_THRESHOLD &&
      this.hasCompletedFloorRoute() &&
      (!this.hasBarometer || this.hasReachedCurrentFloorHeight())
    ) {
      if (this.elevatorSuspect) {
        this.markElevatorRejected(frame.endMs, segment)
      } else {
        const fused = this.computeFusedConfidence(segment)
        this.advanceSegment(frame.endMs, fused, 'motion')
      }
    }
    return this.snapshot()
  }

  /**
   * 正式训练也接收气压。动作模板负责识别节奏，气压负责守住整层边界并
   * 在模板局部对不上时脱困，避免第二轮永远卡在第一段。
   */
  pushBarometer(pressure: number, atMs?: number): RecognitionSnapshot {
    if (!Number.isFinite(pressure) || pressure <= 0 || this.paused) {
      return this.snapshot()
    }
    this.hasBarometer = true
    if (this.baselinePressure === undefined) {
      this.baselineSamples.push(pressure)
      if (this.baselineSamples.length >= BAROMETER_BASELINE_SAMPLES) {
        // 若按下开始后已经迈步，最高气压最接近真正的起点高度。
        this.baselinePressure = Math.max(...this.baselineSamples)
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
    // 本轮只会向上，采用平滑后的最高相对高度，避免楼道气流造成短暂回落。
    this.estimatedHeightM = Math.max(
      this.estimatedHeightM,
      (this.baselinePressure - smoothed) * METERS_PER_HPA,
      0,
    )

    const elapsedMs = Math.max(
      0,
      atMs ?? Date.now() - this.startedAt,
    )
    // 气压给出绝对高度锚点；若此前漏掉一层，保留下来的步数和转弯证据
    // 可以在同一批气压样本中逐层追回，而不是永远锁在旧楼层。
    const floorHeight =
      this.template.floorHeightM > 0
        ? this.template.floorHeightM
        : DEFAULT_FLOOR_HEIGHT_M
    this.elevatorSuspect = this.elevatorGate.isSuspect(
      floorHeight,
      this.estimatedHeightM,
    )
    while (this.segmentIndex < this.segmentCount) {
      const segment = this.template.segments[this.segmentIndex]
      if (!segment || !this.hasReachedCurrentFloorHeight()) break
      if (
        this.observedSteps <
          this.minimumStepEvidence(this.effectiveSegmentSteps(segment)) ||
        !this.hasCompletedFloorRoute()
      ) {
        break
      }
      if (this.elevatorSuspect) {
        this.markElevatorRejected(elapsedMs, segment)
        break
      }
      const fused = this.computeFusedConfidence(segment)
      this.advanceSegment(elapsedMs, fused, 'barometer')
    }
    return this.snapshot()
  }

  private minimumStepEvidence(segmentSteps: number): number {
    return Math.max(
      8,
      Math.round(Math.max(1, segmentSteps) * BAROMETER_STEP_CONFIRM_RATIO),
    )
  }

  /** 已学习到可用/已验证状态时，返回个性化每层步数；否则 undefined。 */
  private learnedStepsPerFloor(): number | undefined {
    const learning = this.template.learning
    if (!learning) return undefined
    if (learning.sampleCount < 3) return undefined
    if (learning.state !== 'usable' && learning.state !== 'verified') {
      return undefined
    }
    const mean = learning.stepsPerFloor.mean
    return mean > 0 ? mean : undefined
  }

  /** 当前段的有效步数：优先使用学习到的个性化步数，否则回退到模板段。 */
  private effectiveSegmentSteps(
    segment: RouteTemplate['segments'][number],
  ): number {
    return this.learnedStepsPerFloor() ?? segment.stepCount
  }

  private computeFusedConfidence(
    segment: RouteTemplate['segments'][number],
  ): number {
    const motion = clamp(
      this.observedSteps /
        Math.max(
          1,
          this.minimumStepEvidence(this.effectiveSegmentSteps(segment)),
        ),
      0,
      1,
    )
    const turn = clamp(
      this.turnGate.completedTurns / TURNS_REQUIRED_PER_FLOOR,
      0,
      1,
    )
    const dtw = clamp(this.currentConfidence, 0, 1)
    const baro = this.hasBarometer
      ? this.hasReachedCurrentFloorHeight()
        ? 1
        : 0.5
      : undefined
    return fuseConfidence({ motion, turn, dtw, baro })
  }

  private markElevatorRejected(
    elapsedMs: number,
    segment: RouteTemplate['segments'][number],
  ): void {
    this.lastDecision = {
      type: 'rejected',
      floor: segment.floorTo,
      confidence: 0.15,
      evidence: this.buildFloorEvidence(elapsedMs, 'barometer', segment),
      quality: 'degraded',
      negative_gate: 'elevator',
    }
    this.events.push({
      t: elapsedMs,
      type: 'floor',
      floor: segment.floorTo,
      confidence: 0.15,
      source: 'barometer',
      heightM: Number(this.estimatedHeightM.toFixed(2)),
      stepEvidence: this.observedSteps,
      turnEvidence: this.turnGate.completedTurns,
      reasonCode: 'elevator_suspect_rejected',
    })
  }

  private hasReachedCurrentFloorHeight(): boolean {
    const current = this.template.segments[this.segmentIndex]
    if (!current) return false
    const expectedFlights = this.segmentCount
    const learnedHeightPerFloor =
      expectedFlights > 0 && this.template.totalAscentM > 0
        ? this.template.totalAscentM / expectedFlights
        : Math.max(0, current.ascentM)
    const threshold = this.requiredHeightForCurrentFloor(learnedHeightPerFloor)
    return threshold > 0 && this.estimatedHeightM >= threshold
  }

  private requiredHeightForCurrentFloor(heightPerFloor?: number): number {
    const learnedHeightPerFloor =
      heightPerFloor ??
      (this.segmentCount > 0 && this.template.totalAscentM > 0
        ? this.template.totalAscentM / this.segmentCount
        : Math.max(0, this.template.segments[this.segmentIndex]?.ascentM ?? 0))
    return (
      (this.segmentIndex + FLOOR_HEIGHT_CONFIRM_RATIO) *
      learnedHeightPerFloor
    )
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

  private advanceSegment(
    elapsedMs: number,
    confidence: number,
    source: 'motion' | 'barometer',
  ): void {
    const segment = this.template.segments[this.segmentIndex]
    if (!segment) return
    const stepEvidence = this.observedSteps
    const turnEvidence = this.turnGate.completedTurns
    const evidence = this.buildFloorEvidence(elapsedMs, source, segment)
    const quality = fusedQuality(
      confidence,
      this.hasBarometer,
      this.interruptions.length > 0,
    )
    const finalSegment = this.segmentIndex + 1 >= this.segmentCount
    this.lastDecision = {
      type: finalSegment ? 'route_complete' : 'confirmed_floor',
      floor: segment.floorTo,
      confidence,
      evidence,
      quality,
    }
    this.events.push({
      t: elapsedMs,
      type: 'floor',
      floor: segment.floorTo,
      confidence,
      source,
      heightM: Number(this.estimatedHeightM.toFixed(2)),
      stepEvidence,
      turnEvidence,
      evidence,
      reasonCode:
        source === 'barometer'
          ? 'height_motion_turn_confirmed'
          : 'template_motion_turn_confirmed',
    })
    this.floorSplits.push({
      floor: segment.floorTo,
      atMs: elapsedMs,
      elapsedMs,
    })
    this.segmentIndex += 1
    this.observed = []
    // 只消费这一层真正需要的证据；多爬的步数、额外整拐继续留给下一层，
    // 让绝对高度已经领先时能够逐层追赶。
    this.observedSteps = Math.max(
      0,
      stepEvidence -
        this.minimumStepEvidence(this.effectiveSegmentSteps(segment)),
    )
    this.turnGate.consume(TURNS_REQUIRED_PER_FLOOR)
  }

  private buildFloorEvidence(
    atMs: number,
    source: 'motion' | 'barometer',
    segment: RouteTemplate['segments'][number],
  ): RecognitionEvidence[] {
    const evidence: RecognitionEvidence[] = [
      {
        source: 'motion',
        score: clamp(
          this.observedSteps /
            Math.max(
              1,
              this.minimumStepEvidence(this.effectiveSegmentSteps(segment)),
            ),
          0,
          1,
        ),
        observedAt: atMs,
        reasonCode: 'step_evidence_satisfied',
      },
      {
        source: 'turn',
        score: clamp(
          this.turnGate.completedTurns / TURNS_REQUIRED_PER_FLOOR,
          0,
          1,
        ),
        observedAt: atMs,
        reasonCode: 'turn_route_satisfied',
      },
    ]
    if (this.currentConfidence > 0) {
      evidence.push({
        source: 'route_template',
        score: clamp(this.currentConfidence, 0, 1),
        observedAt: atMs,
        reasonCode: 'template_match_observed',
      })
    }
    if (this.hasBarometer) {
      evidence.push({
        source: 'barometer',
        score: this.hasReachedCurrentFloorHeight() || source === 'barometer' ? 1 : 0,
        observedAt: atMs,
        reasonCode: 'floor_height_reached',
      })
    }
    return evidence
  }

  private candidateFloor(): number | undefined {
    const segment = this.template.segments[this.segmentIndex]
    if (!segment) return undefined
    const stepProgress =
      this.observedSteps /
      Math.max(1, this.minimumStepEvidence(this.effectiveSegmentSteps(segment)))
    const turnProgress = this.turnGate.completedTurns / TURNS_REQUIRED_PER_FLOOR
    const heightProgress = this.hasBarometer
      ? this.estimatedHeightM / Math.max(0.1, this.requiredHeightForCurrentFloor())
      : 0
    return Math.max(stepProgress, turnProgress, heightProgress) >= 0.65
      ? segment.floorTo
      : undefined
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
    const measuredAscent = this.hasBarometer
      ? Math.min(
          this.template.totalAscentM > 0
            ? this.template.totalAscentM
            : Number.POSITIVE_INFINITY,
          this.estimatedHeightM,
        )
      : canonicalAscent
    const quality = this.elevatorSuspect
      ? 'degraded'
      : fusedQuality(
          complete
            ? this.lastDecision?.confidence ?? this.currentConfidence
            : this.currentConfidence,
          this.hasBarometer,
          this.interruptions.length > 0,
        )
    const candidateFloor = complete ? undefined : this.candidateFloor()
    const evidenceSources = new Set(
      this.lastDecision?.evidence
        .filter((item) => item.score > 0)
        .map((item) => item.source) ?? [],
    )
    return {
      currentFloor,
      floorsCompleted: completed.length,
      ascentM: Number(measuredAscent.toFixed(1)),
      steps: this.totalSteps,
      confidence: complete
        ? this.lastDecision?.confidence ?? this.currentConfidence
        : this.currentConfidence,
      status: complete
        ? 'complete'
        : this.paused
          ? 'paused'
          : this.currentConfidence > 0 && this.currentConfidence < MATCH_THRESHOLD
            ? 'low_confidence'
            : 'matching',
      lastTurn: this.events.filter((event) => event.type === 'turn').at(-1)?.direction,
      activeMs: this.activeMs,
      quality,
      statusReason: complete
        ? 'route_complete'
        : this.paused
          ? 'sensor_interrupted'
          : this.elevatorSuspect
            ? 'elevator_suspect'
            : candidateFloor !== undefined
              ? 'confirming_next_floor'
              : this.currentConfidence > 0 && this.currentConfidence < MATCH_THRESHOLD
                ? 'template_confidence_low'
                : 'matching_route',
      candidateFloor,
      canAutoComplete:
        complete &&
        this.template.status === 'verified' &&
        (this.lastDecision?.confidence ?? 0) >= 0.9 &&
        evidenceSources.size >= 2 &&
        quality === 'stable' &&
        !this.elevatorSuspect,
      activeSensorSources: [
        'motion',
        'turn',
        'route_template',
        ...(this.hasBarometer ? (['barometer'] as const) : []),
      ],
    }
  }

  finish(endedAt = Date.now(), mode: ClimbMode = 'formal'): ClimbSession {
    const snapshot = this.snapshot()
    // 净爬楼时间：只统计真实动作帧的累计时长。原地等待、休息、
    // 锁屏/切出/传感器断流等静止时间天然不产生动作帧，自动排除。
    const durationMs = Math.max(0, this.activeMs)
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
      recognitionEndState: {
        segmentIndex: this.segmentIndex,
        expectedSegments: this.segmentCount,
        currentFloor: snapshot.currentFloor,
        estimatedHeightM: Number(this.estimatedHeightM.toFixed(2)),
        requiredHeightM: Number(
          this.requiredHeightForCurrentFloor().toFixed(2),
        ),
        pendingSteps: this.observedSteps,
        pendingTurns: this.turnGate.completedTurns,
        barometerAvailable: this.hasBarometer,
      },
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
