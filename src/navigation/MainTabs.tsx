import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { BlurTargetView, BlurView } from 'expo-blur'
import { BottomTabBar, BottomTabBarProps, createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { TabActions } from '@react-navigation/native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { MainTabParamList } from './types'
import { getPrimaryActionPaint, getSkinLayout, getThemeSkinId, isGlacier, typography, useTheme } from '../theme'
import { GLASS_DOCK_CONTENT_HEIGHT, GLASS_DOCK_H_MARGIN, GLASS_DOCK_MARGIN } from '../components/glass-material'
import { UIIcon } from '../components/ui-icon'
import { triggerHaptic } from '../services/preferences'
import TrainHomeScreen from '../pages/Home'
import CoachHome from '../pages/coach-home'
import HistoryPage from '../pages/History'
import SettingsScreen from '../pages/Settings'

const Tab = createBottomTabNavigator<MainTabParamList>()

type TabRouteName = keyof MainTabParamList
type TabIconName = 'climb' | 'coach' | 'records' | 'settings'

const TAB_ICON: Record<TabRouteName, TabIconName> = {
  Train: 'climb',
  Coach: 'coach',
  History: 'records',
  Profile: 'settings',
}

const TAB_LABEL: Record<TabRouteName, string> = { Train: '训练', Coach: '教练', History: '记录', Profile: '设置' }

/** 激活色块的圆角；与 Dock 的玻璃圆角保持同一视觉层级。 */
const GLASS_TAB_RADIUS = 14
const GLASS_TAB_PADDING = 4
const GLASS_TAB_GAP = 5

/** 大字号时 Dock 同步增高，保证标签在 130% 字号下不裁切。 */
function glacierDockHeight(fontScale: number): number {
  return GLASS_DOCK_CONTENT_HEIGHT + Math.max(0, Math.ceil((fontScale - 1) * 20))
}

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 每个 route 一个稳定 ref：换肤不重建、不重挂；BlurView 按当前 route 重新绑定。 */
const blurTargetRefs: Record<TabRouteName, React.RefObject<View | null>> = {
  Train: React.createRef<View>(),
  Coach: React.createRef<View>(),
  History: React.createRef<View>(),
  Profile: React.createRef<View>(),
}

interface GlacierTargetState {
  ready: Partial<Record<TabRouteName, boolean>>
  markReady: (name: TabRouteName) => void
}

const GlacierTargetContext = createContext<GlacierTargetState>({
  ready: {},
  markReady: () => {},
})

/** 稳定包裹每个 Tab 页面：BlurTargetView 始终存在，避免换肤时 subtree 重挂。 */
function makeGlacierScreen(routeName: TabRouteName, Screen: React.ComponentType<any>) {
  function GlacierScreen(props: any) {
    const { markReady } = useContext(GlacierTargetContext)
    return (
      <View style={styles.screenFrame}>
        <BlurTargetView
          ref={blurTargetRefs[routeName]}
          style={styles.screenFrame}
          onLayout={() => markReady(routeName)}
        >
          <Screen {...props} />
        </BlurTargetView>
      </View>
    )
  }
  GlacierScreen.displayName = `GlacierScreen(${routeName})`
  return GlacierScreen
}

const TrainTabScreen = makeGlacierScreen('Train', TrainHomeScreen)
const CoachTabScreen = makeGlacierScreen('Coach', CoachHome)
const HistoryTabScreen = makeGlacierScreen('History', HistoryPage)
const ProfileTabScreen = makeGlacierScreen('Profile', SettingsScreen)

/**
 * Dock 背景：Android 31+/iOS 在目标已布局后创建 BlurView，切换已布局页面时更新目标。
 * API24–30 退化为不透明表面。不在每行放 BlurView，也不访问真实数据。
 */
function GlassDockBackground({ routeName }: { routeName: TabRouteName }) {
  const theme = useTheme()
  const { ready } = useContext(GlacierTargetContext)
  const supportsBlur = Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) >= 31)
  const overlayFill = supportsBlur ? withAlpha(theme.glass.fill, theme.glass.overlayOpacity) : theme.card
  const targetRef = blurTargetRefs[routeName]
  if (supportsBlur && ready[routeName]) {
    return (
      <BlurView
        blurTarget={Platform.OS === 'android' ? targetRef : undefined}
        tint={Platform.OS === 'android' ? (theme.isDark ? 'dark' : 'light') : (theme.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterial')}
        intensity={theme.glass.blurIntensity}
        blurReductionFactor={theme.glass.blurReductionFactor}
        blurMethod={Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : 'none'}
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: overlayFill }]}
      />
    )
  }
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: overlayFill }]} />
}

