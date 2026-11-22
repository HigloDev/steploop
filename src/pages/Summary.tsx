// 结算页（fusion-v1）：整次训练结束时统一查看、修改各轮层数（训练中不做每轮确认）。
// - 总爬升、总层数、轮数、用时、热量
// - 各趟记录：紧凑显示层数与用时，估算/待确认清晰标出，点按可核对层数
// - 新楼标定结果：命名并保存为楼栋模板（重新标定时覆盖原模板）
// - 分享卡片：复用 ShareStudio 与 assets/share 插画
// 旧记录（motion-v3 等）同样可以打开，只是没有逐层识别明细。

import { CoachWorkoutFeedback } from '../components/coach-workout-feedback'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { UIIcon, type UIIconName } from '../components/ui-icon'

import { Header } from '../components/Header'
import { SkinLead } from '../components/skin-art'
import { BuildingThumb } from '../components/BuildingThumb'
import { FlowSheet } from '../components/flow-sheet'
import { CompletionCelebration } from '../components/completion-celebration'
import { RoundBreakdown } from '../components/training-visuals'
import { BuildingTemplate, floorCount } from '../core/building-template'
import { formatCalories } from '../core/calories'
import { getWorkoutCalorieEstimate } from '../core/segmented-calories'
import { CalorieEstimateDetails } from '../components/calorie-estimate-details'
import { Disclosure } from '../components/disclosure'
import { floorAfter, getRoundAchievementCount } from '../core/floors'
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
import { GlassBackdrop, getGlassSurfaceStyle } from '../components/glass-material'
import { GlacierCompletionArt } from '../components/glacier-completion'
import { MotionPressable } from '../components/motion-pressable'
import { isGlacier, isLargeText, sport, Theme, typography, useTheme } from '../theme'

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
  const glass = isGlacier(theme)
  const insets = useSafeAreaInsets()
  const { width, fontScale } = useWindowDimensions()
  const twoColumns = width < 360 || isLargeText(fontScale)
  const [workout, setWorkout] = useState<ClimbWorkout | null>(null)
  const [flightReplay, setFlightReplay] = useState(0)
  const [template, setTemplate] = useState<BuildingTemplate>()
  const [pending, setPending] = useState<PendingTemplate | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [savedTemplate, setSavedTemplate] = useState(false)
  const [editing, setEditing] = useState<WorkoutRound | null>(null)
  const [draftFloors, setDraftFloors] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const savingRef = useRef(false)
  const [celebrationDone, setCelebrationDone] = useState(false)

  useEffect(() => {
    let mounted = true
    setError('')
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
          const suggestedName = draft.template.location?.address?.slice(0, 24) || `我的楼栋 · ${floorCount(draft.template)} 层`
          setTemplateName(original?.name ?? suggestedName)
        } else if (stored.buildingId) {
          setTemplate(await getBuilding(stored.buildingId))
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { mounted = false }
  }, [route.params.id, loadAttempt])

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

  const openEdit = (round: WorkoutRound) => {
    setEditing(round)
    setDraftFloors(getRoundAchievementCount(round))
  }

  const saveEdit = useCallback(async () => {
    if (!workout || !editing || savingRef.current) return
    savingRef.current = true
    setBusy(true)
    try {
      const next = correctRoundFloors(workout, editing.id, draftFloors, template)
      await saveWorkout(next)
      setWorkout(next)
      setEditing(null)
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : String(e))
    } finally {
      savingRef.current = false
      setBusy(false)
    }
  }, [workout, editing, draftFloors, template])

  const saveTemplate = useCallback(async () => {
    if (!pending || !workout || savingRef.current) return
    const name = templateName.trim()
    if (!name) { Alert.alert('请给这栋楼起个名字'); return }
    savingRef.current = true
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
      await clearPendingTemplate(workout.id)
      setPending(null)
      setTemplate(saved)
      setSavedTemplate(true)
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : String(e))
    } finally {
      savingRef.current = false
      setBusy(false)
    }
  }, [pending, workout, templateName, rounds.length, totals])

  if (error) {
    return (
      <View style={styles.page}>
        <Header title="训练结算" />
        <View style={[styles.center, { gap: 16 }]}>
          <Text selectable style={styles.muted}>{error}</Text>
          <Pressable accessibilityRole="button" style={[styles.primary, { paddingHorizontal: 32 }]} onPress={() => setLoadAttempt(value => value + 1)}>
            <Text style={styles.primaryText}>重新读取</Text>
          </Pressable>
        </View>
      </View>
    )
  }
  if (!workout || !totals) {
    return <View style={[styles.page, styles.center]}><ActivityIndicator color={theme.brandText} /></View>
  }

  const fusion = isFusionWorkout(workout)
  const notes = [...new Set([...(pending?.warnings ?? []), ...rounds.flatMap(round => round.notes ?? [])])]

  return (
    <View style={styles.page}>
      {glass ? <GlassBackdrop /> : null}
      {!glass && route.params.fresh && !celebrationDone && totals.floors > 0 ? <CompletionCelebration floors={totals.floors} ascentM={totals.ascent} onDone={() => setCelebrationDone(true)} /> : null}
      <Header title={route.params.fresh ? '训练完成' : '训练详情'} align={pending || savedTemplate ? 'left' : 'center'} back rightLabel="完成" onRightPress={() => navigation.navigate('Main', { screen: 'Train' })} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        {glass ? (
          <View style={styles.achievementGlass}>
            <Text style={styles.date}>{dateText(workout.startedAt)} · {workout.routeSnapshot.name}</Text>
            {!pending && route.params.fresh ? (savedTemplate ? (
              <View style={[styles.card, styles.savedCard]}>
                <UIIcon name="check-circle" size={22} color={theme.success} />
                <Text style={styles.savedText}>已保存「{template?.name}」，首页可直接选用。</Text>
              </View>
            ) : (
              <View style={styles.savedCard}>
                <UIIcon name="check-circle" size={20} color={theme.success} />
                <View style={{ flex: 1 }}><Text style={styles.savedTitle}>成绩已保存</Text></View>
              </View>
            )) : null}
          </View>
        ) : (
          <SkinLead kind="achievement" compact>
            <Text style={styles.date}>{dateText(workout.startedAt)} · {workout.routeSnapshot.name}</Text>
            <Text accessibilityRole="header" style={styles.completionTitle}>{route.params.fresh ? '今天，又向上\n了一程。' : '每一程，\n都留下高度。'}</Text>
          </SkinLead>
        )}
        <View style={[styles.hero, glass && [getGlassSurfaceStyle(theme, 'feature'), styles.heroGlass]]} accessible accessibilityLabel={`总爬升 ${totals.ascent} 米，${totals.floors} 层`}>
          <Text style={styles.heroLabel}>累计爬升</Text>
          <Text selectable numberOfLines={1} adjustsFontSizeToFit style={styles.heroReading}>
            <Text style={styles.heroValue}>{totals.ascent}</Text><Text style={styles.heroUnit}>{'\u00A0米'}</Text>
          </Text>
          <View style={styles.metrics}>
            {([
              { icon: 'stairs', label: '总层数', value: String(totals.floors), unit: '层' },
              { icon: 'rounds', label: '轮数', value: String(totals.rounds), unit: '轮' },
              { icon: 'clock', label: '用时', value: formatDuration(totals.elapsed) },
              { icon: 'fire', label: '热量', value: formatCalories(totals.calories), unit: '千卡', estimated: true },
            ] satisfies MetricData[]).map((metric, index) => <Metric key={metric.icon} {...metric} styles={styles} color={theme.brandText}
              half={twoColumns} divider={twoColumns ? index % 2 === 1 : index > 0} nextRow={twoColumns && index >= 2} />)}
          </View>
        </View>
        {!route.params.fresh ? <Disclosure compact title="热量估算依据"><CalorieEstimateDetails estimate={getWorkoutCalorieEstimate(workout)} /></Disclosure> : null}
        {glass && totals.floors > 0 ? (
          <View style={styles.achievementGlass}>
            <GlacierCompletionArt
              key={`${workout.id}:${flightReplay}`}
              floors={totals.floors}
              fresh={route.params.fresh || flightReplay > 0}
              size={Math.min(248, width - theme.pagePaddingH * 2)}
              sound={flightReplay === 0}
            />
            <MotionPressable
              accessibilityRole="button" accessibilityLabel="重播盖楼动画"
              style={styles.flightReplay} contentStyle={styles.flightReplayContent}
              onPress={() => setFlightReplay(value => value + 1)}
            >
              <UIIcon name="replay" size={18} color={theme.brandText} accessible={false} />
              <Text style={styles.flightReplayText}>重播盖楼</Text>
            </MotionPressable>
          </View>
        ) : null}
        {workout.coach ? <CoachWorkoutFeedback workout={workout} navigation={navigation} /> : null}
        <View style={[styles.roundCard, glass && [getGlassSurfaceStyle(theme, 'card'), styles.roundCardGlass]]}>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><Text style={styles.section}>每趟的节奏</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
          <Text style={styles.hint}>{fusion ? '点按核对层数' : '旧版成绩'}</Text>
        </View></View>
        <RoundBreakdown rounds={rounds} onEdit={fusion ? openEdit : undefined} disabled={busy} />

        </View>

        {notes.length ? (
          <View style={styles.notes}>
            {notes.slice(0, 5).map(note => (
              <View key={note} style={styles.noteRow}>
                <UIIcon name="info" size={16} color={theme.amberInk} />
                <Text style={styles.noteText}>{note}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {pending ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <BuildingThumb floors={floorCount(pending.template)} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{pending.replaceTemplateId ? '更新楼栋模板' : '保存为楼栋模板'}</Text>
                <Text style={styles.muted}>下次直接选用，跳过标定。</Text>
              </View>
            </View>
            <View style={styles.inputField}><TextInput
              value={templateName}
              onChangeText={setTemplateName}
              placeholder="给这栋楼起个名字"
              placeholderTextColor={theme.muted}
              maxLength={24}
              editable={!busy}
              returnKeyType="done"
              onSubmitEditing={() => void saveTemplate()}
              style={styles.input}
              accessibilityLabel="楼栋名称"
            />
              {templateName.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="清空楼栋名称" disabled={busy} onPress={() => setTemplateName('')} style={styles.clearButton}>
                <UIIcon name="close-circle" size={20} color={theme.mutedStrong} accessible={false} />
              </Pressable> : null}
            </View>
            <Pressable accessibilityRole="button" disabled={busy} onPress={saveTemplate} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}>
              <Text style={styles.primaryText}>{busy ? '保存中…' : pending.replaceTemplateId ? '更新模板' : '保存模板'}</Text>
            </Pressable>
          </View>
        ) : glass && route.params.fresh ? null : savedTemplate ? (
          <View style={[styles.card, styles.savedCard]}>
            <UIIcon name="check-circle" size={22} color={theme.success} />
            <Text style={styles.savedText}>已保存「{template?.name}」，首页可直接选用。</Text>
          </View>
        ) : <View style={styles.savedCard}>
          <UIIcon name="check-circle" size={20} color={theme.success} />
          <View style={{ flex: 1 }}><Text style={styles.savedTitle}>成绩已保存</Text></View>
        </View>}

        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('ShareStudio', { id: workout.id })} style={({ pressed }) => [pending ? styles.secondary : styles.primary, { marginTop: 20, flexDirection: 'row', gap: 8, minHeight: 52 }, pressed && { opacity: 0.85 }]}>
          <UIIcon name="share" size={21} color={pending ? theme.brandText : theme.onBrand} />
          <Text style={pending ? styles.secondaryText : styles.primaryText}>生成分享卡片</Text>
        </Pressable>
        {!fusion ? <Text style={styles.legacy}>这是旧版识别（{workout.recognitionVersion ?? 'motion-v3'}）的记录，没有逐层识别明细。</Text> : null}
      </ScrollView>

      <FlowSheet visible={!!editing} title={`${editing ? roundLabel(editing) : ''} · 修改层数`} busy={busy}
        onClose={() => { if (!busy) setEditing(null) }}>
            <Text style={styles.muted}>从 {editing?.startFloor ?? 1} 楼爬到 {floorAfter(editing?.startFloor ?? 1, draftFloors)} 楼，共爬升 {draftFloors} 层。</Text>
            <View style={styles.stepper}>
              <Pressable accessibilityRole="button" accessibilityLabel="减一层" disabled={busy || draftFloors === 0} onPress={() => setDraftFloors(value => Math.max(0, value - 1))} style={styles.stepButton}>
                <UIIcon name="minus" size={30} color={theme.ink} />
              </Pressable>
              <Text style={styles.stepValue} numberOfLines={1} adjustsFontSizeToFit accessibilityLiveRegion="polite">{draftFloors}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="加一层" disabled={busy || draftFloors === 300} onPress={() => setDraftFloors(value => Math.min(300, value + 1))} style={[styles.stepButton, { backgroundColor: theme.brand }]}>
                <UIIcon name="plus" size={30} color={theme.onBrand} />
              </Pressable>
            </View>
            <Text style={[styles.hint, { textAlign: 'center' }]}>修改后会保留修正记录。</Text>
            <View style={styles.modalRow}>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => setEditing(null)} style={[styles.secondary, { flex: 1, marginTop: 0, backgroundColor: theme.surfaceSoft, borderColor: theme.line, borderRadius: 18 }]}>
                <Text style={[styles.secondaryText, { color: theme.inkSoft }]}>取消</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={busy} onPress={saveEdit} style={[styles.primary, { flex: 1, marginTop: 0 }]}>
                <Text style={styles.primaryText}>{busy ? '保存中…' : '保存'}</Text>
              </Pressable>
            </View>
      </FlowSheet>
    </View>
  )
}

