// 首页（fusion-v1）：一个大按钮“开始爬楼”。
// 去陌生楼直接开始——第一轮是标定轮；已保存的楼栋模板点一下即用（跳过标定，第一轮就自动计层）。
// 下方是本周累计爬升（米 / 层 / 地标换算）与连续训练天数。

import React, { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MaterialCommunityIcons } from '@expo/vector-icons'

import { BrandMark } from '../components/brand-mark'
import { BuildingThumb } from '../components/BuildingThumb'
import { AscentReferences } from '../components/ascent-references'
import { FlowSheet } from '../components/flow-sheet'
import { BuildingTemplate, floorCount, templateTotalAscentM } from '../core/building-template'
import { getRoundAchievementCount, normalizeFloorNumber, shiftFloorNumber } from '../core/floors'
import { describeAscent } from '../core/landmarks'
import { buildWeeklyAchievement } from '../core/weekly-achievement'
import { triggerHaptic } from '../services/preferences'
import { formatDuration, uid } from '../core/math'
import type { ActiveWorkoutCheckpoint, ClimbWorkout } from '../core/types'
import { calculateWorkoutSummary } from '../core/workout-summary'
import type { ClimbWorkoutParams, MainTabScreen } from '../navigation/types'
import {
  deleteBuilding,
  FusionCheckpoint,
  listBuildings,
  loadFusionCheckpoint,
  renameBuilding,
  saveFusionCheckpoint,
} from '../services/building-storage'
import {
  clearActiveCheckpoint,
  listWorkouts,
  loadActiveCheckpoint,
  saveWorkout,
} from '../services/workout-storage'
import { Theme, useTheme } from '../theme'

interface WeekStats { ascentM: number; floors: number; workouts: number; streak: number }

function computeWeek(workouts: ClimbWorkout[]): WeekStats {
  return buildWeeklyAchievement(workouts)
}

/** 旧版训练（motion-v3 流程）留下的未结束检查点：把已完成轮次结算保存，不丢成绩。 */
async function saveLegacyCheckpoint(checkpoint: ActiveWorkoutCheckpoint): Promise<void> {
  const rounds = checkpoint.completedRounds ?? []
  const endedAt = checkpoint.savedAt || Date.now()
  const summary = calculateWorkoutSummary(rounds, checkpoint.startedAt, endedAt)
  const workout: ClimbWorkout = {
    id: checkpoint.workoutId || uid('workout'),
    recognitionVersion: 'motion-v3',
    templateId: checkpoint.templateId,
    templateVersion: 1,
    trackingMode: checkpoint.trackingMode,
    floorCounting: checkpoint.floorCounting,
    bodyWeightKg: checkpoint.bodyWeightKg,
    routeSnapshot: { name: '旧版训练', locationName: '旧版训练', startFloor: rounds[0]?.startFloor ?? 1,
      endFloor: rounds[0]?.finalFloor ?? 1, floorsPerRound: 0, ascentPerRoundM: 0 },
    goal: checkpoint.goal ?? { type: 'open' },
    returnConfirmationMode: checkpoint.returnConfirmationMode ?? 'manual',
    status: 'completed', startedAt: checkpoint.startedAt, endedAt, rounds,
    currentRoundNumber: rounds.length, totalRoundsCompleted: summary.completeRounds,
    totalFloorsCompleted: summary.totalFloors, totalAscentM: summary.totalAscentM, totalSteps: summary.totalSteps,
    activeDurationMs: summary.activeDurationMs, returnDurationMs: summary.returnDurationMs,
    recoveryDurationMs: summary.recoveryDurationMs, totalElapsedMs: summary.totalElapsedMs,
    createdAt: checkpoint.startedAt, updatedAt: endedAt,
  }
  if (rounds.length) await saveWorkout(workout)
  await clearActiveCheckpoint()
}

