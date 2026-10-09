// 训练总结页：展示本次核心数据，并进入静态海报分享。

import { WorkoutRoundEditor } from '../components/workout-round-editor'
import { workoutCalories } from '../core/calories'
import React, { useEffect, useRef, useState } from 'react'
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Disclosure } from '../components/disclosure'
import { Header } from '../components/Header'
import { WorkoutCompleteCeremony } from '../components/WorkoutCompleteCeremony'
import { calculateStairCalories, DEFAULT_BODY_WEIGHT_KG, formatCalories } from '../core/calories'
import { exportWorkoutEvidence } from '../services/workout-evidence'
import { isLocalDownloadExportAvailable } from '../services/local-download-export'
import { Button, Card, Pill, useReduceMotion } from '../components/ui'
import { formatDuration } from '../core/math'
import { getRoundAchievementCount } from '../core/floors'
import { summarizeRouteLearning } from '../core/route-learning'
import {
  deriveTrainingProgress,
  trainingSuggestion,
} from '../core/training-progress'
import {
  ClimbWorkout,
  WorkoutSummary,
} from '../core/types'
import { calculateWorkoutSummary } from '../core/workout-summary'
import { RootStackScreen } from '../navigation/types'
import { getRoute } from '../services/storage'
import {
  getWorkout,
  listWorkouts,
} from '../services/workout-storage'
import { Theme, useTheme } from '../theme'

