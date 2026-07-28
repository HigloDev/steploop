// 验证页：选择已验证路线做正式爬楼验证，逻辑类似 Climb 但 mode='validation'。

import React, { useEffect, useRef, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Header } from '../components/Header'
import { Button, Card, Metric, Pill } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import { getRoute, saveRoute, saveSession } from '../services/storage'
import { SensorRecorder, sensorStartErrorMessage } from '../services/sensor'
import { LiveFeaturePump } from '../services/live-feature-pump'
import { RouteRecognizer } from '../core/recognizer'
import { formatDuration } from '../core/math'
import { RecognitionSnapshot, RouteTemplate } from '../core/types'

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

export default function ValidateScreen({ navigation, route }: RootStackScreen<'Validate'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const routeId = route.params?.id

  const recorderRef = useRef<SensorRecorder | undefined>(undefined)
  const recognizerRef = useRef<RouteRecognizer | undefined>(undefined)
  const pumpRef = useRef<LiveFeaturePump | undefined>(undefined)
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const routeRef = useRef<RouteTemplate | undefined>(undefined)

  const [routeTpl, setRouteTpl] = useState<RouteTemplate | null>(null)
  const [loadError, setLoadError] = useState('')
  const [phase, setPhase] = useState<'ready' | 'recording' | 'result'>('ready')
  const [elapsed, setElapsed] = useState('00:00')
  const [snapshot, setSnapshot] = useState<RecognitionSnapshot>(initialSnapshot(0))
  const [success, setSuccess] = useState(false)
  const [resultText, setResultText] = useState('')

  useEffect(() => {
    if (!routeId) {
      setLoadError('路线不存在')
      return
    }
    getRoute(routeId)
      .then((r) => {
        if (!r) {
          setLoadError('路线不存在')
          return
        }
        routeRef.current = r
        setRouteTpl(r)
        setSnapshot(initialSnapshot(r.startFloor))
      })
      .catch(() => setLoadError('加载路线失败'))
  }, [routeId])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      recorderRef.current?.stop().catch(() => undefined)
    }
  }, [])

  const computeProgress = (snap: RecognitionSnapshot): number => {
    const r = routeRef.current
    if (!r) return 0
    const span = r.endFloor - r.startFloor
    if (span <= 0) return 0
    return Math.min(100, Math.round((snap.floorsCompleted / span) * 100))
  }

  const handleStart = async () => {
    const r = routeRef.current
    if (!r) return
    const recognizer = new RouteRecognizer(r)
    recognizerRef.current = recognizer
    const pump = new LiveFeaturePump((frame) => {
      const next = recognizer.pushFrame(frame)
      setSnapshot(next)
    })
    pumpRef.current = pump
    const recorder = new SensorRecorder({
      retainSamples: false,
      onSample: (sample) => pump.push(sample),
      onGap: (gap) => {
        recognizer.pause(gap.startMs)
        recognizer.resume(gap.endMs)
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
      Alert.alert('传感器无法启动', sensorStartErrorMessage(err), [{ text: '知道了' }])
    }
  }

  const handleFinish = async () => {
    const r = routeRef.current
    const recorder = recorderRef.current
    const recognizer = recognizerRef.current
    if (!r || !recorder || !recognizer) return
    if (timerRef.current) clearInterval(timerRef.current)
    await recorder.stop()
    const session = recognizer.finish(Date.now(), 'validation')
    const ok =
      session.finalFloor === r.endFloor &&
      session.floorsCompleted === r.segments.length &&
      session.interruptions.length === 0
    if (ok) {
      r.status = 'verified'
      r.verifiedAt = Date.now()
      r.updatedAt = Date.now()
    }
    try {
      if (ok) await saveRoute(r)
      await saveSession(session)
    } catch (err) {
      Alert.alert(
        '保存失败',
        err instanceof Error ? err.message : '本地存储空间不足，验证结果未能保存。',
      )
      setPhase('recording')
      return
    }
    const nextFloor =
      r.startFloor + session.floorsCompleted * (r.endFloor >= r.startFloor ? 1 : -1)
    setSuccess(ok)
    setResultText(
      ok
        ? '模板验证通过，可以用于正式爬楼。'
        : `匹配停在 ${nextFloor}F 附近，请检查该楼层边界或重新标定这一条路线。`,
    )
    setPhase('result')
  }

  if (loadError) {
    return (
      <View style={styles.page}>
        <Header title="验证路线" back />
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
        <Header title="验证路线" back />
        <View style={styles.center}>
          <Text style={styles.loadingText}>加载中…</Text>
        </View>
      </View>
    )
  }

  if (phase === 'result') {
    return (
      <View style={styles.page}>
        <Header title="验证结果" back />
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        >
          <View style={styles.hero}>
            <Pill tone={success ? 'good' : 'warn'}>
              {success ? '验证通过' : '未通过'}
            </Pill>
            <Text style={styles.statusText}>{resultText}</Text>
          </View>
          <Button
            title="返回路线"
            onPress={() => navigation.navigate('RouteEdit')}
          />
          <Button
            title="再验证一次"
            variant="secondary"
            onPress={() => {
              setPhase('ready')
              setSnapshot(initialSnapshot(routeTpl.startFloor))
              setElapsed('00:00')
            }}
          />
        </ScrollView>
      </View>
    )
  }

  return (
    <View style={styles.page}>
      <Header title="验证路线" back />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>VALIDATION</Text>
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
          <Metric
            label="置信度"
            value={`${Math.round(snapshot.confidence * 100)}%`}
            style={styles.metric}
          />
        </View>

        <Card raised style={styles.statusCard}>
          <Text style={styles.statusLabel}>状态</Text>
          <Text style={styles.statusValue}>
            {phase === 'recording' ? '正在验证' : '准备开始'}
          </Text>
          <Text style={styles.progressLabel}>
            进度 {computeProgress(snapshot)}%
          </Text>
        </Card>

        {phase === 'ready' ? (
          <Button title="开始验证" onPress={handleStart} />
        ) : (
          <Button title="完成验证" onPress={handleFinish} />
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
    statusLabel: {
      color: theme.muted,
      fontSize: 12,
    },
    statusValue: {
      marginTop: 4,
      color: theme.ink,
      fontSize: 17,
      fontWeight: '700',
    },
    progressLabel: {
      marginTop: 6,
      color: theme.green,
      fontSize: 13,
      fontWeight: '600',
    },
    statusText: {
      marginTop: 10,
      color: theme.inkSoft,
      fontSize: 13,
      lineHeight: 20,
    },
  })
