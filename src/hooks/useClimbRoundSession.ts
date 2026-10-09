// 单轮爬楼识别 Hook：封装 SensorRecorder + LiveFeaturePump + RouteRecognizer 三件套。
// 每轮创建全新实例，轮次结束后彻底清理，确保第 N 轮不继承第 N-1 轮的缓冲。
//
// 职责边界：
// - 本 hook 只管单轮识别（开始、实时快照、完成、结束、清理）
// - 不负责持久化（saveSession 由上层决定）
// - 不负责多轮状态机（由 useClimbWorkout 编排）
// - 不负责携带方式确认弹窗（由 UI 层处理）

import { useCallback, useEffect, useRef, useState } from 'react'
import { RouteRecognizer } from '../core/recognizer'
import { FreeRecognizer } from '../core/free-recognizer'
import { LiveFeaturePump } from '../services/live-feature-pump'
import { SensorRecorder } from '../services/sensor'
import {
  RoundRecognitionCoordinator,
  SensorAdapter,
} from '../services/round-coordinator'
import { expoSensorAdapter as defaultSensorAdapter } from '../services/sensor-adapter'
import { triggerHapticPattern, triggerSound } from '../services/preferences'
import {
  createWorkoutEvidenceJournal,
  RetainedSampleWindow,
  WorkoutEvidenceJournal,
  WorkoutEvidenceContext,
} from '../services/workout-evidence'
import {
  emptySensorVisualization,
  SensorMotionInterpreter,
  SensorVisualizationState,
} from '../core/sensor-visualization'
import {
  BarometerStatus,
  ClimbSession,
  ClimbMode,
  RecognitionSnapshot,
  RouteTemplate,
  SensorSample,
} from '../core/types'

function initialSnapshot(startFloor: number): RecognitionSnapshot {
  return {
    currentFloor: startFloor,
    floorsCompleted: 0,
    ascentM: 0,
    steps: 0,
    confidence: 0,
    status: 'matching',
    activeMs: 0,
    quality: 'degraded',
    statusReason: 'waiting_for_sensor',
    canAutoComplete: false,
    activeSensorSources: [],
  }
}

export interface UseClimbRoundSessionOptions {
  template: RouteTemplate
  // 识别模式：'formal' 用于正式训练，'validation' 用于路线验证。默认 'formal'。
  mode?: ClimbMode
  // 楼层变化时回调（用于 UI 更新楼层流光图等）
  onFloorChanged?: (floor: number, atMs: number) => void
  // 自动到达终点时回调，返回已 finish 的 ClimbSession
  onComplete?: (session: ClimbSession) => void
  // 传感器中断回调
  onGap?: (gap: { startMs: number; endMs: number }) => void
  // 气压计回调：每个气压样本触发，用于上层记录本轮起点气压基线
  onBarometer?: (status: BarometerStatus) => void
  /** Bounded live observation; raw samples are journaled independently at 10 Hz. */
  onObservation?: (sample: SensorSample, motion: SensorVisualizationState) => void
  onSnapshot?: (snapshot: RecognitionSnapshot) => void
  evidenceContext?: WorkoutEvidenceContext
  onEvidenceError?: (message: string) => void
  keepRunningInBackground?: boolean
  // 新路线首次采集需要由用户到达终点后确认实际楼层，因此不自动结束
  autoComplete?: boolean
  /** 传感器驱动注入点（测试用 fake；生产走 expo-sensors）。 */
  sensorAdapter?: SensorAdapter
  /** 测试/诊断用：每次 start 后的 generation。 */
  onGeneration?: (generation: number) => void
}

export interface UseClimbRoundSessionResult {
  snapshot: RecognitionSnapshot
  elapsedMs: number
  startedAt: number | undefined
  isRunning: boolean
  isCompleted: boolean
  autoCompletePending: boolean
  autoCompleteCountdown: number
  // 气压计是否可用（本轮 ascending 期间）
  barometerAvailable: boolean
  // 最新气压值（hPa），无气压计时为 undefined
  latestPressure: number | undefined
  // 原始波形与综合动作判断，仅用于实时可视化，不改变正式识别结果
  visualization: SensorVisualizationState
  // 启动本轮识别（每轮 new 全新三件套）
  start: (options?: { startedAt?: number; seedSamples?: SensorSample[] }) => Promise<void>
  // 结束并返回 ClimbSession。自动完成时用完成时刻，手动结束时用 Date.now()。
  // 幂等：多次调用返回同一 session。
  finish: (endedAt?: number) => ClimbSession | null
  cancelAutoComplete: () => void
  flushEvidence: () => void
  // 清理（组件卸载或轮次切换时调用）
  cleanup: () => void
}

