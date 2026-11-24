import React, { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { RootStackScreen } from '../navigation/types'
import { Button, Field, Pill } from '../components/ui'
import { NativeChoice } from '../components/native-choice'
import { CoachMessage, CoachPage, CoachSection, CoachText, effortText, minutesText, todayKey, useCoachData } from '../components/coach-ui'
import { CoachAdjustment, CoachEffort, CoachReview, reviewAdvice, weekStart, weeklySummary } from '../core/coach'
import { clearCoachDraft, getCoachDraft, saveCoachDraft, saveCoachReview } from '../services/coach-storage'
import { useTheme } from '../theme'
import { getGlassSurfaceStyle } from '../components/glass-material'

interface ReviewDraft { effort: CoachEffort | ''; adjustment: CoachAdjustment; habit: 'steady' | 'needs_attention'; note: string }
export default function CoachReviewPage({ navigation, route }: RootStackScreen<'CoachReview'>) {
  const t = useTheme()
  const data = useCoachData(navigation), today = todayKey(), start = route.params.weekStart ?? weekStart(today)
  const key = route.params.enrollmentId + ':' + start
  const [draft, setDraft] = useState<ReviewDraft>({ effort: '', adjustment: 'keep', habit: 'steady', note: '' })
  const draftRef = useRef(draft), [busy, setBusy] = useState(false), lock = useRef(false)
  const [draftReady, setDraftReady] = useState(false), [draftError, setDraftError] = useState('')
  const e = data.state?.enrollments.find(v => v.id === route.params.enrollmentId)
  const stored = data.state?.reviews.find(r => r.id === key)
  const summary = data.state && e ? weeklySummary(data.state, e, today) : undefined
  useEffect(() => {
    let live = true
    getCoachDraft<ReviewDraft>(key).then(value => {
      if (!live) return
      if (value && ['comfortable', 'hard', 'unwell', ''].includes(value.effort) &&
          ['easier', 'keep', 'increase'].includes(value.adjustment) && typeof value.note === 'string') {
        draftRef.current = value; setDraft(value)
      }
      setDraftReady(true)
    }).catch(() => { if (live) { setDraftError('复盘草稿读取失败，请返回后重试。'); setDraftReady(false) } })
    return () => { live = false }
  }, [key])
  const update = (patch: Partial<ReviewDraft>) => {
    const next = { ...draftRef.current, ...patch }
    draftRef.current = next; setDraft(next); data.setError('')
    void saveCoachDraft(key, next).then(() => setDraftError('')).catch(() => setDraftError('草稿暂未保存，当前输入仍在页面中。'))
  }
  const save = async () => {
    if (!e || !summary || lock.current || !draftRef.current.effort) { data.setError('先选一项这一周的身体感受。'); return }
    if (start !== weekStart(todayKey())) { data.setError('已跨入新的一周，请返回后重新打开复盘。'); return }
    const value = draftRef.current
    lock.current = true; setBusy(true); data.setError('')
    try {
      const review: CoachReview = { id: key, enrollmentId: e.id, weekStart: start, reviewedOn: todayKey(),
        adjustment: value.adjustment, effort: value.effort as CoachEffort, habit: value.habit,
        note: value.note, createdAt: Date.now(), snapshot: { completed: summary.completed, planned: summary.planned,
          minutes: summary.minutes, weightChangeKg: summary.weightChangeKg } }
      data.setState(await saveCoachReview(review))
      await clearCoachDraft(key).catch(() => undefined)
    } catch (err) { data.setError(err instanceof Error ? err.message : '复盘未保存，输入已保留。') }
    finally { lock.current = false; setBusy(false) }
  }
  const evidence = stored?.snapshot ?? summary
  const canSubmit = draftReady && !!draft.effort && !!e && (e.status === 'active' || e.status === 'maintaining')

  return <CoachPage title={stored ? '已保存的周复盘' : '本周复盘'}>
    {!data.state ? <CoachMessage error={data.error} loading={data.loading} retry={() => void data.refresh()} /> : null}
    {e && summary && evidence ? <>
      {/* 本周复盘摘要 Hero 卡 */}
      <View style={[getGlassSurfaceStyle(t, 'feature'), { padding: 18, gap: 10 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <CoachText size="small" style={{ fontWeight: '600' }}>{start} 这一周</CoachText>
          {stored ? <Pill tone="good">已保存 · {stored.reviewedOn}</Pill> : <Pill>进行中快照</Pill>}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <CoachText size="metric">{evidence.completed} / {evidence.planned}</CoachText>
            <CoachText size="small" tone="muted">次课程完成</CoachText>
          </View>
          <CoachText size="small" tone="muted">净上爬 {minutesText(evidence.minutes)} 分钟</CoachText>
        </View>
        {e.courseId === 'weight' ? (
          <CoachText size="caption" tone="muted">
            {evidence.weightChangeKg !== undefined
              ? '与前周相比，周均重变化 ' + (evidence.weightChangeKg > 0 ? '+' : '') + evidence.weightChangeKg.toFixed(1) + ' 公斤。'
              : '体重记录不足以比较周均值。相邻两周各有至少两天称重时，会显示趋势；缺少记录不会被当成体重稳定。'}
          </CoachText>
        ) : null}
      </View>

      {stored ? <>
        <CoachSection card title="当时的感受与选择">
          <CoachText style={{ fontWeight: '600' }}>{effortText[stored.effort]} · {stored.adjustment === 'easier' ? '减少上爬时间' : stored.adjustment === 'increase' ? '小幅增加' : '保持节奏'}</CoachText>
          <CoachText size="small" tone="muted">生活习惯：{stored.habit === 'steady' ? '大体规律' : '下周继续关注'}</CoachText>
          {stored.note ? <CoachText>{stored.note}</CoachText> : null}
          <CoachText size="small" tone="muted">{reviewAdvice({ ...summary, ...stored.snapshot }, stored.effort)}</CoachText>
          {stored.effort === 'unwell' ? <CoachText size="small" tone="error">课程已暂停；先处理身体不适，再考虑继续。</CoachText> : null}
        </CoachSection>
        <Button title="回到教练" onPress={() => navigation.popTo('Main', { screen: 'Coach' })} />
      </> : route.params.weekStart && route.params.weekStart !== weekStart(today) ? (
        <CoachText tone="muted">未找到这周的已保存复盘。</CoachText>
      ) : <>
        <CoachSection card title="这一周，身体感觉怎样">
          <NativeChoice value={draft.effort} disabled={busy} options={[
            { value: 'comfortable', label: '舒适' }, { value: 'hard', label: '有些吃力' }, { value: 'unwell', label: '身体不适' },
          ]} onChange={effort => update({ effort: effort as CoachEffort, adjustment: effort === 'unwell' || effort === 'hard' ? 'easier' : 'keep' })} />
          {draft.effort ? <CoachText size="small" tone={draft.effort === 'unwell' ? 'error' : 'muted'}>{reviewAdvice(summary, draft.effort)}</CoachText> : null}
        </CoachSection>
        <CoachSection card title="饮食、睡眠与日常活动">
          <NativeChoice value={draft.habit} disabled={busy} options={[{ value: 'steady', label: '大体规律' }, { value: 'needs_attention', label: '下周继续关注' }]} onChange={habit => update({ habit })} />
          <Field
            label="给下周的自己留句话（选填，最多500字）"
            value={draft.note}
            onChangeText={note => update({ note: note.slice(0, 500) })}
            placeholder="例如：周三太忙，选短一点的时间也可以"
            multiline
            numberOfLines={3}
          />
        </CoachSection>
        <CoachSection card title="接下来的课程怎么安排">
          <NativeChoice value={draft.adjustment} disabled={busy} options={draft.effort === 'unwell' ? [{ value: 'easier', label: '先暂停，之后减量' }] : [
            { value: 'easier', label: '减少20%' }, { value: 'keep', label: '保持节奏' },
            ...(summary.canIncrease && draft.effort === 'comfortable' ? [{ value: 'increase', label: '增加10%' }] : []),
          ]} onChange={adjustment => update({ adjustment: adjustment as CoachAdjustment })} />
          <CoachText size="caption" tone="muted">只调整还未开始的后续课程；已完成的记录保留。加量需本周大部分课程完成，且每次都记录为舒适。体重短期不变不会自动加量。</CoachText>
        </CoachSection>
        {draftError ? <CoachText size="small" tone="error">{draftError}</CoachText> : null}
        <CoachMessage error={data.error} />
        <Button
          title={draft.effort === 'unwell' ? '保存复盘并暂停课程' : '保存复盘与后续安排'}
          loading={busy}
          disabled={!canSubmit}
          onPress={() => void save()}
        />
        {!busy && !canSubmit ? (
          <CoachText size="caption" tone="muted" style={{ textAlign: 'center' }}>
            {!draftReady
              ? '正在读取复盘草稿…'
              : !draft.effort
                ? '请先在上方选择本周的身体感受后再保存。'
                : '当前课程未处于进行状态，暂不可保存新复盘。'}
          </CoachText>
        ) : null}
      </>}
    </> : !data.loading && data.state ? <CoachText tone="muted">计划不存在，请返回教练页刷新。</CoachText> : null}
  </CoachPage>
}
