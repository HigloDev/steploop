// 历史记录页：列出所有训练(Workout)与旧单轮记录(ClimbSession)，按时间倒序分组展示。
// - 恢复按日分组标题（今天 / 昨天 / X月X日）与每条记录的具体时间（HH:mm）；
// - 累计爬升主卡平滑受控切换趋势面板，避免重挂丢状态；
// - 抽出 memo 列表项组件与 useThemeStyles 样式缓存，降低搜索与切 Tab 渲染开销。

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { UIIcon, resolveUIIconName } from '../components/ui-icon'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'

import { Disclosure } from '../components/disclosure'
import { Header } from '../components/Header'
import { FlowSheet } from '../components/flow-sheet'
import { MotionPressable } from '../components/motion-pressable'
import { StatPair } from '../components/sport-ui'
import { TrendChart } from '../components/training-visuals'
import { loadFusionCheckpoint } from '../services/building-storage'
import { Button, EmptyState, Notice } from '../components/ui'
import {
  getHistoryFilterPaint,
  isLargeText,
  sport,
  Theme,
  typography,
  useTheme,
  useThemeStyles,
} from '../theme'
import { GlassBackdrop, getGlassSurfaceStyle, useGlassDockInset } from '../components/glass-material'
import { MotionCardAccent } from '../components/motion-ring-graphics'
import { MainTabScreen } from '../navigation/types'
import { listSessions } from '../services/storage'
import { historyRepository } from '../services/history-repository'
import { listWorkouts, loadActiveCheckpoint } from '../services/workout-storage'
import { calculateWorkoutSummary } from '../core/workout-summary'
import { getFloorTransitionCount } from '../core/floors'
import { ActiveWorkoutCheckpoint, ClimbSession, ClimbWorkout } from '../core/types'
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
  sortAt: number
  title: string
  subtitle: string
  statusText: string
  statusTone: 'default' | 'good' | 'warn' | 'danger'
  complete: boolean
  interrupted: boolean
  metricsLine: string
  highlightLine: string
  ascentM: number
  floors: number
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

