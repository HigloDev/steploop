// 路线编辑/列表页：列出所有路线、点击进入验证或正式爬楼、新建路线入口。
// 新建路线走 LocationPicker → Calibrate → Review 流程。
// 距离排序基于后台静默定位（不阻塞 UI，失败时不显示距离）。

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
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
  deleteRoute,
  getRoute,
  listRoutes,
  saveRoute,
} from '../services/storage'
import { getCurrentLocation } from '../services/location'
import { routesByDistance } from '../core/location'
import {
  RouteLocation,
  RouteTemplate,
} from '../core/types'

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
}

function routeView(route: RouteTemplate, distanceM?: number): RouteView {
  const statusMap: Record<RouteTemplate['status'], string> = {
    draft: '草稿',
    needs_validation: '待验证',
    verified: '已验证',
  }
  return {
    id: route.id,
    name: route.name,
    status: route.status,
    statusText: statusMap[route.status] ?? route.status,
    statusTone: route.status === 'verified' ? 'good' : 'warn',
    floorCount: Math.abs(route.endFloor - route.startFloor),
    startFloor: route.startFloor,
    endFloor: route.endFloor,
    totalAscentM: route.totalAscentM,
    distanceText:
      distanceM === undefined
        ? ''
        : distanceM < 1000
          ? `${distanceM} m`
          : `${(distanceM / 1000).toFixed(1)} km`,
    locationText: route.location?.name || '待补充地点',
    missingLocation: !route.location,
  }
}

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'verified', label: '已验证' },
  { key: 'pending', label: '待验证' },
]

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

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await listRoutes()
      const sorted = routesByDistance(list, location)
      const views = sorted.map(({ route: r, distanceM }) => routeView(r, distanceM))
      setAllRoutes(views)
    } catch (err) {
      console.warn('[palou] load routes failed', err)
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
          address: 'GPS 定位点',
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
      if (filter === 'verified' && r.status !== 'verified') return false
      if (filter === 'pending' && r.status === 'verified') return false
      return true
    })
  }, [allRoutes, filter])

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
    if (rv.status === 'verified') {
      navigation.navigate('Climb', { id: rv.id, mode: 'formal' })
    } else {
      navigation.navigate('Validate', { id: rv.id })
    }
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
            Alert.alert('删除路线？', '路线模板会被删除，历史成绩仍会保留。', [
              { text: '取消', style: 'cancel' },
              {
                text: '删除',
                style: 'destructive',
                onPress: async () => {
                  await deleteRoute(rv.id)
                  refresh()
                },
              },
            ])
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
          <Text style={styles.eyebrow}>NEARBY ROUTES</Text>
          <Text style={styles.title}>从这里开始向上</Text>
          <Text style={styles.subtitle}>
            选择已有路线开始爬楼，或新建一条标定路线。
          </Text>
        </View>

        <Button
          title="新建路线"
          onPress={() => navigation.navigate('LocationPicker')}
        />

        <View style={styles.toolbarRow}>
          <Pressable
            style={styles.toolbarLink}
            onPress={() => navigation.navigate('History')}
          >
            <Text style={styles.toolbarLinkText}>历史成绩</Text>
          </Pressable>
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
            <Pressable
              key={rv.id}
              style={styles.routePressable}
              onPress={() => handleSelectRoute(rv)}
            >
              <Card raised style={styles.routeCard}>
                <View style={styles.routeHead}>
                  <Text style={styles.routeName} numberOfLines={1}>
                    {rv.name}
                  </Text>
                  <Pill tone={rv.statusTone}>{rv.statusText}</Pill>
                </View>
                <Text style={styles.routeMeta}>
                  {rv.distanceText ? `${rv.distanceText} · ` : ''}
                  {rv.startFloor}F 至 {rv.endFloor}F
                </Text>
                <Text style={styles.routeSub}>
                  {rv.floorCount} 层 · {rv.totalAscentM} m 确认爬升
                </Text>
                <View style={styles.routeActions}>
                  <Pressable onPress={() => handleRename(rv)} hitSlop={8}>
                    <Text style={styles.routeActionText}>改名</Text>
                  </Pressable>
                  <Pressable onPress={() => handleManage(rv)} hitSlop={8}>
                    <Text style={styles.routeActionText}>管理</Text>
                  </Pressable>
                  <Text style={styles.routeEnterText}>
                    {rv.status === 'verified' ? '开始' : '验证'}
                  </Text>
                </View>
              </Card>
            </Pressable>
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
    toolbarLink: {
      paddingVertical: 4,
    },
    toolbarLinkText: {
      color: theme.green,
      fontSize: 13,
      fontWeight: '600',
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
    routePressable: { marginBottom: 8 },
    routeCard: { padding: 14 },
    routeHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
      gap: 8,
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
  })
