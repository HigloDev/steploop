// 训练页（fusion-v1）：按阶段切换的全屏视图，小屏和大字体可滚动查看操作。
// 原则：爬楼时满头大汗也能一眼看懂——巨大楼层数字 + 竖向楼梯刻度 + 一条状态栏 + 三个小指标。
// 结束、放弃固定显示在页面底部，需长按（或读屏双击）确认，防误触。

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { usePreventRemove } from '@react-navigation/native'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'

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
  const session = useFusionWorkout(route.params ?? {})
  return <WorkoutContent navigation={navigation} session={session} />
}

/** The real screen and development screenshot lab share this presentation. */
export function WorkoutContent({ navigation, session }: {
  navigation: RootStackScreen<'ClimbWorkout'>['navigation']
  session: ReturnType<typeof useFusionWorkout>
}) {
  const insets = useSafeAreaInsets()
  const { height, fontScale } = useWindowDimensions()
  const compact = height / fontScale < 740
  const roomyCompact = compact && height >= 800
  const { snapshot, status } = session
  const finishingRef = useRef(false)
  const [showExitHint, setShowExitHint] = useState(false)
  const [leavingAction, setLeavingAction] = useState<'save' | 'discard'>('save')
  const [exitTarget, setExitTarget] = useState<{ id?: string } | null>(null)

  usePreventRemove(exitTarget === null && (status === 'running' || status === 'finishing' || status === 'save_failed'), () => {
    if (status !== 'finishing') setShowExitHint(true)
  })

  // Release the route guard before dispatching an intentional save/discard exit.
  useEffect(() => {
    if (!exitTarget) return
    if (exitTarget.id) navigation.replace('WorkoutResult', { id: exitTarget.id, fresh: true })
    else navigation.goBack()
  }, [exitTarget, navigation])

  const finish = async () => {
    if (finishingRef.current) return
    finishingRef.current = true
    setLeavingAction('save')
    try {
      const id = await session.finish()
      setExitTarget({ id })
    } catch { /* Session keeps the result and shows a save retry. */ }
    finally { finishingRef.current = false }
  }

  const discard = async () => {
    if (finishingRef.current) return
    finishingRef.current = true
    setLeavingAction('discard')
    try { await session.discard(); setExitTarget({}) }
    catch { /* Session retains the checkpoint and presents its recovery actions. */ }
    finally { finishingRef.current = false }
  }

  const showLeaveActions = () => {
    if (status === 'finishing') return
    setShowExitHint(true)
  }

  const cells = useMemo<GaugeCell[]>(() => {
    if (!snapshot) return []
    const descending = snapshot.phase === 'descending'
    const done = snapshot.phase === 'waiting' ? 0 : descending ? session.rounds.at(-1)?.floors ?? 0 : snapshot.roundFloors
    const total = Math.max(snapshot.templateFloors ?? snapshot.roundFloors + 8, descending ? done + 8 : 12, done)
    return Array.from({ length: total }, (_, index) => ({
      floor: floorAfter(snapshot.startFloor, index + 1),
      state: done > 0 && index === done - 1 && snapshot.phase !== 'calibration_top' ? 'current' : index < done ? 'done' : 'todo',
      estimated: index < done && snapshot.estimated && snapshot.roundKind === 'auto',
    }))
  }, [snapshot, session.rounds])

  if (status === 'finishing' || status === 'save_failed') {
    const retainedMessage = session.canSaveLater ? '本次训练仍保留在本机，请重试保存。' : '轮次仍在当前页面，请重试保存后再退出。'
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <StatusBar style="light" />
        <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {status === 'save_failed' ? <Pressable accessibilityRole="button" accessibilityLabel="返回，查看成绩保存操作" onPress={showLeaveActions} style={styles.iconButton}><MaterialCommunityIcons name="chevron-left" size={30} color={P.ink} /></Pressable> : null}
          <Text style={{ color: P.ink, fontSize: 24, fontWeight: '900' }}>训练结束</Text>
        </View>
        <ScrollView contentContainerStyle={{ alignItems: 'center', paddingTop: compact ? 24 : 46, paddingBottom: 32, gap: 8 }}>
        {status === 'finishing' ? <ActivityIndicator size="large" color={P.brand} />
          : <Feather name="alert-circle" size={132} color={P.brand} />}
        <Text style={[styles.errorTitle, { fontSize: 32, textAlign: 'center' }]}>{status === 'finishing' ? leavingAction === 'discard' ? '正在放弃本次训练…' : '正在保存成绩…' : leavingAction === 'discard' ? '未能放弃本次训练' : '成绩还没有保存完成'}</Text>
        {status === 'finishing' ? <Text style={styles.errorText}>{leavingAction === 'discard' ? '正在安全结束本次采集。' : '请稍等，保存后会自动进入结算页。'}</Text>
          : <Text style={[styles.errorText, { fontSize: 18, lineHeight: 26 }]}>{retainedMessage}</Text>}
        {status === 'save_failed' ? <>
          {showExitHint ? <Text accessibilityLiveRegion="polite" style={styles.exitHint}>{session.canSaveLater ? '请使用下方按钮重试保存，或稍后再存。' : '请先重试保存，轮次仍保留在当前页面。'}</Text> : null}
          {session.error && session.error !== retainedMessage ? <Text selectable style={styles.errorText}>{session.error}</Text> : null}
          <View style={styles.failureCard}><Text style={[styles.errorText, { textAlign: 'left', fontSize: 18, fontWeight: '800' }]}>本次训练</Text>
            <View style={{ flexDirection: 'row', marginTop: 4 }}>
              {[
                ['总层数', String(session.rounds.reduce((sum, round) => sum + round.floors, 0)), '层'],
                ['总高度', String(Math.round(session.rounds.reduce((sum, round) => sum + round.ascentM, 0))), '米'],
                ['完成轮次', String(session.rounds.length), '轮'],
              ].map(([label, value, suffix], i) => <View key={label} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i ? 1 : 0, borderLeftColor: P.line }} accessible accessibilityLabel={`${label} ${value}${suffix}`}>
                <Text style={{ color: P.ink, fontSize: 36, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{value}<Text style={{ fontSize: 16 }}> {suffix}</Text></Text>
                <Text style={{ color: P.muted, fontSize: 14 }}>{label}</Text>
              </View>)}
            </View></View>
          <Pressable accessibilityRole="button" style={[styles.primarySmall, { minHeight: 50 }]} onPress={() => void finish()}>
            <Text style={[styles.primarySmallText, { fontSize: 23 }]}>{leavingAction === 'discard' ? '保存成绩' : '重试保存'}</Text>
          </Pressable>
          {session.canSaveLater ? <Pressable accessibilityRole="button" style={[styles.ghost, { alignSelf: 'stretch', minHeight: 50, alignItems: 'center' }]} onPress={() => setExitTarget({})}>
            <Text style={[styles.ghostText, { fontSize: 20 }]}>稍后再存 · 返回首页</Text>
          </Pressable> : null}
          <Text style={[styles.errorText, { marginTop: 12 }]}>重试不会重复计入成绩。</Text>
        </> : null}
        </ScrollView>
      </View>
    )
  }

  if (status === 'starting' || !snapshot) {
    if (status === 'error') {
      return (
        <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
          <StatusBar style="light" />
          <MaterialCommunityIcons name="alert-circle-outline" size={48} color={P.warn} />
          <Text style={styles.errorTitle}>暂时无法开始训练</Text>
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
    caption = '下行中 · 请注意脚下'
  } else if (phase === 'waiting') {
    eyebrow = `准备第 ${snapshot.roundNumber} 轮`
    bigValue = snapshot.startFloor
    caption = snapshot.baro === 'none' ? '开始爬就按步数计层' : '开始爬就自动计层'
  }

  const showManualNext = (phase === 'calibration_top' || (phase === 'climbing' && snapshot.baro !== 'ok'))

  return (
    <View style={[styles.root, { paddingTop: insets.top + (compact ? 16 : 40), paddingBottom: insets.bottom + (compact ? 16 : 48) }]}>
      <StatusBar style="light" />
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <PhaseStatusBar tone={snapshot.status.tone} text={snapshot.status.text} extra={baroLabel(snapshot.baro)} />
        </View>
      </View>
      {session.warning ? <Text style={styles.warning} numberOfLines={2}>{session.warning}</Text> : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
      <View style={[styles.hero, calibrating && { flex: 0, minHeight: compact ? roomyCompact ? 240 : 160 : Math.max(250, height * 0.32) }, phase === 'calibration_top' && { flex: 0, minHeight: compact ? roomyCompact ? 260 : 180 : height * 0.35 }]}>
        <StairGauge cells={cells} startFloor={snapshot.startFloor} height={compact ? roomyCompact ? 200 : 120 : phase === 'climbing' ? 230 : calibrating ? 240 : 260} maxVisible={compact || phase === 'climbing' ? 10 : 12} style={styles.gauge} />
        <View style={[styles.heroCenter, !compact && { transform: [{ translateY: phase === 'climbing' ? 36 : phase === 'waiting' ? -24 : 0 }] }]}>
          <Text style={[styles.eyebrow, compact && { fontSize: 16 }]}>{eyebrow}</Text>
          {phase === 'descending' ? <MaterialCommunityIcons name="menu-down" size={40} color={P.brand} style={{ marginTop: 12 }} /> : null}
          <View style={styles.bigRow}>
            <FlipNumber value={bigValue} size={compact ? roomyCompact ? 128 : 76 : phase === 'climbing' ? 176 : 160} accessibilityLabel={`${bigValue} ${unit}`} />
            <Text style={[styles.unit, compact && { fontSize: 26, marginBottom: 14 }]}>{unit}</Text>
          </View>
          <Text style={[styles.caption, compact && { fontSize: 18, lineHeight: 24, marginTop: 4 }, snapshot.estimated && phase === 'climbing' && { color: P.estimate }]}>{caption}</Text>
        </View>
      </View>

      {calibrating ? (
        <View style={[styles.calArea, compact && { gap: 8 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`到了一层，记为 ${nextFloor} 楼`}
            onPress={session.markFloor}
            style={({ pressed }) => [styles.bigButton, { minHeight: compact ? 64 : 88 }, pressed && styles.bigButtonPressed]}
          >
            <Text style={[styles.bigButtonText, compact && { fontSize: 22 }]} numberOfLines={1} adjustsFontSizeToFit>到了一层</Text>
            <Text style={[styles.bigButtonSub, compact && { fontSize: 12, marginTop: 2 }]}>记为下一层楼号</Text>
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
            <Pressable accessibilityRole="button" accessibilityLabel="已回到楼下，开始下一轮" onPress={session.nextRound} style={[styles.nextButton, compact && { minHeight: 52 }]}>
              <MaterialCommunityIcons name="replay" size={20} color={P.ink} />
              <Text style={[styles.nextText, compact && { fontSize: 18 }]} numberOfLines={1} adjustsFontSizeToFit>{phase === 'calibration_top' ? '已到楼下 · 开始下一轮' : '结束本轮'}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      </ScrollView>

      <View style={[styles.stats, compact && { paddingVertical: 10 }]}>
        <MiniStat label="用时" value={formatDuration(snapshot.elapsedMs)} compact={compact} />
        <MiniStat label="累计层数" value={String(snapshot.totalFloors)} accent compact={compact} divider />
        <MiniStat label="轮次" value={`第 ${snapshot.roundNumber} 轮`} compact={compact} divider />
      </View>
      <View style={styles.exitActions}>
        {showExitHint ? <Text accessibilityLiveRegion="polite" style={styles.exitHint}>训练仍在进行，请使用下方按钮结束并保存或放弃本次。</Text> : null}
        <HoldToConfirm tone="primary" label="长按结束并保存" holdingLabel="松开取消 · 继续按住保存" onConfirm={() => void finish()} style={{ minHeight: compact ? 52 : 58 }} />
        <HoldToConfirm tone="danger" label="长按放弃本次" holdingLabel="松开取消 · 继续按住放弃" accessibilityHint="本次未保存的训练将被放弃。长按约一秒确认，或使用读屏的双击确认" onConfirm={() => void discard()} style={styles.discard} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: P.bg, paddingHorizontal: 20,},
  center: { alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 32 },
  failureCard: { padding: 18, backgroundColor: '#1c1a18', borderRadius: 20, gap: 6, alignSelf: 'stretch', marginVertical: 12 },
  failureValue: { color: P.ink, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  loading: { color: P.inkSoft, fontSize: 16, fontWeight: '700' },
  errorTitle: { color: P.ink, fontSize: 22, fontWeight: '900' },
  errorText: { color: P.inkSoft, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  primarySmall: { minHeight: 56, minWidth: 180, borderRadius: 26, backgroundColor: P.brand, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch',},
  primarySmallText: { color: P.onBrand, fontSize: 17, fontWeight: '900' },
  ghost: { minHeight: 56, justifyContent: 'center', borderWidth: 1, borderColor: P.brand, borderRadius: 28, paddingHorizontal: 20,},
  ghostText: { color: P.brand, fontSize: 15, fontWeight: '700' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  warning: { color: P.warn, fontSize: 13, fontWeight: '700', marginTop: 8, marginHorizontal: 4 },
  hero: { flex: 1, flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  gauge: { width: 60,},
  heroCenter: { flex: 1, alignItems: 'center', paddingRight: 0,},
  eyebrow: { color: P.brand, fontSize: 20, fontWeight: '900', letterSpacing: 1 },
  bigRow: { flexDirection: 'row', alignItems: 'flex-end', maxWidth: '100%' },
  unit: { color: P.inkSoft, fontSize: 34, fontWeight: '900', marginBottom: 26, marginLeft: 4 },
  caption: { color: P.inkSoft, fontSize: 22, lineHeight: 30, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  calArea: { flex: 0, justifyContent: 'flex-end', gap: 12, marginTop: 0,},
  bigButton: {
    flex: 0, minHeight: 76, borderRadius: 24, backgroundColor: P.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  bigButtonPressed: { backgroundColor: P.brandDeep, transform: [{ scale: 0.985 }] },
  bigButtonText: { color: P.onBrand, fontSize: 30, fontWeight: '900', letterSpacing: 0,},
  bigButtonSub: { color: P.onBrand, fontSize: 14, fontWeight: '800', opacity: 0.75, marginTop: 4, fontVariant: ['tabular-nums'] },
  calRow: { flexDirection: 'row', gap: 12 },
  secondary: {
    flex: 1, minHeight: 48, borderRadius: 24, backgroundColor: 'transparent', flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
   borderWidth: 1, borderColor: P.muted,},
  topButton: { borderWidth: 1.5, borderColor: P.muted,},
  secondaryText: { color: P.inkSoft, fontSize: 18, fontWeight: '900' },
  flexSpacer: { minHeight: 100, justifyContent: 'flex-start',},
  nextButton: {
    minHeight: 72, borderRadius: 24, backgroundColor: P.brand, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  nextText: { color: P.onBrand, fontSize: 23, fontWeight: '900', flexShrink: 1, textAlign: 'center' },
  stats: { flexDirection: 'row', paddingVertical: 24, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.line, marginTop: 8,},
  exitActions: { gap: 6, marginTop: 4 },
  exitHint: { color: P.inkSoft, fontSize: 13, lineHeight: 18, textAlign: 'center', paddingHorizontal: 8 },
  discard: { minHeight: 48, borderWidth: 0, borderRadius: 24 },
})
