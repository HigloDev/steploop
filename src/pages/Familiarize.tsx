import React, { useEffect, useRef, useState } from 'react'
import { Alert, AppState, Platform, ScrollView, Text, View } from 'react-native'
import { usePreventRemove } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { Header } from '../components/Header'
import { Button, Card, Field } from '../components/ui'
import { NativeChoice } from '../components/native-choice'
import { FlowReveal } from '../components/flow-motion'
import { Disclosure } from '../components/disclosure'
import { RootStackScreen } from '../navigation/types'
import { useTheme } from '../theme'
import { FeatureFrame, ManualMark, RouteTemplate } from '../core/types'
import { appendPreparationRun, assessPreparationRun, isRoutePrepared, nextPreparationStep, PREPARATION_LABELS, PreparationRun, PreparationStep } from '../core/route-preparation'
import { MotionFrameStream } from '../core/motion-signal'
import { RouteRecognizer } from '../core/recognizer'
import { uid } from '../core/math'
import { getRoute, saveRoute } from '../services/storage'
import { SensorRecorder } from '../services/sensor'
import { PreparationRecording, pendingPreparationRecording, acknowledgePreparationRecording } from '../services/preparation-recording'
import { preparationDeviceKey } from '../services/preparation-device'
import { loadActiveCheckpoint } from '../services/workout-storage'
import { triggerHaptic } from '../services/preferences'

type Capture = { id: string; step: PreparationStep; template: RouteTemplate; recorder: SensorRecorder; stream: MotionFrameStream;
  recognizer: RouteRecognizer; journal: PreparationRecording; origin?: number; latestAt: number; frames: FeatureFrame[];
  pressures: Array<{ atMs: number; pressure: number }>; marks: ManualMark[]; interrupted: boolean; maxFloor: number; run?: PreparationRun }

