import React, { useCallback, useEffect, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { MainTabScreen } from '../navigation/types'
import { Header } from '../components/Header'
import { Button, Notice } from '../components/ui'
import { useTheme } from '../theme'
import { listRoutes } from '../services/storage'
import { loadActiveCheckpoint, listWorkouts } from '../services/workout-storage'
import { deriveTrainingProgress } from '../core/training-progress'
import { saveCheckpointAsCompleted } from '../services/checkpoint-completion'
import { ActiveWorkoutCheckpoint, RouteTemplate } from '../core/types'
import { buildingFromRoute } from '../core/building-model'

export default function TrainHomeScreen({ navigation }: MainTabScreen<'Train'>) {
  const theme = useTheme()
  const [routes, setRoutes] = useState<RouteTemplate[]>([])
  const [checkpoint, setCheckpoint] = useState<ActiveWorkoutCheckpoint | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState({ floors: 0, validWorkouts: 0 })
  const refresh = useCallback(() => {
    void Promise.all([listRoutes(), loadActiveCheckpoint(), listWorkouts()]).then(([r, cp, workouts]) => { setRoutes(r); setCheckpoint(cp); setProgress(deriveTrainingProgress(workouts)) }).catch(e => setError(String(e)))
  }, [])
  useEffect(() => { refresh(); return navigation.addListener('focus', refresh) }, [navigation, refresh])
  const open = (id: string) => navigation.navigate('ClimbWorkout', { id, goal: { type: 'open' }, returnConfirmationMode: 'assisted', trackingMode: 'full_auto' })
  const roundsDone = checkpoint?.completedRounds.length ?? 0
  const floorsDone = checkpoint?.completedRounds.reduce((sum, r) => sum + r.floorsCompleted, 0) ?? 0
  return <View style={{ flex: 1, backgroundColor: theme.paper }}><Header title="爬楼训练" back={false} large />
    <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
      {!!error && <Notice tone="danger">{error}</Notice>}
      {checkpoint ? <>
        <Text accessible accessibilityLiveRegion="polite" accessibilityLabel={`已完成 ${roundsDone} 轮，已爬 ${floorsDone} 层`} style={{ color: theme.ink }}>有未完成训练，已保存 {roundsDone} 轮、{floorsDone} 层。恢复后从下一轮重新开始。</Text>
        {checkpoint.recognitionVersion === 'baro-v1' && <Button title="继续训练" onPress={() => open(checkpoint.templateId)} />}
        <Button title="结束并查看已保存轮次" variant="secondary" onPress={() => { void saveCheckpointAsCompleted(checkpoint).then(w => { refresh(); if (w) navigation.navigate('WorkoutResult', { id: w.id }) }).catch(e => setError(String(e))) }} />
      </> : <Button title="开始爬楼" onPress={() => navigation.navigate('QuickStart')} />}
      <Text style={{ color: theme.mutedStrong }}>到陌生楼宇直接开始。第一轮逐层点击标定，电梯下行自动结束；以后自动开始、计层和播报。</Text>
      <Text accessible accessibilityLabel={`本周有效训练：爬升 ${progress.floors} 层，${progress.validWorkouts} 次`} style={{ color: theme.ink }}>本周 {progress.floors} 层 · {progress.validWorkouts} 次</Text>
      <Text accessibilityRole="header" style={{ color: theme.ink, fontSize: 20 }}>已保存的楼宇模板</Text>
      {routes.map(r => <View key={r.id} style={{ gap: 8, padding: 16, backgroundColor: theme.card, borderRadius: 12 }}>
        <Text style={{ color: theme.ink, fontSize: 18 }}>{r.name}</Text>
        <Text style={{ color: theme.mutedStrong }}>{r.startFloor} 楼出发 · {buildingFromRoute(r) ? '可直接自动训练' : '下次需逐层标定'}</Text>
        <Button title="使用此模板" disabled={!!checkpoint} onPress={() => open(r.id)} />
        <Button title="楼名与地点" variant="secondary" onPress={() => navigation.navigate('RouteProfile', { id: r.id })} />
      </View>)}
    </ScrollView>
  </View>
}
