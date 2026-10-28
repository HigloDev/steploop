import React, { useEffect, useRef, useState } from 'react'
import { Alert, Pressable } from 'react-native'
import { RootStackScreen } from '../navigation/types'
import { Button } from '../components/ui'
import { CoachMessage, CoachPage, CoachSection, CoachText, displayDate, minutesText, todayKey, useCoachData } from '../components/coach-ui'
import { buildCoachWorkoutContext, courseById, habitLesson, latestWeight, sessionProgress } from '../core/coach'
import { BuildingTemplate, topFloor } from '../core/building-template'
import { getCoachState, skipCoachSession } from '../services/coach-storage'
import { getBuilding, listBuildings, loadFusionCheckpoint } from '../services/building-storage'
import { loadActiveCheckpoint } from '../services/workout-storage'
import { waitForFusionCleanup } from '../hooks/useFusionWorkout'
import { confirmBackgroundRecording } from '../services/workout-entry'
import { isPrivacyAgreed } from '../services/privacy'
import { useTheme } from '../theme'

export default function CoachSession({ navigation, route }: RootStackScreen<'CoachSession'>) {
  const t = useTheme(), data = useCoachData(navigation), today = todayKey()
  const [buildings, setBuildings] = useState<BuildingTemplate[]>([]), [selected, setSelected] = useState('')
  const [warmed, setWarmed] = useState(false), [busy, setBusy] = useState(false)
  const [buildingsReady, setBuildingsReady] = useState(false), [loadAttempt, setLoadAttempt] = useState(0), lock = useRef(false)
  const session = data.state?.sessions.find(v => v.id === route.params.sessionId)
  const e = data.state?.enrollments.find(v => v.id === session?.enrollmentId)
  const progress = data.state && session ? sessionProgress(data.state, session) : undefined
  useEffect(() => {
    let live = true
    const load = async () => {
      setBuildingsReady(false)
      try {
        const all = await listBuildings()
        if (!live) return
        setBuildings(all)
        setSelected(current => all.some(b => b.id === current) ? current : all[0]?.id ?? '')
        setBuildingsReady(true)
      } catch { if (live) data.setError('楼栋未能加载，请重试。') }
    }
    void load(); const unsubscribe = navigation.addListener('focus', () => { void load() })
    return () => { live = false; unsubscribe() }
  }, [navigation, loadAttempt])
  const start = async () => {
    if (lock.current || !warmed || !buildingsReady) return
    lock.current = true; setBusy(true); data.setError('')
    try {
      await waitForFusionCleanup()
      const [state, cp, legacyCp] = await Promise.all([getCoachState(), loadFusionCheckpoint(), loadActiveCheckpoint()])
      if (cp || legacyCp) {
        Alert.alert('还有未完成训练', '先在训练首页继续、保存或放弃上次训练，课程安排会保留。', [
          { text: '留在课程' }, { text: '去训练首页', onPress: () => navigation.navigate('Main', { screen: 'Train' }) },
        ]); return
      }
      const fresh = state.sessions.find(v => v.id === route.params.sessionId)
      if (!fresh) throw new Error('课程安排已改变，请返回教练页重新选择。')
      const { coach } = buildCoachWorkoutContext(state, fresh, Date.now())
      if (selected && !(await getBuilding(selected))) throw new Error('楼栋已被删除，请重新选择或标定新楼栋。')
      if (!(await isPrivacyAgreed())) { navigation.navigate('Privacy', { from: 'coach' }); return }
      if (!(await confirmBackgroundRecording())) return
      navigation.navigate('ClimbWorkout', {
        templateId: selected || undefined, startFloor: 1, coach,
        coachBodyWeightKg: latestWeight(state, todayKey())?.weightKg,
      })
    } catch (err) { data.setError(err instanceof Error ? err.message : '课程暂未开始，请重试。') }
    finally { lock.current = false; setBusy(false) }
  }
  const skip = async () => {
    if (!session || lock.current) return
    lock.current = true; setBusy(true)
    try { data.setState(await skipCoachSession(session.id)) } catch (err) { data.setError(err instanceof Error ? err.message : '未能保存') }
    finally { lock.current = false; setBusy(false) }
  }
  const retry = () => { void data.refresh(); setLoadAttempt(v => v + 1) }
  return <CoachPage title={e ? courseById(e.courseId).name : '课程安排'}>
    <CoachMessage error={data.error} loading={data.loading || (!buildingsReady && !data.error)} retry={retry} />
    {session && e && data.state ? <>
      <CoachText size="value">第 {session.week} 周 · {displayDate(session.date)}</CoachText>
      <CoachText size="title">有效上爬 {minutesText(session.targetMinutes)} 分钟</CoachText>
      <CoachText tone="muted">已记录 {minutesText(progress?.minutes ?? 0)} 分钟。按有步伐证据的活动时间累计，静止标定、返回、电梯和休息不计入。</CoachText>
      {progress?.completed ? <CoachText tone="accent">这次课程已完成。记得慢走缓和，再留下训练感受。</CoachText> :
        session.skipped ? <CoachText tone="muted">这次已跳过，之后按正常安排继续。</CoachText> :
          session.date < today ? <CoachText tone="muted">这次未完成，无需补练。回到教练页查看下一次安排。</CoachText> : null}
      <CoachSection title="每一步都留有余地">
        <CoachText>1. 先在平地热身约 5 分钟。{'\n'}2. 以舒适步速上爬，一步一级，不跨级。{'\n'}3. 每轮返回后建议恢复至少 2 分钟，按感受延长。{'\n'}4. 结束后在平地慢走缓和，记录这次的感受。</CoachText>
        <CoachText tone="muted">手机放好，留意脚下。呼吸难以控制或出现疼痛、胸闷、头晕、异常气短时停止运动，不必为完成数字硬撑。</CoachText>
        <CoachText tone="muted">{habitLesson(e, session.week).text}</CoachText>
      </CoachSection>
      {!progress?.completed && !session.skipped && session.date >= today ? <>
        <CoachSection title="选择楼栋">
          {[...buildings.map(b => ({ id: b.id, name: b.name, detail: `${b.startFloor}楼 → ${topFloor(b)}楼` })),
            { id: '', name: '标定新楼栋', detail: '从 1 楼开始，逐层点按标定；完成后可保存模板。' }].map(b =>
            <Pressable key={b.id || 'new'} accessibilityRole="radio" accessibilityLabel={b.name} accessibilityState={{ checked: selected === b.id }}
              disabled={busy || !buildingsReady} onPress={() => setSelected(b.id)}
              style={({ pressed }) => ({ padding: 16, minHeight: t.tapMin, borderRadius: t.radiusMd, borderWidth: 1, borderColor: selected === b.id ? t.brandBright : t.line, backgroundColor: selected === b.id ? t.brandSoft : t.card, opacity: pressed ? 0.65 : 1 })}>
              <CoachText>{selected === b.id ? '已选 · ' : ''}{b.name}</CoachText><CoachText size="small" tone="muted">{b.detail}</CoachText>
            </Pressable>)}
        </CoachSection>
        <Pressable accessibilityRole="checkbox" accessibilityLabel="我已完成平地热身" accessibilityState={{ checked: warmed }} disabled={busy}
          onPress={() => setWarmed(v => !v)} style={{ padding: 16, minHeight: t.tapMin, backgroundColor: t.card, borderRadius: t.radiusMd }}>
          <CoachText>{warmed ? '☑' : '□'} 我已完成平地热身</CoachText>
        </Pressable>
        <Button title={busy ? '正在准备…' : '开始这次课程'} disabled={busy || !warmed || !buildingsReady || session.date !== today} onPress={() => void start()} />
        <Button title="跳过这次，不补量" variant="secondary" disabled={busy} onPress={() => void skip()} />
      </> : null}
    </> : !data.loading && !data.error ? <CoachText tone="muted">这次安排不存在，请返回教练页查看最新课程。</CoachText> : null}
  </CoachPage>
}
