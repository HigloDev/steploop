// 历史记录页：列出所有训练(Workout)与旧单轮记录(ClimbSession)，按时间合并排序。
// 卡片显示多轮汇总或单轮摘要，点击跳转 WorkoutResult / Result。
// 顶部显示检查点恢复提示（如有未结束的训练）。

import React, { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Header } from '../components/Header'
import { Button, Card, EmptyState, Notice, Pill } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import { listSessions } from '../services/storage'
import {
  clearActiveCheckpoint,
  listWorkouts,
  loadActiveCheckpoint,
} from '../services/workout-storage'
import { calculateWorkoutSummary } from '../core/workout-summary'
import { getFloorAchievementCount } from '../core/floors'
import {
  ActiveWorkoutCheckpoint,
  ClimbSession,
  ClimbWorkout,
} from '../core/types'
import { formatDuration } from '../core/math'

type Filter = 'all' | 'complete' | 'interrupted'

interface BaseCard {
  id: string
  kind: 'workout' | 'legacy_session'
  // 排序时间戳
  sortAt: number
  // 摘要数据
  title: string
  subtitle: string
  // 状态
  statusText: string
  statusTone: 'default' | 'good' | 'warn' | 'danger'
  complete: boolean
  interrupted: boolean
  // 详情
  metricsLine: string
  highlightLine: string
  // 跳转目标
  target: { route: 'WorkoutResult'; params: { id: string } } | { route: 'Result'; params: { id: string } }
}

