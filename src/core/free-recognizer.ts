// 首次开张识别器：无模板对照，仅基于气压计估算楼层。
// 接口与 RouteRecognizer 兼容（pushFrame/pause/resume/snapshot/finish），
// 额外提供 pushBarometer 接收气压样本。
//
// 楼层判定逻辑：以起点气压为基线，气压每下降 BARO_FLOOR_THRESHOLD_HPA
// 视为上一层（与 analysis.ts 的 detectFloorBoundariesByPressure 一致）。
// 无气压计或基线未建立时，退化为步数估算（每 ASCENT_PER_STEP_M 步上一层）。
//
// 用途：用户新找的大楼首次开张，跳过 Calibrate/Review/Validate 流程，
// 第一轮用本识别器边爬边采集样本，结束后调 analyzeCalibration 生成模板，
// 后续轮次切换到 RouteRecognizer 走正常 DTW 流程。

import { uid } from './math'
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

// 气压楼层检测参数（与 analysis.ts 保持一致）
// 约 3 米才算一整层。旧值 0.3hPa 约等于 2.5 米，容易在半层
// 转弯后的气压滞后点提前报层。
const BARO_FLOOR_THRESHOLD_HPA = 3 / 8.3
// 气压平滑窗口（样本数，气压计约 5Hz，约 2 秒）
const BARO_SMOOTH_WINDOW = 10
// 楼层变化冷却：一次上升事件后 2 秒内不再触发，避免一次爬升被切片
const BARO_FLOOR_COOLDOWN_MS = 2000
// 建立基线所需的最小气压样本数
const BASELINE_SAMPLE_COUNT = 5

// 步数估算兜底参数（无气压计时使用）
// 每层楼典型步数（用于步数估算楼层）
const STEPS_PER_FLOOR_FALLBACK = 32
const METERS_PER_HPA = 8.3
const DEFAULT_FLOOR_HEIGHT_M = 3
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
      if (this.baselineSamples.length >= BASELINE_SAMPLE_COUNT) {
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
      this.baselinePressure - (floorsClimbed + 1) * BARO_FLOOR_THRESHOLD_HPA

    const elapsedMs = Math.max(0, atMs ?? Date.now() - this.startedAt)
    const now = this.startedAt + elapsedMs
    if (
      smoothed <= expectedPressure &&
      now - this.lastFloorAt > BARO_FLOOR_COOLDOWN_MS &&
      this.totalSteps >= MINIMUM_STEPS_WITH_BAROMETER &&
      this.hasCompletedFloorRoute() &&
      (!hasKnownRouteEnd(this.template) ||
        this.currentFloor < this.template.endFloor)
    ) {
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

    const completedTurn = this.turnGate.push(frame)
    if (completedTurn) {
      this.events.push({
        t: completedTurn.atMs,
        type: 'turn',
        direction: completedTurn.direction,
        confidence: completedTurn.confidence,
      })
    }

    // 无气压计时，用步数估算楼层
    if (!this.hasBarometer) {
      const floorsClimbed = this.currentFloor - this.template.startFloor
      const expectedSteps = (floorsClimbed + 1) * STEPS_PER_FLOOR_FALLBACK
      if (
        this.totalSteps >= expectedSteps &&
        this.hasCompletedFloorRoute() &&
        (!hasKnownRouteEnd(this.template) ||
          this.currentFloor < this.template.endFloor)
      ) {
        this.currentFloor += 1
        const elapsedMs = frame.endMs
        const evidence = this.floorEvidence(elapsedMs, false)
        this.lastDecision = {
          type:
            hasKnownRouteEnd(this.template) &&
            this.currentFloor >= this.template.endFloor
              ? 'route_complete'
              : 'confirmed_floor',
          floor: this.currentFloor,
          confidence: 0.55,
          evidence,
          quality: 'degraded',
        }
        this.events.push({
          t: elapsedMs,
          type: 'floor',
          floor: this.currentFloor,
          confidence: 0.55,
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
          this.totalSteps / (floorsClimbed * STEPS_PER_FLOOR_FALLBACK),
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
    const quality = this.interruptions.length || !this.hasBarometer
      ? 'degraded'
      : 'stable'
    const nextFloor =
      !complete &&
      (this.totalSteps % STEPS_PER_FLOOR_FALLBACK) /
        STEPS_PER_FLOOR_FALLBACK >=
        0.65
        ? this.currentFloor + 1
        : undefined
    return {
      currentFloor: this.currentFloor,
      floorsCompleted,
      ascentM,
      steps: this.totalSteps,
      // free 模式无模板对照，置信度固定 0.7（气压）或 0.4（步数）
      confidence: complete
        ? this.lastDecision?.confidence ?? (this.hasBarometer ? 0.7 : 0.4)
        : this.hasBarometer ? 0.7 : 0.4,
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
