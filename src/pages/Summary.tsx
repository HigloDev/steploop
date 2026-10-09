// 结算页（fusion-v1）：整次训练结束时统一查看、修改各轮层数（训练中不做每轮确认）。
// - 总爬升、总层数、轮数、用时、热量
// - 各轮柱状图：点任一轮改层数，估算轮虚线标出
// - 新楼标定结果：命名并保存为楼栋模板（重新标定时覆盖原模板）
// - 分享卡片：复用 ShareStudio 与 assets/share 插画
// 旧记录（motion-v3 等）同样可以打开，只是没有逐层识别明细。

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MaterialCommunityIcons } from '@expo/vector-icons'

import { Header } from '../components/Header'
import { BuildingThumb } from '../components/BuildingThumb'
import { BuildingTemplate, floorCount } from '../core/building-template'
import { formatCalories } from '../core/calories'
import { getRoundAchievementCount } from '../core/floors'
import { correctRoundFloors, isFusionWorkout, workoutCalories } from '../core/fusion-workout'
import { formatDuration } from '../core/math'
import type { ClimbWorkout, WorkoutRound } from '../core/types'
import type { RootStackScreen } from '../navigation/types'
import {
  clearPendingTemplate,
  getBuilding,
  loadPendingTemplate,
  PendingTemplate,
  recordBuildingResult,
  saveBuilding,
} from '../services/building-storage'
import { getWorkout, saveWorkout } from '../services/workout-storage'
import { Theme, useTheme } from '../theme'

