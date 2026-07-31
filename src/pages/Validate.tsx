// 验证页：选择已验证路线做正式爬楼验证，逻辑类似 Climb 但 mode='validation'。
// 使用 useClimbRoundSession 复用单轮识别三件套，避免与正式训练页代码重复。

import React, { useEffect, useMemo, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Header } from '../components/Header'
import { Button, Card, Metric, Pill } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import { getRoute, saveRoute, saveSession } from '../services/storage'
import { sensorStartErrorMessage } from '../services/sensor'
import { useClimbRoundSession } from '../hooks/useClimbRoundSession'
import { formatDuration } from '../core/math'
import { RouteTemplate } from '../core/types'

// 占位模板，routeTpl 加载前使用（hook 必须无条件调用）
const DUMMY_TEMPLATE: RouteTemplate = {
  id: '',
  name: '',
  startFloor: 0,
  endFloor: 0,
  carryMode: 'pocket',
  floorHeightM: 0,
  totalAscentM: 0,
  device: { platform: '', model: '', system: '' },
  segments: [],
  markers: [],
  createdAt: 0,
  updatedAt: 0,
  version: 0,
  status: 'draft',
}

export default function ValidateScreen({ navigation, route }: RootStackScreen<'Validate'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const routeId = route.params?.id

  const [routeTpl, setRouteTpl] = useState<RouteTemplate | null>(null)
  const [loadError, setLoadError] = useState('')
  const [phase, setPhase] = useState<'ready' | 'recording' | 'result'>('ready')
  const [success, setSuccess] = useState(false)
  const [resultText, setResultText] = useState('')

  // 加载路线
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
        setRouteTpl(r)
      })
      .catch(() => setLoadError('加载路线失败'))
  }, [routeId])

  // 单轮识别会话（mode='validation'）
  const roundSession = useClimbRoundSession({
    template: routeTpl ?? DUMMY_TEMPLATE,
    mode: 'validation',
  })

  // 用于显示的用时
  const elapsedText = useMemo(
    () => formatDuration(roundSession.elapsedMs),
    [roundSession.elapsedMs],
  )

  const computeProgress = (completed: number): number => {
    if (!routeTpl) return 0
    const span = routeTpl.segments.length
    if (span <= 0) return 0
    return Math.min(100, Math.round((completed / span) * 100))
  }

  const handleStart = async () => {
    if (!routeTpl) return
    try {
      await roundSession.start()
      setPhase('recording')
    } catch (err) {
      Alert.alert('传感器无法启动', sensorStartErrorMessage(err), [{ text: '知道了' }])
    }
  }

  const handleFinish = async () => {
    const r = routeTpl
    if (!r) return
    // finish() 幂等：自动完成后再调用返回同一 session
    const session = roundSession.finish()
    if (!session) {
      Alert.alert('验证失败', '未能生成验证记录，请重试。')
      return
    }
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
      return
    }
    const nextFloor =
      r.startFloor + session.floorsCompleted * (r.endFloor >= r.startFloor ? 1 : -1)
    setSuccess(ok)
    setResultText(
      ok
        ? '模板验证通过，可以用于正式爬楼。'
        : `匹配停在${nextFloor}层附近，请检查该楼层边界或重新标定这一条路线。`,
    )
    setPhase('result')
  }

  const handleReset = () => {
    setPhase('ready')
    setResultText('')
    setSuccess(false)
  }

  // === 渲染 ===

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
            onPress={handleReset}
          />
        </ScrollView>
      </View>
    )
  }

  const snapshot = roundSession.snapshot
  const isCompleted = roundSession.isCompleted

  return (
    <View style={styles.page}>
      <Header title="验证路线" back />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        <View style={styles.hero}>
          <Text style={styles.title}>{routeTpl.name}</Text>
          <Text style={styles.subtitle}>
            {routeTpl.startFloor}层 → {routeTpl.endFloor}层 · {routeTpl.totalAscentM}米
          </Text>
        </View>

        <View style={styles.metricGrid}>
          <Metric label="当前楼层" value={`${snapshot.currentFloor}层`} style={styles.metric} />
          <Metric
            label="已完成"
            value={`${snapshot.floorsCompleted} 层`}
            style={styles.metric}
          />
          <Metric label="用时" value={elapsedText} style={styles.metric} />
          <Metric
            label="置信度"
            value={`${Math.round(snapshot.confidence * 100)}%`}
            style={styles.metric}
          />
        </View>

        <Card raised style={styles.statusCard}>
          <Text style={styles.statusLabel}>状态</Text>
          <Text style={styles.statusValue}>
            {phase === 'recording'
              ? isCompleted
                ? '已到达终点'
                : '正在验证'
              : '准备开始'}
          </Text>
          <Text style={styles.progressLabel}>
            进度 {computeProgress(snapshot.floorsCompleted)}%
          </Text>
        </Card>

        {phase === 'ready' ? (
          <Button title="开始验证" onPress={handleStart} />
        ) : (
          <Button
            title={isCompleted ? '查看验证结果' : '完成验证'}
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
