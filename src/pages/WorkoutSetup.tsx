// 训练设置页：用户选择训练目标和轮间确认方式后进入正式训练。
// 导航流程：RouteEdit/RouteProfile → WorkoutSetup → ClimbWorkout
// 快速开练（D05，无地点/无既有模板）走 QuickStart → ClimbWorkout，不经过本页。
// 本页不再把「缺少建筑起点位置」当作阻塞：地点是可选项，页面只做说明。

import React, { useEffect, useMemo, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { isRoutePrepared } from '../core/route-preparation'
import { Header } from '../components/Header'
import { Button, Notice } from '../components/ui'
import { Disclosure } from '../components/disclosure'
import { TrackingModeSelector } from '../components/tracking-mode-selector'
import { NativeChoice } from '../components/native-choice'
import { getPreferences, savePreferences } from '../services/preferences'
import { confirmBackgroundRecording } from '../services/workout-entry'
import { loadActiveCheckpoint } from '../services/workout-storage'
import { describeWorkoutGoal, restoreWorkoutSetup, SavedWorkoutSetup } from '../core/workout-setup'
import { useTheme, Theme } from '../theme'
import { RootStackParamList, RootStackScreen } from '../navigation/types'
import { getRoute } from '../services/storage'
import { isPrivacyAgreed } from '../services/privacy'
import { listWorkouts } from '../services/workout-storage'
import { summarizeRouteLearning } from '../core/route-learning'
import {
  RouteTemplate,
  WorkoutGoal,
  WorkoutGoalType,
  WorkoutPlan,
  TrackingMode,
} from '../core/types'
import {
  buildPlanFromGoal,
  describePlanStructure,
} from '../core/workout-plan'
import {
  getKnownFloorsPerRound,
  hasKnownRouteEnd,
} from '../core/route-state'
import { evaluateWorkoutPreflight } from '../core/preflight'

type TrainingMode = 'open' | 'rounds' | 'cumulative'
type CumulativeGoalType = Exclude<WorkoutGoalType, 'open' | 'rounds'>

const TRAINING_MODES: Array<{
  key: TrainingMode
  label: string
  desc: string
}> = [
  { key: 'open', label: '自由训练', desc: '不设目标，一轮一轮持续训练' },
  { key: 'rounds', label: '按轮数', desc: '例如目标 5 轮' },
  {
    key: 'cumulative',
    label: '累计目标',
    desc: '可按累计楼层、爬升高度或净爬楼时间',
  },
]

const CUMULATIVE_GOALS: Array<{
  value: CumulativeGoalType
  label: string
}> = [
  { value: 'floors', label: '楼层' },
  { value: 'ascent', label: '爬升' },
  { value: 'duration', label: '时间' },
]

export default function WorkoutSetupScreen({
  navigation,
  route,
}: RootStackScreen<'WorkoutSetup'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const id = route.params.id

  const [routeTpl, setRouteTpl] = useState<RouteTemplate | null>(null)
  const [loadError, setLoadError] = useState('')
  const [routeVerified, setRouteVerified] = useState(false)
  const [privacyAgreed, setPrivacyAgreed] = useState(false)

  const [goalType, setGoalType] = useState<WorkoutGoalType>('open')
  const [targetRounds, setTargetRounds] = useState(5)
  const [targetFloors, setTargetFloors] = useState(75)
  const [targetAscentM, setTargetAscentM] = useState(240)
  const [targetDurationMin, setTargetDurationMin] = useState(30)
  // D07b：训练结构（阶段序列）。默认关闭 = 旧流程逐字不变；打开后默认含热身与轮间恢复。
  const [busy, setBusy] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [planEnabled, setPlanEnabled] = useState(false)
  const [planWarmup, setPlanWarmup] = useState(true)
  const [planRecovery, setPlanRecovery] = useState(true)
  const [trackingMode, setTrackingMode] = useState<TrackingMode>(route.params.trackingMode ?? 'automatic')
  useEffect(() => {
    isPrivacyAgreed()
      .then(setPrivacyAgreed)
      .catch(() => setPrivacyAgreed(false))
  }, [])

  useEffect(() => {
    const load = async () => {
      if (!id) {
        setLoadError('路线不存在')
        return
      }
      try {
        const [r, prefs] = await Promise.all([getRoute(id), getPreferences()])
        if (!r) {
          setLoadError('路线不存在')
          return
        }
        // 地点是可选的（D05）：没有建筑起点位置也能训练，只是不记录地点、
        // 不进入地图统计。页面用 Notice 说明，并保留「补充地点」入口。
        if (!isRoutePrepared(r)) { navigation.replace('Familiarize', { id: r.id }); return }
        setRouteTpl(r)
        setRouteVerified(isRoutePrepared(r))
        // 只有已经完成采集的路线，才允许根据真实楼层预填目标。
        const floorsPerRound = getKnownFloorsPerRound(r)
        if (floorsPerRound !== undefined) {
          setTargetFloors(floorsPerRound * 5)
          setTargetAscentM(Math.round(r.totalAscentM * 5))
        } else {
          setGoalType('open')
        }
        const restored = restoreWorkoutSetup(r, prefs.lastWorkoutSetup)
        setGoalType(restored.goal.type)
        if (restored.goal.type === 'rounds') setTargetRounds(restored.goal.targetRounds)
        if (restored.goal.type === 'floors') setTargetFloors(restored.goal.targetFloors)
        if (restored.goal.type === 'ascent') setTargetAscentM(restored.goal.targetAscentM)
        if (restored.goal.type === 'duration') setTargetDurationMin(restored.goal.targetActiveDurationMs / 60000)
        setPlanEnabled(restored.planEnabled)
        setPlanWarmup(restored.planWarmup)
        setPlanRecovery(restored.planRecovery)
        setTrackingMode(route.params.trackingMode ?? prefs.trackingMode ?? restored.trackingMode ?? 'automatic')
        setSettingsLoaded(true)
      } catch (err) {
        setLoadError('加载路线失败')
      }
    }
    load()
  }, [id, navigation, route.params.trackingMode])

  const buildGoal = (): WorkoutGoal => {
    switch (goalType) {
      case 'open':
        return { type: 'open' }
      case 'rounds':
        return { type: 'rounds', targetRounds: Math.max(1, targetRounds) }
      case 'floors':
        return { type: 'floors', targetFloors: Math.max(1, targetFloors) }
      case 'ascent':
        return { type: 'ascent', targetAscentM: Math.max(1, targetAscentM) }
      case 'duration':
        return {
          type: 'duration',
          targetActiveDurationMs: Math.max(1, targetDurationMin) * 60 * 1000,
        }
    }
  }

  const preflight = useMemo(
    () =>
      evaluateWorkoutPreflight({
        privacyAgreed,
        hasRoute: routeTpl !== null,
        routeHasSegments: (routeTpl?.segments.length ?? 0) > 0,
        routeHasLocation: Boolean(routeTpl?.location),
        barometerAvailable: 'unknown',
        carryMode: routeTpl?.carryMode ?? 'pocket',
      }),
    [privacyAgreed, routeTpl],
  )

  // D07b：计划结构预览。用固定 now/id，保证预览计划不随渲染产生新对象。
  const planStructureHint = useMemo(() => {
    if (!planEnabled) return ''
    return describePlanStructure(
      buildPlanFromGoal(buildGoal(), {
        id: 'plan-preview',
        now: 0,
        includeWarmup: planWarmup,
        includeReturn: true,
        includeRecovery: planRecovery,
      }),
    )
    // buildGoal 只读取下列状态
  }, [
    planEnabled,
    planWarmup,
    planRecovery,
    goalType,
    targetRounds,
    targetFloors,
    targetAscentM,
    targetDurationMin,
  ])

  const handleStart = async () => {
    if (!routeTpl || !preflight.canStart || busy) return
    setBusy(true)
    try {
      if (await loadActiveCheckpoint()) {
        Alert.alert('还有未完成训练', '请先在训练首页继续、保存或放弃上次训练。')
        return
      }
      if (!isRoutePrepared(routeTpl)) { navigation.replace('Familiarize', { id: routeTpl.id }); return }
      if (!(await confirmBackgroundRecording())) return
    const goalValue: WorkoutGoal =
      routeTpl && hasKnownRouteEnd(routeTpl) ? buildGoal() : { type: 'open' }
    // D07b：带计划的训练。id/now 由页面显式提供（core 里不得调用 Date.now()）。
    const now = Date.now()
    const plan: WorkoutPlan | undefined = planEnabled
      ? buildPlanFromGoal(goalValue, {
          id: `plan-${id}-${now}`,
          now,
          name: `${routeTpl?.name ?? '训练'}计划`,
          includeWarmup: planWarmup,
          includeReturn: true,
          includeRecovery: planRecovery,
        })
      : undefined
    // 计划随导航参数传入训练页。
    const params: RootStackParamList['ClimbWorkout'] & { plan?: WorkoutPlan } = {
      id,
      goal: goalValue,
      returnConfirmationMode: 'assisted',
      trackingMode,
      ...(plan ? { plan } : {}),
    }
    await savePreferences({ lastTrainingRouteId: id, lastWorkoutSetup: currentSetup, trackingMode })
    navigation.replace('ClimbWorkout', params)
    } catch (e) { Alert.alert('无法开始', e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  const currentSetup: SavedWorkoutSetup | undefined = routeTpl ? {
    routeId: routeTpl.id, routeVersion: routeTpl.version, carryMode: routeTpl.carryMode,
    goal: hasKnownRouteEnd(routeTpl) ? buildGoal() : { type: 'open' },
    planEnabled, planWarmup, planRecovery, trackingMode,
  } : undefined
  useEffect(() => {
    if (settingsLoaded && currentSetup) void savePreferences({ lastWorkoutSetup: currentSetup, trackingMode })
  }, [settingsLoaded, id, goalType, targetRounds, targetFloors, targetAscentM, targetDurationMin, planEnabled, planWarmup, planRecovery, trackingMode])

  if (loadError) {
    return (
      <View style={styles.page}>
        <Header title="训练准备" back />
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
        <Header title="训练准备" back />
        <View style={styles.center}>
          <Text style={styles.loadingText}>加载中…</Text>
        </View>
      </View>
    )
  }

  const knownRoute = hasKnownRouteEnd(routeTpl)
  const floorsPerRound = getKnownFloorsPerRound(routeTpl) ?? 1
  const trainingMode: TrainingMode =
    goalType === 'open' || goalType === 'rounds' ? goalType : 'cumulative'

  return (
    <View style={styles.page}>
      <Header title="训练准备" back />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        <View style={styles.hero}>
          <Text style={styles.title}>{routeTpl.name}</Text>
          <Text style={styles.paramHint}>{routeTpl.carryMode === 'waist' ? '腰包' : '口袋'}携带 · {knownRoute ? `${routeTpl.startFloor} → ${routeTpl.endFloor} 层` : '首次学习'}</Text>
        </View>

        {preflight.blockers.map(issue => <Notice key={issue.code} tone="danger">{issue.detail}</Notice>)}
        <Disclosure title="训练目标" summary={describeWorkoutGoal(buildGoal())} initiallyOpen>

        {knownRoute ? (
          <>
            <NativeChoice value={trainingMode} options={[{ value: 'open', label: '自由' }, { value: 'rounds', label: '轮数' }, { value: 'cumulative', label: '累计' }]}
              onChange={mode => setGoalType(mode === 'cumulative' ? 'floors' : mode)} disabled={busy} />
            <Text style={styles.paramHint}>{TRAINING_MODES.find(mode => mode.key === trainingMode)?.desc}</Text>
          </>
        ) : (
          <Notice>
            这是首次采集，终点楼层还不知道。本次不预设楼层和轮数；正常爬到真实终点后，再确认实际楼层。
          </Notice>
        )}

        {knownRoute && trainingMode === 'cumulative' && (
          <View style={styles.metricRow}>
            {CUMULATIVE_GOALS.map((metric) => (
              <PressableOption
                key={metric.value}
                active={goalType === metric.value}
                compact
                onPress={() => setGoalType(metric.value)}
                title={metric.label}
              />
            ))}
          </View>
        )}

        {knownRoute && goalType === 'rounds' && (
          <View style={styles.paramCard}>
            <Text style={styles.paramLabel}>目标轮数</Text>
            <Stepper
              value={targetRounds}
              min={1}
              max={50}
              onChange={setTargetRounds}
              suffix="轮"
            />
            <Text style={styles.paramHint}>
              预计 {floorsPerRound * targetRounds} 层 ·{' '}
              {Math.round(routeTpl.totalAscentM * targetRounds)}米
            </Text>
          </View>
        )}

        {knownRoute && goalType === 'floors' && (
          <View style={styles.paramCard}>
            <Text style={styles.paramLabel}>目标楼层</Text>
            <Stepper
              value={targetFloors}
              min={floorsPerRound}
              step={floorsPerRound}
              max={9999}
              onChange={setTargetFloors}
              suffix="层"
            />
            <Text style={styles.paramHint}>
              约 {Math.ceil(targetFloors / floorsPerRound)} 轮
            </Text>
          </View>
        )}

        {knownRoute && goalType === 'ascent' && (
          <View style={styles.paramCard}>
            <Text style={styles.paramLabel}>目标爬升</Text>
            <Stepper
              value={targetAscentM}
              min={10}
              step={10}
              max={9999}
              onChange={setTargetAscentM}
              suffix="米"
            />
            <Text style={styles.paramHint}>
              约 {Math.ceil(targetAscentM / Math.max(1, routeTpl.totalAscentM))} 轮
            </Text>
          </View>
        )}

        {knownRoute && goalType === 'duration' && (
          <View style={styles.paramCard}>
            <Text style={styles.paramLabel}>净爬楼时间</Text>
            <Stepper
              value={targetDurationMin}
              min={1}
              step={5}
              max={999}
              onChange={setTargetDurationMin}
              suffix="分钟"
            />
            <Text style={styles.paramHint}>
              不含电梯返回和轮间休息
            </Text>
          </View>
        )}

        </Disclosure>

        <Disclosure title="更多记录方式" summary="平常保持默认即可"><TrackingModeSelector value={trackingMode} onChange={setTrackingMode} disabled={busy} /></Disclosure>

        {/* D07b：训练结构（阶段序列）——热身/上爬/返回/恢复，热身与恢复可跳过 */}
        <Disclosure title="热身与休息" summary={planEnabled ? '已启用训练计划' : '按需设置'}>
        <View style={styles.paramCard}>
          <PressableOption
            active={planEnabled}
            onPress={() => setPlanEnabled((value) => !value)}
            title="按计划训练"
            desc="热身 → 上爬 → 返回 → 恢复 的阶段提示，热身与轮间恢复可以跳过"
          />
          {planEnabled ? (
            <>
              <View style={styles.metricRow}>
                <PressableOption
                  compact
                  active={planWarmup}
                  onPress={() => setPlanWarmup((value) => !value)}
                  title="热身"
                />
                <PressableOption
                  compact
                  active={planRecovery}
                  onPress={() => setPlanRecovery((value) => !value)}
                  title="轮间恢复"
                />
              </View>
              {planStructureHint ? (
                <Text style={styles.paramHint}>{planStructureHint}</Text>
              ) : null}
              <Text style={styles.paramHint}>
                上爬与返回必须完成；热身、恢复可以跳过。休息时间不会计入净爬楼成绩。
              </Text>
            </>
          ) : (
            <Text style={styles.paramHint}>
              不启用时保持原有流程：只按上面的目标数字训练。
            </Text>
          )}
        </View>

        </Disclosure>
        <Disclosure title="训练说明">
          <Text style={styles.paramHint}>按所选记录模式识别爬楼与返回，也可随时确认实际楼层。目标达成后可结束，或继续加练。</Text>
          {!routeTpl.location ? <Text style={styles.paramHint}>这次不记录地点，训练成绩照常保存。</Text> : null}
          {routeVerified ? <Text style={styles.paramHint}>这条路线已经在本机检查过；如果楼层不对，锻炼时仍可以修正。</Text> : null}
        </Disclosure>

      </ScrollView>
      <View style={[styles.dock, { paddingBottom: insets.bottom + 12 }]}><Button title={routeTpl && !isRoutePrepared(routeTpl) ? '先熟悉路线' : '开始爬楼'} onPress={() => { void handleStart() }} loading={busy} disabled={!preflight.canStart} /></View>
    </View>
  )
}

// === 辅助组件 ===

import { Pressable } from 'react-native'

function PressableOption({
  active,
  onPress,
  title,
  desc,
  compact = false,
}: {
  active: boolean
  onPress: () => void
  title: string
  desc?: string
  compact?: boolean
}) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.option, active && styles.optionActive, compact && styles.optionCompact, pressed && { opacity: 0.7 }]}
      onPress={onPress}
    >
      <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>{title}</Text>
      {desc ? <Text style={styles.optionDesc}>{desc}</Text> : null}
    </Pressable>
  )
}

