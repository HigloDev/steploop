/** Explicit development-only visual lab. Never loaded by a release bundle. */
import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, LogBox, View } from 'react-native'
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import AsyncStorage from '@react-native-async-storage/async-storage'
import MainTabs from '../navigation/MainTabs'
import { RootStackParamList } from '../navigation/types'
import Summary from '../pages/Summary'
import ShareStudio from '../pages/ShareStudio'
import Privacy from '../pages/Privacy'
import Onboarding from '../pages/Onboarding'
import Result from '../pages/Result'
import DiagnosticCapture from '../pages/DiagnosticCapture'
import Workout, { WorkoutContent } from '../pages/Workout'
import { useTheme } from '../theme'
import { FusionWorkoutApi } from '../hooks/useFusionWorkout'
import { FusionPhase, FusionRoundResult, FusionSnapshot } from '../core/fusion-engine'
import { BuildingTemplate } from '../core/building-template'
import { buildFusionWorkout, fusionRoundToWorkoutRound } from '../core/fusion-workout'
import { clearPendingTemplate, deleteBuilding, saveBuilding, savePendingTemplate } from '../services/building-storage'
import { deleteWorkout, saveWorkout } from '../services/workout-storage'
import { savePreferences } from '../services/preferences'
import { agreePrivacy } from '../services/privacy'

