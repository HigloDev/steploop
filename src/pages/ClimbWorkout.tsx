// 多轮训练主页面：一个容器页面管理整次训练的所有阶段。
// 阶段：round_ready → ascending → round_complete → returning → recovering → 下一轮
//       → returning → start_confirmation → recovering → 下一轮
// 用户主动结束 → workout_complete → 跳转 WorkoutResult

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Host, Picker, Switch as NativeSwitch } from '@expo/ui'
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
} from 'expo-keep-awake'

import { isRoutePrepared } from '../core/route-preparation'
import { Disclosure } from '../components/disclosure'
import { Header } from '../components/Header'
import { StaircaseScene } from '../components/StaircaseScene'
import { WorkoutCompleteCeremony } from '../components/WorkoutCompleteCeremony'
import { TrackingModeSelector } from '../components/tracking-mode-selector'
import { VoiceModeSelector } from '../components/voice-mode-selector'
import { VoiceModeChoice, voiceModeChoice, voiceModePreferences, workoutVoiceSettings } from '../services/workout-voice-settings'
import { LiveTrainingMetrics } from '../components/live-training-metrics'
import { BackgroundTrainingReadiness } from '../components/background-training-readiness'
import { deriveLiveWorkoutMetrics } from '../core/live-workout-metrics'
import { SensorMotionVisualizer } from '../components/sensor-motion-visualizer'
import { buildRealtimeFloors } from '../components/BuildingSketch'
import { Button, Card, Metric, Notice, Pill } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import { isPrivacyAgreed } from '../services/privacy'
import { getRoute } from '../services/storage'
import { loadActiveCheckpoint } from '../services/workout-storage'
import { RecognitionSnapshot, RouteTemplate, WorkoutGoal, WorkoutPlan } from '../core/types'
import { formatDuration } from '../core/math'
import { useClimbWorkout } from '../hooks/useClimbWorkout'
import { planPhaseLabel } from '../core/workout-plan'
import { hasKnownRouteEnd } from '../core/route-state'
import { getFloorTransitionCount } from '../core/floors'
import {
  calculateStairCalories,
  DEFAULT_BODY_WEIGHT_KG,
  formatCalories,
} from '../core/calories'
import { getPreferences, savePreferences } from '../services/preferences'
import { createWorkoutVoiceService, isWorkoutVoiceAvailable } from '../services/voice-feedback'
import { recordWorkoutEvidenceEvent } from '../services/workout-evidence'
import { VOICE_MILESTONE_CONFIG_VERSION } from '../core/voice-config'

interface FloorCard {
  floor: number
  state: 'done' | 'current' | 'pending'
  splitText: string
}

const CLIMB_WORKOUT_KEEP_AWAKE_TAG = 'climb-workout-active'

function buildFloorCards(
  r: RouteTemplate | undefined,
  currentFloor: number,
  splits: Array<{ floor: number; atMs: number; elapsedMs: number }>,
  startedAt: number,
): FloorCard[] {
  if (!r || !hasKnownRouteEnd(r)) return []
  const cards: FloorCard[] = []
  const splitMap = new Map(splits.map((s) => [s.floor, s.elapsedMs]))
  for (let f = r.startFloor; f <= r.endFloor; f++) {
    let state: FloorCard['state'] = 'pending'
    if (f < currentFloor) state = 'done'
    else if (f === currentFloor) state = 'current'
    const elapsed = splitMap.get(f)
    let splitText = '—'
    if (state === 'done' && elapsed != null) {
      splitText = `${(elapsed / 1000).toFixed(1)}秒`
    } else if (state === 'current') {
      splitText = '攀登中'
    }
    cards.push({ floor: f, state, splitText })
  }
  return cards
}

