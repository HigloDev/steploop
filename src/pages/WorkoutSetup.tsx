// 训练设置页：用户选择训练目标和轮间确认方式后进入正式训练。
// 导航流程：RouteEdit → WorkoutSetup → ClimbWorkout

import React, { useEffect, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Header } from '../components/Header'
import { Button, Card, Notice } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import { getRoute } from '../services/storage'
import {
  CountdownDuration,
  RouteTemplate,
  WorkoutGoal,
  WorkoutGoalType,
} from '../core/types'
import {
  getKnownFloorsPerRound,
  hasKnownRouteEnd,
} from '../core/route-state'

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

const COUNTDOWN_SECONDS: CountdownDuration = 0

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

  const [goalType, setGoalType] = useState<WorkoutGoalType>('open')
  const [targetRounds, setTargetRounds] = useState(5)
  const [targetFloors, setTargetFloors] = useState(75)
  const [targetAscentM, setTargetAscentM] = useState(240)
  const [targetDurationMin, setTargetDurationMin] = useState(30)
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
        if (!r.location) {
          Alert.alert('请先补充地点', '这是旧版路线，请先在地图上补充建筑起点位置。', [
            {
              text: '去补充',
              onPress: () =>
                navigation.replace('LocationPicker', { routeId: r.id }),
            },
          ])
          // 设置 loadError 让页面显示错误状态而非永久卡在"加载中…"
          setLoadError('路线缺少起点位置，请补充后再开始训练')
          return
        }
        setRouteTpl(r)
        // 只有已经完成采集的路线，才允许根据真实楼层预填目标。
        const floorsPerRound = getKnownFloorsPerRound(r)
        if (floorsPerRound !== undefined) {
          setTargetFloors(floorsPerRound * 5)
          setTargetAscentM(Math.round(r.totalAscentM * 5))
        } else {
          setGoalType('open')
        }
      } catch (err) {
        setLoadError('加载路线失败')
      }
    }
    load()
  }, [id, navigation])

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

  const handleStart = () => {
    navigation.replace('ClimbWorkout', {
      id,
      goal: routeTpl && hasKnownRouteEnd(routeTpl) ? buildGoal() : { type: 'open' },
      returnConfirmationMode: 'assisted',
      countdownSeconds: COUNTDOWN_SECONDS,
    })
  }

  if (loadError) {
    return (
      <View style={styles.page}>
        <Header title="训练设置" back />
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
        <Header title="训练设置" back />
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
      <Header title="训练设置" back />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        <View style={styles.hero}>
          <Text style={styles.title}>{routeTpl.name}</Text>
        </View>

        {knownRoute ? (
          <>
            <Text style={styles.sectionLabel}>训练模式</Text>
            <View style={styles.modeList}>
              {TRAINING_MODES.map((mode) => {
                const active = trainingMode === mode.key
                return (
                  <PressableOption
                    key={mode.key}
                    active={active}
                    onPress={() =>
                      setGoalType(mode.key === 'cumulative' ? 'floors' : mode.key)
                    }
                    title={mode.label}
                    desc={mode.desc}
                  />
                )
              })}
            </View>
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
          <Card raised style={styles.paramCard}>
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
          </Card>
        )}

        {knownRoute && goalType === 'floors' && (
          <Card raised style={styles.paramCard}>
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
          </Card>
        )}

        {knownRoute && goalType === 'ascent' && (
          <Card raised style={styles.paramCard}>
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
          </Card>
        )}

        {knownRoute && goalType === 'duration' && (
          <Card raised style={styles.paramCard}>
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
          </Card>
        )}

        <Notice>
          返回确认已合并：气压会自动判断是否接近起点，到达后由你点一下确认，既省事也避免误判。
        </Notice>

        {knownRoute && goalType !== 'open' && (
          <Notice>
            目标达成后会提示，不会在楼梯中途自动停止。可以完成本轮后结束，或继续加练。
          </Notice>
        )}

        <Button title="开始训练" onPress={handleStart} />
        <Button
          title="返回路线"
          variant="secondary"
          onPress={() => navigation.goBack()}
        />
      </ScrollView>
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
      style={[styles.option, active && styles.optionActive, compact && styles.optionCompact]}
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
      <Pressable style={styles.stepperBtn} onPress={dec}>
        <Text style={styles.stepperBtnText}>−</Text>
      </Pressable>
      <Text style={styles.stepperValue}>
        {value}
        {suffix ? ` ${suffix}` : ''}
      </Text>
      <Pressable style={styles.stepperBtn} onPress={inc}>
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
    sectionLabel: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
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
      backgroundColor: theme.card,
      borderRadius: theme.radiusMd,
      padding: 12,
      borderWidth: 1.5,
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
      fontSize: 11,
      lineHeight: 16,
    },
    paramCard: {
      padding: 14,
      marginTop: 8,
    },
    paramLabel: {
      color: theme.muted,
      fontSize: 12,
      marginBottom: 10,
    },
    paramHint: {
      marginTop: 8,
      color: theme.muted,
      fontSize: 12,
    },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    stepperBtn: {
      width: 44,
      height: 44,
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
      fontWeight: '800',
    },
  })
