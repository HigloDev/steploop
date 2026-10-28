import React, { useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { RootStackScreen } from '../navigation/types'
import { Button, Field } from '../components/ui'
import { NativeChoice } from '../components/native-choice'
import { CoachMessage, CoachPage, CoachSection, CoachText } from '../components/coach-ui'
import { CoachEnrollment, CoachState, activeEnrollment, courseById, decimalNumber, endDate, latestWeight, localDate, validateEnrollment } from '../core/coach'
import { clearCoachDraft, getCoachDraft, getCoachState, saveCoachDraft, saveEnrollment } from '../services/coach-storage'
import { uid } from '../core/math'
import { useTheme } from '../theme'

interface GoalDraft {
  id: string; weight: string; height: string; target: string; goalMode: 'lose' | 'maintain'
  weeks: string; weekdays: number[]; level: 'new' | 'some'; adult: boolean; ready: boolean
}
export default function CoachGoal({ navigation, route }: RootStackScreen<'CoachGoal'>) {
  const t = useTheme(), course = courseById(route.params.courseId)
  const draftKey = 'goal:' + course.id + ':' + (route.params.enrollmentId ?? 'new')
  const [s, setS] = useState<CoachState | null>(null), [values, setValues] = useState<GoalDraft | null>(null)
  const valuesRef = useRef<GoalDraft | null>(null), lock = useRef(false)
  const [error, setError] = useState(''), [draftError, setDraftError] = useState(''), [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true), [retry, setRetry] = useState(0)
  const existing = s?.enrollments.find(e => e.id === route.params.enrollmentId)
  useEffect(() => {
    let live = true
    setLoading(true); setError('')
    Promise.all([getCoachState(), getCoachDraft<GoalDraft>(draftKey)]).then(([state, draft]) => {
      if (!live) return
      const e = state.enrollments.find(v => v.id === route.params.enrollmentId)
      if (route.params.enrollmentId && !e) throw new Error('原计划不存在，请返回教练页刷新。')
      const today = localDate(Date.now()), weight = latestWeight(state, today)
      const weekday = new Date().getDay() || 7
      const defaults: GoalDraft = {
        id: e?.id ?? uid('coach'), weight: e?.initialWeightKg?.toString() ?? weight?.weightKg.toString() ?? '',
        height: e?.heightCm?.toString() ?? '', target: e?.targetWeightKg?.toString() ?? '',
        goalMode: e?.goalMode ?? 'lose', weeks: String(e?.weeks ?? (course.id === 'weight' ? 24 : course.id === 'beginner' ? 4 : 6)),
        weekdays: e?.weekdays ?? [weekday, (weekday + 1) % 7 + 1, (weekday + 3) % 7 + 1].sort((a, b) => a - b),
        level: e?.level ?? 'new', adult: !!e, ready: !!e,
      }
      const restored = draft && typeof draft.id === 'string' && typeof draft.weight === 'string' &&
        typeof draft.height === 'string' && typeof draft.target === 'string' && typeof draft.weeks === 'string' &&
        Array.isArray(draft.weekdays) && ['new', 'some'].includes(draft.level) && ['lose', 'maintain'].includes(draft.goalMode)
        ? draft : defaults
      valuesRef.current = restored; setValues(restored); setS(state); setLoading(false)
    }).catch(e => { if (live) { setError(e instanceof Error ? e.message : '读取失败'); setLoading(false) } })
    return () => { live = false }
  }, [draftKey, route.params.enrollmentId, course.id, retry])
  const update = (patch: Partial<GoalDraft>) => {
    if (!valuesRef.current) return
    const next = { ...valuesRef.current, ...patch }
    valuesRef.current = next; setValues(next); setError('')
    void saveCoachDraft(draftKey, next).then(() => setDraftError('')).catch(() => setDraftError('草稿暂未保存，请保留页面并完成保存。'))
  }
  const save = async () => {
    const v = valuesRef.current
    if (!v || lock.current) return
    if (!v.adult || !v.ready) { setError('请先确认适用人群和当前身体情况。'); return }
    const now = Date.now()
    const e: CoachEnrollment = {
      id: v.id, courseId: course.id, status: existing?.status === 'maintaining' ? 'maintaining' : 'active',
      startedOn: existing?.startedOn ?? localDate(now), weeks: Number(v.weeks), weekdays: v.weekdays,
      level: v.level, goalMode: v.goalMode, initialWeightKg: course.id === 'weight' ? decimalNumber(v.weight) : undefined,
      heightCm: course.id === 'weight' ? decimalNumber(v.height) : undefined,
      targetWeightKg: course.id === 'weight' ? decimalNumber(v.goalMode === 'maintain' ? v.weight : v.target) : undefined,
      maintenanceSince: existing?.maintenanceSince, createdAt: existing?.createdAt ?? now, updatedAt: now,
    }
    const invalid = validateEnrollment(e)
    if (invalid) { setError(invalid); return }
    if (endDate(e) < localDate(now)) { setError('这个周期已经结束，请选择更长的周期，或结束旧阶段后开始新计划。'); return }
    lock.current = true; setBusy(true)
    try {
      await saveEnrollment(e, now)
      await clearCoachDraft(draftKey).catch(() => undefined)
      navigation.popTo('Main', { screen: 'Coach' })
    } catch (err) { setError(err instanceof Error ? err.message : '计划未保存，请重试。') }
    finally { lock.current = false; setBusy(false) }
  }
  return <CoachPage title={existing ? '调整我的计划' : '安排我的' + course.name}>
    <CoachMessage error={error} loading={loading} retry={!values ? () => setRetry(v => v + 1) : undefined} />
    {values ? <>
      <CoachText size="title">{existing ? '保留过去，调整接下来的节奏。' : '先定一个能坚持的目标。'}</CoachText>
      {course.id === 'weight' ? <CoachSection title="我的体重目标">
        <NativeChoice value={values.goalMode} options={[{ value: 'lose', label: '逐步减重' }, { value: 'maintain', label: '维持体重' }]} disabled={busy || existing?.status === 'maintaining'} onChange={goalMode => update({ goalMode })} />
        {existing ? <CoachText>起始体重 {existing.initialWeightKg} 公斤 · 当前称重请到“体重记录”更新。</CoachText> :
          <Field label="当前体重（公斤）" value={values.weight} onChangeText={weight => update({ weight })} keyboardType="decimal-pad" placeholder="例如 80.0，以实际称重为准" />}
        <Field label="身高（厘米）" value={values.height} onChangeText={height => update({ height })} keyboardType="decimal-pad" placeholder="例如 175" />
        {values.goalMode === 'lose' ? <Field label="阶段目标体重（公斤）" value={values.target} onChangeText={target => update({ target })} keyboardType="decimal-pad" placeholder="例如 76.0" /> :
          <CoachText tone="muted">以起始体重附近为维持参考，继续记录真实变化。</CoachText>}
        <CoachText size="small" tone="muted">只记录真实体重，不从运动消耗推算减掉的脂肪。体重目标需结合个人健康情况。</CoachText>
      </CoachSection> : null}
      <CoachSection title="给自己多少时间">
        <NativeChoice value={values.weeks} disabled={busy} onChange={weeks => update({ weeks })}
          options={(course.id === 'weight' ? ['12', '24', '36', '52'] : course.id === 'beginner' ? ['4', '8'] : ['6', '12']).map(value => ({ value, label: value + '周' }))} />
        <CoachText size="small" tone="muted">预计 {endDate({ startedOn: existing?.startedOn ?? localDate(Date.now()), weeks: Number(values.weeks) } as CoachEnrollment)} 进行阶段复盘。{existing ? '周期从原计划开始日计算；既有训练与复盘保留。' : '目标日期用于回顾和调整。'}</CoachText>
      </CoachSection>
      <CoachSection title="每周哪几天方便训练">
        <CoachText tone="muted">选择 1–4 天，其他日子留给恢复和适合自己的日常活动。</CoachText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {['一', '二', '三', '四', '五', '六', '日'].map((label, i) => {
            const day = i + 1, selected = values.weekdays.includes(day)
            return <Pressable key={day} accessibilityRole="checkbox" accessibilityLabel={'周' + label}
              accessibilityState={{ checked: selected, disabled: busy }} disabled={busy}
              onPress={() => {
                if (!selected && values.weekdays.length >= 4) { setError('每周最多安排四天爬楼，给恢复留些时间。'); return }
                update({ weekdays: selected ? values.weekdays.filter(d => d !== day) : [...values.weekdays, day].sort((a, b) => a - b) })
              }} style={({ pressed }) => ({ minWidth: t.tapMin, minHeight: t.tapMin, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8,
                borderRadius: t.radiusMd, borderWidth: 1, borderColor: selected ? t.brandBright : t.line, backgroundColor: selected ? t.brandSoft : t.card, opacity: pressed ? 0.65 : 1 })}>
              <CoachText tone={selected ? 'accent' : 'normal'}>周{label}</CoachText>
            </Pressable>
          })}
        </View>
      </CoachSection>
      <CoachSection title="目前的运动基础">
        <NativeChoice value={values.level} options={[{ value: 'new', label: '刚开始 / 久坐' }, { value: 'some', label: '已有运动习惯' }]} disabled={busy} onChange={level => update({ level })} />
        <CoachText tone="muted">从少量净上爬开始，热身 5 分钟，轮间留足恢复；提前结束也能保存已完成的部分。</CoachText>
      </CoachSection>
      <CoachSection title="开始前确认">
        <CoachText tone="muted">本课程面向成年人。未成年人、孕产期、有需专业指导的疾病，或当前有疼痛、胸闷、头晕、异常气短时，请先获得适合自己的运动建议。</CoachText>
        <NativeChoice value={values.adult ? 'yes' : 'no'} options={[{ value: 'no', label: '尚未确认' }, { value: 'yes', label: '我已满18岁' }]} disabled={busy} onChange={v => update({ adult: v === 'yes' })} />
        <NativeChoice value={values.ready ? 'yes' : 'no'} options={[{ value: 'no', label: '需要先咨询' }, { value: 'yes', label: '目前适合自行运动' }]} disabled={busy} onChange={v => update({ ready: v === 'yes' })} />
      </CoachSection>
      {s && activeEnrollment(s) && activeEnrollment(s)?.id !== values.id ? <CoachText tone="muted">保存后会暂停当前课程，原有记录保留。一次专注一个计划。</CoachText> : null}
      {draftError ? <CoachText tone="error" accessibilityRole="alert">{draftError}</CoachText> : <CoachText size="small" tone="muted">输入会在本机保留为草稿，返回后可继续。</CoachText>}
      {error ? <CoachText tone="error" accessibilityRole="alert">{error}</CoachText> : null}
      <Button title={existing ? '保存调整' : '保存目标，生成课程安排'} loading={busy} onPress={() => void save()} />
    </> : null}
  </CoachPage>
}
