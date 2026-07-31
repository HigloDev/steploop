// 路线编辑/列表页：列出所有路线、点击进入验证或正式爬楼、新建路线入口。
// 新建路线走 LocationPicker → Calibrate → Review 流程。
// 距离排序基于后台静默定位（不阻塞 UI，失败时不显示距离）。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Header } from '../components/Header'
import { Button, Card, EmptyState, Pill } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import {
  deleteRoutes,
  getRoute,
  listRoutes,
  saveRoute,
} from '../services/storage'
import { getCurrentLocation } from '../services/location'
import { routesByDistance } from '../core/location'
import {
  RouteLearningStage,
  summarizeRouteLearning,
} from '../core/route-learning'
import { getFloorAchievementCount } from '../core/floors'
import { listWorkouts } from '../services/workout-storage'
import {
  RouteLocation,
  RouteSegment,
  RouteTemplate,
} from '../core/types'

// 仅 __DEV__ 下可用：注入一条已验证的测试路线，便于查看正式爬楼界面
function makeMockRoute(): RouteTemplate {
  const now = Date.now()
  // 生成单段 feature 数据：4 维向量 [cadence/240, energy/0.35, turnRad/1.2, paused]
  // 模拟一层楼约 12 帧（6 秒）：起步→中途拐弯→登顶
  const genSegmentFeatures = (seed: number): number[][] => {
    const frames: number[][] = []
    for (let i = 0; i < 12; i++) {
      const cadence = 0.38 + Math.sin((i + seed) * 0.6) * 0.08 // ~90-110 步/分
      const energy = 0.55 + Math.cos((i + seed) * 0.5) * 0.2    // 0.35-0.75
      const turn = i === 5 || i === 6 ? 0.55 : 0.1              // 中段一次拐弯
      frames.push([Number(cadence.toFixed(3)), Number(energy.toFixed(3)), turn, 0])
    }
    return frames
  }
  const segments: RouteSegment[] = [
    { id: 's1', type: 'flight', startMs: 0, endMs: 6000, floorFrom: 1, floorTo: 2, ascentM: 3.2, stepCount: 18, features: genSegmentFeatures(0) },
    { id: 's2', type: 'flight', startMs: 6000, endMs: 12000, floorFrom: 2, floorTo: 3, ascentM: 3.2, stepCount: 20, features: genSegmentFeatures(2) },
    { id: 's3', type: 'flight', startMs: 12000, endMs: 18000, floorFrom: 3, floorTo: 4, ascentM: 3.2, stepCount: 17, features: genSegmentFeatures(4) },
  ]
  return {
    id: 'mock-verified-route',
    name: '测试大厦1层→4层',
    startFloor: 1,
    endFloor: 4,
    carryMode: 'pocket',
    floorHeightM: 3.2,
    totalAscentM: 9.6,
    device: { platform: 'android', model: 'unknown', system: 'unknown' },
    segments,
    markers: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
    status: 'verified',
    verifiedAt: now,
    location: {
      name: '测试大厦',
      address: '武夷山市崇安街道测试路 1 号',
      latitude: 27.755,
      longitude: 118.033,
      accuracy: 15,
      source: 'map',
      confirmedAt: now,
    },
  }
}

type Filter = 'all' | 'verified' | 'pending'

interface RouteView {
  id: string
  name: string
  status: RouteTemplate['status']
  statusText: string
  statusTone: 'default' | 'good' | 'warn'
  floorCount: number
  startFloor: number
  endFloor: number
  totalAscentM: number
  distanceText: string
  locationText: string
  missingLocation: boolean
  learningStage: RouteLearningStage
  validLearningCount: number
}

