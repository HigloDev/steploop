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
import { triggerHaptic, triggerSound } from '../services/preferences'
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
  // 新路线首次采集需要由用户到达终点后确认实际楼层，因此不自动结束
  autoComplete?: boolean
}

export interface UseClimbRoundSessionResult {
  snapshot: RecognitionSnapshot
  elapsedMs: number
  startedAt: number | undefined
  isRunning: boolean
  isCompleted: boolean
  // 气压计是否可用（本轮 ascending 期间）
  barometerAvailable: boolean
  // 最新气压值（hPa），无气压计时为 undefined
  latestPressure: number | undefined
  // 原始波形与综合动作判断，仅用于实时可视化，不改变正式识别结果
  visualization: SensorVisualizationState
  // 启动本轮识别（每轮 new 全新三件套）
  start: () => Promise<void>
  // 结束并返回 ClimbSession。自动完成时用完成时刻，手动结束时用 Date.now()。
  // 幂等：多次调用返回同一 session。
  finish: (endedAt?: number) => ClimbSession | null
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

  const recorderRef = useRef<SensorRecorder | undefined>(undefined)
  const recognizerRef = useRef<RouteRecognizer | FreeRecognizer | undefined>(undefined)
  const pumpRef = useRef<LiveFeaturePump | undefined>(undefined)
  const visualizationRef = useRef(new SensorMotionInterpreter('ascending'))
  const lastVisualizationRenderAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const startedAtRef = useRef<number | undefined>(undefined)
  const completedAtRef = useRef<number | undefined>(undefined)
  const finishedSessionRef = useRef<ClimbSession | null>(null)
  const lastFloorRef = useRef(template.startFloor)
  // 识别模式 ref，避免 start 闭包过期
  const modeRef = useRef<ClimbMode>(mode)
  modeRef.current = mode

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
  // 气压计状态：设备是否支持 + 最新气压值
  const [barometerAvailable, setBarometerAvailable] = useState(false)
  const [latestPressure, setLatestPressure] = useState<number | undefined>(
    undefined,
  )
  const [visualization, setVisualization] = useState<SensorVisualizationState>(
    emptySensorVisualization,
  )

