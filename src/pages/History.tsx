// 历史记录页：列出所有 sessions，按状态筛选，点击跳转 Result。

import React, { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Header } from '../components/Header'
import { Button, Card, EmptyState, Pill } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import { listSessions } from '../services/storage'
import { ClimbSession } from '../core/types'
import { formatDuration } from '../core/math'

type Filter = 'all' | 'complete' | 'interrupted'

interface SessionCard {
  id: string
  routeName: string
  statusText: string
  statusTone: 'default' | 'good' | 'warn' | 'danger'
  completedAtText: string
  durationText: string
  floorsText: string
  steps: number
  ascentM: number
  confidencePercent: number
  complete: boolean
  interrupted: boolean
}

function dateText(ts: number): string {
  if (!ts) return '未知时间'
  const date = new Date(ts)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hour}:${minute}`
}

function toCard(session: ClimbSession): SessionCard {
  const interrupted = session.interruptions.length > 0
  let statusText = '未完成'
  let statusTone: SessionCard['statusTone'] = 'default'
  if (session.complete) {
    statusText = '完成'
    statusTone = 'good'
  } else if (interrupted) {
    statusText = '中断'
    statusTone = 'warn'
  } else if (session.confidence < 0.72) {
    statusText = '低置信'
    statusTone = 'warn'
  }
  return {
    id: session.id,
    routeName: session.routeSnapshot?.locationName ?? '已删除的路线',
    statusText,
    statusTone,
    completedAtText: dateText(session.endedAt),
    durationText: formatDuration(session.durationMs ?? 0),
    floorsText: `${session.startFloor}F → ${session.finalFloor}F`,
    steps: session.steps,
    ascentM: session.ascentM,
    confidencePercent: Math.round(session.confidence * 100),
    complete: session.complete,
    interrupted,
  }
}

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'complete', label: '完成' },
  { key: 'interrupted', label: '中断' },
]

export default function HistoryScreen({ navigation }: RootStackScreen<'History'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const [sessions, setSessions] = useState<SessionCard[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [totalCompleted, setTotalCompleted] = useState(0)
  const [totalAscent, setTotalAscent] = useState(0)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = (await listSessions()).map(toCard)
      setSessions(list)
      setTotalCompleted(list.filter((s) => s.complete).length)
      setTotalAscent(list.filter((s) => s.complete).reduce((sum, s) => sum + s.ascentM, 0))
    } catch (err) {
      console.warn('[palou] load sessions failed', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    // 从 Result 页返回时刷新
    const unsubscribe = navigation.addListener('focus', refresh)
    return unsubscribe
  }, [navigation, refresh])

  const filtered = applyFilter(sessions, filter)

  return (
    <View style={styles.page}>
      <Header title="历史记录" rightLabel="首页" onRightPress={() => navigation.navigate('RouteEdit')} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{totalCompleted}</Text>
            <Text style={styles.summaryLabel}>完成次数</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{totalAscent.toFixed(1)}</Text>
            <Text style={styles.summaryLabel}>累计爬升 m</Text>
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
            title={sessions.length ? '没有符合筛选条件的记录' : '还没有爬楼记录'}
            subtitle={sessions.length ? '试试切换筛选条件' : '完成第一次爬楼后会出现在这里'}
          />
        ) : (
          filtered.map((card) => (
            <Pressable
              key={card.id}
              style={styles.cardPressable}
              onPress={() => navigation.navigate('Result', { id: card.id })}
            >
              <Card raised style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {card.routeName}
                  </Text>
                  <Pill tone={card.statusTone}>{card.statusText}</Pill>
                </View>
                <Text style={styles.cardMeta}>
                  {card.completedAtText} · {card.durationText}
                </Text>
                <Text style={styles.cardMeta}>
                  {card.floorsText} · {card.ascentM} m · {card.steps} 步
                </Text>
                <Text style={styles.cardConfidence}>置信度 {card.confidencePercent}%</Text>
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

function applyFilter(sessions: SessionCard[], filter: Filter): SessionCard[] {
  if (filter === 'all') return sessions
  if (filter === 'complete') return sessions.filter((s) => s.complete)
  if (filter === 'interrupted') return sessions.filter((s) => s.interrupted)
  return sessions
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
      marginBottom: 6,
      gap: 8,
    },
    cardTitle: {
      flex: 1,
      color: theme.ink,
      fontSize: 16,
      fontWeight: '700',
    },
    cardMeta: {
      color: theme.muted,
      fontSize: 13,
      marginTop: 2,
    },
    cardConfidence: {
      color: theme.mutedStrong,
      fontSize: 12,
      marginTop: 6,
    },
  })