function routeView(
  route: RouteTemplate,
  workouts: Awaited<ReturnType<typeof listWorkouts>>,
  distanceM?: number,
): RouteView {
  const learning = summarizeRouteLearning(route, workouts)
  return {
    id: route.id,
    name: route.name,
    status: route.status,
    statusText: learning.stageLabel,
    statusTone:
      learning.stage === 'verified' || learning.stage === 'usable'
        ? 'good'
        : 'warn',
    floorCount: getFloorAchievementCount(route.startFloor, route.endFloor),
    startFloor: route.startFloor,
    endFloor: route.endFloor,
    totalAscentM: route.totalAscentM,
    distanceText:
      distanceM === undefined
        ? ''
        : distanceM < 1000
          ? `${distanceM}米`
          : `${(distanceM / 1000).toFixed(1)}千米`,
    locationText: route.location?.name || '待补充地点',
    missingLocation: !route.location,
    learningStage: learning.stage,
    validLearningCount: learning.validCount,
  }
}

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'verified', label: '已验证' },
  { key: 'pending', label: '待验证' },
]

const SWIPE_ACTION_WIDTH = 88
const SWIPE_OPEN_THRESHOLD = 38

interface SwipeableRouteRowProps {
  route: RouteView
  batchMode: boolean
  selected: boolean
  revealed: boolean
  onReveal: (id: string) => void
  onSelect: (route: RouteView) => void
  onToggleSelected: (id: string) => void
  onRename: (route: RouteView) => void
  onManage: (route: RouteView) => void
  onDelete: (route: RouteView) => void
}

function SwipeableRouteRow({
  route,
  batchMode,
  selected,
  revealed,
  onReveal,
  onSelect,
  onToggleSelected,
  onRename,
  onManage,
  onDelete,
}: SwipeableRouteRowProps) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  const translateX = useRef(new Animated.Value(0)).current
  const dragStartX = useRef(0)
  const openRef = useRef(false)

  const closeRow = useCallback(() => {
    openRef.current = false
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      damping: 22,
      stiffness: 240,
      mass: 0.8,
    }).start()
  }, [translateX])

  const openRow = useCallback(() => {
    openRef.current = true
    onReveal(route.id)
    Animated.spring(translateX, {
      toValue: -SWIPE_ACTION_WIDTH,
      useNativeDriver: true,
      damping: 22,
      stiffness: 240,
      mass: 0.8,
    }).start()
  }, [onReveal, route.id, translateX])

  useEffect(() => {
    if (batchMode || !revealed) closeRow()
  }, [batchMode, revealed, closeRow])

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          !batchMode &&
          Math.abs(gesture.dx) > 8 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25 &&
          (gesture.dx < 0 || openRef.current),
        onPanResponderGrant: () => {
          translateX.stopAnimation((value) => {
            dragStartX.current = value
          })
        },
        onPanResponderMove: (_, gesture) => {
          const next = Math.max(
            -SWIPE_ACTION_WIDTH,
            Math.min(0, dragStartX.current + gesture.dx),
          )
          translateX.setValue(next)
        },
        onPanResponderRelease: (_, gesture) => {
          const endX = dragStartX.current + gesture.dx
          if (endX <= -SWIPE_OPEN_THRESHOLD || gesture.vx < -0.45) {
            openRow()
          } else {
            closeRow()
          }
        },
        onPanResponderTerminate: closeRow,
      }),
    [batchMode, closeRow, openRow, translateX],
  )

  const handleRowPress = () => {
    if (batchMode) {
      onToggleSelected(route.id)
      return
    }
    if (openRef.current) {
      closeRow()
      return
    }
    onSelect(route)
  }

  const handleDeletePress = () => {
    closeRow()
    onDelete(route)
  }

  return (
    <View style={styles.swipeRow}>
      <View style={styles.swipeClip}>
        {!batchMode ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`删除路线${route.name}`}
            style={styles.swipeDeleteAction}
            onPress={handleDeletePress}
          >
            <Text style={styles.swipeDeleteText}>删除</Text>
          </Pressable>
        ) : null}
        <Animated.View
          style={{ transform: [{ translateX }] }}
          {...panResponder.panHandlers}
        >
          <Pressable style={styles.routePressable} onPress={handleRowPress}>
            <Card
              style={
                batchMode && selected
                  ? { ...styles.routeCard, ...styles.routeCardSelected }
                  : styles.routeCard
              }
            >
              <View style={styles.routeHead}>
                {batchMode ? (
                  <View
                    style={[
                      styles.selectionCircle,
                      selected && styles.selectionCircleSelected,
                    ]}
                  >
                    {selected ? <Text style={styles.selectionCheck}>✓</Text> : null}
                  </View>
                ) : null}
                <Text style={styles.routeName} numberOfLines={1}>
                  {route.name}
                </Text>
                <Pill tone={route.statusTone}>{route.statusText}</Pill>
              </View>
              <Text style={styles.routeMeta}>
                {route.distanceText ? `${route.distanceText} · ` : ''}
                {route.locationText}
              </Text>
              <Text style={styles.routeSub}>
                {route.validLearningCount > 0
                  ? `${route.validLearningCount} 次有效学习 · ${route.floorCount} 层 · ${route.totalAscentM}米`
                  : '尚无路线数据 · 第一次训练后生成'}
              </Text>
              {!batchMode ? (
                <View style={styles.routeActions}>
                  <Pressable onPress={() => onRename(route)} hitSlop={8}>
                    <Text style={styles.routeActionText}>改名</Text>
                  </Pressable>
                  <Pressable onPress={() => onManage(route)} hitSlop={8}>
                    <Text style={styles.routeActionText}>管理</Text>
                  </Pressable>
                  <Text style={styles.routeEnterText}>查看档案</Text>
                </View>
              ) : (
                <Text style={styles.batchCardHint}>
                  {selected ? '已选中' : '点击选择'}
                </Text>
              )}
            </Card>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  )
}

