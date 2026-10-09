// 路线管理页（底部 Tab「路线」）：列出所有路线、进入路线档案、新建/改名/删除。
// 新建路线走 LocationPicker → Calibrate → Review 流程。
// 本页不再承担训练入口（开始/继续训练在训练 Tab 的 TrainHome），
// 也不展示训练进度汇总，避免与训练首页职责重复。
// 距离排序基于后台静默定位（不阻塞 UI，失败时不显示距离）。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  PanResponder,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Disclosure } from '../components/disclosure'
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
import { getCurrentLocationIfAuthorized } from '../services/location'
import { routesByDistance } from '../core/location'
import {
  RouteLearningStage,
  summarizeRouteLearning,
} from '../core/route-learning'
import { getFloorAchievementCount } from '../core/floors'
import { listWorkouts } from '../services/workout-storage'
import { RouteLocation, RouteTemplate } from '../core/types'

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
          <Pressable style={styles.routePressable} accessibilityRole={batchMode ? 'checkbox' : 'button'} accessibilityState={batchMode ? { checked: selected } : undefined} accessibilityLabel={batchMode ? `选择路线：${route.name}` : `查看路线：${route.name}`} onPress={handleRowPress}>
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
                  </View>
                ) : null}
                <Text style={styles.routeName}>
                  {route.name}
                </Text>
                <Pill tone={route.statusTone}>{route.statusText}</Pill>
              </View>
              <Text style={styles.routeSub}>{route.floorCount > 0 ? `${route.startFloor} → ${route.endFloor} 层 · ${route.totalAscentM} 米` : '首次训练后建立路线'}</Text>
              {!batchMode ? (
                <View style={styles.routeActions}>
                  <Pressable style={styles.routeAction} accessibilityRole="button" accessibilityLabel={`重命名路线：${route.name}`} onPress={() => onRename(route)}>
                    <Text style={styles.routeActionText}>改名</Text>
                  </Pressable>
                  <Pressable style={styles.routeAction} accessibilityRole="button" accessibilityLabel={`管理路线：${route.name}`} onPress={() => onManage(route)}>
                    <Text style={styles.routeActionText}>管理</Text>
                  </Pressable>

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
}: RootStackScreen<'Routes'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)

  const [allRoutes, setAllRoutes] = useState<RouteView[]>([])
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<RouteView | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [location, setLocation] = useState<RouteLocation | undefined>(undefined)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedRouteIds, setSelectedRouteIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [revealedRouteId, setRevealedRouteId] = useState<string | undefined>()

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [list, workouts] = await Promise.all([listRoutes(), listWorkouts()])
      const sorted = routesByDistance(list, location)
      setAllRoutes(
        sorted.map(({ route: r, distanceM }) => routeView(r, workouts, distanceM)),
      )
    } catch (err) {
      setLoadError('读取路线失败，请重试。')
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
    getCurrentLocationIfAuthorized({ highAccuracy: false, expireMs: 4000 })
      .then((result) => {
        if (cancelled || !result) return
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

  const searchedRoutes = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    return filteredRoutes.filter(r => `${r.name} ${r.locationText}`.toLocaleLowerCase().includes(search))
  }, [filteredRoutes, query])

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
    () => searchedRoutes.map((route) => route.id),
    [searchedRoutes],
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
    navigation.navigate('RouteProfile', { id: rv.id })
  }

  const handleRename = (rv: RouteView) => {
    setRenameValue(rv.name)
    setRenaming(rv)
  }

  const saveRename = async () => {
    if (!renaming || renameBusy) return
    const name = renameValue.trim()
    if (!name) { Alert.alert('提示', '名称不能为空'); return }
    setRenameBusy(true)
    try {
      const stored = await getRoute(renaming.id)
      if (!stored) throw new Error('路线已不存在')
      await saveRoute({ ...stored, name, updatedAt: Date.now() })
      setRenaming(null)
      await refresh()
    } catch (e) { Alert.alert('重命名失败', e instanceof Error ? e.message : '请重试。') }
    finally { setRenameBusy(false) }
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
        title="路线管理"
        back
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        style={styles.flex}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: 24 }]}
      >
        <View style={styles.hero}>
          <Text style={styles.title}>常走的楼梯</Text>
          <Text style={styles.subtitle}>{loading ? '正在读取路线…' : `${allRoutes.length} 条路线 · 打开档案查看学习进度`}</Text>
        </View>
        {allRoutes.length > 3 ? <TextInput accessibilityLabel="搜索路线" value={query} onChangeText={setQuery} placeholder="搜索名称或地点" placeholderTextColor={theme.mutedStrong} returnKeyType="search" style={styles.searchInput} /> : null}
        <View style={styles.toolbarRow}>
          {batchMode ? (
            <>
              <Text style={styles.selectedCount}>
                已选 {selectedRouteIds.size} 条
              </Text>
              <Pressable
                style={styles.toolbarLink}
                accessibilityRole="button"
                onPress={toggleSelectAllVisible}
                disabled={!visibleRouteIds.length}
              >
                <Text style={styles.toolbarLinkText}>
                  {allVisibleSelected ? '取消全选' : '全选'}
                </Text>
              </Pressable>
              <Pressable style={styles.toolbarLink} accessibilityRole="button" onPress={exitBatchMode}>
                <Text style={styles.toolbarLinkText}>取消</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={styles.toolbarLink}
                accessibilityRole="button"
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

        <Disclosure title="筛选路线" summary={FILTERS.find(f => f.key === filter)?.label}>
        <View style={styles.filterRow}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected: filter === f.key }}
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

        </Disclosure>
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

        {loading ? <ActivityIndicator color={theme.green} accessibilityLabel="正在读取路线" /> : null}
        {loadError ? <View><Text style={{ color: theme.redInk, marginBottom: 12 }}>{loadError}</Text><Button title="重试" variant="secondary" onPress={refresh} /></View> : null}
        {!loading && !loadError && searchedRoutes.length === 0 ? (
          <EmptyState
            title={allRoutes.length ? '没有符合筛选条件的路线' : '还没有路线'}
            subtitle={
              allRoutes.length
                ? '试试切换筛选条件'
                : '添加一条路线，或回到训练页直接开始。'
            }
          />
        ) : (
          searchedRoutes.map((rv) => (
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
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Button title="开始爬楼" onPress={() => navigation.navigate('QuickStart')} />
      </View>
      </KeyboardAvoidingView>
      <Modal visible={!!renaming} transparent animationType="fade" onRequestClose={() => { if (!renameBusy) setRenaming(null) }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.modalBackdrop, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={styles.renameSheet} contentContainerStyle={styles.renameContent}>
            <Text accessibilityRole="header" style={styles.renameTitle}>重命名路线</Text>
            <TextInput accessibilityLabel="路线名称" value={renameValue} onChangeText={setRenameValue} editable={!renameBusy} maxLength={100} returnKeyType="done" style={styles.renameInput} />
            <Button title="保存名称" loading={renameBusy} onPress={() => { void saveRename() }} />
            <Button title="取消" variant="secondary" disabled={renameBusy} onPress={() => setRenaming(null)} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: theme.pagePaddingH, paddingTop: 16 },
    hero: { gap: 8, paddingBottom: 16 },
    searchInput: { minHeight: theme.tapMin, color: theme.ink, fontSize: theme.fontBase, lineHeight: 22, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderRadius: theme.radiusMd, borderColor: theme.line, backgroundColor: theme.card },
    eyebrow: {
      color: theme.green,
      fontSize: theme.fontEyebrow,
      fontWeight: '700',
    },
    title: {
      color: theme.ink,
      fontSize: theme.fontTitle,
      fontWeight: '700',
      lineHeight: 34,
    },
    subtitle: {
      color: theme.mutedStrong,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
    },
    toolbarRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 12,
      marginTop: 8,
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
      minHeight: theme.tapMin,
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    toolbarLinkText: {
      color: theme.green,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '600',
    },
    toolbarLinkTextDisabled: {
      color: theme.muted,
      opacity: 0.55,
    },
    selectedCount: {
      marginRight: 'auto',
      color: theme.ink,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '700',
    },
    filterRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 16,
    },
    filterChip: {
      minHeight: theme.tapMin,
      justifyContent: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: theme.radiusMd,
      backgroundColor: theme.surfaceSoft,
    },
    filterChipActive: {
      backgroundColor: theme.greenSoft,
    },
    filterChipText: {
      color: theme.muted,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
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
      color: theme.onPrimary,
      fontSize: theme.fontBase,
      fontWeight: '700',
    },
    batchDeleteTextDisabled: {
      color: theme.muted,
    },
    swipeRow: {
      marginBottom: 12,
      borderRadius: theme.radiusLg,
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
      color: theme.onPrimary,
      fontSize: theme.fontBase,
      fontWeight: '700',
    },
    routePressable: {},
    routeCard: {
      marginBottom: 0,
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    routeCardSelected: {
      borderWidth: 1,
      borderColor: theme.green,
      backgroundColor: theme.greenSoft,
    },
    routeHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      flexWrap: 'wrap',
      marginBottom: 8,
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
    routeName: {
      flex: 1,
      minWidth: 140,
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
    },
    routeMeta: {
      color: theme.inkSoft,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      marginTop: 2,
    },
    routeSub: {
      color: theme.mutedStrong,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
    },
    routeActions: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line,
      alignItems: 'center',
    },
    routeActionText: {
      color: theme.green,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
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
    routeAction: { minHeight: theme.tapMin, paddingHorizontal: 12, justifyContent: 'center' },
    footer: { backgroundColor: theme.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, paddingHorizontal: theme.pagePaddingH, paddingTop: 8 },
    modalBackdrop: { flex: 1, justifyContent: 'center', paddingHorizontal: theme.pagePaddingH, backgroundColor: theme.scrim },
    renameSheet: { flexGrow: 0, maxHeight: '100%', backgroundColor: theme.card, borderRadius: theme.radiusLg },
    renameContent: { padding: 24, gap: 16 },
    renameTitle: { color: theme.ink, fontSize: 20, lineHeight: 28, fontWeight: '700' },
    renameInput: { minHeight: theme.tapMin, color: theme.ink, backgroundColor: theme.cardSoft, borderWidth: 1, borderColor: theme.line, borderRadius: theme.radiusSm, padding: 12, fontSize: theme.fontBase, lineHeight: 22 },
  })
