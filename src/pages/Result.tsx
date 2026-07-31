// 成绩页：从 getSession(id) 加载，展示楼层/爬升/用时/步数等，含"再爬一次"和"返回首页"。

import React, { useEffect, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Header } from '../components/Header'
import { Button, Card, Metric, Pill } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import { getRoute, getSession } from '../services/storage'
import { formatDuration } from '../core/math'
import { splitDurations, normalizeSession } from '../core/session'
import { ClimbSession, RouteTemplate } from '../core/types'
import { getFloorAchievementCount } from '../core/floors'

function dateText(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function ResultScreen({ navigation, route }: RootStackScreen<'Result'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const id = route.params.id
  const [session, setSession] = useState<ClimbSession | null>(null)
  const [routeName, setRouteName] = useState('')
  const [statusTitle, setStatusTitle] = useState('')
  const [statusText, setStatusText] = useState('')
  const [floorSplits, setFloorSplits] = useState<
    Array<{ floor: number; time: string; split: string; fastest: boolean }>
  >([])
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let mounted = true
    getSession(id)
      .then((stored) => {
        if (!mounted) return
        if (!stored) {
          setLoadError('记录不存在')
          Alert.alert('记录不存在', '该成绩可能已被删除。', [
            { text: '返回', onPress: () => navigation.navigate('RouteEdit') },
          ])
          return
        }
        getRoute(stored.templateId).then((route: RouteTemplate | undefined) => {
          if (!mounted) return
          const normalized = normalizeSession(stored, route)
          setSession(normalized)
          setRouteName(
            normalized.routeSnapshot?.locationName ?? route?.name ?? '已删除的路线',
          )
          const durations = splitDurations(normalized)
          const best = durations.length ? Math.min(...durations) : 0
          let title = '本次记录'
          let text = `路线匹配到${normalized.finalFloor}层，未到达模板终点。`
          if (normalized.complete) {
            title = '完整完成'
            text = '路线全程匹配，且没有检测到传感器中断。'
          } else if (normalized.interruptions.length) {
            text = '本次出现锁屏、切出应用或传感器断流，因此不是完整成绩。'
          } else if (normalized.confidence < 0.72) {
            text = '路线未完整匹配，系统保持最后确认楼层，没有补猜。'
          }
          setStatusTitle(title)
          setStatusText(text)
          setFloorSplits(
            normalized.floorSplits.map((split, index) => ({
              floor: split.floor,
              time: formatDuration(split.elapsedMs),
              split: formatDuration(durations[index] ?? 0),
              fastest: best > 0 && durations[index] === best,
            })),
          )
        })
      })
      .catch((err) => {
        console.warn('[steploop] load session failed', err)
        setLoadError('加载失败')
      })
    return () => {
      mounted = false
    }
  }, [id, navigation])

  if (!session && !loadError) {
    return (
      <View style={styles.page}>
        <Header title="成绩" back />
        <View style={styles.loading}>
          <Text style={styles.loadingText}>加载中…</Text>
        </View>
      </View>
    )
  }

  if (!session) {
    return (
      <View style={styles.page}>
        <Header title="成绩" back />
        <View style={styles.loading}>
          <Text style={styles.loadingText}>{loadError || '记录不存在'}</Text>
          <Button title="返回首页" onPress={() => navigation.navigate('RouteEdit')} />
        </View>
      </View>
    )
  }

  return (
    <View style={styles.page}>
      <Header title="成绩" back />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        <View style={styles.hero}>
          <Text style={styles.routeName}>{routeName}</Text>
          <Text style={styles.dateText}>{dateText(session.endedAt)}</Text>
          <View style={styles.statusRow}>
            <Pill tone={session.complete ? 'good' : 'warn'}>
              {statusTitle}
            </Pill>
          </View>
          <Text style={styles.statusText}>{statusText}</Text>
        </View>

        <View style={styles.metricGrid}>
          <Metric
            label="完成楼层"
            value={`${
              getFloorAchievementCount(session.startFloor, session.finalFloor) ||
              session.floorsCompleted
            } 层`}
            style={styles.metric}
          />
          <Metric
            label="累计爬升"
            value={`${session.ascentM}米`}
            style={styles.metric}
          />
          <Metric label="总用时" value={formatDuration(session.durationMs ?? 0)} style={styles.metric} />
          <Metric label="总步数" value={session.steps} style={styles.metric} />
          <Metric
            label="平均单层"
            value={formatDuration(session.averageFloorMs ?? 0)}
            style={styles.metric}
          />
          <Metric
            label="最快单层"
            value={formatDuration(session.bestFloorSplitMs ?? 0)}
            style={styles.metric}
          />
        </View>

        <Card raised style={styles.detailCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>起止楼层</Text>
            <Text style={styles.detailValue}>
              {session.startFloor}层 → {session.finalFloor}层
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>置信度</Text>
            <Text style={styles.detailValue}>{Math.round(session.confidence * 100)}%</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>中断次数</Text>
            <Text style={styles.detailValue}>{session.interruptions.length}</Text>
          </View>
        </Card>

        {floorSplits.length > 0 ? (
          <Card raised style={styles.splitCard}>
            <Text style={styles.splitTitle}>单层用时</Text>
            {floorSplits.map((split, index) => (
              <View key={`${split.floor}-${index}`} style={styles.splitRow}>
                <Text style={styles.splitFloor}>{split.floor}层</Text>
                <Text style={styles.splitTime}>{split.time}</Text>
                <Text
                  style={[
                    styles.splitDuration,
                    split.fastest && styles.splitFastest,
                  ]}
                >
                  {split.split}
                  {split.fastest ? ' 最快' : ''}
                </Text>
              </View>
            ))}
          </Card>
        ) : null}

        <Button
          title="再爬一次"
          onPress={() =>
            navigation.replace('WorkoutSetup', { id: session.templateId })
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
    content: { paddingHorizontal: theme.pagePaddingH },
    loading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    loadingText: {
      color: theme.muted,
      fontSize: 14,
      marginBottom: 12,
    },
    hero: {
      marginTop: 8,
      marginBottom: 16,
    },
    eyebrow: {
      color: theme.green,
      fontSize: theme.fontEyebrow,
      fontWeight: '700',
      letterSpacing: 1.5,
    },
    routeName: {
      marginTop: 6,
      color: theme.ink,
      fontSize: theme.fontTitle,
      fontWeight: '700',
      lineHeight: 32,
    },
    dateText: {
      marginTop: 6,
      color: theme.muted,
      fontSize: theme.fontSubtitle,
    },
    statusRow: {
      marginTop: 10,
    },
    statusText: {
      marginTop: 8,
      color: theme.inkSoft,
      fontSize: 13,
      lineHeight: 20,
    },
    metricGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 8,
    },
    metric: {
      flex: 1,
      minWidth: '45%',
    },
    detailCard: {
      padding: 14,
      marginTop: 8,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 6,
    },
    detailLabel: {
      color: theme.muted,
      fontSize: 13,
    },
    detailValue: {
      color: theme.ink,
      fontSize: 15,
      fontWeight: '700',
    },
    splitCard: {
      padding: 14,
      marginTop: 8,
    },
    splitTitle: {
      color: theme.ink,
      fontSize: 15,
      fontWeight: '700',
      marginBottom: 8,
    },
    splitRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    splitFloor: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '700',
      width: 48,
    },
    splitTime: {
      flex: 1,
      color: theme.muted,
      fontSize: 13,
    },
    splitDuration: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '600',
    },
    splitFastest: {
      color: theme.green,
    },
  })