export default function ClimbWorkoutScreen({
  navigation,
  route,
}: RootStackScreen<'ClimbWorkout'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const { id, goal, returnConfirmationMode, trackingMode } = route.params
  // D07b：计划由 WorkoutSetup 随路由参数透传（navigation/types.ts 属只读集合，
  // 因此这里按「可选扩展字段」读取；没有该字段 = 旧流程）。
  const planParam = (route.params as { plan?: WorkoutPlan }).plan

  const [routeTpl, setRouteTpl] = useState<RouteTemplate | null>(null)
  const [loadError, setLoadError] = useState('')
  const [bodyWeightKg, setBodyWeightKg] = useState(DEFAULT_BODY_WEIGHT_KG)
  const [preferencesReady, setPreferencesReady] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [voiceMode, setVoiceMode] = useState<VoiceModeChoice>('standard')
  const [voiceError, setVoiceError] = useState('')
  const [voiceSettingsSaveError, setVoiceSettingsSaveError] = useState('')
  const screenMounted = useRef(true)
  useEffect(() => {
    screenMounted.current = true
    return () => { screenMounted.current = false }
  }, [])
  const [voiceService] = useState(() => createWorkoutVoiceService({
    settings: { enabled: false },
    onJournal: entry => {
      if (screenMounted.current && (entry.outcome === 'failed' || entry.outcome === 'unavailable')) {
        setVoiceError('播报失败，训练继续记录；可导出查看播报结果。')
      }
    },
  }))
  const [savingWorkout, setSavingWorkout] = useState(false)
  const mutationLock = useRef(false)
  const [confirmMode, setConfirmMode] = useState<
    'finish_workout' | 'finish_round' | 'learning_endpoint' | 'floor_anchor' | null
  >(null)

  // 加载路线
  useEffect(() => {
    const load = async () => {
      if (!id) {
        setLoadError('路线不存在')
        return
      }
      try {
        const r = await getRoute(id)
        if (!r) {
          setLoadError('路线不存在')
          return
        }
        setRouteTpl(r)
      } catch (err) {
        setLoadError('加载路线失败')
      }
    }
    load()
  }, [id])

  useEffect(() => {
    getPreferences()
      .then((prefs) => {
        if (!screenMounted.current) return
        setBodyWeightKg(prefs.bodyWeightKg)
        setVoiceEnabled(prefs.voiceEnabled !== false)
        setVoiceMode(voiceModeChoice(prefs))
        voiceService.setSettings(workoutVoiceSettings(prefs))
        setPreferencesReady(true)
      })
      .catch(() => { if (screenMounted.current) setPreferencesReady(true) })
  }, [])

  // 只有训练页面位于前台时保持亮屏；离开训练后恢复系统熄屏规则。
  useEffect(() => {
    const activate = () => {
      activateKeepAwakeAsync(CLIMB_WORKOUT_KEEP_AWAKE_TAG).catch(
        () => undefined,
      )
    }
    const deactivate = () => {
      deactivateKeepAwake(CLIMB_WORKOUT_KEEP_AWAKE_TAG).catch(
        () => undefined,
      )
    }

    activate()
    const unsubscribeFocus = navigation.addListener('focus', activate)
    const unsubscribeBlur = navigation.addListener('blur', deactivate)

    return () => {
      unsubscribeFocus()
      unsubscribeBlur()
      deactivate()
    }
  }, [navigation])

  // 初始化多轮训练 hook
  const effectiveGoal = useMemo<WorkoutGoal>(
    () =>
      routeTpl && hasKnownRouteEnd(routeTpl) ? goal : { type: 'open' },
    [goal, routeTpl],
  )
  const finishVoiceBeforeBackgroundStop = useCallback(async (savedWorkout: import('../core/types').ClimbWorkout) => {
    voiceService.observe({
      workoutId: savedWorkout.id, mode: savedWorkout.trackingMode ?? 'automatic', phase: 'workout_complete',
      currentRoundNumber: savedWorkout.currentRoundNumber, elapsedMs: savedWorkout.totalElapsedMs,
      calories: calculateStairCalories(savedWorkout.activeDurationMs, savedWorkout.bodyWeightKg ?? bodyWeightKg),
      cumulativeFloors: savedWorkout.totalFloorsCompleted, cumulativeSteps: savedWorkout.totalSteps,
      startFloor: savedWorkout.routeSnapshot.startFloor, restElapsedMs: 0,
      completedRounds: savedWorkout.rounds.filter(round => round.floorConfirmation !== 'pending').map(round => ({
        id: round.id, roundNumber: round.roundNumber, floorsCompleted: round.floorsCompleted,
        confirmedTopFloor: round.finalFloor, correctionRevision: round.corrections?.length ?? round.userCorrectionCount ?? 0,
        returnedToStartAt: round.returnedToStartAt,
      })),
    })
    await voiceService.waitUntilIdle()
    await voiceService.flushJournal(savedWorkout.id)
  }, [voiceService, bodyWeightKg])
  const workout = useClimbWorkout({
    template: routeTpl ?? DUMMY_TEMPLATE,
    goal: effectiveGoal,
    returnConfirmationMode,
    trackingMode: trackingMode ?? 'automatic',
    bodyWeightKg,
    beforeBackgroundStop: finishVoiceBeforeBackgroundStop,
    plan: planParam,
  })
  const activeRouteTpl = workout.activeTemplate
  // 卡路里只按净爬楼时间计算：已完成轮的净用时 + 当前轮的真实动作帧累计。
  // 不能使用本轮挂钟 elapsedMs（原地等待/休息时挂钟仍在走，卡路里会虚增）。
  const liveActiveDurationMs =
    (workout.summary?.activeDurationMs ?? 0) +
    (workout.phase === 'ascending' ? workout.roundSession.snapshot.activeMs : 0)
  const liveCalories = calculateStairCalories(
    liveActiveDurationMs,
    workout.workout?.bodyWeightKg ?? bodyWeightKg,
  )
  const liveMetrics = deriveLiveWorkoutMetrics({
    rounds: workout.workout?.rounds ?? [], phase: workout.phase,
    snapshot: workout.roundSession.snapshot, startFloor: activeRouteTpl.startFloor,
    totalElapsedMs: workout.workout?.endedAt ? Math.max(0, workout.workout.endedAt - workout.workout.startedAt) : workout.timer.totalElapsedMs,
    bodyWeightKg: workout.workout?.bodyWeightKg ?? bodyWeightKg,
  })

  const logVoiceSettings = useCallback((name = 'voice_settings_changed') => {
    const w = workout.workout
    if (!w) return
    const settings = voiceService.getSettings()
    const at = Date.now()
    recordWorkoutEvidenceEvent({ workoutId: w.id, roundNumber: workout.currentRoundNumber, phase: workout.phase, startedAt: at }, name, at, {
      milestoneConfigVersion: VOICE_MILESTONE_CONFIG_VERSION,
      enabled: settings.enabled, detailMode: settings.detailMode, volume: settings.volume, rate: settings.rate,
      bluetoothOnly: settings.bluetoothOnly, nightQuiet: settings.nightQuiet, duckMusic: settings.duckMusic,
      encouragementEnabled: settings.encouragementEnabled, eventEnabled: settings.eventEnabled,
      timeMilestonesMinutes: settings.timeMilestonesMinutes, calorieMilestones: settings.calorieMilestones,
      stepMilestones: settings.stepMilestones, floorMilestones: settings.floorMilestones,
    }, message => { if (screenMounted.current) setVoiceSettingsSaveError(message) })
  }, [workout.workout, workout.currentRoundNumber, workout.phase, voiceService])
  const voiceSettingsWorkoutId = useRef<string | undefined>(undefined)
  useEffect(() => {
    const id = workout.workout?.id
    if (!preferencesReady || !id || voiceSettingsWorkoutId.current === id) return
    voiceSettingsWorkoutId.current = id
    logVoiceSettings('voice_settings_snapshot')
  }, [workout.workout?.id, preferencesReady, logVoiceSettings])

  useEffect(() => {
    const w = workout.workout
    if (!w || !preferencesReady) return
    voiceService.observe({
      workoutId: w.id, mode: workout.trackingMode, phase: workout.phase,
      currentRoundNumber: workout.currentRoundNumber, elapsedMs: liveMetrics.totalMs,
      calories: liveMetrics.calories, cumulativeFloors: liveMetrics.confirmedFloors,
      cumulativeSteps: liveMetrics.steps, restElapsedMs: workout.timer.phaseElapsedMs,
      startFloor: activeRouteTpl.startFloor, elevatorDescending: workout.elevatorDescending,
      completedRounds: w.rounds.filter(round => round.floorConfirmation !== 'pending').map(round => ({
        id: round.id, roundNumber: round.roundNumber, floorsCompleted: round.floorsCompleted,
        confirmedTopFloor: round.finalFloor, correctionRevision: round.corrections?.length ?? round.userCorrectionCount ?? 0,
        returnedToStartAt: round.returnedToStartAt,
      })),
    })
  }, [workout.workout, workout.phase, workout.trackingMode, workout.currentRoundNumber, workout.elevatorDescending, liveMetrics.totalMs, liveMetrics.calories, liveMetrics.confirmedFloors, liveMetrics.steps, workout.timer.phaseElapsedMs, preferencesReady, voiceService, activeRouteTpl.startFloor])
  const latestVoiceWorkout = useRef(workout.workout)
  latestVoiceWorkout.current = workout.workout
  const latestVoicePhase = useRef(workout.phase)
  latestVoicePhase.current = workout.phase
  useEffect(() => () => {
    const w = latestVoiceWorkout.current
    if (w && latestVoicePhase.current === 'workout_complete') void voiceService.finish(w.id).catch(() => voiceService.dispose())
    else void voiceService.dispose()
  }, [voiceService])

  // 进入页面后直接恢复或开始训练，不再显示二次确认页。
  const launchAttemptedRef = useRef(false)
  useEffect(() => {
    if (
      !routeTpl ||
      !preferencesReady ||
      launchAttemptedRef.current ||
      workout.phase !== 'setup'
    ) {
      return
    }
    launchAttemptedRef.current = true

    const launch = async () => {
      try {
        if (!(await isPrivacyAgreed())) { setLoadError('请先阅读并同意隐私条款。'); return }
        const checkpoint = await loadActiveCheckpoint()
        if (checkpoint && checkpoint.templateId !== id) { setLoadError('还有未完成训练，请返回首页处理。'); return }
        if (checkpoint?.templateId === id) {
          workout.resumeFromCheckpoint(checkpoint, routeTpl)
          return
        }
      } catch (err) {
        setLoadError('读取未完成训练失败，请返回后重试。')
        return
      }

      if (!isRoutePrepared(routeTpl)) { navigation.replace('Familiarize', { id }); return }
      workout.startWorkout()
    }

    launch()
  }, [
    id,
    preferencesReady,
    routeTpl,
    workout.phase,
    workout.resumeFromCheckpoint,
    workout.startWorkout,
  ])

  // workout_complete 跳转结果页（由完成仪式动画结束后或点按跳过时触发）
  const completeNavLockRef = useRef(false)
  const navigateAfterComplete = useCallback(() => {
    if (completeNavLockRef.current) return
    const w = workout.workout
    if (!w) return
    completeNavLockRef.current = true
    navigation.replace('WorkoutResult', { id: w.id })
  }, [workout.workout, navigation])

  // 楼层卡片
  const floorCards = useMemo(() => {
    if (!routeTpl || !hasKnownRouteEnd(activeRouteTpl)) return []
    const snapshot = workout.roundSession.snapshot
    // 从 currentRound.floorSplits 构建（如果有的话）
    const splits =
      workout.currentRound?.floorSplits.map((s) => ({
        floor: s.floorTo,
        atMs: s.reachedAtMs,
        elapsedMs: s.splitDurationMs,
      })) ?? []
    return buildFloorCards(
      activeRouteTpl,
      snapshot.currentFloor,
      splits,
      workout.roundSession.startedAt ?? Date.now(),
    )
  }, [
    routeTpl,
    activeRouteTpl,
    workout.roundSession.snapshot,
    workout.currentRound,
    workout.roundSession.startedAt,
  ])

  // === 动作处理 ===
  // round_ready 是旧版的"本轮准备"页；现在任何轮次都直接进入采集界面。
  // D07b：计划里还有热身阶段时**不**自动开爬——等用户热身完（或跳过热身）再开始；
  // 计划已经走完时同样停下，由用户点「完成训练」结束。
  useEffect(() => {
    if (workout.phase !== 'round_ready') return
    if (workout.planPhase?.kind === 'warmup') return
    // 计划走完但用户选择继续加练时，照旧自动开爬（自由加练不计入计划阶段）
    if (workout.plan && !workout.planPhase && !workout.extraRounds) return
    workout.beginAscending()
  }, [
    workout.phase,
    workout.beginAscending,
    workout.planPhase,
    workout.plan,
    workout.extraRounds,
  ])

  const runWorkoutMutation = useCallback(async (action: () => Promise<unknown>) => {
    if (mutationLock.current) return
    mutationLock.current = true
    setSavingWorkout(true)
    try {
      await action()
    } catch (err) {
      Alert.alert('训练尚未保存完成', err instanceof Error ? err.message : '请重试，未完成训练会继续保留。')
    } finally {
      mutationLock.current = false
      setSavingWorkout(false)
    }
  }, [])

  useEffect(() => {
    workout.setAutomaticTransitionsPaused(confirmMode !== null)
  }, [confirmMode, workout.setAutomaticTransitionsPaused])

  const openFinishConfirmation = useCallback((mode: 'finish_workout' | 'finish_round' | 'learning_endpoint') => {
    if (mutationLock.current) return
    workout.setAutomaticTransitionsPaused(true)
    setConfirmMode(mode)
  }, [workout.setAutomaticTransitionsPaused])

  const handleFinishWorkout = useCallback(() => {
    if (mutationLock.current) return
    const phase = workout.phase
    if (phase === 'ascending') {
      openFinishConfirmation('finish_workout')
      return
    }
    // 其他阶段直接结束
    void runWorkoutMutation(() => workout.finishWorkout({ saveIncompleteRound: false }))
  }, [workout.phase, workout.finishWorkout, runWorkoutMutation, openFinishConfirmation])

  const handleConfirmFinish = useCallback(
    async (
      action: 'save' | 'abnormal' | 'discard' | 'cancel',
      confirmedEndFloor?: number,
    ) => {
      const mode = confirmMode
      if (mutationLock.current) return
      if (action === 'cancel') { setConfirmMode(null); return }
      if (mode === 'floor_anchor' && action === 'save' && confirmedEndFloor !== undefined) {
        workout.roundSession.markActualFloor(confirmedEndFloor)
        setConfirmMode(null)
        return
      }
      await runWorkoutMutation(async () => {
      if (
        (mode === 'learning_endpoint' || mode === 'finish_round') &&
        action === 'save' &&
        confirmedEndFloor !== undefined
      ) {
        if (!(await workout.finishRound({ confirmedEndFloor }))) {
          throw new Error('本轮尚未结束，请保留确认的楼层并重试。')
        }
        setConfirmMode(null)
        return
      }
      if (action === 'save') {
        await workout.finishWorkout({
          saveIncompleteRound: true,
          confirmedEndFloor,
          excludeFromLearning:
            workout.firstRoundCalibration && !workout.templateGenerated,
        })
      } else if (action === 'abnormal') {
        await workout.finishWorkout({
          saveIncompleteRound: true,
          excludeFromLearning: true,
        })
      } else {
        await workout.discardCurrentRoundAndFinish()
      }
      setConfirmMode(null)
      })
    },
    [confirmMode, workout, runWorkoutMutation],
  )

  const handleReachedLearningEndpoint = useCallback(() => {
    openFinishConfirmation('learning_endpoint')
  }, [openFinishConfirmation])

  // === Android 硬件返回键 ===
  // 训练进行中按返回键不应直接退出，而是触发与"结束训练"按钮相同的流程。
  // setup 阶段允许默认返回（用户尚未开始训练）。
  const phaseRef = useRef(workout.phase)
  phaseRef.current = workout.phase
  const showFinishConfirmRef = useRef(confirmMode !== null)
  showFinishConfirmRef.current = confirmMode !== null
  const handleFinishWorkoutRef = useRef(handleFinishWorkout)
  handleFinishWorkoutRef.current = handleFinishWorkout
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        const phase = phaseRef.current
        // setup / workout_complete 阶段允许默认返回
        if (phase === 'setup' || phase === 'workout_complete') {
          return false
        }
        // 已显示结束确认弹窗时，拦截返回键（由 Modal 的 onRequestClose 处理）
        if (showFinishConfirmRef.current) {
          return true
        }
        // 其他阶段触发结束流程（ascending 显示弹窗，其余直接结束）
        handleFinishWorkoutRef.current()
        return true
      },
    )
    return () => subscription.remove()
  }, [])

  // === 渲染 ===

  if (loadError) {
    return (
      <View style={styles.page}>
        <Header title="爬楼训练" back />
        <View style={styles.center}>
          <Text style={styles.loadingText}>{loadError}</Text>
          <Button title="返回" onPress={() => navigation.goBack()} />
        </View>
      </View>
    )
  }

  if (!routeTpl) {
    return (
      <View style={styles.page}>
        <Header title="爬楼训练" back />
        <View style={styles.center}>
          <Text style={styles.loadingText}>加载中…</Text>
        </View>
      </View>
    )
  }

  // setup 只在读取检查点时短暂存在，不再展示独立页面。
  if (workout.phase === 'setup') {
    return (
      <View style={styles.page}>
        <View style={styles.center}>
          <Text style={styles.loadingText}>正在进入训练…</Text>
        </View>
      </View>
    )
  }

  // workout_complete 阶段：完成仪式动画，结束后进入 WorkoutResult
  if (workout.phase === 'workout_complete') {
    if (!workout.workout) {
      return (
        <View style={styles.page}>
          <Header title="训练完成" back={false} />
          <View style={styles.center}>
            <Text style={styles.completeTitle}>训练完成</Text>
          </View>
        </View>
      )
    }
    return (
      <WorkoutCompleteCeremony
        workoutId={workout.workout.id}
        totalFloors={
          workout.summary?.totalFloors ?? workout.workout.totalFloorsCompleted
        }
        completeRounds={
          workout.summary?.completeRounds ?? workout.workout.totalRoundsCompleted
        }
        totalAscentM={
          workout.summary?.totalAscentM ?? workout.workout.totalAscentM
        }
        planLines={workout.planFeedback?.lines ?? []}
        totalSteps={workout.summary?.totalSteps ?? 0}
        calories={liveMetrics.calories}
        activeMs={workout.summary?.activeDurationMs ?? 0}
        totalMs={workout.summary?.totalElapsedMs ?? workout.timer.totalElapsedMs}
        onDone={navigateAfterComplete}
      />
    )
  }

  // 主训练界面：根据阶段渲染不同内容
  return (
    <View style={styles.page}>
      <Header title="爬楼训练" back={false} />
      {workout.checkpointSaveError ? (
        <View style={styles.checkpointWarn}>
          <Text style={styles.checkpointWarnText}>{workout.checkpointSaveError}</Text>
        </View>
      ) : null}
      {workout.backgroundGapWarning ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="后台缺段提示，点击关闭"
          onPress={workout.dismissBackgroundGapWarning}
        >
          <View style={styles.checkpointWarn}>
            <Text style={styles.checkpointWarnText}>
              {workout.backgroundGapWarning}（点击关闭）
            </Text>
          </View>
        </Pressable>
      ) : null}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        <View style={styles.liveHero}>
          <View style={styles.liveHeroTop}><Pill>第 {workout.currentRoundNumber} 轮</Pill><Text style={styles.goalHint}>{describeGoal(effectiveGoal)}</Text></View>
          <View style={styles.liveFloorRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.liveFloorLabel}>{workout.phase === 'ascending' ? '当前楼层 · 估计' : workout.phase === 'round_complete' ? (workout.currentRound?.floorConfirmation === 'pending' ? '估计到达 · 待确认' : '本轮到达') : workout.phase === 'returning' || workout.phase === 'start_confirmation' ? '返回起点' : '准备下一轮'}</Text>
              <Text style={styles.liveFloorValue}>{workout.phase === 'ascending' ? workout.roundSession.snapshot.currentFloor : workout.phase === 'round_complete' ? workout.currentRound?.finalFloor ?? activeRouteTpl.startFloor : activeRouteTpl.startFloor}<Text style={styles.liveFloorUnit}> 楼</Text></Text>
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end', gap: 6 }}>
              <Text style={styles.liveTarget}>{hasKnownRouteEnd(activeRouteTpl) ? `本轮终点 ${activeRouteTpl.endFloor} 楼` : '终点由你确认'}</Text>
              <Text style={styles.liveHint}>{workout.phase === 'ascending' ? `从 ${activeRouteTpl.startFloor} 楼出发` : workout.phase === 'returning' ? '乘电梯返回，再开始下一轮' : workout.phase === 'recovering' ? '按自己的节奏休息' : '每一轮都按实际楼层保存'}</Text>
            </View>
          </View>
          <Text style={styles.liveRoute}>{activeRouteTpl.name}</Text>
          {workout.phase === 'ascending' && hasKnownRouteEnd(activeRouteTpl) ? <View accessible accessibilityRole="progressbar" accessibilityLabel="本轮楼层进度" accessibilityValue={{ min: 0, max: 100, now: Math.min(100, Math.round(getFloorTransitionCount(activeRouteTpl.startFloor, workout.roundSession.snapshot.currentFloor) / Math.max(1, getFloorTransitionCount(activeRouteTpl.startFloor, activeRouteTpl.endFloor)) * 100)) }} style={styles.liveProgress}>
            <View style={{ height: 4, backgroundColor: theme.brand, borderRadius: 2, width: `${Math.min(100, getFloorTransitionCount(activeRouteTpl.startFloor, workout.roundSession.snapshot.currentFloor) / Math.max(1, getFloorTransitionCount(activeRouteTpl.startFloor, activeRouteTpl.endFloor)) * 100)}%` }} />
          </View> : null}
        </View>
        <LiveTrainingMetrics metrics={liveMetrics} />
        {workout.automationStatus ? <Text accessibilityLiveRegion="polite" style={styles.liveAutomation}>{workout.automationStatus}</Text> : null}
        <Disclosure title="记录与语音" summary={`${({ manual: '手动', automatic: '自动', full_auto: '自动衔接' })[workout.trackingMode]}记录 · ${({ concise: '精简播报', standard: '标准播报', coach: '教练播报', off: '语音关闭' })[voiceMode]}`}>
        <TrackingModeSelector compact value={workout.trackingMode} disabled={savingWorkout} onChange={workout.setTrackingMode} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
          <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '700' }}>语音播报</Text>
        <Host matchContents seedColor={theme.brand} style={{ width: 72, minHeight: 48 }}>
          <NativeSwitch value={voiceEnabled} onValueChange={enabled => {
            setVoiceEnabled(enabled); setVoiceError(''); voiceService.setSettings({ enabled });
            if (!enabled) setVoiceMode('off')
            else setVoiceMode(voiceService.getSettings().detailMode)
            logVoiceSettings()
            void savePreferences({ voiceEnabled: enabled })
          }} testID="workout-voice-enabled" />
        </Host>
        </View>
        <VoiceModeSelector compact value={voiceMode} disabled={savingWorkout} onChange={value => {
          setVoiceMode(value); setVoiceEnabled(value !== 'off'); setVoiceError('')
          voiceService.setSettings({ enabled: value !== 'off', ...(value === 'off' ? {} : { detailMode: value }) })
          logVoiceSettings()
          void savePreferences(voiceModePreferences(value))
        }} />
        </Disclosure>
        {voiceEnabled && !isWorkoutVoiceAvailable() ? <Notice>当前运行环境未包含语音模块，安装完整 Android 版本后可使用播报。</Notice> : null}
        {voiceError ? <Text accessibilityLiveRegion="polite" style={{ color: theme.amberInk, fontSize: 13 }}>{voiceError}</Text> : null}
        {voiceSettingsSaveError ? <Notice tone="danger">{voiceSettingsSaveError}</Notice> : null}
        {workout.evidenceSaveError ? <Notice tone="danger">{workout.evidenceSaveError}</Notice> : null}
        {workout.backgroundServiceStopError ? <Notice tone="danger">{workout.backgroundServiceStopError}</Notice> : null}
        <BackgroundTrainingReadiness compact evidenceContext={workout.workout ? {
          workoutId: workout.workout.id, roundNumber: workout.currentRoundNumber,
          phase: workout.phase, startedAt: workout.workout.startedAt,
        } : undefined} />
        {/* D07b：计划阶段提示（热身/上爬/返回/恢复 + 剩余轮数） */}
        {workout.plan ? (
          <View style={styles.planRow}>
            <Pill>
              {workout.planPhase
                ? `阶段：${planPhaseLabel(workout.planPhase.kind)}`
                : workout.extraRounds
                  ? '阶段：自由加练'
                  : '阶段：计划已完成'}
            </Pill>
            <Text style={styles.planHint}>
              {workout.planPhase?.targetDurationMs !== undefined
                ? `目标 ${formatDuration(workout.planPhase.targetDurationMs)} · `
                : ''}
              {workout.planRemainingRounds === 'unknown'
                ? `第 ${workout.planRoundNumber} 轮`
                : workout.planRemainingRounds > 0
                  ? `第 ${workout.planRoundNumber} 轮 · 剩余 ${workout.planRemainingRounds} 轮`
                  : `第 ${workout.planRoundNumber} 轮 · 最后一轮`}
            </Text>
          </View>
        ) : null}

        {/* 目标达成提示 */}
        {workout.goalMessage ? (
          <Notice>
            {workout.goalMessage}。可完成本轮后结束，或继续加练。
          </Notice>
        ) : null}

        {/* 首次开张提示 */}
        {workout.firstRoundCalibration && !workout.templateGenerated && (
          <Notice>
            首次训练显示估算楼层，到终点后请确认实际楼层。
          </Notice>
        )}
        {workout.templateGenerated && workout.phase === 'round_complete' && (
          <Notice>
            路线模板已生成，后续轮次将对照模板识别。
          </Notice>
        )}

        {/* 各阶段内容 */}
        {/* D07b：热身阶段（round_ready + 计划处于 warmup）——不再自动开爬 */}
        {workout.phase === 'round_ready' && workout.planPhase?.kind === 'warmup' && (
          <WarmupView
            planName={workout.plan?.name ?? '训练计划'}
            roundNumber={workout.planRoundNumber}
            warmupElapsedMs={workout.timer.phaseElapsedMs}
            targetDurationMs={workout.planPhase.targetDurationMs}
            canSkip={workout.canSkipCurrentPlanPhase}
            onSkip={workout.skipCurrentPlanPhase}
            onStartClimb={workout.beginAscending}
            onFinish={handleFinishWorkout}
          />
        )}

        {/* D07b：计划走完（游标结束）时的收尾提示 */}
        {workout.phase === 'round_ready' && workout.plan && !workout.planPhase && (
          <PlanDoneView
            feedbackLines={workout.planFeedback?.lines ?? []}
            onContinueExtra={workout.startNextRound}
            onFinish={handleFinishWorkout}
          />
        )}

        {workout.phase === 'ascending' && (
          <AscendingView
            routeTpl={activeRouteTpl}
            snapshot={workout.roundSession.snapshot}
            visualization={workout.roundSession.visualization}
            barometerAvailable={workout.roundSession.barometerAvailable}
            floorCards={floorCards}
            summary={workout.summary}
            onFinish={handleFinishWorkout}
            onConfirmRoundComplete={workout.confirmCurrentRoundComplete}
            autoCompletePending={workout.roundSession.autoCompletePending}
            autoCompleteCountdown={workout.roundSession.autoCompleteCountdown}
            onCancelAutoComplete={workout.roundSession.cancelAutoComplete}
            onReachedLearningEndpoint={handleReachedLearningEndpoint}
            learningRoute={
              workout.firstRoundCalibration &&
              !workout.templateGenerated
            }
          />
        )}

        {workout.phase === 'round_complete' && (
          <RoundCompleteView
            round={workout.currentRound}
            previousRound={workout.previousRound}
            routeTpl={activeRouteTpl}
            onBeginReturn={workout.beginReturning}
            onFinish={handleFinishWorkout}
          />
        )}
        {workout.phase === 'ascending' ? <Disclosure title="楼层不对？"><Button title="修正当前楼层" variant="secondary" onPress={() => setConfirmMode('floor_anchor')} /></Disclosure> : null}

        {workout.phase === 'returning' && (
          <ReturningView
            round={workout.currentRound}
            routeTpl={activeRouteTpl}
            returnElapsedMs={workout.timer.phaseElapsedMs}
            returnConfirmationMode={returnConfirmationMode}
            relativeHeightM={workout.relativeHeightM}
            barometerAvailable={workout.returnBarometerAvailable}
            visualization={workout.returnVisualization}
            nearStart={workout.nearStart}
            onConfirmReturned={workout.confirmReturnedToStart}
            onFinish={handleFinishWorkout}
          />
        )}

        {workout.phase === 'start_confirmation' && (
          <StartConfirmationView
            startFloor={activeRouteTpl.startFloor}
            onConfirm={workout.confirmReturnedToStart}
            onNotYet={workout.notYetAtStart}
            onFinish={handleFinishWorkout}
          />
        )}

        {workout.phase === 'recovering' && (
          <RecoveringView
            roundNumber={workout.currentRoundNumber}
            nextRoundNumber={workout.currentRoundNumber + 1}
            recoveryElapsedMs={workout.timer.phaseElapsedMs}
            previousRound={workout.currentRound}
            summary={workout.summary}
            goalMessage={workout.goalMessage}
            planLines={workout.planFeedback?.lines ?? []}
            canSkipRest={
              workout.planPhase?.kind === 'recovery' &&
              workout.canSkipCurrentPlanPhase
            }
            onSkipRest={workout.skipCurrentPlanPhase}
            onStartNext={workout.startNextRound}
            onContinueExtra={workout.continueExtraRound}
            onFinish={handleFinishWorkout}
          />
        )}
        <Disclosure title="整次训练详情">
        {/* 顶部训练维度信息 */}
        <View style={styles.workoutHeader}>
          <View style={styles.workoutHeaderLeft}>
            <Text style={styles.roundLabel}>
              第 {workout.currentRoundNumber} 轮
            </Text>
            {effectiveGoal.type !== 'open' && (
              <Text style={styles.goalHint}>{describeGoal(effectiveGoal)}</Text>
            )}
          </View>
          <View style={styles.workoutHeaderRight}>
            <Text style={styles.elapsedText}>
              训练 {formatDuration(workout.timer.totalElapsedMs)}
            </Text>
            {workout.summary && workout.summary.activeDurationMs > 0 && (
              <Text style={styles.activeText}>
                净爬 {formatDuration(workout.summary.activeDurationMs)}
              </Text>
            )}
            {workout.summary && (workout.summary.warmupDurationMs ?? 0) > 0 ? (
              <Text style={styles.warmupText}>
                热身 {formatDuration(workout.summary.warmupDurationMs ?? 0)}
              </Text>
            ) : null}
            <Text style={styles.calorieText}>
              消耗 {formatCalories(liveCalories)} 千卡
            </Text>
          </View>
        </View>

        {/* 轮次轨道 */}
        <RoundTrack
          currentRound={workout.currentRoundNumber}
          completedRounds={workout.workout?.rounds ?? []}
          goal={effectiveGoal}
        />

        </Disclosure>
      </ScrollView>
      <View pointerEvents={savingWorkout ? 'none' : 'auto'} accessibilityState={{ busy: savingWorkout }} style={{ paddingHorizontal: theme.pagePaddingH, paddingTop: 8, paddingBottom: insets.bottom + 8, backgroundColor: theme.card, borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.lineSoft }}>
        {savingWorkout ? <Text accessibilityLiveRegion="polite" style={{ color: theme.muted, textAlign: 'center', paddingVertical: 8 }}>正在保存，请稍候…</Text> : null}
        {workout.phase === 'ascending' ? (
          <Button title="结束本轮 · 确认实际楼层" disabled={savingWorkout} onPress={() => openFinishConfirmation('finish_round')} />
        ) : workout.phase === 'round_complete' ? (
          <Button title={`返回 ${activeRouteTpl.startFloor} 层起点`} onPress={workout.beginReturning} />
        ) : workout.phase === 'returning' || workout.phase === 'start_confirmation' ? (
          <Button title={`我已回到 ${activeRouteTpl.startFloor} 层`} onPress={workout.confirmReturnedToStart} />
        ) : workout.phase === 'recovering' && !workout.goalMessage ? (
          <Button title={`开始第 ${workout.currentRoundNumber + 1} 轮`} onPress={workout.startNextRound} />
        ) : workout.phase === 'round_ready' && workout.planPhase?.kind === 'warmup' ? (
          <Button title="开始本轮爬楼" onPress={workout.beginAscending} />
        ) : (workout.phase === 'round_ready' && workout.plan && !workout.planPhase) || (workout.phase === 'recovering' && workout.goalMessage) ? (
          <Button title="完成训练" onPress={handleFinishWorkout} />
        ) : null}
        {workout.phase === 'ascending' && workout.roundSession.autoCompletePending ? (
          <Button title="撤销自动完成" variant="secondary" onPress={workout.roundSession.cancelAutoComplete} />
        ) : null}
        {workout.phase === 'start_confirmation' ? <Button title="还未到达起点" variant="secondary" onPress={workout.notYetAtStart} /> : null}
        {workout.phase === 'recovering' && !workout.goalMessage && workout.planPhase?.kind === 'recovery' && workout.canSkipCurrentPlanPhase ? (
          <Button title="跳过休息" variant="secondary" onPress={() => { workout.skipCurrentPlanPhase() }} />
        ) : null}
        {workout.phase === 'round_ready' && workout.planPhase?.kind === 'warmup' && workout.canSkipCurrentPlanPhase ? (
          <Button title="跳过热身" variant="secondary" onPress={() => { workout.skipCurrentPlanPhase() }} />
        ) : null}
        {(workout.phase === 'round_ready' && workout.plan && !workout.planPhase) || (workout.phase === 'recovering' && workout.goalMessage) ? (
          <Button title="继续加练" variant="secondary" onPress={workout.phase === 'recovering' ? workout.continueExtraRound : workout.startNextRound} />
        ) : (
          <Pressable accessibilityRole="button" onPress={handleFinishWorkout} style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 }}>
            <Text style={{ color: theme.mutedStrong, fontSize: 14 }}>结束训练</Text>
          </Pressable>
        )}
      </View>

      <FinishConfirmModal
        visible={confirmMode !== null}
        roundNumber={workout.currentRoundNumber}
        firstRoute={confirmMode === 'learning_endpoint'}
        purpose={confirmMode === 'floor_anchor' ? 'anchor' : confirmMode === 'finish_workout' ? 'workout' : 'round'}
        startFloor={activeRouteTpl.startFloor}
        automaticFloor={workout.roundSession.snapshot.currentFloor}
        targetFloor={activeRouteTpl.endFloor}
        saving={savingWorkout}
        onAction={handleConfirmFinish}
      />
    </View>
  )
}

