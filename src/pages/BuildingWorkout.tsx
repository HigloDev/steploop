import React, { useEffect, useRef, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { RootStackScreen } from '../navigation/types'
import { Header } from '../components/Header'
import { Button, Notice } from '../components/ui'
import { useTheme } from '../theme'
import { getRoute } from '../services/storage'
import { RouteTemplate } from '../core/types'
import { advanceFloor } from '../core/floors'
import { formatDuration } from '../core/math'
import { useBuildingWorkout } from '../hooks/useBuildingWorkout'
import { isBackgroundTrainingSupported } from '../services/background-training'

export default function BuildingWorkoutScreen(props: RootStackScreen<'ClimbWorkout'>) {
  const [template, setTemplate] = useState<RouteTemplate>()
  const [error, setError] = useState('')
  const theme = useTheme()
  useEffect(() => {
    let active = true
    void getRoute(props.route.params.id).then(t => { if (active) { setTemplate(t); if (!t) setError('模板不存在') } }).catch(e => setError(String(e)))
    return () => { active = false }
  }, [props.route.params.id])
  if (!template) return <View style={{ flex: 1, backgroundColor: theme.paper }}><Header title="开始爬楼" back /><Text>{error || '正在读取模板…'}</Text></View>
  return <Training {...props} template={template} />
}

function Training({ navigation, template }: RootStackScreen<'ClimbWorkout'> & { template: RouteTemplate }) {
  const theme = useTheme()
  const training = useBuildingWorkout(template)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [floor, setFloor] = useState('')
  const [correcting, setCorrecting] = useState(false)
  const finishSaved = useRef(false)
  const state = training.snapshot
  useEffect(() => {
    void activateKeepAwakeAsync('baro-workout').catch(() => undefined)
    return () => { void deactivateKeepAwake('baro-workout').catch(() => undefined) }
  }, [])
  useEffect(() => navigation.addListener('beforeRemove', event => {
    if (training.ready && !finishSaved.current && training.workout?.status !== 'completed') {
      event.preventDefault(); setError('请先点“结束训练”，保存本次各轮成绩。')
    }
  }), [navigation, training.ready, training.workout?.status])
  const finish = async () => {
    if (busy) return
    setBusy(true)
    try { const w = await training.finish(); finishSaved.current = true; navigation.replace('WorkoutResult', { id: w.id }) }
    catch (e) { setError(String(e)) }
    finally { setBusy(false) }
  }
  return <View style={{ flex: 1, backgroundColor: theme.paper }}>
    <Header title={state?.calibration ? '第一轮 · 逐层标定' : '自动爬楼'} back={!training.ready} />
    <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: theme.ink, fontSize: 20 }}>{template.name}</Text>
      {training.checking && <Text style={{ color: theme.ink }}>正在自检气压计、加速度计和陀螺仪，请将手机放稳…</Text>}
      {!isBackgroundTrainingSupported() && <Notice tone="warn">当前版本请保持前台和屏幕点亮；锁屏可能造成后台缺段，可在训练结束后统一修改楼层。</Notice>}
      {(training.error || error) && <Notice tone="danger">{error || training.error}</Notice>}
      {!training.checking && !training.ready && <Button title="重新自检" onPress={training.retry} />}
      {state && <>
        <Text accessibilityLiveRegion="polite" style={{ color: theme.ink, fontSize: 56, fontWeight: '700' }}>{state.currentFloor} 楼</Text>
        <Text style={{ color: theme.mutedStrong }}>{state.phase === 'ready' ? '站稳后开始上爬，系统会自动开始本轮。' : state.phase === 'returning' ? '本轮已记录，返回楼下后继续爬即可。' : state.calibration ? '每到一层点一次；到顶直接坐电梯下楼。' : '自动计层与播报；到顶直接下楼，自动切轮。'}</Text>
        <Text style={{ color: theme.ink }}>已完成 {training.workout?.rounds.length ?? 0} 轮 · 累计 {training.workout?.totalFloorsCompleted ?? 0} 层</Text>
        <Text style={{ color: theme.ink }}>本轮 {state.floors} 层 · {formatDuration(state.activeMs)}</Text>
        {state.stale && <Notice tone="warn">气压超过 2 秒未更新：当前用步数与拐弯估算，无法确认电梯下行；恢复后继续自动识别。</Notice>}
        {state.estimated && <Notice tone="warn">本轮含估算，结束训练后可统一修改。</Notice>}
        {state.warnings.map(w => <Notice key={w} tone="warn">{w}</Notice>)}
        {state.phase === 'climbing' && <>
          <Button title={`到了 ${advanceFloor(state.currentFloor)} 楼`} onPress={() => training.mark()} style={{ minHeight: 96 }} />
          {state.calibration ? <Button title="撤销" variant="secondary" onPress={training.undo} /> : <>
            <Button title="纠正当前楼层" variant="secondary" onPress={() => { setFloor(String(state.currentFloor)); setCorrecting(!correcting) }} />
            {correcting && <>
              <TextInput accessibilityLabel="实际当前楼层" value={floor} onChangeText={setFloor} keyboardType="numbers-and-punctuation" style={{ color: theme.ink, borderWidth: 1, borderColor: theme.line, padding: 16 }} />
              <Button title="应用到本轮" onPress={() => { const n = Number(floor); if (!Number.isInteger(n) || n === 0 || n < template.startFloor) { setError('请输入不低于起点的非零整数楼层'); return }; training.mark(n); setCorrecting(false); setError('') }} />
            </>}
          </>}
        </>}
        <Button title="结束训练" loading={busy} disabled={busy} onPress={() => { void finish() }} />
      </>}
    </ScrollView>
  </View>
}