interface MetricData {
  icon: UIIconName
  label: string
  value: string
  unit?: string
  estimated?: boolean
}

function Metric({ icon, label, value, unit, estimated, half, divider, nextRow, styles, color }: MetricData & {
  half: boolean; divider: boolean; nextRow: boolean; styles: ReturnType<typeof makeStyles>; color: string
}) {
  return (
    <View style={[styles.metric, half && styles.metricHalf, divider && styles.metricDivider, nextRow && styles.metricNextRow]}
      accessible accessibilityLabel={`${label} ${value}${unit ?? ''}${estimated ? '，估算' : ''}`}>
      <View style={styles.metricHeading}>
        <UIIcon name={icon} size={17} color={color} />
        <Text style={styles.metricLabel}>{label}</Text>
      </View>
      <View style={styles.metricReading}>
        <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
        {unit ? <Text style={styles.metricUnit}>{unit}</Text> : null}
      </View>
      {estimated ? <Text style={styles.metricUnit}>估算</Text> : null}
    </View>
  )
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    content: { paddingHorizontal: theme.pagePaddingH, paddingTop: 20 },
    date: { ...typography.secondary, color: theme.mutedStrong },
    completionTitle: { ...typography.title, color: theme.ink, marginTop: 12 },
    achievementGlass: { alignItems: 'stretch', marginTop: 4 },
    flightReplay: { alignSelf: 'center', minHeight: 48, paddingHorizontal: 14, justifyContent: 'center', marginTop: -12 },
    flightReplayContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    flightReplayText: { ...typography.label, color: theme.brandText },
    hero: { marginTop: 24, paddingBottom: 24, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
    heroGlass: { marginTop: 24, padding: 16, borderRadius: sport.radius.panel, borderBottomWidth: 0 },
    compactMetrics: { marginTop: 12, paddingVertical: 20, paddingHorizontal: 8, flexDirection: 'row', backgroundColor: theme.card, borderRadius: 20 },
    roundCard: { marginTop: 24 },
    roundCardGlass: { marginTop: 24, padding: 16, borderRadius: sport.radius.panel },
    savedTitle: { ...typography.label, color: theme.inkSoft, marginBottom: 4 },
    heroLabel: { ...typography.label, color: theme.mutedStrong },
    heroReading: { fontSize: 84, lineHeight: 94, includeFontPadding: false, marginTop: 4 },
    heroValue: { ...typography.digits, color: theme.brandText },
    heroUnit: { fontSize: typography.navigation.fontSize, color: theme.mutedStrong },
    metrics: { flexDirection: 'row', flexWrap: 'wrap', paddingTop: 12, marginTop: 8 },
    metric: { flex: 1, minWidth: 0, paddingVertical: 8, paddingHorizontal: 8, gap: 3 },
    metricHalf: { flexGrow: 0, flexBasis: '50%', paddingVertical: 12, paddingHorizontal: 12 },
    metricDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.line },
    metricNextRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
    metricHeading: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 24 },
    metricReading: { flexDirection: 'row', alignItems: 'baseline', gap: 3, flexWrap: 'wrap' },
    metricValue: { ...typography.digits, color: theme.ink, fontSize: 27, lineHeight: 34, flexShrink: 1 },
    metricLabel: { ...typography.caption, color: theme.mutedStrong, flexShrink: 1 },
    metricUnit: { ...typography.caption, color: theme.mutedStrong },
    section: { ...typography.section, color: theme.ink },
    hint: { ...typography.caption, color: theme.mutedStrong, marginTop: 4 },
    bars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-evenly', gap: 24, paddingVertical: 6, minHeight: 140, flexGrow: 1,},
    barCol: { alignItems: 'center', width: 88,},
    barValue: { ...theme.numeric, color: theme.ink, fontSize: 20, marginBottom: 6 },
    bar: { width: 72, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: theme.brandText },
    barEstimated: { backgroundColor: theme.amberSoft, borderWidth: 2, borderStyle: 'dashed', borderColor: theme.amber },
    barCorrected: { backgroundColor: theme.brandTint },
    barLabel: { color: theme.mutedStrong, fontSize: 14, fontWeight: '700', marginTop: 6 },
    barTag: { color: theme.amberInk, fontSize: 11, fontWeight: '800', marginTop: 2 },
    notes: { backgroundColor: theme.amberSoft, borderRadius: theme.radiusMd, padding: 12, gap: 6 },
    noteRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
    noteText: { ...typography.secondary, flex: 1, color: theme.amberInk },
    card: { backgroundColor: theme.card, borderRadius: theme.radiusLg, padding: 16, marginTop: 20, gap: 12, ...theme.shadowCard },
    cardHead: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    cardTitle: { ...typography.cardTitle, color: theme.ink },
    muted: { ...typography.secondary, color: theme.mutedStrong },
    inputField: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderRadius: theme.radiusMd, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.cardSoft },
    input: { flex: 1, minHeight: 48, paddingHorizontal: 14, color: theme.ink, fontSize: 20 },
    clearButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    primary: { minHeight: 54, borderRadius: sport.radius.control, backgroundColor: theme.brand, alignItems: 'center', justifyContent: 'center' },
    primaryText: { ...typography.control, color: theme.onBrand },
    secondary: {
      minHeight: 52, borderRadius: 26, borderWidth: 1.5, borderColor: theme.brandText, flexDirection: 'row',
      alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20,
    },
    secondaryText: { ...typography.control, color: theme.brandInk },
    savedCard: { flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingVertical: 12, minHeight: 60, gap: 12 },
    savedText: { flex: 1, color: theme.ink, fontSize: 14, fontWeight: '700' },
    legacy: { color: theme.muted, fontSize: 12, textAlign: 'center', marginTop: 16 },
    stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginVertical: 8 },
    stepButton: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.surfaceSoft, alignItems: 'center', justifyContent: 'center' },
    stepText: { color: theme.brandInk, fontSize: 30, fontWeight: '900' },
    stepValue: { ...typography.digits, color: theme.ink, fontSize: 88, lineHeight: 96, minWidth: 90, flexShrink: 1, textAlign: 'center' },
    modalRow: { flexDirection: 'row', gap: 12 },
  })
}
