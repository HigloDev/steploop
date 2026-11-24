import React, { useEffect, useRef, useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import { RootStackScreen } from '../navigation/types'
import { Button, Pill } from '../components/ui'
import { UIIcon } from '../components/ui-icon'
import { CoachMessage, CoachPage, CoachSection, CoachText, displayDate, minutesText, todayKey, useCoachData } from '../components/coach-ui'
import { buildCoachWorkoutContext, courseById, habitLesson, latestWeight, sessionProgress } from '../core/coach'
import { BuildingTemplate, topFloor } from '../core/building-template'
import { getCoachState, skipCoachSession } from '../services/coach-storage'
import { getBuilding, listBuildings, loadFusionCheckpoint } from '../services/building-storage'
import { loadActiveCheckpoint } from '../services/workout-storage'
import { waitForFusionCleanup } from '../hooks/useFusionWorkout'
import { confirmBackgroundRecording } from '../services/workout-entry'
import { isPrivacyAgreed } from '../services/privacy'
import { sport, useTheme } from '../theme'
import { getGlassSurfaceStyle } from '../components/glass-material'

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

  const completedRatio = session && progress ? Math.min(1, Math.max(0, progress.minutes / Math.max(0.5, session.targetMinutes))) : 0
  const isToday = session?.date === today
  const isFuture = !!session && session.date > today

  return <CoachPage title={e ? courseById(e.courseId).name : '课程安排'}>
    <CoachMessage error={data.error} loading={data.loading || (!buildingsReady && !data.error)} retry={retry} />
    {session && e && data.state ? <>
      {/* 课次摘要 Hero 玻璃卡 + 目标进度条 */}
      <View style={[getGlassSurfaceStyle(t, 'feature'), { padding: 18, gap: 10 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <CoachText size="small" style={{ fontWeight: '600' }}>第 {session.week} 周 · {displayDate(session.date)}</CoachText>
          <Pill tone={progress?.completed ? 'good' : isToday ? 'default' : 'warn'}>
            {progress?.completed ? '已完成' : session.skipped ? '已跳过' : isToday ? '今日课次' : isFuture ? '即将开始' : '未完成'}
          </Pill>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <CoachText size="metric">{minutesText(progress?.minutes ?? 0)} / {minutesText(session.targetMinutes)}</CoachText>
            <CoachText size="small" tone="muted">分钟净上爬</CoachText>
          </View>
          <CoachText size="caption" tone="muted">另含热身与恢复</CoachText>
        </View>
        <View style={{ height: 8, borderRadius: 999, backgroundColor: t.surfaceSoft, overflow: 'hidden' }}>
          <View style={{ height: '100%', width: `${Math.max(progress?.minutes ? 8 : 0, Math.round(completedRatio * 100))}%`, borderRadius: 999, backgroundColor: progress?.completed ? t.success : t.brand }} />
        </View>
        <CoachText size="caption" tone="muted">
          按有步伐证据的活动时间累计，静止标定、返回、电梯和休息不计入。
        </CoachText>
        {progress?.completed ? <CoachText size="small" tone="good">这次课程已完成。记得慢走缓和，再留下训练感受。</CoachText> :
          session.skipped ? <CoachText size="small" tone="muted">这次已跳过，之后按正常安排继续。</CoachText> :
            session.date < today ? <CoachText size="small" tone="muted">这次未完成，无需补练。回到教练页查看下一次安排。</CoachText> : null}
      </View>

      <CoachSection card title="每一步都留有余地">
        <CoachText size="small">1. 先在平地热身约 5 分钟。{'\n'}2. 以舒适步速上爬，一步一级，不跨级。{'\n'}3. 每轮返回后建议恢复至少 2 分钟，按感受延长。{'\n'}4. 结束后在平地慢走缓和，记录这次的感受。</CoachText>
        <CoachText size="small" tone="muted">手机放好，留意脚下。呼吸难以控制或出现疼痛、胸闷、头晕、异常气短时停止运动，不必为完成数字硬撑。</CoachText>
        <CoachText size="small" tone="muted">{habitLesson(e, session.week).text}</CoachText>
      </CoachSection>

      {!progress?.completed && !session.skipped && isToday ? <>
        {/* 浅底单选行，杜绝玻璃套玻璃 */}
        <CoachSection card title="选择训练楼栋" meta={buildings.length ? `${buildings.length} 栋可用` : '首次标定'}>
          {[...buildings.map(b => ({ id: b.id, name: b.name, detail: `${b.startFloor}楼 → ${topFloor(b)}楼 · 自动计层` })),
            { id: '', name: '标定新楼栋', detail: '从 1 楼开始，逐层点按标定；完成后可保存模板。' }].map(b => {
            const isSelected = selected === b.id
            return (
              <Pressable
                key={b.id || 'new'}
                accessibilityRole="radio"
                accessibilityLabel={b.name}
                accessibilityState={{ checked: isSelected }}
                disabled={busy || !buildingsReady}
                onPress={() => setSelected(b.id)}
                style={({ pressed }) => ({
                  padding: 13,
                  minHeight: t.tapMin,
                  borderRadius: t.radiusMd,
                  borderWidth: 1.5,
                  borderColor: isSelected ? t.brandText : 'transparent',
                  backgroundColor: isSelected ? t.brandSoft : t.surfaceSoft,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  opacity: pressed ? sport.opacity.pressed : 1,
                })}
              >
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <CoachText style={isSelected ? { color: t.brandText, fontWeight: '700' } : { fontWeight: '600' }}>{b.name}</CoachText>
                  <CoachText size="caption" tone="muted">{b.detail}</CoachText>
                </View>
                <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: isSelected ? t.brandText : t.line, alignItems: 'center', justifyContent: 'center' }}>
                  {isSelected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.brandText }} /> : null}
                </View>
              </Pressable>
            )
          })}
        </CoachSection>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel="我已完成平地热身"
          accessibilityState={{ checked: warmed }}
          disabled={busy}
          onPress={() => setWarmed(v => !v)}
          style={({ pressed }) => [
            getGlassSurfaceStyle(t, 'card'),
            { padding: 16, minHeight: t.tapMin, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? sport.opacity.pressed : 1 },
          ]}
        >
          <UIIcon name={warmed ? 'checkbox-checked' : 'checkbox'} size={23} color={warmed ? t.brandText : t.mutedStrong} />
          <View style={{ flex: 1 }}>
            <CoachText style={{ fontWeight: '600' }}>我已完成平地热身</CoachText>
            <CoachText size="caption" tone="muted">一步一级，出现不适随时停止</CoachText>
          </View>
        </Pressable>

        <Button title={busy ? '正在准备…' : '开始这次课程'} disabled={busy || !warmed || !buildingsReady} onPress={() => void start()} />
        {!busy && (!buildingsReady || !warmed) ? (
          <CoachText size="small" tone="muted" style={{ textAlign: 'center' }}>
            {!buildingsReady ? '正在加载楼栋列表…' : '请先勾选上方「我已完成平地热身」后再开始。'}
          </CoachText>
        ) : null}
        <Button title="跳过这次，不补量" variant="secondary" disabled={busy} onPress={() => void skip()} />
      </> : !progress?.completed && !session.skipped && isFuture ? (
        <CoachSection card title="课次预告">
          <CoachText size="small" tone="muted">
            该课次安排在 {displayDate(session.date)}，当天打开此页面即可完成热身确认并开始训练。
          </CoachText>
          <Button title="跳过这次，不补量" variant="secondary" disabled={busy} onPress={() => void skip()} />
        </CoachSection>
      ) : null}
    </> : !data.loading && !data.error ? <CoachText tone="muted">这次安排不存在，请返回教练页查看最新课程。</CoachText> : null}
  </CoachPage>
}