const Stack = createNativeStackNavigator<RootStackParamList>()
const NOW = new Date(2026, 9, 10, 20).getTime()
const START = new Date(2026, 9, 10, 9).getTime()
export const building: BuildingTemplate = {
  schemaVersion: 1, id: 'uiqa-building-a', name: '城市花园·A座', startFloor: 1,
  floors: Array.from({ length: 15 }, (_, i) => ({ floorFrom: i + 1, floorTo: i + 2, heightM: 3, steps: 18, turns: 2, durationMs: 12800 })),
  barometer: true, createdAt: START, updatedAt: START, version: 1,
}
function round(floors: number, n: number, start = START): FusionRoundResult {
  return { id: `uiqa-round-${start}-${n}`, roundNumber: n, kind: 'auto', startedAt: start + (n - 1) * 250000,
    topAt: start + (n - 1) * 250000 + 192000, endedAt: start + (n - 1) * 250000 + 192000,
    startFloor: 1, finalFloor: floors + 1, floors, ascentM: floors * 3, steps: floors * 18,
    activeMs: 192000, durationMs: 192000, estimated: false, confidence: 0.95, floorRecords: [],
    endReason: 'elevator_down', interruptions: [], baroCoverage: 1, notes: [] }
}
async function seed(state: string) {
  // Reset only our named synthetic records; ordinary user IDs are never touched.
  if (state === 'persist') return
  let clock = NOW
  let liveAt = 0
  globalThis.Date = new Proxy(Date, { construct: (target, args) => Reflect.construct(target, args.length ? args : [clock]), get: (target, key) => key === 'now' ? () => clock + (liveAt ? performance.now() - liveAt : 0) : Reflect.get(target, key) })
  LogBox.ignoreLogs(['Require cycle:'])
  await Promise.all(['uiqa-summary', 'uiqa-yesterday', 'uiqa-earlier', 'uiqa-week-fourth', 'uiqa-legacy', 'uiqa-template',
    'uiqa-height', ...[2, 10, 30, 60, 100, 200, 300].map(floors => `uiqa-height-${floors}`)].map(deleteWorkout))
  await deleteBuilding('uiqa-building-a')
  await deleteBuilding('uiqa-building-b')
  await deleteBuilding('uiqa-unsaved')
  await clearPendingTemplate()
  await AsyncStorage.removeItem('palou.routes.v3')
  await savePreferences({ bodyWeightKg: 65, voiceMode: 'standard', voiceVolume: 0.65, voiceRate: 1, hapticFeedback: true })
  await agreePrivacy()
  if (state === 'privacy-first') {
    await AsyncStorage.removeItem('palou.privacy.agreed.v1')
    await AsyncStorage.removeItem('palou.onboarding.v1')
  }
  if (state === 'empty') return
  await saveBuilding({ ...building, id: 'uiqa-building-b', name: '运动中心', floors: building.floors.slice(0, 10), updatedAt: START - 86400000 })
  await saveBuilding(building)
  for (const [id, floors, count, day, duration] of [
    ['uiqa-summary', 15, 2, 0, 560000], ['uiqa-yesterday', 10, 1, 1, 468000],
    ['uiqa-earlier', 5, 1, 2, 240000], ['uiqa-week-fourth', 5, 1, 2, 260000],
  ] as const) {
    const at = START - day * 86400000
    clock = at + duration
    await saveWorkout(buildFusionWorkout({ id, startedAt: at, endedAt: at + duration, status: 'completed',
      template: id === 'uiqa-yesterday' ? { ...building, id: 'uiqa-building-b', name: '运动中心' } : building,
      rounds: Array.from({ length: count }, (_, i) => fusionRoundToWorkoutRound(round(floors, i + 1, at))), bodyWeightKg: 65 }))
  }
  clock = NOW
  if (state.startsWith('references-') || state === 'history-heights') {
    // Use a different synthetic week so older isolated-lab records cannot affect these totals.
    const featureAt = new Date(2026, 9, 17, 9).getTime()
    if (state === 'history-heights') {
      for (const [index, floors] of [2, 10, 30, 60, 100, 200, 300].entries()) {
        const at = featureAt - index * 600000
        clock = at + 192000
        await saveWorkout(buildFusionWorkout({ id: `uiqa-height-${floors}`, startedAt: at, endedAt: at + 192000,
          status: 'completed', template: { ...building, name: `${floors} 层训练` },
          rounds: [fusionRoundToWorkoutRound(round(floors, 1, at))], bodyWeightKg: 65 }))
      }
    } else {
      const heights: Record<string, number> = { 'references-low': 12, 'references-mid': 632,
        'references-everest': 8848.86, 'references-beyond': 18000 }
      const ascentM = heights[state] ?? 0
      clock = featureAt + 192000
      await saveWorkout(buildFusionWorkout({ id: 'uiqa-height', startedAt: featureAt, endedAt: clock,
        status: 'completed', template: building,
        rounds: [fusionRoundToWorkoutRound({ ...round(Math.round(ascentM / 3), 1, featureAt), ascentM })], bodyWeightKg: 65 }))
    }
    clock = new Date(2026, 9, 17, 20).getTime()
  }
  if (state === 'summary-long') {
    await saveWorkout(buildFusionWorkout({ id: 'uiqa-summary', startedAt: START, endedAt: START + 560000,
      status: 'completed', template: building,
      rounds: [fusionRoundToWorkoutRound(round(150, 1)), fusionRoundToWorkoutRound(round(150, 2))], bodyWeightKg: 65 }))
  }
  if (state === 'legacy') {
  const legacy = buildFusionWorkout({ id: 'uiqa-legacy', startedAt: START - 86400000, endedAt: START - 86400000 + 192000,
    status: 'completed', template: building, rounds: [fusionRoundToWorkoutRound(round(15, 1, START - 86400000))], bodyWeightKg: 65 })
  await saveWorkout({ ...legacy, recognitionVersion: 'motion-v3' })
  }
  // Diagnostic config gets a synthetic reference; actual sensors still run normally.
  if (state === 'diagnostic') await AsyncStorage.setItem('palou.routes.v3', JSON.stringify([{ id: 'uiqa-route', name: '测试楼梯',
    startFloor: 1, endFloor: 16, carryMode: 'pocket', schemaVersion: 3, createdAt: START, updatedAt: START,
    floorHeightM: 3, totalAscentM: 45, device: { platform: 'android', model: 'synthetic-test-device', system: '14' },
    markers: [], version: 1, status: 'verified', modelVersion: 3,
    location: { name: '测试楼梯', address: '合成测试地点', latitude: 0, longitude: 0, accuracy: 1, source: 'map', confirmedAt: START },
    segments: [{ id: 'uiqa-segment', type: 'flight', floorFrom: 1, floorTo: 2, startMs: 0, endMs: 12800,
      ascentM: 3, stepCount: 18, features: [], durationMs: 12800, steps: 18, samples: [] }] }]))
  if (state === 'template') {
    const w = buildFusionWorkout({ id: 'uiqa-template', startedAt: START, endedAt: START + 192000, status: 'completed',
      rounds: [fusionRoundToWorkoutRound({ ...round(15, 1), kind: 'calibration' })], bodyWeightKg: 65 })
    await saveWorkout(w)
    await savePendingTemplate({ workoutId: w.id, template: { ...building, id: 'uiqa-unsaved' }, warnings: [] })
  }
  liveAt = performance.now()
}