function dateText(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function roundLabel(round: WorkoutRound): string {
  return round.roundKind === 'calibration' ? '标定' : `第${round.roundNumber}轮`
}

export default function SummaryScreen({ navigation, route }: RootStackScreen<'WorkoutResult'>) {
  const theme = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const insets = useSafeAreaInsets()
  const [workout, setWorkout] = useState<ClimbWorkout | null>(null)
  const [template, setTemplate] = useState<BuildingTemplate>()
  const [pending, setPending] = useState<PendingTemplate | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [savedTemplate, setSavedTemplate] = useState(false)
  const [editing, setEditing] = useState<WorkoutRound | null>(null)
  const [draftFloors, setDraftFloors] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        const stored = await getWorkout(route.params.id)
        if (!mounted) return
        if (!stored) { setError('找不到这次训练记录。'); return }
        setWorkout(stored)
        const draft = await loadPendingTemplate(stored.id)
        if (!mounted) return
        if (draft) {
          setPending(draft)
          setTemplate(draft.template)
          const original = draft.replaceTemplateId ? await getBuilding(draft.replaceTemplateId) : undefined
          setTemplateName(original?.name ?? `我的楼栋 · ${floorCount(draft.template)} 层`)
        } else if (stored.buildingId) {
          setTemplate(await getBuilding(stored.buildingId))
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { mounted = false }
  }, [route.params.id])

  const rounds = workout?.rounds ?? []
  const totals = useMemo(() => {
    if (!workout) return undefined
    const floors = rounds.reduce((sum, round) => sum + getRoundAchievementCount(round), 0)
    const ascent = rounds.reduce((sum, round) => sum + (round.floorConfirmation === 'pending' ? 0 : round.ascentM), 0)
    return {
      floors,
      ascent: Math.round(ascent),
      rounds: rounds.filter(round => getRoundAchievementCount(round) > 0).length,
      elapsed: workout.totalElapsedMs || Math.max(0, (workout.endedAt ?? workout.updatedAt) - workout.startedAt),
      calories: workoutCalories(workout),
    }
  }, [workout, rounds])

  const maxFloors = Math.max(1, ...rounds.map(round => getRoundAchievementCount(round)))

  const openEdit = (round: WorkoutRound) => {
    setEditing(round)
    setDraftFloors(getRoundAchievementCount(round))
  }

  const saveEdit = useCallback(async () => {
    if (!workout || !editing) return
    setBusy(true)
    try {
      const next = correctRoundFloors(workout, editing.id, draftFloors, template)
      await saveWorkout(next)
      setWorkout(next)
      setEditing(null)
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [workout, editing, draftFloors, template])

  const saveTemplate = useCallback(async () => {
    if (!pending || !workout) return
    const name = templateName.trim()
    if (!name) { Alert.alert('请给这栋楼起个名字'); return }
    setBusy(true)
    try {
      const base = pending.template
      const replace = pending.replaceTemplateId
      // 重新标定旧路线：生成新模板并记住来源，旧路线不再重复出现在首页（旧数据本身不改写）。
      const legacyRouteId = replace?.startsWith('legacy_') ? replace.slice('legacy_'.length) : undefined
      const previous = replace ? await getBuilding(replace) : undefined
      const saved = await saveBuilding({
        ...base,
        id: legacyRouteId ? `building_${legacyRouteId}` : replace ?? base.id,
        name,
        version: previous ? previous.version + 1 : base.version,
        ...(previous?.location ? { location: previous.location } : {}),
        ...(legacyRouteId ? { legacyRouteId } : {}),
      })
      await recordBuildingResult(saved.id, {
        workoutId: workout.id, at: workout.endedAt ?? Date.now(), rounds: rounds.length,
        floors: totals?.floors ?? 0, ascentM: totals?.ascent ?? 0, bestRoundMs: workout.bestRoundMs,
      })
      const linked = { ...workout, buildingId: saved.id, templateId: saved.id,
        routeSnapshot: { ...workout.routeSnapshot, name, locationName: name } }
      await saveWorkout(linked)
      setWorkout(linked)
      await clearPendingTemplate()
      setPending(null)
      setTemplate(saved)
      setSavedTemplate(true)
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [pending, workout, templateName, rounds.length, totals])

  if (error) {
    return (
      <View style={styles.page}>
        <Header title="训练结算" />
        <View style={styles.center}><Text style={styles.muted}>{error}</Text></View>
      </View>
    )
  }
  if (!workout || !totals) {
    return <View style={[styles.page, styles.center]}><ActivityIndicator color={theme.brand} /></View>
  }

  const fusion = isFusionWorkout(workout)
  const notes = [...new Set([...(pending?.warnings ?? []), ...rounds.flatMap(round => round.notes ?? [])])]

  return (
    <View style={styles.page}>
      <Header title={route.params.fresh ? '训练完成' : '训练详情'} rightLabel="完成" onRightPress={() => navigation.navigate('Main', { screen: 'Train' })} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <Text style={styles.date}>{dateText(workout.startedAt)} · {workout.routeSnapshot.name}</Text>
        <View style={styles.hero} accessible accessibilityLabel={`总爬升 ${totals.ascent} 米，${totals.floors} 层`}>
          <Text style={styles.heroLabel}>总爬升</Text>
          <View style={styles.heroRow}>
            <Text style={styles.heroValue}>{totals.ascent}</Text>
            <Text style={styles.heroUnit}>米</Text>
          </View>
        </View>
        <View style={styles.metrics}>
          <Metric styles={styles} label="总层数" value={String(totals.floors)} />
          <Metric styles={styles} label="轮数" value={String(totals.rounds)} />
          <Metric styles={styles} label="用时" value={formatDuration(totals.elapsed)} />
          <Metric styles={styles} label="千卡" value={formatCalories(totals.calories)} />
        </View>

        <Text style={styles.section}>各轮层数</Text>
        <Text style={styles.hint}>点任意一轮可以修改层数。虚线是估算轮，建议核对。</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bars}>
          {rounds.map(round => {
            const floors = getRoundAchievementCount(round)
            const estimated = round.estimated === true || round.floorConfirmation === 'pending'
            const corrected = (round.corrections?.length ?? 0) > 0
            const height = 24 + (floors / maxFloors) * 140
            return (
              <Pressable
                key={round.id}
                accessibilityRole="button"
                accessibilityLabel={`${roundLabel(round)}，${floors} 层${estimated ? '，估算' : ''}${corrected ? '，已修改' : ''}，点按修改`}
                onPress={() => openEdit(round)}
                style={styles.barCol}
              >
                <Text style={[styles.barValue, estimated && { color: theme.amberInk }]}>{floors}</Text>
                <View style={[styles.bar, { height }, estimated ? styles.barEstimated : null, corrected ? styles.barCorrected : null]} />
                <Text style={styles.barLabel}>{roundLabel(round)}</Text>
                {estimated ? <Text style={styles.barTag}>估算</Text> : corrected ? <Text style={[styles.barTag, { color: theme.brandInk }]}>已改</Text> : null}
              </Pressable>
            )
          })}
        </ScrollView>

        {notes.length ? (
          <View style={styles.notes}>
            {notes.slice(0, 5).map(note => (
              <View key={note} style={styles.noteRow}>
                <MaterialCommunityIcons name="information-outline" size={16} color={theme.amberInk} />
                <Text style={styles.noteText}>{note}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {pending ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <BuildingThumb floors={floorCount(pending.template)} size={56} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{pending.replaceTemplateId ? '更新楼栋模板' : '保存为楼栋模板'}</Text>
                <Text style={styles.muted}>下次在这栋楼直接选用，跳过标定，第一轮就自动计层。</Text>
              </View>
            </View>
            <TextInput
              value={templateName}
              onChangeText={setTemplateName}
              placeholder="给这栋楼起个名字"
              placeholderTextColor={theme.muted}
              maxLength={24}
              style={styles.input}
              accessibilityLabel="楼栋名称"
            />
            <Pressable accessibilityRole="button" disabled={busy} onPress={saveTemplate} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}>
              <Text style={styles.primaryText}>{pending.replaceTemplateId ? '更新模板' : '保存模板'}</Text>
            </Pressable>
          </View>
        ) : savedTemplate ? (
          <View style={[styles.card, styles.savedCard]}>
            <MaterialCommunityIcons name="check-circle" size={22} color={theme.success} />
            <Text style={styles.savedText}>已保存「{template?.name}」，首页可直接选用。</Text>
          </View>
        ) : null}

        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('ShareStudio', { id: workout.id })} style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.85 }]}>
          <MaterialCommunityIcons name="image-outline" size={20} color={theme.brandInk} />
          <Text style={styles.secondaryText}>生成分享卡片</Text>
        </Pressable>
        {!fusion ? <Text style={styles.legacy}>这是旧版识别（{workout.recognitionVersion ?? 'motion-v3'}）的记录，没有逐层识别明细。</Text> : null}
      </ScrollView>

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalScrim}>
          <View style={styles.modal}>
            <Text style={styles.cardTitle}>{editing ? roundLabel(editing) : ''} · 修改层数</Text>
            <Text style={styles.muted}>从 {editing?.startFloor ?? 1} 楼出发，爬升层数（1→15 楼记 14 层）。</Text>
            <View style={styles.stepper}>
              <Pressable accessibilityRole="button" accessibilityLabel="减一层" onPress={() => setDraftFloors(value => Math.max(0, value - 1))} style={styles.stepButton}>
                <Text style={styles.stepText}>−</Text>
              </Pressable>
              <Text style={styles.stepValue} accessibilityLiveRegion="polite">{draftFloors}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="加一层" onPress={() => setDraftFloors(value => Math.min(300, value + 1))} style={styles.stepButton}>
                <Text style={styles.stepText}>＋</Text>
              </Pressable>
            </View>
            <View style={styles.modalRow}>
              <Pressable accessibilityRole="button" onPress={() => setEditing(null)} style={[styles.secondary, { flex: 1, marginTop: 0 }]}>
                <Text style={styles.secondaryText}>取消</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={busy} onPress={saveEdit} style={[styles.primary, { flex: 1, marginTop: 0 }]}>
                <Text style={styles.primaryText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function Metric({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.metric} accessible accessibilityLabel={`${label} ${value}`}>
      <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  )
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    content: { paddingHorizontal: theme.pagePaddingH, paddingTop: 4 },
    date: { color: theme.muted, fontSize: 14, fontWeight: '600' },
    hero: { marginTop: 14 },
    heroLabel: { color: theme.brandInk, fontSize: 15, fontWeight: '800' },
    heroRow: { flexDirection: 'row', alignItems: 'flex-end' },
    heroValue: { ...theme.numeric, color: theme.ink, fontSize: 84, lineHeight: 90 },
    heroUnit: { color: theme.inkSoft, fontSize: 24, fontWeight: '800', marginBottom: 14, marginLeft: 6 },
    metrics: { flexDirection: 'row', backgroundColor: theme.card, borderRadius: theme.radiusLg, paddingVertical: 16, marginTop: 12, ...theme.shadowCard },
    metric: { flex: 1, alignItems: 'center' },
    metricValue: { ...theme.numeric, color: theme.ink, fontSize: 24 },
    metricLabel: { color: theme.muted, fontSize: 12, fontWeight: '700', marginTop: 2 },
    section: { color: theme.ink, fontSize: 18, fontWeight: '900', marginTop: 28 },
    hint: { color: theme.muted, fontSize: 13, marginTop: 4 },
    bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 14, paddingVertical: 16, minHeight: 230 },
    barCol: { alignItems: 'center', width: 52 },
    barValue: { ...theme.numeric, color: theme.ink, fontSize: 18, marginBottom: 6 },
    bar: { width: 36, borderRadius: 10, backgroundColor: theme.brand },
    barEstimated: { backgroundColor: theme.amberSoft, borderWidth: 2, borderStyle: 'dashed', borderColor: theme.amber },
    barCorrected: { backgroundColor: theme.brandTint },
    barLabel: { color: theme.mutedStrong, fontSize: 12, fontWeight: '700', marginTop: 6 },
    barTag: { color: theme.amberInk, fontSize: 11, fontWeight: '800', marginTop: 2 },
    notes: { backgroundColor: theme.amberSoft, borderRadius: theme.radiusMd, padding: 12, gap: 6 },
    noteRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
    noteText: { flex: 1, color: theme.amberInk, fontSize: 13, lineHeight: 19 },
    card: { backgroundColor: theme.card, borderRadius: theme.radiusLg, padding: 16, marginTop: 20, gap: 12, ...theme.shadowCard },
    cardHead: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    cardTitle: { color: theme.ink, fontSize: 17, fontWeight: '900' },
    muted: { color: theme.muted, fontSize: 13, lineHeight: 19 },
    input: {
      minHeight: 48, borderRadius: theme.radiusMd, borderWidth: 1, borderColor: theme.line, paddingHorizontal: 14,
      color: theme.ink, fontSize: 16, backgroundColor: theme.cardSoft,
    },
    primary: { minHeight: 52, borderRadius: 26, backgroundColor: theme.brand, alignItems: 'center', justifyContent: 'center' },
    primaryText: { color: theme.onBrand, fontSize: 17, fontWeight: '900' },
    secondary: {
      minHeight: 52, borderRadius: 26, borderWidth: 1.5, borderColor: theme.brandTint, flexDirection: 'row',
      alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20,
    },
    secondaryText: { color: theme.brandInk, fontSize: 16, fontWeight: '800' },
    savedCard: { flexDirection: 'row', alignItems: 'center' },
    savedText: { flex: 1, color: theme.ink, fontSize: 14, fontWeight: '700' },
    legacy: { color: theme.muted, fontSize: 12, textAlign: 'center', marginTop: 16 },
    modalScrim: { flex: 1, backgroundColor: theme.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
    modal: { width: '100%', maxWidth: 380, backgroundColor: theme.card, borderRadius: theme.radiusXl, padding: 20, gap: 12 },
    stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginVertical: 8 },
    stepButton: { width: 60, height: 60, borderRadius: 30, backgroundColor: theme.brandSoft, alignItems: 'center', justifyContent: 'center' },
    stepText: { color: theme.brandInk, fontSize: 30, fontWeight: '900' },
    stepValue: { ...theme.numeric, color: theme.ink, fontSize: 56, minWidth: 90, textAlign: 'center' },
    modalRow: { flexDirection: 'row', gap: 12 },
  })
}
