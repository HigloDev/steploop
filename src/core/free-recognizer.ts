// 首次开张识别器：无模板对照，仅基于气压计估算楼层。
// 接口与 RouteRecognizer 兼容（pushFrame/pause/resume/snapshot/finish），
// 额外提供 pushBarometer 接收气压样本。
//
// 楼层判定逻辑：以起点气压为基线，气压每下降 BARO_EPS
// 视为上一层（阈值见 sensor-params.ts）。
// 无气压计或基线未建立时，退化为步数估算（每 STEPS_PER_FLOOR_FREE 步上一层）。
//
// 用途：用户新找的大楼首次开张，跳过 Calibrate/Review/Validate 流程，
// 第一轮用本识别器边爬边采集样本，结束后调 analyzeCalibration 生成模板，
// 后续轮次切换到 RouteRecognizer 走正常 DTW 流程。

import { clamp, uid } from './math'
import {
  ClimbMode,
  ClimbSession,
  FeatureFrame,
  RecognitionSnapshot,
  RecognitionDecision,
  RecognitionEvidence,
  RouteTemplate,
} from './types'
import { hasKnownRouteEnd } from './route-state'
import { StairTurnGate } from './turn-gate'
import { ElevatorGate } from './elevator-gate'
import {
  BARO_BASELINE_SAMPLE_COUNT,
  BARO_EPS,
  BARO_FLOOR_COOLDOWN_MS,
  BARO_SMOOTH_WINDOW,
  DEFAULT_FLOOR_HEIGHT_M,
  METERS_PER_HPA,
  STEPS_PER_FLOOR_FREE,
} from './sensor-params'

const TURNS_REQUIRED_PER_FLOOR = 2
const MINIMUM_STEPS_WITH_BAROMETER = 20

export class FreeRecognizer {
  private template: RouteTemplate
  private startedAt: number
  private paused = false

  // 气压相关
  private baselinePressure: number | undefined
  private baselineSamples: number[] = []
  private pressureWindow: number[] = []
  private currentFloor: number
  private lastFloorAt = 0
  private floorSplits: ClimbSession['floorSplits'] = []
  private events: ClimbSession['events'] = []
  private interruptions: ClimbSession['interruptions'] = []
  private totalSteps = 0
  private hasBarometer = false
  private estimatedHeightM = 0
  private readonly turnGate = new StairTurnGate()
  private readonly elevatorGate = new ElevatorGate()
  private elevatorSuspect = false
  private activeMs = 0
  private lastDecision?: RecognitionDecision

  constructor(template: RouteTemplate, startedAt = Date.now()) {
    this.template = template
    this.startedAt = startedAt
    this.currentFloor = template.startFloor
  }

  /**
   * 接收气压样本（hPa）。由上层 onBarometer 回调驱动。
   * 内部维护基线、平滑、楼层判定。
   */
  pushBarometer(pressure: number, atMs?: number): RecognitionSnapshot {
    if (!pressure || pressure <= 0) return this.snapshot()
    this.hasBarometer = true

    // 建立基线
    if (this.baselinePressure === undefined) {
      this.baselineSamples.push(pressure)
      if (this.baselineSamples.length >= BARO_BASELINE_SAMPLE_COUNT) {
        // 开始按钮按下后若用户已迈步，取这一秒里的最高气压作为最低点基线，
        // 避免基线被刚开始的上升动作抬高。
        this.baselinePressure = Math.max(...this.baselineSamples)
      }
      return this.snapshot()
    }

    // 平滑气压
    this.pressureWindow.push(pressure)
    if (this.pressureWindow.length > BARO_SMOOTH_WINDOW) {
      this.pressureWindow.shift()
    }
    const smoothed =
      this.pressureWindow.reduce((s, p) => s + p, 0) /
      this.pressureWindow.length
    this.estimatedHeightM = Math.max(
      this.estimatedHeightM,
      (this.baselinePressure - smoothed) * METERS_PER_HPA,
      0,
    )

    // 楼层判定：当前应到达的气压阈值
    const floorsClimbed = this.currentFloor - this.template.startFloor
    const expectedPressure =
      this.baselinePressure - (floorsClimbed + 1) * BARO_EPS

    const elapsedMs = Math.max(0, atMs ?? Date.now() - this.startedAt)
    const now = this.startedAt + elapsedMs
    const floorHeight =
      this.template.floorHeightM > 0
        ? this.template.floorHeightM
        : DEFAULT_FLOOR_HEIGHT_M
    this.elevatorSuspect = this.elevatorGate.isSuspect(
      floorHeight,
      this.estimatedHeightM,
    )
    if (
      smoothed <= expectedPressure &&
      now - this.lastFloorAt > BARO_FLOOR_COOLDOWN_MS &&
      this.totalSteps >= MINIMUM_STEPS_WITH_BAROMETER &&
      this.hasCompletedFloorRoute() &&
      (!hasKnownRouteEnd(this.template) ||
        this.currentFloor < this.template.endFloor)
    ) {
      if (this.elevatorSuspect) {
        this.lastDecision = {
          type: 'rejected',
          floor: this.currentFloor + 1,
          confidence: 0.15,
          evidence: this.floorEvidence(elapsedMs, true),
          quality: 'degraded',
          negative_gate: 'elevator',
        }
        this.events.push({
          t: elapsedMs,
          type: 'floor',
          floor: this.currentFloor + 1,
          confidence: 0.15,
          source: 'barometer',
          evidence: this.floorEvidence(elapsedMs, true),
          reasonCode: 'elevator_suspect_rejected',
        })
        return this.snapshot()
      }
      this.currentFloor += 1
      this.lastFloorAt = now
      const evidence = this.floorEvidence(elapsedMs, true)
      this.lastDecision = {
        type:
          hasKnownRouteEnd(this.template) &&
          this.currentFloor >= this.template.endFloor
            ? 'route_complete'
            : 'confirmed_floor',
        floor: this.currentFloor,
        confidence: 0.78,
        evidence,
        quality: 'stable',
      }
      this.events.push({
        t: elapsedMs,
        type: 'floor',
        floor: this.currentFloor,
        confidence: 0.78,
        source: 'barometer',
        evidence,
        reasonCode: 'height_step_turn_confirmed',
      })
      this.floorSplits.push({
        floor: this.currentFloor,
        atMs: elapsedMs,
        elapsedMs,
      })
      this.turnGate.consume(TURNS_REQUIRED_PER_FLOOR)
    }
    return this.snapshot()
  }

