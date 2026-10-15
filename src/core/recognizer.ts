import { extractFrames, vectorizeFrame } from './analysis'
import { fuseConfidence } from './confidence'
import { dtwConfidence } from './dtw'
import { getFloorTransitionCount } from './floors'
import { clamp, uid } from './math'
import { PressureTrend } from './pressure-trend'
import { hasCheckedMotionReference, segmentTurnCount } from './route-motion'
import { DEFAULT_FEATURE_SPACE, type FeatureSpace } from './sensor-params'
import { StairTurnGate } from './turn-gate'
import { ClimbSession, ClimbMode, FeatureFrame, RecognitionEvent, RecognitionSnapshot, RouteTemplate, SensorSample } from './types'

const MATCH_THRESHOLD = 0.72

/** Motion follows the recorded staircase. Pressure supplies direction, never required metres. */
export class RouteRecognizer {
  private segmentIndex = 0
  private observed: number[][] = []
  private observedSteps = 0
  private upWalkingSteps = 0
  private incompatibleWalkingMs = 0
  private totalSteps = 0
  private events: RecognitionEvent[] = []
  private floorSplits: ClimbSession['floorSplits'] = []
  private interruptions: ClimbSession['interruptions'] = []
  private paused = false
  private currentConfidence = 0
  private floorConfidence = 0
  private activeMs = 0
  private lastAt = 0
  private lastFloorAt = 0
  private lastMatchReliable = false
  private hadUncertainFloor = false
  private recentUpAt = -Infinity
  private lastFrameSteps = 0
  private segmentStartHeightM = 0
  private readonly pressure = new PressureTrend()
  private readonly turnGate = new StairTurnGate()
  private readonly featureSpace: FeatureSpace

  constructor(private template: RouteTemplate, private startedAt = Date.now()) {
    this.featureSpace = template.featureSpace ?? DEFAULT_FEATURE_SPACE
  }

  private get segmentCount(): number {
    const count = getFloorTransitionCount(this.template.startFloor, this.template.endFloor)
    return count > 0 ? Math.min(count, this.template.segments.length) : this.template.segments.length
  }

