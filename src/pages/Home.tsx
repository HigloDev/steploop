// 训练首页：玻璃 Bento 布局 —— 剪纸楼梯主卡 + 悬浮主操作 + 周累计/每日趋势/最近一次。
// 沿用 fusion-v1 训练与恢复逻辑；支持全部 5 套轻量玻璃配色与浅暗模式。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { UIIcon } from '../components/ui-icon'

import { BrandMark } from '../components/brand-mark'
import { BrandWordmark } from '../components/brand-wordmark'
import { BuildingThumb } from '../components/BuildingThumb'
import { AscentReferences } from '../components/ascent-references'
import { SportButton } from '../components/sport-ui'
import { WeekBars } from '../components/training-visuals'
import { FlowSheet } from '../components/flow-sheet'
import { MotionPressable } from '../components/motion-pressable'
import { TrackedImage } from '../components/tracked-image'
import { GlassBackdrop, getGlassSurfaceStyle, useGlassDockInset } from '../components/glass-material'
import { MotionBrandBadge, MotionHeroSurfaceArt } from '../components/motion-ring-graphics'
import { waitForFusionCleanup } from '../hooks/useFusionWorkout'
import { BuildingTemplate, floorCount, templateTotalAscentM } from '../core/building-template'
import { normalizeFloorNumber, shiftFloorNumber } from '../core/floors'
import { describeAscent } from '../core/landmarks'
import { buildWeeklyAchievement, type WeeklyAchievement } from '../core/weekly-achievement'
import { triggerHaptic } from '../services/preferences'
import { formatDuration, uid } from '../core/math'
import type { ActiveWorkoutCheckpoint, ClimbWorkout, RouteLocation } from '../core/types'
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
import { getThemeStairwell } from '../skin-assets'
import {
  getPrimaryActionPaint,
  getThemeSkinId,
  isLargeText,
  isMotionRing,
  sport,
  Theme,
  typography,
  useTheme,
  useThemeStyles,
} from '../theme'

type WeekStats = WeeklyAchievement

function computeWeek(workouts: ClimbWorkout[]): WeekStats {
  return buildWeeklyAchievement(workouts)
}

function floorAfterLabel(building: BuildingTemplate): number {
  return building.floors.at(-1)?.floorTo ?? building.startFloor
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
    routeSnapshot: {
      name: '旧版训练',
      locationName: '旧版训练',
      startFloor: rounds[0]?.startFloor ?? 1,
      endFloor: rounds[0]?.finalFloor ?? 1,
      floorsPerRound: 0,
      ascentPerRoundM: 0,
    },
    goal: checkpoint.goal ?? { type: 'open' },
    returnConfirmationMode: checkpoint.returnConfirmationMode ?? 'manual',
    status: 'completed',
    startedAt: checkpoint.startedAt,
    endedAt,
    rounds,
    currentRoundNumber: rounds.length,
    totalRoundsCompleted: summary.completeRounds,
    totalFloorsCompleted: summary.totalFloors,
    totalAscentM: summary.totalAscentM,
    totalSteps: summary.totalSteps,
    activeDurationMs: summary.activeDurationMs,
    returnDurationMs: summary.returnDurationMs,
    recoveryDurationMs: summary.recoveryDurationMs,
    totalElapsedMs: summary.totalElapsedMs,
    createdAt: checkpoint.startedAt,
    updatedAt: endedAt,
  }
  if (rounds.length) await saveWorkout(workout)
  await clearActiveCheckpoint()
}

