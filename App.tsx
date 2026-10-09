// 应用入口：SafeAreaProvider + NavigationContainer + NativeStack。
// 启动时通过 AsyncStorage 检查隐私协议，未同意则初始路由为 Privacy。
// 未完成训练由训练首页统一提供继续、结束保存与放弃入口。

import React, { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { useColorScheme } from 'react-native'

import { RootStackParamList } from './src/navigation/types'
import { isPrivacyAgreed } from './src/services/privacy'
import { hasSeenOnboarding } from './src/services/onboarding'
import MainTabs from './src/navigation/MainTabs'
import { useTheme } from './src/theme'
import RouteEditScreen from './src/pages/RouteEdit'

import LocationPickerScreen from './src/pages/LocationPicker'
import CalibrateScreen from './src/pages/Calibrate'
import ReviewScreen from './src/pages/Review'
import ValidateScreen from './src/pages/Validate'
import ResultScreen from './src/pages/Result'
import PrivacyScreen from './src/pages/Privacy'
import OnboardingScreen from './src/pages/Onboarding'
import RouteProfileScreen from './src/pages/RouteProfile'
import WorkoutSetupScreen from './src/pages/WorkoutSetup'
import ClimbWorkoutScreen from './src/pages/BuildingWorkout'
import WorkoutResultScreen from './src/pages/WorkoutResult'
import ShareStudioScreen from './src/pages/ShareStudio'
import ClimbPreviewScreen from './src/pages/ClimbPreview'
import QuickStartScreen from './src/pages/QuickStart'
import DiagnosticCaptureScreen from './src/pages/DiagnosticCapture'

const Stack = createNativeStackNavigator<RootStackParamList>()


export default function App() {
  const scheme = useColorScheme()
  const theme = useTheme()
  const [ready, setReady] = useState(false)
  const [initialRoute, setInitialRoute] =
    useState<keyof RootStackParamList>('Main')

  useEffect(() => {
    let mounted = true
    isPrivacyAgreed()
      .then(async (agreed) => {
        if (!mounted) return
        if (!agreed) {
          setInitialRoute('Privacy')
          setReady(true)
          return
        }
        const seenOnboarding = await hasSeenOnboarding().catch(() => false)
        if (!seenOnboarding) {
          setInitialRoute('Onboarding')
          setReady(true)
          return
        }
        setInitialRoute('Main')
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
          <Stack.Screen name="Privacy" component={PrivacyScreen} />
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="Routes" component={RouteEditScreen} />
          <Stack.Screen name="LocationPicker" component={LocationPickerScreen} />
          <Stack.Screen name="Calibrate" component={CalibrateScreen} />
          <Stack.Screen name="Review" component={ReviewScreen} />
          <Stack.Screen name="Validate" component={ValidateScreen} />
          <Stack.Screen name="Result" component={ResultScreen} />
          <Stack.Screen name="RouteProfile" component={RouteProfileScreen} />
          <Stack.Screen name="WorkoutSetup" component={WorkoutSetupScreen} />
          <Stack.Screen name="ClimbWorkout" component={ClimbWorkoutScreen} />
          <Stack.Screen name="WorkoutResult" component={WorkoutResultScreen} />
          <Stack.Screen name="ShareStudio" component={ShareStudioScreen} />
          <Stack.Screen name="ClimbPreview" component={ClimbPreviewScreen} />
          <Stack.Screen name="QuickStart" component={QuickStartScreen} />
          <Stack.Screen name="DiagnosticCapture" component={DiagnosticCaptureScreen} />
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </SafeAreaProvider>
  )
}
