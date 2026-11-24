// 结算页（fusion-v1）：整次训练结束时统一查看、修改各轮层数。
// - 新鲜结算（fresh=true）自动播放盖楼动画与封顶音效，右上角「完成」回训练首页；
// - 历史查看（fresh=false）默认静帧可手动重播，右上角提供「分享」直达海报工作台。

import { CoachWorkoutFeedback } from '../components/coach-workout-feedback'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { UIIcon, type UIIconName } from '../components/ui-icon'

import { Header } from '../components/Header'
import { BuildingThumb } from '../components/BuildingThumb'
import { FlowSheet } from '../components/flow-sheet'
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
import { MotionCompletionHalo, MotionHeroSurfaceArt } from '../components/motion-ring-graphics'
import { MotionPressable } from '../components/motion-pressable'
import { useReduceMotion } from '../components/ui'
import { getPrimaryActionPaint, isLargeText, isMotionRing, sport, Theme, typography, useTheme, useThemeStyles } from '../theme'

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
  const motionRing = isMotionRing(theme)
  const reduced = useReduceMotion()
  const styles = useThemeStyles(makeStyles)
  const actionPaint = getPrimaryActionPaint(theme)
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

  useEffect(() => {
    let mounted = true
    setError('')
    void (async () => {
      try {
        const stored = await getWorkout(route.params.id)
        if (!mounted) return
        if (!stored) {
          setError('找不到这次训练记录。')
          return
        }
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
    return () => {
      mounted = false
    }
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
    if (!name) {
      Alert.alert('请给这栋楼起个名字')
      return
    }
    savingRef.current = true
    setBusy(true)
    try {
      const base = pending.template
      const replace = pending.replaceTemplateId
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
        workoutId: workout.id,
        at: workout.endedAt ?? Date.now(),
        rounds: rounds.length,
        floors: totals?.floors ?? 0,
        ascentM: totals?.ascent ?? 0,
        bestRoundMs: workout.bestRoundMs,
      })
      const linked = {
        ...workout,
        buildingId: saved.id,
        templateId: saved.id,
        routeSnapshot: { ...workout.routeSnapshot, name, locationName: name },
      }
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
        <GlassBackdrop />
        <Header title="训练结算" />
        <View style={[styles.center, { gap: 16 }]}>
          <Text selectable style={styles.muted}>{error}</Text>
          <Pressable
            accessibilityRole="button"
            style={[styles.primary, { paddingHorizontal: 32, backgroundColor: actionPaint.fill }]}
            onPress={() => setLoadAttempt(value => value + 1)}
          >
            <Text style={[styles.primaryText, { color: actionPaint.ink }]}>重新读取</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  if (!workout || !totals) {
    return (
      <View style={[styles.page, styles.center]}>
        <GlassBackdrop />
        <ActivityIndicator color={theme.brandText} />
      </View>
    )
  }

  const fusion = isFusionWorkout(workout)
  const fresh = Boolean(route.params.fresh)
  const notes = [...new Set([...(pending?.warnings ?? []), ...rounds.flatMap(round => round.notes ?? [])])]

  return (
    <View style={styles.page}>
      <GlassBackdrop />
      <Header
        title={fresh ? '训练完成' : '训练详情'}
        align={pending || savedTemplate ? 'left' : 'center'}
        back
        rightLabel={fresh ? '完成' : '分享'}
        onRightPress={() => {
          if (fresh) navigation.navigate('Main', { screen: 'Train' })
          else navigation.navigate('ShareStudio', { id: workout.id })
        }}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        <View style={styles.metaHead}>
          <Text style={styles.date}>
            {dateText(workout.startedAt)} · {workout.routeSnapshot.locationName || workout.routeSnapshot.name}
          </Text>
          {!pending && fresh ? (
            savedTemplate ? (
              <View style={[styles.savedCard, getGlassSurfaceStyle(theme, 'card')]}>
                <UIIcon name="check-circle" size={22} color={theme.success} />
                <Text style={styles.savedText}>已保存「{template?.name}」，首页可直接选用。</Text>
              </View>
            ) : (
              <View style={styles.savedInline}>
                <UIIcon name="check-circle" size={18} color={theme.success} />
                <Text style={styles.savedTitle}>成绩已保存</Text>
              </View>
            )
          ) : null}
        </View>

        <View
          style={[
            styles.hero,
            motionRing
              ? {
                  backgroundColor: theme.heroSurface,
                  borderWidth: 1,
                  borderColor: theme.brandVisual.frostStroke,
                  overflow: 'hidden',
                  ...theme.elevation.level2.shadow,
                }
              : getGlassSurfaceStyle(theme, 'feature'),
          ]}
          accessible
          accessibilityLabel={`总爬升 ${totals.ascent} 米，${totals.floors} 层`}
        >
          {motionRing ? <MotionHeroSurfaceArt variant="summary" /> : null}
          <Text style={[styles.heroLabel, motionRing && { color: theme.heroMuted }]}>累计爬升</Text>
          <Text selectable numberOfLines={1} adjustsFontSizeToFit style={styles.heroReading}>
            <Text style={[styles.heroValue, motionRing && { color: theme.heroAccent }]}>{totals.ascent}</Text>
            <Text style={[styles.heroUnit, motionRing && { color: theme.heroMuted }]}>{'\u00A0米'}</Text>
          </Text>
          <View style={styles.metrics}>
            {(
              [
                { icon: 'stairs', label: '总层数', value: String(totals.floors), unit: '层' },
                { icon: 'rounds', label: '轮数', value: String(totals.rounds), unit: '轮' },
                { icon: 'clock', label: '用时', value: formatDuration(totals.elapsed) },
                { icon: 'fire', label: '热量', value: formatCalories(totals.calories), unit: '千卡', estimated: true },
              ] satisfies MetricData[]
            ).map((metric, index) => (
              <Metric
                key={metric.icon}
                {...metric}
                styles={styles}
                color={motionRing ? theme.heroAccent : theme.brandText}
                inverted={motionRing}
                heroInk={theme.heroInk}
                heroMuted={theme.heroMuted}
                heroLine={theme.heroLine}
                half={twoColumns}
                divider={twoColumns ? index % 2 === 1 : index > 0}
                nextRow={twoColumns && index >= 2}
              />
            ))}
          </View>
        </View>

        {!fresh ? (
          <Disclosure compact icon="info" title="热量估算依据" marginTop={8}>
            <CalorieEstimateDetails estimate={getWorkoutCalorieEstimate(workout)} />
          </Disclosure>
        ) : null}

        {totals.floors > 0 ? (
          <View style={styles.achievementGlass}>
            <MotionCompletionHalo size={Math.min(248, width - theme.pagePaddingH * 2)} reducedMotion={reduced}>
              <GlacierCompletionArt
                key={`${workout.id}:${flightReplay}`}
                floors={totals.floors}
                fresh={fresh || flightReplay > 0}
                size={Math.min(248, width - theme.pagePaddingH * 2)}
                sound={flightReplay === 0}
              />
            </MotionCompletionHalo>
            <MotionPressable
              accessibilityRole="button"
              accessibilityLabel="重播盖楼动画"
              style={styles.flightReplay}
              contentStyle={styles.flightReplayContent}
              onPress={() => setFlightReplay(value => value + 1)}
            >
              <UIIcon name="replay" size={18} color={theme.brandText} accessible={false} />
              <Text style={styles.flightReplayText}>重播盖楼</Text>
            </MotionPressable>
          </View>
        ) : null}

        {workout.coach ? <CoachWorkoutFeedback workout={workout} navigation={navigation} /> : null}

        <View style={[styles.roundCard, getGlassSurfaceStyle(theme, 'card')]}>
          <View style={styles.roundCardHead}>
            <Text style={styles.section}>每趟的节奏</Text>
            <Text style={styles.hint}>{fusion ? '点按核对层数' : '旧版成绩'}</Text>
          </View>
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
          <View style={[styles.card, getGlassSurfaceStyle(theme, 'feature')]}>
            <View style={styles.cardHead}>
              <BuildingThumb floors={floorCount(pending.template)} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{pending.replaceTemplateId ? '更新楼栋模板' : '保存为楼栋模板'}</Text>
                <Text style={styles.muted}>下次直接选用，跳过标定。</Text>
              </View>
            </View>
            <View style={styles.inputField}>
              <TextInput
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
              {templateName.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="清空楼栋名称"
                  disabled={busy}
                  onPress={() => setTemplateName('')}
                  style={styles.clearButton}
                >
                  <UIIcon name="close-circle" size={20} color={theme.mutedStrong} accessible={false} />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={saveTemplate}
              style={({ pressed }) => [
                styles.primary,
                { backgroundColor: actionPaint.fill },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.primaryText, { color: actionPaint.ink }]}>
                {busy ? '保存中…' : pending.replaceTemplateId ? '更新模板' : '保存模板'}
              </Text>
            </Pressable>
          </View>
        ) : fresh ? null : savedTemplate ? (
          <View style={[styles.savedCard, getGlassSurfaceStyle(theme, 'card')]}>
            <UIIcon name="check-circle" size={22} color={theme.success} />
            <Text style={styles.savedText}>已保存「{template?.name}」，首页可直接选用。</Text>
          </View>
        ) : null}

        <MotionPressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('ShareStudio', { id: workout.id })}
          style={[
            pending ? styles.secondary : [styles.primary, { backgroundColor: actionPaint.fill }],
            { marginTop: 20 },
          ]}
          contentStyle={styles.shareButtonContent}
        >
          <UIIcon name="share" size={21} color={pending ? theme.brandText : actionPaint.ink} />
          <Text style={pending ? styles.secondaryText : [styles.primaryText, { color: actionPaint.ink }]}>
            生成分享卡片
          </Text>
        </MotionPressable>

        {!fusion ? (
          <Text style={styles.legacy}>这是旧版识别（{workout.recognitionVersion ?? 'motion-v3'}）的记录，没有逐层识别明细。</Text>
        ) : null}
      </ScrollView>

      <FlowSheet
        visible={!!editing}
        title={`${editing ? roundLabel(editing) : ''} · 修改层数`}
        busy={busy}
        onClose={() => {
          if (!busy) setEditing(null)
        }}
      >
        <Text style={styles.muted}>
          从 {editing?.startFloor ?? 1} 楼爬到 {floorAfter(editing?.startFloor ?? 1, draftFloors)} 楼，共爬升 {draftFloors} 层。
        </Text>
        <View style={styles.stepper}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="减一层"
            disabled={busy || draftFloors === 0}
            onPress={() => setDraftFloors(value => Math.max(0, value - 1))}
            style={styles.stepButton}
          >
            <UIIcon name="minus" size={30} color={theme.ink} />
          </Pressable>
          <Text style={styles.stepValue} numberOfLines={1} adjustsFontSizeToFit accessibilityLiveRegion="polite">
            {draftFloors}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="加一层"
            disabled={busy || draftFloors === 300}
            onPress={() => setDraftFloors(value => Math.min(300, value + 1))}
            style={[styles.stepButton, { backgroundColor: actionPaint.fill }]}
          >
            <UIIcon name="plus" size={30} color={actionPaint.ink} />
          </Pressable>
        </View>
        <Text style={[styles.hint, { textAlign: 'center' }]}>修改后会保留修正记录。</Text>
        <View style={styles.modalRow}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => setEditing(null)}
            style={[styles.secondary, { flex: 1, marginTop: 0, backgroundColor: theme.surfaceSoft, borderColor: theme.line, borderRadius: theme.radius.md }]}
          >
            <Text style={[styles.secondaryText, { color: theme.inkSoft }]}>取消</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={saveEdit}
            style={[styles.primary, { flex: 1, marginTop: 0, backgroundColor: actionPaint.fill }]}
          >
            <Text style={[styles.primaryText, { color: actionPaint.ink }]}>{busy ? '保存中…' : '保存'}</Text>
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

function Metric({
  icon,
  label,
  value,
  unit,
  estimated,
  half,
  divider,
  nextRow,
  styles,
  color,
  inverted = false,
  heroInk,
  heroMuted,
  heroLine,
}: MetricData & {
  half: boolean
  divider: boolean
  nextRow: boolean
  styles: ReturnType<typeof makeStyles>
  color: string
  inverted?: boolean
  heroInk?: string
  heroMuted?: string
  heroLine?: string
}) {
  return (
    <View
      style={[
        styles.metric,
        half && styles.metricHalf,
        divider && styles.metricDivider,
        nextRow && styles.metricNextRow,
        inverted && divider && heroLine ? { borderLeftColor: heroLine } : null,
        inverted && nextRow && heroLine ? { borderTopColor: heroLine } : null,
      ]}
      accessible
      accessibilityLabel={`${label} ${value}${unit ?? ''}${estimated ? '，估算' : ''}`}
    >
      <View style={styles.metricHeading}>
        <UIIcon name={icon} size={17} color={color} />
        <Text style={[styles.metricLabel, inverted && heroMuted ? { color: heroMuted } : null]}>{label}</Text>
      </View>
      <View style={styles.metricReading}>
        <Text style={[styles.metricValue, inverted && heroInk ? { color: heroInk } : null]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        {unit ? <Text style={[styles.metricUnit, inverted && heroMuted ? { color: heroMuted } : null]}>{unit}</Text> : null}
      </View>
      {estimated ? <Text style={[styles.metricUnit, inverted && heroMuted ? { color: heroMuted } : null]}>估算</Text> : null}
    </View>
  )
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    content: { paddingHorizontal: theme.pagePaddingH, paddingTop: 16 },
    metaHead: { gap: 8 },
    date: { ...typography.secondary, color: theme.mutedStrong },
    savedInline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    savedTitle: { ...typography.secondary, color: theme.inkSoft, fontWeight: '600' },
    achievementGlass: { alignItems: 'center', marginTop: 14, gap: 4 },
    flightReplay: { alignSelf: 'center', minHeight: 48, borderRadius: theme.radius.pill },
    flightReplayContent: { minHeight: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 6 },
    flightReplayText: { ...typography.label, color: theme.brandText },
    hero: { marginTop: 16, padding: 18, borderRadius: sport.radius.panel },
    roundCard: { marginTop: 18, padding: 16, borderRadius: sport.radius.panel },
    roundCardHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      flexWrap: 'wrap',
    },
    heroLabel: { ...typography.label, color: theme.mutedStrong },
    heroReading: { fontSize: 80, lineHeight: 90, includeFontPadding: false, marginTop: 4 },
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
    hint: { ...typography.caption, color: theme.mutedStrong },
    notes: { backgroundColor: theme.amberSoft, borderRadius: theme.radius.md, padding: 12, gap: 6, marginTop: 14 },
    noteRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
    noteText: { ...typography.secondary, flex: 1, color: theme.amberInk },
    card: { borderRadius: theme.radius.md, padding: 16, marginTop: 18, gap: 12 },
    cardHead: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    cardTitle: { ...typography.cardTitle, color: theme.ink },
    muted: { ...typography.secondary, color: theme.mutedStrong },
    inputField: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 48,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.line,
      backgroundColor: theme.cardSoft,
    },
    input: { flex: 1, minHeight: 48, paddingHorizontal: 14, color: theme.ink, fontSize: 19 },
    clearButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    primary: { minHeight: 54, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
    primaryText: { ...typography.control, color: theme.onBrand },
    secondary: {
      minHeight: 52,
      borderRadius: theme.radius.md,
      borderWidth: 1.5,
      borderColor: theme.brandText,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryText: { ...typography.control, color: theme.brandInk },
    shareButtonContent: {
      minHeight: 54,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 16,
    },
    savedCard: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 12,
      padding: 14,
      borderRadius: theme.radius.md,
      gap: 10,
    },
    savedText: { flex: 1, color: theme.ink, fontSize: 14, fontWeight: '600' },
    legacy: { color: theme.muted, fontSize: 12, textAlign: 'center', marginTop: 16 },
    stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginVertical: 8 },
    stepButton: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.surfaceSoft, alignItems: 'center', justifyContent: 'center' },
    stepValue: { ...typography.digits, color: theme.ink, fontSize: 84, lineHeight: 92, minWidth: 90, flexShrink: 1, textAlign: 'center' },
    modalRow: { flexDirection: 'row', gap: 12 },
  })
}