function dateText(ts: number): string {
  if (!ts) return '未知时间'
  const date = new Date(ts)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${date.getFullYear()}.${month}.${day} ${hour}:${minute}`
}

function workoutToCard(w: ClimbWorkout): BaseCard {
  const summary = calculateWorkoutSummary(w.rounds, w.startedAt, w.endedAt)
  const interrupted = w.rounds.some((r) => r.completionReason === 'interrupted')
  const complete = w.status === 'completed' && summary.completeRounds > 0
  let statusText = '未完成'
  let statusTone: BaseCard['statusTone'] = 'default'
  if (complete && !interrupted) {
    statusText = `${summary.completeRounds} 轮`
    statusTone = 'good'
  } else if (interrupted) {
    statusText = '含中断'
    statusTone = 'warn'
  }
  const floorsPerRound =
    getFloorAchievementCount(
      w.routeSnapshot.startFloor,
      w.routeSnapshot.endFloor,
    ) || w.routeSnapshot.floorsPerRound || 0
  const floorsText = summary.totalFloors > 0 ? `${summary.totalFloors} 层` : ''
  const ascentText = `${summary.totalAscentM.toFixed(1)}米`
  const stepsText = `${summary.totalSteps} 步`
  return {
    id: w.id,
    kind: 'workout',
    sortAt: w.updatedAt || w.startedAt,
    title: w.routeSnapshot.locationName || w.routeSnapshot.name,
    subtitle: `${w.routeSnapshot.startFloor}层 → ${w.routeSnapshot.endFloor}层 · 单轮 ${floorsPerRound} 层`,
    statusText,
    statusTone,
    complete,
    interrupted,
    metricsLine: `${floorsText} · ${ascentText} · ${stepsText}`,
    highlightLine: `净爬楼 ${formatDuration(summary.activeDurationMs)} · 总历时 ${formatDuration(summary.totalElapsedMs)}${
      summary.bestRoundMs ? ` · 最快 ${formatDuration(summary.bestRoundMs)}` : ''
    }`,
    target: { route: 'WorkoutResult', params: { id: w.id } },
  }
}

function sessionToCard(s: ClimbSession): BaseCard {
  const interrupted = s.interruptions.length > 0
  let statusText = '未完成'
  let statusTone: BaseCard['statusTone'] = 'default'
  if (s.complete) {
    statusText = '完成'
    statusTone = 'good'
  } else if (interrupted) {
    statusText = '中断'
    statusTone = 'warn'
  } else if (s.confidence < 0.72) {
    statusText = '低置信'
    statusTone = 'warn'
  }
  return {
    id: s.id,
    kind: 'legacy_session',
    sortAt: s.endedAt || s.startedAt,
    title: s.routeSnapshot?.locationName ?? '已删除的路线',
    subtitle: '单轮记录',
    statusText,
    statusTone,
    complete: s.complete,
    interrupted,
    metricsLine: `${s.startFloor}层 → ${s.finalFloor}层 · ${s.ascentM}米 · ${s.steps} 步`,
    highlightLine: `用时 ${formatDuration(s.durationMs ?? 0)} · 置信度 ${Math.round(s.confidence * 100)}%`,
    target: { route: 'Result', params: { id: s.id } },
  }
}

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'complete', label: '完成' },
  { key: 'interrupted', label: '中断' },
]

const PHASE_LABEL: Record<ActiveWorkoutCheckpoint['phase'], string> = {
  setup: '准备中',
  round_ready: '准备下一轮',
  countdown: '倒计时中',
  ascending: '爬楼中',
  round_complete: '本轮完成',
  returning: '返回起点中',
  start_confirmation: '确认返回起点',
  recovering: '恢复休息中',
  workout_complete: '已完成',
}

export default function HistoryScreen({ navigation }: RootStackScreen<'History'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const [cards, setCards] = useState<BaseCard[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [totalCompleted, setTotalCompleted] = useState(0)
  const [totalAscent, setTotalAscent] = useState(0)
  const [loading, setLoading] = useState(true)
  const [checkpoint, setCheckpoint] = useState<ActiveWorkoutCheckpoint | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [workouts, sessions, cp] = await Promise.all([
        listWorkouts(),
        listSessions(),
        loadActiveCheckpoint(),
      ])
      const items: BaseCard[] = [
        ...workouts.map(workoutToCard),
        ...sessions.map(sessionToCard),
      ]
      items.sort((a, b) => b.sortAt - a.sortAt)
      setCards(items)
      const completed = items.filter((c) => c.complete)
      setTotalCompleted(completed.length)
      setTotalAscent(
        completed.reduce((sum, c) => {
          // 从成绩文字中解析爬升米数
          const match = c.metricsLine.match(/([\d.]+)米/)
          return sum + (match ? parseFloat(match[1]) : 0)
        }, 0),
      )
      setCheckpoint(cp)
    } catch (err) {
      console.warn('[steploop] load history failed', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const unsubscribe = navigation.addListener('focus', refresh)
    return unsubscribe
  }, [navigation, refresh])

  const filtered = applyFilter(cards, filter)

  const handleDiscardCheckpoint = () => {
    Alert.alert(
      '放弃未结束的训练？',
      '当前训练检查点会被清除，已完成的轮次不会保存。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '放弃',
          style: 'destructive',
          onPress: async () => {
            await clearActiveCheckpoint()
            setCheckpoint(null)
          },
        },
      ],
    )
  }

  return (
    <View style={styles.page}>
      <Header title="历史记录" rightLabel="首页" onRightPress={() => navigation.navigate('RouteEdit')} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        {/* 检查点恢复提示 */}
        {checkpoint && (
          <Notice tone="warn">
            <Text style={styles.checkpointTitle}>
              发现未结束的训练
            </Text>
            {'\n'}
            已完成 {checkpoint.completedRounds.filter((r) => r.complete).length} 轮 ·{' '}
            {PHASE_LABEL[checkpoint.phase] ?? checkpoint.phase}
            {'\n'}
            <Text
              style={styles.checkpointAction}
              onPress={() =>
                navigation.navigate('ClimbWorkout', {
                  id: checkpoint.templateId,
                  goal: checkpoint.goal,
                  returnConfirmationMode: checkpoint.returnConfirmationMode,
                })
              }
            >
              继续训练
            </Text>
            {'  ·  '}
            <Text style={styles.checkpointAction} onPress={handleDiscardCheckpoint}>
              放弃保存
            </Text>
          </Notice>
        )}

        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{totalCompleted}</Text>
            <Text style={styles.summaryLabel}>完成次数</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{totalAscent.toFixed(1)}</Text>
            <Text style={styles.summaryLabel}>累计爬升米数</Text>
          </View>
        </View>

        <View style={styles.filterRow}>
          {FILTERS.map((item) => (
            <Pressable
              key={item.key}
              style={[styles.filterChip, filter === item.key && styles.filterChipActive]}
              onPress={() => setFilter(item.key)}
            >
              <Text
                style={[styles.filterChipText, filter === item.key && styles.filterChipTextActive]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {!loading && filtered.length === 0 ? (
          <EmptyState
            title={cards.length ? '没有符合筛选条件的记录' : '还没有爬楼记录'}
            subtitle={cards.length ? '试试切换筛选条件' : '完成第一次训练后会出现在这里'}
          />
        ) : (
          filtered.map((card) => (
            <Pressable
              key={`${card.kind}-${card.id}`}
              style={styles.cardPressable}
              onPress={() => navigation.navigate(card.target.route, card.target.params)}
            >
              <Card raised style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {card.title}
                  </Text>
                  <Pill tone={card.statusTone}>{card.statusText}</Pill>
                </View>
                <Text style={styles.cardDate}>{dateText(card.sortAt)}</Text>
                <Text style={styles.cardSubtitle}>{card.subtitle}</Text>
                <Text style={styles.cardMetrics}>{card.metricsLine}</Text>
                <Text style={styles.cardHighlight}>{card.highlightLine}</Text>
              </Card>
            </Pressable>
          ))
        )}

        <Button
          title="返回首页"
          variant="secondary"
          onPress={() => navigation.navigate('RouteEdit')}
        />
      </ScrollView>
    </View>
  )
}

function applyFilter(cards: BaseCard[], filter: Filter): BaseCard[] {
  if (filter === 'all') return cards
  if (filter === 'complete') return cards.filter((c) => c.complete)
  if (filter === 'interrupted') return cards.filter((c) => c.interrupted)
  return cards
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: theme.pagePaddingH },
    summaryRow: {
      flexDirection: 'row',
      gap: 10,
      marginVertical: 12,
    },
    summaryItem: {
      flex: 1,
      backgroundColor: theme.card,
      borderRadius: theme.radiusLg,
      padding: 14,
      alignItems: 'center',
      ...theme.shadowSoft,
    },
    summaryValue: {
      color: theme.ink,
      fontSize: 22,
      fontWeight: '800',
    },
    summaryLabel: {
      marginTop: 4,
      color: theme.muted,
      fontSize: 12,
    },
    filterRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 12,
      flexWrap: 'wrap',
    },
    filterChip: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: theme.surfaceSoft,
    },
    filterChipActive: {
      backgroundColor: theme.greenSoft,
    },
    filterChipText: {
      color: theme.muted,
      fontSize: 13,
      fontWeight: '600',
    },
    filterChipTextActive: {
      color: theme.green,
    },
    cardPressable: {
      marginBottom: 8,
    },
    card: {
      padding: 14,
    },
    cardHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 4,
      gap: 8,
    },
    cardTitle: {
      flex: 1,
      color: theme.ink,
      fontSize: 16,
      fontWeight: '700',
    },
    cardDate: {
      color: theme.muted,
      fontSize: 12,
      marginTop: 2,
    },
    cardSubtitle: {
      color: theme.mutedStrong,
      fontSize: 12,
      marginTop: 6,
      fontWeight: '600',
    },
    cardMetrics: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '700',
      marginTop: 6,
    },
    cardHighlight: {
      color: theme.green,
      fontSize: 12,
      marginTop: 4,
      fontWeight: '600',
    },
    checkpointTitle: {
      color: theme.amberInk,
      fontSize: 14,
      fontWeight: '700',
    },
    checkpointAction: {
      color: theme.green,
      fontSize: 13,
      fontWeight: '700',
      textDecorationLine: 'underline',
    },
  })