export function useClimbRoundSession(
  options: UseClimbRoundSessionOptions,
): UseClimbRoundSessionResult {
  const { template, onFloorChanged, onComplete, onGap } = options
  const mode = options.mode ?? 'formal'
  const autoCompleteRef = useRef(options.autoComplete ?? true)
  autoCompleteRef.current = options.autoComplete ?? true

  // D03：三件套的生命周期交给 RoundRecognitionCoordinator，
  // hook 只负责把状态映射成 React 状态；真正的「单 owner + generation 隔离」在 coordinator 里。
  const coordinatorRef = useRef<
    RoundRecognitionCoordinator<RecognitionSnapshot> | undefined
  >(undefined)
  const stopPromiseRef = useRef<Promise<void> | undefined>(undefined)
  const generationRef = useRef(0)
  const evidenceRef = useRef<WorkoutEvidenceJournal | undefined>(undefined)
  const captureOwnerRef = useRef<{ active: boolean; journal?: WorkoutEvidenceJournal } | undefined>(undefined)
  const startRequestRef = useRef(0)
  const retainedSamplesRef = useRef(new RetainedSampleWindow())
  const measuredMotionRef = useRef({ steps: 0, activeMs: 0 })
  const measuredFramesRef = useRef<Array<{ startAt: number; endAt: number; steps: number; activeMs: number }>>([])
  const recognitionSampleAtRef = useRef<number | undefined>(undefined)
  const pumpOriginRef = useRef<number | undefined>(undefined)

  /**
   * 放弃当前 owner 并开始停止（不等待完成）。
   * 返回的 promise 可被 await 以确保「上一轮真正停止后」才开始下一轮。
   */
  const beginStop = useCallback((): Promise<void> => {
    startRequestRef.current += 1
    const owner = captureOwnerRef.current
    if (owner) owner.active = false
    const evidence = owner?.journal ?? evidenceRef.current
    const coordinator = coordinatorRef.current
    if (!coordinator) {
      evidence?.close()
      return stopPromiseRef.current ?? Promise.resolve()
    }
    if (stopPromiseRef.current) return stopPromiseRef.current
    // stop() 立即把 running 置 false 并递增 generation：旧回调从此被丢弃
    // The stopped recorder can report an open terminal gap. Its captured journal
    // remains writable until stop settles; coordinator still excludes that gap
    // from the recognizer and all current UI callbacks.
    const promise = coordinator.stop().catch(() => undefined).finally(() => evidence?.close())
    stopPromiseRef.current = promise
    return promise
  }, [])
  const visualizationRef = useRef(new SensorMotionInterpreter('ascending'))
  const lastVisualizationRenderAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const autoCompleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const autoCompleteCountdownRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const autoCompletePendingRef = useRef(false)
  const autoCompleteSuppressedRef = useRef(false)
  const startedAtRef = useRef<number | undefined>(undefined)
  const completedAtRef = useRef<number | undefined>(undefined)
  const finishedSessionRef = useRef<ClimbSession | null>(null)
  const lastFloorRef = useRef(template.startFloor)
  // 识别模式 ref，避免 start 闭包过期
  const modeRef = useRef<ClimbMode>(mode)
  modeRef.current = mode
  const optionsRef = useRef(options)
  optionsRef.current = options
  const sensorAdapter = options.sensorAdapter

  // 回调 ref，避免 start 闭包过期
  const callbacksRef = useRef({ onFloorChanged, onComplete, onGap, onBarometer: options.onBarometer })
  callbacksRef.current = {
    onFloorChanged,
    onComplete,
    onGap,
    onBarometer: options.onBarometer,
  }

  const [snapshot, setSnapshot] = useState<RecognitionSnapshot>(() =>
    initialSnapshot(template.startFloor),
  )
  const [elapsedMs, setElapsedMs] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)
  const [autoCompletePending, setAutoCompletePending] = useState(false)
  const [autoCompleteCountdown, setAutoCompleteCountdown] = useState(0)
  // 气压计状态：设备是否支持 + 最新气压值
  const [barometerAvailable, setBarometerAvailable] = useState(false)
  const [latestPressure, setLatestPressure] = useState<number | undefined>(
    undefined,
  )
  const [visualization, setVisualization] = useState<SensorVisualizationState>(
    emptySensorVisualization,
  )

  const finishMeasuredSession = useCallback((session: ClimbSession, end: number): ClimbSession => {
    let steps = measuredMotionRef.current.steps
    let activeMs = measuredMotionRef.current.activeMs
    for (const frame of measuredFramesRef.current) {
      if (frame.endAt <= end) continue
      const fractionAfter = Math.max(0, frame.endAt - Math.max(end, frame.startAt)) /
        Math.max(1, frame.endAt - frame.startAt)
      activeMs -= frame.activeMs * fractionAfter
      // Aggregate steps have no individual timestamp. Conservatively exclude a
      // straddling frame rather than assigning elevator steps before the round end.
      steps -= frame.steps
    }
    const durationMs = Math.min(Math.max(0, end - session.startedAt), Math.max(0, Math.round(activeMs)))
    return { ...session, steps: Math.max(0, steps), durationMs,
      samples: retainedSamplesRef.current.snapshot().filter((sample) => sample.t <= end),
      evidenceId: evidenceRef.current?.id }
  }, [])

  const updateSnapshot = useCallback((next: RecognitionSnapshot) => {
    // Route matching can stop advancing at its endpoint. Measurement continues in
    // manual/confirmation modes until the user actually ends the ascent.
    next = { ...next, steps: Math.max(next.steps, measuredMotionRef.current.steps),
      activeMs: Math.max(next.activeMs, measuredMotionRef.current.activeMs) }
    const startedAt = startedAtRef.current
    // 楼层变化检测（仅向上推进才触发）
    if (
      startedAt !== undefined &&
      next.currentFloor > lastFloorRef.current
    ) {
      callbacksRef.current.onFloorChanged?.(next.currentFloor, Math.max(0, (recognitionSampleAtRef.current ?? Date.now()) - startedAt))
      lastFloorRef.current = next.currentFloor
      triggerHapticPattern('floor')
    }
    setSnapshot(next)
    evidenceRef.current?.pushRecognition(next, recognitionSampleAtRef.current ?? Date.now())
    optionsRef.current.onSnapshot?.(next)
    // A mode switch or a confidence drop revokes an outstanding completion timer.
    if ((!autoCompleteRef.current || !next.canAutoComplete || next.status !== 'complete') && autoCompletePendingRef.current) {
      if (autoCompleteTimeoutRef.current) clearTimeout(autoCompleteTimeoutRef.current)
      if (autoCompleteCountdownRef.current) clearInterval(autoCompleteCountdownRef.current)
      autoCompleteTimeoutRef.current = undefined
      autoCompleteCountdownRef.current = undefined
      autoCompletePendingRef.current = false
      setAutoCompletePending(false)
      setAutoCompleteCountdown(0)
    }

    // 已验证路线先给用户 3 秒撤销窗口，再自动完成。
    if (
      autoCompleteRef.current &&
      next.status === 'complete' &&
      next.canAutoComplete &&
      !completedAtRef.current &&
      !autoCompletePendingRef.current &&
      !autoCompleteSuppressedRef.current
    ) {
      autoCompletePendingRef.current = true
      setAutoCompletePending(true)
      setAutoCompleteCountdown(3)
      triggerHapticPattern('recognition_warning')
      autoCompleteCountdownRef.current = setInterval(() => {
        setAutoCompleteCountdown((value) => Math.max(0, value - 1))
      }, 1000)
      autoCompleteTimeoutRef.current = setTimeout(() => {
        if (!autoCompleteRef.current) return
        autoCompleteTimeoutRef.current = undefined
        completedAtRef.current = Date.now()
        autoCompletePendingRef.current = false
        setAutoCompletePending(false)
        setAutoCompleteCountdown(0)
        if (autoCompleteCountdownRef.current) {
          clearInterval(autoCompleteCountdownRef.current)
          autoCompleteCountdownRef.current = undefined
        }
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = undefined
        }
        triggerHapticPattern('round_complete')
        triggerSound('success')
        const recognizer = coordinatorRef.current?.getRecognizer()
        if (recognizer && !finishedSessionRef.current) {
          const session = recognizer.finish(
            completedAtRef.current,
            modeRef.current,
          ) as ClimbSession
          finishedSessionRef.current = finishMeasuredSession(session, completedAtRef.current)
          evidenceRef.current?.event('round_complete', completedAtRef.current, { finalFloor: session.finalFloor, source: 'automatic' })
          callbacksRef.current.onComplete?.(finishedSessionRef.current)
        }
        void beginStop()
        setIsRunning(false)
        setIsCompleted(true)
      }, 3000)
    }
  }, [finishMeasuredSession])

  const cancelAutoComplete = useCallback(() => {
    if (autoCompleteTimeoutRef.current) {
      clearTimeout(autoCompleteTimeoutRef.current)
      autoCompleteTimeoutRef.current = undefined
    }
    if (autoCompleteCountdownRef.current) {
      clearInterval(autoCompleteCountdownRef.current)
      autoCompleteCountdownRef.current = undefined
    }
    autoCompletePendingRef.current = false
    autoCompleteSuppressedRef.current = true
    setAutoCompletePending(false)
    setAutoCompleteCountdown(0)
  }, [])

  const cleanupInternal = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = undefined
    }
    if (autoCompleteTimeoutRef.current) {
      clearTimeout(autoCompleteTimeoutRef.current)
      autoCompleteTimeoutRef.current = undefined
    }
    if (autoCompleteCountdownRef.current) {
      clearInterval(autoCompleteCountdownRef.current)
      autoCompleteCountdownRef.current = undefined
    }
    autoCompletePendingRef.current = false
    // 立即失效本轮 owner 并开始停止；start() 会 await 这个 promise。
    void beginStop()
  }, [beginStop])

  const start = useCallback(async (startOptions?: { startedAt?: number; seedSamples?: SensorSample[] }) => {
    // 先让上一轮彻底释放：等待 stop 完成，避免两轮 recorder 重叠。
    cleanupInternal()
    const startRequest = startRequestRef.current
    await stopPromiseRef.current
    if (startRequest !== startRequestRef.current) return
    stopPromiseRef.current = undefined
    coordinatorRef.current = undefined
    // 重置本轮状态（每轮全新）
    completedAtRef.current = undefined
    autoCompleteSuppressedRef.current = false
    finishedSessionRef.current = null
    lastFloorRef.current = template.startFloor
    startedAtRef.current = startOptions?.startedAt
    retainedSamplesRef.current = new RetainedSampleWindow()
    measuredMotionRef.current = { steps: 0, activeMs: 0 }
    measuredFramesRef.current = []
    recognitionSampleAtRef.current = undefined
    pumpOriginRef.current = undefined
    const context = optionsRef.current.evidenceContext
    evidenceRef.current = context
      ? createWorkoutEvidenceJournal({ ...context, startedAt: startOptions?.startedAt ?? Date.now() },
          (message) => optionsRef.current.onEvidenceError?.(message))
      : undefined
    const owner = { active: true, journal: evidenceRef.current }
    captureOwnerRef.current = owner
    const ownerStartedAt = startOptions?.startedAt ?? Date.now()
    setSnapshot(initialSnapshot(template.startFloor))
    setElapsedMs(0)
    setIsCompleted(false)
    setAutoCompletePending(false)
    setAutoCompleteCountdown(0)
    // 重置气压计状态
    setBarometerAvailable(false)
    setLatestPressure(undefined)
    visualizationRef.current.reset()
    lastVisualizationRenderAtRef.current = 0
    setVisualization(emptySensorVisualization())

    let seedRecognizer: RouteRecognizer | FreeRecognizer | undefined
    let ownerRecorder: SensorRecorder | undefined
    let ownerRecognitionStartedAt = ownerStartedAt
    const coordinator = new RoundRecognitionCoordinator<RecognitionSnapshot>({
      adapter: sensorAdapter ?? defaultSensorAdapter,
      templateName: template.name,
      mode: modeRef.current,
      createRecognizer: () => {
        if (!owner.active || captureOwnerRef.current !== owner) throw new Error('本轮启动已取消')
        const startedAt = startOptions?.startedAt ?? Date.now()
        ownerRecognitionStartedAt = startedAt
        startedAtRef.current = startedAt
        seedRecognizer = modeRef.current === 'free'
          ? new FreeRecognizer(template, startedAt)
          : new RouteRecognizer(template, startedAt)
        const recognizer = seedRecognizer
        return {
          pushFrame: (frame) => recognizer.pushFrame(frame),
          pushBarometer: (pressure) => recognizer.pushBarometer(pressure,
            Math.max(0, (recognitionSampleAtRef.current ?? Date.now()) - startedAt)),
          pause: (atMs) => recognizer.pause(atMs),
          resume: (atMs) => recognizer.resume(atMs),
          finish: (endedAt, mode) => recognizer.finish(endedAt, mode),
        }
      },
      createPump: (onFrame) => new LiveFeaturePump((frame) => {
        if (!owner.active || captureOwnerRef.current !== owner) return
        measuredMotionRef.current.steps += frame.steps
        const frameEnd = (pumpOriginRef.current ?? startedAtRef.current ?? Date.now()) + frame.endMs
        const motion = visualizationRef.current.snapshot(frameEnd)
        const elevatorDown = motion.verticalSpeedMps < -0.45 && motion.motionLevel < 0.28
        let activeMs = 0
        if (!elevatorDown && (frame.steps > 0 || frame.energy >= 0.06)) {
          activeMs = Math.max(0, frame.endMs - frame.startMs)
          measuredMotionRef.current.activeMs += activeMs
        }
        measuredFramesRef.current.push({ startAt: frameEnd - (frame.endMs - frame.startMs), endAt: frameEnd, steps: frame.steps, activeMs })
        if (measuredFramesRef.current.length > 1250) measuredFramesRef.current.splice(0, 100)
        recognitionSampleAtRef.current = frameEnd
        onFrame(frame)
      }),
      createRecorder: (adapter, emit) => {
        // 事件经 emitter 交给 coordinator；coordinator 已做 generation 校验，
        // 因此旧一轮的样本不可能进入新一轮。
        const recorder = new SensorRecorder({
          // Live buffers stay bounded; the evidence journal keeps the entire measured timeline.
          retainSamples: false,
          keepRunningInBackground: optionsRef.current.keepRunningInBackground,
          adapter,
          onSample: (sample) => {
            if (!owner.active || captureOwnerRef.current !== owner) return
            recognitionSampleAtRef.current = sample.t
            pumpOriginRef.current ??= sample.t
            retainedSamplesRef.current.push(sample)
            evidenceRef.current?.pushSample(sample)
            visualizationRef.current.push(sample)
            if (sample.t - lastVisualizationRenderAtRef.current >= 400) {
              lastVisualizationRenderAtRef.current = sample.t
              const motion = visualizationRef.current.snapshot(sample.t)
              setVisualization(motion)
              optionsRef.current.onObservation?.(sample, motion)
            }
          },
          onGap: (gap) => {
            // Always bind raw evidence to this recorder, including a terminal gap
            // emitted after coordinator.stop() has invalidated recognition.
            const origin = recorder.getStartedAt() || ownerStartedAt
            owner.journal?.gap(origin + gap.startMs, origin + gap.endMs)
          },
        })
        ownerRecorder = recorder
        recorder.on('sample', emit.sample)
        recorder.on('gap', emit.gap)
        recorder.on('barometer', emit.barometer)
        recorder.on('status', emit.status)
        // The return monitor has already captured the first upward steps. Replay those
        // before live subscription so full-auto does not lose the start of the next round.
        for (const sample of startOptions?.seedSamples ?? []) {
          recognitionSampleAtRef.current = sample.t
          pumpOriginRef.current ??= sample.t
          retainedSamplesRef.current.push(sample)
          evidenceRef.current?.pushSample(sample)
          visualizationRef.current.push(sample)
          if (sample.pressure !== undefined && sample.pressure > 0) {
            seedRecognizer?.pushBarometer(sample.pressure, sample.t - (startedAtRef.current ?? sample.t))
            callbacksRef.current.onBarometer?.({ available: true, running: true, pressure: sample.pressure, lastSampleAt: sample.t })
          }
          emit.sample(sample)
        }
        return recorder
      },
      handlers: {
        onFrame: (next) => updateSnapshot(next),
        onGap: (gap) => {
          const recognizer = coordinatorRef.current?.getRecognizer()
          // Sensor offsets begin at live acquisition; the recognition session can
          // begin earlier from full-auto seed samples. Raw evidence above keeps the
          // acquisition epoch, while recognition/UI receive session-relative offsets.
          const shift = (ownerRecorder?.getStartedAt() || ownerStartedAt) - ownerRecognitionStartedAt
          const sessionGap = { startMs: Math.max(0, shift + gap.startMs), endMs: Math.max(0, shift + gap.endMs) }
          recognizer?.pause(sessionGap.startMs)
          recognizer?.resume(sessionGap.endMs)
          callbacksRef.current.onGap?.(sessionGap)
        },
        onStatus: (status) => {
          if (status.signal === 'interrupted' && startedAtRef.current !== undefined) {
            coordinatorRef.current
              ?.getRecognizer()
              ?.pause(Date.now() - startedAtRef.current)
          }
        },
        onBarometer: (status) => {
          if (status.lastSampleAt > 0) recognitionSampleAtRef.current = status.lastSampleAt
          // 更新本地状态 + 向上层透传（用于记录本轮起点气压基线）
          setBarometerAvailable(status.available)
          if (status.available && status.pressure > 0) {
            setLatestPressure(status.pressure)
          }
          callbacksRef.current.onBarometer?.(status)
        },
        onBarometerPush: (next) => updateSnapshot(next),
      },
    })
    coordinatorRef.current = coordinator
    stopPromiseRef.current = undefined
    generationRef.current = coordinator.getOwnerId()
    optionsRef.current.onGeneration?.(generationRef.current)

    try {
      await coordinator.start()
      if (!owner.active || startRequest !== startRequestRef.current || coordinatorRef.current !== coordinator) {
        await coordinator.stop().catch(() => undefined)
        return
      }
      const recorder = coordinator.getRecorder()
      startedAtRef.current ??= recorder?.getStartedAt()
      generationRef.current = coordinator.getOwnerId()
      optionsRef.current.onGeneration?.(generationRef.current)
      setIsRunning(true)
      timerRef.current = setInterval(() => {
        if (startedAtRef.current !== undefined) {
          setElapsedMs(Date.now() - startedAtRef.current)
        }
      }, 500)
    } catch (err) {
      // 启动失败：停止并向上抛（不得留下无 owner 的 recorder）
      await coordinator.stop().catch(() => undefined)
      if (!owner.active || startRequest !== startRequestRef.current || coordinatorRef.current !== coordinator) return
      owner.active = false
      owner.journal?.close()
      coordinatorRef.current = undefined
      throw err
    }
  }, [template, updateSnapshot, cleanupInternal, sensorAdapter])

  const finish = useCallback(
    (endedAt?: number): ClimbSession | null => {
      const coordinator = coordinatorRef.current
      const recognizer = coordinator?.getRecognizer()
      if (!recognizer) {
        void beginStop()
        return null
      }
      if (finishedSessionRef.current) return finishedSessionRef.current
      const end = endedAt ?? completedAtRef.current ?? Date.now()
      const session = recognizer.finish(end, modeRef.current) as ClimbSession
      finishedSessionRef.current = finishMeasuredSession(session, end)
      evidenceRef.current?.event('round_finish', end, { finalFloor: session.finalFloor, source: 'manual_or_automation' })
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = undefined
      }
      if (autoCompleteTimeoutRef.current) {
        clearTimeout(autoCompleteTimeoutRef.current)
        autoCompleteTimeoutRef.current = undefined
      }
      if (autoCompleteCountdownRef.current) {
        clearInterval(autoCompleteCountdownRef.current)
        autoCompleteCountdownRef.current = undefined
      }
      autoCompletePendingRef.current = false
      setAutoCompletePending(false)
      setAutoCompleteCountdown(0)
      void beginStop()
      setIsRunning(false)
      return finishedSessionRef.current
    },
    [finishMeasuredSession],
  )

  const cleanup = useCallback(() => {
    cleanupInternal()
    setIsRunning(false)
  }, [cleanupInternal])

  // 组件卸载时清理：先让本轮 owner 失效，避免卸载后旧回调继续 setState
  useEffect(() => {
    return () => {
      cleanupInternal()
    }
  }, [cleanupInternal])

  return {
    snapshot,
    elapsedMs,
    startedAt: startedAtRef.current,
    isRunning,
    isCompleted,
    autoCompletePending,
    autoCompleteCountdown,
    barometerAvailable,
    latestPressure,
    visualization,
    start,
    finish,
    cancelAutoComplete,
    flushEvidence: () => { evidenceRef.current?.flush() },
    cleanup,
  }
}