// === 描述目标 ===
function describeGoal(goal: WorkoutGoal): string {
  switch (goal.type) {
    case 'open':
      return '自由训练'
    case 'rounds':
      return `目标 ${goal.targetRounds} 轮`
    case 'floors':
      return `目标 ${goal.targetFloors} 层`
    case 'ascent':
      return `目标 ${goal.targetAscentM} 米`
    case 'duration':
      return `净爬楼 ${Math.round(goal.targetActiveDurationMs / 60000)} 分钟`
  }
}

// === 占位模板（routeTpl 加载前使用） ===
const DUMMY_TEMPLATE: RouteTemplate = {
  id: '',
  name: '',
  startFloor: 1,
  endFloor: 1,
  carryMode: 'pocket',
  floorHeightM: 0,
  totalAscentM: 0,
  device: { platform: '', model: '', system: '' },
  segments: [],
  markers: [],
  createdAt: 0,
  updatedAt: 0,
  version: 0,
  status: 'draft',
}

// === 轮次轨道组件 ===
// 仅依赖轮次编号与完成状态，训练中的高频状态更新不应触发它重渲染。
const RoundTrack = memo(function RoundTrack({
  currentRound,
  completedRounds,
  goal,
}: {
  currentRound: number
  completedRounds: Array<{ roundNumber: number; complete: boolean }>
  goal: WorkoutGoal
}) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  const maxNodes = 8
  const targetRounds = goal.type === 'rounds' ? goal.targetRounds : 0
  // 自由训练或超过 8 轮：只显示最近几轮
  const showAll = targetRounds > 0 && targetRounds <= maxNodes
  const nodes: Array<{ number: number; state: 'done' | 'current' | 'pending' }> = []

  if (showAll) {
    for (let i = 1; i <= targetRounds; i++) {
      const round = completedRounds.find((r) => r.roundNumber === i)
      let state: 'done' | 'current' | 'pending' = 'pending'
      if (round?.complete) state = 'done'
      else if (i === currentRound) state = 'current'
      nodes.push({ number: i, state })
    }
  } else {
    // 显示已完成 + 当前轮
    const completed = completedRounds.filter((r) => r.complete)
    const showCount = Math.min(completed.length, maxNodes - 1)
    const startNum = currentRound - showCount
    for (let i = 0; i <= showCount; i++) {
      const num = startNum + i
      if (num < 1) continue
      const round = completedRounds.find((r) => r.roundNumber === num)
      let state: 'done' | 'current' | 'pending' = 'pending'
      if (round?.complete) state = 'done'
      else if (num === currentRound) state = 'current'
      nodes.push({ number: num, state })
    }
  }

  if (nodes.length === 0) return null

  return (
    <View style={styles.trackRow}>
      {nodes.map((node) => (
        <View key={node.number} style={styles.trackNodeWrap}>
          <View
            style={[
              styles.trackNode,
              node.state === 'done' && styles.trackNodeDone,
              node.state === 'current' && styles.trackNodeCurrent,
            ]}
          />
          <Text
            style={[
              styles.trackLabel,
              node.state === 'current' && styles.trackLabelCurrent,
            ]}
          >
            {node.number}
          </Text>
        </View>
      ))}
      {!showAll && (
        <Text style={styles.trackSummary}>
          已完成 {completedRounds.filter((r) => r.complete).length} 轮
        </Text>
      )}
    </View>
  )
})

