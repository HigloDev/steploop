/**
 * fusion-v1 训练会话 hook：把传感器、后台采样服务、识别引擎、语音、触感与存储串起来。
 *
 * 生命周期（status）：
 *   starting → running → finishing → done
 *                            ↘ save_failed → finishing（重试）
 *        ↘ error（传感器启动失败等，可重试或返回）
 * 训练阶段（标定/自动/下行…）完全由 FusionWorkoutEngine 决定，这里不维护第二套状态机。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { AppState } from 'react-native'

import { BuildingTemplate } from '../core/building-template'
import { FusionRoundResult, FusionSnapshot, FusionWorkoutEngine } from '../core/fusion-engine'
import { buildFusionWorkout, fusionRoundToWorkoutRound } from '../core/fusion-workout'
import { uid } from '../core/math'
import { liveWorkoutMetrics } from '../core/live-workout-metrics'
import { WorkoutFeedbackTracker } from '../core/workout-feedback'
import type { VoiceObservation } from '../core/voice-events'
import {
  getBuilding,
  loadFusionCheckpoint,
  recordBuildingResult,
  saveFusionCheckpoint,
  savePendingTemplate,
} from '../services/building-storage'
import {
  isBackgroundTrainingSupported,
  startBackgroundTraining,
  stopBackgroundTraining,
} from '../services/background-training'
import { getPreferences, Preferences, triggerHaptic, triggerHapticPattern } from '../services/preferences'
import { SensorRecorder, sensorStartErrorMessage } from '../services/sensor'
import { createWorkoutVoiceService, WorkoutVoiceService } from '../services/voice-feedback'
import { workoutVoiceSettings } from '../services/workout-voice-settings'
import { saveWorkout } from '../services/workout-storage'
import { createWorkoutEvidenceJournal, WorkoutEvidenceJournal } from '../services/workout-evidence'

export interface FusionWorkoutParams {
  /** 选用已保存的楼栋模板（跳过标定）。 */
  templateId?: string
  /** 新楼标定的起始楼层（默认 1，跳过 0）。 */
  startFloor?: number
  /** 重新标定：结算时覆盖这个模板。 */
  recalibrateTemplateId?: string
  /** 从检查点恢复。 */
  resume?: boolean
}

export type FusionSessionStatus = 'starting' | 'running' | 'finishing' | 'save_failed' | 'done' | 'error'

export interface FusionWorkoutApi {
  status: FusionSessionStatus
  error?: string
  warning?: string
  snapshot?: FusionSnapshot
  rounds: FusionRoundResult[]
  template?: BuildingTemplate
  calories: number
  workoutId: string
  /** Completed rounds have a durable recovery point, so leaving is safe. */
  canSaveLater: boolean
  markFloor(): void
  undoMark(): void
  markTop(): void
  nextRound(): void
  /** 结束训练并保存，返回训练 id；没有任何有效轮次时返回 undefined（不保存）。 */
  finish(): Promise<string | undefined>
  discard(): Promise<void>
  retry(): void
}

const TICK_MS = 500

function voicePhase(phase: FusionSnapshot['phase']): string {
  switch (phase) {
    case 'calibrating':
    case 'climbing':
      return 'climbing'
    case 'calibration_top':
      return 'round_complete'
    case 'descending':
      return 'returning'
    case 'waiting':
      return 'resting'
    default:
      return 'finished'
  }
}