export default function RouteEditScreen({
  navigation,
}: RootStackScreen<'RouteEdit'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)

  const [allRoutes, setAllRoutes] = useState<RouteView[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [location, setLocation] = useState<RouteLocation | undefined>(undefined)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedRouteIds, setSelectedRouteIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [revealedRouteId, setRevealedRouteId] = useState<string | undefined>()

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [list, workouts] = await Promise.all([listRoutes(), listWorkouts()])
      const sorted = routesByDistance(list, location)
      const views = sorted.map(({ route: r, distanceM }) =>
        routeView(r, workouts, distanceM),
      )
      setAllRoutes(views)
    } catch (err) {
      console.warn('[steploop] load routes failed', err)
    } finally {
      setLoading(false)
    }
  }, [location])

  useEffect(() => {
    refresh()
    const unsubscribe = navigation.addListener('focus', refresh)
    return unsubscribe
  }, [navigation, refresh])

  // 后台静默获取一次定位，用于路线距离排序。失败时不影响列表展示。
  useEffect(() => {
    let cancelled = false
    getCurrentLocation({ highAccuracy: false, expireMs: 4000 })
      .then((result) => {
        if (cancelled) return
        setLocation({
          name: '当前位置',
          address: '手机定位点',
          latitude: result.latitude,
          longitude: result.longitude,
          accuracy: result.accuracy,
          source: 'gps',
          confirmedAt: Date.now(),
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const filteredRoutes = useMemo(() => {
    return allRoutes.filter((r) => {
      if (filter === 'verified' && r.learningStage !== 'verified') return false
      if (filter === 'pending' && r.learningStage === 'verified') return false
      return true
    })
  }, [allRoutes, filter])

  useEffect(() => {
    const availableIds = new Set(allRoutes.map((route) => route.id))
    setSelectedRouteIds((current) => {
      const next = new Set(
        Array.from(current).filter((id) => availableIds.has(id)),
      )
      return next.size === current.size ? current : next
    })
  }, [allRoutes])

  const toggleSelectedRoute = useCallback((id: string) => {
    setSelectedRouteIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const visibleRouteIds = useMemo(
    () => filteredRoutes.map((route) => route.id),
    [filteredRoutes],
  )
  const allVisibleSelected =
    visibleRouteIds.length > 0 &&
    visibleRouteIds.every((id) => selectedRouteIds.has(id))

  const toggleSelectAllVisible = () => {
    setSelectedRouteIds((current) => {
      const next = new Set(current)
      if (allVisibleSelected) {
        visibleRouteIds.forEach((id) => next.delete(id))
      } else {
        visibleRouteIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  const exitBatchMode = () => {
    setBatchMode(false)
    setSelectedRouteIds(new Set())
  }

  const handleSelectRoute = (rv: RouteView) => {
    if (rv.missingLocation) {
      Alert.alert(
        '请先补充地点',
        '这是旧版路线，请先补充起点位置后再使用。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '去补充',
            onPress: () => navigation.navigate('LocationPicker', { routeId: rv.id }),
          },
        ],
      )
      return
    }
    navigation.navigate('RouteProfile', { id: rv.id })
  }

  const handleRename = (rv: RouteView) => {
    Alert.prompt(
      '重命名路线',
      '新名称将立即生效，已记录的爬楼历史保持不变。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定',
          onPress: async (newName?: string) => {
            const trimmed = (newName ?? '').trim()
            if (!trimmed) {
              Alert.alert('提示', '名称不能为空')
              return
            }
            const r = await getRoute(rv.id)
            if (!r) return
            r.name = trimmed
            r.updatedAt = Date.now()
            await saveRoute(r)
            refresh()
          },
        },
      ],
      'plain-text',
      rv.name,
    )
  }

  const handleInjectMockRoute = async () => {
    try {
      await saveRoute(makeMockRoute())
      await refresh()
      navigation.navigate('RouteProfile', { id: 'mock-verified-route' })
    } catch (err) {
      Alert.alert('注入失败', err instanceof Error ? err.message : '未知错误')
    }
  }

  const confirmDeleteRoutes = useCallback(
    (routes: RouteView[]) => {
      if (!routes.length) return
      const routeIds = routes.map((route) => route.id)
      const multiple = routes.length > 1
      Alert.alert(
        multiple ? `删除选中的${routes.length}条路线？` : `删除“${routes[0].name}”？`,
        '路线会从首页移除，已经产生的历史成绩仍会保留。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '删除',
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteRoutes(routeIds)
                setRevealedRouteId(undefined)
                setSelectedRouteIds(new Set())
                setBatchMode(false)
                await refresh()
              } catch (err) {
                Alert.alert(
                  '删除失败',
                  err instanceof Error ? err.message : '请稍后重试。',
                )
              }
            },
          },
        ],
      )
    },
    [refresh],
  )

  const handleManage = (rv: RouteView) => {
    const actions = rv.missingLocation
      ? ['重命名', '补充地点', '删除路线']
      : ['重命名', '删除路线']
    Alert.alert(rv.name, '选择操作', [
      { text: '取消', style: 'cancel' },
      ...actions.map((action) => ({
        text: action,
        onPress: async () => {
          if (action === '重命名') {
            handleRename(rv)
          } else if (action === '补充地点') {
            navigation.navigate('LocationPicker', { routeId: rv.id })
          } else if (action === '删除路线') {
            confirmDeleteRoutes([rv])
          }
        },
      })),
    ])
  }

  return (
    <View style={styles.page}>
      <Header
        title="垂直路线"
        back={false}
        rightLabel="设置"
        onRightPress={() => navigation.navigate('Settings')}
      />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        <View style={styles.hero}>
          <Text style={styles.title}>从这里开始向上</Text>
          <Text style={styles.subtitle}>
            选择已有路线开始爬楼，或新建一条标定路线。
          </Text>
        </View>

        <Button
          title="新建路线"
          onPress={() => navigation.navigate('LocationPicker')}
        />

        {__DEV__ ? (
          <Pressable style={styles.devInjectBtn} onPress={handleInjectMockRoute}>
            <Text style={styles.devInjectText}>注入测试路线（仅开发）</Text>
          </Pressable>
        ) : null}

        <View style={styles.toolbarRow}>
          {batchMode ? (
            <>
              <Text style={styles.selectedCount}>
                已选 {selectedRouteIds.size} 条
              </Text>
              <Pressable
                style={styles.toolbarLink}
                onPress={toggleSelectAllVisible}
                disabled={!visibleRouteIds.length}
              >
                <Text style={styles.toolbarLinkText}>
                  {allVisibleSelected ? '取消全选' : '全选'}
                </Text>
              </Pressable>
              <Pressable style={styles.toolbarLink} onPress={exitBatchMode}>
                <Text style={styles.toolbarLinkText}>取消</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={styles.toolbarLink}
                onPress={() => navigation.navigate('History')}
              >
                <Text style={styles.toolbarLinkText}>历史成绩</Text>
              </Pressable>
              <Pressable
                style={styles.toolbarLink}
                onPress={() => {
                  setRevealedRouteId(undefined)
                  setBatchMode(true)
                }}
                disabled={!allRoutes.length}
              >
                <Text
                  style={[
                    styles.toolbarLinkText,
                    !allRoutes.length && styles.toolbarLinkTextDisabled,
                  ]}
                >
                  批量管理
                </Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={styles.filterRow}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
              onPress={() => setFilter(f.key)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  filter === f.key && styles.filterChipTextActive,
                ]}
              >
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {batchMode ? (
          <Pressable
            accessibilityRole="button"
            style={[
              styles.batchDeleteButton,
              !selectedRouteIds.size && styles.batchDeleteButtonDisabled,
            ]}
            disabled={!selectedRouteIds.size}
            onPress={() =>
              confirmDeleteRoutes(
                allRoutes.filter((route) => selectedRouteIds.has(route.id)),
              )
            }
          >
            <Text
              style={[
                styles.batchDeleteText,
                !selectedRouteIds.size && styles.batchDeleteTextDisabled,
              ]}
            >
              {selectedRouteIds.size
                ? `删除选中的${selectedRouteIds.size}条路线`
                : '请选择要删除的路线'}
            </Text>
          </Pressable>
        ) : null}

        {!loading && filteredRoutes.length === 0 ? (
          <EmptyState
            title={allRoutes.length ? '没有符合筛选条件的路线' : '附近还没有标定路线'}
            subtitle={
              allRoutes.length
                ? '试试切换筛选条件'
                : '点击上方「新建路线」创建第一条路线。'
            }
          />
        ) : (
          filteredRoutes.map((rv) => (
            <SwipeableRouteRow
              key={rv.id}
              route={rv}
              batchMode={batchMode}
              selected={selectedRouteIds.has(rv.id)}
              revealed={revealedRouteId === rv.id}
              onReveal={setRevealedRouteId}
              onSelect={handleSelectRoute}
              onToggleSelected={toggleSelectedRoute}
              onRename={handleRename}
              onManage={handleManage}
              onDelete={(route) => confirmDeleteRoutes([route])}
            />
          ))
        )}
      </ScrollView>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: theme.pagePaddingH },
    hero: { marginTop: 8, marginBottom: 12 },
    eyebrow: {
      color: theme.green,
      fontSize: theme.fontEyebrow,
      fontWeight: '700',
      letterSpacing: 1.5,
    },
    title: {
      marginTop: 6,
      color: theme.ink,
      fontSize: theme.fontTitle,
      fontWeight: '700',
      lineHeight: 32,
    },
    subtitle: {
      marginTop: 6,
      color: theme.muted,
      fontSize: theme.fontSubtitle,
      lineHeight: 20,
    },
    toolbarRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 16,
      marginTop: 12,
      marginBottom: 8,
    },
    devInjectBtn: {
      alignSelf: 'center',
      marginTop: 8,
      marginBottom: 4,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.amber,
      backgroundColor: theme.amberSoft,
    },
    devInjectText: {
      color: theme.amberInk,
      fontSize: 12,
      fontWeight: '600',
    },
    toolbarLink: {
      paddingVertical: 4,
    },
    toolbarLinkText: {
      color: theme.green,
      fontSize: 13,
      fontWeight: '600',
    },
    toolbarLinkTextDisabled: {
      color: theme.muted,
      opacity: 0.55,
    },
    selectedCount: {
      marginRight: 'auto',
      color: theme.ink,
      fontSize: 13,
      fontWeight: '700',
    },
    filterRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 12,
    },
    filterChip: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: theme.surfaceSoft,
    },
    filterChipActive: {
      backgroundColor: theme.greenSoft,
    },
    filterChipText: {
      color: theme.muted,
      fontSize: 13,
      fontWeight: '600',
    },
    filterChipTextActive: {
      color: theme.green,
    },
    batchDeleteButton: {
      minHeight: theme.tapMin,
      marginBottom: 12,
      paddingHorizontal: 16,
      borderRadius: theme.radiusMd,
      backgroundColor: theme.red,
      alignItems: 'center',
      justifyContent: 'center',
    },
    batchDeleteButtonDisabled: {
      backgroundColor: theme.surfaceSoft,
    },
    batchDeleteText: {
      color: theme.card,
      fontSize: 14,
      fontWeight: '700',
    },
    batchDeleteTextDisabled: {
      color: theme.muted,
    },
    swipeRow: {
      marginBottom: 8,
      borderRadius: theme.radiusLg,
      ...theme.shadowCard,
    },
    swipeClip: {
      position: 'relative',
      overflow: 'hidden',
      borderRadius: theme.radiusLg,
      borderCurve: 'continuous',
      backgroundColor: theme.card,
    },
    swipeDeleteAction: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      width: SWIPE_ACTION_WIDTH,
      borderRadius: theme.radiusLg,
      backgroundColor: theme.red,
      alignItems: 'center',
      justifyContent: 'center',
    },
    swipeDeleteText: {
      color: theme.card,
      fontSize: 14,
      fontWeight: '800',
    },
    routePressable: {},
    routeCard: {
      marginBottom: 0,
      paddingHorizontal: 18,
      paddingVertical: 16,
    },
    routeCardSelected: {
      borderWidth: 2,
      borderColor: theme.green,
      backgroundColor: theme.greenSoft,
    },
    routeHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
      gap: 8,
    },
    selectionCircle: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: theme.line,
      backgroundColor: theme.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    selectionCircleSelected: {
      borderColor: theme.green,
      backgroundColor: theme.green,
    },
    selectionCheck: {
      color: theme.card,
      fontSize: 14,
      fontWeight: '900',
      lineHeight: 17,
    },
    routeName: {
      flex: 1,
      color: theme.ink,
      fontSize: 16,
      fontWeight: '700',
    },
    routeMeta: {
      color: theme.inkSoft,
      fontSize: 13,
      marginTop: 2,
    },
    routeSub: {
      color: theme.muted,
      fontSize: 12,
      marginTop: 2,
    },
    routeActions: {
      flexDirection: 'row',
      gap: 16,
      marginTop: 10,
      alignItems: 'center',
    },
    routeActionText: {
      color: theme.green,
      fontSize: 13,
      fontWeight: '600',
    },
    routeEnterText: {
      marginLeft: 'auto',
      color: theme.green,
      fontSize: 14,
      fontWeight: '700',
    },
    batchCardHint: {
      marginTop: 10,
      textAlign: 'right',
      color: theme.green,
      fontSize: 13,
      fontWeight: '700',
    },
  })