// 高频状态（snapshot/visualization）驱动它重渲染时，
// 内部按各自数据变化的子组件（波形图/楼层格/指标）已独立 memo。
const AscendingView = memo(function AscendingView({
  routeTpl,
  snapshot,
  visualization,
  barometerAvailable,
  floorCards,
  summary,
  onFinish,
  onConfirmRoundComplete,
  autoCompletePending,
  autoCompleteCountdown,
  onCancelAutoComplete,
  onReachedLearningEndpoint,
  learningRoute,
}: {
  routeTpl: RouteTemplate
  snapshot: RecognitionSnapshot
  visualization: ReturnType<typeof useClimbWorkout>['roundSession']['visualization']
  barometerAvailable: boolean
  floorCards: FloorCard[]
  summary: { totalFloors: number; totalSteps: number; totalAscentM: number } | null
  onFinish: () => void
  onConfirmRoundComplete: () => Promise<boolean>
  autoCompletePending: boolean
  autoCompleteCountdown: number
  onCancelAutoComplete: () => void
  onReachedLearningEndpoint: () => void
  learningRoute: boolean
}) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  const [showWaveform, setShowWaveform] = useState(false)
  const { width, fontScale } = useWindowDimensions()
  const stacked = width < 360 || fontScale > 1.3
  const buildingFloors = useMemo(
    () =>
      buildRealtimeFloors(routeTpl.startFloor, snapshot.currentFloor, 0, 2, 5).filter(floor => learningRoute || floor.floor <= routeTpl.endFloor),
    [routeTpl.startFloor, routeTpl.endFloor, snapshot.currentFloor, learningRoute],
  )
  const achievedFloors = getFloorTransitionCount(
    routeTpl.startFloor,
    snapshot.currentFloor,
  )
  const targetFloors = getFloorTransitionCount(
    routeTpl.startFloor,
    routeTpl.endFloor,
  )
  const progressPercent = learningRoute
    ? undefined
    : Math.min(
        100,
        Math.round(
          (achievedFloors / Math.max(1, targetFloors)) * 100,
        ),
      )
  const recognitionLabel =
    snapshot.quality === 'invalid'
      ? '需要检查'
      : snapshot.statusReason === 'confirming_next_floor'
        ? '正在确认'
        : snapshot.quality === 'stable'
          ? '正在对照路线'
          : '暂时拿不准'
  return (
    <>
      <Disclosure title="本轮楼层与识别详情">
      <View style={{ flexDirection: stacked ? 'column' : 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 24 }}>
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`当前${snapshot.currentFloor}层，${recognitionLabel}，净爬楼${formatDuration(snapshot.activeMs)}`}
        style={[styles.floorHero, { flex: 1, alignItems: 'flex-start' }]}
      >
        <Text style={styles.floorHeroLabel}>
          当前楼层 · 估计
        </Text>
        <View style={styles.floorHeroValueRow}>
          <Text style={styles.floorHeroValue}>{snapshot.currentFloor}</Text>
          <Text style={styles.floorHeroUnit}>层</Text>
        </View>
        <Text style={styles.floorHeroStatus}>{recognitionLabel}</Text>
        <Text style={styles.floorHeroStatus}>从 {routeTpl.startFloor} 楼出发 · 估计爬升 {achievedFloors} 层</Text>
      </View>

      <StaircaseScene floors={buildingFloors} width={stacked ? 190 : Math.min(190, width * 0.46)} climbing />
      </View>
      <Text style={{ color: theme.mutedStrong, fontSize: 17, textAlign: 'center', marginVertical: 16 }}>本轮用时 {formatDuration(snapshot.activeMs)}</Text>
      {progressPercent !== undefined ? <View accessible accessibilityRole="progressbar" accessibilityLabel="本轮楼层进度" accessibilityValue={{ min: 0, max: 100, now: progressPercent }} style={{ height: 8, borderRadius: 4, backgroundColor: theme.surfaceSoft, marginBottom: 16, overflow: 'hidden' }}><View style={{ width: `${progressPercent}%`, height: 8, backgroundColor: theme.brand, borderRadius: 4 }} /></View> : null}
      {learningRoute ? <Text style={styles.confidenceLabel}>估算楼层 · 到终点后确认实际楼层</Text> : null}
      {snapshot.quality !== 'stable' ? <Notice>{snapshot.quality === 'invalid' ? '识别异常，请检查携带方式；结束时可确认实际楼层。' : '当前识别精度有限，楼层可能需要人工确认。'}</Notice> : null}
      {autoCompletePending ? <Notice>{autoCompleteCountdown} 秒后自动完成本轮；尚未到达时请撤销。</Notice> : null}
      <View style={styles.waveToggleRow}>
        <Pressable
          onPress={() => setShowWaveform((v) => !v)}
          style={[styles.waveToggle, showWaveform && styles.waveToggleActive]}
          accessibilityRole="button"
          accessibilityLabel={showWaveform ? '收起传感器波形' : '展开传感器波形'}
          accessibilityState={{ selected: showWaveform }}
        >
          <Text
            style={[
              styles.waveToggleText,
              showWaveform && styles.waveToggleTextActive,
            ]}
          >
            {showWaveform ? '收起波形' : '波形'}
          </Text>
        </Pressable>
      </View>

      {showWaveform ? (
        <SensorMotionVisualizer
          visualization={visualization}
          currentFloor={snapshot.currentFloor}
          startFloor={routeTpl.startFloor}
          endFloor={routeTpl.endFloor}
          barometerAvailable={barometerAvailable}
          routeLearning={learningRoute}
        />
      ) : null}

      <View style={styles.metricGrid}>
        <Metric
          label={learningRoute ? '估算爬升' : '本轮爬升'}
          value={
            learningRoute
              ? `${snapshot.ascentM.toFixed(1)}米`
              : `${achievedFloors} 层`
          }
          style={styles.metric}
        />
        <Metric
          label="净爬楼"
          value={formatDuration(snapshot.activeMs)}
          style={styles.metric}
        />
        <Metric label="本轮步数" value={snapshot.steps} style={styles.metric} />
      </View>

      <Card raised style={styles.statusCard}>
        <View style={styles.statusHead}>
          <Text style={styles.statusLabel}>
            {learningRoute ? '路线采集中' : '本轮进度'}
          </Text>
          <Pill tone={snapshot.status === 'complete' ? 'good' : 'default'}>
            {learningRoute ? '终点待确认' : `${progressPercent}%`}
          </Pill>
        </View>
        <Text style={styles.confidenceLabel}>
          {learningRoute
            ? `这里只显示传感器估算；到达真实终点后，由你确认实际楼层。`
            : snapshot.candidateFloor !== undefined
              ? `正在对照这条楼梯的脚步和转身 ${snapshot.candidateFloor} 层`
              : `${recognitionLabel} · 爬升 ${snapshot.ascentM.toFixed(1)}米`}
        </Text>
      </Card>

      {!learningRoute && (
        <>
          <Text style={styles.sectionLabel}>楼层进度</Text>
          <View style={styles.floorGrid}>
            {floorCards.map((card) => (
              <View
                key={card.floor}
                style={[
                  styles.floorChip,
                  card.state === 'done' && styles.floorChipDone,
                  card.state === 'current' && styles.floorChipCurrent,
                ]}
              >
                <Text
                  style={[
                    styles.floorChipText,
                    card.state === 'done' && styles.floorChipTextDone,
                    card.state === 'current' && styles.floorChipTextCurrent,
                  ]}
                >
                  {card.floor}层
                </Text>
                <Text
                  style={[
                    styles.floorChipSplit,
                    card.state === 'done' && styles.floorChipTextDone,
                  ]}
                >
                  {card.splitText}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* 整次训练累计 */}
      {summary && (
        <Card raised style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>本次训练累计</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryItem}>
              {summary.totalFloors} 层
            </Text>
            <Text style={styles.summaryItem}>
              {summary.totalSteps} 步
            </Text>
            <Text style={styles.summaryItem}>
              {summary.totalAscentM.toFixed(1)}米
            </Text>
          </View>
        </Card>
      )}

      </Disclosure>

    </>
  )
})

const RoundCompleteView = memo(function RoundCompleteView({
  round,
  previousRound,
  routeTpl,
  onBeginReturn,
  onFinish,
}: {
  round: { roundNumber: number; durationMs: number; steps: number; ascentM: number; complete: boolean; floorsCompleted: number; floorConfirmation?: 'manual' | 'automatic' | 'pending' } | null
  previousRound: { durationMs: number } | null
  routeTpl: RouteTemplate
  onBeginReturn: () => void
  onFinish: () => void
}) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  if (!round) return null
  const diff = previousRound ? round.durationMs - previousRound.durationMs : 0
  return (
    <>
      <Card raised style={styles.phaseCard}>
        <Text style={styles.phaseTitle}>
          第 {round.roundNumber} 轮{round.floorConfirmation === 'pending' ? '已保存，楼层待确认' : '完成'}
        </Text>
        <Text style={styles.phaseSubtitle}>
          {hasKnownRouteEnd(routeTpl)
            ? `${routeTpl.startFloor}层 → ${routeTpl.endFloor}层`
            : '本轮数据不足，路线终点仍待确认'}
        </Text>
        <Text style={styles.phaseSubtitle}>{round.floorConfirmation === 'pending' ? '估计 ' : ''}{round.floorsCompleted} 层 · {formatDuration(round.durationMs)}</Text>
        <Disclosure title="本轮成绩详情">
        <View style={styles.roundResultGrid}>
          <Metric label="本轮用时" value={formatDuration(round.durationMs)} style={styles.metric} />
          <Metric label="本轮步数" value={round.steps} style={styles.metric} />
          <Metric label="估计爬升" value={`${round.ascentM.toFixed(1)}米`} style={styles.metric} />
          <Metric label={round.floorConfirmation === 'pending' ? '估计楼层 · 待确认' : '本轮楼层'} value={`${round.floorsCompleted} 层`} style={styles.metric} />
        </View>
        </Disclosure>
        {previousRound ? (
          <Text style={styles.compareText}>
            {diff < 0
              ? `比上一轮快 ${formatDuration(Math.abs(diff))}`
              : diff > 0
                ? `比上一轮慢 ${formatDuration(diff)}`
                : '与上一轮用时相同'}
          </Text>
        ) : (
          <Text style={styles.compareText}>{round.floorConfirmation === 'pending' ? '首轮记录已保存，确认楼层后计入成绩' : '首轮成绩已记录'}</Text>
        )}
      </Card>


    </>
  )
})