  pushFrame(frame: FeatureFrame): RecognitionSnapshot {
    if (this.paused) return this.snapshot()
    // 净爬楼时间：只累计真实动作帧（与 RouteRecognizer 口径一致）
    if (frame.steps > 0 || frame.energy >= 0.06) {
      this.activeMs += frame.endMs - frame.startMs
    }
    this.totalSteps += frame.steps
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

    const floorHeight =
      this.template.floorHeightM > 0
        ? this.template.floorHeightM
        : DEFAULT_FLOOR_HEIGHT_M
    this.elevatorSuspect = this.elevatorGate.isSuspect(
      floorHeight,
      this.estimatedHeightM,
    )

    // 无气压计时，用步数估算楼层
    if (!this.hasBarometer) {
      const floorsClimbed = this.currentFloor - this.template.startFloor
      const expectedSteps = (floorsClimbed + 1) * STEPS_PER_FLOOR_FREE
      if (
        this.totalSteps >= expectedSteps &&
        this.hasCompletedFloorRoute() &&
        (!hasKnownRouteEnd(this.template) ||
          this.currentFloor < this.template.endFloor)
      ) {
        if (this.elevatorSuspect) {
          this.lastDecision = {
            type: 'rejected',
            floor: this.currentFloor + 1,
            confidence: 0.15,
            evidence: this.floorEvidence(frame.endMs, false),
            quality: 'degraded',
            negative_gate: 'elevator',
          }
          this.events.push({
            t: frame.endMs,
            type: 'floor',
            floor: this.currentFloor + 1,
            confidence: 0.15,
            source: 'motion',
            evidence: this.floorEvidence(frame.endMs, false),
            reasonCode: 'elevator_suspect_rejected',
          })
          return this.snapshot()
        }
        this.currentFloor += 1
        const elapsedMs = frame.endMs
        const dynamicConf = this.motionOnlyConfidence()
        const evidence = this.floorEvidence(elapsedMs, false)
        this.lastDecision = {
          type:
            hasKnownRouteEnd(this.template) &&
            this.currentFloor >= this.template.endFloor
              ? 'route_complete'
              : 'confirmed_floor',
          floor: this.currentFloor,
          confidence: dynamicConf,
          evidence,
          quality: dynamicConf >= 0.72 ? 'stable' : 'degraded',
        }
        this.events.push({
          t: elapsedMs,
          type: 'floor',
          floor: this.currentFloor,
          confidence: dynamicConf,
          source: 'motion',
          evidence,
          reasonCode: 'step_turn_fallback_confirmed',
        })
        this.floorSplits.push({
          floor: this.currentFloor,
          atMs: elapsedMs,
          elapsedMs,
        })
        this.turnGate.consume(TURNS_REQUIRED_PER_FLOOR)
      }
    }

    return this.snapshot()
  }

