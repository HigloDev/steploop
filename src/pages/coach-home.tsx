import React, { useRef, useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { MainTabScreen } from '../navigation/types'
import { Button, Card, Pill } from '../components/ui'
import { CoachMessage, CoachPage, CoachSection, CoachText, WeightTrend, displayDate, minutesText, todayKey, useCoachData } from '../components/coach-ui'
import {
  COACH_COURSES, activeEnrollment, addDays, courseById, endDate, habitLesson, latestWeight,
  nextSession, sessionProgress, weekStart, weeklySummary, weightGoalReached,
} from '../core/coach'
import { setEnrollmentStatus } from '../services/coach-storage'
import { useTheme } from '../theme'

export default function CoachHome({ navigation }: MainTabScreen<'Coach'>) {
  const t = useTheme(), data = useCoachData(navigation)
  const [busy, setBusy] = useState(false), lock = useRef(false)
  const s = data.state, today = todayKey()
  const e = s ? activeEnrollment(s) : undefined
  const summary = s && e ? weeklySummary(s, e, today) : undefined
  const next = s && e ? nextSession(s, e, today) : undefined
  const recent = s ? latestWeight(s, today) : undefined
  const status = async (id: string, value: 'active' | 'paused' | 'completed' | 'maintaining') => {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try { data.setState(await setEnrollmentStatus(id, value, Date.now())) } catch (err) {
      data.setError(err instanceof Error ? err.message : '操作未保存，请重试。')
    } finally { lock.current = false; setBusy(false) }
  }
  return <CoachPage title="教练" back={false}>
    <CoachMessage error={data.error} loading={data.loading && !s} retry={() => void data.refresh()} />
    {s ? <>
      {e ? <>
        <View style={{ gap: 8 }}>
          <Pill>{e.status === 'maintaining' ? '维持阶段' : '正在进行'} · {courseById(e.courseId).name}</Pill>
          {e.courseId === 'weight' ? <>
            <CoachText size="value">{recent ? recent.weightKg.toFixed(1) : '—'} <CoachText tone="muted">公斤</CoachText></CoachText>
            <CoachText tone="muted">{e.goalMode === 'lose' ? '目标 ' + e.targetWeightKg + ' 公斤' : '维持在 ' + e.targetWeightKg + ' 公斤附近'} · {displayDate(endDate(e))}阶段复盘</CoachText>
            {recent ? <CoachText size="small" tone="muted">最近称重 {recent.date}，起始 {e.initialWeightKg} 公斤。体重波动很正常。</CoachText> : null}
            <WeightTrend readings={s.weighIns.filter(w => w.date >= e.startedOn && w.date <= today)} target={e.targetWeightKg} />
            <Button title="记录体重 / 查看趋势" variant="secondary" onPress={() => navigation.navigate('CoachRecords', { tab: 'weight' })} />
            {e.status !== 'maintaining' && e.goalMode === 'lose' && weightGoalReached(s, e, today) ?
              <Button title="近期均重达到目标，转入维持" disabled={busy} onPress={() => void status(e.id, 'maintaining')} /> : null}
          </> : <CoachText size="value">从今天的这一小段开始。</CoachText>}
        </View>
        <Card>
          <View style={{ gap: 12 }}>
            <CoachText size="title" accessibilityRole="header">{next?.date === today ? '今天，按自己的节奏向上' : '今天留给恢复与日常活动'}</CoachText>
            <CoachText tone="muted">{next
              ? (next.date === today ? '本次' : '下次 ' + displayDate(next.date)) + ' · 净上爬 ' + minutesText(next.targetMinutes) + ' 分钟，另含热身、返回和恢复。'
              : endDate(e) < today ? '这阶段已到复盘日期。看看记录，再调整后续计划。' : '本阶段课程已完成，保持舒适的日常活动。'}</CoachText>
            {next ? <Button title={next.date === today ? '查看并开始今日课程' : '查看下次课程'} onPress={() => navigation.navigate('CoachSession', { sessionId: next.id })} /> :
              <Button title="调整后续计划" onPress={() => navigation.navigate('CoachGoal', { courseId: e.courseId, enrollmentId: e.id })} />}
          </View>
        </Card>
        {summary ? <CoachSection title="这一周，已经走到这里">
          <CoachText size="value">{summary.completed} / {summary.planned} <CoachText tone="muted">次课程完成</CoachText></CoachText>
          <CoachText tone="muted">已记录净上爬 {minutesText(summary.minutes)} 分钟{summary.attempted > summary.completed ? '，未完成的努力也已保留' : ''}。</CoachText>
          {s.sessions.filter(v => v.enrollmentId === e.id && v.date >= weekStart(today) && v.date <= addDays(weekStart(today), 6)).map(session => {
            const progress = sessionProgress(s, session)
            return <Pressable key={session.id} accessibilityRole="button"
              accessibilityLabel={session.date + '课程，' + (progress.completed ? '已完成' : session.skipped ? '已跳过' : '查看安排')}
              onPress={() => navigation.navigate('CoachSession', { sessionId: session.id })}
              style={({ pressed }) => ({ minHeight: t.tapMin, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.lineSoft, opacity: pressed ? 0.6 : 1, gap: 4 })}>
              <CoachText>{displayDate(session.date)} · 上爬 {minutesText(session.targetMinutes)} 分钟</CoachText>
              <CoachText size="small" tone="muted">{progress.completed ? '已完成' : session.skipped ? '已跳过，不补量' : session.date < today ? '未完成，不补量' : progress.minutes > 0 ? '已练 ' + minutesText(progress.minutes) + ' 分钟，可继续' : session.date === today ? '今天的安排' : '待开始'}</CoachText>
            </Pressable>
          })}
          <Button title="做一次本周复盘" variant="secondary" onPress={() => navigation.navigate('CoachReview', { enrollmentId: e.id })} />
        </CoachSection> : null}
        {(() => { const lesson = habitLesson(e, next?.week ?? 1); return <CoachSection title={lesson.title}><CoachText tone="muted">{lesson.text}</CoachText></CoachSection> })()}
        <CoachSection title="管理计划">
          <Button title="调整目标与训练日" variant="secondary" disabled={busy} onPress={() => navigation.navigate('CoachGoal', { courseId: e.courseId, enrollmentId: e.id })} />
          <Button title="暂停课程" variant="secondary" disabled={busy} onPress={() => Alert.alert('暂停这门课程？', '已完成的训练、称重和复盘都会保留，之后可以继续。', [
            { text: '取消', style: 'cancel' }, { text: '暂停', onPress: () => void status(e.id, 'paused') },
          ])} />
          <Button title="结束这一阶段" variant="secondary" disabled={busy} onPress={() => Alert.alert('结束这一阶段？', '课程会移入已结束列表，历史记录继续保留。你仍可以开始新的阶段。', [
            { text: '取消', style: 'cancel' }, { text: '结束并保留记录', onPress: () => void status(e.id, 'completed') },
          ])} />
        </CoachSection>
      </> : <View style={{ gap: 12 }}>
        <CoachText size="value">给每一次向上，一个方向。</CoachText>
        <CoachText tone="muted">选一门适合自己的课程。教练会陪你安排训练、留下记录，再一起回顾。</CoachText>
        <Button title="设定我的体重目标" onPress={() => navigation.navigate('CoachCourse', { courseId: 'weight' })} />
      </View>}
      <CoachSection title="选择课程">
        {COACH_COURSES.map(course => <Pressable key={course.id} accessibilityRole="button" accessibilityLabel={course.name + '，' + course.duration}
          onPress={() => navigation.navigate('CoachCourse', { courseId: course.id })}
          style={({ pressed }) => ({ paddingVertical: 16, gap: 8, borderBottomWidth: 1, borderBottomColor: t.lineSoft, opacity: pressed ? 0.6 : 1 })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Feather name={course.icon} size={24} color={t.brandText} /><CoachText size="title" style={{ flex: 1 }}>{course.name}</CoachText><Feather name="chevron-right" size={20} color={t.muted} /></View>
          <CoachText tone="muted">{course.duration} · {course.description}</CoachText>
        </Pressable>)}
      </CoachSection>
      {s.enrollments.filter(v => v.status === 'paused' || v.status === 'completed').length ? <CoachSection title="我的其他阶段">
        {[...s.enrollments].filter(v => v.status === 'paused' || v.status === 'completed').reverse().map(v => <View key={v.id} style={{ gap: 8 }}>
          <CoachText>{courseById(v.courseId).name} · {v.status === 'paused' ? '已暂停' : '已结束'}</CoachText>
          <CoachText size="small" tone="muted">{v.startedOn} 开始 · 已完成 {s.sessions.filter(session => session.enrollmentId === v.id && sessionProgress(s, session).completed).length} 次课程</CoachText>
          {v.status === 'paused' ? <Button title={'继续' + courseById(v.courseId).name} variant="secondary" disabled={busy || !!e} onPress={() => void status(v.id, 'active')} /> : null}
        </View>)}
        {e ? <CoachText size="small" tone="muted">先暂停当前课程，即可继续其他阶段。</CoachText> : null}
      </CoachSection> : null}
      <Button title="全部体重、课程与复盘记录" variant="secondary" onPress={() => navigation.navigate('CoachRecords', undefined)} />
      <CoachText size="small" tone="muted">课程安排可根据感受调整。热量为估算值，体重变化不作保证。教练数据随本机备份一起保存。</CoachText>
    </> : null}
  </CoachPage>
}
