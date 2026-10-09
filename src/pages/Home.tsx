// 首页（fusion-v1）：一个大按钮“开始爬楼”。
// 去陌生楼直接开始——第一轮是标定轮；已保存的楼栋模板点一下即用（跳过标定，第一轮就自动计层）。
// 下方是本周累计爬升（米 / 层 / 地标换算）与连续训练天数。

import React, { useCallback, useMemo, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MaterialCommunityIcons } from '@expo/vector-icons'

import { BrandMark } from '../components/brand-mark'
import { BuildingThumb } from '../components/BuildingThumb'
import { BuildingTemplate, floorCount, templateTotalAscentM } from '../core/building-template'
import { getRoundAchievementCount, normalizeFloorNumber } from '../core/floors'
import { describeAscent, localDayKey, trainingStreakDays } from '../core/landmarks'
import { formatDuration, uid } from '../core/math'
import { startOfLocalWeek } from '../core/progress-trends'
import type { ActiveWorkoutCheckpoint, ClimbWorkout } from '../core/types'
import { calculateWorkoutSummary } from '../core/workout-summary'
import type { MainTabScreen } from '../navigation/types'
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
  const weekStart = startOfLocalWeek(Date.now())
  const valid = workouts.filter(workout => workout.status !== 'cancelled' && workout.rounds?.length)
  let ascentM = 0
  let floors = 0
  let count = 0
  for (const workout of valid) {
    if (workout.startedAt < weekStart) continue
    count += 1
    for (const round of workout.rounds) {
      floors += getRoundAchievementCount(round)
      if (round.floorConfirmation !== 'pending') ascentM += round.ascentM || 0
    }
  }
  const streak = trainingStreakDays(valid.map(workout => localDayKey(workout.startedAt)))
  return { ascentM: Math.round(ascentM), floors, workouts: count, streak }
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
  const [renaming, setRenaming] = useState<BuildingTemplate | null>(null)
  const [nameDraft, setNameDraft] = useState('')

  const reload = useCallback(async () => {
    const [items, workouts, cp, legacy] = await Promise.all([
      listBuildings().catch(() => []),
      listWorkouts().catch(() => []),
      loadFusionCheckpoint(),
      loadActiveCheckpoint().catch(() => null),
    ])
    setBuildings(items)
    setWeek(computeWeek(workouts))
    setCheckpoint(cp)
    setLegacyCheckpoint(legacy && Array.isArray(legacy.completedRounds) ? legacy : null)
  }, [])

  useFocusEffect(useCallback(() => { void reload() }, [reload]))

  const startNew = () => navigation.navigate('ClimbWorkout', { startFloor })

  const startWithTemplate = (building: BuildingTemplate) => {
    if (building.needsCalibration) {
      Alert.alert(building.name, '这是旧版路线，缺少逐层数据。建议重新标定一轮，之后自动计层更准。', [
        { text: '取消', style: 'cancel' },
        { text: '直接使用', onPress: () => navigation.navigate('ClimbWorkout', { templateId: building.id }) },
        { text: '重新标定', onPress: () => navigation.navigate('ClimbWorkout', { startFloor: building.startFloor, recalibrateTemplateId: building.id }) },
      ])
      return
    }
    navigation.navigate('ClimbWorkout', { templateId: building.id })
  }

  const manage = (building: BuildingTemplate) => {
    Alert.alert(building.name, `${floorCount(building)} 层 · 约 ${Math.round(templateTotalAscentM(building))} 米`, [
      { text: '重命名', onPress: () => { setRenaming(building); setNameDraft(building.name) } },
      { text: '重新标定', onPress: () => navigation.navigate('ClimbWorkout', { startFloor: building.startFloor, recalibrateTemplateId: building.id }) },
      {
        text: '删除', style: 'destructive', onPress: () => Alert.alert('删除楼栋模板？', '历史成绩不会被删除。', [
          { text: '取消', style: 'cancel' },
          { text: '删除', style: 'destructive', onPress: async () => { await deleteBuilding(building.id); void reload() } },
        ]),
      },
      { text: '取消', style: 'cancel' },
    ])
  }

  const confirmRename = async () => {
    if (renaming) await renameBuilding(renaming.id, nameDraft)
    setRenaming(null)
    void reload()
  }

  const shiftFloor = (delta: number) => {
    setStartFloor(value => {
      let next = value + delta
      if (next === 0) next += delta
      return Math.max(-5, Math.min(60, normalizeFloorNumber(next)))
    })
  }

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: 32 }]}>
        <View style={styles.brandRow}>
          <BrandMark size={30} color={theme.brand} />
          <Text style={styles.brand}>循阶</Text>
        </View>

        {checkpoint ? (
          <View style={styles.resume}>
            <View style={{ flex: 1 }}>
              <Text style={styles.resumeTitle}>有一次训练没有结束</Text>
              <Text style={styles.resumeText}>已完成 {checkpoint.rounds.length} 轮 · {formatDuration(checkpoint.savedAt - checkpoint.startedAt)}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate('ClimbWorkout', { resume: true })} style={styles.resumeButton}>
              <Text style={styles.resumeButtonText}>继续</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="放弃未结束的训练" hitSlop={8}
              onPress={() => Alert.alert('放弃这次训练？', '未保存的轮次会丢失。', [
                { text: '取消', style: 'cancel' },
                { text: '放弃', style: 'destructive', onPress: async () => { await saveFusionCheckpoint(null); void reload() } },
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
            <Pressable accessibilityRole="button" onPress={async () => { await saveLegacyCheckpoint(legacyCheckpoint); void reload() }} style={styles.resumeButton}>
              <Text style={styles.resumeButtonText}>保存</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`开始爬楼，从 ${startFloor} 楼出发，第一轮标定`}
          onPress={startNew}
          style={({ pressed }) => [styles.start, pressed && styles.startPressed]}
        >
          <MaterialCommunityIcons name="stairs-up" size={44} color={theme.onBrand} />
          <Text style={styles.startText}>开始爬楼</Text>
          <Text style={styles.startSub}>新楼栋 · 第一轮每到一层点一下</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`起始楼层 ${startFloor} 楼，点按修改`} onPress={() => setFloorPicker(true)} style={styles.floorChip}>
          <Text style={styles.floorChipText}>从 {startFloor} 楼出发</Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color={theme.mutedStrong} />
        </Pressable>

        <View style={styles.weekCard} accessible accessibilityLabel={`本周累计爬升 ${week.ascentM} 米，${week.floors} 层，连续训练 ${week.streak} 天`}>
          <View style={{ flex: 1 }}>
            <Text style={styles.weekLabel}>本周累计</Text>
            <View style={styles.weekRow}>
              <Text style={styles.weekValue}>{week.ascentM}</Text>
              <Text style={styles.weekUnit}>米</Text>
              <Text style={[styles.weekValue, styles.weekValueSmall]}>{week.floors}</Text>
              <Text style={styles.weekUnit}>层</Text>
            </View>
            <Text style={styles.weekLandmark}>{describeAscent(week.ascentM)}</Text>
          </View>
          <View style={styles.streak}>
            <MaterialCommunityIcons name="fire" size={24} color={theme.brand} />
            <Text style={styles.streakValue}>{week.streak}</Text>
            <Text style={styles.streakLabel}>连续天数</Text>
          </View>
        </View>

        <Text style={styles.section}>我的楼栋</Text>
        {buildings.length === 0 ? (
          <Text style={styles.empty}>还没有楼栋模板。完成一次“开始爬楼”的标定轮，就能保存下来，下次直接自动计层。</Text>
        ) : (
          buildings.map(building => (
            <Pressable
              key={building.id}
              accessibilityRole="button"
              accessibilityLabel={`${building.name}，${floorCount(building)} 层，点按开始，长按管理`}
              onPress={() => startWithTemplate(building)}
              onLongPress={() => manage(building)}
              style={({ pressed }) => [styles.building, pressed && { opacity: 0.85 }]}
            >
              <BuildingThumb floors={floorCount(building)} size={56} />
              <View style={{ flex: 1 }}>
                <Text style={styles.buildingName} numberOfLines={1}>{building.name}</Text>
                <Text style={styles.buildingMeta}>
                  {floorCount(building)} 层 · 约 {Math.round(templateTotalAscentM(building))} 米
                  {building.legacyRouteId ? ' · 旧路线' : ''}{!building.barometer ? ' · 无气压' : ''}
                </Text>
                {building.lastResult ? (
                  <Text style={styles.buildingLast}>上次 {building.lastResult.rounds} 轮 · {building.lastResult.floors} 层{building.lastResult.bestRoundMs ? ` · 最快 ${formatDuration(building.lastResult.bestRoundMs)}` : ''}</Text>
                ) : null}
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`管理 ${building.name}`} hitSlop={10} onPress={() => manage(building)} style={styles.more}>
                <MaterialCommunityIcons name="dots-horizontal" size={22} color={theme.muted} />
              </Pressable>
              <View style={styles.go}><MaterialCommunityIcons name="play" size={20} color={theme.onBrand} /></View>
            </Pressable>
          ))
        )}
      </ScrollView>

      <Modal visible={floorPicker} transparent animationType="fade" onRequestClose={() => setFloorPicker(false)}>
        <View style={styles.scrim}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>从几楼出发？</Text>
            <Text style={styles.modalHint}>楼层编号没有 0 楼，地下室选负数。</Text>
            <View style={styles.stepper}>
              <Pressable accessibilityRole="button" accessibilityLabel="下一层" onPress={() => shiftFloor(-1)} style={styles.stepButton}><Text style={styles.stepText}>−</Text></Pressable>
              <Text style={styles.stepValue} accessibilityLiveRegion="polite">{startFloor}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="上一层" onPress={() => shiftFloor(1)} style={styles.stepButton}><Text style={styles.stepText}>＋</Text></Pressable>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setFloorPicker(false)} style={styles.modalPrimary}><Text style={styles.modalPrimaryText}>好</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={!!renaming} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <View style={styles.scrim}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>重命名楼栋</Text>
            <TextInput value={nameDraft} onChangeText={setNameDraft} maxLength={24} autoFocus style={styles.input}
              placeholder="楼栋名称" placeholderTextColor={theme.muted} accessibilityLabel="楼栋名称" />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable accessibilityRole="button" onPress={() => setRenaming(null)} style={[styles.modalSecondary, { flex: 1 }]}><Text style={styles.modalSecondaryText}>取消</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={confirmRename} style={[styles.modalPrimary, { flex: 1 }]}><Text style={styles.modalPrimaryText}>保存</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    content: { paddingHorizontal: theme.pagePaddingH },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
    brand: { color: theme.ink, fontSize: 22, fontWeight: '900', letterSpacing: 2 },
    resume: {
      flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.card, borderRadius: theme.radiusLg,
      padding: 14, marginBottom: 14, borderWidth: 1, borderColor: theme.brandTint,
    },
    resumeTitle: { color: theme.ink, fontSize: 15, fontWeight: '800' },
    resumeText: { color: theme.muted, fontSize: 13, marginTop: 2 },
    resumeButton: { minHeight: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: theme.brand, justifyContent: 'center' },
    resumeButtonText: { color: theme.onBrand, fontWeight: '900', fontSize: 15 },
    start: {
      minHeight: 200, borderRadius: 36, backgroundColor: theme.brand, alignItems: 'center', justifyContent: 'center',
      gap: 6, ...theme.shadowLifted,
    },
    startPressed: { transform: [{ scale: 0.985 }], opacity: 0.95 },
    startText: { color: theme.onBrand, fontSize: 40, fontWeight: '900', letterSpacing: 4 },
    startSub: { color: theme.onBrand, fontSize: 14, fontWeight: '700', opacity: 0.85 },
    floorChip: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 14, marginTop: 6 },
    floorChipText: { color: theme.mutedStrong, fontSize: 15, fontWeight: '700' },
    weekCard: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: theme.radiusLg,
      padding: 18, marginTop: 10, ...theme.shadowCard,
    },
    weekLabel: { color: theme.muted, fontSize: 13, fontWeight: '800' },
    weekRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 2 },
    weekValue: { ...theme.numeric, color: theme.ink, fontSize: 40, lineHeight: 46 },
    weekValueSmall: { fontSize: 28, lineHeight: 36, marginLeft: 14 },
    weekUnit: { color: theme.inkSoft, fontSize: 15, fontWeight: '800', marginBottom: 6, marginLeft: 3 },
    weekLandmark: { color: theme.brandInk, fontSize: 13, fontWeight: '700', marginTop: 4 },
    streak: { alignItems: 'center', paddingLeft: 16, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.line },
    streakValue: { ...theme.numeric, color: theme.ink, fontSize: 30 },
    streakLabel: { color: theme.muted, fontSize: 12, fontWeight: '700' },
    section: { color: theme.ink, fontSize: 18, fontWeight: '900', marginTop: 28, marginBottom: 10 },
    empty: { color: theme.muted, fontSize: 14, lineHeight: 21 },
    building: {
      flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.card, borderRadius: theme.radiusLg,
      padding: 12, marginBottom: 10, ...theme.shadowSoft,
    },
    buildingName: { color: theme.ink, fontSize: 17, fontWeight: '900' },
    buildingMeta: { color: theme.muted, fontSize: 13, marginTop: 2 },
    buildingLast: { color: theme.brandInk, fontSize: 12, fontWeight: '700', marginTop: 3 },
    more: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
    go: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.brand, alignItems: 'center', justifyContent: 'center' },
    scrim: { flex: 1, backgroundColor: theme.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
    modal: { width: '100%', maxWidth: 380, backgroundColor: theme.card, borderRadius: theme.radiusXl, padding: 20, gap: 12 },
    modalTitle: { color: theme.ink, fontSize: 18, fontWeight: '900' },
    modalHint: { color: theme.muted, fontSize: 13 },
    stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginVertical: 8 },
    stepButton: { width: 60, height: 60, borderRadius: 30, backgroundColor: theme.brandSoft, alignItems: 'center', justifyContent: 'center' },
    stepText: { color: theme.brandInk, fontSize: 30, fontWeight: '900' },
    stepValue: { ...theme.numeric, color: theme.ink, fontSize: 56, minWidth: 90, textAlign: 'center' },
    input: {
      minHeight: 48, borderRadius: theme.radiusMd, borderWidth: 1, borderColor: theme.line, paddingHorizontal: 14,
      color: theme.ink, fontSize: 16, backgroundColor: theme.cardSoft,
    },
    modalPrimary: { minHeight: 50, borderRadius: 25, backgroundColor: theme.brand, alignItems: 'center', justifyContent: 'center' },
    modalPrimaryText: { color: theme.onBrand, fontSize: 16, fontWeight: '900' },
    modalSecondary: { minHeight: 50, borderRadius: 25, borderWidth: 1.5, borderColor: theme.line, alignItems: 'center', justifyContent: 'center' },
    modalSecondaryText: { color: theme.inkSoft, fontSize: 16, fontWeight: '800' },
  })
}