  private motionOnlyConfidence(): number {
    const floorsClimbed = Math.max(
      1,
      this.currentFloor - this.template.startFloor,
    )
    const stepsPerFloor = this.totalSteps / floorsClimbed
    const deviation =
      Math.abs(stepsPerFloor - STEPS_PER_FLOOR_FREE) / STEPS_PER_FLOOR_FREE
    const stability = clamp(1 - Math.min(1, deviation), 0, 1)
    return 0.55 + 0.25 * stability
  }

  private hasCompletedFloorRoute(): boolean {
    return this.turnGate.completedTurns >= TURNS_REQUIRED_PER_FLOOR
  }

  private floorEvidence(
    atMs: number,
    withBarometer: boolean,
  ): RecognitionEvidence[] {
    const floorsClimbed = Math.max(
      1,
      this.currentFloor - this.template.startFloor,
    )
    const evidence: RecognitionEvidence[] = [
      {
        source: 'motion',
        score: Math.min(
          1,
          this.totalSteps / (floorsClimbed * STEPS_PER_FLOOR_FREE),
        ),
        observedAt: atMs,
        reasonCode: 'step_evidence_satisfied',
      },
      {
        source: 'turn',
        score: Math.min(
          1,
          this.turnGate.completedTurns / TURNS_REQUIRED_PER_FLOOR,
        ),
        observedAt: atMs,
        reasonCode: 'turn_route_satisfied',
      },
    ]
    if (withBarometer) {
      evidence.push({
        source: 'barometer',
        score: 1,
        observedAt: atMs,
        reasonCode: 'floor_height_reached',
      })
    }
    return evidence
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
    const floorsCompleted = this.currentFloor - this.template.startFloor
    const knownEnd = hasKnownRouteEnd(this.template)
    const complete = knownEnd && this.currentFloor >= this.template.endFloor
    const ascentM = this.hasBarometer
      ? this.estimatedHeightM
      : floorsCompleted *
        (this.template.floorHeightM > 0
          ? this.template.floorHeightM
          : DEFAULT_FLOOR_HEIGHT_M)
    const quality = this.elevatorSuspect
      ? 'degraded'
      : this.interruptions.length || !this.hasBarometer
        ? 'degraded'
        : 'stable'
    const nextFloor =
      !complete &&
      (this.totalSteps % STEPS_PER_FLOOR_FREE) /
        STEPS_PER_FLOOR_FREE >=
        0.65
        ? this.currentFloor + 1
        : undefined
    const motionConf = this.motionOnlyConfidence()
    return {
      currentFloor: this.currentFloor,
      floorsCompleted,
      ascentM,
      steps: this.totalSteps,
      // free 模式无模板对照：气压路径 0.7，无气压按步数稳定性 0.55–0.8
      confidence: complete
        ? this.lastDecision?.confidence ??
          (this.hasBarometer ? 0.7 : motionConf)
        : this.hasBarometer
          ? 0.7
          : motionConf,
      status: complete ? 'complete' : this.paused ? 'paused' : 'matching',
      lastTurn: this.events
        .filter((e) => e.type === 'turn')
        .at(-1)?.direction,
      activeMs: this.activeMs,
      quality,
      statusReason: complete
        ? 'route_complete'
        : this.paused
          ? 'sensor_interrupted'
          : this.elevatorSuspect
            ? 'elevator_suspect'
            : nextFloor !== undefined
              ? 'confirming_next_floor'
              : this.hasBarometer
                ? 'matching_height_and_motion'
                : 'motion_fallback',
      candidateFloor: nextFloor,
      canAutoComplete:
        complete &&
        this.template.status === 'verified' &&
        (this.lastDecision?.confidence ?? 0) >= 0.9 &&
        quality === 'stable',
      activeSensorSources: [
        'motion',
        'turn',
        ...(this.hasBarometer ? (['barometer'] as const) : []),
      ],
    }
  }

  finish(endedAt = Date.now(), mode: ClimbMode = 'free'): ClimbSession {
    const snapshot = this.snapshot()
    const knownEnd = hasKnownRouteEnd(this.template)
    // 净爬楼时间：只统计真实动作帧（原地等待不计入）
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
      complete: snapshot.status === 'complete' && this.interruptions.length === 0,
      events: this.events,
      floorSplits: this.floorSplits,
      interruptions: this.interruptions,
      mode,
      routeSnapshot: {
        name: this.template.name,
        locationName: this.template.location?.name ?? this.template.name,
        startFloor: this.template.startFloor,
        endFloor: knownEnd
          ? this.template.endFloor
          : this.template.startFloor,
        totalAscentM: knownEnd ? this.template.totalAscentM : 0,
      },
      durationMs,
      averageFloorMs: snapshot.floorsCompleted
        ? Math.round(durationMs / snapshot.floorsCompleted)
        : 0,
      bestFloorSplitMs: splitDurations.length ? Math.min(...splitDurations) : 0,
    }
  }
}
