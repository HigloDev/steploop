import React, { useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import { ClimbWorkout } from '../core/types'
import { applyRoundCorrection } from '../core/corrections'
import { aggregateBaroWorkout } from '../core/baro-workout'
import { saveWorkout } from '../services/workout-storage'
import { getRoute, saveRoute } from '../services/storage'
import { Button, Notice } from './ui'
import { useTheme } from '../theme'

/** The only post-workout confirmation surface; all rounds editable in one place. */
export function WorkoutRoundEditor({ workout, onSaved }: { workout: ClimbWorkout; onSaved: (w: ClimbWorkout) => void }) {
  const theme = useTheme()
  const [floors, setFloors] = useState(() => workout.rounds.map(r => String(r.finalFloor)))
  const [name, setName] = useState(workout.routeSnapshot.name)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const save = async () => {
    if (busy) return
    const values = floors.map(Number)
    if (values.some((n, i) => !Number.isInteger(n) || n === 0 || n < workout.rounds[i].startFloor)) {
      setMessage('结束楼层必须是非零整数，且不低于该轮起点。'); return
    }
    setBusy(true)
    try {
      const rounds = workout.rounds.map((r, i) => applyRoundCorrection(r, { finalFloor: values[i] }, { reason: '训练结束总览修改' }))
      const updated = aggregateBaroWorkout(workout, rounds, workout.endedAt ?? Date.now(), true)
      const savedName = name.trim() || workout.routeSnapshot.name
      updated.routeSnapshot = { ...updated.routeSnapshot, name: savedName,
        locationName: workout.routeSnapshot.locationName === workout.routeSnapshot.name ? savedName : workout.routeSnapshot.locationName }
      await saveWorkout(updated)
      const route = await getRoute(workout.templateId)
      if (route && name.trim()) await saveRoute({ ...route, name: name.trim(), updatedAt: Date.now() })
      onSaved(updated); setMessage('已保存全部轮次。总览修改没有采样时刻，不会冒充高度锚点更新模板。')
    } catch (e) { setMessage(`保存失败，可重试：${String(e)}`) }
    finally { setBusy(false) }
  }
  return <View style={{ padding: 16, gap: 16, backgroundColor: theme.card, borderRadius: 16 }}>
    <Text style={{ color: theme.ink, fontSize: 20 }}>各轮楼层 · 统一核对</Text>
    {workout.rounds.map((r, i) => <View key={r.id} style={{ gap: 8 }}>
      <Text style={{ color: theme.ink }}>第 {r.roundNumber} 轮：{r.startFloor} 楼 → {r.finalFloor} 楼 · {r.floorsCompleted} 层{r.estimated ? '（估算）' : ''}</Text>
      <TextInput accessibilityLabel={`第 ${r.roundNumber} 轮实际结束楼层`} value={floors[i]} onChangeText={v => setFloors(old => old.map((x, j) => j === i ? v : x))} keyboardType="numbers-and-punctuation" style={{ color: theme.ink, borderWidth: 1, borderColor: theme.line, padding: 12 }} />
    </View>)}
    <Text style={{ color: theme.ink }}>楼名（可选，模板已自动保存）</Text>
    <TextInput accessibilityLabel="楼名" value={name} maxLength={40} onChangeText={setName} style={{ color: theme.ink, borderWidth: 1, borderColor: theme.line, padding: 12 }} />
    {!!message && <Notice>{message}</Notice>}
    <Button title="保存修改" onPress={() => { void save() }} loading={busy} disabled={busy} />
  </View>
}