const ReturningView = memo(function ReturningView({
  round,
  routeTpl,
  returnElapsedMs,
  returnConfirmationMode,
  relativeHeightM,
  barometerAvailable,
  visualization,
  nearStart,
  onConfirmReturned,
  onFinish,
}: {
  round: { roundNumber: number } | null
  routeTpl: RouteTemplate
  returnElapsedMs: number
  returnConfirmationMode: 'manual' | 'assisted'
  // 气压走势（不能判断当前楼层）（米）。正值=高于起点，0=回到起点。undefined=无气压计或未建立基线
  relativeHeightM: number | undefined
  // 返回阶段气压计是否可用
  barometerAvailable: boolean
  visualization: ReturnType<typeof useClimbWorkout>['returnVisualization']
  // 是否已接近起点
  nearStart: boolean
  onConfirmReturned: () => void
  onFinish: () => void
}) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  const estimatedFloor = routeTpl.startFloor
  return (
    <>

      <Card raised style={styles.phaseCard}>
        <Text style={styles.phaseTitle}>
          返回 {routeTpl.startFloor} 层起点中
        </Text>
        <Text style={styles.phaseSubtitle}>
          本阶段不计入爬楼成绩
        </Text>
        <View style={styles.returnIconRow}>
          <Text style={styles.returnIcon}>↓</Text>
          <Text style={styles.returnTime}>
            返回 {formatDuration(returnElapsedMs)}
          </Text>
        </View>
        {round && (
          <Text style={styles.returnHint}>
            第 {round.roundNumber + 1} 轮将在返回起点后开始
          </Text>
        )}
        <Disclosure title="返回详情">
      <SensorMotionVisualizer
        visualization={visualization}
        currentFloor={estimatedFloor}
        startFloor={routeTpl.startFloor}
        endFloor={routeTpl.endFloor}
        barometerAvailable={barometerAvailable}
        routeLearning={false}
        journey="returning"
      />
        {/* 气压辅助信息 */}
        {relativeHeightM !== undefined ? (
          <View style={styles.barometerInfo}>
            <Text style={styles.barometerLabel}>
              相对起点高度
            </Text>
            <Text style={[styles.barometerValue, nearStart && styles.barometerValueNear]}>
              {visualization.pressureDirection === 'down' ? '总体向下' : visualization.pressureDirection === 'up' ? '总体向上' : visualization.pressureDirection === 'level' ? '暂时平稳' : '还拿不准'}
            </Text>
            {nearStart && (
              <Text style={styles.barometerHint}>
                已接近起点高度
              </Text>
            )}
            {returnConfirmationMode === 'assisted' && !nearStart && (
              <Text style={styles.barometerHint}>
                到了 {routeTpl.startFloor} 楼，请点“确认返回”
              </Text>
            )}
          </View>
        ) : (
          <Text style={styles.returnHint}>
            {barometerAvailable
              ? '正在观察气压变化…'
              : `气压计不可用，请到达 ${routeTpl.startFloor} 层后手动确认`}
          </Text>
        )}
        </Disclosure>
      </Card>


    </>
  )
})