export default function HomeScreen({ navigation }: MainTabScreen<'Train'>) {
  const theme = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const insets = useSafeAreaInsets()
  const [buildings, setBuildings] = useState<BuildingTemplate[]>([])
  const [week, setWeek] = useState<WeekStats>({ ascentM: 0, floors: 0, workouts: 0, streak: 0 })
  const [checkpoint, setCheckpoint] = useState<FusionCheckpoint | null>(null)
  const [legacyCheckpoint, setLegacyCheckpoint] = useState<ActiveWorkoutCheckpoint | null>(null)
  const [startFloor, setStartFloor] = useState(1)
  const [floorPicker, setFloorPicker] = useState(false)
  const [referencesOpen, setReferencesOpen] = useState(false)
  const [renaming, setRenaming] = useState<BuildingTemplate | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [managing, setManaging] = useState<BuildingTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [items, workouts, cp, legacy] = await Promise.all([
        listBuildings(), listWorkouts(), loadFusionCheckpoint(), loadActiveCheckpoint(),
      ])
      setBuildings(items)
      setWeek(computeWeek(workouts))
      setCheckpoint(cp)
      setLegacyCheckpoint(legacy && Array.isArray(legacy.completedRounds) ? legacy : null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '暂时无法读取本机记录，请重试。')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { void reload() }, [reload]))

  const enterWorkout = (params: ClimbWorkoutParams) => {
    if (loading || loadError || busy) return
    if (checkpoint) {
      Alert.alert(checkpoint.endedAt ? '还有成绩等待保存' : '还有一次训练没有结束',
        '请先处理上次训练，已完成的轮次会保留。', [
          { text: '取消', style: 'cancel' },
          { text: checkpoint.endedAt ? '去保存' : '继续上次', onPress: () => navigation.navigate('ClimbWorkout', { resume: true }) },
        ])
      return
    }
    void triggerHaptic('medium')
    navigation.navigate('ClimbWorkout', { ...params, ...(params.startFloor !== undefined ? { startFloor: normalizeFloorNumber(params.startFloor) } : {}) })
  }

  const startNew = () => enterWorkout({ startFloor })

  const startWithTemplate = (building: BuildingTemplate) => {
    if (building.needsCalibration) {
      Alert.alert(building.name, '这是旧版路线，缺少逐层数据。建议重新标定一轮，之后自动计层更准。', [
        { text: '取消', style: 'cancel' },
        { text: '直接使用', onPress: () => enterWorkout({ templateId: building.id }) },
        { text: '重新标定', onPress: () => enterWorkout({ startFloor: building.startFloor, recalibrateTemplateId: building.id }) },
      ])
      return
    }
    enterWorkout({ templateId: building.id })
  }

  const manage = (building: BuildingTemplate) => {
    setActionError('')
    setManaging(building)
  }

  const removeBuilding = (building: BuildingTemplate) => {
    setManaging(null)
    Alert.alert('删除楼栋模板？', '历史成绩会保留。下次在这栋楼训练时，可重新标定。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        setBusy(true)
        try { await deleteBuilding(building.id); await reload() }
        catch (e) { Alert.alert('删除失败', e instanceof Error ? e.message : String(e)) }
        finally { setBusy(false) }
      } },
    ])
  }

  const confirmRename = async () => {
    if (!renaming || busy) return
    if (!nameDraft.trim()) { setActionError('请输入楼栋名称。'); return }
    setBusy(true)
    setActionError('')
    try {
      await renameBuilding(renaming.id, nameDraft)
      setRenaming(null)
      await reload()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  const discardCheckpoint = async () => {
    setBusy(true)
    try { await saveFusionCheckpoint(null); await reload() }
    catch (e) { Alert.alert('未能放弃训练', e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  const shiftFloor = (delta: -1 | 1) => {
    void triggerHaptic('selection')
    setStartFloor(value => Math.max(-5, Math.min(60, shiftFloorNumber(value, delta))))
  }

  return (
    <View style={styles.page}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingTop: insets.top + 30, paddingBottom: 32 }]}>
        <View style={styles.brandRow}>
          <BrandMark size={36} color={theme.brand} />
          <Text style={styles.brand}>循阶</Text>
        </View>

        {checkpoint ? (
          <View style={styles.resume}>
            <View style={{ flex: 1 }}>
              <Text style={styles.resumeTitle}>{checkpoint.endedAt ? '有成绩等待保存' : '有一次训练没有结束'}</Text>
              <Text style={styles.resumeText}>已完成 {checkpoint.rounds.length} 轮 · {formatDuration((checkpoint.endedAt ?? checkpoint.savedAt) - checkpoint.startedAt)}</Text>
            </View>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => navigation.navigate('ClimbWorkout', { resume: true })} style={styles.resumeButton}>
              <Text style={styles.resumeButtonText}>{checkpoint.endedAt ? '保存' : '继续'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} accessibilityLabel="放弃未结束的训练" style={{ minHeight: 48, justifyContent: 'center' }} hitSlop={8}
              onPress={() => Alert.alert('放弃这次训练？', '未保存的轮次会丢失。', [
                { text: '取消', style: 'cancel' },
                { text: '放弃', style: 'destructive', onPress: () => void discardCheckpoint() },
              ])}>
              <MaterialCommunityIcons name="close" size={22} color={theme.muted} />
            </Pressable>
          </View>
        ) : null}
        {legacyCheckpoint ? (
          <View style={styles.resume}>
            <View style={{ flex: 1 }}>
              <Text style={styles.resumeTitle}>旧版训练没有结束</Text>
              <Text style={styles.resumeText}>已完成 {legacyCheckpoint.completedRounds.length} 轮，可以保存成绩</Text>
            </View>
            <Pressable accessibilityRole="button" disabled={busy} onPress={async () => {
              setBusy(true)
              try { await saveLegacyCheckpoint(legacyCheckpoint); await reload() }
              catch (e) { Alert.alert('保存失败', e instanceof Error ? e.message : String(e)) }
              finally { setBusy(false) }
            }} style={styles.resumeButton}>
              <Text style={styles.resumeButtonText}>保存</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`开始爬楼，从 ${startFloor} 楼出发，第一轮标定`}
          disabled={loading || !!loadError || busy}
          accessibilityState={{ disabled: loading || !!loadError || busy }}
          onPress={startNew}
          style={({ pressed }) => [styles.start, pressed && styles.startPressed]}
        >
          <MaterialCommunityIcons name="stairs-up" size={56} color={theme.onBrand} />
          <Text style={styles.startText} numberOfLines={1} adjustsFontSizeToFit>开始爬楼</Text>
          <Text style={styles.startSub}>新楼栋 · 第一轮每到一层点一下</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`起始楼层 ${startFloor} 楼，点按修改`} onPress={() => { void triggerHaptic('light'); setFloorPicker(true) }} style={styles.floorChip}>
          <Text style={styles.floorChipText}>从 {startFloor} 楼出发</Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color={theme.mutedStrong} />
        </Pressable>

        <View style={styles.weekCard}>
          <Pressable style={styles.weekTop} accessibilityRole="button" accessibilityLabel={`本周累计爬升 ${week.ascentM.toFixed(1)} 米，${week.floors} 层，查看高度完成情况`}
            accessibilityHint="查看已达到的高度参照与下一站进度" disabled={loading || !!loadError}
            onPress={() => { void triggerHaptic('light'); setReferencesOpen(true) }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Text style={styles.weekLabel}>本周累计</Text><MaterialCommunityIcons name="chevron-right" size={20} color={theme.mutedStrong} accessible={false} /></View>
            <View style={styles.weekRow}>
              <View style={styles.weekMetric}><Text style={styles.weekValue} numberOfLines={1} adjustsFontSizeToFit>{Math.round(week.ascentM)}</Text><Text style={styles.weekUnit}>米</Text></View>
              <View style={styles.weekMetric}><Text style={[styles.weekValue, styles.weekValueSmall]} numberOfLines={1} adjustsFontSizeToFit>{week.floors}</Text><Text style={styles.weekUnit}>层</Text></View>
            </View>
            <Text style={styles.weekLandmark}>{describeAscent(week.ascentM)}</Text>
          </View>
          <View style={styles.streak}>
            <MaterialCommunityIcons name="fire" size={24} color={theme.brand} />
            <Text style={styles.streakValue}>{week.streak}</Text>
            <Text style={styles.streakLabel}>连续天数</Text>
          </View>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="分享本周成果" disabled={loading || !!loadError}
            onPress={() => { void triggerHaptic('light'); navigation.navigate('WeeklyShare') }} style={styles.referencesButton}>
            <MaterialCommunityIcons name="share-variant-outline" size={18} color={theme.brandInk} accessible={false} />
            <Text style={[styles.referencesText, { color: theme.brandInk }]}>分享本周成果</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={theme.brand} accessible={false} />
          </Pressable>
        </View>

        <Text style={styles.section}>我的楼栋</Text>
        {loading ? <View style={styles.loadState}><ActivityIndicator color={theme.brand} /><Text style={styles.empty}>正在读取本机记录…</Text></View>
        : loadError ? <View style={styles.loadState}><Text selectable style={{ color: theme.redInk }}>{loadError}</Text>
          <Pressable accessibilityRole="button" onPress={() => void reload()} style={styles.modalSecondary}><Text style={styles.modalSecondaryText}>重新读取</Text></Pressable>
        </View> : buildings.length === 0 ? (
          <Text style={styles.empty}>还没有楼栋模板。完成一次“开始爬楼”的标定轮，就能保存下来，下次直接自动计层。</Text>
        ) : (
          buildings.map(building => (
            <Pressable
              key={building.id}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`${building.name}，${floorCount(building)} 层，点按开始，长按管理`}
              onPress={() => startWithTemplate(building)}
              onLongPress={() => manage(building)}
              style={({ pressed }) => [styles.building, pressed && { opacity: 0.85 }]}
            >
              <BuildingThumb floors={floorCount(building)} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={styles.buildingName} numberOfLines={2}>{building.name}</Text>
                <Text style={styles.buildingMeta}>
                  {building.startFloor}楼起 · {floorCount(building)} 层 · {Math.round(templateTotalAscentM(building))} 米
                  {building.legacyRouteId ? ' · 旧路线' : ''}{!building.barometer ? ' · 无气压' : ''}
                </Text>
                {building.lastResult ? (
                  <Text style={styles.buildingLast}>上次 {building.lastResult.rounds} 轮 · {building.lastResult.floors} 层{building.lastResult.bestRoundMs ? ` · 最快 ${formatDuration(building.lastResult.bestRoundMs)}` : ''}</Text>
                ) : null}
              </View>
              <Pressable accessibilityRole="button" disabled={busy} accessibilityLabel={`管理 ${building.name}`} hitSlop={4} onPress={() => manage(building)} style={styles.more}>
                <MaterialCommunityIcons name="dots-horizontal" size={22} color={theme.muted} />
              </Pressable>
              <View style={styles.go}><MaterialCommunityIcons name="play" size={20} color={theme.onBrand} /></View>
            </Pressable>
          ))
        )}
      </ScrollView>

      <AscentReferences visible={referencesOpen} onClose={() => setReferencesOpen(false)} ascentM={week.ascentM} floors={week.floors} />

      <FlowSheet visible={floorPicker} title="从几楼出发？" onClose={() => setFloorPicker(false)}>
            <Text style={styles.modalHint}>楼层编号没有 0 楼，地下室选负数。</Text>
            <View style={styles.stepper}>
              <Pressable accessibilityRole="button" accessibilityLabel="降低起始楼层" disabled={startFloor <= -5} onPress={() => shiftFloor(-1)} style={styles.stepButton}><MaterialCommunityIcons name="minus" size={32} color={theme.ink} /></Pressable>
              <Text style={styles.stepValue} numberOfLines={1} adjustsFontSizeToFit accessibilityLiveRegion="polite">{startFloor}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="提高起始楼层" disabled={startFloor >= 60} onPress={() => shiftFloor(1)} style={[styles.stepButton, { backgroundColor: theme.brand }]}><MaterialCommunityIcons name="plus" size={32} color={theme.onBrand} /></Pressable>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setFloorPicker(false)} style={styles.modalPrimary}><Text style={styles.modalPrimaryText}>好</Text></Pressable>
      </FlowSheet>

      <FlowSheet visible={!!managing || !!renaming} title={renaming ? '重命名楼栋' : managing?.name ?? '管理楼栋'} busy={busy}
        onClose={() => { if (!busy) { setManaging(null); setRenaming(null) } }}>
        {renaming ? <>
            <Text style={styles.modalHint}>楼栋名称</Text><TextInput value={nameDraft} onChangeText={value => { setNameDraft(value); setActionError('') }} maxLength={24} autoFocus style={styles.input}
              editable={!busy} returnKeyType="done" onSubmitEditing={() => void confirmRename()}
              placeholder="楼栋名称" placeholderTextColor={theme.muted} accessibilityLabel="楼栋名称" />
            <Text style={styles.modalHint}>给常用楼栋起一个好记的名字 · {nameDraft.length}/24</Text>
            {actionError ? <Text accessibilityRole="alert" selectable style={{ color: theme.redInk }}>{actionError}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => setRenaming(null)} style={[styles.modalSecondary, { flex: 1, backgroundColor: theme.surfaceSoft }]}><Text style={styles.modalSecondaryText}>取消</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void confirmRename()} style={[styles.modalPrimary, { flex: 1 }]}><Text style={styles.modalPrimaryText}>{busy ? '保存中…' : '保存'}</Text></Pressable>
            </View>
        </> : managing ? <>
          <Text style={styles.modalHint}>从 {managing.startFloor} 楼出发 · {floorCount(managing)} 层 · 约 {Math.round(templateTotalAscentM(managing))} 米</Text>
          <View style={{ backgroundColor: theme.surfaceSoft, borderRadius: 16, overflow: 'hidden' }}>
          <Pressable accessibilityRole="button" onPress={() => { setNameDraft(managing.name); setRenaming(managing); setManaging(null) }} style={styles.manageRow}><MaterialCommunityIcons name="pencil-outline" size={22} color={theme.ink} /><Text style={[styles.modalSecondaryText, { flex: 1 }]}>重命名</Text><MaterialCommunityIcons name="chevron-right" size={24} color={theme.muted} /></Pressable>
          <Pressable accessibilityRole="button" onPress={() => {
            const building = managing; setManaging(null)
            enterWorkout({ startFloor: building.startFloor, recalibrateTemplateId: building.id })
          }} style={styles.manageRow}><MaterialCommunityIcons name="target" size={22} color={theme.ink} /><Text style={[styles.modalSecondaryText, { flex: 1 }]}>重新标定</Text><MaterialCommunityIcons name="chevron-right" size={24} color={theme.muted} /></Pressable>
          <Pressable accessibilityRole="button" onPress={() => removeBuilding(managing)} style={styles.manageRow}><MaterialCommunityIcons name="trash-can-outline" size={22} color={theme.redInk} /><Text style={{ color: theme.redInk, fontSize: 16, fontWeight: '700', flex: 1 }}>删除楼栋模板</Text><MaterialCommunityIcons name="chevron-right" size={24} color={theme.muted} /></Pressable>
          </View>
          <Pressable accessibilityRole="button" onPress={() => setManaging(null)} style={styles.modalSecondary}><Text style={styles.modalSecondaryText}>完成</Text></Pressable>
        </> : null}
      </FlowSheet>
    </View>
  )
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    content: { paddingHorizontal: theme.pagePaddingH },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 22,},
    brand: { color: theme.ink, fontSize: 30, fontWeight: '900', letterSpacing: 0,},
    resume: {
      flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.card, borderRadius: theme.radiusLg,
      padding: 14, marginBottom: 14, borderWidth: 1, borderColor: theme.brandTint,
    },
    resumeTitle: { color: theme.ink, fontSize: 15, fontWeight: '800' },
    resumeText: { color: theme.muted, fontSize: 13, marginTop: 2 },
    resumeButton: { minHeight: 48, paddingHorizontal: 16, borderRadius: 20, backgroundColor: theme.brand, justifyContent: 'center' },
    resumeButtonText: { color: theme.onBrand, fontWeight: '900', fontSize: 15 },
    start: {
      minHeight: 206, borderRadius: theme.radiusXl, backgroundColor: theme.brand, alignItems: 'center', justifyContent: 'center',
      gap: 6, padding: 16, ...theme.shadowLifted,
     shadowOpacity: 0, elevation: 0,},
    startPressed: { transform: [{ scale: 0.985 }], opacity: 0.95 },
    startText: { color: theme.onBrand, fontSize: 48, fontWeight: '900', letterSpacing: 1,},
    startSub: { color: theme.onBrand, fontSize: 18, lineHeight: 24, fontWeight: '600', opacity: 1, textAlign: 'center', alignSelf: 'stretch' },
    floorChip: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 14, marginTop: 0,},
    floorChipText: { color: theme.inkSoft, fontSize: 18, fontWeight: '700' },
    weekCard: {
      backgroundColor: theme.card, borderRadius: theme.radiusLg,
      paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4, marginTop: 4, ...theme.shadowCard,
     minHeight: 140,},
    weekTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    weekLabel: { color: theme.inkSoft, fontSize: 16, fontWeight: '800' },
    weekRow: { flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', columnGap: 8, marginTop: 2 },
    weekMetric: { flexDirection: 'row', alignItems: 'flex-end', maxWidth: '100%' },
    weekValue: { ...theme.numeric, color: theme.ink, fontSize: 48, lineHeight: 54, flexShrink: 1 },
    weekValueSmall: { fontSize: 40, lineHeight: 48 },
    weekUnit: { color: theme.inkSoft, fontSize: 15, fontWeight: '800', marginBottom: 6, marginLeft: 3 },
    weekLandmark: { color: theme.brand, fontSize: 16, fontWeight: '700', marginTop: 4 },
    referencesButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48, alignSelf: 'flex-start' },
    referencesText: { color: theme.brand, fontSize: 13, fontWeight: '700' },
    streak: { alignItems: 'center', paddingLeft: 18, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.line },
    streakValue: { ...theme.numeric, color: theme.ink, fontSize: 30 },
    streakLabel: { color: theme.muted, fontSize: 12, fontWeight: '700' },
    section: { color: theme.ink, fontSize: 22, fontWeight: '900', marginTop: 26, marginBottom: 14,},
    empty: { color: theme.muted, fontSize: 14, lineHeight: 21 },
    loadState: { gap: 12, paddingVertical: 16 },
    building: {
      flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.card, borderRadius: theme.radiusLg,
      padding: 16, marginBottom: 10, ...theme.shadowSoft,
     minHeight: 84,},
    buildingName: { color: theme.ink, fontSize: 20, fontWeight: '900' },
    buildingMeta: { color: theme.muted, fontSize: 16, marginTop: 4,},
    buildingLast: { color: theme.brandInk, fontSize: 12, fontWeight: '700', marginTop: 3 },
    more: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    go: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.brand, alignItems: 'center', justifyContent: 'center' },
    manageRow: { minHeight: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
    modalHint: { color: theme.muted, fontSize: 15, lineHeight: 23,},
    stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginVertical: 8 },
    stepButton: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.surfaceSoft, alignItems: 'center', justifyContent: 'center' },
    stepText: { color: theme.brandInk, fontSize: 30, fontWeight: '900' },
    stepValue: { ...theme.numeric, color: theme.ink, fontSize: 88, lineHeight: 96, minWidth: 90, flexShrink: 1, textAlign: 'center' },
    input: {
      minHeight: 60, borderRadius: theme.radiusMd, borderWidth: 1, borderColor: theme.brand, paddingHorizontal: 14,
      color: theme.ink, fontSize: 22, backgroundColor: theme.cardSoft,
    },
    modalPrimary: { minHeight: 54, borderRadius: 18, backgroundColor: theme.brand, alignItems: 'center', justifyContent: 'center' },
    modalPrimaryText: { color: theme.onBrand, fontSize: 16, fontWeight: '900' },
    modalSecondary: { minHeight: 52, borderRadius: 18, borderWidth: 1.5, borderColor: theme.line, alignItems: 'center', justifyContent: 'center' },
    modalSecondaryText: { color: theme.inkSoft, fontSize: 16, fontWeight: '800' },
  })
}