/** 浮动胶囊位于内容之上，四个真实原生触区共用 React Navigation 的标签事件。 */
function GlacierDockBar(props: BottomTabBarProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { fontScale, width } = useWindowDimensions()
  const { index, routes } = props.state
  const focusedName = routes[index].name as TabRouteName
  const dockShadow = theme.elevation.level3.shadow
  const pressFill = withAlpha(theme.brand, theme.isDark ? 0.17 : 0.09)
  const dockHeight = glacierDockHeight(fontScale)
  // Give Fabric a measured touch host while the page remains behind the glass.
  const dockSlot = dockHeight + insets.bottom + GLASS_DOCK_MARGIN
  const reduced = useReducedMotion()
  const tabWidth = (width - 2 * (GLASS_DOCK_H_MARGIN + GLASS_TAB_PADDING) - GLASS_TAB_GAP * (routes.length - 1)) / routes.length
  const activeX = index * (tabWidth + GLASS_TAB_GAP)
  const position = useSharedValue(activeX)
  const activeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: position.get() }] }))
  useEffect(() => {
    position.set(reduced ? activeX : withTiming(activeX, { duration: 225, easing: Easing.out(Easing.cubic) }))
  }, [activeX, position, reduced])
  return (
    <View collapsable={false} pointerEvents="box-none" style={[styles.dockSlot, { height: dockSlot, marginTop: -dockSlot }]}>
      <View
        style={[
          styles.dockFrame,
          {
            bottom: GLASS_DOCK_MARGIN + insets.bottom,
            height: dockHeight,
            borderRadius: theme.radius.lg,
            boxShadow: [{
              offsetX: 0,
              offsetY: 4,
              blurRadius: 16,
              spreadDistance: 0,
              color: theme.isDark ? 'rgba(0, 0, 0, 0.50)' : withAlpha(dockShadow.shadowColor, 0.12),
            }],
          },
        ]}
      >
        <View style={[styles.dockShell, { borderRadius: theme.radius.lg }]}>
          <GlassDockBackground routeName={focusedName} />
          <View style={styles.dockButtons}>
            <Animated.View pointerEvents="none" style={[styles.dockSelection, activeStyle, {
              width: tabWidth,
              borderColor: withAlpha(theme.brandText, 0.38),
              backgroundColor: withAlpha(theme.brand, theme.isDark ? 0.29 : 0.16),
            }]} />
            {routes.map((route, routeIndex) => {
              const name = route.name as TabRouteName
              const selected = routeIndex === index
              const color = selected ? theme.brandText : theme.mutedStrong
              return <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityLabel={TAB_LABEL[name]}
                accessibilityState={{ selected }}
                style={({ pressed }) => [styles.dockButton, pressed && { backgroundColor: pressFill }]}
                onPress={() => {
                  const event = props.navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
                  if (!selected && !event.defaultPrevented) {
                    props.navigation.dispatch({ ...TabActions.jumpTo(route.name, route.params), target: props.state.key })
                  }
                }}
              >
                <UIIcon name={TAB_ICON[name]} size={23} color={color} accessible={false} />
                <Text style={{ fontSize: typography.caption.fontSize, color, fontWeight: selected ? '700' : '500' }}>{TAB_LABEL[name]}</Text>
              </Pressable>
            })}
          </View>
        </View>
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.glass.stroke, borderTopColor: theme.glass.highlight },
          ]}
        />
      </View>
    </View>
  )
}

