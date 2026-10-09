// 训练页（fusion-v1）：按阶段切换的全屏视图，不再长列表滚动。
// 原则：爬楼时满头大汗也能一眼看懂——巨大楼层数字 + 竖向楼梯刻度 + 一条状态栏 + 三个小指标。
// 语音、记录方式等设置全部在设置页；结束训练需长按（或读屏双击）确认，防误触。

import React, { useEffect, useMemo, useRef } from 'react'
import { ActivityIndicator, Alert, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MaterialCommunityIcons } from '@expo/vector-icons'

import { FlipNumber, GaugeCell, HoldToConfirm, MiniStat, PhaseStatusBar, StairGauge } from '../components/workout-ui'
import { floorAfter } from '../core/floors'
import { formatDuration } from '../core/math'
import type { FusionSnapshot } from '../core/fusion-engine'
import { useFusionWorkout } from '../hooks/useFusionWorkout'
import type { RootStackScreen } from '../navigation/types'
import { workoutPalette as P } from '../theme'

function baroLabel(baro: FusionSnapshot['baro']): string {
  switch (baro) {
    case 'ok': return '气压正常'
    case 'stale': return '气压停更'
    case 'none': return '无气压计'
    default: return '气压连接中'
  }
}

export default function WorkoutScreen({ navigation, route }: RootStackScreen<'ClimbWorkout'>) {
  const insets = useSafeAreaInsets()
  const session = useFusionWorkout(route.params ?? {})
  const { snapshot, status } = session
  const finishingRef = useRef(false)

  const finish = async () => {
    if (finishingRef.current) return
    finishingRef.current = true
    const id = await session.finish()
    if (id) navigation.replace('WorkoutResult', { id, fresh: true })
    else navigation.goBack()
  }

  const confirmLeave = () => {
    Alert.alert('训练进行中', '要结束这次训练吗？', [
      { text: '继续训练', style: 'cancel' },
      { text: '放弃本次', style: 'destructive', onPress: async () => { await session.discard(); navigation.goBack() } },
      { text: '结束并保存', onPress: () => void finish() },
    ])
  }

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (status === 'running') { confirmLeave(); return true }
      return false
    })
    return () => sub.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const cells = useMemo<GaugeCell[]>(() => {
    if (!snapshot) return []
    const total = Math.max(snapshot.templateFloors ?? 0, snapshot.roundFloors + 2, 6)
    const done = snapshot.phase === 'descending' || snapshot.phase === 'waiting' ? 0 : snapshot.roundFloors
    return Array.from({ length: total }, (_, index) => ({
      floor: floorAfter(snapshot.startFloor, index + 1),
      state: index < done ? 'done' : index === done ? 'current' : 'todo',
      estimated: index < done && snapshot.estimated && snapshot.roundKind === 'auto',
    }))
  }, [snapshot])

  if (status === 'starting' || !snapshot) {
    if (status === 'error') {
      return (
        <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
          <StatusBar style="light" />
          <MaterialCommunityIcons name="alert-circle-outline" size={48} color={P.warn} />
          <Text style={styles.errorTitle}>传感器没能启动</Text>
          <Text style={styles.errorText}>{session.error}</Text>
          <Pressable accessibilityRole="button" style={styles.primarySmall} onPress={session.retry}>
            <Text style={styles.primarySmallText}>重试</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.ghost} onPress={() => navigation.goBack()}>
            <Text style={styles.ghostText}>返回首页</Text>
          </Pressable>
        </View>
      )
    }
    return (
      <View style={[styles.root, styles.center]}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={P.brand} />
        <Text style={styles.loading}>正在启动传感器…</Text>
      </View>
    )
  }

  const phase = snapshot.phase
  const calibrating = phase === 'calibrating'
  const nextFloor = floorAfter(snapshot.startFloor, snapshot.roundFloors + 1)
  const lastRound = session.rounds.at(-1)

  // ---------- 中部大数字区：按阶段切换 ----------
  let eyebrow = ''
  let bigValue: string | number = snapshot.currentFloor
  let unit = '楼'
  let caption = ''
  if (calibrating) {
    eyebrow = '标定轮'
    caption = snapshot.roundFloors ? `已标定 ${snapshot.roundFloors} 层` : '开始爬，每到一层点一下'
  } else if (phase === 'calibration_top') {
    eyebrow = '已到顶'
    caption = `标定完成 · 共 ${snapshot.roundFloors} 层`
  } else if (phase === 'climbing') {
    eyebrow = `第 ${snapshot.roundNumber} 轮`
    caption = `本轮已爬 ${snapshot.roundFloors} 层${snapshot.estimated ? ' · 估算' : ''}`
  } else if (phase === 'descending') {
    eyebrow = `第 ${lastRound?.roundNumber ?? snapshot.completedRounds} 轮完成`
    bigValue = lastRound?.floors ?? 0
    unit = '层'
    caption = '下行中 · 到楼下自动开始下一轮'
  } else if (phase === 'waiting') {
    eyebrow = `准备第 ${snapshot.roundNumber} 轮`
    bigValue = snapshot.startFloor
    caption = snapshot.baro === 'none' ? '开始爬就按步数计层' : '开始爬就自动计层'
  }

  const showManualNext = (phase === 'calibration_top' || (phase === 'climbing' && snapshot.baro !== 'ok'))

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
      <StatusBar style="light" />
      <View style={styles.topRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="离开训练" hitSlop={12} onPress={confirmLeave} style={styles.iconButton}>
          <MaterialCommunityIcons name="chevron-down" size={28} color={P.inkSoft} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <PhaseStatusBar tone={snapshot.status.tone} text={snapshot.status.text} extra={baroLabel(snapshot.baro)} />
        </View>
      </View>
      {session.warning ? <Text style={styles.warning} numberOfLines={2}>{session.warning}</Text> : null}

      <View style={[styles.hero, calibrating && styles.heroCompact]}>
        <StairGauge cells={cells} height={calibrating ? 220 : 360} style={styles.gauge} />
        <View style={styles.heroCenter}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <View style={styles.bigRow}>
            {phase === 'descending' ? <MaterialCommunityIcons name="arrow-down-bold" size={44} color={P.brand} style={{ marginRight: 4 }} /> : null}
            <FlipNumber value={bigValue} size={calibrating ? 120 : 140} accessibilityLabel={`${bigValue} ${unit}`} />
            <Text style={styles.unit}>{unit}</Text>
          </View>
          <Text style={[styles.caption, snapshot.estimated && phase === 'climbing' && { color: P.estimate }]}>{caption}</Text>
        </View>
      </View>

      {calibrating ? (
        <View style={styles.calArea}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`到了一层，记为 ${nextFloor} 楼`}
            onPress={session.markFloor}
            style={({ pressed }) => [styles.bigButton, pressed && styles.bigButtonPressed]}
          >
            <Text style={styles.bigButtonText}>到了一层</Text>
            <Text style={styles.bigButtonSub}>记为 {nextFloor} 楼</Text>
          </Pressable>
          <View style={styles.calRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="撤销上一次" disabled={!snapshot.canUndo}
              onPress={session.undoMark} style={[styles.secondary, !snapshot.canUndo && { opacity: 0.35 }]}>
              <MaterialCommunityIcons name="undo-variant" size={20} color={P.inkSoft} />
              <Text style={styles.secondaryText}>撤销</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="到顶了，结束标定爬楼" onPress={session.markTop} style={[styles.secondary, styles.topButton]}>
              <MaterialCommunityIcons name="flag-checkered" size={20} color={P.brand} />
              <Text style={[styles.secondaryText, { color: P.brand }]}>到顶了</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.flexSpacer}>
          {showManualNext ? (
            <Pressable accessibilityRole="button" accessibilityLabel="已回到楼下，开始下一轮" onPress={session.nextRound} style={styles.nextButton}>
              <MaterialCommunityIcons name="replay" size={20} color={P.ink} />
              <Text style={styles.nextText}>{phase === 'calibration_top' ? '已到楼下 · 开始下一轮' : '结束本轮'}</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <View style={styles.stats}>
        <MiniStat label="用时" value={formatDuration(snapshot.elapsedMs)} />
        <MiniStat label="累计层数" value={String(snapshot.totalFloors)} accent />
        <MiniStat label="轮次" value={`第 ${snapshot.roundNumber} 轮`} />
      </View>
      <HoldToConfirm label="长按结束训练" holdingLabel="松开取消 · 继续按住结束" onConfirm={() => void finish()} style={styles.end} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: P.bg, paddingHorizontal: 16 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 32 },
  loading: { color: P.inkSoft, fontSize: 16, fontWeight: '700' },
  errorTitle: { color: P.ink, fontSize: 22, fontWeight: '900' },
  errorText: { color: P.inkSoft, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  primarySmall: { minHeight: 52, minWidth: 180, borderRadius: 26, backgroundColor: P.brand, alignItems: 'center', justifyContent: 'center' },
  primarySmallText: { color: P.onBrand, fontSize: 17, fontWeight: '900' },
  ghost: { minHeight: 48, justifyContent: 'center' },
  ghostText: { color: P.muted, fontSize: 15, fontWeight: '700' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  warning: { color: P.warn, fontSize: 13, fontWeight: '700', marginTop: 8, marginHorizontal: 4 },
  hero: { flex: 1, flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  heroCompact: { flex: 0, minHeight: 250 },
  gauge: { width: 64 },
  heroCenter: { flex: 1, alignItems: 'center' },
  eyebrow: { color: P.brand, fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  bigRow: { flexDirection: 'row', alignItems: 'flex-end' },
  unit: { color: P.inkSoft, fontSize: 28, fontWeight: '900', marginBottom: 22, marginLeft: 4 },
  caption: { color: P.inkSoft, fontSize: 18, fontWeight: '800', marginTop: 2, textAlign: 'center' },
  calArea: { flex: 1, justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  bigButton: {
    flex: 1, minHeight: 180, borderRadius: 32, backgroundColor: P.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  bigButtonPressed: { backgroundColor: P.brandDeep, transform: [{ scale: 0.985 }] },
  bigButtonText: { color: P.onBrand, fontSize: 44, fontWeight: '900', letterSpacing: 2 },
  bigButtonSub: { color: P.onBrand, fontSize: 18, fontWeight: '800', opacity: 0.75, marginTop: 4, fontVariant: ['tabular-nums'] },
  calRow: { flexDirection: 'row', gap: 12 },
  secondary: {
    flex: 1, minHeight: 56, borderRadius: 20, backgroundColor: P.surface, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  topButton: { borderWidth: 1.5, borderColor: P.brand },
  secondaryText: { color: P.inkSoft, fontSize: 18, fontWeight: '900' },
  flexSpacer: { minHeight: 64, justifyContent: 'center' },
  nextButton: {
    minHeight: 56, borderRadius: 20, backgroundColor: P.surfaceHigh, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  nextText: { color: P.ink, fontSize: 17, fontWeight: '900' },
  stats: { flexDirection: 'row', paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.line, marginTop: 8 },
  end: { marginTop: 4 },
})