function WorkoutFixture({ navigation, state }: { navigation: any; state: string }) {
  const [phase, setPhase] = useState<FusionPhase>(state.startsWith('save-failed') || state === 'climbing-long' ? 'climbing' : state as FusionPhase)
  const [floors, setFloors] = useState(state === 'climbing-long' ? 100 : phase === 'calibrating' ? 4 : phase === 'climbing' ? 8 : phase === 'waiting' ? 0 : 15)
  const [saveFailed, setSaveFailed] = useState(state.startsWith('save-failed'))
  const labels = { calibrating: '标定中 · 每到一层点一下', calibration_top: '标定完成', climbing: '正在向上 · 自动计层',
    descending: '下行中 · 到楼下自动开始下一轮', waiting: '在楼下准备 · 开始爬就自动计层', finished: '已结束' }
  const snapshot: FusionSnapshot = { phase, roundNumber: phase === 'waiting' ? 3 : phase === 'descending' ? 2 : 1,
    roundKind: phase === 'calibrating' || phase === 'calibration_top' ? 'calibration' : 'auto', startFloor: 1,
    currentFloor: floors + 1, roundFloors: floors, totalFloors: phase === 'waiting' || phase === 'descending' ? 30 : floors,
    completedRounds: phase === 'waiting' || phase === 'descending' ? 2 : 0, templateFloors: phase === 'calibrating' ? undefined : 15,
    elapsedMs: phase === 'waiting' ? 560000 : phase === 'descending' ? 500000 : phase === 'calibrating' ? 92000 : 192000,
    activeMs: 192000, steps: floors * 18, baro: 'ok', estimated: false, canUndo: floors > 0, canMarkTop: floors > 0,
    status: { text: labels[phase], tone: 'good' } }
  const api = { snapshot, status: saveFailed ? 'save_failed' : 'running', error: saveFailed ? '本次训练仍保留在本机，请重试保存。' : undefined,
    rounds: [round(15, 1), round(15, 2)], canSaveLater: state !== 'save-failed-no-recovery',
    markFloor: () => setFloors(f => f + 1), undoMark: () => setFloors(f => Math.max(0, f - 1)),
    markTop: () => setPhase('calibration_top'), nextRound: () => { setFloors(0); setPhase('waiting') },
    finish: async () => { setSaveFailed(false); return 'uiqa-summary' }, discard: async () => {}, retry: () => setSaveFailed(false),
  } as FusionWorkoutApi
  return <WorkoutContent navigation={navigation} session={api} />
}

export default function UiQaApp() {
  const theme = useTheme()
  const [state, setState] = useState('')
  useEffect(() => { void Linking.getInitialURL().then(async url => {
    const next = url?.split('state=')[1]?.split('&')[0] ?? 'home'
    await seed(next)
    setState(next)
  }) }, [])
  if (!state) return <View style={{ flex: 1, backgroundColor: theme.paper, justifyContent: 'center' }}><ActivityIndicator color={theme.brand} /></View>
  const target = state.startsWith('summary') || state === 'template' ? 'WorkoutResult' : state === 'share' ? 'ShareStudio'
    : state === 'onboarding' ? 'Onboarding' : state.startsWith('privacy') ? 'Privacy' : state === 'legacy' ? 'Result'
    : state === 'diagnostic' ? 'DiagnosticCapture' : ['calibrating', 'calibration_top', 'climbing', 'climbing-long', 'descending', 'waiting', 'save-failed', 'save-failed-no-recovery'].includes(state) ? 'ClimbWorkout' : 'Main'
  const targetParams = target === 'WorkoutResult' ? { id: state === 'template' ? 'uiqa-template' : 'uiqa-summary', fresh: true }
    : target === 'ShareStudio' ? { id: 'uiqa-summary' } : target === 'Result' ? { id: 'uiqa-legacy' }
    : target === 'Onboarding' ? { from: 'settings' } : undefined
  const mainScreen = state.startsWith('history') ? 'History' : state === 'settings' ? 'Profile' : 'Train'
  const mainRoute = { name: 'Main', params: { screen: mainScreen } }
  const rootOnly = state === 'privacy-first'
  return <SafeAreaProvider><NavigationContainer initialState={{ index: target === 'Main' || rootOnly ? 0 : 1,
    routes: target === 'Main' ? [mainRoute] : rootOnly ? [{ name: target, params: targetParams }] : [mainRoute, { name: target, params: targetParams }] }} theme={{ ...(theme.isDark ? DarkTheme : DefaultTheme), colors: {
    ...(theme.isDark ? DarkTheme.colors : DefaultTheme.colors), background: theme.paper, card: theme.card, text: theme.ink, primary: theme.brand } }}>
    <Stack.Navigator initialRouteName={target} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.paper } }}>
      <Stack.Screen name="Main" component={MainTabs} initialParams={{ screen: mainScreen }} />
      <Stack.Screen name="WorkoutResult" component={Summary} initialParams={{ id: state === 'template' ? 'uiqa-template' : 'uiqa-summary' }} />
      <Stack.Screen name="ShareStudio" component={ShareStudio} initialParams={{ id: 'uiqa-summary' }} />
      <Stack.Screen name="Privacy" component={Privacy} /><Stack.Screen name="Onboarding" component={Onboarding} />
      <Stack.Screen name="Result" component={Result} initialParams={{ id: 'uiqa-legacy' }} />
      <Stack.Screen name="DiagnosticCapture" component={DiagnosticCapture} />
      <Stack.Screen name="ClimbWorkout">{props => ['calibrating', 'calibration_top', 'climbing', 'climbing-long', 'descending', 'waiting', 'save-failed', 'save-failed-no-recovery'].includes(state)
        ? <WorkoutFixture navigation={props.navigation} state={state} /> : <Workout {...props} />}</Stack.Screen>
    </Stack.Navigator>
  </NavigationContainer><StatusBar style={theme.isDark ? 'light' : 'dark'} /></SafeAreaProvider>
}