function timeText(ts: number): string {
  if (!ts) return ''
  const date = new Date(ts)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function dayKey(ts: number): string {
  if (!ts) return 'unknown'
  const date = new Date(ts)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function formatDayHeading(ts: number): { main: string; tag: string } {
  const date = new Date(ts)
  const main = `${date.getMonth() + 1}月${date.getDate()}日`
  const now = new Date()
  const targetStr = date.toDateString()
  if (targetStr === now.toDateString()) return { main, tag: '今天' }
  const yesterday = new Date(now.getTime() - 86400000)
  if (targetStr === yesterday.toDateString()) return { main, tag: '昨天' }
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return { main, tag: weekdays[date.getDay()] }
}

function workoutToCard(w: ClimbWorkout): BaseCard {
  const summary = calculateWorkoutSummary(w.rounds, w.startedAt, w.endedAt)
  const interrupted = w.rounds.some(r => r.completionReason === 'interrupted')
  const complete = w.status === 'completed' && summary.completeRounds > 0
  let statusText = '未完成'
  let statusTone: BaseCard['statusTone'] = 'default'
  if (complete && !interrupted) {
    statusText = '已完成'
    statusTone = 'good'
  } else if (interrupted) {
    statusText = '含中断'
    statusTone = 'warn'
  }
  if (w.rounds.some(r => r.completionSource === 'manual' || (r.corrections?.length ?? 0) > 0)) {
    statusText = '已修正'
    statusTone = 'warn'
  }
  const pendingCount = w.rounds.filter(round => round.floorConfirmation === 'pending').length
  if (pendingCount) {
    statusText = `${pendingCount} 轮楼层待确认`
    statusTone = 'warn'
  }
  const estimatedCount = w.rounds.filter(round => round.estimated === true && !round.corrections?.length).length
  if (estimatedCount) {
    statusText = `${estimatedCount} 轮估算`
    statusTone = 'warn'
  }
  const floorsPerRound =
    getFloorTransitionCount(w.routeSnapshot.startFloor, w.routeSnapshot.endFloor) || w.routeSnapshot.floorsPerRound || 0
  return {
    id: w.id,
    kind: 'workout',
    sortAt: w.startedAt || w.endedAt || w.createdAt || 0,
    title: w.routeSnapshot.locationName || w.routeSnapshot.name,
    subtitle: `${w.routeSnapshot.startFloor}层 → ${w.routeSnapshot.endFloor}层 · 单轮 ${floorsPerRound} 层`,
    statusText,
    statusTone,
    complete,
    interrupted,
    metricsLine: `${summary.totalFloors} 层 · ${Math.round(summary.totalAscentM)} 米 · ${formatDuration(summary.totalElapsedMs)}`,
    ascentM: summary.totalAscentM,
    floors: summary.totalFloors,
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
  if (s.floorConfirmation === 'pending') {
    statusText = '楼层待确认'
    statusTone = 'warn'
  }
  const floors =
    s.floorConfirmation === 'pending'
      ? 0
      : Math.max(0, getFloorTransitionCount(s.startFloor, s.finalFloor) || s.floorsCompleted || 0)
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
    metricsLine: `${s.floorConfirmation === 'pending' ? '楼层待确认' : `${floors} 层`} · ${formatDuration(s.durationMs ?? 0)}`,
    ascentM: s.floorConfirmation === 'pending' ? 0 : s.ascentM,
    floors,
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
  { key: 'quarter', label: '季度趋势' },
]

const TREND_SPAN: Record<TrendBucket, number> = { week: 8, month: 6, quarter: 4 }
const QUARTERS = ['第一季度', '第二季度', '第三季度', '第四季度']

function formatTrendPeriod(label: string): string {
  const match = /^(\d{4})-(W|Q)?(\d{1,2})$/.exec(label)
  if (!match) return label
  const [, year, unit, value] = match
  const period = Number(value)
  if (unit === 'W') return `${year}年第${period}周`
  if (unit === 'Q') return `${year}年${QUARTERS[period - 1]}`
  return `${year}年${period}月`
}

function routeNameOf(workouts: ClimbWorkout[], templateId: string): string {
  const workout = workouts.find(item => item.templateId === templateId)
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

const HistoryCardRow = memo(function HistoryCardRow({
  card,
  showDateHeading,
  theme,
  styles,
  onOpen,
  onManage,
}: {
  card: BaseCard
  showDateHeading: boolean
  theme: Theme
  styles: ReturnType<typeof makeStyles>
  onOpen: (card: BaseCard) => void
  onManage: (card: BaseCard) => void
}) {
  const heading = showDateHeading ? formatDayHeading(card.sortAt) : null
  const clock = timeText(card.sortAt)
  return (
    <>
      {heading ? (
        <View style={styles.dateHeadingRow}>
          <Text accessibilityRole="header" style={styles.dateHeading}>{heading.main}</Text>
          {heading.tag ? <Text style={styles.dateHeadingTag}>{heading.tag}</Text> : null}
        </View>
      ) : null}
      <View style={[styles.card, getGlassSurfaceStyle(theme, 'card')]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${card.title}，${dateText(card.sortAt)}，${card.metricsLine}，${card.statusText}`}
          onPress={() => onOpen(card)}
          style={({ pressed }) => [styles.cardBody, pressed && { opacity: sport.opacity.pressed }]}
        >
          <View style={styles.recordIcon}>
            <UIIcon name="stairs" size={22} color={theme.brandInk} accessible={false} />
          </View>
          <View style={styles.cardCopy}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle} numberOfLines={2}>{card.title}</Text>
              <Text
                style={[
                  styles.statusLabel,
                  {
                    color:
                      card.statusTone === 'warn'
                        ? theme.amberInk
                        : card.statusTone === 'good'
                          ? theme.success
                          : theme.mutedStrong,
                  },
                ]}
              >
                {card.statusText}
              </Text>
            </View>
            <View style={styles.cardMetaRow}>
              <Text style={styles.cardMetrics} numberOfLines={1}>{card.metricsLine}</Text>
              {clock ? <Text style={styles.cardTime}>{clock}</Text> : null}
            </View>
            {card.interrupted || card.statusTone === 'warn' ? (
              <Text style={styles.cardHighlight}>{card.highlightLine}</Text>
            ) : null}
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`更多操作 ${card.title}`}
          onPress={() => onManage(card)}
          style={styles.moreButton}
        >
          <UIIcon name="more" size={22} color={theme.mutedStrong} accessible={false} />
        </Pressable>
      </View>
    </>
  )
})

export default function HistoryScreen({ navigation, route }: MainTabScreen<'History'>) {
  const theme = useTheme()
  const styles = useThemeStyles(makeStyles)
  const dockInset = useGlassDockInset()
  const insets = useSafeAreaInsets()
  const { width, fontScale } = useWindowDimensions()
  const stackedSummary = width < 360 || isLargeText(fontScale)

  const [cards, setCards] = useState<BaseCard[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [managing, setManaging] = useState<BaseCard | null>(null)
  const [totalCompleted, setTotalCompleted] = useState(0)
  const [totalAscent, setTotalAscent] = useState(0)
  const [week, setWeek] = useState({ validWorkouts: 0, floors: 0, ascentM: 0, consecutiveWeeks: 0 })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const refreshRequest = useRef(0)
  const [loadError, setLoadError] = useState('')
  const [checkpoint, setCheckpoint] = useState<ActiveWorkoutCheckpoint | null>(null)
  const [fusionPending, setFusionPending] = useState(false)
  const [workouts, setWorkouts] = useState<ClimbWorkout[]>([])
  const [trendBucket, setTrendBucket] = useState<TrendBucket>('week')
  const [trendOpen, setTrendOpen] = useState(false)
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>([])
  const [routeBests, setRouteBests] = useState<RoutePersonalBest[]>([])
  const [archiveNotice, setArchiveNotice] = useState<ArchiveNotice | undefined>(undefined)

  const refresh = useCallback(async (fromPull = false) => {
    const request = ++refreshRequest.current
    if (fromPull) setRefreshing(true)
    try {
      const [nextWorkouts, sessions, cp, summary, fusionCp] = await Promise.all([
        listWorkouts(),
        listSessions(),
        loadActiveCheckpoint(),
        historyRepository.summarize(),
        loadFusionCheckpoint(),
      ])
      if (request !== refreshRequest.current) return
      const items: BaseCard[] = [...nextWorkouts.map(workoutToCard), ...sessions.map(sessionToCard)]
      items.sort((a, b) => b.sortAt - a.sortAt)
      setLoadError('')
      setCards(items)
      const completed = items.filter(c => c.complete)
      setTotalCompleted(completed.length)
      setTotalAscent(completed.reduce((sum, c) => sum + c.ascentM, 0))
      const progress = deriveTrainingProgress(nextWorkouts)
      setWeek({
        validWorkouts: progress.validWorkouts,
        floors: progress.floors,
        ascentM: progress.ascentM,
        consecutiveWeeks: progress.consecutiveWeeks,
      })
      setCheckpoint(cp)
      setFusionPending(!!fusionCp)
      setWorkouts(nextWorkouts)
      setArchiveNotice(describeArchiveNotice(summary))
      setRouteBests(computeRoutePersonalBests(nextWorkouts))
    } catch (err) {
      if (request !== refreshRequest.current) return
      setLoadError('读取记录失败，请重试。')
      console.warn('[steploop] load history failed', err)
    } finally {
      if (request === refreshRequest.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  useEffect(() => {
    const { fromMs, toMs } = recentTrendWindow(trendBucket, TREND_SPAN[trendBucket])
    setTrendPoints(
      buildTrend(workouts, { bucket: trendBucket, fromMs, toMs }).map(point => ({
        ...point,
        label: formatTrendPeriod(point.label),
      })),
    )
  }, [trendBucket, workouts])

  const selectedDay = route?.params?.dayAt
  const dayLabel = selectedDay === undefined ? undefined : new Date(selectedDay).toDateString()
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return applyFilter(cards, filter).filter(
      card =>
        (!dayLabel || new Date(card.sortAt).toDateString() === dayLabel) &&
        (!normalizedQuery ||
          `${card.title} ${card.subtitle} ${dateText(card.sortAt)}`.toLocaleLowerCase().includes(normalizedQuery)),
    )
  }, [cards, filter, dayLabel, query])

  useEffect(() => {
    if (selectedDay !== undefined) {
      setFilter('all')
      setQuery('')
      setSearchOpen(false)
    }
  }, [selectedDay])

  const openCard = useCallback(
    (card: BaseCard) => {
      navigation.navigate(card.target.route, card.target.params)
    },
    [navigation],
  )

  const keyExtractor = useCallback((card: BaseCard) => `${card.kind}-${card.id}`, [])

  const renderItem = useCallback(
    ({ item: card, index }: { item: BaseCard; index: number }) => {
      const showDateHeading = index === 0 || dayKey(card.sortAt) !== dayKey(filtered[index - 1].sortAt)
      return (
        <HistoryCardRow
          card={card}
          showDateHeading={showDateHeading}
          theme={theme}
          styles={styles}
          onOpen={openCard}
          onManage={setManaging}
        />
      )
    },
    [filtered, openCard, styles, theme],
  )

  const goTrain = () => {
    if (typeof navigation.jumpTo === 'function') navigation.jumpTo('Train')
    else navigation.navigate('Train')
  }

  return (
    <View style={styles.page}>
      <GlassBackdrop />
      <Header
        title="记录"
        back={false}
        large
        rightContent={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={searchOpen ? '关闭搜索' : '搜索训练记录'}
            onPress={() => {
              setSearchOpen(open => !open)
              if (searchOpen) setQuery('')
            }}
            style={styles.headerAction}
          >
            <UIIcon name={resolveUIIconName(searchOpen ? 'close' : 'magnify')} size={24} color={theme.inkSoft} accessible={false} />
          </Pressable>
        }
      />
      <FlatList
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 + dockInset }]}
        data={filtered}
        keyExtractor={keyExtractor}
        refreshing={refreshing}
        keyboardShouldPersistTaps="handled"
        onRefresh={() => {
          void refresh(true)
        }}
        ListHeaderComponent={
          <>
            {fusionPending && !checkpoint ? (
              <Pressable accessibilityRole="button" style={styles.checkpoint} onPress={goTrain}>
                <UIIcon name="pause-circle" size={20} color={theme.amberInk} />
                <View style={styles.checkpointCopy}>
                  <Text style={styles.checkpointTitle}>有一场未结束的训练</Text>
                  <Text style={styles.checkpointSub}>回到首页继续或放弃</Text>
                </View>
                <UIIcon name="chevron-right" size={20} color={theme.amberInk} />
              </Pressable>
            ) : null}

            {checkpoint ? (
              <Pressable accessibilityRole="button" style={styles.checkpoint} onPress={goTrain}>
                <UIIcon name="pause-circle" size={20} color={theme.amberInk} />
                <View style={styles.checkpointCopy}>
                  <Text style={styles.checkpointTitle}>有一场未结束的训练</Text>
                  <Text style={styles.checkpointSub}>{PHASE_LABEL[checkpoint.phase]} · 返回训练页继续处理</Text>
                </View>
                <UIIcon name="chevron-right" size={20} color={theme.amberInk} />
              </Pressable>
            ) : null}

            {loading && cards.length === 0 ? (
              <ActivityIndicator style={styles.loading} color={theme.brandText} accessibilityLabel="正在读取记录" />
            ) : null}

            {loadError ? (
              <>
                <Notice tone="danger">{loadError}</Notice>
                <Button title="重新读取" onPress={() => { void refresh() }} />
              </>
            ) : null}

            {archiveNotice ? <Notice>{archiveNotice.text}</Notice> : null}

            {!searchOpen ? (
              <>
                {!loading && !loadError ? (
                  <View style={[styles.glassSummaryRow, stackedSummary && styles.glassSummaryRowStacked]}>
                    <MotionPressable
                      accessibilityRole="button"
                      accessibilityLabel={`累计爬升 ${Math.round(totalAscent)} 米，${trendOpen ? '收起' : '展开'}长期趋势`}
                      onPress={() => setTrendOpen(open => !open)}
                      style={[
                        styles.glassSummaryMain,
                        !stackedSummary && styles.glassSummaryMainWide,
                        getGlassSurfaceStyle(theme, 'feature'),
                        { overflow: 'hidden' },
                      ]}
                    >
                      <MotionCardAccent />
                      <Text style={styles.glassSummaryMainLabel}>累计爬升</Text>
                      <View style={styles.glassSummaryMainValueRow}>
                        <Text style={styles.glassSummaryMainValue} numberOfLines={1} adjustsFontSizeToFit>
                          {Math.round(totalAscent).toLocaleString()}
                        </Text>
                        <Text style={styles.glassSummaryMainUnit}>米</Text>
                      </View>
                      <View style={styles.glassSummaryLink}>
                        <Text style={styles.glassSummaryLinkText}>{trendOpen ? '收起长期趋势' : '查看长期趋势'}</Text>
                        <UIIcon
                          name={trendOpen ? 'chevron-up' : 'chevron-right'}
                          size={15}
                          color={theme.brandInk}
                          accessible={false}
                        />
                      </View>
                    </MotionPressable>

                    <View
                      style={[
                        styles.glassSummarySide,
                        !stackedSummary && styles.glassSummarySideWide,
                        getGlassSurfaceStyle(theme, 'card'),
                      ]}
                    >
                      <StatPair large label="累计完成" value={String(totalCompleted)} unit="次" />
                      <View style={styles.glassSummaryDivider} />
                      <StatPair large label="本周训练" value={String(week.validWorkouts)} unit="次" />
                    </View>
                  </View>
                ) : null}

                <Disclosure
                  icon="chart"
                  title="趋势与最佳成绩"
                  open={trendOpen}
                  onToggle={setTrendOpen}
                  dense
                >
                  <View style={styles.trendHeader}>
                    <Text style={styles.weekLabel}>长期趋势</Text>
                    <View style={styles.trendTabs}>
                      {TREND_BUCKETS.map(tab => (
                        <Pressable
                          key={tab.key}
                          accessibilityRole="tab"
                          accessibilityState={{ selected: trendBucket === tab.key }}
                          style={[styles.filterChip, trendBucket === tab.key && styles.filterChipActive]}
                          onPress={() => setTrendBucket(tab.key)}
                        >
                          <Text style={[styles.filterChipText, trendBucket === tab.key && styles.filterChipTextActive]}>
                            {tab.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                  <TrendChart points={trendPoints} />
                  <View style={styles.trendList}>
                    {trendPoints.map(point => (
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

                  {routeBests.length > 0 ? (
                    <View style={styles.trendList}>
                      <Text style={styles.weekLabel}>同路线最佳单轮</Text>
                      {routeBests.map(best => (
                        <View key={best.templateId} style={styles.trendItem}>
                          <Text style={styles.trendLabel}>{routeNameOf(workouts, best.templateId)}</Text>
                          <Text style={styles.trendValue}>
                            {best.bestRoundMs !== undefined ? `最快单轮 ${formatDuration(best.bestRoundMs)}` : '暂无完整轮'}{' '}
                            · {best.bestWorkoutFloors ?? 0} 层 · {(best.bestWorkoutAscentM ?? 0).toFixed(0)} 米
                            {best.fromCorrected ? ' · 含人工修正' : ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </Disclosure>
              </>
            ) : null}

            {searchOpen ? (
              <View style={[styles.search, getGlassSurfaceStyle(theme, 'card')]}>
                <UIIcon name="search" size={20} color={theme.mutedStrong} accessible={false} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="搜索楼栋或日期"
                  placeholderTextColor={theme.muted}
                  accessibilityLabel="输入楼栋或日期"
                  autoFocus
                  returnKeyType="search"
                  style={styles.searchInput}
                />
                {query ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="清空搜索"
                    onPress={() => setQuery('')}
                    style={styles.searchClear}
                  >
                    <UIIcon name="close-circle" size={19} color={theme.mutedStrong} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <View style={styles.listHeading}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>训练记录</Text>
              <Text style={styles.recordCount}>{filtered.length} 条</Text>
            </View>

            {selectedDay !== undefined ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="清除日期筛选，查看全部记录"
                style={styles.dayFilterChip}
                onPress={() => navigation.setParams({ dayAt: undefined })}
              >
                <Text style={styles.dayFilterText}>{dateText(selectedDay).split(' ')[0]} · 查看全部</Text>
                <UIIcon name="close-circle" size={16} color={theme.brandText} accessible={false} />
              </Pressable>
            ) : null}

            <View style={styles.filterRow}>
              {FILTERS.map(item => (
                <Pressable
                  key={item.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: filter === item.key }}
                  style={[styles.filterChip, filter === item.key && styles.filterChipActive]}
                  onPress={() => setFilter(item.key)}
                >
                  <Text style={[styles.filterChipText, filter === item.key && styles.filterChipTextActive]}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        }
        ListEmptyComponent={
          !loading && !loadError ? (
            <View style={{ gap: 12 }}>
              <EmptyState
                title={cards.length ? '没有符合筛选条件的记录' : '还没有爬楼记录'}
                subtitle={cards.length ? '试试切换筛选条件' : '完成第一次训练后会出现在这里'}
              />
              <Button
                title={cards.length ? '清除筛选' : '去训练首页'}
                variant="secondary"
                onPress={() => {
                  if (cards.length) {
                    setFilter('all')
                    setQuery('')
                    navigation.setParams({ dayAt: undefined })
                  } else {
                    goTrain()
                  }
                }}
              />
            </View>
          ) : null
        }
        renderItem={renderItem}
      />

      <FlowSheet visible={!!managing} title={managing?.title ?? '训练记录'} onClose={() => setManaging(null)}>
        <Button
          title="查看与修改"
          onPress={() => {
            if (!managing) return
            const card = managing
            setManaging(null)
            navigation.navigate(card.target.route, card.target.params)
          }}
        />
        {managing?.kind === 'workout' ? (
          <Button
            title="分享成绩"
            variant="secondary"
            onPress={() => {
              if (!managing) return
              const id = managing.target.params.id
              setManaging(null)
              navigation.navigate('ShareStudio', { id })
            }}
          />
        ) : null}
        <Button title="取消" variant="secondary" onPress={() => setManaging(null)} />
      </FlowSheet>
    </View>
  )
}

function applyFilter(cards: BaseCard[], filter: Filter): BaseCard[] {
  if (filter === 'all') return cards
  if (filter === 'complete') return cards.filter(c => c.complete)
  if (filter === 'interrupted') return cards.filter(c => c.interrupted)
  return cards
}

const makeStyles = (theme: Theme) => {
  const filterPaint = getHistoryFilterPaint(theme)
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: theme.pagePaddingH, paddingTop: 4 },
    headerAction: { minWidth: 48, minHeight: 48, alignItems: 'flex-end', justifyContent: 'center' },
    search: {
      borderRadius: theme.radius.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingLeft: 14,
      minHeight: 48,
      marginTop: 8,
      marginBottom: 4,
    },
    searchInput: { flex: 1, minWidth: 0, minHeight: 48, color: theme.ink, fontSize: sport.type.body, paddingVertical: 10 },
    searchClear: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    recordIcon: {
      width: 40,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: sport.radius.small,
      backgroundColor: theme.brandSoft,
    },
    statusLabel: { fontSize: 12, fontWeight: '600', paddingTop: 2, flexShrink: 1, maxWidth: '38%' },
    loading: { marginVertical: 24 },
    checkpoint: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 16,
      backgroundColor: theme.amberSoft,
      borderRadius: 14,
      marginBottom: 14,
      minHeight: 64,
    },
    checkpointCopy: { flex: 1 },
    checkpointTitle: { ...typography.label, color: theme.ink, fontWeight: '700' },
    checkpointSub: { color: theme.amberInk, fontSize: 14, lineHeight: 21, marginTop: 4 },
    glassSummaryRow: { flexDirection: 'row', gap: 12, marginBottom: sport.space.sm },
    glassSummaryRowStacked: { flexDirection: 'column' },
    glassSummaryMain: {
      alignSelf: 'stretch',
      borderRadius: sport.radius.panel,
      padding: 18,
      justifyContent: 'space-between',
      gap: 10,
    },
    glassSummaryMainWide: { flex: 1.5, minWidth: 0, alignSelf: 'auto' },
    glassSummaryMainLabel: { ...typography.label, color: theme.ink },
    glassSummaryMainValueRow: { flexDirection: 'row', alignItems: 'baseline', columnGap: 6, flexWrap: 'wrap' },
    glassSummaryMainValue: { ...typography.digits, color: theme.brandText, fontSize: 50, lineHeight: 56, flexShrink: 1 },
    glassSummaryMainUnit: { ...typography.label, color: theme.mutedStrong },
    glassSummaryLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    glassSummaryLinkText: { ...typography.caption, color: theme.brandInk, fontWeight: '600' },
    glassSummarySide: {
      alignSelf: 'stretch',
      borderRadius: sport.radius.panel,
      padding: 16,
      justifyContent: 'center',
      gap: 12,
    },
    glassSummarySideWide: { flex: 1, minWidth: 0, alignSelf: 'auto' },
    glassSummaryDivider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line },
    listHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16, marginBottom: 8 },
    sectionTitle: { ...typography.section, color: theme.ink },
    recordCount: { ...typography.caption, color: theme.mutedStrong },
    dateHeadingRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 14, marginBottom: 6 },
    dateHeading: { ...typography.secondary, color: theme.inkSoft, fontWeight: '700' },
    dateHeadingTag: { ...typography.caption, color: theme.mutedStrong },
    dayFilterChip: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 48,
      paddingHorizontal: 14,
      paddingVertical: 6,
      marginBottom: 10,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.brandSoft,
      borderWidth: 1,
      borderColor: theme.brandText,
    },
    dayFilterText: { ...typography.caption, color: theme.brandText, fontWeight: '700' },
    weekLabel: { color: theme.ink, fontSize: 16, lineHeight: 22, fontWeight: '700', marginBottom: 6 },
    trendHeader: { marginTop: 8, marginBottom: 8, paddingHorizontal: 4 },
    trendTabs: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    trendList: { marginBottom: 12, paddingHorizontal: 4 },
    trendItem: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
    trendLabel: { color: theme.mutedStrong, fontSize: 14, lineHeight: 21, fontWeight: '500' },
    trendValue: { color: theme.ink, fontSize: 14, lineHeight: 21, fontWeight: '600', marginTop: 4, fontVariant: ['tabular-nums'] },
    trendSub: { color: theme.mutedStrong, fontSize: 12, lineHeight: 18, marginTop: 4 },
    filterRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: sport.space.sm,
      marginBottom: sport.space.md,
      backgroundColor: theme.cardSoft,
      borderRadius: 12,
      padding: 4,
    },
    filterChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      minHeight: theme.tapMin,
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
    },
    filterChipActive: { backgroundColor: filterPaint.fill },
    filterChipText: { color: theme.mutedStrong, fontSize: 14, lineHeight: 21, fontWeight: '600' },
    filterChipTextActive: { color: filterPaint.ink, fontWeight: '700' },
    card: {
      marginBottom: sport.space.sm,
      borderRadius: theme.radius.md,
      position: 'relative',
    },
    cardBody: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 14,
    },
    cardCopy: { flex: 1, minWidth: 0, gap: 2 },
    moreButton: {
      position: 'absolute',
      right: 2,
      bottom: 0,
      minWidth: 48,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 8,
    },
    cardTitle: { ...typography.label, flex: 1, color: theme.ink, fontWeight: '600' },
    cardMetaRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
      paddingRight: 34,
      marginTop: 2,
    },
    cardMetrics: {
      ...typography.digits,
      color: theme.ink,
      fontSize: 16,
      lineHeight: 22,
      flexShrink: 1,
    },
    cardTime: {
      ...typography.caption,
      color: theme.mutedStrong,
      fontVariant: ['tabular-nums'],
    },
    cardHighlight: { color: theme.mutedStrong, fontSize: 12, lineHeight: 18, marginTop: 4, paddingRight: 32 },
  })
}
