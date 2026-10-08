// 开发预览页：模拟多轮训练状态机，无需真实传感器。
// 仅 __DEV__ 下可访问，用于 UI 调试和场景演练。

import React, { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Header } from '../components/Header'
import { Button, Card, Metric, Pill, Notice } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import { formatDuration } from '../core/math'
import {
  ClimbWorkout,
  WorkoutGoal,
  WorkoutPhase,
  WorkoutRound,
  WorkoutSummary,
} from '../core/types'
import { calculateWorkoutSummary } from '../core/workout-summary'

// === 模拟数据 ===

const MOCK_TEMPLATE = {
  name: '水电大楼',
  locationName: '水电大楼',
  startFloor: 1,
  endFloor: 16,
  floorsPerRound: 15,
  ascentPerRoundM: 48,
}

const MOCK_GOAL: WorkoutGoal = { type: 'rounds', targetRounds: 5 }

function makeMockRound(roundNumber: number, durationMs: number, steps: number): WorkoutRound {
  return {
    id: `mock-round-${roundNumber}`,
    roundNumber,
    startedAt: Date.now() - durationMs,
    endedAt: Date.now(),
    durationMs,
    startFloor: 1,
    targetFloor: 16,
    finalFloor: 16,
    floorsCompleted: 15,
    ascentM: 48,
    steps,
    confidence: 0.92,
    complete: true,
    completionReason: 'route_complete',
    floorSplits: [],
    events: [],
    interruptions: [],
    averageFloorMs: Math.round(durationMs / 15),
    bestFloorSplitMs: Math.round(durationMs / 15) - 2000,
    returnDurationMs: 180000,
    recoveryDurationMs: 60000,
  }
}

function makeMockWorkout(rounds: WorkoutRound[], currentRoundNumber: number): ClimbWorkout {
  const startedAt = Date.now() - 3600000
  return {
    id: 'mock-workout',
    templateId: 'mock-template',
    templateVersion: 1,
    routeSnapshot: MOCK_TEMPLATE,
    goal: MOCK_GOAL,
    returnConfirmationMode: 'assisted',
    status: 'active',
    startedAt,
    rounds,
    currentRoundNumber,
    totalRoundsCompleted: rounds.filter((r) => r.complete).length,
    totalFloorsCompleted: rounds.reduce((s, r) => s + r.floorsCompleted, 0),
    totalAscentM: rounds.reduce((s, r) => s + r.ascentM, 0),
    totalSteps: rounds.reduce((s, r) => s + r.steps, 0),
    activeDurationMs: rounds.reduce((s, r) => s + r.durationMs, 0),
    returnDurationMs: rounds.reduce((s, r) => s + (r.returnDurationMs ?? 0), 0),
    recoveryDurationMs: rounds.reduce((s, r) => s + (r.recoveryDurationMs ?? 0), 0),
    totalElapsedMs: 3600000,
    bestRoundMs: rounds.length ? Math.min(...rounds.map((r) => r.durationMs)) : undefined,
    averageRoundMs: rounds.length
      ? Math.round(rounds.reduce((s, r) => s + r.durationMs, 0) / rounds.length)
      : undefined,
    latestRoundMs: rounds.length ? rounds[rounds.length - 1].durationMs : undefined,
    createdAt: startedAt,
    updatedAt: Date.now(),
  }
}

// === 场景定义 ===

interface PreviewScenario {
  id: string
  label: string
  phase: WorkoutPhase
  rounds: WorkoutRound[]
  currentRoundNumber: number
}

function buildScenarios(): PreviewScenario[] {
  const r1 = makeMockRound(1, 275000, 490) // 4:35
  const r2 = makeMockRound(2, 268000, 482) // 4:28
  const r3 = makeMockRound(3, 264000, 478) // 4:24
  const r4 = makeMockRound(4, 271000, 486) // 4:31
  const r5 = makeMockRound(5, 278000, 497) // 4:38

  // 未完成轮
  const r3Incomplete: WorkoutRound = {
    ...r3,
    complete: false,
    completionReason: 'manual_finish',
    finalFloor: 8,
    floorsCompleted: 7,
    ascentM: 22.4,
    steps: 241,
    durationMs: 136000,
  }

  return [
    { id: 'r1-ascending', label: '第1轮上楼', phase: 'ascending', rounds: [], currentRoundNumber: 1 },
    { id: 'r1-complete', label: '第1轮完成', phase: 'round_complete', rounds: [r1], currentRoundNumber: 1 },
    { id: 'r1-returning', label: '乘电梯返回', phase: 'returning', rounds: [r1], currentRoundNumber: 1 },
    { id: 'r1-near-start', label: '接近1层', phase: 'start_confirmation', rounds: [r1], currentRoundNumber: 1 },
    { id: 'r2-ready', label: '第2轮准备', phase: 'recovering', rounds: [r1], currentRoundNumber: 2 },
    { id: 'r2-ascending', label: '第2轮上楼', phase: 'ascending', rounds: [r1], currentRoundNumber: 2 },
    { id: 'r3-complete', label: '第3轮完成', phase: 'round_complete', rounds: [r1, r2, r3], currentRoundNumber: 3 },
    { id: 'goal-5-done', label: '完成目标5轮', phase: 'recovering', rounds: [r1, r2, r3, r4, r5], currentRoundNumber: 5 },
    { id: 'free-r12', label: '自由训练第12轮', phase: 'ascending', rounds: Array.from({ length: 11 }, (_, i) => makeMockRound(i + 1, 270000 + i * 1000, 480 + i)), currentRoundNumber: 12 },
    { id: 'incomplete-finish', label: '中途结束未完成轮', phase: 'workout_complete', rounds: [r1, r2, r3Incomplete], currentRoundNumber: 3 },
  ]
}

