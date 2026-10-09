import React, { useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'
import { RootStackScreen } from '../navigation/types'
import { Header } from '../components/Header'
import { Button, Notice } from '../components/ui'
import { useTheme } from '../theme'
import { saveRoute } from '../services/storage'
import { loadActiveCheckpoint } from '../services/workout-storage'
import { uid } from '../core/math'
import { RouteTemplate } from '../core/types'

export default function QuickStartScreen({ navigation }: RootStackScreen<'QuickStart'>) {
  const theme = useTheme()
  const [floor, setFloor] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const start = async () => {
    const startFloor = Number(floor)
    if (!Number.isInteger(startFloor) || startFloor === 0) { setError('请输入非零整数楼层，例如 -2、-1、1。'); return }
    if (busy) return
    setBusy(true)
    try {
      if (await loadActiveCheckpoint()) throw new Error('请先在首页处理未完成训练。')
      const now = Date.now()
      const route: RouteTemplate = { id: uid('building'), name: `楼宇 ${new Date(now).toLocaleDateString()}`,
        startFloor, endFloor: startFloor, carryMode: 'pocket', floorHeightM: 3, totalAscentM: 0,
        device: { platform: 'unknown', model: '', system: '' }, segments: [], markers: [],
        createdAt: now, updatedAt: now, version: 1, status: 'draft', recognitionVersion: 'baro-v1' }
      await saveRoute(route)
      navigation.replace('ClimbWorkout', { id: route.id, goal: { type: 'open' }, returnConfirmationMode: 'assisted', trackingMode: 'full_auto' })
    } catch (e) { setError(String(e)) }
    finally { setBusy(false) }
  }
  return <View style={{ flex: 1, backgroundColor: theme.paper }}>
    <Header title="开始爬楼" back />
    <ScrollView contentContainerStyle={{ padding: 24, gap: 24 }} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 28, color: theme.ink }}>从几楼出发？</Text>
      <TextInput accessibilityLabel="起点楼层" value={floor} onChangeText={setFloor} keyboardType="numbers-and-punctuation" style={{ color: theme.ink, borderWidth: 1, borderColor: theme.line, padding: 20, fontSize: 32 }} />
      <Text style={{ color: theme.mutedStrong }}>支持地下楼层，编号跳过 0。第一轮每到一层点一次；以后自动计层。开始前会自检必需传感器。</Text>
      {!!error && <Notice tone="danger">{error}</Notice>}
      <Button title="开始爬楼" loading={busy} disabled={busy} onPress={() => { void start() }} />
    </ScrollView>
  </View>
}