const StartConfirmationView = memo(function StartConfirmationView({
  startFloor,
  onConfirm,
  onNotYet,
  onFinish,
}: {
  startFloor: number
  onConfirm: () => void
  onNotYet: () => void
  onFinish: () => void
}) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  return (
    <>
      <Card raised style={styles.phaseCard}>
        <Text style={styles.phaseTitle}>检测到已接近 {startFloor} 层</Text>
        <Text style={styles.phaseSubtitle}>请确认当前位置</Text>
      </Card>



    </>
  )
})

const RecoveringView = memo(function RecoveringView({
  roundNumber,
  nextRoundNumber,
  recoveryElapsedMs,
  previousRound,
  summary,
  goalMessage,
  planLines,
  canSkipRest,
  onSkipRest,
  onStartNext,
  onContinueExtra,
  onFinish,
}: {
  roundNumber: number
  nextRoundNumber: number
  recoveryElapsedMs: number
  previousRound: { durationMs: number; steps: number; ascentM: number } | null
  summary: { bestRoundMs?: number; averageRoundMs?: number; totalAscentM: number; completeRounds: number } | null
  goalMessage: string
  planLines: string[]
  canSkipRest: boolean
  onSkipRest: () => boolean | void
  onStartNext: () => void
  onContinueExtra: () => void
  onFinish: () => void
}) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  return (
    <>
      <Card raised style={styles.phaseCard}>
        <Text style={styles.phaseTitle}>
          准备第 {nextRoundNumber} 轮
        </Text>
        <Text style={styles.phaseSubtitle}>
          休息时间 {formatDuration(recoveryElapsedMs)}
        </Text>
        <Disclosure title="已完成的训练">
        {previousRound && (
          <View style={styles.compareRow}>
            <Text style={styles.compareLabel}>上一轮</Text>
            <Text style={styles.compareValue}>
              {formatDuration(previousRound.durationMs)} · {previousRound.steps} 步
            </Text>
          </View>
        )}
        {summary && (
          <View style={styles.recoveryStats}>
            {summary.bestRoundMs !== undefined && (
              <Text style={styles.recoveryStat}>
                最快一轮 {formatDuration(summary.bestRoundMs)}
              </Text>
            )}
            {summary.averageRoundMs !== undefined && (
              <Text style={styles.recoveryStat}>
                平均一轮 {formatDuration(summary.averageRoundMs)}
              </Text>
            )}
            <Text style={styles.recoveryStat}>
              累计爬升 {summary.totalAscentM.toFixed(1)}米
            </Text>
          </View>
        )}
        {/* D07b：计划反馈只展示 buildPlanFeedback 的文案，休息时间不算上爬 */}
        {planLines.length > 0 ? (
          <View style={styles.recoveryStats}>
            {planLines.map((line) => (
              <Text key={line} style={styles.planFeedbackLine}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}
        </Disclosure>
      </Card>

    </>
  )
})

// === D07b：计划阶段视图（热身 / 计划走完） ===

// 热身阶段：不计入净爬楼成绩，可跳过。用户点「开始上爬」才算热身结束。
const WarmupView = memo(function WarmupView({
  planName,
  roundNumber,
  warmupElapsedMs,
  targetDurationMs,
  canSkip,
  onSkip,
  onStartClimb,
  onFinish,
}: {
  planName: string
  roundNumber: number
  warmupElapsedMs: number
  targetDurationMs?: number
  canSkip: boolean
  onSkip: () => boolean | void
  onStartClimb: () => void
  onFinish: () => void
}) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  return (
    <>
      <Card raised style={styles.phaseCard}>
        <Text style={styles.phaseTitle}>热身 · 第 {roundNumber} 轮</Text>
        <Text style={styles.phaseSubtitle}>
          已热身 {formatDuration(warmupElapsedMs)}
          {targetDurationMs !== undefined
            ? ` / 目标 ${formatDuration(targetDurationMs)}`
            : ''}
        </Text>
        <Text style={styles.phaseHint}>
          {planName}：热身时间不计入净爬楼成绩。准备好后开始本轮上爬。
        </Text>
      </Card>



    </>
  )
})

// 计划走完（阶段序列结束）：展示 buildPlanFeedback 的文案，由用户结束或自由加练。
const PlanDoneView = memo(function PlanDoneView({
  feedbackLines,
  onContinueExtra,
  onFinish,
}: {
  feedbackLines: string[]
  onContinueExtra: () => void
  onFinish: () => void
}) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  return (
    <>
      <Card raised style={styles.phaseCard}>
        <Text style={styles.phaseTitle}>计划已完成</Text>
        <Text style={styles.phaseSubtitle}>
          可以结束训练保存成绩，也可以继续自由加练
        </Text>
        {feedbackLines.map((line) => (
          <Text key={line} style={styles.planFeedbackLine}>
            {line}
          </Text>
        ))}
      </Card>


    </>
  )
})

function FinishConfirmModal({
  visible,
  roundNumber,
  firstRoute,
  startFloor,
  automaticFloor,
  targetFloor,
  purpose,
  saving,
  onAction,
}: {
  visible: boolean
  roundNumber: number
  firstRoute: boolean
  startFloor: number
  automaticFloor: number
  targetFloor: number
  purpose: 'round' | 'workout' | 'anchor'
  saving: boolean
  onAction: (
    action: 'save' | 'abnormal' | 'discard' | 'cancel',
    confirmedEndFloor?: number,
  ) => void
}) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  const [endFloorText, setEndFloorText] = useState(String(automaticFloor))
  const insets = useSafeAreaInsets()
  useEffect(() => {
    if (visible) setEndFloorText(String(Math.max(startFloor, automaticFloor)))
  }, [visible])
  const endFloor = Number(endFloorText)
  const validEndFloor = endFloorText.trim() !== '' && Number.isSafeInteger(endFloor) && endFloor >= startFloor
  const pickerTop = Math.max(startFloor + 60, automaticFloor + 10, targetFloor + 10)
  const choices = Array.from({ length: Math.min(200, pickerTop - startFloor + 1) }, (_, index) => startFloor + index)
  if (validEndFloor && !choices.includes(endFloor)) choices.push(endFloor)

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!saving) onAction('cancel') }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
        <View style={[styles.modalCard, { maxHeight: '95%', paddingBottom: Math.max(16, insets.bottom + 8) }]}>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }}>
          <Text style={styles.modalTitle}>
            {purpose === 'anchor' ? '记下当前实际楼层' : purpose === 'round' ? `结束第 ${roundNumber} 轮` : '结束本次训练'}
          </Text>
          <Text style={styles.modalBody}>应用估计在第 {automaticFloor} 楼。请看楼层标志，填入实际楼层。{purpose === 'anchor' ? '记好后继续爬，本轮不会结束。' : '以你确认的实际楼层保存。'}</Text>
          <Text style={styles.modalFieldLabel}>实际到达楼层</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TextInput
            accessibilityLabel="实际到达楼层，输入数字"
            value={endFloorText} onChangeText={setEndFloorText} keyboardType="number-pad"
            editable={!saving} placeholder={`起点 ${startFloor} 楼`} placeholderTextColor={theme.muted}
            style={[styles.modalInput, { flex: 1 }]} selectTextOnFocus returnKeyType="done" onSubmitEditing={Keyboard.dismiss}
          />
          <Host matchContents={{ vertical: true }} colorScheme={theme.isDark ? 'dark' : 'light'} seedColor={theme.brand} style={{ width: 144, minHeight: 56, marginVertical: 8 }}>
            <Picker testID="confirmed-end-floor" selectedValue={validEndFloor ? endFloor : Math.max(startFloor, automaticFloor)} onValueChange={floor => setEndFloorText(String(floor))} enabled={!saving} appearance="wheel">
              {choices.map(floor => <Picker.Item key={floor} label={`第 ${floor} 楼`} value={floor} />)}
            </Picker>
          </Host>
          </View>
          <Text style={[styles.modalBody, { marginTop: 10 }]}>{validEndFloor ? `从 ${startFloor} 楼到 ${endFloor} 楼 · 本轮爬升 ${getFloorTransitionCount(startFloor, endFloor)} 层` : `请输入不低于起点 ${startFloor} 楼的整数楼层。`}</Text>
        </ScrollView>
          <View style={styles.modalActionsVertical}>
            <Button title={saving ? '正在保存…' : purpose === 'anchor' ? '记下楼层，继续爬' : purpose === 'round' ? '确认楼层，结束本轮' : '确认楼层，保存并结束训练'} disabled={!validEndFloor || saving} onPress={() => { Keyboard.dismiss(); onAction('save', endFloor) }} />
            <Button
              title="继续爬"
              variant="secondary"
              disabled={saving}
              onPress={() => onAction('cancel')}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// === 样式 ===

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    checkpointWarn: {
      marginHorizontal: theme.pagePaddingH,
      marginTop: 8,
      padding: 10,
      borderRadius: theme.radiusSm,
      backgroundColor: theme.redSoft,
      borderWidth: 1,
      borderColor: theme.red,
    },
    checkpointWarnText: { color: theme.redInk, fontSize: 13, lineHeight: 18 },
    flex: { flex: 1 },
    content: { paddingHorizontal: theme.pagePaddingH },
    liveHero: { paddingVertical: 16, paddingHorizontal: 4 },
    liveHeroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    liveFloorRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 16 },
    liveFloorLabel: { color: theme.mutedStrong, fontSize: 13, lineHeight: 20 },
    liveFloorValue: { color: theme.ink, fontSize: 56, fontWeight: '700', fontVariant: ['tabular-nums'] },
    liveFloorUnit: { color: theme.mutedStrong, fontSize: 18, fontWeight: '400' },
    liveTarget: { color: theme.brandInk, fontSize: 15, fontWeight: '600', textAlign: 'right' },
    liveHint: { color: theme.mutedStrong, fontSize: 12, lineHeight: 18, textAlign: 'right' },
    liveRoute: { color: theme.mutedStrong, fontSize: 12, lineHeight: 18, marginTop: 8 },
    liveProgress: { height: 4, backgroundColor: theme.line, marginTop: 12, borderRadius: 2, overflow: 'hidden' },
    liveAutomation: { color: theme.mutedStrong, fontSize: 13, lineHeight: 20, marginTop: 12, paddingHorizontal: 4 },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    loadingText: { color: theme.muted, fontSize: 14, marginBottom: 12 },
    hero: { marginTop: 8, marginBottom: 16 },
    eyebrow: {
      color: theme.brand,
      fontSize: theme.fontEyebrow,
      fontWeight: '700',
      letterSpacing: 1.5,
    },
    title: {
      marginTop: 6,
      color: theme.ink,
      fontSize: theme.fontTitle,
      fontWeight: '700',
      lineHeight: 32,
    },
    subtitle: {
      marginTop: 6,
      color: theme.muted,
      fontSize: theme.fontSubtitle,
    },
    statusCard: { padding: 14, marginTop: 8 },
    statusLabel: {
      color: theme.muted,
      fontSize: 12,
    },
    statusHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    goalText: {
      marginTop: 6,
      color: theme.ink,
      fontSize: 16,
      fontWeight: '700',
    },
    confidenceLabel: {
      marginTop: 4,
      color: theme.muted,
      fontSize: 12,
    },
    // 顶部训练维度
    workoutHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginTop: 8,
      marginBottom: 8,
    },
    workoutHeaderLeft: { flex: 1 },
    workoutHeaderRight: { alignItems: 'flex-end' },
    roundLabel: {
      color: theme.ink,
      fontSize: 18,
      fontWeight: '800',
    },
    goalHint: {
      marginTop: 2,
      color: theme.muted,
      fontSize: 12,
    },
    elapsedText: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '700',
    },
    activeText: {
      marginTop: 2,
      color: theme.brand,
      fontSize: 12,
      fontWeight: '600',
    },
    // D07b：热身净时长（与净爬楼分开展示：休息不算上爬）
    warmupText: {
      marginTop: 2,
      color: theme.muted,
      fontSize: 12,
      fontWeight: '600',
    },
    // D07b：计划阶段提示行
    planRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
      flexWrap: 'wrap',
    },
    planHint: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '600',
    },
    planFeedbackLine: {
      marginTop: 4,
      color: theme.muted,
      fontSize: 12,
      lineHeight: 18,
    },
    calorieText: {
      marginTop: 2,
      color: theme.orange,
      fontSize: 12,
      fontWeight: '800',
    },
    // 轮次轨道
    trackRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 12,
      flexWrap: 'wrap',
    },
    trackNodeWrap: {
      alignItems: 'center',
      gap: 3,
    },
    trackNode: {
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 2,
      borderColor: theme.line,
      backgroundColor: theme.card,
    },
    trackNodeDone: {
      backgroundColor: theme.brand,
      borderColor: theme.brand,
    },
    trackNodeCurrent: {
      backgroundColor: theme.brandSoft,
      borderColor: theme.brand,
      shadowColor: theme.brand,
      shadowOpacity: 0.4,
      shadowOffset: { width: 0, height: 0 },
      shadowRadius: 6,
      elevation: 3,
    },
    trackLabel: {
      color: theme.muted,
      fontSize: 10,
      fontWeight: '600',
    },
    trackLabelCurrent: {
      color: theme.brand,
    },
    trackSummary: {
      color: theme.muted,
      fontSize: 11,
      marginLeft: 4,
    },
    // 阶段卡片
    phaseCard: {
      padding: 18,
      marginTop: 4,
      marginBottom: 8,
    },
    phaseTitle: {
      color: theme.ink,
      fontSize: 20,
      fontWeight: '800',
    },
    phaseSubtitle: {
      marginTop: 6,
      color: theme.muted,
      fontSize: 13,
    },
    // D07b：阶段说明（热身不计入成绩等）
    phaseHint: {
      marginTop: 8,
      color: theme.muted,
      fontSize: 12,
      lineHeight: 18,
    },
    firstRoundHint: {
      marginTop: 10,
      color: theme.muted,
      fontSize: 12,
      fontStyle: 'italic',
    },
    // 对比行
    compareRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 12,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line,
    },
    compareLabel: {
      color: theme.muted,
      fontSize: 13,
    },
    compareValue: {
      color: theme.ink,
      fontSize: 13,
      fontWeight: '700',
    },
    compareText: {
      marginTop: 10,
      color: theme.brand,
      fontSize: 14,
      fontWeight: '700',
      textAlign: 'center',
    },
    // 指标
    floorHero: {
      alignItems: 'center',
      paddingVertical: 24,
    },
    floorHeroLabel: {
      color: theme.ink,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
    },
    floorHeroValueRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 7,
    },
    floorHeroValue: {
      color: theme.ink,
      fontSize: 76,
      fontWeight: '900',
      fontVariant: ['tabular-nums'],
    },
    floorHeroUnit: { color: theme.ink, fontSize: 20, fontWeight: '800' },
    floorHeroStatus: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '800',
    },
    metricGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 8,
    },
    metric: { flex: 1, minWidth: '45%' },
    // 楼层
    sectionLabel: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
      marginTop: 16,
      marginBottom: 8,
      paddingHorizontal: 4,
    },
    floorGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginBottom: 8,
    },
    floorChip: {
      width: '31%',
      backgroundColor: theme.card,
      borderRadius: theme.radiusMd,
      padding: 10,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
    },
    floorChipDone: {
      backgroundColor: theme.brandSoft,
      borderColor: theme.brandSoft,
    },
    floorChipCurrent: {
      backgroundColor: theme.brand,
      borderColor: theme.brand,
    },
    floorChipText: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '700',
    },
    floorChipTextDone: {
      color: theme.brand,
    },
    floorChipTextCurrent: {
      color: theme.card,
    },
    floorChipSplit: {
      marginTop: 2,
      color: theme.muted,
      fontSize: 11,
    },
    // 汇总卡
    summaryCard: {
      padding: 14,
      marginTop: 8,
    },
    summaryTitle: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '700',
      marginBottom: 8,
    },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    summaryItem: {
      color: theme.ink,
      fontSize: 15,
      fontWeight: '700',
    },
    // 轮次完成
    roundResultGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 12,
    },
    // 返回阶段
    returnIconRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      marginTop: 20,
    },
    returnIcon: {
      color: theme.infoInk,
      fontSize: 36,
      fontWeight: '900',
    },
    returnTime: {
      color: theme.infoInk,
      fontSize: 18,
      fontWeight: '700',
    },
    returnHint: {
      marginTop: 10,
      color: theme.muted,
      fontSize: 12,
      textAlign: 'center',
    },
    // 气压辅助信息（返回阶段）
    barometerInfo: {
      alignItems: 'center',
      marginTop: 16,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      backgroundColor: theme.cardSoft,
    },
    barometerLabel: {
      color: theme.muted,
      fontSize: 12,
      marginBottom: 4,
    },
    barometerValue: {
      color: theme.infoInk,
      fontSize: 28,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    barometerValueNear: {
      color: theme.brand,
    },
    barometerHint: {
      marginTop: 6,
      color: theme.muted,
      fontSize: 12,
      textAlign: 'center',
    },
    // 恢复阶段
    recoveryStats: {
      marginTop: 12,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line,
      gap: 4,
    },
    recoveryStat: {
      color: theme.muted,
      fontSize: 13,
    },
    // 完成过渡
    completeTitle: {
      color: theme.brand,
      fontSize: 28,
      fontWeight: '900',
      marginBottom: 8,
    },
    completeSubtitle: {
      color: theme.ink,
      fontSize: 16,
      fontWeight: '600',
    },
    buildingWrap: {
      alignItems: 'center',
      marginTop: 4,
      marginBottom: 8,
    },
    waveToggleRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: 8,
      marginBottom: 2,
    },
    waveToggle: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      backgroundColor: theme.card,
    },
    waveToggleActive: {
      backgroundColor: theme.brandSoft,
      borderColor: theme.brandSoft,
    },
    waveToggleText: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '700',
    },
    waveToggleTextActive: {
      color: theme.brand,
    },
    completePage: {
      flex: 1,
      backgroundColor: theme.paper,
    },
    completeCenter: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    completeFloorStack: {
      width: 168,
      gap: 5,
      marginVertical: 28,
      alignItems: 'stretch',
    },
    completeFloorBarTrack: {
      height: 10,
      borderRadius: 3,
      backgroundColor: theme.surfaceSoft,
      overflow: 'hidden',
    },
    completeFloorBar: {
      flex: 1,
      borderRadius: 3,
      backgroundColor: theme.brand,
    },
    completeNumberRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 6,
    },
    completeNumber: {
      color: theme.brand,
      fontSize: 64,
      lineHeight: 72,
      fontWeight: '900',
      fontVariant: ['tabular-nums'],
    },
    completeUnit: {
      color: theme.brand,
      fontSize: 18,
      fontWeight: '800',
    },
    completeStatRow: {
      flexDirection: 'row',
      gap: 20,
      marginTop: 14,
    },
    completeStat: {
      color: theme.ink,
      fontSize: 15,
      fontWeight: '700',
    },
    completeHint: {
      marginTop: 32,
      color: theme.muted,
      fontSize: 12,
    },
    // 弹窗
    modalOverlay: {
      flex: 1,
      backgroundColor: theme.scrim,
      justifyContent: 'flex-end',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingTop: 24,
    },
    modalCard: {
      width: '100%',
      backgroundColor: theme.card,
      borderTopLeftRadius: theme.radiusXl,
      borderTopRightRadius: theme.radiusXl,
      padding: 20,
    },
    modalTitle: {
      color: theme.ink,
      fontSize: 22,
      fontWeight: '700',
      marginBottom: 10,
    },
    modalBody: {
      color: theme.mutedStrong,
      fontSize: 14,
      lineHeight: 21,
      marginBottom: 12,
    },
    modalFieldLabel: {
      marginTop: 14,
      color: theme.muted,
      fontSize: 12,
      fontWeight: '700',
    },
    modalInput: {
      marginTop: 6,
      minHeight: 56,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: theme.line,
      borderRadius: theme.radiusMd,
      paddingHorizontal: 14,
      color: theme.ink,
      backgroundColor: theme.cardSoft,
      fontSize: 18,
      fontWeight: '700',
    },
    modalActions: {
      flexDirection: 'row',
      gap: 10,
    },
    modalActionsVertical: {
      gap: 8,
    },
    modalBtn: {
      flex: 1,
      marginTop: 0,
    },
    // D07b：完成仪式里的计划反馈文案
    completePlanBox: {
      marginTop: 12,
      paddingHorizontal: 8,
      alignItems: 'center',
    },
    completePlanLine: {
      marginTop: 3,
      color: theme.muted,
      fontSize: 12,
      textAlign: 'center',
    },
  })
