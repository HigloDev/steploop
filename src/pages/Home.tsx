// 训练首页：本周向上、选楼开练、最近一次。沿用 fusion-v1 训练与恢复逻辑。

import React, { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MaterialCommunityIcons } from '@expo/vector-icons'

import { BrandMark } from '../components/brand-mark'
import { BuildingThumb } from '../components/BuildingThumb'
import { AscentReferences } from '../components/ascent-references'
import { SectionHeading, SportButton, StatPair } from '../components/sport-ui'
import { WeekBars } from '../components/training-visuals'
import { FlowSheet } from '../components/flow-sheet'
import { waitForFusionCleanup } from '../hooks/useFusionWorkout'
import { BuildingTemplate, floorCount, templateTotalAscentM } from '../core/building-template'
import { normalizeFloorNumber, shiftFloorNumber } from '../core/floors'
import { describeAscent } from '../core/landmarks'
import { buildWeeklyAchievement, type WeeklyAchievement } from '../core/weekly-achievement'
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
import { sport, Theme, useTheme } from '../theme'

type WeekStats = WeeklyAchievement

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
  const [week, setWeek] = useState<WeekStats>(() => computeWeek([]))
  const [latest, setLatest] = useState<ClimbWorkout | null>(null)
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null)
  const [buildingPicker, setBuildingPicker] = useState(false)
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
      // A render retry can remount Home before the old workout finishes saving.
      await waitForFusionCleanup()
      const [items, workouts, cp, legacy] = await Promise.all([
        listBuildings(), listWorkouts(), loadFusionCheckpoint(), loadActiveCheckpoint(),
      ])
      setBuildings(items)
      setWeek(computeWeek(workouts))
      setLatest([...workouts].sort((a, b) => b.startedAt - a.startedAt)[0] ?? null)
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

  const selected = selectedBuildingId === 'new' ? undefined : buildings.find(building => building.id === selectedBuildingId) ?? buildings[0]
  const latestSummary = latest ? calculateWorkoutSummary(latest.rounds, latest.startedAt, latest.endedAt) : null

  return (
    <View style={styles.page}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: 32 }]}>
        <View style={styles.brandRow}>
          <BrandMark size={28} color={theme.brand} />
          <Text style={styles.brand}>循阶</Text>
          <Text style={styles.wordmark}>STEPLOOP</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="打开训练设置" onPress={() => navigation.navigate('Profile')} style={styles.settingsButton}>
            <MaterialCommunityIcons name="tune-variant" size={23} color={theme.inkSoft} accessible={false} />
          </Pressable>
        </View>

        <Text accessibilityRole="header" style={styles.greeting}>每一步，都算数。</Text>
        <Text style={styles.greetingSub}>{week.workouts ? `这周已经出发 ${week.workouts} 次，继续自己的节奏。` : '从熟悉的楼梯，开始今天的向上。'}</Text>

        {checkpoint && !loading && !loadError ? (
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
        {legacyCheckpoint && !loading && !loadError ? (
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

        <View style={styles.weekCard}>
          <View style={styles.weekTop}>
            <Text style={styles.weekLabel}>本周向上 <Text style={styles.weekEnglish}> / THIS WEEK</Text></Text>
            <Pressable accessibilityRole="button" accessibilityLabel="分享本周成果" disabled={loading || !!loadError}
              onPress={() => navigation.navigate('WeeklyShare')} style={styles.heroIcon}>
              <MaterialCommunityIcons name="export-variant" size={19} color={theme.heroMuted} accessible={false} />
            </Pressable>
          </View>
          <View style={styles.weekMain}>
            <Pressable style={{ flex: 1, minWidth: 0 }} accessibilityRole="button" accessibilityLabel={`本周累计爬升 ${week.ascentM.toFixed(1)} 米，${week.floors} 层，查看高度完成情况`}
              disabled={loading || !!loadError} onPress={() => setReferencesOpen(true)}>
              <View style={styles.weekRow}>
                <Text style={styles.weekValue} numberOfLines={1} adjustsFontSizeToFit>{loading ? '—' : loadError ? '—' : Math.round(week.ascentM)}</Text>
                <Text style={styles.weekUnit}>米</Text>
                <MaterialCommunityIcons name="arrow-top-right" size={22} color={theme.heroAccent} accessible={false} />
              </View>
              <Text style={styles.weekLandmark}>{loading ? '正在读取训练记录' : loadError ? '训练记录暂未读到' : week.ascentM > 0 ? describeAscent(week.ascentM) : '每一层，都是新的积累'}</Text>
            </Pressable>
            <View style={styles.weekChart}><WeekBars days={week.days} inverted /></View>
          </View>
          <View style={styles.weekFooter}>
            <Text style={styles.weekFooterText}>{loading || loadError ? '— 层爬升 / — 次训练' : `${week.floors} 层爬升 / ${week.workouts} 次训练`}</Text>
            <Text style={styles.weekFooterText}>{new Date(week.weekStart).getMonth() + 1}.{new Date(week.weekStart).getDate()} — {new Date(week.weekEnd).getMonth() + 1}.{new Date(week.weekEnd).getDate()}</Text>
          </View>
        </View>

        <SectionHeading title="今天，继续向上" action="我的楼栋" onPress={() => setBuildingPicker(true)} />
        {loading ? <View style={styles.loadState}><ActivityIndicator color={theme.brand} /><Text style={styles.empty}>正在读取本机记录…</Text>
          <SportButton title="开始爬楼" disabled accessibilityLabel={`开始爬楼，从 ${startFloor} 楼出发，第一轮标定`} onPress={startNew} />
        </View>
        : loadError ? <View style={styles.loadState}><Text selectable style={{ color: theme.redInk }}>{loadError}</Text>
          <Pressable accessibilityRole="button" onPress={() => void reload()} style={styles.modalSecondary}><Text style={styles.modalSecondaryText}>重新读取</Text></Pressable>
          <SportButton title="开始爬楼" disabled accessibilityLabel={`开始爬楼，从 ${startFloor} 楼出发，第一轮标定`} onPress={startNew} />
        </View> : <View style={styles.trainingCard}>
          <Pressable accessibilityRole="button" accessibilityLabel={selected ? `选择楼栋，当前 ${selected.name}` : '选择楼栋，当前新楼栋'}
            onPress={() => setBuildingPicker(true)} onLongPress={selected ? () => manage(selected) : undefined} style={styles.selectedBuilding}>
            <View style={styles.buildingIcon}><MaterialCommunityIcons name={selected ? 'office-building-outline' : 'stairs-up'} size={27} color={theme.brandInk} accessible={false} /></View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.buildingName} numberOfLines={2}>{selected?.name ?? '在新楼栋开始'}</Text>
              <Text style={styles.buildingMeta}>{selected ? `${selected.startFloor} → ${floorAfterLabel(selected)} 楼 · 单趟 ${Math.round(templateTotalAscentM(selected))} 米` : '首次逐层轻点，记住这段楼梯'}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-down" size={21} color={theme.muted} accessible={false} />
          </Pressable>
          {!selected ? <Pressable accessibilityRole="button" accessibilityLabel={`起始楼层 ${startFloor} 楼，点按修改`} onPress={() => setFloorPicker(true)} style={styles.floorChip}>
            <Text style={styles.floorChipText}>从 {startFloor} 楼出发</Text><MaterialCommunityIcons name="pencil-outline" size={15} color={theme.brandInk} accessible={false} />
          </Pressable> : null}
          <SportButton title="开始爬楼" icon="play" disabled={busy} accessibilityLabel={selected ? `开始爬楼，使用 ${selected.name}，自动计层` : `开始爬楼，从 ${startFloor} 楼出发，第一轮标定`}
            onPress={selected ? () => startWithTemplate(selected) : startNew} />
          {!selected || selected.needsCalibration ? <Text style={styles.startHint}>{selected ? '旧楼栋可重新标定，让下一次记录更准确' : '第一轮每到一层点一下，到顶后可以保存楼栋'}</Text> : null}
        </View>}

        <SectionHeading title="最近一次" action="全部记录" onPress={() => navigation.navigate('History')} />
        {latest && latestSummary ? <Pressable accessibilityRole="button" accessibilityLabel={`查看最近训练 ${latest.routeSnapshot.name}`}
          onPress={() => navigation.navigate('WorkoutResult', { id: latest.id })} style={({ pressed }) => [styles.latest, pressed && { opacity: sport.opacity.pressed }]}>
          <View style={styles.latestHead}><Text style={styles.latestName} numberOfLines={2}>{latest.routeSnapshot.locationName || latest.routeSnapshot.name}</Text>
            <Text style={styles.latestDate}>{new Date(latest.startedAt).getMonth() + 1}.{String(new Date(latest.startedAt).getDate()).padStart(2, '0')}</Text></View>
          <View style={styles.latestStats}><StatPair label="爬升" value={String(Math.round(latestSummary.totalAscentM))} unit="米" />
            <StatPair label="楼层" value={String(latestSummary.totalFloors)} unit="层" /><StatPair label="用时" value={formatDuration(latestSummary.totalElapsedMs)} />
            <MaterialCommunityIcons name="arrow-top-right" size={21} color={theme.brandInk} accessible={false} /></View>
        </Pressable> : <View style={styles.firstRun}><MaterialCommunityIcons name="flag-outline" size={22} color={theme.brandInk} accessible={false} /><Text style={styles.empty}>{loading ? '正在读取最近训练…' : '第一段向上的记录，就从今天开始。'}</Text></View>}
      </ScrollView>

      <AscentReferences visible={referencesOpen} onClose={() => setReferencesOpen(false)} ascentM={week.ascentM} floors={week.floors} />

      <FlowSheet visible={buildingPicker} title="选择今天的楼栋" onClose={() => setBuildingPicker(false)}>
        {buildings.map(building => <View key={building.id} style={styles.pickerRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={`选择 ${building.name}`} accessibilityState={{ selected: selected?.id === building.id }}
            onPress={() => { setSelectedBuildingId(building.id); setBuildingPicker(false) }} style={styles.pickerSelect}>
            <BuildingThumb floors={floorCount(building)} size={32} />
            <View style={{ flex: 1 }}><Text style={styles.buildingName} numberOfLines={2}>{building.name}</Text><Text style={styles.buildingMeta}>{floorCount(building)} 层 · {Math.round(templateTotalAscentM(building))} 米</Text></View>
            {selected?.id === building.id ? <MaterialCommunityIcons name="check-circle" size={23} color={theme.brand} accessible={false} /> : null}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`管理 ${building.name}`} onPress={() => { setBuildingPicker(false); manage(building) }} style={styles.more}><MaterialCommunityIcons name="dots-horizontal" size={23} color={theme.muted} /></Pressable>
        </View>)}
        <SportButton title="在新楼栋开始" secondary icon="plus" onPress={() => { setSelectedBuildingId('new'); setBuildingPicker(false); setFloorPicker(true) }} />
      </FlowSheet>

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

function floorAfterLabel(building: BuildingTemplate): number {
  return building.floors.at(-1)?.floorTo ?? building.startFloor
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    content: { paddingHorizontal: theme.pagePaddingH },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    brand: { color: theme.ink, fontSize: 22, fontWeight: '700' },
    wordmark: { color: theme.muted, fontSize: 10, letterSpacing: 1.4, fontWeight: '600', flex: 1, paddingLeft: 4 },
    settingsButton: { minWidth: 48, minHeight: 48, alignItems: 'flex-end', justifyContent: 'center' },
    greeting: { color: theme.ink, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
    greetingSub: { color: theme.muted, fontSize: sport.type.secondary, lineHeight: 21, marginTop: 8, marginBottom: 16 },
    weekEnglish: { fontSize: sport.type.micro, color: theme.heroMuted, letterSpacing: 0.8, fontWeight: '400' },
    heroIcon: { width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
    weekMain: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 0, paddingBottom: 12 },
    weekChart: { width: '42%', maxWidth: 150, paddingTop: 16 },
    weekFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.heroLine, paddingTop: 10 },
    weekFooterText: { color: theme.heroMuted, fontSize: sport.type.caption },
    trainingCard: { backgroundColor: theme.card, borderRadius: sport.radius.panel, padding: 16, gap: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.line },
    selectedBuilding: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54 },
    buildingIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: theme.brandSoft, alignItems: 'center', justifyContent: 'center' },
    startHint: { color: theme.muted, fontSize: sport.type.caption, lineHeight: 18, textAlign: 'center' },
    latest: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, paddingTop: 12, paddingBottom: 8, gap: 8 },
    latestHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
    latestName: { flex: 1, color: theme.ink, fontSize: sport.type.body, fontWeight: '600' },
    latestDate: { color: theme.muted, fontSize: sport.type.caption, fontVariant: ['tabular-nums'] },
    latestStats: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    firstRun: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    pickerRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.lineSoft },
    pickerSelect: { flex: 1, minHeight: 76, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
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
    floorChip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 12, backgroundColor: theme.brandSoft, borderRadius: 8 },
    floorChipText: { color: theme.brandInk, fontSize: 13, fontWeight: '500' },
    weekCard: {
      backgroundColor: theme.heroSurface, borderRadius: theme.radiusXl,
      paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
    weekTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    weekLabel: { color: theme.heroInk, fontSize: 13, fontWeight: '600' },
    weekRow: { flexDirection: 'row', alignItems: 'baseline', columnGap: 6, marginTop: 2 },
    weekMetric: { flexDirection: 'row', alignItems: 'flex-end', maxWidth: '100%' },
    weekValue: { ...theme.numeric, color: theme.heroInk, fontSize: 56, lineHeight: 64, letterSpacing: -2, flexShrink: 1 },
    weekValueSmall: { fontSize: 40, lineHeight: 48 },
    weekUnit: { color: theme.heroMuted, fontSize: 15, fontWeight: '400' },
    weekLandmark: { color: theme.heroAccent, fontSize: 12, lineHeight: 18, marginTop: 4 },
    referencesButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48, alignSelf: 'flex-start' },
    referencesText: { color: theme.brand, fontSize: 13, fontWeight: '700' },
    streak: { alignItems: 'center', paddingLeft: 18, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.line },
    streakValue: { ...theme.numeric, color: theme.ink, fontSize: 30 },
    streakLabel: { color: theme.muted, fontSize: 12, fontWeight: '700' },
    section: { color: theme.ink, fontSize: 22, fontWeight: '900', marginTop: 26, marginBottom: 14,},
    empty: { flexShrink: 1, color: theme.muted, fontSize: 13, lineHeight: 21 },
    loadState: { gap: 12, paddingVertical: 16 },
    building: {
      flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.card, borderRadius: theme.radiusLg,
      padding: 16, marginBottom: 10, ...theme.shadowSoft,
     minHeight: 84,},
    buildingName: { color: theme.ink, fontSize: 16, fontWeight: '600' },
    buildingMeta: { color: theme.muted, fontSize: 12, lineHeight: 19, marginTop: 4 },
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