function MainTabBar(props: BottomTabBarProps) {
  const theme = useTheme()
  return isGlacier(theme) ? <GlacierDockBar {...props} /> : <BottomTabBar {...props} />
}

function renderMainTabBar(props: BottomTabBarProps) {
  return <MainTabBar {...props} />
}

export default function MainTabs() {
  const theme = useTheme()
  const glass = isGlacier(theme)
  const graphic = getThemeSkinId(theme) !== 'classic'
  const insets = useSafeAreaInsets()
  const { fontScale } = useWindowDimensions()
  const tabHeight = getSkinLayout(theme).tabHeight + Math.max(0, Math.ceil((fontScale - 1) * 20))
  const [readyRoutes, setReadyRoutes] = useState<Partial<Record<TabRouteName, boolean>>>({})
  const markReady = useCallback((name: TabRouteName) => {
    setReadyRoutes(prev => (prev[name] ? prev : { ...prev, [name]: true }))
  }, [])
  const glacierTarget = useMemo(() => ({ ready: readyRoutes, markReady }), [readyRoutes, markReady])

  return (
    <GlacierTargetContext.Provider value={glacierTarget}>
      <View style={{ flex: 1 }}>
        <Tab.Navigator
          initialRouteName="Train"
          tabBar={renderMainTabBar}
          screenListeners={{ tabPress: () => { void triggerHaptic('selection') } }}
          screenOptions={({ route }) => ({
            headerShown: false,
            // The Dock already animates selection. Compositing two pages and the
            // live blur together makes a tab change much more expensive.
            animation: 'none',
            tabBarActiveTintColor: theme.isDark && getThemeSkinId(theme) === 'eva-unit-01' ? getPrimaryActionPaint(theme).fill : theme.brandText,
            tabBarInactiveTintColor: theme.muted,
            tabBarAccessibilityLabel: TAB_LABEL[route.name],
            tabBarIcon: ({ color }) => <UIIcon name={TAB_ICON[route.name]} size={24} color={color} accessible={false} />,
            ...(glass
              ? {
                  tabBarStyle: {
                    height: glacierDockHeight(fontScale),
                    backgroundColor: 'transparent',
                    borderTopWidth: 0,
                    borderWidth: 0,
                    paddingTop: 0,
                    elevation: 0,
                  },
                }
              : {
                  tabBarLabelStyle: { fontSize: typography.caption.fontSize, fontWeight: '500' },
                  tabBarItemStyle: { paddingBottom: 4 },
                  tabBarStyle: {
                    backgroundColor: theme.card,
                    borderTopColor: theme.lineSoft,
                    paddingTop: 8,
                    height: tabHeight + insets.bottom,
                    elevation: 0,
                  },
                }),
          })}
        >
          <Tab.Screen name="Train" component={TrainTabScreen} options={{ title: '训练' }} />
          <Tab.Screen name="Coach" component={CoachTabScreen} options={{ title: '教练' }} />
          <Tab.Screen name="History" component={HistoryTabScreen} options={{ title: '记录' }} />
          <Tab.Screen name="Profile" component={ProfileTabScreen} options={{ title: '设置' }} />
        </Tab.Navigator>
        <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: glass ? 'transparent' : theme.paper }} />
      </View>
    </GlacierTargetContext.Provider>
  )
}

const styles = StyleSheet.create({
  screenFrame: { flex: 1 },
  dockSlot: { position: 'relative', zIndex: 10 },
  dockFrame: {
    position: 'absolute',
    left: GLASS_DOCK_H_MARGIN,
    right: GLASS_DOCK_H_MARGIN,
  },
  dockShell: {
    flex: 1,
    overflow: 'hidden',
  },
  dockButtons: { flex: 1, flexDirection: 'row', gap: GLASS_TAB_GAP, padding: GLASS_TAB_PADDING },
  dockSelection: { position: 'absolute', left: GLASS_TAB_PADDING, top: GLASS_TAB_PADDING, bottom: GLASS_TAB_PADDING, borderWidth: 1, borderRadius: GLASS_TAB_RADIUS },
  dockButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: GLASS_TAB_RADIUS },
})
