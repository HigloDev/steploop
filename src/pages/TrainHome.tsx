import React, { useCallback, useEffect, useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Header } from '../components/Header'
import { BrandMark } from '../components/brand-mark'
import { Button, Notice } from '../components/ui'
import { isRoutePrepared, preparationLabel } from '../core/route-preparation'
import { useTheme } from '../theme'
import { MainTabScreen } from '../navigation/types'
import { getRoute, listRoutes } from '../services/storage'
import { getPreferences, savePreferences } from '../services/preferences'
import { listWorkouts, loadActiveCheckpoint } from '../services/workout-storage'
import { discardCheckpointAsAbandoned, saveCheckpointAsCompleted } from '../services/checkpoint-completion'
import { confirmBackgroundRecording } from '../services/workout-entry'
import { deriveTrainingProgress } from '../core/training-progress'
import { describeWorkoutGoal, restoreWorkoutSetup, SavedWorkoutSetup, workoutEntryParams } from '../core/workout-setup'
import { hasKnownRouteEnd } from '../core/route-state'
import { ActiveWorkoutCheckpoint, RouteTemplate, TrackingMode, TrainingProgress } from '../core/types'

export default function TrainHomeScreen({ navigation }: MainTabScreen<'Train'>) {
  const theme = useTheme()
  const [routes, setRoutes] = useState<RouteTemplate[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [resume, setResume] = useState<ActiveWorkoutCheckpoint | null>(null)
  const [resumeName, setResumeName] = useState<string | null>(null)
  const [setup, setSetup] = useState<SavedWorkoutSetup>()
  const [progress, setProgress] = useState<TrainingProgress>()
  const [choosing, setChoosing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [trackingMode, setTrackingMode] = useState<TrackingMode>('automatic')

  const refresh = useCallback(async () => {
    try {
      const [routeList, workouts, cp, prefs] = await Promise.all([listRoutes(), listWorkouts(), loadActiveCheckpoint(), getPreferences()])
      const recency = new Map<string, number>()
      for (const w of workouts) recency.set(w.templateId, Math.max(recency.get(w.templateId) ?? 0, w.endedAt ?? w.startedAt ?? 0))
      const sorted = routeList.sort((a, b) => (recency.get(b.id) ?? b.updatedAt) - (recency.get(a.id) ?? a.updatedAt))
      const selected = sorted.find(r => r.id === prefs.lastTrainingRouteId) ?? sorted[0]
      setRoutes(sorted)
      setSelectedId(selected?.id)
      setSetup(selected ? restoreWorkoutSetup(selected, prefs.lastWorkoutSetup) : undefined)
      setTrackingMode(prefs.trackingMode ?? 'automatic')
      setProgress(deriveTrainingProgress(workouts))
      setResume(cp)
      const cpRoute = cp ? await getRoute(cp.templateId) : undefined
      setResumeName(cpRoute?.name ?? null)
      setError('')
    } catch { setError('读取训练数据失败，请重试。') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    void refresh()
    return navigation.addListener('focus', () => { void refresh() })
  }, [navigation, refresh])

  const selected = routes.find(r => r.id === selectedId)
  const choose = async (r: RouteTemplate) => {
    setSelectedId(r.id)
    const prefs = await getPreferences()
    setSetup(restoreWorkoutSetup(r, prefs.lastWorkoutSetup))
    setChoosing(false)
    await savePreferences({ lastTrainingRouteId: r.id })
  }

  const start = async () => {
    if (busy) return
    setBusy(true)
    try {
      const cp = await loadActiveCheckpoint()
      if (cp) {
        const r = await getRoute(cp.templateId)
        if (!r) { await refresh(); return }
        if (cp.phase === 'ascending' || cp.phase === 'countdown') {
          const proceed = await new Promise<boolean>(resolve => Alert.alert('继续未完成训练', '中断的半轮会保留中断标记，并从准备阶段重新开始。', [
            { text: '取消', style: 'cancel', onPress: () => resolve(false) },
            { text: '继续', onPress: () => resolve(true) },
          ], { cancelable: false }))
          if (!proceed) return
        }
        navigation.navigate('ClimbWorkout', { id: cp.templateId, goal: cp.goal, returnConfirmationMode: cp.returnConfirmationMode, plan: cp.plan, trackingMode: cp.trackingMode })
        return
      }
      if (!selected) { navigation.navigate('AddRoute'); return }
      const current = await getRoute(selected.id)
      if (!current) { await refresh(); setError('这条路线已不存在，请选择其他路线。'); return }
      if (!isRoutePrepared(current)) { navigation.navigate('Familiarize', { id: current.id }); return }
      const prefs = await getPreferences()
      const validSetup = restoreWorkoutSetup(current, prefs.lastWorkoutSetup)
      if (!(await confirmBackgroundRecording())) return
      await savePreferences({ lastTrainingRouteId: current.id })
      navigation.navigate('ClimbWorkout', workoutEntryParams(current, { ...validSetup, trackingMode }, Date.now()))
    } catch (e) { setError(e instanceof Error ? e.message : '无法开始训练，请重试。') }
    finally { setBusy(false) }
  }

  const discard = () => Alert.alert('放弃这次未完成训练？', '这次尚未保存的训练将被清除。', [
    { text: '取消', style: 'cancel' },
    { text: '放弃', style: 'destructive', onPress: () => { void (async () => {
      if (!resume || busy) return
      setBusy(true)
      try { await discardCheckpointAsAbandoned(resume); await refresh() }
      catch (e) { Alert.alert('未能放弃训练', e instanceof Error ? e.message : String(e)) }
      finally { setBusy(false) }
    })() } },
  ])
  const finishSaved = async () => {
    if (!resume || busy) return
    setBusy(true)
    try {
      const w = await saveCheckpointAsCompleted(resume)
      await refresh()
      if (w) navigation.navigate('WorkoutResult', { id: w.id })
    } catch (e) { Alert.alert('未能完成保存', e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const moreResume = () => Alert.alert('未完成训练', '选择如何处理这次训练。', [
    { text: '取消', style: 'cancel' },
    ...(resumeName ? [{ text: '结束并保存', onPress: () => { void finishSaved() } }] : []),
    { text: '放弃这次训练', style: 'destructive' as const, onPress: discard },
  ])

  const styles = makeStyles(theme)
  const completedRounds = Array.isArray(resume?.completedRounds) ? resume.completedRounds : []
  const roundsDone = completedRounds.filter(r => r.complete).length
  const floorsDone = completedRounds.reduce((sum, r) => sum + Math.max(0, r.floorsCompleted), 0)
  return (
    <View style={styles.page}>
      <Header title="训练" back={false} large rightLabel="我的路线" onRightPress={() => navigation.navigate('Routes')} />
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {error ? <><Notice tone="danger">{error}</Notice><Button title="重新读取" variant="secondary" onPress={() => { void refresh() }} /></> : null}
        {loading ? <ActivityIndicator color={theme.green} accessibilityLabel="正在读取训练数据" /> : (
          <>
            {resume ? (
              <View style={styles.routeCard}>
                <Text style={styles.eyebrow}>继续上次训练</Text>
                <Text style={styles.routeName}>{resumeName ?? '路线已不存在'}</Text>
                <Text accessible accessibilityLiveRegion="polite" accessibilityLabel={`已完成 ${roundsDone} 轮，已爬 ${floorsDone} 层`} style={styles.secondary}>已完成 {roundsDone} 轮 · 已爬 {floorsDone} 层</Text>
                {!resumeName ? <Notice tone="danger">这次训练暂时无法恢复，请在更多操作中处理。</Notice> : null}
                <Pressable accessibilityRole="button" disabled={busy} onPress={moreResume} style={styles.textAction}><Text style={styles.link}>保存或处理这次训练</Text><Feather name="more-horizontal" size={20} color={theme.green} /></Pressable>
              </View>
            ) : (
              <View style={styles.routeCard}>
                <View style={styles.routeTop}>
                  <View style={styles.routeIcon}><BrandMark size={24} color={theme.green} /></View>
                  <Text style={styles.eyebrow}>{selected ? '当前路线' : '准备你的第一次训练'}</Text>
                  {routes.length ? <Pressable accessibilityRole="button" accessibilityLabel="更换路线" disabled={busy} onPress={() => setChoosing(!choosing)} accessibilityState={{ expanded: choosing }} style={styles.iconAction}><Feather name={choosing ? 'chevron-up' : 'chevron-down'} size={22} color={theme.ink} /></Pressable> : null}
                </View>
                <Text style={styles.secondary}>{selected ? preparationLabel(selected) : '先准备一条常用路线'}</Text>
                <Text style={styles.routeName}>{selected?.name ?? '第一次爬楼'}</Text>
                {selected && hasKnownRouteEnd(selected) ? <View style={styles.floorLine} accessible accessibilityLabel={`起点第 ${selected.startFloor} 楼，终点第 ${selected.endFloor} 楼`}>
                  <Text style={styles.floorNumber}>{selected.startFloor}<Text style={styles.floorUnit}> 楼</Text></Text>
                  <View style={styles.floorConnector}><View style={styles.floorRule} /><Feather name="arrow-up-right" size={18} color={theme.green} /></View>
                  <Text style={styles.floorNumber}>{selected.endFloor}<Text style={styles.floorUnit}> 楼</Text></Text>
                </View> : <Text style={styles.secondary}>添加或导入路线，先带手机熟悉常爬的楼梯。</Text>}
                {choosing ? <View style={styles.routeChoices}>
                  {routes.map(r => <Pressable key={r.id} accessibilityRole="button" accessibilityState={{ selected: selectedId === r.id }} onPress={() => { void choose(r) }} style={({ pressed }) => [styles.routeOption, selectedId === r.id && { backgroundColor: theme.greenSoft }, pressed && { opacity: 0.7 }]}>
                    <View style={{ flex: 1 }}><Text style={styles.optionName}>{r.name}</Text><Text style={styles.caption}>{hasKnownRouteEnd(r) ? `${r.startFloor} → ${r.endFloor} 楼` : '待熟悉'}</Text></View>
                    
                  </Pressable>)}
                </View> : null}
                {selected && isRoutePrepared(selected) ? <Pressable accessibilityRole="button" accessibilityLabel={`训练目标：${describeWorkoutGoal(setup?.goal ?? { type: 'open' })}，调整`} style={({ pressed }) => [styles.goalRow, pressed && { opacity: 0.7 }]} onPress={() => navigation.navigate('WorkoutSetup', { id: selected.id, trackingMode })}>
                  <View style={{ flex: 1 }}><Text style={styles.goalTitle}>{describeWorkoutGoal(setup?.goal ?? { type: 'open' })}</Text>{setup?.planEnabled ? <Text style={styles.caption}>含热身与休息计划</Text> : null}</View>
                  <Text style={styles.link}>调整</Text><Feather name="chevron-right" size={18} color={theme.green} />
                </Pressable> : null}
              </View>
            )}
            
            <Pressable accessibilityRole="button" accessibilityLabel={`本周有效训练：爬升 ${progress?.floors ?? 0} 层，${progress?.validWorkouts ?? 0} 次，查看记录`} onPress={() => navigation.navigate('History')} style={({ pressed }) => [styles.weekCard, pressed && { opacity: 0.7 }]}>
              <View style={styles.weekTop}><Text accessibilityRole="header" style={styles.sectionTitle}>本周累计</Text><Feather name="arrow-up-right" size={20} color={theme.mutedStrong} /></View>
              <View style={styles.weekNumbers}>
                <View style={{ flex: 1 }}><Text style={styles.weekValue}>{progress?.floors ?? 0}<Text style={styles.floorUnit}> 层</Text></Text><Text style={styles.caption}>实际爬升</Text></View><View style={styles.weekDivider} />
                <View style={{ flex: 1 }}><Text style={styles.weekValue}>{progress?.validWorkouts ?? 0}<Text style={styles.floorUnit}> 次</Text></Text><Text style={styles.caption}>有效训练</Text></View>
              </View>
            </Pressable>
          </>
        )}
      </ScrollView>
      <View style={styles.dock}>
        <Button title={resume ? '继续训练' : selected ? isRoutePrepared(selected) ? '开始爬楼' : '继续熟悉路线' : '添加第一条路线'} loading={busy} disabled={loading || Boolean(error) || Boolean(resume && !resumeName)} onPress={() => { void start() }} />
      </View>
    </View>
  )
}

const makeStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.paper }, content: { paddingHorizontal: theme.pagePaddingH, paddingTop: 8, paddingBottom: 24 },
  routeCard: { backgroundColor: theme.card, borderRadius: theme.radiusLg, padding: 16 }, routeTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  routeIcon: { width: 36, height: 36, backgroundColor: theme.greenSoft, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { flex: 1, color: theme.mutedStrong, fontSize: 13, fontWeight: '600' }, routeName: { color: theme.ink, fontSize: 21, lineHeight: 28, fontWeight: '700', marginTop: 12 },
  secondary: { color: theme.mutedStrong, fontSize: 14, lineHeight: 22, marginTop: 12 }, iconAction: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  floorLine: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 12 }, floorNumber: { color: theme.ink, fontSize: 28, fontWeight: '600', fontVariant: ['tabular-nums'] },
  floorUnit: { color: theme.mutedStrong, fontSize: 14, fontWeight: '400' }, floorConnector: { flex: 1, flexDirection: 'row', gap: 4, alignItems: 'center' }, floorRule: { flex: 1, height: 1, backgroundColor: theme.line },
  routeChoices: { marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line }, routeOption: { minHeight: 72, paddingVertical: 12, flexDirection: 'row', gap: 12, alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.lineSoft },
  optionName: { color: theme.ink, fontSize: 15, lineHeight: 22, fontWeight: '600' }, caption: { color: theme.mutedStrong, fontSize: 12, lineHeight: 18, marginTop: 4 },
  goalRow: { marginTop: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.lineSoft, minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 8 }, goalTitle: { color: theme.ink, fontSize: 16, lineHeight: 22, fontWeight: '600', marginTop: 4 },
  link: { color: theme.green, fontSize: 14, fontWeight: '600' }, textAction: { minHeight: 48, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modeCard: { backgroundColor: theme.card, borderRadius: theme.radiusLg, paddingHorizontal: 16, paddingVertical: 2, marginTop: 12 }, weekCard: { backgroundColor: theme.card, borderRadius: theme.radiusLg, padding: 16, marginTop: 12 }, weekTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { color: theme.ink, fontSize: 17, fontWeight: '600' },
  weekNumbers: { flexDirection: 'row', gap: 16, alignItems: 'center', marginTop: 8 }, weekValue: { color: theme.ink, fontSize: 32, fontWeight: '600', fontVariant: ['tabular-nums'] }, weekDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: theme.lineSoft },
  dock: { paddingHorizontal: theme.pagePaddingH, paddingTop: 8, paddingBottom: 12, backgroundColor: theme.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.lineSoft },
})
