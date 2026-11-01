import React from 'react'
import { useWindowDimensions, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { MainTabParamList } from './types'
import { getPrimaryActionPaint, getSkinLayout, getThemeSkinId, useTheme } from '../theme'
import { BrandMark } from '../components/brand-mark'
import { triggerHaptic } from '../services/preferences'
import TrainHomeScreen from '../pages/Home'
import CoachHome from '../pages/coach-home'
import HistoryScreen from '../pages/History'
import SettingsScreen from '../pages/Settings'

const Tab = createBottomTabNavigator<MainTabParamList>()

const TAB_ICONS: Record<Exclude<keyof MainTabParamList, 'Train'>, keyof typeof MaterialCommunityIcons.glyphMap> = {
  Coach: 'account-tie-outline',
  History: 'chart-timeline-variant',
  Profile: 'cog-outline',
}

export default function MainTabs() {
  const theme = useTheme()
  const graphic = getThemeSkinId(theme) !== 'classic'
  const insets = useSafeAreaInsets()
  const { fontScale } = useWindowDimensions()
  // Keep each skin's approved chrome, but reserve extra label space at larger system sizes.
  const tabHeight = getSkinLayout(theme).tabHeight + Math.max(0, Math.ceil((fontScale - 1) * 20))
  return (
    <View style={{ flex: 1 }}>
    <Tab.Navigator
      initialRouteName="Train"
      screenListeners={{ tabPress: () => { void triggerHaptic('selection') } }}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.isDark && getThemeSkinId(theme) === 'eva-unit-01' ? getPrimaryActionPaint(theme).fill : theme.brandText,
        tabBarInactiveTintColor: theme.muted,
        tabBarAccessibilityLabel: { Train: '训练', Coach: '教练', History: '记录', Profile: '设置' }[route.name],
        tabBarStyle: {
          backgroundColor: theme.card,
          borderTopColor: theme.lineSoft,
          paddingTop: 8,
          height: tabHeight + insets.bottom,
          elevation: 0,
        },
        tabBarItemStyle: { paddingBottom: 4 },
        tabBarLabelStyle: {
          fontSize: graphic ? 13 : 11,
          fontWeight: '500',
        },
        tabBarIcon: ({ color, focused }) => (
          route.name === 'Train' ? (focused && getThemeSkinId(theme) === 'pikachu' ? <BrandMark size={28} /> : <MaterialCommunityIcons name="stairs-up" size={24} color={color} accessible={false} />) :
            <MaterialCommunityIcons name={TAB_ICONS[route.name]} size={24} color={color} accessible={false} />
        ),
      })}
    >
      <Tab.Screen name="Train" component={TrainHomeScreen} options={{ title: '训练' }} />
      <Tab.Screen name="Coach" component={CoachHome} options={{ title: '教练' }} />
      <Tab.Screen name="History" component={HistoryScreen} options={{ title: '记录' }} />
      <Tab.Screen name="Profile" component={SettingsScreen} options={{ title: '设置' }} />
    </Tab.Navigator>
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: theme.paper }} />
    </View>
  )
}
