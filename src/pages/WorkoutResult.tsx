// 训练总结页：展示本次核心数据，并进入静态海报分享。

import React, { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Header } from '../components/Header'
import { Button, Card, Metric, Pill } from '../components/ui'
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
      const progress = deriveTrainingProgress(workouts, stored.endedAt ?? Date.now())
      setSuggestion(trainingSuggestion(stored, progress))
      setIsPersonalBest(
        progress.personalBests[stored.templateId]?.workoutId === stored.id,
      )
      if (storedRoute) {
        const learning = summarizeRouteLearning(storedRoute, workouts)
        setLearningLabel(learning.stageLabel)
        setLearningMessage(learning.message)
      }
    }
    load().catch(() => setError('训练总结加载失败'))
    return () => {
      mounted = false
    }
  }, [route.params.id])

  if (!workout || !summary) {
    return (
      <View style={styles.page}>
        <Header title="训练总结" back />
        <View style={styles.center}>
          <Text style={styles.loadingText}>{error || '正在整理成果…'}</Text>
          {error ? (
            <Button
              title="返回首页"
              onPress={() => navigation.navigate('RouteEdit')}
            />
          ) : null}
        </View>
      </View>
    )
  }

  const bestRound = workout.rounds
    .filter((round) => round.complete)
    .slice()
    .sort((a, b) => a.durationMs - b.durationMs)[0]
  const hasCompletedRound = summary.completeRounds > 0

  return (
    <View style={styles.page}>
      <Header title="训练总结" back />
      <ScrollView
        style={styles.flex}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
      >
        <Card raised style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View style={styles.heroCopy}>
              <Text style={styles.routeName}>
                {workout.routeSnapshot.locationName}
              </Text>
              <Text style={styles.date}>{dateText(workout.startedAt)}</Text>
            </View>
            <Pill tone={hasCompletedRound ? 'good' : 'warn'}>
              {isPersonalBest ? '个人最佳' : hasCompletedRound ? '完成' : '未完成'}
            </Pill>
          </View>
          <View style={styles.heroMetric}>
            <Text style={styles.heroNumber}>{summary.totalFloors}</Text>
            <Text style={styles.heroUnit}>层</Text>
          </View>
          <Text style={styles.heroStatement}>
            今天，你一直在向上。
          </Text>
        </Card>

        {suggestion ? (
          <Card raised style={styles.learningCard}>
            <Text style={styles.cardTitle}>下一次建议</Text>
            <Text style={styles.learningText}>{suggestion}</Text>
          </Card>
        ) : null}

        <View style={styles.metricGrid}>
          <Metric
            label="累计爬升"
            value={`${summary.totalAscentM.toFixed(1)}米`}
            style={styles.metric}
          />
          <Metric
            label="净爬楼"
            value={formatDuration(summary.activeDurationMs)}
            style={styles.metric}
          />
          <Metric
            label="完成轮数"
            value={summary.completeRounds}
            style={styles.metric}
          />
          <Metric
            label="累计步数"
            value={summary.totalSteps}
            style={styles.metric}
          />
        </View>

        <Card raised style={styles.performanceCard}>
          <Text style={styles.cardTitle}>表现概览</Text>
          <View style={styles.performanceRows}>
            <View style={styles.performanceRow}>
              <Text style={styles.performanceLabel}>最快一轮</Text>
              <Text style={styles.performanceValue}>
                {bestRound ? formatDuration(bestRound.durationMs) : '—'}
              </Text>
            </View>
            <View style={styles.performanceRow}>
              <Text style={styles.performanceLabel}>平均一轮</Text>
              <Text style={styles.performanceValue}>
                {summary.averageRoundMs
                  ? formatDuration(summary.averageRoundMs)
                  : '—'}
              </Text>
            </View>
            <View style={styles.performanceRow}>
              <Text style={styles.performanceLabel}>平均每层</Text>
              <Text style={styles.performanceValue}>
                {summary.totalFloors > 0
                  ? formatDuration(
                      Math.round(
                        summary.activeDurationMs / summary.totalFloors,
                      ),
                    )
                  : '—'}
              </Text>
            </View>
            <View style={styles.performanceRow}>
              <Text style={styles.performanceLabel}>总历时</Text>
              <Text style={styles.performanceValue}>
                {formatDuration(summary.totalElapsedMs)}
              </Text>
            </View>
          </View>
        </Card>

        {learningLabel ? (
          <Card raised style={styles.learningCard}>
            <View style={styles.learningHeader}>
              <Text style={styles.cardTitle}>路线学习</Text>
              <Pill tone={learningLabel === '路线已验证' ? 'good' : 'warn'}>
                {learningLabel}
              </Pill>
            </View>
            <Text style={styles.learningText}>{learningMessage}</Text>
          </Card>
        ) : null}

        {workout.rounds.length > 0 ? (
          <Card raised style={styles.roundCard}>
            <Text style={styles.cardTitle}>每一轮</Text>
            {workout.rounds.map((round) => (
              <View key={round.id} style={styles.roundRow}>
                <View style={styles.roundIdentity}>
                  <Text style={styles.roundTitle}>第 {round.roundNumber} 轮</Text>
                  <Text style={styles.roundSub}>
                    {getRoundAchievementCount(round)} 层 · {round.steps} 步
                  </Text>
                </View>
                <Text style={styles.roundTime}>
                  {formatDuration(round.durationMs)}
                </Text>
                {bestRound?.id === round.id ? (
                  <Pill tone="good">最快</Pill>
                ) : null}
              </View>
            ))}
          </Card>
        ) : null}

        <Button
          title="制作我的分享成果"
          onPress={() =>
            navigation.navigate('ShareStudio', { id: workout.id })
          }
        />
        <Button
          title="再来一次"
          variant="secondary"
          onPress={() =>
            navigation.replace('WorkoutSetup', {
              id: workout.templateId,
            })
          }
        />
        <Button
          title="返回首页"
          variant="secondary"
          onPress={() => navigation.navigate('RouteEdit')}
        />
      </ScrollView>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: {
      paddingHorizontal: theme.pagePaddingH,
      gap: 10,
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 20,
    },
    loadingText: { color: theme.muted, fontSize: 14 },
    heroCard: {
      marginTop: 8,
      padding: 18,
      backgroundColor: theme.greenSoft,
      overflow: 'hidden',
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
      paddingTop: 5,
      color: theme.ink,
      fontSize: 20,
      fontWeight: '800',
    },
    date: { paddingTop: 4, color: theme.muted, fontSize: 11 },
    heroMetric: {
      flexDirection: 'row',
      alignItems: 'baseline',
      paddingTop: 14,
    },
    heroNumber: {
      color: theme.green,
      fontSize: 62,
      fontWeight: '900',
      fontVariant: ['tabular-nums'],
    },
    heroUnit: {
      paddingLeft: 6,
      color: theme.green,
      fontSize: 20,
      fontWeight: '800',
    },
    heroStatement: {
      color: theme.ink,
      fontSize: 15,
      fontWeight: '700',
    },
    metricGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    metric: { flex: 1, minWidth: '45%' },
    performanceCard: { padding: 14 },
    cardTitle: { color: theme.ink, fontSize: 15, fontWeight: '800' },
    performanceRows: { paddingTop: 8 },
    performanceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 7,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    performanceLabel: { color: theme.muted, fontSize: 13 },
    performanceValue: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    learningCard: { padding: 14 },
    learningHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    learningText: {
      paddingTop: 8,
      color: theme.muted,
      fontSize: 12,
      lineHeight: 18,
    },
    roundCard: { padding: 14 },
    roundRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 9,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    roundIdentity: { flex: 1 },
    roundTitle: { color: theme.ink, fontSize: 13, fontWeight: '700' },
    roundSub: { paddingTop: 2, color: theme.muted, fontSize: 10 },
    roundTime: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
  })