  pushFrame(frame: FeatureFrame): RecognitionSnapshot {
    if (this.paused) return this.snapshot()
    this.lastAt = Math.max(this.lastAt, frame.endMs)
    this.totalSteps += Math.max(0, frame.steps)
    const trend = this.pressure.snapshot(this.lastAt)
    this.lastFrameSteps = frame.steps
    if (trend.reliable && trend.direction === 'up' && frame.steps > 0) this.recentUpAt = frame.endMs
    const descending = trend.reliable && trend.direction === 'down'
    const levelWalking = trend.reliable && trend.direction === 'level' && frame.endMs - this.recentUpAt > 6000
    // Standing, arm movements and elevator vibration alone do not earn climbing time.
    if (frame.steps > 0 && !descending && !levelWalking) {
      this.activeMs += Math.max(0, frame.endMs - frame.startMs)
    }
    if (this.segmentIndex >= this.segmentCount) return this.snapshot()
    const segment = this.template.segments[this.segmentIndex]
    if (!segment) return this.snapshot()
    // Do not bank corridor/downstairs steps and spend them after a later upward
    // reading. A brief uncertain patch keeps the unfinished floor; sustained
    // incompatible walking clears it and requires human confirmation.
    if (descending || levelWalking) {
      if (frame.steps > 0) this.incompatibleWalkingMs += Math.max(0, frame.endMs - frame.startMs)
      // 持续的平地/下行走动只标记“不确定”，不再清空本层已累计的进度：
      // 旧实现会因为慢爬被误判 level 而把整层进度清零。
      if (this.incompatibleWalkingMs >= 6000) this.hadUncertainFloor = true
      return this.snapshot()
    }
    this.incompatibleWalkingMs = 0
    this.observed.push(vectorizeFrame(frame, this.featureSpace))
    const cap = Math.max(24, segment.features.length * 2)
    if (this.observed.length > cap) this.observed.splice(0, this.observed.length - cap)
    this.observedSteps += Math.max(0, frame.steps)
    if (trend.reliable && trend.direction === 'up') this.upWalkingSteps += Math.max(0, frame.steps)
    const turn = this.turnGate.push(frame)
    if (turn) this.events.push({ t: turn.atMs, type: 'turn', direction: turn.direction, confidence: turn.confidence })
    this.currentConfidence = segment.features.length ? dtwConfidence(this.observed, segment.features) : 0
    const expectedTurns = segmentTurnCount(segment)
    const stepsNeeded = Math.max(8, segment.stepCount)
    const turnsReady = this.turnGate.completedTurns >= expectedTurns
    const strongMatch = this.observedSteps >= stepsNeeded * 0.85 &&
      this.currentConfidence >= MATCH_THRESHOLD && turnsReady
    // An imperfect waveform match is not a veto on a provisional estimate.
    // Require this segment's entire recorded step budget, its recorded turns,
    // and upward context for at least half the steps. Never auto-confirm this
    // path, including for straight stairs or legacy references with no turns.
    // There is no minimum duration tied to the user's old climbing speed.
    const motionRescue = this.observedSteps >= stepsNeeded &&
      this.upWalkingSteps >= Math.max(3, Math.ceil(stepsNeeded / 2)) &&
      turnsReady && trend.reliable && trend.direction === 'up'
    if (strongMatch || motionRescue) {
      this.lastMatchReliable = strongMatch && trend.reliable && trend.direction === 'up' && trend.reason === 'continuous'
      if (!this.lastMatchReliable) this.hadUncertainFloor = true
      // 真实证据融合：拐弯按“实际/模板”是否一致打分；气压按本层实际上升高度与模板层高的吻合度打分。
      // 旧实现给 turn=1、baro=1 两个恒定证据，置信度被系统性抬高。
      const gainedM = trend.relativeHeightM - this.segmentStartHeightM
      // 气压只作为佐证：上升不足模板一半时视为“无气压证据”，不否决动作匹配（motion-v3 的既定口径）。
      const baroScore = trend.reliable && segment.ascentM > 0 && gainedM >= segment.ascentM * 0.5
        ? clamp(Math.exp(-Math.abs(Math.log(gainedM / segment.ascentM))), 0, 1) : undefined
      const turnScore = expectedTurns ? (this.turnGate.completedTurns === expectedTurns ? 1 : 0.75) : undefined
      this.floorConfidence = strongMatch
        ? fuseConfidence({ motion: clamp(this.observedSteps / stepsNeeded, 0, 1),
            turn: turnScore, dtw: this.currentConfidence, baro: baroScore })
        : Math.min(0.75, this.currentConfidence || 0.65)
      this.events.push({ t: frame.endMs, type: 'floor', floor: segment.floorTo,
        confidence: this.floorConfidence, source: 'motion', heightM: Number(trend.relativeHeightM.toFixed(2)),
        stepEvidence: this.observedSteps, turnEvidence: this.turnGate.completedTurns,
        evidence: [
          { source: 'motion', score: clamp(this.observedSteps / stepsNeeded, 0, 1), observedAt: frame.endMs, reasonCode: 'segment_steps_observed' },
          { source: 'route_template', score: this.currentConfidence, observedAt: frame.endMs, reasonCode: 'segment_motion_match' },
          { source: 'turn', score: turnsReady ? 1 : 0, observedAt: frame.endMs, reasonCode: 'route_specific_turns' },
          ...(trend.reliable ? [{ source: 'barometer' as const, score: trend.direction === 'up' ? 1 : 0,
            observedAt: frame.endMs, reasonCode: 'pressure_trend_context' }] : []),
        ], reasonCode: strongMatch ? 'motion_route_estimate' : 'motion_trend_rescue_estimate' })
      // atMs 是相对采集开始的墙钟时间；elapsedMs 统一为活动时间（只计有步伐的帧）。
      this.floorSplits.push({ floor: segment.floorTo, atMs: frame.endMs,
        elapsedMs: this.activeMs })
      this.lastFloorAt = frame.endMs
      this.segmentIndex += 1
      this.observed = []
      this.observedSteps = 0
      this.upWalkingSteps = 0
      // 只消费本层所需的整拐，多余的拐弯留给漏识别后的追赶。
      this.turnGate.consume(expectedTurns)
      this.segmentStartHeightM = trend.relativeHeightM
    }
    return this.snapshot()
  }

