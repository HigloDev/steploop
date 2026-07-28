// 正式爬楼页：启动 SensorRecorder + LiveFeaturePump + RouteRecognizer，实时识别并展示。

import React, { useEffect, useRef, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Header } from '../components/Header'
import { Button, Card, Metric, Pill } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import { getRoute, saveSession } from '../services/storage'
import { SensorRecorder, sensorStartErrorMessage } from '../services/sensor'
import { LiveFeaturePump } from '../services/live-feature-pump'
import { RouteRecognizer } from '../core/recognizer'
import { formatDuration } from '../core/math'
import {
  ClimbSession,
  RecognitionSnapshot,
  RouteTemplate,
} from '../core/types'
import { triggerHaptic, triggerSound, getPreferences } from '../services/preferences'

function initialSnapshot(startFloor: number): RecognitionSnapshot {
  return {
    currentFloor: startFloor,
    floorsCompleted: 0,
    ascentM: 0,
    steps: 0,
    confidence: 0,
    status: 'matching',
  }
}

function statusText(status: RecognitionSnapshot['status']): string {
  const map: Record<RecognitionSnapshot['status'], string> = {
    matching: '正在匹配路线',
    low_confidence: '路线暂未匹配',
    paused: '记录已暂停',
    complete: '已到达终点',
  }
  return map[status]
}

interface FloorCard {
  floor: number
  state: 'done' | 'current' | 'pending'
  splitText: string
}

function buildFloorCards(
  r: RouteTemplate | undefined,
  currentFloor: number,
  splits: Array<{ floor: number; elapsedMs: number }>,
): FloorCard[] {
  if (!r) return []
  const cards: FloorCard[] = []
  const splitMap = new Map(splits.map((s) => [s.floor, s.elapsedMs]))
  for (let f = r.startFloor; f <= r.endFloor; f++) {
    let state: FloorCard['state'] = 'pending'
    if (f < currentFloor) state = 'done'
    else if (f === currentFloor) state = 'current'
    const elapsed = splitMap.get(f)
    let splitText = '—'
    if (state === 'done' && elapsed != null) {
      splitText = `${(elapsed / 1000).toFixed(1)}s`
    } else if (state === 'current') {
      splitText = '攀登中'
    }
    cards.push({ floor: f, state, splitText })
  }
  return cards
}