export default function HomeScreen({ navigation, route }: MainTabScreen<'Train'>) {
  const theme = useTheme()
  const styles = useThemeStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const dockInset = useGlassDockInset()
  const skinId = getThemeSkinId(theme)
  const motionRing = isMotionRing(theme)
  const actionPaint = getPrimaryActionPaint(theme)
  const stairwellSource = getThemeStairwell(skinId, theme.isDark ? 'dark' : 'light')

  const [buildings, setBuildings] = useState<BuildingTemplate[]>([])
  const [week, setWeek] = useState<WeekStats>(() => computeWeek([]))
  const [latest, setLatest] = useState<ClimbWorkout | null>(null)
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null)
  const [buildingPicker, setBuildingPicker] = useState(false)
  const [checkpoint, setCheckpoint] = useState<FusionCheckpoint | null>(null)
  const [legacyCheckpoint, setLegacyCheckpoint] = useState<ActiveWorkoutCheckpoint | null>(null)
  const [startFloor, setStartFloor] = useState(1)
  const [floorPicker, setFloorPicker] = useState(false)
  const [buildingLocation, setBuildingLocation] = useState<RouteLocation>()
  const reopenBuildingSetup = useRef(false)
  const [referencesOpen, setReferencesOpen] = useState(false)
  const [weekTrendOpen, setWeekTrendOpen] = useState(false)
  const [renaming, setRenaming] = useState<BuildingTemplate | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [managing, setManaging] = useState<BuildingTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const loadedOnceRef = useRef(false)
  const loadErrorRef = useRef('')
  const firstLoad = loading && !loadedOnce
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const reload = useCallback(async () => {
    if (!loadedOnceRef.current || loadErrorRef.current) setLoading(true)
    setLoadError('')
    loadErrorRef.current = ''
    try {
      // A render retry can remount Home before the old workout finishes saving.
      await waitForFusionCleanup()
      const [items, workouts, cp, legacy] = await Promise.all([
        listBuildings(),
        listWorkouts(),
        loadFusionCheckpoint(),
        loadActiveCheckpoint(),
      ])
      setBuildings(items)
      setWeek(computeWeek(workouts))
      setLatest([...workouts].sort((a, b) => b.startedAt - a.startedAt)[0] ?? null)
      setCheckpoint(cp)
      setLegacyCheckpoint(legacy && Array.isArray(legacy.completedRounds) ? legacy : null)
      loadedOnceRef.current = true
      setLoadedOnce(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '暂时无法读取本机记录，请重试。'
      loadErrorRef.current = msg
      setLoadError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void reload()
      if (!reopenBuildingSetup.current) return
      reopenBuildingSetup.current = false
      setFloorPicker(true)
    }, [reload]),
  )

  const pickedBuildingLocation = route?.params?.pickedBuildingLocation
  useEffect(() => {
    if (pickedBuildingLocation === undefined) return
    setBuildingLocation(pickedBuildingLocation ?? undefined)
    navigation.setParams({ pickedBuildingLocation: undefined })
  }, [navigation, pickedBuildingLocation])

  const pickBuildingLocation = () => {
    reopenBuildingSetup.current = true
    setFloorPicker(false)
    navigation.navigate('LocationPicker', { initialLocation: buildingLocation })
  }

  const enterWorkout = (params: ClimbWorkoutParams) => {
    if (loading || loadError || busy) return
    if (checkpoint) {
      Alert.alert(
        checkpoint.endedAt ? '还有成绩等待保存' : '还有一次训练没有结束',
        '请先处理上次训练，已完成的轮次会保留。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: checkpoint.endedAt ? '去保存' : '继续上次',
            onPress: () => navigation.navigate('ClimbWorkout', { resume: true }),
          },
        ],
      )
      return
    }
    void triggerHaptic('medium')
    navigation.navigate('ClimbWorkout', {
      ...params,
      ...(params.startFloor !== undefined ? { startFloor: normalizeFloorNumber(params.startFloor) } : {}),
    })
  }

  const startNew = () => enterWorkout({ startFloor, ...(buildingLocation ? { buildingLocation } : {}) })

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
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          setBusy(true)
          try {
            await deleteBuilding(building.id)
            await reload()
          } catch (e) {
            Alert.alert('删除失败', e instanceof Error ? e.message : String(e))
          } finally {
            setBusy(false)
          }
        },
      },
    ])
  }

  const confirmRename = async () => {
    if (!renaming || busy) return
    if (!nameDraft.trim()) {
      setActionError('请输入楼栋名称。')
      return
    }
    setBusy(true)
    setActionError('')
    try {
      await renameBuilding(renaming.id, nameDraft)
      setRenaming(null)
      await reload()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const discardCheckpoint = async () => {
    setBusy(true)
    try {
      await saveFusionCheckpoint(null)
      await reload()
    } catch (e) {
      Alert.alert('未能放弃训练', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const shiftFloor = (delta: -1 | 1) => {
    void triggerHaptic('selection')
    setStartFloor(value => Math.max(-5, Math.min(60, shiftFloorNumber(value, delta))))
  }

  const selected =
    selectedBuildingId === 'new'
      ? undefined
      : buildings.find(building => building.id === selectedBuildingId) ?? buildings[0]
  const latestSummary = latest ? calculateWorkoutSummary(latest.rounds, latest.startedAt, latest.endedAt) : null
  const { width: screenWidth, fontScale } = useWindowDimensions()
  const compactTiles = screenWidth < 370 || isLargeText(fontScale)

  const startLabel = selected
    ? `开始爬楼，使用 ${selected.name}，自动计层`
    : `开始爬楼，从 ${startFloor} 楼出发，第一轮标定`

  const weeklyStatus = firstLoad
    ? '正在读取训练记录'
    : loadError
      ? '训练记录暂未读到'
      : week.ascentM > 0
        ? describeAscent(week.ascentM)
        : null

  const weekRangeLabel = useMemo(() => {
    const startDay = week.days[0]
    const endDay = week.days[week.days.length - 1]
    if (!startDay || !endDay) return '本周'
    const start = new Date(startDay.at)
    const end = new Date(endDay.at)
    return `${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`
  }, [week.days])

  const maxDayFloors = Math.max(1, ...week.days.map(day => day.floors))

  const openBuildingOrSetup = () => {
    if (buildings.length > 0) setBuildingPicker(true)
    else setFloorPicker(true)
  }

  return (
    <View style={styles.page}>
      <GlassBackdrop />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 8, paddingBottom: insets.bottom + dockInset + 24 },
        ]}
      >
        <View style={styles.brandRow}>
          {motionRing ? (
            <MotionBrandBadge size={36}>
              <BrandMark size={20} color="#FFFFFF" />
            </MotionBrandBadge>
          ) : (
            <View style={[styles.brandSign, { backgroundColor: actionPaint.fill }]}>
              <BrandMark size={21} color={actionPaint.ink} />
            </View>
          )}
          <BrandWordmark color={theme.ink} size={26} />
          <Text style={styles.wordmark}>STEPLOOP</Text>
        </View>

        {checkpoint && !loading && !loadError ? (
          <View style={[styles.resume, getGlassSurfaceStyle(theme, 'feature')]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.resumeTitle}>{checkpoint.endedAt ? '有成绩等待保存' : '有一次训练没有结束'}</Text>
              <Text style={styles.resumeText}>
                已完成 {checkpoint.rounds.length} 轮 · {formatDuration((checkpoint.endedAt ?? checkpoint.savedAt) - checkpoint.startedAt)}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => navigation.navigate('ClimbWorkout', { resume: true })}
              style={[styles.resumeButton, { backgroundColor: actionPaint.fill }]}
            >
              <Text style={[styles.resumeButtonText, { color: actionPaint.ink }]}>{checkpoint.endedAt ? '保存' : '继续'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              accessibilityLabel="放弃未结束的训练"
              style={styles.resumeDismiss}
              hitSlop={8}
              onPress={() =>
                Alert.alert('放弃这次训练？', '未保存的轮次会丢失。', [
                  { text: '取消', style: 'cancel' },
                  { text: '放弃', style: 'destructive', onPress: () => void discardCheckpoint() },
                ])
              }
            >
              <UIIcon name="close" size={22} color={theme.muted} />
            </Pressable>
          </View>
        ) : null}

        {legacyCheckpoint && !loading && !loadError ? (
          <View style={[styles.resume, getGlassSurfaceStyle(theme, 'feature')]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.resumeTitle}>旧版训练没有结束</Text>
              <Text style={styles.resumeText}>已完成 {legacyCheckpoint.completedRounds.length} 轮，可以保存成绩</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={async () => {
                setBusy(true)
                try {
                  await saveLegacyCheckpoint(legacyCheckpoint)
                  await reload()
                } catch (e) {
                  Alert.alert('保存失败', e instanceof Error ? e.message : String(e))
                } finally {
                  setBusy(false)
                }
              }}
              style={[styles.resumeButton, { backgroundColor: actionPaint.fill }]}
            >
              <Text style={[styles.resumeButtonText, { color: actionPaint.ink }]}>保存</Text>
            </Pressable>
          </View>
        ) : null}

        {loadError ? (
          <View style={[styles.errorBanner, getGlassSurfaceStyle(theme, 'feature')]} accessibilityRole="alert">
            <View style={styles.errorBannerCopy}>
              <UIIcon name="alert" size={20} color={theme.redInk} accessible={false} />
              <Text selectable style={styles.errorBannerText}>{loadError}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="重新读取"
              onPress={() => void reload()}
              style={styles.errorRetryButton}
            >
              <Text style={styles.errorRetryText}>重新读取</Text>
            </Pressable>
          </View>
        ) : firstLoad ? (
          <View style={[styles.loadStrip, getGlassSurfaceStyle(theme, 'card')]}>
            <ActivityIndicator size="small" color={theme.brandText} />
            <Text style={styles.empty}>正在读取本机记录…</Text>
          </View>
        ) : null}

        <View style={[styles.hero, motionRing ? styles.heroMotionRing : getGlassSurfaceStyle(theme, 'feature')]}>
          <View
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={[StyleSheet.absoluteFill, styles.heroArt]}
          >
            {motionRing ? (
              <MotionHeroSurfaceArt variant="home" />
            ) : (
              <>
                <TrackedImage
                  identity={`art/${skinId}/${theme.isDark ? 'dark' : 'light'}/home-stairwell`}
                  source={stairwellSource}
                  resizeMode="cover"
                  accessible={false}
                  style={{ width: '100%', height: '100%' }}
                />
                <View style={[StyleSheet.absoluteFill, styles.heroArtMask]} />
              </>
            )}
          </View>

          <View style={styles.heroHead}>
            <Text accessibilityRole="header" style={[styles.todayTitle, motionRing && styles.heroOnDarkText]}>今日训练</Text>
            <View style={styles.heroHeadActions}>
              {selected ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`管理当前楼栋 ${selected.name}`}
                  onPress={() => manage(selected)}
                  style={({ pressed }) => [
                    styles.manageIconAction,
                    motionRing && styles.heroFrostControl,
                    pressed && { opacity: sport.opacity.pressed },
                  ]}
                >
                  <UIIcon name="more" size={20} color={motionRing ? theme.heroInk : theme.inkSoft} accessible={false} />
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={buildings.length > 0 ? '我的楼栋' : '起点与地点'}
                onPress={openBuildingOrSetup}
                style={({ pressed }) => [
                  styles.buildingAction,
                  motionRing && styles.heroFrostControl,
                  pressed && { opacity: sport.opacity.pressed },
                ]}
              >
                <Text style={[styles.buildingActionText, motionRing && styles.heroOnDarkText]}>
                  {buildings.length > 0 ? '我的楼栋' : '起点设置'}
                </Text>
              </Pressable>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={selected ? `选择楼栋，当前 ${selected.name}` : '新楼栋出发设置'}
            onPress={openBuildingOrSetup}
            onLongPress={selected ? () => manage(selected) : undefined}
            style={styles.buildingTap}
          >
            <Text style={[styles.buildingName, motionRing && styles.heroOnDarkText]} numberOfLines={2}>
              {selected?.name ?? buildingLocation?.name ?? '在新楼栋开始'}
            </Text>
          </Pressable>

          <View style={styles.routeMeta}>
            {selected ? (
              <View style={styles.routePoint}>
                <View style={[styles.routeDot, styles.topDot, motionRing && styles.heroTopDot]} />
                <Text style={[styles.routeValue, motionRing && styles.heroOnDarkText]}>{floorAfterLabel(selected)}</Text>
                <Text style={[styles.routeLabel, motionRing && styles.heroMutedText]}>楼 · 折返</Text>
              </View>
            ) : null}
            <View style={styles.routePoint}>
              <View style={[styles.routeDot, motionRing && styles.heroRouteDot]} />
              <Text style={[styles.routeValue, motionRing && styles.heroOnDarkText]}>{selected ? selected.startFloor : startFloor}</Text>
              <Text style={[styles.routeLabel, motionRing && styles.heroMutedText]}>楼 · 起点</Text>
            </View>
            {selected ? (
              <Text style={[styles.routeHint, motionRing && styles.heroMutedText]}>单趟 {Math.round(templateTotalAscentM(selected))} 米</Text>
            ) : null}
          </View>

          {!selected ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`起点与地点设置，当前起始楼层 ${startFloor} 楼，点按修改`}
              onPress={() => setFloorPicker(true)}
              style={[styles.floorChip, motionRing && styles.heroFrostChip]}
            >
              <Text style={[styles.floorChipText, motionRing && styles.heroOnDarkText]}>起点与地点</Text>
              <UIIcon name="pencil" size={14} color={motionRing ? theme.heroAccent : theme.brandInk} accessible={false} />
            </Pressable>
          ) : null}

          {!selected || selected.needsCalibration ? (
            <Text style={[styles.startHint, motionRing && styles.heroMutedText]}>
              {selected ? '旧楼栋可重新标定，让下一次记录更准确' : '首次使用：每到一层点一下，到顶即可保存。'}
            </Text>
          ) : null}
        </View>

        <View style={styles.startLift}>
          <SportButton
            title="开始爬楼"
            icon="play"
            disabled={busy || loading || !!loadError}
            accessibilityLabel={startLabel}
            onPress={selected ? () => startWithTemplate(selected) : startNew}
            style={styles.startButton}
          />
        </View>

        <View style={[styles.weekBento, getGlassSurfaceStyle(theme, 'feature')]}>
          <View style={styles.weekHeading}>
            <View style={styles.weekHeadingCopy}>
              <Text accessibilityRole="header" style={styles.weekHeadingText}>本周向上</Text>
              <Text style={styles.weekRange}>{weekRangeLabel}</Text>
            </View>
            <View style={styles.weekActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="分享本周成果"
                disabled={loading || !!loadError}
                onPress={() => navigation.navigate('WeeklyShare')}
                style={styles.weekAction}
              >
                <UIIcon name="share" size={19} color={theme.brandText} accessible={false} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="查看全部记录"
                onPress={() => navigation.jumpTo('History', { dayAt: undefined })}
                style={styles.weekAction}
              >
                <Text style={styles.weekActionText}>全部记录</Text>
                <UIIcon name="chevron-right" size={15} color={theme.brandInk} accessible={false} />
              </Pressable>
            </View>
          </View>

          <View style={[styles.weekZones, compactTiles && styles.weekZonesStacked]}>
            <MotionPressable
              style={[styles.weekMetricZone, compactTiles && styles.weekMetricZoneStacked]}
              accessibilityRole="button"
              accessibilityLabel={`本周累计爬升 ${firstLoad || loadError ? '—' : week.ascentM.toFixed(1)} 米，${firstLoad || loadError ? '—' : week.floors} 层，${firstLoad || loadError ? '—' : week.workouts} 次训练，查看高度完成情况`}
              disabled={loading || !!loadError}
              onPress={() => setReferencesOpen(true)}
            >
              <View style={styles.weekLabelRow}>
                <Text style={styles.weekLabel}>累计高度</Text>
                <UIIcon name="chevron-right" size={15} color={theme.brandInk} accessible={false} />
              </View>
              <View style={styles.weekRow}>
                <Text style={styles.weekValue} numberOfLines={1} adjustsFontSizeToFit>
                  {firstLoad || loadError ? '—' : Math.round(week.ascentM)}
                </Text>
                <Text style={styles.weekUnit}>米</Text>
              </View>
              {weeklyStatus ? <Text style={styles.weekLandmark} numberOfLines={2}>{weeklyStatus}</Text> : null}
            </MotionPressable>

            <MotionPressable
              accessibilityRole="button"
              accessibilityLabel="查看本周每日趋势"
              disabled={loading || !!loadError}
              onPress={() => setWeekTrendOpen(true)}
              style={[styles.weekChartZone, compactTiles && styles.weekChartZoneStacked]}
            >
              <View style={styles.weekChartHead}>
                <Text style={styles.weekChartTitle}>每日趋势</Text>
                <UIIcon name="chevron-right" size={15} color={theme.brandInk} accessible={false} />
              </View>
              <View style={styles.weekChart}>
                {!loading && !loadError && week.workouts === 0 ? (
                  <Text style={styles.emptySmall}>本周还没有训练</Text>
                ) : null}
                <WeekBars days={week.days} />
              </View>
            </MotionPressable>
          </View>

          <View style={styles.weekDivider} />

          <View style={styles.weekStats}>
            <View style={styles.weekStatPair}>
              <Text style={styles.weekStatValue}>{firstLoad || loadError ? '—' : week.floors}</Text>
              <Text style={styles.weekStatUnit}>层爬升</Text>
            </View>
            <View style={styles.weekStatPair}>
              <Text style={styles.weekStatValue}>{firstLoad || loadError ? '—' : week.workouts}</Text>
              <Text style={styles.weekStatUnit}>次训练</Text>
            </View>
          </View>

          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel={latest ? `查看最近训练 ${latest.routeSnapshot.name}` : '查看训练记录'}
            disabled={loading || !!loadError}
            onPress={() => {
              if (latest && latestSummary) navigation.navigate('WorkoutResult', { id: latest.id })
              else navigation.jumpTo('History', { dayAt: undefined })
            }}
            contentStyle={styles.weekRecent}
          >
            <View style={styles.weekRecentCopy}>
              {latest && latestSummary ? (
                <>
                  <View style={styles.weekRecentLine}>
                    <Text style={styles.weekRecentTitle}>最近一次</Text>
                    <Text style={styles.latestName} numberOfLines={1}>
                      {latest.routeSnapshot.locationName || latest.routeSnapshot.name}
                    </Text>
                  </View>
                  <Text style={styles.latestMeta} numberOfLines={1}>
                    {latestSummary.totalFloors} 层 · {Math.round(latestSummary.totalAscentM)} 米 · {formatDuration(latestSummary.totalElapsedMs)}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.weekRecentTitle}>最近一次</Text>
                  <Text style={styles.emptySmall} numberOfLines={1}>
                    {firstLoad ? '正在读取最近训练…' : loadError ? '训练记录暂未读到' : '第一段向上记录，就从今天开始'}
                  </Text>
                </>
              )}
            </View>
            <UIIcon name="chevron-right" size={17} color={theme.brandInk} accessible={false} />
          </MotionPressable>
        </View>
      </ScrollView>

      <AscentReferences
        visible={referencesOpen}
        onClose={() => setReferencesOpen(false)}
        ascentM={week.ascentM}
        floors={week.floors}
      />

      <FlowSheet visible={weekTrendOpen} title="本周每日趋势" onClose={() => setWeekTrendOpen(false)}>
        {week.days.map(day => {
          const date = new Date(day.at)
          const caption = `周${day.label} · ${date.getMonth() + 1}月${date.getDate()}日`
          const ratio = day.floors > 0 ? Math.max(0.08, day.floors / maxDayFloors) : 0
          return (
            <MotionPressable
              key={day.at}
              accessibilityRole="button"
              accessibilityLabel={`${caption}，${day.floors}层，查看当天训练`}
              onPress={() => {
                setWeekTrendOpen(false)
                navigation.jumpTo('History', { dayAt: day.at })
              }}
              style={styles.dayRow}
              contentStyle={styles.dayContent}
            >
              <Text style={styles.dayCaption}>{caption}</Text>
              <View style={styles.dayBarTrack}>
                {ratio > 0 ? (
                  <View style={[styles.dayBarFill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: theme.brandText }]} />
                ) : null}
              </View>
              <Text style={styles.dayValue}>{day.floors} 层</Text>
              <UIIcon name="chevron-right" size={15} color={theme.brandInk} accessible={false} />
            </MotionPressable>
          )
        })}
      </FlowSheet>

      <FlowSheet visible={buildingPicker} title="选择今天的楼栋" onClose={() => setBuildingPicker(false)}>
        {buildings.map(building => (
          <View key={building.id} style={styles.pickerRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`选择 ${building.name}`}
              accessibilityState={{ selected: selected?.id === building.id }}
              onPress={() => {
                setSelectedBuildingId(building.id)
                setBuildingLocation(undefined)
                setBuildingPicker(false)
              }}
              style={styles.pickerSelect}
            >
              <BuildingThumb floors={floorCount(building)} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={styles.buildingName} numberOfLines={2}>{building.name}</Text>
                <Text style={styles.buildingMeta}>
                  {floorCount(building)} 层 · {Math.round(templateTotalAscentM(building))} 米
                </Text>
              </View>
              {selected?.id === building.id ? (
                <UIIcon name="check-circle" size={23} color={theme.brandText} accessible={false} />
              ) : null}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`管理 ${building.name}`}
              onPress={() => {
                setBuildingPicker(false)
                manage(building)
              }}
              style={styles.more}
            >
              <UIIcon name="more" size={23} color={theme.muted} />
            </Pressable>
          </View>
        ))}
        <SportButton
          title="在新楼栋开始"
          secondary
          icon="plus"
          onPress={() => {
            setSelectedBuildingId('new')
            setBuildingPicker(false)
            setFloorPicker(true)
          }}
        />
      </FlowSheet>

      <FlowSheet visible={floorPicker} title="新楼栋设置" onClose={() => setFloorPicker(false)}>
        <Text style={styles.buildingName}>起始楼层</Text>
        <Text style={styles.modalHint}>楼层编号没有 0 楼，地下室选负数。</Text>
        <View style={styles.stepper}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="降低起始楼层"
            disabled={startFloor <= -5}
            onPress={() => shiftFloor(-1)}
            style={styles.stepButton}
          >
            <UIIcon name="minus" size={32} color={theme.ink} />
          </Pressable>
          <Text style={styles.stepValue} numberOfLines={1} adjustsFontSizeToFit accessibilityLiveRegion="polite">
            {startFloor}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="提高起始楼层"
            disabled={startFloor >= 60}
            onPress={() => shiftFloor(1)}
            style={[styles.stepButton, { backgroundColor: actionPaint.fill }]}
          >
            <UIIcon name="plus" size={32} color={actionPaint.ink} />
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={buildingLocation ? '更改地点，' + buildingLocation.name : '选择地点'}
          onPress={pickBuildingLocation}
          style={styles.locationRow}
        >
          <UIIcon name="compass" size={24} color={theme.brandInk} />
          <View style={{ flex: 1 }}>
            <Text style={styles.modalSecondaryText}>{buildingLocation ? '更改地点' : '选择地点（可选）'}</Text>
            <Text style={styles.modalHint}>{buildingLocation?.name ?? '在地图上标记这栋楼'}</Text>
          </View>
          <UIIcon name="chevron-right" size={20} color={theme.mutedStrong} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setFloorPicker(false)}
          style={[styles.modalPrimary, { backgroundColor: actionPaint.fill }]}
        >
          <Text style={[styles.modalPrimaryText, { color: actionPaint.ink }]}>确定</Text>
        </Pressable>
      </FlowSheet>

      <FlowSheet
        visible={!!managing || !!renaming}
        title={renaming ? '重命名楼栋' : managing?.name ?? '管理楼栋'}
        busy={busy}
        onClose={() => {
          if (!busy) {
            setManaging(null)
            setRenaming(null)
          }
        }}
      >
        {renaming ? (
          <>
            <Text style={styles.modalHint}>楼栋名称</Text>
            <TextInput
              value={nameDraft}
              onChangeText={value => {
                setNameDraft(value)
                setActionError('')
              }}
              maxLength={24}
              autoFocus
              style={styles.input}
              editable={!busy}
              returnKeyType="done"
              onSubmitEditing={() => void confirmRename()}
              placeholder="楼栋名称"
              placeholderTextColor={theme.muted}
              accessibilityLabel="楼栋名称"
            />
            <Text style={styles.modalHint}>给常用楼栋起一个好记的名字 · {nameDraft.length}/24</Text>
            {actionError ? <Text accessibilityRole="alert" selectable style={{ color: theme.redInk }}>{actionError}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setRenaming(null)}
                style={[styles.modalSecondary, { flex: 1, backgroundColor: theme.surfaceSoft }]}
              >
                <Text style={styles.modalSecondaryText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void confirmRename()}
                style={[styles.modalPrimary, { flex: 1, backgroundColor: actionPaint.fill }]}
              >
                <Text style={[styles.modalPrimaryText, { color: actionPaint.ink }]}>{busy ? '保存中…' : '保存'}</Text>
              </Pressable>
            </View>
          </>
        ) : managing ? (
          <>
            <Text style={styles.modalHint}>
              从 {managing.startFloor} 楼出发 · {floorCount(managing)} 层 · 约 {Math.round(templateTotalAscentM(managing))} 米
            </Text>
            <View style={{ backgroundColor: theme.surfaceSoft, borderRadius: 16, overflow: 'hidden' }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setNameDraft(managing.name)
                  setRenaming(managing)
                  setManaging(null)
                }}
                style={styles.manageRow}
              >
                <UIIcon name="pencil" size={22} color={theme.ink} />
                <Text style={[styles.modalSecondaryText, { flex: 1 }]}>重命名</Text>
                <UIIcon name="chevron-right" size={24} color={theme.muted} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  const building = managing
                  setManaging(null)
                  enterWorkout({ startFloor: building.startFloor, recalibrateTemplateId: building.id })
                }}
                style={styles.manageRow}
              >
                <UIIcon name="target" size={22} color={theme.ink} />
                <Text style={[styles.modalSecondaryText, { flex: 1 }]}>重新标定</Text>
                <UIIcon name="chevron-right" size={24} color={theme.muted} />
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => removeBuilding(managing)} style={styles.manageRow}>
                <UIIcon name="trash" size={22} color={theme.redInk} />
                <Text style={{ color: theme.redInk, fontSize: 16, fontWeight: '700', flex: 1 }}>删除楼栋模板</Text>
                <UIIcon name="chevron-right" size={24} color={theme.muted} />
              </Pressable>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setManaging(null)} style={styles.modalSecondary}>
              <Text style={styles.modalSecondaryText}>完成</Text>
            </Pressable>
          </>
        ) : null}
      </FlowSheet>
    </View>
  )
}