  pushBarometer(pressure: number, atMs = Date.now() - this.startedAt): RecognitionSnapshot {
    if (this.paused) return this.snapshot()
    this.lastAt = Math.max(this.lastAt, atMs)
    this.pressure.push(pressure, atMs)
    return this.snapshot()
  }

  confirmFloor(floor: number, atMs: number): RecognitionSnapshot {
    if (!Number.isSafeInteger(floor) || floor < this.template.startFloor || floor > this.template.endFloor) return this.snapshot()
    this.segmentIndex = Math.min(this.segmentCount, floor - this.template.startFloor)
    this.observed = []
    this.observedSteps = 0
    this.upWalkingSteps = 0
    this.incompatibleWalkingMs = 0
    this.turnGate.reset()
    this.lastMatchReliable = false
    this.hadUncertainFloor = true
    this.lastFloorAt = atMs
    this.lastAt = Math.max(this.lastAt, atMs)
    return this.snapshot()
  }

  pushSamples(samples: SensorSample[]): RecognitionSnapshot {
    const origin = samples[0]?.t ?? this.startedAt
    let index = 0
    let lastPressureAt = -Infinity
    let lastPressure: number | undefined
    for (const frame of extractFrames(samples)) {
      while (index < samples.length && samples[index].t - origin <= frame.endMs) {
        const sample = samples[index++]
        if (sample.pressure === undefined) continue
        // 只推送真实的新气压事件：有 pressureT 时按事件自身时间戳，旧数据按数值变化。
        if (sample.pressureT !== undefined) {
          if (sample.pressureT <= lastPressureAt) continue
          lastPressureAt = sample.pressureT
          this.pushBarometer(sample.pressure, sample.pressureT - origin)
        } else if (sample.pressure !== lastPressure) {
          lastPressure = sample.pressure
          this.pushBarometer(sample.pressure, sample.t - origin)
        }
      }
      this.pushFrame(frame)
    }
    return this.snapshot()
  }

  pause(atMs: number): void {
    if (this.paused) return
    this.paused = true
    this.interruptions.push({ startMs: atMs, endMs: atMs })
    this.events.push({ t: atMs, type: 'gap', confidence: 1 })
    this.pressure.gap()
    this.recentUpAt = -Infinity
    this.observed = []
    this.observedSteps = 0
    this.upWalkingSteps = 0
    this.incompatibleWalkingMs = 0
    this.turnGate.interrupt()
  }

  resume(atMs: number): void {
    if (!this.paused) return
    this.paused = false
    const gap = this.interruptions.at(-1)
    if (gap) gap.endMs = atMs
    this.lastAt = atMs
    this.events.push({ t: atMs, type: 'resume', confidence: 1 })
  }

