// 历史记录页：列出所有训练(Workout)与旧单轮记录(ClimbSession)，按时间合并排序。
// 卡片显示多轮汇总或单轮摘要，点击跳转 WorkoutResult / Result。
// 顶部显示检查点恢复提示（如有未结束的训练）。

import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Disclosure } from '../components/disclosure'
import { Header } from '../components/Header'
import { Button, Card, EmptyState, Notice, Pill } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { MainTabScreen } from '../navigation/types'
import { listSessions } from '../services/storage'
import { historyRepository } from '../services/history-repository'
import {
  listWorkouts,
  loadActiveCheckpoint,
} from '../services/workout-storage'
import { discardCheckpointAsAbandoned } from '../services/checkpoint-completion'
import { calculateWorkoutSummary } from '../core/workout-summary'
import { getFloorAchievementCount } from '../core/floors'
import {
  ActiveWorkoutCheckpoint,
  ClimbSession,
  ClimbWorkout,
} from '../core/types'
import { formatDuration } from '../core/math'
import { deriveTrainingProgress } from '../core/training-progress'
import {
  ArchiveNotice,
  RoutePersonalBest,
  TrendBucket,
  TrendPoint,
  buildTrend,
  computeRoutePersonalBests,
  describeArchiveNotice,
  recentTrendWindow,
} from '../core/progress-trends'

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
  // 累计爬升米数（用于顶部汇总，避免从显示文本解析）
  ascentM: number
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
  if (w.rounds.some(r => r.completionSource === 'manual' || (r.corrections?.length ?? 0) > 0)) { statusText = '已修正'; statusTone = 'warn' }
  const pendingCount = w.rounds.filter(round => round.floorConfirmation === 'pending').length
  if (pendingCount) { statusText = `${pendingCount} 轮楼层待确认`; statusTone = 'warn' }
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
    metricsLine: `${summary.totalFloors} 层 · ${formatDuration(summary.activeDurationMs)} · ${summary.completeRounds} 轮`,
    ascentM: summary.totalAscentM,
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
  if (s.floorConfirmation === 'pending') { statusText = '楼层待确认'; statusTone = 'warn' }
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
    metricsLine: `${s.floorConfirmation === 'pending' ? '楼层待确认' : `${s.recognitionVersion === 'motion-v3' ? Math.max(0, s.finalFloor - s.startFloor) : getFloorAchievementCount(s.startFloor, s.finalFloor) || s.floorsCompleted} 层`} · ${formatDuration(s.durationMs ?? 0)}`,
    ascentM: s.floorConfirmation === 'pending' ? 0 : s.ascentM,
    highlightLine: `用时 ${formatDuration(s.durationMs ?? 0)} · 置信度 ${Math.round(s.confidence * 100)}%`,
    target: { route: 'Result', params: { id: s.id } },
  }
}

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'complete', label: '完成' },
  { key: 'interrupted', label: '中断' },
]

const TREND_BUCKETS: Array<{ key: TrendBucket; label: string }> = [
  { key: 'week', label: '周趋势' },
  { key: 'month', label: '月趋势' },
  { key: 'quarter', label: '季趋势' },
]

// 展示窗口（几个桶）属于展示范围，不是统计口径：口径全部由 core 的纯函数决定。
const TREND_SPAN: Record<TrendBucket, number> = { week: 8, month: 6, quarter: 4 }

/** 路线名只用于展示：PB 结果里只有 templateId，从已有列表里取一次显示名，不改任何口径。 */
function routeNameOf(workouts: ClimbWorkout[], templateId: string): string {
  const workout = workouts.find((item) => item.templateId === templateId)
  return workout?.routeSnapshot?.locationName || workout?.routeSnapshot?.name || templateId
}

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

