// 应用入口：SafeAreaProvider + NavigationContainer + NativeStack。
// 启动时检查隐私协议，未同意则初始路由为 Privacy；首次使用展示引导。
// fusion-v1 流程：首页 → 训练（全屏深色）→ 结算；另有记录、设置两个标签页。

import React, { useEffect, useState } from 'react'
import { ActivityIndicator, View, useColorScheme } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'

import { RootStackParamList } from './src/navigation/types'
import { isPrivacyAgreed } from './src/services/privacy'
import { hasSeenOnboarding } from './src/services/onboarding'
import MainTabs from './src/navigation/MainTabs'
import { useTheme, workoutPalette } from './src/theme'

import ResultScreen from './src/pages/Result'
import PrivacyScreen from './src/pages/Privacy'
import OnboardingScreen from './src/pages/Onboarding'
import WorkoutScreen from './src/pages/Workout'
import SummaryScreen from './src/pages/Summary'
import ShareStudioScreen from './src/pages/ShareStudio'
import DiagnosticCaptureScreen from './src/pages/DiagnosticCapture'

const Stack = createNativeStackNavigator<RootStackParamList>()

export default function App() {
  const scheme = useColorScheme()
  const theme = useTheme()
  const [ready, setReady] = useState(false)
  const [initialRoute, setInitialRoute] = useState<keyof RootStackParamList>('Main')

  useEffect(() => {
    let mounted = true
    isPrivacyAgreed()
      .then(async (agreed) => {
        if (!mounted) return
        if (!agreed) {
          setInitialRoute('Privacy')
        } else {
          const seenOnboarding = await hasSeenOnboarding().catch(() => false)
          setInitialRoute(seenOnboarding ? 'Main' : 'Onboarding')
        }
        if (mounted) setReady(true)
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
        <ActivityIndicator color={theme.brand} />
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
            primary: theme.brand,
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
          <Stack.Screen name="Privacy" component={PrivacyScreen} />
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen
            name="ClimbWorkout"
            component={WorkoutScreen}
            options={{ gestureEnabled: false, animation: 'slide_from_bottom', contentStyle: { backgroundColor: workoutPalette.bg } }}
          />
          <Stack.Screen name="WorkoutResult" component={SummaryScreen} />
          <Stack.Screen name="ShareStudio" component={ShareStudioScreen} />
          <Stack.Screen name="Result" component={ResultScreen} />
          <Stack.Screen name="DiagnosticCapture" component={DiagnosticCaptureScreen} />
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </SafeAreaProvider>
  )
}
