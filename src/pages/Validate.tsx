// 验证页：选择已验证路线做正式爬楼验证，逻辑类似 Climb 但 mode='validation'。
// 使用 useClimbRoundSession 复用单轮识别三件套，避免与正式训练页代码重复。

import React, { useEffect, useMemo, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

import { Disclosure } from '../components/disclosure'
import { Header } from '../components/Header'
import { Button, Metric, Pill } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import { getRoute, saveRoute, saveSession } from '../services/storage'
import { sensorStartErrorMessage } from '../services/sensor'
import { useClimbRoundSession } from '../hooks/useClimbRoundSession'
import { formatDuration } from '../core/math'
import { RouteTemplate } from '../core/types'
import { hasCheckedMotionReference, recordMotionCheck } from '../core/route-motion'

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

  const handleFinish = async (actualEnd?: boolean) => {
    const r = routeTpl
    if (!r) return
    // finish() 幂等：自动完成后再调用返回同一 session
    const session = roundSession.finish()
    if (!session) {
      Alert.alert('验证失败', '未能生成验证记录，请重试。')
      return
    }
    if (actualEnd === undefined) {
      Alert.alert('核对实际楼层', `应用估计到了 ${session.finalFloor} 楼。请看楼层标志：你实际到了路线终点 ${r.endFloor} 楼吗？`, [
        { text: '还没有到，保存待确认', onPress: () => { void handleFinish(false) } },
        { text: '实际已经到达', onPress: () => { void handleFinish(true) } },
      ], { cancelable: false })
      return
    }
    const ok =
      session.finalFloor === r.endFloor &&
      session.floorsCompleted === r.segments.length &&
      session.interruptions.length === 0 && actualEnd
    if (ok) {
      const checked = recordMotionCheck(r, session, r.endFloor)
      Object.assign(r, checked)
      r.status = hasCheckedMotionReference(r) ? 'verified' : 'needs_validation'
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
        ? '本次终点已由你核对。路线仍需多次实测；训练时请记下中途的实际楼层。'
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
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[styles.content, { paddingBottom: 24 }]}
        >
          <View style={styles.resultHero}>
            <View style={[styles.resultIcon, { backgroundColor: success ? theme.successSoft : theme.amberSoft }]}>
              <Ionicons name={success ? 'checkmark-circle-outline' : 'information-circle-outline'} size={48} color={success ? theme.success : theme.amberInk} />
            </View>
            <Text style={styles.title}>{success ? '路线已验证' : '再确认一次路线'}</Text>
            <Pill tone={success ? 'good' : 'warn'}>
              {success ? '验证通过' : '未通过'}
            </Pill>
            <Text style={styles.statusText}>{resultText}</Text>
          </View>
          <Button
            title="再验证一次"
            variant="secondary"
            onPress={handleReset}
          />
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Button title="返回路线" onPress={() => navigation.navigate('Routes')} />
        </View>
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
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: 24 }]}
      >
        <View style={styles.hero}>
          <Text style={styles.title}>{routeTpl.name}</Text>
          <Text style={styles.subtitle}>
            {routeTpl.startFloor}层 → {routeTpl.endFloor}层 · {routeTpl.totalAscentM}米
          </Text>
        </View>

        <View style={styles.liveOverview}>
          <Text style={styles.statusLabel}>{phase === 'ready' ? '路线起点' : '当前楼层'}</Text>
          <View style={styles.liveNumberLine}>
            <Text selectable style={styles.liveNumber}>{phase === 'ready' ? routeTpl.startFloor : snapshot.currentFloor}</Text>
            <Text style={styles.liveUnit}>层</Text>
          </View>
          <Text selectable style={styles.liveElapsed}>用时 {elapsedText}</Text>
        </View>
        <View style={styles.statusCard}>
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
        </View>
        <Disclosure title="验证指标">
        <View style={styles.metricGrid}>
          <Metric label={phase === 'ready' ? '路线起点' : '当前楼层'} value={`${phase === 'ready' ? routeTpl.startFloor : snapshot.currentFloor}层`} style={styles.metric} />
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

        </Disclosure>

      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        {phase === 'ready' ? <Button title="开始验证" onPress={handleStart} /> : (
          <Button title={isCompleted ? '查看验证结果' : '完成验证'} onPress={() => { void handleFinish() }} />
        )}
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: theme.pagePaddingH, paddingTop: 16, gap: 16 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
    loadingText: { color: theme.mutedStrong, fontSize: theme.fontBase, lineHeight: 22, marginBottom: 12 },
    hero: { gap: 8 },
    eyebrow: {
      color: theme.brand,
      fontSize: theme.fontEyebrow,
      fontWeight: '700',    },
    title: {
      color: theme.ink,
      fontSize: theme.fontTitle,
      fontWeight: '700',
      lineHeight: 34,
    },
    subtitle: {
      color: theme.mutedStrong,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
    },
    metricGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    metric: { flexGrow: 1, flexBasis: '45%', minWidth: 0 },
    statusCard: { paddingVertical: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, gap: 8 },
    statusLabel: {
      color: theme.mutedStrong,
      fontSize: theme.fontSmall,
      lineHeight: 18,
    },
    statusValue: {
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
    },
    progressLabel: {
      color: theme.brand,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '600',
    },
    statusText: {
      marginTop: 8,
      color: theme.inkSoft,
      fontSize: theme.fontBase,
      lineHeight: 22,
    },
    liveOverview: { paddingVertical: 8, gap: 8 },
    liveNumberLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 },
    liveNumber: { color: theme.ink, fontSize: 52, lineHeight: 64, fontWeight: '700', fontVariant: ['tabular-nums'] },
    liveUnit: { color: theme.mutedStrong, fontSize: 20, lineHeight: 28 },
    liveElapsed: { color: theme.mutedStrong, fontSize: theme.fontBase, lineHeight: 22, fontVariant: ['tabular-nums'] },
    resultHero: { gap: 12, paddingVertical: 24 },
    resultIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    footer: { backgroundColor: theme.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, paddingHorizontal: theme.pagePaddingH, paddingTop: 8 },
  })
