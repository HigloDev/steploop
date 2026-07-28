// 应用入口：SafeAreaProvider + NavigationContainer + NativeStack。
// 启动时通过 AsyncStorage 检查隐私协议，未同意则初始路由为 Privacy。

import React, { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { useColorScheme } from 'react-native'

import { RootStackParamList } from './src/navigation/types'
import { isPrivacyAgreed } from './src/services/privacy'
import { useTheme } from './src/theme'

import RouteEditScreen from './src/pages/RouteEdit'
import LocationPickerScreen from './src/pages/LocationPicker'
import CalibrateScreen from './src/pages/Calibrate'
import ReviewScreen from './src/pages/Review'
import ValidateScreen from './src/pages/Validate'
import ClimbScreen from './src/pages/Climb'
import ResultScreen from './src/pages/Result'
import PrivacyScreen from './src/pages/Privacy'
import HistoryScreen from './src/pages/History'
import SettingsScreen from './src/pages/Settings'

const Stack = createNativeStackNavigator<RootStackParamList>()

export default function App() {
  const scheme = useColorScheme()
  const theme = useTheme()
  const [ready, setReady] = useState(false)
  const [initialRoute, setInitialRoute] =
    useState<keyof RootStackParamList>('RouteEdit')

  useEffect(() => {
    let mounted = true
    isPrivacyAgreed()
      .then((agreed) => {
        if (!mounted) return
        setInitialRoute(agreed ? 'RouteEdit' : 'Privacy')
        setReady(true)
      })
      .catch(() => {
        if (!mounted) return
        setInitialRoute('Privacy')
        setReady(true)
      })
    return () => {
      mounted = false
    }
  }, [])

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.paper, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.green} />
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      </View>
    )
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer
        theme={{
          dark: scheme === 'dark',
          colors: {
            primary: theme.green,
            background: theme.paper,
            card: theme.card,
            text: theme.ink,
            border: theme.line,
            notification: theme.red,
          },
          fonts: {
            regular: { fontFamily: '', fontWeight: '400' },
            medium: { fontFamily: '', fontWeight: '500' },
            bold: { fontFamily: '', fontWeight: '700' },
            heavy: { fontFamily: '', fontWeight: '800' },
          },
        }}
      >
        <Stack.Navigator
          initialRouteName={initialRoute}
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.paper },
          }}
        >
          <Stack.Screen name="RouteEdit" component={RouteEditScreen} />
          <Stack.Screen name="LocationPicker" component={LocationPickerScreen} />
          <Stack.Screen name="Calibrate" component={CalibrateScreen} />
          <Stack.Screen name="Review" component={ReviewScreen} />
          <Stack.Screen name="Validate" component={ValidateScreen} />
          <Stack.Screen name="Climb" component={ClimbScreen} />
          <Stack.Screen name="Result" component={ResultScreen} />
          <Stack.Screen name="Privacy" component={PrivacyScreen} />
          <Stack.Screen name="History" component={HistoryScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </SafeAreaProvider>
  )
}
