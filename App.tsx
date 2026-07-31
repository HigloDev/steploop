// 应用入口：SafeAreaProvider + NavigationContainer + NativeStack。
// 启动时通过 AsyncStorage 检查隐私协议，未同意则初始路由为 Privacy。
// 启动时检测 ActiveWorkoutCheckpoint，若存在则弹窗让用户选择继续训练或结束保存。

import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, View } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { useColorScheme } from 'react-native'

import { RootStackParamList, RootStackNavigation } from './src/navigation/types'
import { isPrivacyAgreed } from './src/services/privacy'
import { useTheme } from './src/theme'
import {
  clearActiveCheckpoint,
  loadActiveCheckpoint,
  saveWorkout,
} from './src/services/workout-storage'
import { getRoute } from './src/services/storage'
import { calculateWorkoutSummary, buildInterruptedRound } from './src/core/workout-summary'
import { ActiveWorkoutCheckpoint, ClimbWorkout } from './src/core/types'
import { hasKnownRouteEnd } from './src/core/route-state'
import { getFloorAchievementCount } from './src/core/floors'

import RouteEditScreen from './src/pages/RouteEdit'
import LocationPickerScreen from './src/pages/LocationPicker'
import CalibrateScreen from './src/pages/Calibrate'
import ReviewScreen from './src/pages/Review'
import ValidateScreen from './src/pages/Validate'
import ResultScreen from './src/pages/Result'
import PrivacyScreen from './src/pages/Privacy'
import HistoryScreen from './src/pages/History'
import SettingsScreen from './src/pages/Settings'
import RouteProfileScreen from './src/pages/RouteProfile'
import WorkoutSetupScreen from './src/pages/WorkoutSetup'
import ClimbWorkoutScreen from './src/pages/ClimbWorkout'
import WorkoutResultScreen from './src/pages/WorkoutResult'
import ShareStudioScreen from './src/pages/ShareStudio'
import ClimbPreviewScreen from './src/pages/ClimbPreview'

const Stack = createNativeStackNavigator<RootStackParamList>()

const PHASE_LABEL: Record<ActiveWorkoutCheckpoint['phase'], string> = {
  setup: '准备中',
  round_ready: '准备下一轮',
  countdown: '倒计时中',
  ascending: '爬楼中',
  round_complete: '本轮完成',
  returning: '返回起点中',
  start_confirmation: '确认返回起点',
  recovering: '恢复休息中',
  workout_complete: '已完成',
}

function describeCheckpoint(cp: ActiveWorkoutCheckpoint): string {
  const completeRounds = cp.completedRounds.filter((r) => r.complete).length
  return `已完成 ${completeRounds} 轮\n当前处于「${PHASE_LABEL[cp.phase] ?? cp.phase}」阶段`
}

// 把检查点保存为已完成的训练（用户选择"结束并保存"时使用）
async function saveCheckpointAsCompleted(
  cp: ActiveWorkoutCheckpoint,
): Promise<ClimbWorkout | null> {
  const route = await getRoute(cp.templateId)
  if (!route) return null
  // ascending 被中断时无法恢复半轮特征：把本轮记录为 interrupted 轮次，
  // 与 resumeFromCheckpoint 行为保持一致，让历史记录可见这次中断
  const rounds =
    cp.phase === 'ascending' || cp.phase === 'countdown'
      ? [...cp.completedRounds, buildInterruptedRound(cp, route)]
      : cp.completedRounds
  const summary = calculateWorkoutSummary(rounds, cp.startedAt, Date.now())
  const knownEnd = hasKnownRouteEnd(route)
  const workout: ClimbWorkout = {
    id: cp.workoutId,
    templateId: cp.templateId,
    templateVersion: route.version,
    routeSnapshot: {
      name: route.name,
      locationName: route.location?.name ?? route.name,
      startFloor: route.startFloor,
      endFloor: knownEnd ? route.endFloor : route.startFloor,
      floorsPerRound: knownEnd
        ? getFloorAchievementCount(route.startFloor, route.endFloor)
        : 0,
      ascentPerRoundM: knownEnd ? route.totalAscentM : 0,
    },
    goal: knownEnd ? cp.goal : { type: 'open' },
    returnConfirmationMode: cp.returnConfirmationMode,
    status: 'completed',
    startedAt: cp.startedAt,
    endedAt: Date.now(),
    rounds,
    currentRoundNumber: cp.currentRoundNumber,
    totalRoundsCompleted: summary.completeRounds,
    totalFloorsCompleted: summary.totalFloors,
    totalAscentM: summary.totalAscentM,
    totalSteps: summary.totalSteps,
    activeDurationMs: summary.activeDurationMs,
    returnDurationMs: summary.returnDurationMs,
    recoveryDurationMs: summary.recoveryDurationMs,
    totalElapsedMs: summary.totalElapsedMs,
    bestRoundMs: summary.bestRoundMs,
    averageRoundMs: summary.averageRoundMs,
    latestRoundMs: summary.latestRoundMs,
    createdAt: cp.startedAt,
    updatedAt: Date.now(),
  }
  await saveWorkout(workout)
  await clearActiveCheckpoint()
  return workout
}