export default function HistoryScreen({ navigation }: MainTabScreen<'History'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const [cards, setCards] = useState<BaseCard[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [totalCompleted, setTotalCompleted] = useState(0)
  const [totalAscent, setTotalAscent] = useState(0)
  const [week, setWeek] = useState({
    validWorkouts: 0,
    floors: 0,
    ascentM: 0,
    consecutiveWeeks: 0,
  })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [checkpoint, setCheckpoint] = useState<ActiveWorkoutCheckpoint | null>(null)
  const [workouts, setWorkouts] = useState<ClimbWorkout[]>([])
  const [trendBucket, setTrendBucket] = useState<TrendBucket>('week')
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>([])
  const [routeBests, setRouteBests] = useState<RoutePersonalBest[]>([])
  // 归档说明：数字与文案都来自 historyRepository.summarize() + core 的纯函数。
  const [archiveNotice, setArchiveNotice] = useState<ArchiveNotice | undefined>(undefined)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextWorkouts, sessions, cp, summary] = await Promise.all([
        listWorkouts(),
        listSessions(),
        loadActiveCheckpoint(),
        historyRepository.summarize(),
      ])
      const items: BaseCard[] = [
        ...nextWorkouts.map(workoutToCard),
        ...sessions.map(sessionToCard),
      ]
      items.sort((a, b) => b.sortAt - a.sortAt)
      setLoadError('')
      setCards(items)
      const completed = items.filter((c) => c.complete)
      setTotalCompleted(completed.length)
      setTotalAscent(
        completed.reduce((sum, c) => sum + c.ascentM, 0),
      )
      const progress = deriveTrainingProgress(nextWorkouts)
      setWeek({
        validWorkouts: progress.validWorkouts,
        floors: progress.floors,
        ascentM: progress.ascentM,
        consecutiveWeeks: progress.consecutiveWeeks,
      })
      setCheckpoint(cp)
      setWorkouts(nextWorkouts)
      setArchiveNotice(describeArchiveNotice(summary))
      setRouteBests(computeRoutePersonalBests(nextWorkouts))
    } catch (err) {
      setLoadError('读取记录失败，请重试。')
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

  // 趋势桶只在展示层选择窗口，桶统计仍由 core 的 buildTrend 计算。
  useEffect(() => {
    const { fromMs, toMs } = recentTrendWindow(trendBucket, TREND_SPAN[trendBucket])
    setTrendPoints(buildTrend(workouts, { bucket: trendBucket, fromMs, toMs }))
  }, [trendBucket, workouts])

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
            if (!checkpoint) return
            try {
              await discardCheckpointAsAbandoned(checkpoint)
              await refresh()
            } catch (error) {
              Alert.alert('未能放弃训练', error instanceof Error ? error.message : String(error))
            }
          },
        },
      ],
    )
  }

  return (
    <View style={styles.page}>
      <Header title="记录" back={false} large />
      <FlatList
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        data={loading ? [] : filtered}
        keyExtractor={card => `${card.kind}-${card.id}`}
        refreshing={loading && cards.length > 0}
        onRefresh={() => { void refresh() }}
        ListHeaderComponent={<>
        <Text style={styles.intro}>每一步向上，都留在这里。</Text>
        {checkpoint ? <Pressable accessibilityRole="button" style={styles.checkpoint} onPress={() => navigation.navigate('Train')}>
          <Feather name="pause-circle" size={20} color={theme.amberInk} />
          <View style={styles.checkpointCopy}><Text style={styles.checkpointTitle}>有一场未结束的训练</Text><Text style={styles.checkpointSub}>{PHASE_LABEL[checkpoint.phase]} · 返回训练页继续处理</Text></View>
          <Feather name="chevron-right" size={20} color={theme.amberInk} />
        </Pressable> : null}
        {loading && cards.length === 0 ? <ActivityIndicator style={styles.loading} color={theme.green} accessibilityLabel="正在读取记录" /> : null}
        {loadError ? <><Notice tone="danger">{loadError}</Notice><Button title="重新读取" onPress={() => { void refresh() }} /></> : null}
        {/* 归档说明（D09 验收 4b）：不再有与事实不符的容量文案（旧文案声称超限即删）。
            文案与数字来自 historyRepository.summarize() 的 trimmedTotal /
            aggregatesIncludeTrimmed / retainedWorkoutCount，页面不自行重算。 */}
        {archiveNotice ? (
          <Notice>
            {archiveNotice.text}
          </Notice>
        ) : null}

        {!loading || cards.length > 0 ? <View style={styles.weekHero}>
          <View style={styles.weekHeroHeading}><Text style={styles.weekLabel}>本周成果</Text><Feather name="trending-up" size={22} color={theme.green} /></View>
          <View style={styles.weekFloor} accessible accessibilityLabel={`本周共爬升 ${week.floors} 层`}>
            <Text style={styles.weekFloorValue}>{week.floors}</Text><Text style={styles.weekFloorUnit}>层爬升</Text>
          </View>
          <View style={styles.weekMetrics}>
            <View style={styles.weekMetricItem}><Text style={styles.weekMetric}>{week.validWorkouts} 次</Text><Text style={styles.weekMetricLabel}>训练</Text></View>
            <View style={styles.weekMetricItem}><Text style={styles.weekMetric}>{week.ascentM.toFixed(0)} 米</Text><Text style={styles.weekMetricLabel}>上升高度</Text></View>
            <View style={styles.weekMetricItem}><Text style={styles.weekMetric}>{week.consecutiveWeeks} 周</Text><Text style={styles.weekMetricLabel}>连续训练</Text></View>
          </View>
        </View> : null}
        <Disclosure title="趋势与最佳成绩">
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

        {/* 长期趋势（验收 8）：只展示 buildTrend 已经算好的桶，页面不做任何业务口径计算。 */}
        <View style={styles.trendHeader}>
          <Text style={styles.weekLabel}>长期趋势</Text>
          <View style={styles.trendTabs}>
            {TREND_BUCKETS.map((tab) => (
              <Pressable
                key={tab.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: trendBucket === tab.key }}
                style={[styles.filterChip, trendBucket === tab.key && styles.filterChipActive]}
                onPress={() => setTrendBucket(tab.key)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    trendBucket === tab.key && styles.filterChipTextActive,
                  ]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.trendList}>
          {trendPoints.map((point) => (
            <View key={point.bucketStart} style={styles.trendItem}>
              <Text style={styles.trendLabel}>{point.label}</Text>
              <Text style={styles.trendValue}>
                {point.workouts} 次 · {point.floors} 层 · {point.ascentM.toFixed(0)} 米 ·{' '}
                {formatDuration(point.activeDurationMs)}
              </Text>
              {point.bestRoundMs !== undefined ? (
                <Text style={styles.trendSub}>最快单轮 {formatDuration(point.bestRoundMs)}</Text>
              ) : null}
              <Text style={styles.trendSub}>
                已排除 {point.excluded.corrected} 修正 · {point.excluded.invalid} 无效 ·{' '}
                {point.excluded.duplicate} 重复
              </Text>
            </View>
          ))}
        </View>

        {/* 同路线个人最佳（默认不含人工修正过的成绩） */}
        {routeBests.length > 0 ? (
          <View style={styles.trendList}>
            <Text style={styles.weekLabel}>同路线最佳单轮</Text>
            {routeBests.map((best) => (
              <View key={best.templateId} style={styles.trendItem}>
                <Text style={styles.trendLabel}>
                  {routeNameOf(workouts, best.templateId)}
                </Text>
                <Text style={styles.trendValue}>
                  {best.bestRoundMs !== undefined
                    ? `最快单轮 ${formatDuration(best.bestRoundMs)}`
                    : '暂无完整轮'}{' '}
                  · {best.bestWorkoutFloors ?? 0} 层 · {(best.bestWorkoutAscentM ?? 0).toFixed(0)} 米
                  {best.fromCorrected ? ' · 含人工修正' : ''}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={styles.trendSub}>新训练的累计与趋势包含你确认的实际成果；历史记录沿用原有口径。个人最佳与路线学习仅采用可信数据。</Text>
        </Disclosure>
        <View style={styles.listHeading}><Text accessibilityRole="header" style={styles.sectionTitle}>训练记录</Text><Text style={styles.recordCount}>{filtered.length} 条</Text></View>
        <View style={styles.filterRow}>
          {FILTERS.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: filter === item.key }}
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

        </>}
        ListEmptyComponent={!loading && !loadError ? (
          <EmptyState
            title={cards.length ? '没有符合筛选条件的记录' : '还没有爬楼记录'}
            subtitle={cards.length ? '试试切换筛选条件' : '完成第一次训练后会出现在这里'}
          />
        ) : null}
        renderItem={({ item: card, index }) => (
          <>
            {index === 0 || dateText(card.sortAt).split(' ')[0] !== dateText(filtered[index - 1].sortAt).split(' ')[0] ? <Text style={styles.dateHeading}>{dateText(card.sortAt).split(' ')[0]}</Text> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${card.title}，${dateText(card.sortAt)}，${card.metricsLine}，${card.statusText}`}
              style={styles.cardPressable}
              onPress={() => navigation.navigate(card.target.route, card.target.params)}
            >
              <Card style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.cardTitle} >
                    {card.title}
                  </Text>
                  <Pill tone={card.statusTone}>{card.statusText}</Pill>
                </View>
                <Text style={styles.cardDate}>{dateText(card.sortAt).split(' ')[1] || '未知时间'} · {card.kind === 'workout' ? '多轮训练' : '单轮记录'}</Text>
                <Text style={styles.cardMetrics}>{card.metricsLine}</Text>
                <Text style={styles.cardHighlight}>{card.highlightLine}</Text>
              </Card>
            </Pressable>
          </>
        )}
      />
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
    content: { paddingHorizontal: 20, paddingTop: 8 },
    intro: { color: theme.mutedStrong, fontSize: 15, lineHeight: 22, marginBottom: 24 },
    loading: { marginVertical: 24 },
    checkpoint: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: theme.amberSoft, borderRadius: 14, marginBottom: 16, minHeight: 64 },
    checkpointCopy: { flex: 1 },
    checkpointSub: { color: theme.amberInk, fontSize: 14, lineHeight: 21, marginTop: 4 },
    weekHero: { backgroundColor: theme.greenSoft, borderRadius: 20, padding: 20, marginBottom: 24 },
    weekHeroHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    weekFloor: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginVertical: 12 },
    weekFloorValue: { color: theme.green, fontSize: 48, lineHeight: 58, fontWeight: '700', fontVariant: ['tabular-nums'] },
    weekFloorUnit: { color: theme.mutedStrong, fontSize: 15, lineHeight: 22 },
    weekMetricItem: { flex: 1 },
    weekMetricLabel: { color: theme.mutedStrong, fontSize: 12, lineHeight: 18, marginTop: 4 },
    listHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 24, marginBottom: 12 },
    sectionTitle: { color: theme.ink, fontSize: 17, lineHeight: 24, fontWeight: '600' },
    recordCount: { color: theme.mutedStrong, fontSize: 12, lineHeight: 18 },
    dateHeading: { color: theme.mutedStrong, fontSize: 12, lineHeight: 18, marginTop: 16, marginBottom: 8 },
    summaryRow: {
      flexDirection: 'row',
      gap: 16,
      marginVertical: 12,
    },
    summaryItem: {
      flex: 1,
      paddingVertical: 12,
    },
    summaryValue: {
      color: theme.ink,
      fontSize: 28,
      lineHeight: 34,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    summaryLabel: {
      marginTop: 4,
      color: theme.mutedStrong,
      fontSize: 12,
      lineHeight: 18,
    },
    weekRow: {
      marginBottom: 12,
      paddingHorizontal: 4,
    },
    weekLabel: {
      color: theme.ink,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '600',
      marginBottom: 8,
    },
    weekMetrics: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
      flexWrap: 'wrap',
    },
    weekMetric: {
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    trendHeader: {
      marginBottom: 8,
      paddingHorizontal: 4,
    },
    trendTabs: {
      flexDirection: 'row',
      gap: 8,
      flexWrap: 'wrap',
    },
    trendList: {
      marginBottom: 12,
      paddingHorizontal: 4,
    },
    trendItem: {
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    trendLabel: {
      color: theme.mutedStrong,
      fontSize: 14,
      lineHeight: 21,
      fontWeight: '500',
    },
    trendValue: {
      color: theme.ink,
      fontSize: 14,
      lineHeight: 21,
      fontWeight: '600',
      marginTop: 4,
      fontVariant: ['tabular-nums'],
    },
    trendSub: {
      color: theme.mutedStrong,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 4,
    },
    filterRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 12,
      backgroundColor: theme.card,
      borderRadius: 14,
      padding: 4,
    },
    filterChip: {
      paddingHorizontal: 14,
      paddingVertical: 12,
      minHeight: 48,
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 10,
    },
    filterChipActive: {
      backgroundColor: theme.greenSoft,
    },
    filterChipText: {
      color: theme.mutedStrong,
      fontSize: 14,
      lineHeight: 21,
      fontWeight: '600',
    },
    filterChipTextActive: {
      color: theme.green,
    },
    cardPressable: {
      marginBottom: 12,
    },
    card: {
      padding: 16,
      borderRadius: 20,
    },
    cardHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 4,
      gap: 8,
    },
    cardTitle: {
      flex: 1,
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
    },
    cardDate: {
      color: theme.mutedStrong,
      fontSize: 12,
      lineHeight: 18,
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
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
      marginTop: 16,
    },
    cardHighlight: {
      color: theme.mutedStrong,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 4,
    },
    checkpointTitle: {
      color: theme.amberInk,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '600',
    },
    checkpointAction: {
      color: theme.green,
      fontSize: 13,
      fontWeight: '700',
      textDecorationLine: 'underline',
    },
  })