function makeStyles(theme: Theme) {
  const maskBase = theme.isDark ? theme.card : theme.paper
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    content: { paddingHorizontal: theme.pagePaddingH },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, minHeight: 40 },
    brandSign: { width: 35, height: 35, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
    wordmark: { color: theme.muted, fontSize: 9, letterSpacing: 1.4, fontWeight: '700', flex: 1, paddingLeft: 4 },
    resume: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderRadius: theme.radius.md,
      padding: 14,
      marginBottom: 14,
    },
    resumeTitle: { color: theme.ink, fontSize: 15, fontWeight: '800' },
    resumeText: { color: theme.mutedStrong, fontSize: 13, marginTop: 2 },
    resumeButton: { minHeight: 48, paddingHorizontal: 16, borderRadius: 20, justifyContent: 'center' },
    resumeButtonText: { fontWeight: '800', fontSize: 15 },
    resumeDismiss: { minHeight: 48, minWidth: 36, alignItems: 'center', justifyContent: 'center' },
    errorBanner: {
      borderRadius: theme.radius.md,
      padding: 14,
      marginBottom: 14,
      gap: 10,
      borderColor: theme.red,
    },
    errorBannerCopy: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    errorBannerText: { ...typography.secondary, color: theme.redInk, flex: 1 },
    errorRetryButton: {
      alignSelf: 'flex-start',
      minHeight: 48,
      paddingHorizontal: 16,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.redSoft,
      justifyContent: 'center',
    },
    errorRetryText: { ...typography.label, color: theme.redInk, fontWeight: '700' },
    loadStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: theme.radius.md,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginBottom: 12,
    },
    hero: { borderRadius: 24, padding: 16, paddingBottom: 42, minHeight: 232, gap: 4, overflow: 'hidden' },
    heroMotionRing: {
      backgroundColor: theme.heroSurface,
      borderWidth: 1,
      borderColor: theme.brandVisual.frostStroke,
      ...theme.elevation.level2.shadow,
    },
    heroOnDarkText: { color: theme.heroInk },
    heroMutedText: { color: theme.heroMuted },
    heroAccentText: { color: theme.heroAccent },
    heroFrostControl: {
      backgroundColor: theme.brandVisual.heroControlFill,
      borderColor: theme.brandVisual.heroControlStroke,
      borderWidth: 1,
    },
    heroFrostChip: {
      backgroundColor: theme.brandVisual.heroControlFill,
      borderColor: theme.brandVisual.heroControlStroke,
      borderWidth: 1,
    },
    heroRouteDot: { borderColor: theme.heroAccent },
    heroTopDot: { borderColor: theme.heroAccent, backgroundColor: theme.heroAccent },
    heroHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    heroHeadActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    todayTitle: { ...typography.section, color: theme.ink, fontWeight: '800', flexShrink: 1 },
    heroArt: { borderRadius: 24, overflow: 'hidden' },
    heroArtMask: {
      experimental_backgroundImage: theme.isDark
        ? `linear-gradient(to right, ${maskBase} 0%, ${maskBase}EE 40%, ${maskBase}66 74%, ${maskBase}22 100%)`
        : `linear-gradient(to right, ${maskBase} 0%, ${maskBase}EB 36%, ${maskBase}55 64%, ${maskBase}00 100%)`,
    },
    manageIconAction: {
      minWidth: 48,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 24,
      backgroundColor: theme.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
    },
    buildingAction: {
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 13,
      borderRadius: 24,
      backgroundColor: theme.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
    },
    buildingActionText: { ...typography.caption, color: theme.brandText, fontWeight: '600' },
    buildingTap: { minHeight: 48, alignSelf: 'flex-start', maxWidth: '70%', justifyContent: 'center' },
    buildingName: { color: theme.ink, fontSize: 17, lineHeight: 24, fontWeight: '700' },
    buildingMeta: { color: theme.mutedStrong, fontSize: 13, lineHeight: 19, marginTop: 2 },
    routeMeta: { alignItems: 'flex-start', gap: 5, paddingVertical: 4 },
    routePoint: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
    routeDot: { width: 8, height: 8, alignSelf: 'center', borderRadius: 4, borderColor: theme.brandText, borderWidth: 2 },
    topDot: { backgroundColor: theme.brandText },
    routeLabel: { ...typography.caption, color: theme.inkSoft },
    routeValue: { ...typography.digits, color: theme.ink, fontSize: 27, minWidth: 24 },
    routeHint: { ...typography.caption, color: theme.inkSoft, marginTop: 4 },
    floorChip: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minHeight: 48,
      paddingHorizontal: 14,
      backgroundColor: theme.brandSoft,
      borderRadius: 10,
      marginTop: 4,
    },
    floorChipText: { color: theme.brandInk, fontSize: 14, fontWeight: '600' },
    startHint: { color: theme.mutedStrong, fontSize: sport.type.caption, lineHeight: 19, marginTop: 4 },
    startLift: { marginTop: -26, marginHorizontal: 10, marginBottom: 14, zIndex: 1 },
    startButton: { borderRadius: 22, minHeight: 56 },
    weekBento: { alignSelf: 'stretch', borderRadius: theme.radius.lg, padding: 16 },
    weekHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
    weekHeadingCopy: { flex: 1, minWidth: 150, gap: 2 },
    weekHeadingText: { ...typography.cardTitle, color: theme.ink },
    weekRange: { ...typography.caption, color: theme.mutedStrong },
    weekActions: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto' },
    weekAction: { minHeight: 48, minWidth: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 6 },
    weekActionText: { ...typography.caption, color: theme.brandInk, fontWeight: '600' },
    weekZones: { flexDirection: 'row', alignItems: 'stretch', gap: 16, marginTop: 10 },
    weekZonesStacked: { flexDirection: 'column', gap: 14 },
    weekMetricZone: { flexBasis: '38%', flexGrow: 0, flexShrink: 1, minWidth: 0 },
    weekMetricZoneStacked: { width: '100%', flexBasis: 'auto' },
    weekLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    weekLabel: { ...typography.label, color: theme.ink, flexShrink: 1 },
    weekRow: { flexDirection: 'row', alignItems: 'baseline', columnGap: 6, marginTop: 2 },
    weekValue: { ...typography.digits, color: theme.brandText, fontSize: 46, lineHeight: 54, flexShrink: 1 },
    weekUnit: { ...typography.secondary, color: theme.mutedStrong },
    weekLandmark: { ...typography.caption, color: theme.mutedStrong, marginTop: 4 },
    weekStats: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 20, marginTop: 10 },
    weekStatPair: { flexDirection: 'row', alignItems: 'baseline', gap: 4, minWidth: 0 },
    weekStatValue: { ...typography.digits, color: theme.ink, fontSize: 22, lineHeight: 28, flexShrink: 1 },
    weekStatUnit: { ...typography.caption, color: theme.mutedStrong },
    weekChartZone: {
      flex: 1,
      minWidth: 168,
      justifyContent: 'space-between',
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: theme.line,
      paddingLeft: 16,
    },
    weekChartZoneStacked: { width: '100%', minWidth: 0, flex: 0, flexBasis: 'auto', borderLeftWidth: 0, paddingLeft: 0 },
    weekChartHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 6 },
    weekChartTitle: { ...typography.label, color: theme.ink, flexShrink: 1 },
    weekChart: { minWidth: 168, justifyContent: 'flex-end', gap: 8 },
    weekDivider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line, marginTop: 12 },
    weekRecent: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 6 },
    weekRecentCopy: { flex: 1, minWidth: 0, gap: 2 },
    weekRecentLine: { flexDirection: 'row', alignItems: 'baseline', gap: 6, minWidth: 0 },
    weekRecentTitle: { ...typography.label, color: theme.ink, flexShrink: 0 },
    latestName: { ...typography.label, color: theme.ink, flexShrink: 1 },
    latestMeta: { ...typography.caption, color: theme.mutedStrong, marginTop: 2 },
    emptySmall: { ...typography.caption, color: theme.mutedStrong },
    empty: { flexShrink: 1, color: theme.mutedStrong, fontSize: 13, lineHeight: 20 },
    dayRow: { minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.lineSoft },
    dayContent: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10 },
    dayCaption: { ...typography.secondary, color: theme.ink, fontWeight: '600', minWidth: 108 },
    dayBarTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: theme.lineSoft, overflow: 'hidden' },
    dayBarFill: { height: '100%', borderRadius: 3 },
    dayValue: { ...typography.digits, color: theme.ink, fontSize: 15, minWidth: 42, textAlign: 'right' },
    pickerRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.lineSoft },
    pickerSelect: { flex: 1, minHeight: 72, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
    more: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    manageRow: {
      minHeight: 52,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    modalHint: { color: theme.mutedStrong, fontSize: 14, lineHeight: 21 },
    locationRow: {
      minHeight: 56,
      paddingHorizontal: sport.space.md,
      paddingVertical: sport.space.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: sport.space.md,
      borderRadius: sport.radius.control,
      backgroundColor: theme.surfaceSoft,
    },
    stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginVertical: 8 },
    stepButton: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.surfaceSoft, alignItems: 'center', justifyContent: 'center' },
    stepValue: { ...typography.digits, color: theme.ink, fontSize: 84, lineHeight: 92, minWidth: 90, flexShrink: 1, textAlign: 'center' },
    input: {
      minHeight: 56,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.brandText,
      paddingHorizontal: 14,
      color: theme.ink,
      fontSize: 20,
      backgroundColor: theme.cardSoft,
    },
    modalPrimary: { minHeight: 54, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
    modalPrimaryText: { ...typography.control },
    modalSecondary: {
      minHeight: 52,
      borderRadius: theme.radius.md,
      borderWidth: 1.5,
      borderColor: theme.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalSecondaryText: { ...typography.control, color: theme.inkSoft },
  })
}