  snapshot(): RecognitionSnapshot {
    const completed = this.template.segments.slice(0, this.segmentIndex)
    const complete = this.segmentCount > 0 && this.segmentIndex >= this.segmentCount
    const trend = this.pressure.snapshot(this.lastAt)
    const checked = hasCheckedMotionReference(this.template)
    const reliable = checked && this.lastMatchReliable && !this.hadUncertainFloor && this.interruptions.length === 0 && this.floorConfidence >= 0.86
    const descending = trend.reliable && trend.direction === 'down'
    const next = this.template.segments[this.segmentIndex]
    const candidateFloor = next && this.observedSteps >= Math.max(8, next.stepCount) * 0.5 ? next.floorTo : undefined
    return {
      currentFloor: completed.at(-1)?.floorTo ?? this.template.startFloor,
      floorsCompleted: completed.length,
      ascentM: Number(Math.max(0, trend.relativeHeightM).toFixed(1)), steps: this.totalSteps,
      confidence: complete ? this.floorConfidence : this.currentConfidence,
      status: this.paused ? 'paused' : complete ? 'complete' : this.currentConfidence < MATCH_THRESHOLD ? 'low_confidence' : 'matching',
      lastTurn: this.events.filter(event => event.type === 'turn').at(-1)?.direction,
      activeMs: this.activeMs, quality: reliable ? 'stable' : 'degraded',
      statusReason: this.paused ? 'sensor_interrupted' : descending ? 'descending_observed'
        : !trend.reliable && trend.reason === 'pressure_jump' ? 'pressure_unreliable'
        : complete ? (reliable ? 'route_complete' : 'endpoint_needs_confirmation')
        : candidateFloor !== undefined ? 'confirming_next_floor' : 'matching_motion_route',
      candidateFloor, canAutoComplete: complete && reliable,
      activeSensorSources: ['motion', 'route_template', ...(trend.reliable ? ['barometer' as const] : [])],
      floorStatus: reliable ? 'estimated' : 'needs_confirmation',
      pressureDirection: trend.direction, pressureReliable: trend.reliable,
      motionActivity: descending ? (this.lastFrameSteps > 0 ? 'stairs_down' : 'elevator')
        : this.lastFrameSteps > 0 ? (trend.direction === 'up' ? 'stairs_up' : trend.reliable && trend.direction === 'level' ? 'walking' : 'uncertain') : 'waiting',
    }
  }

  finish(endedAt = Date.now(), mode: ClimbMode = 'formal'): ClimbSession {
    const snapshot = this.snapshot()
    const durations = this.floorSplits.map((split, index) => split.elapsedMs - (this.floorSplits[index - 1]?.elapsedMs ?? 0))
    return { id: uid('session'), templateId: this.template.id, templateVersion: this.template.version,
      startedAt: this.startedAt, endedAt, startFloor: this.template.startFloor,
      finalFloor: snapshot.currentFloor, floorsCompleted: snapshot.floorsCompleted, ascentM: snapshot.ascentM,
      steps: snapshot.steps, confidence: snapshot.confidence, complete: snapshot.canAutoComplete,
      events: this.events, floorSplits: this.floorSplits, interruptions: this.interruptions, mode,
      floorConfirmation: snapshot.canAutoComplete ? 'automatic' : 'pending', recognitionVersion: 'motion-v3',
      routeSnapshot: { name: this.template.name, locationName: this.template.location?.name ?? this.template.name,
        startFloor: this.template.startFloor, endFloor: this.template.endFloor, totalAscentM: this.template.totalAscentM },
      durationMs: this.activeMs, averageFloorMs: snapshot.floorsCompleted ? Math.round(this.activeMs / snapshot.floorsCompleted) : 0,
      bestFloorSplitMs: durations.length ? Math.min(...durations) : 0,
      recognitionEndState: { segmentIndex: this.segmentIndex, expectedSegments: this.segmentCount,
        currentFloor: snapshot.currentFloor, estimatedHeightM: snapshot.ascentM, requiredHeightM: 0,
        pendingSteps: this.observedSteps, pendingTurns: this.turnGate.completedTurns,
        barometerAvailable: snapshot.pressureReliable === true },
    }
  }
}

export function replayTemplate(template: RouteTemplate, samples: SensorSample[], startedAt = Date.now()): ClimbSession {
  const recognizer = new RouteRecognizer(template, startedAt)
  recognizer.pushSamples(samples)
  return recognizer.finish(startedAt + Math.max(0, (samples.at(-1)?.t ?? 0) - (samples[0]?.t ?? 0)))
}
