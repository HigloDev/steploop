import React from 'react'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { MainTabParamList } from './types'
import { useTheme } from '../theme'
import { BrandMark } from '../components/brand-mark'
import TrainHomeScreen from '../pages/Home'
import HistoryScreen from '../pages/History'
import SettingsScreen from '../pages/Settings'

const Tab = createBottomTabNavigator<MainTabParamList>()

const TAB_ICONS: Record<Exclude<keyof MainTabParamList, 'Train'>, keyof typeof MaterialCommunityIcons.glyphMap> = {
  History: 'history',
  Profile: 'cog-outline',
}

export default function MainTabs() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <Tab.Navigator
      initialRouteName="Train"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.brand,
        tabBarInactiveTintColor: theme.muted,
        tabBarStyle: {
          backgroundColor: theme.paper,
          borderTopColor: theme.lineSoft,
          paddingTop: 8,
          height: 76 + insets.bottom,
          elevation: 0,
        },
        tabBarItemStyle: { paddingBottom: 4 },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '700',
        },
        tabBarIcon: ({ color }) => (
          route.name === 'Train' ? <BrandMark size={26} color={color} /> :
            <MaterialCommunityIcons name={TAB_ICONS[route.name]} size={26} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Train" component={TrainHomeScreen} options={{ title: '爬楼' }} />
      <Tab.Screen name="History" component={HistoryScreen} options={{ title: '记录' }} />
      <Tab.Screen name="Profile" component={SettingsScreen} options={{ title: '设置' }} />
    </Tab.Navigator>
  )
}
