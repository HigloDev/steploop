// 训练页（fusion-v1）：按阶段切换的全屏视图，小屏和大字体可滚动查看操作。
// 楼层为主，步数、爬楼节奏、累计高度与热量在上行过程中实时可见。
// 结束与放弃采用底部并排双长按防误触设计（支持读屏双击确认），节省纵向可视高度。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { usePreventRemove } from '@react-navigation/native'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle, Path } from 'react-native-svg'
import { UIIcon } from '../components/ui-icon'

import { FloorReadout, FloorRuler, HoldToConfirm, MiniStat, PhaseStatusBar } from '../components/workout-ui'
import { Disclosure } from '../components/disclosure'
import { CalorieEstimateDetails } from '../components/calorie-estimate-details'
import { calorieMetricLabel } from '../core/segmented-calories'
import { courseById } from '../core/coach'
import { floorAfter } from '../core/floors'
import { formatDuration } from '../core/math'
import type { FusionSnapshot } from '../core/fusion-engine'
import { useFusionWorkout } from '../hooks/useFusionWorkout'
import type { RootStackScreen } from '../navigation/types'
import { isLargeText, isMotionRing, sport, typography, useTheme, useWorkoutPalette, WorkoutPalette } from '../theme'
import { MotionRingArc } from '../components/motion-ring-graphics'
import { useReduceMotion } from '../components/ui'

function baroLabel(baro: FusionSnapshot['baro']): string {
  switch (baro) {
    case 'ok':
      return '气压正常'
    case 'stale':
      return '气压停更'
    case 'none':
      return '无气压计'
    default:
      return '气压连接中'
  }
}

/** 清晰矢量提示图标，避免大尺寸放大位图发虚。 */
function AlertBadgeSvg({ color, bg, size = 84 }: { color: string; bg: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 84 84" accessible={false}>
      <Circle cx={42} cy={42} r={38} fill={bg} stroke={color} strokeWidth={2.5} />
      <Path d="M42 24V46" stroke={color} strokeWidth={4.5} strokeLinecap="round" />
      <Circle cx={42} cy={58} r={3} fill={color} />
    </Svg>
  )
}

export default function WorkoutScreen({ navigation, route }: RootStackScreen<'ClimbWorkout'>) {
  const session = useFusionWorkout(route.params ?? {})
  return <WorkoutContent navigation={navigation} session={session} />
}

const FINISH_ALERT = { title: '结束并保存训练？', message: '保存本次训练记录并结束。', confirmLabel: '保存并结束' }
const DISCARD_ALERT = {
  title: '放弃本次训练？',
  message: '本次未保存的训练记录将被放弃，且无法恢复。',
  confirmLabel: '放弃本次',
  destructive: true,
}

