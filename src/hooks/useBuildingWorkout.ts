import { useEffect, useRef, useState } from 'react'
import { AutoRoundRecognizer, AutoRoundSnapshot } from '../core/auto-round-recognizer'
import { buildingFromRoute, routeWithBuilding } from '../core/building-model'
import { aggregateBaroWorkout } from '../core/baro-workout'
import { calculateAscentCalories } from '../core/calories'
import { RouteTemplate, ClimbWorkout } from '../core/types'
import { SensorRecorder } from '../services/sensor'
import { LiveFeaturePump } from '../services/live-feature-pump'
import { runTrainingSensorSelfTest } from '../services/sensor-self-test'
import { startBackgroundTraining, stopBackgroundTraining, isBackgroundTrainingSupported } from '../services/background-training'
import { createWorkout, saveWorkout, loadActiveCheckpoint, saveActiveCheckpoint, clearActiveCheckpoint } from '../services/workout-storage'
import { saveRoute } from '../services/storage'
import { getPreferences } from '../services/preferences'
import { createWorkoutVoiceService } from '../services/voice-feedback'
import { workoutVoiceSettings } from '../services/workout-voice-settings'
import { createWorkoutEvidenceJournal } from '../services/workout-evidence'

/** A single recorder spans the entire workout: no missing pressure events between rounds. */
export function useBuildingWorkout(template: RouteTemplate) {
  const [snapshot, setSnapshot] = useState<AutoRoundSnapshot>()
  const [workout, setWorkout] = useState<ClimbWorkout>()
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [checking, setChecking] = useState(true)
  const [retry, setRetry] = useState(0)
  const owner = useRef<{
    engine: AutoRoundRecognizer; recorder: SensorRecorder; workout: ClimbWorkout;
    finish: () => Promise<ClimbWorkout>; checkpoint: () => Promise<void>; publish: () => void
  } | undefined>(undefined)
  const finishPromise = useRef<Promise<ClimbWorkout> | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    let recorder: SensorRecorder | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    let voice: ReturnType<typeof createWorkoutVoiceService> | undefined
    let evidence: ReturnType<typeof createWorkoutEvidenceJournal> | undefined
    let backgroundOwned = false
    let finished = false
    let finishing = false
    let writeQueue = Promise.resolve()
    const enqueue = (job: () => Promise<void>) => {
      const task = writeQueue.then(job)
      writeQueue = task.catch(e => { if (!cancelled) setError(`保存失败：${String(e)}`) })
      return task
    }
    const start = async () => {
      setChecking(true); setReady(false); setError('')
      const check = await runTrainingSensorSelfTest()
      if (cancelled) return
      if (!check.canStart) { setError(check.problems.join('\n')); setChecking(false); return }
      const [prefs, cp] = await Promise.all([getPreferences(), loadActiveCheckpoint()])
      if (cancelled) return
      if (cp && cp.templateId !== template.id) throw new Error('请先处理首页的未完成训练。')
      if (cp && cp.recognitionVersion !== 'baro-v1') throw new Error('请先在首页保存旧版未完成训练，再开始新流程。')
      const engine = new AutoRoundRecognizer(template.startFloor, buildingFromRoute(template))
      let current = cp?.baroWorkout ?? createWorkout({ templateId: template.id, templateVersion: template.version,
        routeSnapshot: { name: template.name, locationName: template.location?.name ?? template.name,
          startFloor: template.startFloor, endFloor: template.endFloor, floorsPerRound: engine.building?.floors.length ?? 0,
          ascentPerRoundM: template.totalAscentM }, goal: { type: 'open' }, returnConfirmationMode: 'assisted',
        trackingMode: 'full_auto', bodyWeightKg: prefs.bodyWeightKg })
      current = { ...current, recognitionVersion: 'baro-v1' }
      engine.rounds.push(...(cp?.completedRounds ?? []))
      if (isBackgroundTrainingSupported()) {
        const status = await startBackgroundTraining(current.id)
        backgroundOwned = status.running
        if (!status.running) throw new Error(status.lastError ?? '后台服务启动失败')
      }
      if (cancelled) { if (backgroundOwned) await stopBackgroundTraining(); return }
      voice = createWorkoutVoiceService({ settings: { ...workoutVoiceSettings(prefs), floorMilestones: [], floorMilestoneInterval: 0 }, onJournal: entry => {
        if (!cancelled && (entry.outcome === 'failed' || entry.outcome === 'unavailable')) setError('语音暂不可用，楼层继续记录。')
      } })
      evidence = createWorkoutEvidenceJournal({ workoutId: current.id, roundNumber: 0, phase: 'ascending', startedAt: Date.now() }, setError)
      let origin: number | undefined
      let lastRender = 0
      let savedRoundCount = engine.rounds.length
      let lastFloor = template.startFloor
      let lastRound = -1
      let lastCheckpoint = 0
      let finalWorkout: ClimbWorkout | undefined
      const checkpoint = () => {
        const state = engine.snapshot()
        const w = aggregateBaroWorkout(current, engine.rounds, Date.now())
        return enqueue(async () => {
          if (finished) return
          if (engine.building) await saveRoute(routeWithBuilding(template, engine.building))
          await saveActiveCheckpoint({ workoutId: w.id, recognitionVersion: 'baro-v1', baroWorkout: w,
            phase: state.phase === 'climbing' ? 'ascending' : 'returning', currentRoundNumber: state.roundNumber,
            savedAt: Date.now(), completedRounds: [...engine.rounds], templateId: template.id,
            startedAt: w.startedAt, goal: { type: 'open' }, returnConfirmationMode: 'assisted', floorCounting: 'transitions',
            bodyWeightKg: w.bodyWeightKg })
        })
      }
      const publish = () => {
        if (cancelled || finished || finishing) return
        const state = engine.snapshot()
        const at = Date.now()
        current = aggregateBaroWorkout(current, engine.rounds, at)
        if (owner.current) owner.current.workout = current
        if (state.roundNumber !== lastRound) { lastFloor = template.startFloor; lastRound = state.roundNumber }
        if (!state.calibration && state.phase === 'climbing' && state.currentFloor > lastFloor) {
          voice?.enqueue([{ id: `${current.id}:floor:${state.roundNumber}:${state.currentFloor}`, workoutId: current.id,
            kind: 'floor_milestone', at, expiresAt: at + 10000, priority: 80, numbers: { floors: current.totalFloorsCompleted + state.floors } }])
          lastFloor = state.currentFloor
        }
        voice?.observe({ workoutId: current.id, mode: 'full_auto', phase: state.phase === 'ready' ? 'round_ready' : state.phase,
          currentRoundNumber: state.roundNumber, elapsedMs: current.totalElapsedMs,
          calories: calculateAscentCalories(current.totalAscentM + (state.phase === 'climbing' ? state.ascentM : 0), current.bodyWeightKg),
          cumulativeFloors: current.totalFloorsCompleted + (state.phase === 'climbing' ? state.floors : 0),
          cumulativeSteps: current.totalSteps + (state.phase === 'climbing' ? state.steps : 0),
          startFloor: template.startFloor, elevatorDescending: state.elevator === 'down',
          completedRounds: engine.rounds.map(r => ({ id: r.id, roundNumber: r.roundNumber, floorsCompleted: r.floorsCompleted })) })
        if (engine.rounds.length !== savedRoundCount || at - lastCheckpoint > 5000) {
          savedRoundCount = engine.rounds.length; lastCheckpoint = at
          void checkpoint().catch(() => undefined)
        }
        if (at - lastRender >= 200) { setSnapshot(state); setWorkout(current); lastRender = at }
      }
      const pump = new LiveFeaturePump(frame => {
        engine.pushFrame({ ...frame, startMs: frame.startMs + origin!, endMs: frame.endMs + origin! }); publish()
      })
      recorder = new SensorRecorder({ keepRunningInBackground: backgroundOwned, retainSamples: false,
        onSample: sample => { if (cancelled || finishing) return; origin ??= sample.t; evidence?.pushSample(sample); pump.push(sample) },
        onBarometer: status => {
          if (cancelled || finishing || !status.available) return
          evidence?.event('pressure', status.lastSampleAt, { pressure: status.pressure, recognitionVersion: 'baro-v1' })
          engine.pushPressure(status.pressure, status.lastSampleAt); publish()
        }, onGap: gap => { evidence?.event('sensor_gap', Date.now(), gap); setError('传感器采样中断，请在结束训练后核对各轮楼层。') } })
      const finish = async () => {
        finishing = true
        engine.finish(Date.now())
        const final = finalWorkout ??= aggregateBaroWorkout(current, engine.rounds, Date.now(), true)
        try {
          await recorder!.stop()
          await enqueue(async () => {
            await saveWorkout(final)
            if (engine.building) await saveRoute(routeWithBuilding(template, engine.building))
          })
          voice?.observe({ workoutId: final.id, mode: 'full_auto', phase: 'workout_complete', currentRoundNumber: final.rounds.length,
            elapsedMs: final.totalElapsedMs, calories: calculateAscentCalories(final.totalAscentM, final.bodyWeightKg),
            cumulativeFloors: final.totalFloorsCompleted, completedRounds: final.rounds })
          let voiceTimeout: ReturnType<typeof setTimeout> | undefined
          try {
            await Promise.race([voice?.finish(final.id), new Promise<void>(resolve => { voiceTimeout = setTimeout(resolve, 15000) })])
          } finally { if (voiceTimeout) clearTimeout(voiceTimeout) }
          if (backgroundOwned) {
            const status = await stopBackgroundTraining()
            if (status.running) throw new Error('训练已保存，但后台服务尚未停止，请重试结束。')
            backgroundOwned = false
          }
          await enqueue(() => clearActiveCheckpoint())
          finished = true; evidence?.close(); setWorkout(final); setSnapshot(engine.snapshot())
          return final
        } catch (e) { throw e } // Remain frozen; retry saves the same final result and retries cleanup.
      }
      owner.current = { engine, recorder, workout: current, checkpoint, publish, finish }
      await recorder.start()
      if (cancelled) { await recorder.stop(); return }
      setChecking(false); setReady(true); publish()
      timer = setInterval(() => { engine.tick(Date.now()); publish() }, 500)
    }
    void start().catch(async e => {
      await recorder?.stop()
      if (backgroundOwned) await stopBackgroundTraining().catch(() => undefined)
      if (!cancelled) { setError(String(e)); setChecking(false) }
    })
    return () => {
      cancelled = true; owner.current = undefined
      if (timer) clearInterval(timer)
      void recorder?.stop(); evidence?.close(); void voice?.dispose()
      if (backgroundOwned) void stopBackgroundTraining().catch(() => undefined)
    }
  }, [template, retry])

  return { snapshot, workout, error, ready, checking,
    retry: () => { finishPromise.current = undefined; setRetry(n => n + 1) },
    mark: (floor?: number) => { owner.current?.engine.markFloor(Date.now(), floor); owner.current?.publish(); setSnapshot(owner.current?.engine.snapshot()) },
    undo: () => { owner.current?.engine.undoMark(); setSnapshot(owner.current?.engine.snapshot()) },
    finish: () => {
      if (!owner.current) return Promise.reject(new Error('训练尚未开始'))
      finishPromise.current ??= owner.current.finish().catch(e => { finishPromise.current = undefined; throw e })
      return finishPromise.current
    } }
}