// === 页面 ===

export default function ClimbPreviewScreen({
  navigation,
}: RootStackScreen<'ClimbPreview'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const scenarios = buildScenarios()
  const [activeScenario, setActiveScenario] = useState(scenarios[2]) // 默认"乘电梯返回"

  const workout = makeMockWorkout(activeScenario.rounds, activeScenario.currentRoundNumber)
  const summary: WorkoutSummary | null = activeScenario.rounds.length > 0
    ? calculateWorkoutSummary(activeScenario.rounds, workout.startedAt, Date.now())
    : null

  const phase = activeScenario.phase
  const currentRound = activeScenario.rounds.find(
    (r) => r.roundNumber === activeScenario.currentRoundNumber,
  ) ?? null
  const previousRound = activeScenario.rounds.find(
    (r) => r.roundNumber === activeScenario.currentRoundNumber - 1,
  ) ?? null

  return (
    <View style={styles.page}>
      <Header title="开发预览" back />
      <ScrollView
        style={styles.flex}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: 24 }]}
      >
        <View style={styles.hero}>
          <Text style={styles.title}>训练状态预览</Text>
          <Text style={styles.subtitle}>以下均为模拟数据，用于检查各阶段的界面，不会生成训练成绩。</Text>
        </View>
        {/* 场景选择器 */}
        <Text style={styles.sectionLabel}>场景</Text>
        <View style={styles.scenarioGrid}>
          {scenarios.map((s) => (
            <Pressable
              key={s.id}
              style={[
                styles.scenarioChip,
                s.id === activeScenario.id && styles.scenarioChipActive,
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: s.id === activeScenario.id }}
              onPress={() => setActiveScenario(s)}
            >
              <Text
                style={[
                  styles.scenarioChipText,
                  s.id === activeScenario.id && styles.scenarioChipTextActive,
                ]}
              >
                {s.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* 当前阶段 */}
        <View style={styles.phaseIndicator}>
          <View style={styles.phaseHeader}>
            <Text style={styles.phaseLabel}>当前阶段</Text>
            <Pill tone={phase === 'ascending' ? 'good' : phase === 'workout_complete' ? 'warn' : 'default'}>
              {phase}
            </Pill>
          </View>
        </View>

        {/* 训练维度信息 */}
        <View style={styles.workoutHeader}>
          <View>
            <Text style={styles.roundLabel}>
              第 {activeScenario.currentRoundNumber} 轮
            </Text>
            <Text style={styles.goalHint}>目标 5 轮</Text>
          </View>
          <View style={styles.workoutHeaderRight}>
            <Text style={styles.elapsedText}>
              训练 {formatDuration(3600000)}
            </Text>
            {summary && summary.activeDurationMs > 0 && (
              <Text style={styles.activeText}>
                净爬 {formatDuration(summary.activeDurationMs)}
              </Text>
            )}
          </View>
        </View>

        {/* 轮次轨道 */}
        <View style={styles.roundTrack}>
          {Array.from({ length: Math.min(5, Math.max(activeScenario.currentRoundNumber, 5)) }, (_, i) => {
            const num = i + 1
            const completed = activeScenario.rounds.find((r) => r.roundNumber === num && r.complete)
            const isCurrent = num === activeScenario.currentRoundNumber && phase !== 'workout_complete'
            return (
              <View
                key={num}
                style={[
                  styles.trackDot,
                  completed && styles.trackDotDone,
                  isCurrent && styles.trackDotCurrent,
                ]}
              >
                <Text style={[
                  styles.trackDotText,
                  completed && styles.trackDotTextDone,
                  isCurrent && styles.trackDotTextCurrent,
                ]}>{num}</Text>
              </View>
            )
          })}
        </View>

        {/* 阶段特定内容 */}
        {phase === 'ascending' && (
          <Card raised style={styles.phaseCard}>
            <Text style={styles.phaseTitle}>
              已确认8层 · 正在前往9层
            </Text>
            <Text style={styles.phaseSubtitle}>本层 62%</Text>
            <View style={styles.metricGrid}>
              <Metric label="本轮用时" value="02:16" style={styles.metric} />
              <Metric label="本轮步数" value="241" style={styles.metric} />
              <Metric label="本轮爬升" value="24.0米" style={styles.metric} />
            </View>
            <View style={styles.divider} />
            <View style={styles.metricGrid}>
              <Metric label="累计楼层" value={`${summary?.totalFloors ?? 0}`} style={styles.metric} />
              <Metric label="累计步数" value={`${summary?.totalSteps ?? 0}`} style={styles.metric} />
              <Metric label="累计爬升" value={`${(summary?.totalAscentM ?? 0).toFixed(1)}米`} style={styles.metric} />
            </View>
          </Card>
        )}

        {phase === 'round_complete' && currentRound && (
          <Card raised style={styles.phaseCard}>
            <Text style={styles.phaseTitle}>
              第 {currentRound.roundNumber} 轮完成
            </Text>
            <Text style={styles.phaseSubtitle}>
              {formatDuration(currentRound.durationMs)}
            </Text>
            <Text style={styles.phaseDetail}>
              {currentRound.floorsCompleted} 层 · {currentRound.steps} 步 ·{' '}
              {currentRound.ascentM.toFixed(1)}米
            </Text>
            {previousRound && (
              <Text style={styles.compareText}>
                {currentRound.durationMs < previousRound.durationMs
                  ? `比上一轮快 ${formatDuration(previousRound.durationMs - currentRound.durationMs)}`
                  : `比上一轮慢 ${formatDuration(currentRound.durationMs - previousRound.durationMs)}`}
              </Text>
            )}
            {!previousRound && (
              <Text style={styles.compareText}>首轮成绩已记录</Text>
            )}
          </Card>
        )}

        {phase === 'returning' && (
          <Card raised style={styles.phaseCard}>
            <Text style={styles.phaseTitle}>返回1层中</Text>
            <Text style={styles.phaseSubtitle}>本阶段不计入爬楼成绩</Text>
            <View style={styles.barometerInfo}>
              <Text style={styles.barometerLabel}>相对起点高度</Text>
              <Text style={styles.barometerValue}>+12.6米</Text>
              <Text style={styles.barometerHint}>接近1层时将自动提示</Text>
            </View>
          </Card>
        )}

        {phase === 'start_confirmation' && (
          <Card raised style={styles.phaseCard}>
            <Text style={styles.phaseTitle}>检测到已接近1层</Text>
            <Text style={styles.phaseSubtitle}>请确认当前位置</Text>
            <View style={styles.barometerInfo}>
              <Text style={styles.barometerLabel}>相对起点高度</Text>
              <Text style={[styles.barometerValue, styles.barometerValueNear]}>+1.2米</Text>
              <Text style={styles.barometerHint}>已接近起点高度</Text>
            </View>
          </Card>
        )}

        {phase === 'recovering' && (
          <Card raised style={styles.phaseCard}>
            <Text style={styles.phaseTitle}>
              准备第 {activeScenario.currentRoundNumber + 1} 轮
            </Text>
            <Text style={styles.phaseSubtitle}>休息时间 01:12</Text>
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
                <Text style={styles.recoveryStat}>最快轮 {summary.bestRoundMs ? formatDuration(summary.bestRoundMs) : '—'}</Text>
                <Text style={styles.recoveryStat}>平均轮 {summary.averageRoundMs ? formatDuration(summary.averageRoundMs) : '—'}</Text>
                <Text style={styles.recoveryStat}>累计爬升 {summary.totalAscentM.toFixed(1)}米</Text>
              </View>
            )}
            {activeScenario.rounds.length >= 5 && (
              <Notice>目标已完成：5 轮。可继续加练或完成训练。</Notice>
            )}
          </Card>
        )}

        {phase === 'workout_complete' && (
          <Card raised style={styles.phaseCard}>
            <Text style={styles.phaseTitle}>训练完成</Text>
            {summary && (
              <Text style={styles.phaseSubtitle}>
                {summary.completeRounds} 轮 · {summary.totalFloors} 层 ·{' '}
                {summary.totalAscentM.toFixed(1)}米
              </Text>
            )}
            {summary && (
              <View style={styles.metricGrid}>
                <Metric label="净爬楼" value={formatDuration(summary.activeDurationMs)} style={styles.metric} />
                <Metric label="总历时" value={formatDuration(summary.totalElapsedMs)} style={styles.metric} />
                <Metric label="最快轮" value={summary.bestRoundMs ? formatDuration(summary.bestRoundMs) : '—'} style={styles.metric} />
                <Metric label="总步数" value={summary.totalSteps} style={styles.metric} />
              </View>
            )}
          </Card>
        )}

        {/* 轮次列表 */}
        {activeScenario.rounds.length > 0 && (
          <Card raised style={styles.roundListCard}>
            <Text style={styles.cardTitle}>轮次列表</Text>
            {activeScenario.rounds.map((round) => (
              <View key={round.id} style={styles.roundRow}>
                <Text style={styles.roundNumber}>第 {round.roundNumber} 轮</Text>
                <Text style={styles.roundDuration}>{formatDuration(round.durationMs)}</Text>
                <Text style={styles.roundSteps}>{round.steps} 步</Text>
                {!round.complete && <Pill tone="warn">未完成</Pill>}
              </View>
            ))}
          </Card>
        )}

      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Button
          title="返回设置"
          variant="secondary"
          onPress={() => navigation.goBack()}
        />
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: theme.pagePaddingH, paddingTop: 16, gap: 16 },
    hero: { gap: 8 },
    title: { color: theme.ink, fontSize: theme.fontTitle, lineHeight: 34, fontWeight: '700' },
    subtitle: { color: theme.mutedStrong, fontSize: theme.fontSubtitle, lineHeight: 21 },
    sectionLabel: {
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
    },
    scenarioGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    scenarioChip: {
      backgroundColor: theme.card,
      borderRadius: theme.radiusSm,
      minHeight: theme.tapMin,
      justifyContent: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
    },
    scenarioChipActive: {
      backgroundColor: theme.green,
      borderColor: theme.green,
    },
    scenarioChipText: {
      color: theme.ink,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '600',
    },
    scenarioChipTextActive: {
      color: theme.onPrimary,
    },
    phaseCard: {
      padding: 16,
      gap: 8,
    },
    phaseIndicator: { paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
    phaseHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
    },
    phaseLabel: {
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
    },
    workoutHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 12,
    },
    roundLabel: {
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
    },
    goalHint: {
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
      marginTop: 2,
    },
    workoutHeaderRight: {
      gap: 4,
    },
    elapsedText: {
      color: theme.ink,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    activeText: {
      color: theme.green,
      fontSize: theme.fontSmall,
      lineHeight: 18,
      marginTop: 2,
      fontVariant: ['tabular-nums'],
    },
    roundTrack: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 12,
    },
    trackDot: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: theme.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    trackDotDone: {
      backgroundColor: theme.green,
      borderColor: theme.green,
    },
    trackDotCurrent: {
      borderColor: theme.green,
      backgroundColor: theme.greenSoft,
    },
    trackDotText: {
      color: theme.muted,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '700',
    },
    trackDotTextDone: {
      color: theme.onPrimary,
    },
    trackDotTextCurrent: {
      color: theme.green,
    },
    phaseTitle: {
      color: theme.ink,
      fontSize: 24,
      lineHeight: 32,
      fontWeight: '700',
      textAlign: 'center',
    },
    phaseSubtitle: {
      marginTop: 6,
      color: theme.green,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
      textAlign: 'center',
    },
    phaseDetail: {
      marginTop: 4,
      color: theme.muted,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      textAlign: 'center',
    },
    compareText: {
      marginTop: 8,
      color: theme.inkSoft,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      textAlign: 'center',
    },
    metricGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      marginTop: 16,
    },
    metric: {
      flexGrow: 1,
      flexBasis: '45%',
      minWidth: 0,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.line,
      marginVertical: 8,
    },
    barometerInfo: {
      alignItems: 'center',
      marginTop: 16,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: theme.radiusMd,
      backgroundColor: theme.cardSoft,
    },
    barometerLabel: {
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
      marginBottom: 4,
    },
    barometerValue: {
      color: theme.blueInk,
      fontSize: 28,
      lineHeight: 36,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    barometerValueNear: {
      color: theme.success,
    },
    barometerHint: {
      marginTop: 6,
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
      textAlign: 'center',
    },
    compareRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 12,
      paddingHorizontal: 4,
    },
    compareLabel: {
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
    },
    compareValue: {
      color: theme.ink,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '700',
    },
    recoveryStats: {
      marginTop: 8,
      paddingHorizontal: 4,
    },
    recoveryStat: {
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
      marginTop: 4,
    },
    roundListCard: {
      padding: 16,
    },
    cardTitle: {
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
      marginBottom: 12,
    },
    roundRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
      gap: 8,
    },
    roundNumber: {
      flex: 1,
      color: theme.ink,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '600',
    },
    roundDuration: {
      color: theme.ink,
      fontSize: theme.fontBase,
      lineHeight: 22,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    roundSteps: {
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
      minWidth: 60,
    },
    footer: { backgroundColor: theme.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, paddingHorizontal: theme.pagePaddingH, paddingTop: 8 },
  })
