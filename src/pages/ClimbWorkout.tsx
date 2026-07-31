// 多轮训练主页面：一个容器页面管理整次训练的所有阶段。
// 阶段：round_ready → ascending → round_complete → returning → recovering → 下一轮
//       → returning → start_confirmation → recovering → 下一轮
// 用户主动结束 → workout_complete → 跳转 WorkoutResult

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  BackHandler,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
} from 'expo-keep-awake'

import { Header } from '../components/Header'
import { SensorMotionVisualizer } from '../components/sensor-motion-visualizer'
import { Button, Card, Metric, Notice, Pill } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import { getRoute } from '../services/storage'
import { loadActiveCheckpoint } from '../services/workout-storage'
import { RouteTemplate, WorkoutGoal } from '../core/types'
import { formatDuration } from '../core/math'
import { useClimbWorkout } from '../hooks/useClimbWorkout'
import { hasKnownRouteEnd } from '../core/route-state'
import { getFloorAchievementCount } from '../core/floors'
import {
  calculateStairCalories,
  DEFAULT_BODY_WEIGHT_KG,
  formatCalories,
} from '../core/calories'
import { getPreferences } from '../services/preferences'

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
  const { id, goal, returnConfirmationMode } = route.params

  const [routeTpl, setRouteTpl] = useState<RouteTemplate | null>(null)
  const [loadError, setLoadError] = useState('')
  const [bodyWeightKg, setBodyWeightKg] = useState(DEFAULT_BODY_WEIGHT_KG)
  const [confirmMode, setConfirmMode] = useState<
    'finish_workout' | 'learning_endpoint' | null
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
      .then((prefs) => setBodyWeightKg(prefs.bodyWeightKg))
      .catch(() => undefined)
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
  const workout = useClimbWorkout({
    template: routeTpl ?? DUMMY_TEMPLATE,
    goal: effectiveGoal,
    returnConfirmationMode,
  })
  const activeRouteTpl = workout.activeTemplate
  const liveActiveDurationMs =
    (workout.summary?.activeDurationMs ?? 0) +
    (workout.phase === 'ascending' ? workout.roundSession.elapsedMs : 0)
  const liveCalories = calculateStairCalories(
    liveActiveDurationMs,
    bodyWeightKg,
  )

  // 进入页面后直接恢复或开始训练，不再显示二次确认页。
  const launchAttemptedRef = useRef(false)
  useEffect(() => {
    if (
      !routeTpl ||
      launchAttemptedRef.current ||
      workout.phase !== 'setup'
    ) {
      return
    }
    launchAttemptedRef.current = true

    const launch = async () => {
      try {
        const checkpoint = await loadActiveCheckpoint()
        if (checkpoint?.templateId === id) {
          workout.resumeFromCheckpoint(checkpoint, routeTpl)
          return
        }
      } catch (err) {
        console.warn('[ClimbWorkout] resume checkpoint failed', err)
      }

      workout.startWorkout()
    }

    launch()
  }, [
    id,
    routeTpl,
    workout.phase,
    workout.resumeFromCheckpoint,
    workout.startWorkout,
  ])

  // workout_complete 时跳转结果页
  useEffect(() => {
    if (workout.phase === 'workout_complete' && workout.workout) {
      const w = workout.workout
      // 延迟跳转，让用户看到完成动画
      const timer = setTimeout(() => {
        navigation.replace('WorkoutResult', { id: w.id })
      }, 800)
      return () => clearTimeout(timer)
    }
  }, [workout.phase, workout.workout, navigation])

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
  useEffect(() => {
    if (workout.phase !== 'round_ready') return
    workout.beginAscending()
  }, [
    workout.phase,
    workout.beginAscending,
  ])

  const handleFinishWorkout = () => {
    const phase = workout.phase
    if (phase === 'ascending') {
      setConfirmMode('finish_workout')
      return
    }
    // 其他阶段直接结束
    workout.finishWorkout({ saveIncompleteRound: false })
  }

  const handleConfirmFinish = async (
    action: 'save' | 'abnormal' | 'discard' | 'cancel',
    confirmedEndFloor?: number,
  ) => {
    const mode = confirmMode
    setConfirmMode(null)
    if (action === 'cancel') return
    if (
      mode === 'learning_endpoint' &&
      action === 'save' &&
      confirmedEndFloor !== undefined
    ) {
      await workout.completeLearningRound(confirmedEndFloor)
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
  }

  const handleReachedLearningEndpoint = () => {
    setConfirmMode('learning_endpoint')
  }

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

  // workout_complete 阶段：显示完成过渡
  if (workout.phase === 'workout_complete') {
    return (
      <View style={styles.page}>
        <Header title="训练完成" back={false} />
        <View style={styles.center}>
          <Text style={styles.completeTitle}>训练完成</Text>
          {workout.summary && (
            <Text style={styles.completeSubtitle}>
              {workout.summary.completeRounds} 轮 ·{' '}
              {workout.summary.totalFloors} 层 ·{' '}
              {workout.summary.totalAscentM.toFixed(1)}米
            </Text>
          )}
        </View>
      </View>
    )
  }

  // 主训练界面：根据阶段渲染不同内容
  return (
    <View style={styles.page}>
      <Header title="爬楼训练" back={false} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
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

        {/* 目标达成提示 */}
        {workout.goalMessage ? (
          <Notice>
            {workout.goalMessage}。可完成本轮后结束，或继续加练。
          </Notice>
        ) : null}

        {/* 首次开张提示 */}
        {workout.firstRoundCalibration && !workout.templateGenerated && (
          <Notice>
            首次开张模式：本轮用气压计估楼层，结束后自动生成模板。
          </Notice>
        )}
        {workout.templateGenerated && (
          <Notice>
            路线模板已生成，后续轮次将对照模板识别。
          </Notice>
        )}

        {/* 各阶段内容 */}
        {workout.phase === 'ascending' && (
          <AscendingView
            routeTpl={activeRouteTpl}
            snapshot={workout.roundSession.snapshot}
            elapsedMs={workout.roundSession.elapsedMs}
            visualization={workout.roundSession.visualization}
            barometerAvailable={workout.roundSession.barometerAvailable}
            floorCards={floorCards}
            summary={workout.summary}
            onFinish={handleFinishWorkout}
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
            onStartNext={workout.startNextRound}
            onContinueExtra={workout.continueExtraRound}
            onFinish={handleFinishWorkout}
          />
        )}
      </ScrollView>

      <FinishConfirmModal
        visible={confirmMode !== null}
        roundNumber={workout.currentRoundNumber}
        firstRoute={confirmMode === 'learning_endpoint'}
        startFloor={activeRouteTpl.startFloor}
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
function RoundTrack({
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
}

// === 各阶段视图组件 ===

function AscendingView({
  routeTpl,
  snapshot,
  elapsedMs,
  visualization,
  barometerAvailable,
  floorCards,
  summary,
  onFinish,
  onReachedLearningEndpoint,
  learningRoute,
}: {
  routeTpl: RouteTemplate
  snapshot: { currentFloor: number; floorsCompleted: number; ascentM: number; steps: number; confidence: number; status: string }
  elapsedMs: number
  visualization: ReturnType<typeof useClimbWorkout>['roundSession']['visualization']
  barometerAvailable: boolean
  floorCards: FloorCard[]
  summary: { totalFloors: number; totalSteps: number; totalAscentM: number } | null
  onFinish: () => void
  onReachedLearningEndpoint: () => void
  learningRoute: boolean
}) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  const achievedFloors = getFloorAchievementCount(
    routeTpl.startFloor,
    snapshot.currentFloor,
  )
  const targetFloors = getFloorAchievementCount(
    routeTpl.startFloor,
    routeTpl.endFloor,
  )
  const progressPercent = learningRoute
    ? undefined
    : Math.min(
        100,
        Math.round(
          (Math.max(1, achievedFloors) / Math.max(1, targetFloors)) * 100,
        ),
      )
  return (
    <>
      <SensorMotionVisualizer
        visualization={visualization}
        currentFloor={snapshot.currentFloor}
        startFloor={routeTpl.startFloor}
        endFloor={routeTpl.endFloor}
        barometerAvailable={barometerAvailable}
        routeLearning={learningRoute}
      />

      <View style={styles.metricGrid}>
        <Metric
          label={learningRoute ? '估算位置' : '当前楼层'}
          value={
            learningRoute
              ? `${snapshot.currentFloor}层附近`
              : `${snapshot.currentFloor}层`
          }
          style={styles.metric}
        />
        <Metric
          label={learningRoute ? '估算爬升' : '本轮已爬'}
          value={
            learningRoute
              ? `${snapshot.ascentM.toFixed(1)}米`
              : `${Math.max(1, achievedFloors)} 层`
          }
          style={styles.metric}
        />
        <Metric label="本轮用时" value={formatDuration(elapsedMs)} style={styles.metric} />
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
            : `置信度 ${Math.round(snapshot.confidence * 100)}% · 爬升 ${snapshot.ascentM.toFixed(1)}米`}
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

      {learningRoute ? (
        <>
          <Button
            title="我已到达真实终点"
            onPress={onReachedLearningEndpoint}
          />
          <Button
            title="提前结束训练"
            variant="secondary"
            onPress={onFinish}
          />
        </>
      ) : (
        <Button
          title="结束训练"
          variant="secondary"
          onPress={onFinish}
        />
      )}
    </>
  )
}

function RoundCompleteView({
  round,
  previousRound,
  routeTpl,
  onBeginReturn,
  onFinish,
}: {
  round: { roundNumber: number; durationMs: number; steps: number; ascentM: number; complete: boolean; floorsCompleted: number } | null
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
          第 {round.roundNumber} 轮完成
        </Text>
        <Text style={styles.phaseSubtitle}>
          {hasKnownRouteEnd(routeTpl)
            ? `${routeTpl.startFloor}层 → ${routeTpl.endFloor}层`
            : '本轮数据不足，路线终点仍待确认'}
        </Text>
        <View style={styles.roundResultGrid}>
          <Metric label="本轮用时" value={formatDuration(round.durationMs)} style={styles.metric} />
          <Metric label="本轮步数" value={round.steps} style={styles.metric} />
          <Metric label="本轮爬升" value={`${round.ascentM.toFixed(1)}米`} style={styles.metric} />
          <Metric label="本轮楼层" value={`${round.floorsCompleted} 层`} style={styles.metric} />
        </View>
        {previousRound ? (
          <Text style={styles.compareText}>
            {diff < 0
              ? `比上一轮快 ${formatDuration(Math.abs(diff))}`
              : diff > 0
                ? `比上一轮慢 ${formatDuration(diff)}`
                : '与上一轮用时相同'}
          </Text>
        ) : (
          <Text style={styles.compareText}>首轮成绩已记录</Text>
        )}
      </Card>
      <Button title="开始返回1层" onPress={onBeginReturn} />
      <Button title="结束训练" variant="secondary" onPress={onFinish} />
    </>
  )
}

function ReturningView({
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
  // 相对起点高度（米）。正值=高于起点，0=回到起点。undefined=无气压计或未建立基线
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
  const rawEstimatedFloor =
    routeTpl.startFloor + Math.round((relativeHeightM ?? 0) / 3)
  const estimatedFloor = hasKnownRouteEnd(routeTpl)
    ? Math.max(
        routeTpl.startFloor,
        Math.min(routeTpl.endFloor, rawEstimatedFloor),
      )
    : Math.max(routeTpl.startFloor, rawEstimatedFloor)
  return (
    <>
      <SensorMotionVisualizer
        visualization={visualization}
        currentFloor={estimatedFloor}
        startFloor={routeTpl.startFloor}
        endFloor={routeTpl.endFloor}
        barometerAvailable={barometerAvailable}
        routeLearning={false}
        journey="returning"
      />

      <Card raised style={styles.phaseCard}>
        <Text style={styles.phaseTitle}>
          返回1层中
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
        {/* 气压辅助信息 */}
        {relativeHeightM !== undefined ? (
          <View style={styles.barometerInfo}>
            <Text style={styles.barometerLabel}>
              相对起点高度
            </Text>
            <Text style={[styles.barometerValue, nearStart && styles.barometerValueNear]}>
              {relativeHeightM > 0 ? '+' : ''}
              {relativeHeightM.toFixed(1)}米
            </Text>
            {nearStart && (
              <Text style={styles.barometerHint}>
                已接近起点高度
              </Text>
            )}
            {returnConfirmationMode === 'assisted' && !nearStart && (
              <Text style={styles.barometerHint}>
                接近1层时将自动提示
              </Text>
            )}
          </View>
        ) : (
          <Text style={styles.returnHint}>
            {barometerAvailable
              ? '正在建立气压基线…'
              : '气压计不可用，请到达1层后手动确认'}
          </Text>
        )}
      </Card>
      <Button title="我已回到1层" onPress={onConfirmReturned} />
      <Button title="结束训练" variant="secondary" onPress={onFinish} />
    </>
  )
}

function StartConfirmationView({
  onConfirm,
  onNotYet,
  onFinish,
}: {
  onConfirm: () => void
  onNotYet: () => void
  onFinish: () => void
}) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  return (
    <>
      <Card raised style={styles.phaseCard}>
        <Text style={styles.phaseTitle}>检测到已接近1层</Text>
        <Text style={styles.phaseSubtitle}>请确认当前位置</Text>
      </Card>
      <Button title="我已到达1层" onPress={onConfirm} />
      <Button title="还没有" variant="secondary" onPress={onNotYet} />
      <Button title="结束训练" variant="secondary" onPress={onFinish} />
    </>
  )
}

function RecoveringView({
  roundNumber,
  nextRoundNumber,
  recoveryElapsedMs,
  previousRound,
  summary,
  goalMessage,
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
      </Card>

      {goalMessage ? (
        <>
          <Notice>{goalMessage}</Notice>
          <Button title="继续加练" onPress={onContinueExtra} />
          <Button title="完成训练" variant="secondary" onPress={onFinish} />
        </>
      ) : (
        <>
          <Button title={`开始第 ${nextRoundNumber} 轮`} onPress={onStartNext} />
          <Button title="结束训练" variant="secondary" onPress={onFinish} />
        </>
      )}
    </>
  )
}

// === 弹窗组件 ===

function FinishConfirmModal({
  visible,
  roundNumber,
  firstRoute,
  startFloor,
  onAction,
}: {
  visible: boolean
  roundNumber: number
  firstRoute: boolean
  startFloor: number
  onAction: (
    action: 'save' | 'abnormal' | 'discard' | 'cancel',
    confirmedEndFloor?: number,
  ) => void
}) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  const [endFloorText, setEndFloorText] = useState('')
  useEffect(() => {
    if (visible) setEndFloorText('')
  }, [visible])
  const endFloor = Number.parseInt(endFloorText, 10)
  const validEndFloor = Number.isFinite(endFloor) && endFloor > startFloor

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onAction('cancel')}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>
            {firstRoute ? '确认首次采集终点' : '结束本次训练？'}
          </Text>
          {firstRoute ? (
            <>
              <Text style={styles.modalBody}>
                看一眼楼层标牌，告诉应用实际到达了几楼。正常数据会加入这条路线的学习。
              </Text>
              <Text style={styles.modalFieldLabel}>实际终点楼层</Text>
              <TextInput
                value={endFloorText}
                onChangeText={setEndFloorText}
                keyboardType="number-pad"
                placeholder={`必须高于 ${startFloor} 楼`}
                placeholderTextColor={theme.muted}
                style={styles.modalInput}
                autoFocus
              />
            </>
          ) : (
            <Text style={styles.modalBody}>
              当前第 {roundNumber} 轮尚未完成。{'\n'}可以保存前几轮完整成绩，并将当前轮记录为未完成。
            </Text>
          )}
          <View style={styles.modalActionsVertical}>
            {firstRoute ? (
              <>
                <Button
                  title="确认楼层，保存采集"
                  disabled={!validEndFloor}
                  onPress={() => onAction('save', endFloor)}
                />
                <Button
                  title="本轮有异常，只保存记录"
                  variant="secondary"
                  onPress={() => onAction('abnormal')}
                />
              </>
            ) : (
              <>
                <Button title="保存并结束" onPress={() => onAction('save')} />
                <Button
                  title="放弃当前轮并结束"
                  variant="secondary"
                  onPress={() => onAction('discard')}
                />
              </>
            )}
            <Button
              title={firstRoute ? '继续采集' : '继续爬'}
              variant="secondary"
              onPress={() => onAction('cancel')}
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}