/** The real screen and development screenshot lab share this presentation. */
export function WorkoutContent({
  navigation,
  session,
}: {
  navigation: RootStackScreen<'ClimbWorkout'>['navigation']
  session: ReturnType<typeof useFusionWorkout>
}) {
  const theme = useTheme()
  const motionRing = isMotionRing(theme)
  const reduced = useReduceMotion()
  const P = useWorkoutPalette()
  const styles = useMemo(() => makeStyles(P), [P])
  const insets = useSafeAreaInsets()
  const { width, height, fontScale } = useWindowDimensions()
  const compact = width < 360 || height / fontScale < 740
  const stackExitButtons = width < 370 || isLargeText(fontScale)
  const { snapshot, status } = session
  const finishingRef = useRef(false)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [showExitHint, setShowExitHint] = useState(false)
  const [leavingAction, setLeavingAction] = useState<'save' | 'discard'>('save')
  const [exitTarget, setExitTarget] = useState<{ id?: string } | null>(null)

  usePreventRemove(
    exitTarget === null && (status === 'running' || status === 'finishing' || status === 'save_failed'),
    () => {
      if (status !== 'finishing') setShowExitHint(true)
    },
  )

  useEffect(() => {
    if (!exitTarget) return
    if (exitTarget.id) navigation.replace('WorkoutResult', { id: exitTarget.id, fresh: true })
    else navigation.goBack()
  }, [exitTarget, navigation])

  const finish = useCallback(async () => {
    if (finishingRef.current) return
    finishingRef.current = true
    setLeavingAction('save')
    try {
      const id = await sessionRef.current.finish()
      setExitTarget({ id })
    } catch {
      /* Session keeps the result and shows a save retry. */
    } finally {
      finishingRef.current = false
    }
  }, [])

  const discard = useCallback(async () => {
    if (finishingRef.current) return
    finishingRef.current = true
    setLeavingAction('discard')
    try {
      await sessionRef.current.discard()
      setExitTarget({})
    } catch {
      /* Session retains the checkpoint and presents its recovery actions. */
    } finally {
      finishingRef.current = false
    }
  }, [])

  const onConfirmFinish = useCallback(() => {
    void finish()
  }, [finish])

  const onConfirmDiscard = useCallback(() => {
    void discard()
  }, [discard])

  const showLeaveActions = () => {
    if (status === 'finishing') return
    setShowExitHint(true)
  }

  if (status === 'finishing' || status === 'save_failed') {
    const retainedMessage = session.canSaveLater
      ? '本次训练仍保留在本机，请重试保存。'
      : '轮次仍在当前页面，请重试保存后再退出。'
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <StatusBar style={P.isDark ? 'light' : 'dark'} />
        <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {status === 'save_failed' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="返回，查看成绩保存操作"
              onPress={showLeaveActions}
              style={styles.iconButton}
            >
              <UIIcon name="chevron-left" size={30} color={P.ink} />
            </Pressable>
          ) : null}
          <Text style={{ ...typography.section, color: P.ink, fontWeight: '800' }}>训练结束</Text>
        </View>
        <ScrollView
          contentContainerStyle={{
            alignItems: 'center',
            paddingTop: compact ? 24 : 44,
            paddingBottom: 32,
            gap: 10,
          }}
        >
          {status === 'finishing' ? (
            <ActivityIndicator size="large" color={P.brandText} />
          ) : (
            <AlertBadgeSvg color={P.brandText} bg={P.brandDim} size={88} />
          )}
          <Text style={[styles.errorTitle, { fontSize: 28, textAlign: 'center', marginTop: 6 }]}>
            {status === 'finishing'
              ? leavingAction === 'discard'
                ? '正在放弃本次训练…'
                : '正在保存成绩…'
              : leavingAction === 'discard'
                ? '未能放弃本次训练'
                : '成绩还没有保存完成'}
          </Text>
          {status === 'finishing' ? (
            <Text style={styles.errorText}>
              {leavingAction === 'discard' ? '正在安全结束本次采集。' : '请稍等，保存后会自动进入结算页。'}
            </Text>
          ) : (
            <Text style={[styles.errorText, { fontSize: 16, lineHeight: 24 }]}>{retainedMessage}</Text>
          )}
          {status === 'save_failed' ? (
            <>
              {showExitHint ? (
                <Text accessibilityLiveRegion="polite" style={styles.exitHint}>
                  {session.canSaveLater
                    ? '请使用下方按钮重试保存，或稍后再存。'
                    : '请先重试保存，轮次仍保留在当前页面。'}
                </Text>
              ) : null}
              {session.error && session.error !== retainedMessage ? (
                <Text selectable style={styles.errorText}>{session.error}</Text>
              ) : null}
              <View style={styles.failureCard}>
                <Text style={[styles.errorText, { textAlign: 'left', fontSize: 16, fontWeight: '700' }]}>本次训练</Text>
                <View style={{ flexDirection: 'row', marginTop: 6 }}>
                  {[
                    ['总层数', String(session.rounds.reduce((sum, round) => sum + round.floors, 0)), '层'],
                    ['总高度', String(Math.round(session.rounds.reduce((sum, round) => sum + round.ascentM, 0))), '米'],
                    ['完成轮次', String(session.rounds.length), '轮'],
                  ].map(([label, value, suffix], i) => (
                    <View
                      key={label}
                      style={{ flex: 1, alignItems: 'center', borderLeftWidth: i ? 1 : 0, borderLeftColor: P.line }}
                      accessible
                      accessibilityLabel={`${label} ${value}${suffix}`}
                    >
                      <Text style={{ ...typography.digits, color: P.ink, fontSize: 34 }}>
                        {value}
                        <Text style={{ fontSize: 14, color: P.muted }}> {suffix}</Text>
                      </Text>
                      <Text style={{ color: P.muted, fontSize: 13 }}>{label}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                style={styles.primarySmall}
                onPress={() => void finish()}
              >
                <Text style={styles.primarySmallText}>
                  {leavingAction === 'discard' ? '保存成绩' : '重试保存'}
                </Text>
              </Pressable>
              {session.canSaveLater ? (
                <Pressable
                  accessibilityRole="button"
                  style={[styles.ghost, { alignSelf: 'stretch', alignItems: 'center' }]}
                  onPress={() => setExitTarget({})}
                >
                  <Text style={styles.ghostText}>稍后再存 · 返回首页</Text>
                </Pressable>
              ) : null}
              <Text style={[styles.errorText, { marginTop: 8 }]}>重试不会重复计入成绩。</Text>
            </>
          ) : null}
        </ScrollView>
      </View>
    )
  }

  if (status === 'starting' || !snapshot) {
    if (status === 'error') {
      return (
        <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
          <StatusBar style={P.isDark ? 'light' : 'dark'} />
          <AlertBadgeSvg color={P.warn} bg={P.surface} size={76} />
          <Text style={styles.errorTitle}>暂时无法开始训练</Text>
          <Text style={styles.errorText}>{session.error}</Text>
          <Pressable accessibilityRole="button" style={styles.primarySmall} onPress={session.retry}>
            <Text style={styles.primarySmallText}>重试</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.ghost} onPress={() => navigation.goBack()}>
            <Text style={styles.ghostText}>返回首页</Text>
          </Pressable>
        </View>
      )
    }
    return (
      <View style={[styles.root, styles.center]}>
        <StatusBar style={P.isDark ? 'light' : 'dark'} />
        <ActivityIndicator size="large" color={P.brandText} />
        <Text style={styles.loading}>正在启动传感器…</Text>
      </View>
    )
  }

  const phase = snapshot.phase
  const calibrating = phase === 'calibrating'
  const nextFloor = floorAfter(snapshot.startFloor, snapshot.roundFloors + 1)
  const lastRound = session.rounds.at(-1)
  const descending = phase === 'descending'
  const topFloor = snapshot.templateFloors
    ? floorAfter(snapshot.startFloor, snapshot.templateFloors)
    : phase === 'calibration_top'
      ? snapshot.currentFloor
      : undefined

  let eyebrow = ''
  let bigValue = snapshot.currentFloor
  let unit = '楼'
  let caption = ''
  if (calibrating) {
    eyebrow = '标定轮'
    caption = snapshot.roundFloors ? `已标定 ${snapshot.roundFloors} 层` : '开始爬，每到一层点一下'
  } else if (phase === 'calibration_top') {
    eyebrow = '已到顶'
    caption = `标定完成 · 共 ${snapshot.roundFloors} 层`
  } else if (phase === 'climbing') {
    eyebrow = `第 ${snapshot.roundNumber} 轮`
    caption = `本轮已爬 ${snapshot.roundFloors} 层${snapshot.estimated ? ' · 估算' : ''}`
  } else if (descending) {
    eyebrow = `第 ${lastRound?.roundNumber ?? snapshot.completedRounds} 轮完成`
    bigValue = lastRound?.floors ?? 0
    unit = '层'
    caption = '下行中 · 请注意脚下'
  } else if (phase === 'waiting') {
    eyebrow = `准备第 ${snapshot.roundNumber} 轮`
    bigValue = snapshot.startFloor
    caption = snapshot.baro === 'none' ? '开始爬就按步数计层' : '开始爬就自动计层'
  }

  const showManualNext = phase === 'calibration_top' || (phase === 'climbing' && snapshot.baro !== 'ok')
  const readoutSize = compact ? 104 : 128
  const climbingMinutes = (snapshot.ascentMs ?? snapshot.activeMs) / 60000
  const frequency = climbingMinutes > 0 ? snapshot.totalFloors / climbingMinutes : 0
  const ascent = snapshot.ascentM ?? snapshot.totalFloors * 3
  const metrics = [
    { label: '累计爬升', value: Math.round(ascent).toString(), unit: '米', icon: 'stairs' as const },
    { label: '平均频率', value: frequency.toFixed(1), unit: '层/分', icon: 'speedometer' as const },
    { label: '当前步数', value: String(snapshot.steps), unit: '步', icon: 'shoe-print' as const },
    {
      label: session.calorieEstimate ? calorieMetricLabel(session.calorieEstimate) : '消耗热量',
      value: Math.round(session.calories ?? 0).toString(),
      unit: '千卡',
      icon: 'fire' as const,
    },
  ]

  return (
    <View style={[styles.root, { paddingTop: insets.top + (compact ? 10 : 16), paddingBottom: insets.bottom + 8 }]}>
      <StatusBar style={P.isDark ? 'light' : 'dark'} />
      <View style={styles.liveHeader}>
        <UIIcon name="climb" size={26} color={P.brandInk} />
        <Text accessibilityRole="header" style={styles.liveTitle}>向上训练</Text>
        <View style={styles.roundPill}>
          <Text style={styles.roundBadge}>第 {snapshot.roundNumber} 轮</Text>
        </View>
      </View>

      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <PhaseStatusBar tone={snapshot.status.tone} text={snapshot.status.text} extra={baroLabel(snapshot.baro)} />
        </View>
      </View>
      {session.warning ? <Text style={styles.warning} numberOfLines={2}>{session.warning}</Text> : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.liveContent, { gap: compact ? 10 : 14 }]}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.hero,
            motionRing && {
              borderColor: theme.glass.stroke,
              borderTopColor: theme.glass.highlight,
              borderWidth: 1,
            },
          ]}
        >
          <Text style={styles.eyebrow}>{calibrating ? '记住这段楼梯' : phase === 'climbing' ? '当前楼层' : eyebrow}</Text>
          <View style={styles.heroReadout}>
            <FloorReadout value={bigValue} unit={unit} size={readoutSize} />
            {descending ? (
              <UIIcon name="elevator-down" size={46} color={P.brandText} />
            ) : (
              <FloorRuler
                startFloor={snapshot.startFloor}
                currentFloor={snapshot.currentFloor}
                topFloor={topFloor}
                estimated={snapshot.estimated && phase === 'climbing'}
                compact={compact}
              />
            )}
          </View>
          <Text style={[styles.caption, snapshot.estimated && phase === 'climbing' && { color: P.estimate }]}>
            {caption}
          </Text>
          {!descending && topFloor !== undefined ? (
            <View style={styles.routeProgressRow}>
              {motionRing && phase === 'climbing' && snapshot.templateFloors && snapshot.templateFloors > 0 ? (
                <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <MotionRingArc
                    progress={snapshot.roundFloors / snapshot.templateFloors}
                    size={28}
                    strokeWidth={3.6}
                    estimated={snapshot.estimated}
                    reducedMotion={reduced}
                  />
                </View>
              ) : null}
              <Text style={styles.routeCaption}>
                起点 {snapshot.startFloor} 楼 · 折返 {topFloor} 楼
                {motionRing && phase === 'climbing' && snapshot.templateFloors && snapshot.templateFloors > 0
                  ? ` · 本轮 ${snapshot.roundFloors}/${snapshot.templateFloors} 层`
                  : ''}
              </Text>
            </View>
          ) : null}
        </View>

        {calibrating ? (
          <View style={[styles.calArea, compact && { gap: 8 }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`到了一层，记为 ${nextFloor} 楼`}
              onPress={session.markFloor}
              style={({ pressed }) => [
                styles.bigButton,
                { minHeight: compact ? 64 : 74 },
                pressed && styles.bigButtonPressed,
              ]}
            >
              <Text style={[styles.bigButtonText, compact && { fontSize: 22 }]} numberOfLines={1} adjustsFontSizeToFit>
                到了一层
              </Text>
              <Text style={[styles.bigButtonSub, compact && { fontSize: 12, marginTop: 2 }]}>记为 {nextFloor} 楼</Text>
            </Pressable>
            <View style={styles.calRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="撤销上一次"
                disabled={!snapshot.canUndo}
                onPress={session.undoMark}
                style={[styles.secondary, !snapshot.canUndo && { opacity: 0.35 }]}
              >
                <UIIcon name="undo" size={20} color={P.inkSoft} />
                <Text style={styles.secondaryText}>撤销</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="到顶了，结束标定爬楼"
                onPress={session.markTop}
                style={[styles.secondary, styles.topButton]}
              >
                <UIIcon name="flag-checkered" size={20} color={P.brandInk} />
                <Text style={[styles.secondaryText, { color: P.brandInk }]}>到顶了</Text>
              </Pressable>
            </View>
          </View>
        ) : showManualNext ? (
          <View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={phase === 'calibration_top' ? '已回到楼下，开始下一轮' : '结束本轮'}
              onPress={session.nextRound}
              style={[styles.nextButton, compact && { minHeight: 52 }]}
            >
              <UIIcon name="replay" size={20} color={P.onBrand} />
              <Text style={[styles.nextText, compact && { fontSize: 18 }]} numberOfLines={1} adjustsFontSizeToFit>
                {phase === 'calibration_top' ? '已到楼下 · 开始下一轮' : '结束本轮'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.phaseHint}>
            <UIIcon
              name={phase === 'descending' ? 'elevator-down' : phase === 'waiting' ? 'play-circle' : 'vibrate'}
              size={20}
              color={P.brandInk}
              accessible={false}
            />
            <Text style={styles.phaseHintText}>
              {phase === 'descending'
                ? '下行不累计楼层与热量'
                : phase === 'waiting'
                  ? '开始上行即可继续，休息不计入爬楼频率'
                  : '每完成一层自动更新楼层数字'}
            </Text>
          </View>
        )}

        {session.coach ? (
          <View style={styles.coachCard}>
            <Text style={styles.coachTitle}>{courseById(session.coach.courseId)?.name ?? '教练课程'}</Text>
            <Text accessibilityLiveRegion="polite" style={styles.coachProgress}>
              本次有效上爬 {(snapshot.activeMs / 60000).toFixed(1)} 分钟 · 安排 {session.coach.targetMinutes} 分钟
            </Text>
            <Text style={styles.coachHint}>按自己的节奏分段完成，返回后充分恢复。结束并保存后计入课程，可分次累计。</Text>
          </View>
        ) : null}

        <View>
          <View style={styles.liveMetrics}>
            {metrics.map(metric => (
              <View
                key={metric.label}
                style={[
                  styles.liveMetric,
                  motionRing && {
                    backgroundColor: P.surface,
                    borderRadius: 14,
                    paddingHorizontal: 12,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.glass.stroke,
                    borderTopColor: theme.glass.highlight,
                  },
                  compact && { minHeight: 64, paddingVertical: 8 },
                ]}
                accessible
                accessibilityLabel={`${metric.label} ${metric.value} ${metric.unit}`}
              >
                <View style={styles.liveMetricTitle}>
                  <UIIcon name={metric.icon} size={17} color={P.brandInk} accessible={false} />
                  <Text style={styles.liveMetricLabel}>{metric.label}</Text>
                </View>
                <View style={styles.liveMetricNumber}>
                  <Text
                    style={[styles.liveMetricValue, metric.label === '累计爬升' && { color: P.brandInk }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {metric.value}
                  </Text>
                  <Text style={styles.liveMetricUnit}>{metric.unit}</Text>
                </View>
              </View>
            ))}
          </View>
          <Text style={styles.metricHint}>
            频率只计上行用时 · 热量按步频自动估算{snapshot.estimated || snapshot.baro !== 'ok' ? ' · 高度为估算' : ''}
          </Text>
        </View>

        {session.calorieEstimate ? (
          <Disclosure compact icon="info" title="热量估算依据">
            <CalorieEstimateDetails estimate={session.calorieEstimate} />
          </Disclosure>
        ) : null}

        {snapshot.completedRounds > 0 ? (
          <View style={styles.completedStrip}>
            <UIIcon name="check-circle" size={18} color={P.good} accessible={false} />
            <Text style={styles.completedText}>
              已完成 {snapshot.completedRounds} 轮
              {lastRound ? ` · 上轮 ${lastRound.floors} 层 / ${formatDuration(lastRound.activeMs ?? lastRound.durationMs)}` : ''}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.stats}>
        <MiniStat label="整次用时" value={formatDuration(snapshot.elapsedMs)} compact={compact} />
        <MiniStat label="累计层数" value={`${snapshot.totalFloors} 层`} accent compact={compact} divider />
      </View>

      <View style={styles.exitActions}>
        {showExitHint ? (
          <Text accessibilityLiveRegion="polite" style={styles.exitHint}>
            训练仍在进行，请长按下方按钮结束并保存或放弃本次。
          </Text>
        ) : null}
        <View style={[styles.exitButtonRow, stackExitButtons && styles.exitButtonColumn]}>
          <HoldToConfirm
            tone="primary"
            label="长按结束并保存"
            holdingLabel="继续按住保存…"
            onConfirm={onConfirmFinish}
            accessibilityAlert={FINISH_ALERT}
            style={stackExitButtons ? styles.exitFullBtn : styles.exitPrimaryBtn}
          />
          <HoldToConfirm
            tone="danger"
            label={stackExitButtons ? '长按放弃本次' : '长按放弃'}
            holdingLabel={stackExitButtons ? '继续按住放弃…' : '按住放弃…'}
            accessibilityHint="本次未保存的训练将被放弃。使用读屏双击打开确认对话框"
            onConfirm={onConfirmDiscard}
            accessibilityAlert={DISCARD_ALERT}
            style={stackExitButtons ? styles.discardStacked : styles.discardInline}
          />
        </View>
      </View>
    </View>
  )
}

const makeStyles = (P: WorkoutPalette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: P.bg, paddingHorizontal: sport.space.page },
    liveHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingBottom: 8 },
    liveTitle: { ...typography.section, color: P.ink },
    roundPill: {
      marginLeft: 'auto',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: P.brandDim,
    },
    roundBadge: { ...typography.caption, color: P.brandInk, fontWeight: '700' },
    completedStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: P.line,
    },
    completedText: { flex: 1, color: P.inkSoft, fontSize: 13, lineHeight: 19 },
    center: { alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 32 },
    failureCard: {
      padding: 18,
      backgroundColor: P.failureSurface,
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: P.line,
      gap: 6,
      alignSelf: 'stretch',
      marginVertical: 10,
    },
    loading: { color: P.inkSoft, fontSize: 16, fontWeight: '700' },
    errorTitle: { color: P.ink, fontSize: 22, fontWeight: '800' },
    errorText: { color: P.inkSoft, fontSize: 15, lineHeight: 22, textAlign: 'center' },
    primarySmall: {
      minHeight: 54,
      minWidth: 180,
      borderRadius: 16,
      backgroundColor: P.brand,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'stretch',
    },
    primarySmallText: { ...typography.control, color: P.onBrand },
    ghost: {
      minHeight: 52,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: P.brandInk,
      borderRadius: 16,
      paddingHorizontal: 20,
    },
    ghostText: { ...typography.control, color: P.brandInk },
    topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    warning: { color: P.warn, fontSize: 13, fontWeight: '700', marginTop: 6, marginHorizontal: 4 },
    liveContent: { flexGrow: 1, paddingVertical: 10 },
    hero: {
      padding: sport.space.lg,
      backgroundColor: P.surface,
      borderRadius: sport.radius.hero,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: P.line,
    },
    heroReadout: { flexDirection: 'row', alignItems: 'center', gap: sport.space.md },
    coachCard: {
      padding: 14,
      borderRadius: 16,
      backgroundColor: P.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: P.line,
      gap: 6,
    },
    coachTitle: { color: P.ink, fontSize: 16, fontWeight: '700' },
    coachProgress: { color: P.ink, fontSize: 15 },
    coachHint: { color: P.muted, fontSize: 13, lineHeight: 19 },
    liveMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    liveMetric: {
      width: '46%',
      flexGrow: 1,
      minHeight: 76,
      paddingHorizontal: 4,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: P.line,
    },
    liveMetricTitle: { flexDirection: 'row', gap: 6, alignItems: 'center' },
    liveMetricLabel: { ...typography.caption, color: P.inkSoft, flexShrink: 1 },
    liveMetricNumber: { flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: 4 },
    liveMetricValue: { ...typography.digits, color: P.ink, fontSize: 30, flexShrink: 1 },
    liveMetricUnit: { ...typography.caption, color: P.inkSoft },
    metricHint: { ...typography.caption, color: P.muted, marginTop: 6, textAlign: 'center' },
    phaseHint: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 11,
      borderRadius: 10,
      backgroundColor: P.surface,
    },
    phaseHintText: { ...typography.secondary, flex: 1, color: P.inkSoft },
    eyebrow: { ...typography.label, color: P.inkSoft },
    caption: { ...typography.body, color: P.inkSoft, marginTop: sport.space.xs },
    routeProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: sport.space.xs },
    routeCaption: { ...typography.caption, color: P.muted, flexShrink: 1 },
    calArea: { flex: 0, justifyContent: 'flex-end', gap: 12 },
    bigButton: {
      minHeight: 74,
      borderRadius: sport.radius.control,
      backgroundColor: P.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bigButtonPressed: { backgroundColor: P.brandPressed, transform: [{ scale: 0.985 }] },
    bigButtonText: { color: P.onBrand, fontSize: 24, fontWeight: '700' },
    bigButtonSub: { color: P.onBrand, fontSize: 14, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
    calRow: { flexDirection: 'row', gap: 12 },
    secondary: {
      flex: 1,
      minHeight: 48,
      borderRadius: 24,
      backgroundColor: 'transparent',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: P.muted,
    },
    topButton: { borderWidth: 1.5, borderColor: P.muted },
    secondaryText: { color: P.inkSoft, fontSize: 16, fontWeight: '600' },
    nextButton: {
      minHeight: 68,
      borderRadius: 20,
      backgroundColor: P.brand,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    nextText: { color: P.onBrand, fontSize: 22, fontWeight: '800', flexShrink: 1, textAlign: 'center' },
    stats: {
      flexDirection: 'row',
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: P.line,
      marginTop: 4,
    },
    exitActions: { gap: 6, marginTop: 4 },
    exitButtonRow: { flexDirection: 'row', gap: 10 },
    exitButtonColumn: { flexDirection: 'column', gap: 6 },
    exitPrimaryBtn: { flex: 1.65, minHeight: 54 },
    exitFullBtn: { minHeight: 54 },
    discardInline: { flex: 1, minHeight: 54 },
    discardStacked: { minHeight: 48, borderWidth: 1, borderRadius: sport.radius.control },
    exitHint: { color: P.inkSoft, fontSize: 13, lineHeight: 18, textAlign: 'center', paddingHorizontal: 8 },
  })