function dateText(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function WorkoutResultScreen({
  navigation,
  route,
}: RootStackScreen<'WorkoutResult'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const [workout, setWorkout] = useState<ClimbWorkout | null>(null)
  const [summary, setSummary] = useState<WorkoutSummary | null>(null)
  const [learningLabel, setLearningLabel] = useState('')
  const [learningMessage, setLearningMessage] = useState('')
  const [error, setError] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const [isPersonalBest, setIsPersonalBest] = useState(false)
  const [replayBuilding, setReplayBuilding] = useState(false)
  const [exportingEvidence, setExportingEvidence] = useState(false)
  const [evidenceMessage, setEvidenceMessage] = useState('')
  const badgeScale = useRef(new Animated.Value(0.5)).current
  const badgeOpacity = useRef(new Animated.Value(0)).current
  // D10 验收 4：系统开启「减少动画」时不播庆祝动效，直接给最终状态。
  const reduceMotion = useReduceMotion()

  useEffect(() => {
    if (!isPersonalBest) return
    if (reduceMotion) {
      badgeScale.setValue(1)
      badgeOpacity.setValue(1)
      return
    }
    badgeScale.setValue(0.5)
    badgeOpacity.setValue(0)
    Animated.parallel([
      Animated.spring(badgeScale, {
        toValue: 1,
        friction: 5,
        tension: 90,
        useNativeDriver: true,
      }),
      Animated.timing(badgeOpacity, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }),
    ]).start()
  }, [isPersonalBest, reduceMotion, badgeScale, badgeOpacity])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const stored = await getWorkout(route.params.id)
      if (!stored) {
        setError('训练记录不存在')
        return
      }
      const [storedRoute, workouts] = await Promise.all([
        getRoute(stored.templateId),
        listWorkouts(),
      ])
      if (!mounted) return
      const nextSummary = calculateWorkoutSummary(
        stored.rounds,
        stored.startedAt,
        stored.endedAt,
      )
      setWorkout(stored)
      setSummary(nextSummary)
      setError('')
      const progress = deriveTrainingProgress(workouts, stored.endedAt ?? Date.now())
      setSuggestion(trainingSuggestion(stored, progress))
      setIsPersonalBest(
        progress.personalBests[stored.templateId]?.workoutId === stored.id,
      )
      if (storedRoute && stored.recognitionVersion !== 'baro-v1') {
        const learning = summarizeRouteLearning(storedRoute, workouts)
        setLearningLabel(learning.stageLabel)
        setLearningMessage(learning.message)
      }
    }
    load().catch(() => setError('训练总结加载失败'))
    const unsubscribe = navigation.addListener('focus', () => {
      void load().catch(() => setError('训练总结加载失败'))
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [route.params.id, navigation])

  if (!workout || !summary) {
    return (
      <View style={styles.page}>
        <Header title="训练完成" back />
        <View style={styles.center}>
          <Text
            style={styles.loadingText}
            accessibilityLiveRegion="polite"
            accessibilityLabel={error || '正在整理成果'}
          >
            {error || '正在整理成果…'}
          </Text>
          {error ? (
            <Button
              title="返回首页"
              onPress={() => navigation.navigate('Main', { screen: 'Train' })}
            />
          ) : null}
        </View>
      </View>
    )
  }

  const bestRound = summary.bestRoundMs !== undefined && summary.bestRoundMs > 0
    ? workout.rounds
        .filter((round) => round.complete && round.durationMs > 0)
        .slice()
        .sort((a, b) => a.durationMs - b.durationMs)[0]
    : undefined
  const hasCompletedRound = summary.completeRounds > 0
  const calories = workoutCalories(workout)
  const hasManualOrInterrupted = workout.rounds.some(round => round.completionReason === 'interrupted' || round.completionSource === 'manual' || (round.corrections?.length ?? 0) > 0)

  return (
    <View style={styles.page}>
      <Header title="训练完成" back />
      <ScrollView
        style={styles.flex}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 32 },
        ]}
      >
        {workout.recognitionVersion === 'baro-v1' && <WorkoutRoundEditor workout={workout} onSaved={w => { setWorkout(w); setSummary(calculateWorkoutSummary(w.rounds, w.startedAt, w.endedAt)) }} />}
        <View style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View style={styles.heroCopy}>
              <Text accessibilityRole="header" style={styles.routeName}>
                {workout.routeSnapshot.locationName || workout.routeSnapshot.name}
              </Text>
              <Text style={styles.date}>训练开始 {dateText(workout.startedAt)}</Text>
            </View>
            {isPersonalBest ? (
              <Animated.View
                style={{
                  transform: [{ scale: badgeScale }],
                  opacity: badgeOpacity,
                }}
              >
                <Pill tone="good">个人最佳</Pill>
              </Animated.View>
            ) : (
              <Pill tone={hasCompletedRound ? 'good' : 'warn'}>
                {hasCompletedRound ? '完成' : '未完成'}
              </Pill>
            )}
          </View>
          <Text style={styles.heroStatement}>
            {workout.floorCounting === 'transitions' ? '累计实际爬升' : '历史完成层数'}
          </Text>
          {/* D10 读屏：把「42」和「层」合成一个节点，避免读成两个孤立数字。 */}
          <View
            style={styles.heroMetric}
            accessible
            accessibilityLabel={`本次共爬升 ${summary.totalFloors} 层`}
          >
            <Text style={styles.heroNumber}>{summary.totalFloors}</Text>
            <Text style={styles.heroUnit}>层</Text>
          </View>
          <Pressable accessibilityRole="button" style={styles.replayButton} onPress={() => setReplayBuilding(true)}>
            <Feather name="play-circle" size={20} color={theme.green} />
            <Text style={styles.replayText}>重播盖楼动画</Text>
            <Feather name="chevron-right" size={18} color={theme.green} />
          </Pressable>
        </View>
        <Text accessibilityRole="header" style={styles.sectionTitle}>这次训练</Text>
        <Card style={styles.metricCard}>
          <View style={styles.metricGrid}>
            {[
              ['净爬楼', formatDuration(summary.activeDurationMs)],
              ['完成轮数', `${summary.completeRounds} 轮`],
              ['累计步数', `${summary.totalSteps} 步`],
              ['估算消耗', `${formatCalories(calories)} 千卡`],
              ['训练总时间', formatDuration(summary.totalElapsedMs)],
              ['休息 / 电梯合计', formatDuration(Math.max(0, summary.totalElapsedMs - summary.activeDurationMs))],
            ].map(([label, value]) => <View key={label} style={styles.metric} accessible accessibilityLabel={`${label}，${value}`}>
              <Text style={styles.metricLabel}>{label}</Text><Text selectable style={styles.metricValue}>{value}</Text>
            </View>)}
          </View>
          <Text style={styles.metricNote}>累计上升 {summary.totalAscentM.toFixed(1)} 米 · 热量为估算值</Text>
        </Card>
        {hasManualOrInterrupted ? <View style={styles.correctionNotice}><Feather name="info" size={18} color={theme.amberInk} /><Text style={styles.correctionText}>含人工确认、修正或中断，可在每轮成绩中查看。</Text></View> : null}
        <Modal visible={replayBuilding} animationType="fade" onRequestClose={() => setReplayBuilding(false)}>
          {replayBuilding && <WorkoutCompleteCeremony workoutId={workout.id} totalFloors={summary.totalFloors} completeRounds={summary.completeRounds} totalAscentM={summary.totalAscentM} planLines={[]} totalSteps={summary.totalSteps} calories={workoutCalories(workout)} activeMs={summary.activeDurationMs} totalMs={summary.totalElapsedMs} onDone={() => setReplayBuilding(false)} />}
        </Modal>
        <Disclosure title="用时表现">
        <View style={styles.detailGroup}>
          <View style={styles.performanceRows}>
            <View
              style={styles.performanceRow}
              accessible
              accessibilityLabel={`最快一轮 ${
                bestRound ? formatDuration(bestRound.durationMs) : '暂无数据'
              }`}
            >
              <Text style={styles.performanceLabel}>最快一轮</Text>
              <Text style={styles.performanceValue}>
                {bestRound ? formatDuration(bestRound.durationMs) : '—'}
              </Text>
            </View>
            <View
              style={styles.performanceRow}
              accessible
              accessibilityLabel={`平均一轮 ${
                summary.averageRoundMs
                  ? formatDuration(summary.averageRoundMs)
                  : '暂无数据'
              }`}
            >
              <Text style={styles.performanceLabel}>平均一轮</Text>
              <Text style={styles.performanceValue}>
                {summary.averageRoundMs
                  ? formatDuration(summary.averageRoundMs)
                  : '—'}
              </Text>
            </View>
            <View
              style={styles.performanceRow}
              accessible
              accessibilityLabel={`平均每层 ${
                summary.totalFloors > 0 && summary.activeDurationMs > 0
                  ? formatDuration(
                      Math.round(summary.activeDurationMs / summary.totalFloors),
                    )
                  : '暂无数据'
              }`}
            >
              <Text style={styles.performanceLabel}>平均每层</Text>
              <Text style={styles.performanceValue}>
                {summary.totalFloors > 0 && summary.activeDurationMs > 0
                  ? formatDuration(
                      Math.round(
                        summary.activeDurationMs / summary.totalFloors,
                      ),
                    )
                  : '—'}
              </Text>
            </View>
          </View>
        </View>

        </Disclosure>
        <Disclosure title="路线学习与建议">
        {suggestion ? (
          <View style={styles.learningCard}>
            <Text accessibilityRole="header" style={styles.cardTitle}>
              下一次建议
            </Text>
            <Text style={styles.learningText}>{suggestion}</Text>
          </View>
        ) : null}

        {learningLabel ? (
          <View style={styles.learningCard}>
            <View style={styles.learningHeader}>
              <Text accessibilityRole="header" style={styles.cardTitle}>
                路线学习
              </Text>
              <Pill tone={learningLabel === '路线已验证' ? 'good' : 'warn'}>
                {learningLabel}
              </Pill>
            </View>
            <Text style={styles.learningText}>{learningMessage}</Text>
          </View>
        ) : null}

        </Disclosure>
        <Disclosure title="每轮成绩" summary={`${workout.rounds.length} 轮记录`}>
        {workout.rounds.length > 0 ? (
          <View style={styles.detailGroup}>
            {workout.rounds.map((round) => (
              <View
                key={round.id}
                style={styles.roundRow}
                accessible
                accessibilityLabel={`第 ${round.roundNumber} 轮，${getRoundAchievementCount(
                  round,
                )} 层，${round.steps} 步，用时 ${formatDuration(
                  round.durationMs,
                )}${bestRound?.id === round.id ? '，最快一轮' : ''}`}
              >
                <View style={styles.roundIdentity}>
                  <Text style={styles.roundTitle}>第 {round.roundNumber} 轮</Text>
                  <Text style={styles.roundSub}>
                    {getRoundAchievementCount(round)} 层 · {round.steps} 步
                  </Text>
                  <Text style={styles.roundSub}>{round.startFloor} 楼 → {round.finalFloor} 楼{round.completionSource === 'manual' ? ' · 人工确认' : ''}{(round.corrections?.length ?? 0) > 0 ? ' · 已修正' : ''}{round.completionReason === 'interrupted' ? ' · 中断' : ''}</Text>
                </View>
                <Text style={styles.roundTime}>
                  {formatDuration(round.durationMs)}
                </Text>
                {bestRound?.id === round.id ? (
                  <Pill tone="good">最快</Pill>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {workout.rounds.length ? <Button title="查看与修正最后一轮" variant="secondary" onPress={() => navigation.navigate('Result', { id: workout.id })} /> : null}
        </Disclosure>
        <Disclosure title="原始数据与修正记录" summary="电脑分析">
          <View style={styles.detailGroup}>
            <Text style={styles.learningText}>导出原始采样、自动识别和人工修正记录，供电脑复盘。文件包含私密训练数据。</Text>
            <Button title={exportingEvidence ? '正在导出…' : '导出原始数据与修正记录'} variant="secondary" disabled={exportingEvidence} style={styles.exportButton} onPress={() => {
              setExportingEvidence(true)
              void exportWorkoutEvidence(workout).then(result => setEvidenceMessage(result.message))
                .catch(error => setEvidenceMessage(`导出失败：${error instanceof Error ? error.message : String(error)}，原始文件仍保留。`))
                .finally(() => setExportingEvidence(false))
            }} />
            {isLocalDownloadExportAvailable() ? <Button title={exportingEvidence ? '正在保存…' : '保存原始数据到下载'} variant="secondary" disabled={exportingEvidence} style={styles.exportButton} onPress={() => {
              setExportingEvidence(true)
              void exportWorkoutEvidence(workout, { destination: 'downloads' }).then(result => setEvidenceMessage(result.message))
                .catch(error => setEvidenceMessage(`保存失败：${error instanceof Error ? error.message : String(error)}，原始文件仍保留。`))
                .finally(() => setExportingEvidence(false))
            }} /> : null}
            {evidenceMessage ? <Text accessibilityLiveRegion="polite" style={styles.learningText}>{evidenceMessage}</Text> : null}
          </View>
        </Disclosure>
        <Button
          title="再来一次"
          variant="secondary"
          onPress={() =>
            navigation.replace('WorkoutSetup', {
              id: workout.templateId,
            })
          }
        />

      </ScrollView>
      <View style={[styles.dock, { paddingBottom: insets.bottom + 12 }]}>
        <Button title="分享成绩" fullWidth={false} style={styles.dockButton} variant="secondary" onPress={() => navigation.navigate('ShareStudio', { id: workout.id })} />
        <Button title="完成" fullWidth={false} style={styles.dockButton} onPress={() => navigation.navigate('Main', { screen: 'Train' })} />
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: {
      paddingHorizontal: theme.pagePaddingH,
      gap: 16,
      paddingTop: 8,
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 20,
    },
    loadingText: { color: theme.mutedStrong, fontSize: 15, lineHeight: 22, marginBottom: 24 },
    heroCard: {
      padding: 20,
      backgroundColor: theme.card,
      borderRadius: 20,
    },
    heroTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12,
    },
    heroCopy: { flex: 1 },
    eyebrow: {
      color: theme.green,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1.4,
    },
    routeName: {
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
    },
    date: { paddingTop: 4, color: theme.mutedStrong, fontSize: 12, lineHeight: 18 },
    heroMetric: {
      flexDirection: 'row',
      alignItems: 'baseline',
      paddingVertical: 8,
    },
    heroNumber: {
      color: theme.green,
      fontSize: 64,
      lineHeight: 76,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    heroUnit: {
      paddingLeft: 8,
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '500',
    },
    heroStatement: {
      color: theme.mutedStrong,
      fontSize: 14,
      lineHeight: 21,
      marginTop: 24,
    },
    metricGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: 16,
      rowGap: 24,
    },
    metric: { flexGrow: 1, flexBasis: '45%' },
    metricCard: { padding: 20, borderRadius: 20 },
    metricLabel: { color: theme.mutedStrong, fontSize: 14, lineHeight: 21, marginBottom: 8 },
    metricValue: { color: theme.ink, fontSize: 24, lineHeight: 32, fontWeight: '600', fontVariant: ['tabular-nums'] },
    metricNote: { color: theme.mutedStrong, fontSize: 12, lineHeight: 18, paddingTop: 16, marginTop: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
    sectionTitle: { color: theme.ink, fontSize: 17, lineHeight: 24, fontWeight: '600', paddingTop: 8 },
    detailGroup: { paddingTop: 4, paddingBottom: 16 },
    replayButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, marginTop: 8, paddingTop: 8 },
    replayText: { flex: 1, color: theme.green, fontSize: 15, lineHeight: 22, fontWeight: '600' },
    correctionNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 16, borderRadius: 14, backgroundColor: theme.amberSoft },
    correctionText: { flex: 1, color: theme.amberInk, fontSize: 14, lineHeight: 21 },
    exportButton: { marginTop: 12 },
    dock: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 8, backgroundColor: theme.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
    dockButton: { flex: 1 },
    cardTitle: { color: theme.ink, fontSize: 15, lineHeight: 22, fontWeight: '600' },
    performanceRows: { paddingTop: 8 },
    performanceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 12,
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    performanceLabel: { color: theme.mutedStrong, fontSize: 14, lineHeight: 21, flex: 1 },
    performanceValue: {
      color: theme.ink,
      fontSize: 14,
      lineHeight: 21,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    learningCard: { paddingVertical: 12 },
    learningHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    },
    learningText: {
      paddingTop: 8,
      color: theme.mutedStrong,
      fontSize: 14,
      lineHeight: 21,
    },
    roundCard: { padding: 14 },
    roundRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 16,
      flexWrap: 'wrap',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    roundIdentity: { flex: 1 },
    roundTitle: { color: theme.ink, fontSize: 15, lineHeight: 22, fontWeight: '600' },
    roundSub: { paddingTop: 4, color: theme.mutedStrong, fontSize: 12, lineHeight: 18 },
    roundTime: {
      color: theme.ink,
      fontSize: 14,
      lineHeight: 21,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
  })