function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  suffix?: string
}) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  const dec = () => onChange(Math.max(min, value - step))
  const inc = () => onChange(Math.min(max, value + step))
  return (
    <View style={styles.stepper}>
      <Pressable accessibilityRole="button" accessibilityLabel={`减少目标${suffix ?? ''}`} accessibilityState={{ disabled: value <= min }} disabled={value <= min} style={styles.stepperBtn} onPress={dec}>
        <Text style={styles.stepperBtnText}>−</Text>
      </Pressable>
      <Text style={styles.stepperValue}>
        {value}
        {suffix ? ` ${suffix}` : ''}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`增加目标${suffix ?? ''}`} accessibilityState={{ disabled: value >= max }} disabled={value >= max} style={styles.stepperBtn} onPress={inc}>
        <Text style={styles.stepperBtnText}>+</Text>
      </Pressable>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: theme.pagePaddingH },
    controlCard: { backgroundColor: theme.card, borderRadius: theme.radiusLg, paddingHorizontal: 16, paddingVertical: 4, marginTop: 16 },
    dock: { backgroundColor: theme.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.lineSoft, paddingHorizontal: theme.pagePaddingH, paddingTop: 8 },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    loadingText: { color: theme.muted, fontSize: 14, marginBottom: 12 },
    hero: { backgroundColor: theme.card, borderRadius: theme.radiusLg, padding: 20, marginTop: 8 },
    verifiedPillRow: {
      marginTop: 10,
      flexDirection: 'row',
    },
    eyebrow: {
      color: theme.green,
      fontSize: theme.fontEyebrow,
      fontWeight: '700',
      letterSpacing: 1.5,
    },
    title: {
      marginTop: 6,
      color: theme.ink,
      fontSize: 22,
      fontWeight: '700',
      lineHeight: 32,
    },
    sectionLabel: {
      color: theme.mutedStrong,
      fontSize: 14,
      fontWeight: '600',
      marginTop: 16,
      marginBottom: 8,
      paddingHorizontal: 4,
    },
    modeList: {
      gap: 8,
    },
    metricRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 8,
    },
    option: {
      flex: 1,
      minHeight: 48,
      backgroundColor: theme.card,
      borderRadius: theme.radiusMd,
      padding: 12,
      borderWidth: 1,
      borderColor: theme.line,
    },
    optionActive: {
      borderColor: theme.green,
      backgroundColor: theme.greenSoft,
    },
    optionCompact: {
      padding: 10,
      alignItems: 'center',
    },
    optionTitle: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '700',
    },
    optionTitleActive: {
      color: theme.green,
    },
    optionDesc: {
      marginTop: 4,
      color: theme.muted,
      fontSize: 13,
      lineHeight: 20,
    },
    paramCard: {
      padding: 0,
      marginTop: 8,
    },
    paramLabel: {
      color: theme.muted,
      fontSize: 13,
      marginBottom: 10,
    },
    paramHint: {
      marginTop: 8,
      color: theme.mutedStrong,
      fontSize: 13,
      lineHeight: 20,
    },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    stepperBtn: {
      width: 48,
      minHeight: 48,
      borderRadius: theme.radiusMd,
      backgroundColor: theme.surfaceSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepperBtnText: {
      color: theme.green,
      fontSize: 22,
      fontWeight: '700',
    },
    stepperValue: {
      flex: 1,
      textAlign: 'center',
      color: theme.ink,
      fontSize: 24,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
  })