export default function ClimbScreen({ navigation, route }: RootStackScreen<'Climb'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const { id, mode } = route.params

  const recorderRef = useRef<SensorRecorder | undefined>(undefined)
  const recognizerRef = useRef<RouteRecognizer | undefined>(undefined)
  const pumpRef = useRef<LiveFeaturePump | undefined>(undefined)
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const routeRef = useRef<RouteTemplate | undefined>(undefined)
  const completedAtRef = useRef<number | undefined>(undefined)
  const floorSplitsRef = useRef<Array<{ floor: number; elapsedMs: number }>>([])
  const lastFloorRef = useRef(0)

  const [routeTpl, setRouteTpl] = useState<RouteTemplate | null>(null)
  const [loadError, setLoadError] = useState('')
  const [phase, setPhase] = useState<'ready' | 'recording'>('ready')
  const [elapsed, setElapsed] = useState('00:00')
  const [snapshot, setSnapshot] = useState<RecognitionSnapshot>(initialSnapshot(0))
  const [progressPercent, setProgressPercent] = useState(0)
  const [floorCards, setFloorCards] = useState<FloorCard[]>([])

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
          return
        }
        if (r.status !== 'verified') {
          Alert.alert('路线尚未验证', '请先完成验证，再用于正式记录。', [
            { text: '去验证', onPress: () => navigation.replace('Validate', { id: r.id }) },
          ])
          return
        }
        routeRef.current = r
        setRouteTpl(r)
        setSnapshot(initialSnapshot(r.startFloor))
        lastFloorRef.current = r.startFloor
        setFloorCards(buildFloorCards(r, r.startFloor, []))
      } catch (err) {
        setLoadError('加载路线失败')
      }
    }
    load()
  }, [id, mode, navigation])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      recorderRef.current?.stop().catch(() => undefined)
    }
  }, [])

  const updateSnapshot = (
    next: RecognitionSnapshot,
    startedAt: number,
  ) => {
    const floorChanged =
      next.currentFloor !== lastFloorRef.current && next.currentFloor > lastFloorRef.current
    if (floorChanged) {
      floorSplitsRef.current.push({
        floor: next.currentFloor,
        elapsedMs: Date.now() - startedAt,
      })
      lastFloorRef.current = next.currentFloor
      triggerHaptic('medium')
    }
    setSnapshot(next)
    const r = routeRef.current
    const progress = r
      ? Math.round((next.floorsCompleted / Math.max(1, r.segments.length)) * 100)
      : 0
    setProgressPercent(progress)
    setFloorCards(buildFloorCards(r, next.currentFloor, floorSplitsRef.current))
  }

  const handleStart = async () => {
    const r = routeRef.current
    if (!r) return
    const prefs = await getPreferences()
    if (prefs.carryReminder) {
      const carryName = r.carryMode === 'waist' ? '固定腰包' : '固定裤袋'
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          '确认携带方式',
          `本次爬楼请保持 ${carryName}，每次同一侧、同一朝向。准备好后开始记录。`,
          [
            { text: '返回调整', style: 'cancel', onPress: () => resolve(false) },
            { text: '开始记录', onPress: () => resolve(true) },
          ],
        )
      })
      if (!confirmed) return
    }
    completedAtRef.current = undefined
    floorSplitsRef.current = []
    const recognizer = new RouteRecognizer(r)
    recognizerRef.current = recognizer
    const pump = new LiveFeaturePump((frame) => {
      const next = recognizer.pushFrame(frame)
      updateSnapshot(next, recorderRef.current?.getStartedAt() ?? Date.now())
      if (next.status === 'complete' && !completedAtRef.current) {
        completedAtRef.current = Date.now()
        if (timerRef.current) clearInterval(timerRef.current)
        recorderRef.current?.stop().catch(() => undefined)
        triggerHaptic('heavy')
        triggerSound('success')
      }
    })
    pumpRef.current = pump
    const recorder = new SensorRecorder({
      retainSamples: false,
      onSample: (sample) => pump.push(sample),
      onGap: (gap) => {
        recognizer.pause(gap.startMs)
        recognizer.resume(gap.endMs)
      },
      onStatus: (status) => {
        if (status.signal === 'interrupted' && recorderRef.current) {
          recognizer.pause(Date.now() - recorderRef.current.getStartedAt())
        }
      },
    })
    recorderRef.current = recorder
    try {
      await recorder.start()
      setPhase('recording')
      timerRef.current = setInterval(() => {
        if (recorderRef.current) {
          setElapsed(formatDuration(Date.now() - recorderRef.current.getStartedAt()))
        }
      }, 500)
    } catch (err) {
      Alert.alert('无法开始', sensorStartErrorMessage(err), [{ text: '知道了' }])
    }
  }

  const handleFinish = async () => {
    const r = routeRef.current
    if (!r) return
    if (timerRef.current) clearInterval(timerRef.current)
    const recorder = recorderRef.current
    const recognizer = recognizerRef.current
    if (!recorder || !recognizer) return
    await recorder.stop()
    const session: ClimbSession = recognizer.finish(completedAtRef.current || Date.now(), 'formal')
    try {
      await saveSession(session)
    } catch (err) {
      Alert.alert(
        '保存失败',
        err instanceof Error ? err.message : '本地存储空间不足，成绩未能保存。',
      )
      return
    }
    navigation.replace('Result', { id: session.id })
  }

  if (loadError) {
    return (
      <View style={styles.page}>
        <Header title="正式爬楼" back />
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
        <Header title="正式爬楼" back />
        <View style={styles.center}>
          <Text style={styles.loadingText}>加载中…</Text>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.page}>
      <Header title="正式爬楼" back />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>CLIMB</Text>
          <Text style={styles.title}>{routeTpl.name}</Text>
          <Text style={styles.subtitle}>
            {routeTpl.startFloor}F → {routeTpl.endFloor}F · {routeTpl.totalAscentM} m
          </Text>
        </View>

        <View style={styles.metricGrid}>
          <Metric label="当前楼层" value={`${snapshot.currentFloor}F`} style={styles.metric} />
          <Metric
            label="已完成"
            value={`${snapshot.floorsCompleted} 层`}
            style={styles.metric}
          />
          <Metric label="用时" value={elapsed} style={styles.metric} />
          <Metric label="步数" value={snapshot.steps} style={styles.metric} />
        </View>

        <Card raised style={styles.statusCard}>
          <View style={styles.statusHead}>
            <Text style={styles.statusLabel}>状态</Text>
            <Pill
              tone={
                snapshot.status === 'complete'
                  ? 'good'
                  : snapshot.status === 'paused' || snapshot.status === 'low_confidence'
                    ? 'warn'
                    : 'default'
              }
            >
              {statusText(snapshot.status)}
            </Pill>
          </View>
          <Text style={styles.progressLabel}>进度 {progressPercent}%</Text>
          <Text style={styles.confidenceLabel}>
            置信度 {Math.round(snapshot.confidence * 100)}% · 爬升 {snapshot.ascentM} m
          </Text>
        </Card>

        <Text style={styles.sectionLabel}>楼层进度</Text>
        <View style={styles.floorGrid}>
          {floorCards.map((card) => (
            <View
              key={card.floor}
              style={[
                styles.floorChip,
                card.state === 'done' && styles.floorChipDone,
                card.state === 'current' && styles.floorChipCurrent,
              ]}
            >
              <Text
                style={[
                  styles.floorChipText,
                  card.state === 'done' && styles.floorChipTextDone,
                  card.state === 'current' && styles.floorChipTextCurrent,
                ]}
              >
                {card.floor}F
              </Text>
              <Text
                style={[
                  styles.floorChipSplit,
                  card.state === 'done' && styles.floorChipTextDone,
                ]}
              >
                {card.splitText}
              </Text>
            </View>
          ))}
        </View>

        {phase === 'ready' ? (
          <Button
            title="开始爬楼"
            onPress={handleStart}
          />
        ) : (
          <Button
            title={snapshot.status === 'complete' ? '查看成绩' : '结束并保存'}
            onPress={handleFinish}
          />
        )}
        <Button
          title="返回路线"
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
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
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
    subtitle: {
      marginTop: 6,
      color: theme.muted,
      fontSize: theme.fontSubtitle,
    },
    metricGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 8,
    },
    metric: { flex: 1, minWidth: '45%' },
    statusCard: { padding: 14, marginTop: 8 },
    statusHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    statusLabel: {
      color: theme.muted,
      fontSize: 12,
    },
    progressLabel: {
      marginTop: 8,
      color: theme.green,
      fontSize: 14,
      fontWeight: '700',
    },
    confidenceLabel: {
      marginTop: 4,
      color: theme.muted,
      fontSize: 12,
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
    floorGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginBottom: 8,
    },
    floorChip: {
      width: '31%',
      backgroundColor: theme.card,
      borderRadius: theme.radiusMd,
      padding: 10,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
    },
    floorChipDone: {
      backgroundColor: theme.greenSoft,
      borderColor: theme.greenSoft,
    },
    floorChipCurrent: {
      backgroundColor: theme.green,
      borderColor: theme.green,
    },
    floorChipText: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '700',
    },
    floorChipTextDone: {
      color: theme.green,
    },
    floorChipTextCurrent: {
      color: theme.card,
    },
    floorChipSplit: {
      marginTop: 2,
      color: theme.muted,
      fontSize: 11,
    },
  })