export default function FamiliarizeScreen({ navigation, route }: RootStackScreen<'Familiarize'>) {
  const theme = useTheme(), insets = useSafeAreaInsets()
  const [template, setTemplate] = useState<RouteTemplate>()
  const [name, setName] = useState(''), [startFloor, setStartFloor] = useState('1'), [endFloor, setEndFloor] = useState('15')
  const [carry, setCarry] = useState<'pocket' | 'waist'>('pocket'), [elevator, setElevator] = useState<'present' | 'absent'>('present')
  const [busy, setBusy] = useState(false), [running, setRunning] = useState(false), [pending, setPending] = useState(false)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [floor, setFloor] = useState(1), [seconds, setSeconds] = useState(0)
  const [recovery, setRecovery] = useState<PreparationRun>()
  const [loading, setLoading] = useState(true)
  const capture = useRef<Capture | undefined>(undefined), lock = useRef(false), alive = useRef(true)
  useEffect(() => {
    alive.current = true
    void getRoute(route.params.id).then(async r => {
      if (!alive.current) return
      if (!r) throw new Error('这条路线不存在。')
      setTemplate(r); setName(r.name); setStartFloor(String(r.startFloor)); setEndFloor(String(r.endFloor > r.startFloor ? r.endFloor : r.startFloor + 1)); setCarry(r.carryMode); setFloor(r.startFloor)
      const previous = await pendingPreparationRecording(r)
      if (!alive.current) return
      if (previous.run) { setRecovery(previous.run); setPending(true); setMessage('上次已经结束的这一段还在，点一下继续保存。') }
      else if (previous.interrupted) setMessage('上次中途离开的原记录还在。已完成的步骤不用重做，这一段请从头再走。')
    }).catch(e => { if (alive.current) setError(e.message) }).finally(() => { if (alive.current) setLoading(false) })
    return () => { alive.current = false; void capture.current?.recorder.stop(); try { capture.current?.journal.flush() } catch {} void deactivateKeepAwake('familiarize') }
  }, [route.params.id])
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => { if (state !== 'active' && capture.current && !capture.current.run) { capture.current.interrupted = true; setError('刚才离开了页面，这一段会保留，但需要重新走。') } })
    return () => sub.remove()
  }, [])
  useEffect(() => {
    if (!running) return
    void activateKeepAwakeAsync('familiarize').catch(() => setError('请暂时保持屏幕亮着。'))
    const timer = setInterval(() => {
      const c = capture.current
      if (!c) return
      setSeconds(Math.floor(c.latestAt / 1000))
      if (c.latestAt >= 60 * 60 * 1000) { c.interrupted = true; void finish() }
    }, 1000)
    return () => { clearInterval(timer); void deactivateKeepAwake('familiarize') }
  }, [running])
  usePreventRemove(running || pending || busy, () => {
    Alert.alert('这一段还没收好', '请先点“结束并保存这一段”，保存后就可以离开。已经完成的步骤会保留。', [{ text: '继续' }])
  })
  const guard = async (action: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : '没有保存成功，请重试。') }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  const configure = () => guard(async () => {
    if (!template) return
    const from = Number(startFloor), to = Number(endFloor)
    if (!name.trim() || name.trim().length > 200 || !Number.isInteger(from) || !Number.isInteger(to) || from < -20 || to > 200 || to <= from || to - from > 150) throw new Error('请填好名称、起点和终点，终点应在起点楼上。')
    const now = Date.now()
    const next: RouteTemplate = { ...template, name: name.trim(), startFloor: from, endFloor: to, carryMode: carry, updatedAt: now,
      preparation: { version: 1, runs: [], elevator, deviceKey: await preparationDeviceKey(), referenceRevision: now }, status: 'needs_validation' }
    await saveRoute(next); setTemplate(next); setFloor(from)
  })
  const start = () => guard(async () => {
    if (!template || capture.current || loading) return
    if (await loadActiveCheckpoint()) throw new Error('还有一次锻炼没结束，请先回首页保存或继续那次锻炼。')
    const step = nextPreparationStep(template)
    if (!step) return
    const id = uid('route-run'), journal = new PreparationRecording(id, template), recognizer = new RouteRecognizer(template)
    const c = { id, step, template, journal, recognizer, frames: [], pressures: [], marks: [], interrupted: false, maxFloor: template.startFloor, latestAt: 0 } as unknown as Capture
    c.stream = new MotionFrameStream(frame => { c.frames.push(frame); const result = recognizer.pushFrame(frame); c.maxFloor = Math.max(c.maxFloor, result.currentFloor) })
    c.recorder = new SensorRecorder({ retainSamples: false,
      onSample: sample => {
        if (c.run) return
        if (c.origin === undefined) c.origin = sample.t
        c.latestAt = sample.t - c.origin
        try { journal.sample(sample) } catch { c.interrupted = true; setError('手机没有存下完整记录，请结束这一段后重试。') }
        if (sample.pressure !== undefined && (c.pressures.length === 0 || c.latestAt - c.pressures[c.pressures.length - 1].atMs >= 200)) {
          c.pressures.push({ atMs: c.latestAt, pressure: sample.pressure }); recognizer.pushBarometer(sample.pressure, c.latestAt)
        }
        c.stream.push(sample)
      }, onGap: () => { c.interrupted = true }, onStatus: status => { if (status.signal === 'interrupted') c.interrupted = true } })
    capture.current = c; setMessage(''); setFloor(template.startFloor); setSeconds(0)
    try { await c.recorder.start(); setRunning(true) } catch { await c.recorder.stop(); capture.current = undefined; throw new Error('手机没有开始记录。请保持页面打开，检查运动权限后再试。') }
  })
  const markFloor = () => {
    const c = capture.current
    if (!c || !running || lock.current || c.marks.length >= c.template.endFloor - c.template.startFloor) return
    const previousAt = c.marks.at(-1)?.atMs ?? 0
    if (c.latestAt - previousAt < 3000) { setError('先走到下一层，再看楼号点一下。'); return }
    const actual = c.template.startFloor + c.marks.length + 1
    const mark: ManualMark = { id: uid('floor'), type: 'floor', floor: actual, atMs: c.latestAt, estimatedFloor: c.recognizer.snapshot().currentFloor }
    try { c.journal.event({ type: 'floor', mark }); c.marks.push(mark); setFloor(actual); setError(''); void triggerHaptic('light').catch(() => undefined) } catch { c.interrupted = true; setError('这一层没有保存成功，请结束这一段后重试。') }
  }
  const saveCapture = async (c: Capture) => {
    const current = await getRoute(c.template.id)
    if (!current || current.preparation?.referenceRevision !== c.template.preparation?.referenceRevision) throw new Error('路线刚刚有变化，请保留这一段后重新打开。')
    c.journal.finish(c.run!)
    const next = appendPreparationRun(current, c.run!)
    await saveRoute(next)
    await acknowledgePreparationRecording(current.id, c.run!.id)
    setTemplate(next); setMessage(c.run!.message); setPending(false); capture.current = undefined
  }
  const finish = (actualEnd?: number) => guard(async () => {
    if (recovery && template) {
      const current = await getRoute(template.id)
      if (!current) throw new Error('路线不存在，原记录仍然保留。')
      const next = appendPreparationRun(current, recovery)
      await saveRoute(next)
      await acknowledgePreparationRecording(current.id, recovery.id)
      setTemplate(next); setMessage(recovery.message); setRecovery(undefined); setPending(false)
      return
    }
    const c = capture.current
    if (!c) return
    setPending(true)
    if (!c.run) {
      await c.recorder.stop(); c.stream.flush(); setRunning(false)
      const climb = c.step.startsWith('teach') || c.step.startsWith('check')
      const defaultActual = climb ? c.template.startFloor + c.marks.length : c.step === 'elevator_up' ? c.template.endFloor : c.template.startFloor
      c.run = assessPreparationRun(c.template, { id: c.id, step: c.step, endedAt: Date.now(), durationMs: c.latestAt,
        frames: c.frames, pressures: c.pressures, marks: c.marks, interrupted: c.interrupted,
        actualEndFloor: actualEnd ?? defaultActual, estimatedEndFloor: c.recognizer.snapshot().currentFloor, maxEstimatedFloor: c.maxFloor })
    }
    await saveCapture(c)
  })
  const finishWithConfirmation = () => {
    const c = capture.current
    if (!c) return
    if (c.step === 'check_end' || c.step.startsWith('elevator')) {
      const target = c.step === 'elevator_down' ? c.template.startFloor : c.template.endFloor
      Alert.alert(`你现在到了 ${target} 楼吗？`, '请看一下楼号。这次以你看到的楼号核对。', [{ text: '还没到', style: 'cancel' }, { text: `确认在 ${target} 楼`, onPress: () => void finish(target) }])
    } else void finish()
  }
  const step = template ? nextPreparationStep(template) : undefined
  const teaching = step?.startsWith('teach'), perFloor = teaching || step === 'check_floors'
  const ready = template && isRoutePrepared(template)
  const hint = step === 'check_end' ? '这遍正常爬到终点，中途不用点楼层。到达后看楼号，再结束。' : step === 'check_floors' ? '每到一层点一下实际楼号。你点的答案只作核对，不会帮助手机认楼层。'
    : step?.startsWith('elevator') ? `请在 ${step === 'elevator_down' ? template?.endFloor : template?.startFloor} 楼电梯口开始，坐到 ${step === 'elevator_down' ? template?.startFloor : template?.endFloor} 楼。包括等电梯在内至少记录 20 秒。`
    : step === 'walk' ? `请回到 ${template?.startFloor} 楼，在平地正常走至少 20 秒，不要上楼。` : step === 'rest' ? `请在 ${template?.startFloor} 楼站着休息至少 20 秒，手机保持平常的放置方式。`
    : `请先到 ${template?.startFloor} 楼。每上一层，拿出手机看清楼号点一下，再放回原处。`
  const body = { color: theme.mutedStrong, fontSize: 15, lineHeight: 24 }
  return <View style={{ flex: 1, backgroundColor: theme.paper }}>
    <Header title="熟悉路线" back={!running && !pending && !busy} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: theme.pagePaddingH, gap: 18, paddingBottom: insets.bottom + 24 }}>
      {!template ? <Text style={body}>{error || '正在打开路线…'}</Text> : !template.preparation ? <>
        <Text style={{ color: theme.ink, fontSize: 26, fontWeight: '700' }}>先认准这段楼梯</Text>
        <Field label="地点和楼梯名称" value={name} onChangeText={setName} placeholder="楼名 · 东侧楼梯" />
        <Field label="从几楼开始" value={startFloor} onChangeText={setStartFloor} keyboardType="numeric" />
        <Field label="到几楼结束" value={endFloor} onChangeText={setEndFloor} keyboardType="numeric" />
        <Text style={body}>手机放在哪里</Text><NativeChoice value={carry} onChange={setCarry} options={[{ value: 'pocket', label: '口袋' }, { value: 'waist', label: '贴身腰包' }]} />
        <Text style={body}>这段楼能坐电梯往返吗</Text><NativeChoice value={elevator} onChange={setElevator} options={[{ value: 'present', label: '能' }, { value: 'absent', label: '没有电梯' }]} />
        <Text style={body}>先逐层走两遍，再检查逐层和正常爬楼是否认对；最后看看电梯、平地和休息会不会被误算。不必一次做完，每步做完都会保存。</Text>
        <Button title="记好了，开始熟悉" disabled={loading} loading={busy} onPress={() => void configure()} />
      </> : <>
        <Text style={{ color: theme.ink, fontSize: 18, fontWeight: '600' }}>{template.name}</Text>
        <FlowReveal changeKey={ready ? 'ready' : step ?? 'loading'} style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={{ color: theme.ink, fontSize: 28, lineHeight: 36, fontWeight: '700' }}>{ready ? '这条路线准备好了' : step ? PREPARATION_LABELS[step] : '正在读取'}</Text>
          <Text style={body}>{ready ? '用这部手机、按这次的放置方式，已经逐项检查过。换手机或换楼梯时，需要再检查。' : hint}</Text>
        </FlowReveal>
        {message ? <Card><Text accessibilityLiveRegion="polite" style={body}>{message}</Text></Card> : null}
        {running ? <Card>
          <Text style={body}>正在记录 · {Math.floor(seconds / 60)} 分 {seconds % 60} 秒</Text>
          {perFloor ? <FlowReveal changeKey={floor}><Text style={{ color: theme.brand, fontSize: 56, fontWeight: '700', paddingVertical: 16 }}>{floor} <Text style={{ fontSize: 20 }}>楼已记下</Text></Text></FlowReveal> : null}
          {perFloor && floor < template.endFloor ? <Button title={`我到了 ${floor + 1} 楼`} disabled={busy} onPress={markFloor} /> : null}
          {perFloor && floor > template.startFloor ? <Button title="刚才点错了，撤回一层" variant="secondary" disabled={busy} onPress={() => {
            const c = capture.current
            if (!c || lock.current) return
            try { c.journal.event({ type: 'undo_floor', markId: c.marks.at(-1)?.id }); c.marks.pop(); setFloor(template.startFloor + c.marks.length) }
            catch { c.interrupted = true; setError('撤回没有存好，请结束这一段后重试。') }
          }} /> : null}
          <Text style={body}>先停稳再点。保持页面打开，暂时不要锁屏。</Text>
        </Card> : null}
        {ready ? <Button title="回首页，开始锻炼" onPress={() => navigation.navigate('Main', { screen: 'Train' })} />
          : pending && !running ? <Button title="重新保存这一段" loading={busy} onPress={() => void finish()} />
          : running ? <Button title="结束并保存这一段" variant={perFloor && floor < template.endFloor ? 'secondary' : 'primary'} loading={busy} onPress={finishWithConfirmation} />
          : <Button title={step?.startsWith('elevator') ? '已到电梯口，开始记录' : step === 'walk' || step === 'rest' ? '我已准备好，开始记录' : `我在 ${template.startFloor} 楼，开始这一遍`} disabled={loading} loading={busy} onPress={() => void start()} />}
        {running && (step === 'check_end' || step?.startsWith('elevator')) ? <Button title="中途停止，保留记录" variant="secondary" disabled={busy} onPress={() => { if (capture.current) capture.current.interrupted = true; void finish() }} /> : null}
        {!running && !pending ? <Disclosure title="已经做了哪些步骤"><Text style={body}>{Array.from(new Set(template.preparation.runs.filter(r => r.passed).map(r => PREPARATION_LABELS[r.step]))).join('\n') || '还没有完成第一步。'}</Text><Text style={body}>最少两遍熟悉、两遍检查只是起步安排；没有认对就不会显示准备好了。中途离开时，已完成的步骤会保留，未完成的这一段需要重新走。</Text></Disclosure> : null}
      </>}
      {error ? <Text accessibilityRole="alert" style={{ ...body, color: theme.redInk }}>{error}</Text> : null}
    </ScrollView>
  </View>
}