// === 样式 ===

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: theme.pagePaddingH },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    loadingText: { color: theme.muted, fontSize: 14, marginBottom: 12 },
    hero: { marginTop: 8, marginBottom: 16 },
    eyebrow: {
      color: theme.green,
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
      color: theme.green,
      fontSize: 12,
      fontWeight: '600',
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
      backgroundColor: theme.green,
      borderColor: theme.green,
    },
    trackNodeCurrent: {
      backgroundColor: theme.greenSoft,
      borderColor: theme.green,
      shadowColor: theme.green,
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
      color: theme.green,
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
      color: theme.green,
      fontSize: 14,
      fontWeight: '700',
      textAlign: 'center',
    },
    // 指标
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
      backgroundColor: theme.greenSoft,
      borderColor: theme.greenSoft,
    },
    floorChipCurrent: {
      backgroundColor: theme.green,
      borderColor: theme.green,
    },
    floorChipText: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '700',
    },
    floorChipTextDone: {
      color: theme.green,
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
      color: theme.blueInk,
      fontSize: 36,
      fontWeight: '900',
    },
    returnTime: {
      color: theme.blueInk,
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
      color: theme.blueInk,
      fontSize: 28,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    barometerValueNear: {
      color: theme.green,
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
      color: theme.green,
      fontSize: 28,
      fontWeight: '900',
      marginBottom: 8,
    },
    completeSubtitle: {
      color: theme.ink,
      fontSize: 16,
      fontWeight: '600',
    },
    // 弹窗
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 28,
    },
    modalCard: {
      width: '100%',
      backgroundColor: theme.card,
      borderRadius: theme.radiusMd,
      padding: 20,
    },
    modalTitle: {
      color: theme.ink,
      fontSize: 17,
      fontWeight: '700',
      marginBottom: 10,
    },
    modalBody: {
      color: theme.muted,
      fontSize: 14,
      lineHeight: 21,
      marginBottom: 18,
    },
    modalFieldLabel: {
      marginTop: 14,
      color: theme.muted,
      fontSize: 12,
      fontWeight: '700',
    },
    modalInput: {
      marginTop: 6,
      height: 48,
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
  })