export function useFusionWorkout(params: FusionWorkoutParams): FusionWorkoutApi {
  const [status, setStatus] = useState<FusionSessionStatus>('starting')
  const [error, setError] = useState<string>()
  const [warning, setWarning] = useState<string>()
  const [evidenceWarning, setEvidenceWarning] = useState<string>()
  const [snapshot, setSnapshot] = useState<FusionSnapshot>()
  const [rounds, setRounds] = useState<FusionRoundResult[]>([])
  const [template, setTemplate] = useState<BuildingTemplate>()
  const [attempt, setAttempt] = useState(0)
  const [canSaveLater, setCanSaveLater] = useState(false)

  const workoutIdRef = useRef<string>(uid('workout'))
  const startedAtRef = useRef<number>(Date.now())
  const engineRef = useRef<FusionWorkoutEngine | undefined>(undefined)
  const recorderRef = useRef<SensorRecorder | undefined>(undefined)
  const evidenceRef = useRef<WorkoutEvidenceJournal | undefined>(undefined)
  const voiceRef = useRef<WorkoutVoiceService | undefined>(undefined)
  const prefsRef = useRef<Preferences | undefined>(undefined)
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const feedbackRef = useRef<WorkoutFeedbackTracker | undefined>(undefined)
  const calibratedRef = useRef(false)
  const closedRef = useRef(false)
  const replaceTemplateIdRef = useRef(params.recalibrateTemplateId)
  const endedAtRef = useRef<number | undefined>(undefined)
  const checkpointWriteRef = useRef<Promise<void>>(Promise.resolve())
  const finishPromiseRef = useRef<Promise<string | undefined> | undefined>(undefined)

  const persistCheckpoint = useCallback(() => {
    const engine = engineRef.current
    if (!engine || closedRef.current) return checkpointWriteRef.current
    const checkpoint = {
      schemaVersion: 1 as const,
      workoutId: workoutIdRef.current,
      startedAt: startedAtRef.current,
      savedAt: Date.now(),
      endedAt: endedAtRef.current,
      startFloor: engine.snapshot().startFloor,
      template: engine.getTemplate(),
      calibrated: calibratedRef.current,
      replaceTemplateId: replaceTemplateIdRef.current,
      rounds: engine.getRounds(),
    }
    checkpointWriteRef.current = checkpointWriteRef.current.then(async () => {
      await saveFusionCheckpoint(checkpoint)
      if (checkpoint.endedAt !== undefined) setCanSaveLater(true)
    }).catch(e => {
      if (checkpoint.endedAt !== undefined) setCanSaveLater(false)
      setWarning(e instanceof Error ? e.message : String(e))
    })
    return checkpointWriteRef.current
  }, [])

  const stopSensors = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = undefined
    const recorder = recorderRef.current
    recorderRef.current = undefined
    try { await recorder?.stop() } catch (e) { console.warn('[fusion] 停止传感器失败', e) }
    if (isBackgroundTrainingSupported()) {
      try { await stopBackgroundTraining() } catch (e) { console.warn('[fusion] 停止后台采样失败', e) }
    }
    try { evidenceRef.current?.close(Date.now()) } catch { /* 证据文件写入失败不影响成绩 */ }
    evidenceRef.current = undefined
    deactivateKeepAwake('fusion-workout')
  }, [])

  // ---------- 启动 ----------
  useEffect(() => {
    let cancelled = false
    closedRef.current = false
    setStatus('starting')
    setError(undefined)
    void (async () => {
      try {
        const prefs = await getPreferences()
        prefsRef.current = prefs
        let selected: BuildingTemplate | undefined
        let resumeRounds: FusionRoundResult[] | undefined
        let pendingEndAt: number | undefined
        let startFloor = params.startFloor ?? 1
        if (params.resume) {
          const checkpoint = await loadFusionCheckpoint()
          if (checkpoint) {
            workoutIdRef.current = checkpoint.workoutId
            startedAtRef.current = checkpoint.startedAt
            selected = checkpoint.template
            resumeRounds = checkpoint.rounds
            startFloor = checkpoint.startFloor
            calibratedRef.current = checkpoint.calibrated
            replaceTemplateIdRef.current = checkpoint.replaceTemplateId
            pendingEndAt = checkpoint.endedAt
            if (checkpoint.rounds.length) setWarning('已恢复上次训练：已完成的轮次保留，当前这一轮请从楼下重新开始。')
          }
        } else if (params.templateId) {
          selected = await getBuilding(params.templateId)
          if (!selected) throw new Error('找不到这个楼栋模板，可能已被删除。')
        }
        if (cancelled) return
        const engine = new FusionWorkoutEngine({
          startedAt: startedAtRef.current, startFloor, template: selected, resumeRounds,
        })
        if (!selected) calibratedRef.current = true
        engineRef.current = engine
        setTemplate(engine.getTemplate())
        setRounds(engine.getRounds())
        feedbackRef.current = new WorkoutFeedbackTracker(engine.snapshot())
        if (pendingEndAt !== undefined) {
          endedAtRef.current = pendingEndAt
          engine.finish(pendingEndAt)
          setSnapshot(engine.snapshot(pendingEndAt))
          setError('上次训练已结束，成绩还未保存完成。请重试保存。')
          setCanSaveLater(true)
          setStatus('save_failed')
          return
        }
        engine.onRound(() => {
          setRounds(engine.getRounds())
          setTemplate(engine.getTemplate())
          void persistCheckpoint()
        })

        void activateKeepAwakeAsync('fusion-workout').catch(() => undefined)
        voiceRef.current = createWorkoutVoiceService({ settings: workoutVoiceSettings(prefs) })
        const evidence = createWorkoutEvidenceJournal(
          { workoutId: workoutIdRef.current, roundNumber: 1, phase: 'ascending', startedAt: startedAtRef.current },
          message => setEvidenceWarning(message || undefined),
        )
        evidenceRef.current = evidence

        if (isBackgroundTrainingSupported()) {
          try {
            const native = await startBackgroundTraining(workoutIdRef.current)
            if (!native.running) setWarning('后台采样服务未启动，请保持屏幕常亮、应用在前台。')
          } catch (e) {
            setWarning(e instanceof Error ? e.message : String(e))
          }
        }
        if (cancelled) return
        const recorder = new SensorRecorder({
          retainSamples: false,
          keepRunningInBackground: isBackgroundTrainingSupported(),
          onSample: sample => {
            engine.pushSample(sample)
            const next = engine.snapshot(sample.t)
            const feedback = feedbackRef.current?.observe(next)
            if (feedback) {
              setSnapshot(next)
              void triggerHapticPattern(feedback)
            }
            evidence.pushSample(sample)
          },
          onGap: gap => {
            const origin = recorder.getStartedAt()
            evidence.gap(origin + gap.startMs, origin + gap.endMs)
          },
        })
        recorderRef.current = recorder
        await recorder.start()
        if (cancelled) return
        void persistCheckpoint()
        setStatus('running')
        void triggerHaptic('success')

        timerRef.current = setInterval(() => {
          const now = Date.now()
          engine.tick(now)
          const next = engine.snapshot(now)
          setSnapshot(next)
          const feedback = feedbackRef.current?.observe(next)
          if (feedback) void triggerHapticPattern(feedback)
          const done = engine.getRounds()
          const metrics = liveWorkoutMetrics(next, done, prefsRef.current?.bodyWeightKg)
          const observation: VoiceObservation = {
            workoutId: workoutIdRef.current,
            mode: 'full_auto',
            phase: voicePhase(next.phase),
            currentRoundNumber: next.roundNumber,
            elapsedMs: next.elapsedMs,
            calories: metrics.calories,
            cumulativeFloors: next.totalFloors,
            cumulativeSteps: next.steps,
            startFloor: next.startFloor,
            completedRounds: done.map(r => ({ id: r.id, roundNumber: r.roundNumber, floorsCompleted: r.floors })),
            elevatorDescending: next.phase === 'descending',
          }
          try { voiceRef.current?.observe(observation) } catch { /* 语音失败不影响计数 */ }
        }, TICK_MS)
      } catch (e) {
        if (cancelled) return
        setError(sensorStartErrorMessage(e) || (e instanceof Error ? e.message : String(e)))
        setStatus('error')
        await stopSensors()
      }
    })()
    return () => {
      cancelled = true
      if (!closedRef.current) {
        // 页面被卸载但训练未结束：保留检查点，停止采样（首页可恢复）。
        void persistCheckpoint()
        void stopSensors()
        void voiceRef.current?.dispose()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  // 回到前台时立刻刷新一次（后台期间原生服务仍在采样，样本会回放进引擎）。
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active' && engineRef.current) setSnapshot(engineRef.current.snapshot(Date.now()))
    })
    return () => sub.remove()
  }, [])

  const refresh = () => {
    const engine = engineRef.current
    if (engine) {
      const next = engine.snapshot(Date.now())
      setSnapshot(next)
      const feedback = feedbackRef.current?.observe(next)
      if (feedback) void triggerHapticPattern(feedback)
    }
  }

  const markFloor = useCallback(() => {
    engineRef.current?.markFloor(Date.now())
    refresh()
  }, [])
  const undoMark = useCallback(() => {
    engineRef.current?.undoMark()
    void triggerHaptic('selection')
    refresh()
  }, [])
  const markTop = useCallback(() => {
    engineRef.current?.markTop(Date.now())
    refresh()
    void persistCheckpoint()
  }, [persistCheckpoint])
  const nextRound = useCallback(() => {
    engineRef.current?.nextRound(Date.now())
    void triggerHaptic('medium')
    refresh()
    void persistCheckpoint()
  }, [persistCheckpoint])

  const finish = useCallback((): Promise<string | undefined> => {
    if (finishPromiseRef.current) return finishPromiseRef.current
    const engine = engineRef.current
    if (!engine) return Promise.resolve(undefined)
    const task = (async () => {
      setStatus('finishing')
      setError(undefined)
      const endedAt = endedAtRef.current ?? Date.now()
      endedAtRef.current = endedAt
      const finalRounds = engine.finish(endedAt)
      setSnapshot(engine.snapshot(endedAt))
      setRounds(finalRounds)
      // Keep a completed checkpoint until every required save has succeeded.
      await persistCheckpoint()
      await stopSensors()
      const voice = voiceRef.current
      voiceRef.current = undefined
      if (prefsRef.current?.completionSound) {
        // 结算铃声开始前结束播报，避免语音与铃声重叠。
        await voice?.dispose().catch(() => undefined)
        await voice?.flushJournal?.(workoutIdRef.current).catch(() => undefined)
      } else void voice?.finish(workoutIdRef.current).catch(() => undefined)
      let id: string | undefined
      if (finalRounds.length) {
        const finalTemplate = engine.getTemplate()
        const workout = buildFusionWorkout({
          id: workoutIdRef.current, startedAt: startedAtRef.current, endedAt, status: 'completed',
          template: finalTemplate, rounds: finalRounds.map(fusionRoundToWorkoutRound),
          bodyWeightKg: prefsRef.current?.bodyWeightKg,
        })
        await saveWorkout(workout)
        if (calibratedRef.current && finalTemplate) {
          await savePendingTemplate({
            workoutId: workout.id, template: finalTemplate, warnings: engine.getCalibrationWarnings(),
            replaceTemplateId: replaceTemplateIdRef.current,
          })
        } else if (finalTemplate) {
          await recordBuildingResult(finalTemplate.id, {
            workoutId: workout.id, at: endedAt, rounds: workout.rounds.length,
            floors: workout.totalFloorsCompleted, ascentM: workout.totalAscentM, bestRoundMs: workout.bestRoundMs,
          })
        }
        id = workout.id
      }
      await checkpointWriteRef.current
      await saveFusionCheckpoint(null)
      closedRef.current = true
      setStatus('done')
      return id
    })().catch(e => {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('save_failed')
      void triggerHaptic('error')
      throw e
    }).finally(() => { finishPromiseRef.current = undefined })
    finishPromiseRef.current = task
    return task
  }, [persistCheckpoint, stopSensors])

  const discard = useCallback(async () => {
    setStatus('finishing')
    const endedAt = endedAtRef.current ?? Date.now()
    endedAtRef.current = endedAt
    const engine = engineRef.current
    if (engine) {
      setRounds(engine.finish(endedAt))
      setSnapshot(engine.snapshot(endedAt))
    }
    try {
      await persistCheckpoint()
      await stopSensors()
      await voiceRef.current?.dispose().catch(() => undefined)
      voiceRef.current = undefined
      await checkpointWriteRef.current
      await saveFusionCheckpoint(null)
      closedRef.current = true
      setStatus('done')
    } catch (e) {
      setError(`未能放弃训练：${e instanceof Error ? e.message : String(e)}。可以先保存成绩，再从记录页删除。`)
      setStatus('save_failed')
      throw e
    }
  }, [persistCheckpoint, stopSensors])

  const retry = useCallback(() => setAttempt(value => value + 1), [])

  const calories = snapshot ? liveWorkoutMetrics(snapshot, rounds, prefsRef.current?.bodyWeightKg).calories : 0

  return {
    status, error, warning: evidenceWarning || warning, snapshot, rounds, template, calories, workoutId: workoutIdRef.current, canSaveLater,
    markFloor, undoMark, markTop, nextRound, finish, discard, retry,
  }
}