  const updateSnapshot = useCallback((next: RecognitionSnapshot) => {
    const startedAt = startedAtRef.current
    // 楼层变化检测（仅向上推进才触发）
    if (
      startedAt !== undefined &&
      next.currentFloor > lastFloorRef.current
    ) {
      callbacksRef.current.onFloorChanged?.(next.currentFloor, Date.now() - startedAt)
      lastFloorRef.current = next.currentFloor
      triggerHaptic('medium')
    }
    // 回归调试：临时禁用 setSnapshot 隔离渲染频率是否为内存泄漏源
    setSnapshot(
      !autoCompleteRef.current && next.status === 'complete'
        ? { ...next, status: 'matching' }
        : next,
    )

    // 自动完成检测（只触发一次）
    if (
      autoCompleteRef.current &&
      next.status === 'complete' &&
      !completedAtRef.current
    ) {
      completedAtRef.current = Date.now()
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = undefined
      }
      triggerHaptic('heavy')
      triggerSound('success')
      // 生成 session 并通知上层
      const recognizer = recognizerRef.current
      if (recognizer && !finishedSessionRef.current) {
        const session = recognizer.finish(completedAtRef.current, modeRef.current)
        // free 模式：附上原始样本供上层生成路线模板（stop 后 samples 仍可用）
        if (modeRef.current === 'free' && recorderRef.current) {
          finishedSessionRef.current = {
            ...session,
            samples: recorderRef.current.getSamples(),
          }
        } else {
          finishedSessionRef.current = session
        }
        callbacksRef.current.onComplete?.(finishedSessionRef.current)
      }
      recorderRef.current?.stop().catch(() => undefined)
      setIsRunning(false)
      setIsCompleted(true)
    }
  }, [])

  const cleanupInternal = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = undefined
    }
    recorderRef.current?.stop().catch(() => undefined)
    recorderRef.current = undefined
    recognizerRef.current = undefined
    pumpRef.current = undefined
  }, [])

  const start = useCallback(async () => {
    // 清理上一轮残留的资源（防止轮次切换时传感器/计时器泄漏）
    cleanupInternal()
    // 重置本轮状态（每轮全新）
    completedAtRef.current = undefined
    finishedSessionRef.current = null
    lastFloorRef.current = template.startFloor
    startedAtRef.current = undefined
    setSnapshot(initialSnapshot(template.startFloor))
    setElapsedMs(0)
    setIsCompleted(false)
    // 重置气压计状态
    setBarometerAvailable(false)
    setLatestPressure(undefined)
    visualizationRef.current.reset()
    lastVisualizationRenderAtRef.current = 0
    setVisualization(emptySensorVisualization())

    const recognizer: RouteRecognizer | FreeRecognizer =
      modeRef.current === 'free'
        ? new FreeRecognizer(template)
        : new RouteRecognizer(template)
    recognizerRef.current = recognizer

    const pump = new LiveFeaturePump((frame) => {
      const next = recognizer.pushFrame(frame)
      updateSnapshot(next)
    })
    pumpRef.current = pump

    const recorder = new SensorRecorder({
      // free 模式需保留原始样本，用于结束后调 analyzeCalibration 生成模板
      retainSamples: modeRef.current === 'free',
      onSample: (sample) => {
        pump.push(sample)
        visualizationRef.current.push(sample)
        if (
          sample.t - lastVisualizationRenderAtRef.current >= 400
        ) {
          lastVisualizationRenderAtRef.current = sample.t
          setVisualization(visualizationRef.current.snapshot())
        }
      },
      onGap: (gap) => {
        recognizer.pause(gap.startMs)
        recognizer.resume(gap.endMs)
        callbacksRef.current.onGap?.(gap)
      },
      onStatus: (status) => {
        if (status.signal === 'interrupted' && startedAtRef.current !== undefined) {
          recognizer.pause(Date.now() - startedAtRef.current)
        }
      },
      onBarometer: (status) => {
        // 更新本地状态 + 向上层透传（用于记录本轮起点气压基线）
        setBarometerAvailable(status.available)
        if (status.available && status.pressure > 0) {
          setLatestPressure(status.pressure)
          // 首次采集和后续正式训练都让识别器接收气压：首次用于估算，
          // 后续用于守住整层边界并在动作模板局部不匹配时脱困。
          updateSnapshot(recognizer.pushBarometer(status.pressure))
        }
        callbacksRef.current.onBarometer?.(status)
      },
    })
    recorderRef.current = recorder

    try {
      await recorder.start()
      startedAtRef.current = recorder.getStartedAt()
      setIsRunning(true)
      timerRef.current = setInterval(() => {
        if (startedAtRef.current !== undefined) {
          setElapsedMs(Date.now() - startedAtRef.current)
        }
      }, 500)
    } catch (err) {
      // 启动失败：清理并向上抛
      cleanupInternal()
      throw err
    }
  }, [template, updateSnapshot, cleanupInternal])

  const finish = useCallback(
    (endedAt?: number): ClimbSession | null => {
      const recognizer = recognizerRef.current
      if (!recognizer) return null
      if (finishedSessionRef.current) return finishedSessionRef.current
      const end = endedAt ?? completedAtRef.current ?? Date.now()
      finishedSessionRef.current = recognizer.finish(end, modeRef.current)
      // free 模式：把原始样本附在 session 上，供上层生成路线模板
      if (modeRef.current === 'free' && recorderRef.current) {
        const samples: SensorSample[] = recorderRef.current.getSamples()
        finishedSessionRef.current = {
          ...finishedSessionRef.current,
          samples,
        }
      }
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = undefined
      }
      recorderRef.current?.stop().catch(() => undefined)
      setIsRunning(false)
      return finishedSessionRef.current
    },
    [],
  )

  const cleanup = useCallback(() => {
    cleanupInternal()
    setIsRunning(false)
  }, [cleanupInternal])

  // 组件卸载时清理
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
    barometerAvailable,
    latestPressure,
    visualization,
    start,
    finish,
    cleanup,
  }
}