export default function App() {
  const scheme = useColorScheme()
  const theme = useTheme()
  const [ready, setReady] = useState(false)
  const [initialRoute, setInitialRoute] =
    useState<keyof RootStackParamList>('RouteEdit')
  const navigationRef = useRef<RootStackNavigation | null>(null)
  const pendingCheckpointRef = useRef<ActiveWorkoutCheckpoint | null>(null)

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
        // 检查未结束的训练
        try {
          const cp = await loadActiveCheckpoint()
          if (cp && mounted) {
            pendingCheckpointRef.current = cp
          }
        } catch (err) {
          console.warn('[steploop] load active checkpoint failed', err)
        }
        setInitialRoute('RouteEdit')
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

  const presentCheckpointResume = async (cp: ActiveWorkoutCheckpoint) => {
    const nav = navigationRef.current
    if (!nav) return
    Alert.alert(
      '发现未结束的爬楼训练',
      describeCheckpoint(cp),
      [
        {
          text: '结束并保存',
          style: 'destructive',
          onPress: async () => {
            await saveCheckpointAsCompleted(cp)
            Alert.alert('已保存', '训练记录已写入历史。')
          },
        },
        {
          text: '放弃保存',
          style: 'cancel',
          onPress: async () => {
            await clearActiveCheckpoint()
          },
        },
        {
          text: '继续训练',
          onPress: async () => {
            const route = await getRoute(cp.templateId)
            if (!route) {
              Alert.alert('路线已删除', '无法继续训练，已清除检查点。')
              await clearActiveCheckpoint()
              return
            }
            // ascending 被中断时无法恢复半轮特征，由 ClimbWorkout
            // 内部根据 phase 决定从下一轮 round_ready 重新开始
            nav.navigate('ClimbWorkout', {
              id: cp.templateId,
              goal: cp.goal,
              returnConfirmationMode: cp.returnConfirmationMode,
            })
          },
        },
      ],
      { cancelable: false },
    )
  }

  const handleNavigationReady = () => {
    const cp = pendingCheckpointRef.current
    if (!cp) return
    pendingCheckpointRef.current = null
    void presentCheckpointResume(cp)
  }

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
        ref={(nav) => {
          if (nav) {
            navigationRef.current = nav as unknown as RootStackNavigation
          }
        }}
        onReady={handleNavigationReady}
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
          <Stack.Screen name="Result" component={ResultScreen} />
          <Stack.Screen name="Privacy" component={PrivacyScreen} />
          <Stack.Screen name="History" component={HistoryScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="RouteProfile" component={RouteProfileScreen} />
          <Stack.Screen name="WorkoutSetup" component={WorkoutSetupScreen} />
          <Stack.Screen name="ClimbWorkout" component={ClimbWorkoutScreen} />
          <Stack.Screen name="WorkoutResult" component={WorkoutResultScreen} />
          <Stack.Screen name="ShareStudio" component={ShareStudioScreen} />
          <Stack.Screen name="ClimbPreview" component={ClimbPreviewScreen} />
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </SafeAreaProvider>
  )
}
