import React, { useEffect, useRef, useState } from 'react'
import { Alert, Pressable, StyleSheet, View } from 'react-native'
import { RootStackScreen } from '../navigation/types'
import { Button, Field } from '../components/ui'
import { UIIcon } from '../components/ui-icon'
import { NativeChoice } from '../components/native-choice'
import { CoachMessage, CoachPage, CoachSection, CoachText, WeightTrend, displayDate, effortText, minutesText, todayKey, useCoachData } from '../components/coach-ui'
import { activeEnrollment, addDays, courseById, decimalNumber, isDateKey, latestWeight, localDate } from '../core/coach'
import { deleteWeighIn, saveWeighIn } from '../services/coach-storage'
import { didPreferencesWriteFail, savePreferences } from '../services/preferences'
import { listWorkouts } from '../services/workout-storage'
import { sport, typography, useTheme } from '../theme'
import { getGlassSurfaceStyle } from '../components/glass-material'

export default function CoachRecords({ navigation, route }: RootStackScreen<'CoachRecords'>) {
  const t = useTheme(), data = useCoachData(navigation), today = todayKey()
  const [tab, setTab] = useState<'weight' | 'workouts' | 'reviews'>(route.params?.tab ?? 'weight')
  const [date, setDate] = useState(today), [weight, setWeight] = useState(''), [count, setCount] = useState(20)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), lock = useRef(false)
  const [available, setAvailable] = useState(new Set<string>())
  useEffect(() => {
    let live = true
    const load = () => { void listWorkouts().then(rows => { if (live) setAvailable(new Set(rows.map(w => w.id))) }).catch(() => undefined) }
    load(); const unsubscribe = navigation.addListener('focus', load)
    return () => { live = false; unsubscribe() }
  }, [navigation])
  const syncPreference = async (state: NonNullable<typeof data.state>) => {
    const current = latestWeight(state, todayKey())
    if (!current) return
    await savePreferences({ bodyWeightKg: current.weightKg })
    if (didPreferencesWriteFail()) setMessage('体重已保存，设置中的消耗估算体重暂未同步。课程会读取最新称重，请稍后重试。')
  }
  const shiftDate = (days: number) => {
    const base = isDateKey(date) ? date : today
    const next = addDays(base, days)
    if (next <= today) setDate(next)
  }
  const save = async () => {
    if (lock.current) return
    const number = decimalNumber(weight)
    if (!isDateKey(date) || date > todayKey()) { data.setError('请填写有效的称重日期，例如 2026-10-27；不能填写未来日期。'); return }
    if (!Number.isFinite(number) || number < 30 || number > 250) { data.setError('请填写 30–250 公斤之间的实际体重。'); return }
    lock.current = true; setBusy(true); data.setError(''); setMessage('')
    try {
      const next = await saveWeighIn(date, Math.round(number * 10) / 10, Date.now())
      data.setState(next); setMessage('已保存 ' + date + ' 的体重。'); setWeight('')
      await syncPreference(next)
    } catch (e) { data.setError(e instanceof Error ? e.message : '保存失败，输入已保留。') }
    finally { lock.current = false; setBusy(false) }
  }
  const remove = async (id: string) => {
    if (lock.current) return
    lock.current = true; setBusy(true); data.setError('')
    try { const next = await deleteWeighIn(id); data.setState(next); setMessage('已删除这次称重，原始训练和已保存复盘不受影响。'); await syncPreference(next) }
    catch (e) { data.setError(e instanceof Error ? e.message : '删除失败，请重试。') }
    finally { lock.current = false; setBusy(false) }
  }
  const s = data.state, e = s ? activeEnrollment(s) : undefined
  const weights = s ? [...s.weighIns].sort((a, b) => b.date.localeCompare(a.date)) : []
  const workouts = s ? [...s.workouts].sort((a, b) => b.endedAt - a.endedAt) : []
  const reviews = s ? [...s.reviews].sort((a, b) => b.createdAt - a.createdAt) : []
  const length = tab === 'weight' ? weights.length : tab === 'workouts' ? workouts.length : reviews.length
  const yesterday = addDays(today, -1)
  const visibleWeights = weights.slice(0, count)
  const visibleWorkouts = workouts.slice(0, count)
  const visibleReviews = reviews.slice(0, count)

  return <CoachPage title="体重与课程记录">
    <NativeChoice value={tab} disabled={busy} onChange={value => { setTab(value); setCount(20); setMessage('') }} options={[
      { value: 'weight', label: '体重' }, { value: 'workouts', label: '训练' }, { value: 'reviews', label: '复盘' },
    ]} />
    <CoachMessage error={data.error} loading={data.loading && !s} retry={() => void data.refresh()} />
    {s ? <>
      {tab === 'weight' ? <>
        <View style={[getGlassSurfaceStyle(t, 'feature'), { padding: 16, gap: 10 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            {weights[0] ? (
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <CoachText size="metric">{weights[0].weightKg.toFixed(1)}</CoachText>
                <CoachText size="small" tone="muted">公斤</CoachText>
              </View>
            ) : (
              <CoachText size="display">从一次真实称重开始</CoachText>
            )}
            {weights[0] ? <CoachText size="caption" tone="muted">最近 {displayDate(weights[0].date)}</CoachText> : null}
          </View>
          <WeightTrend readings={weights} target={e?.courseId === 'weight' ? e.targetWeightKg : undefined} />
        </View>

        <CoachSection card title="记录一次体重">
          {/* 快捷日期切换，免去手机反复手打 YYYY-MM-DD */}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[
              { label: '前一天', onPress: () => shiftDate(-1), active: false, disabled: busy },
              { label: '昨天', onPress: () => setDate(yesterday), active: date === yesterday, disabled: busy },
              { label: '今天', onPress: () => setDate(today), active: date === today, disabled: busy },
              { label: '后一天', onPress: () => shiftDate(1), active: false, disabled: busy || date >= today },
            ].map(item => (
              <Pressable
                key={item.label}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                disabled={item.disabled}
                onPress={item.onPress}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: t.tapMin,
                  borderRadius: t.radiusSm,
                  borderWidth: 1,
                  borderColor: item.active ? t.brandText : 'transparent',
                  backgroundColor: item.active ? t.brandSoft : t.surfaceSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: item.disabled ? 0.42 : pressed ? sport.opacity.pressed : 1,
                })}
              >
                <CoachText size="small" tone={item.active ? 'accent' : 'normal'} style={{ fontWeight: item.active ? '700' : '500' }}>
                  {item.label}
                </CoachText>
              </Pressable>
            ))}
          </View>
          <Field label="称重日期（年-月-日）" value={date} onChangeText={setDate} placeholder="例如 2026-10-27" />
          <Field label="体重（公斤，精确到0.1）" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="例如 79.8" />
          <CoachText size="caption" tone="muted">{weights.some(w => w.date === date) ? '这一天已有记录，保存会更新这一天的体重。' : '一天保留一条记录。尽量在相近时间和条件下称重，至少每周一次。'}</CoachText>
          <Button title={weights.some(w => w.date === date) ? '更新这天的体重' : '保存称重'} disabled={busy} loading={busy} onPress={() => void save()} />
          {message ? <CoachText size="small" tone="good" accessibilityLiveRegion="polite">{message}</CoachText> : null}
        </CoachSection>

        <CoachSection card title="称重记录" meta={`${weights.length} 条`}>
          {!weights.length ? <CoachText size="small" tone="muted">还没有称重记录。没有记录的日子会保持空白。</CoachText> : null}
          {visibleWeights.map((w, idx) => (
            <View
              key={w.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                paddingVertical: 10,
                borderBottomWidth: idx < visibleWeights.length - 1 ? StyleSheet.hairlineWidth : 0,
                borderBottomColor: t.lineSoft,
              }}
            >
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <CoachText style={{ ...typography.digits, fontSize: 19, lineHeight: 24 }}>{w.weightKg.toFixed(1)} 公斤</CoachText>
                <CoachText size="caption" tone="muted">{w.date}</CoachText>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={'编辑' + w.date + '的体重'}
                  disabled={busy}
                  onPress={() => { setDate(w.date); setWeight(w.weightKg.toString()); setMessage('已选中 ' + w.date + '，请在上方编辑并保存。') }}
                  style={({ pressed }) => ({ minHeight: t.tapMin, paddingHorizontal: 6, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
                >
                  <CoachText size="small" tone="accent" style={{ fontWeight: '600' }}>编辑</CoachText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={'删除' + w.date + '的体重'}
                  disabled={busy}
                  onPress={() => Alert.alert('删除这次称重？', w.date + ' 的 ' + w.weightKg + ' 公斤将被删除，已保存复盘中的快照会保留。', [
                    { text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => void remove(w.id) },
                  ])}
                  style={({ pressed }) => ({ minHeight: t.tapMin, paddingHorizontal: 6, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
                >
                  <CoachText size="small" tone="error" style={{ fontWeight: '600' }}>删除</CoachText>
                </Pressable>
              </View>
            </View>
          ))}
        </CoachSection>
      </> : tab === 'workouts' ? (
        <CoachSection card title="课程训练" meta={`${workouts.length} 次`}>
          {!workouts.length ? <CoachText size="small" tone="muted">从课程页开始并保存训练后，会自动显示在这里。提前结束的部分也会保留。</CoachText> : null}
          {visibleWorkouts.map((w, idx) => {
            const enrollment = s.enrollments.find(v => v.id === w.enrollmentId)
            const canOpen = available.has(w.id)
            const rowStyle = {
              flexDirection: 'row' as const,
              alignItems: 'center' as const,
              gap: 10,
              paddingVertical: 12,
              minHeight: 60,
              borderBottomWidth: idx < visibleWorkouts.length - 1 ? StyleSheet.hairlineWidth : 0,
              borderBottomColor: t.lineSoft,
            }
            const content = (
              <>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <CoachText style={{ fontWeight: '600' }}>{enrollment ? courseById(enrollment.courseId).name : '课程训练'}</CoachText>
                  <CoachText size="small">{localDate(w.endedAt)} · 净上爬 {minutesText(w.minutes)} 分钟 · {w.floors} 层</CoachText>
                  <CoachText size="caption" tone={w.effort ? 'muted' : 'accent'}>
                    {w.effort ? `训练感受：${effortText[w.effort]}` : canOpen ? '未填写感受，点按查看并记录' : '原始训练明细已不在本机，课程记录仍保留'}
                  </CoachText>
                </View>
                {canOpen ? <UIIcon name="chevron-right" size={18} color={t.mutedStrong} /> : null}
              </>
            )
            return canOpen ? (
              <Pressable
                key={w.id}
                accessibilityRole="button"
                accessibilityLabel={`查看${localDate(w.endedAt)}课程训练并记录感受`}
                onPress={() => navigation.navigate('WorkoutResult', { id: w.id })}
                style={({ pressed }) => [rowStyle, pressed && { opacity: sport.opacity.pressed }]}
              >
                {content}
              </Pressable>
            ) : (
              <View key={w.id} style={rowStyle}>{content}</View>
            )
          })}
        </CoachSection>
      ) : (
        <CoachSection card title="每周复盘" meta={`${reviews.length} 次`}>
          {!reviews.length ? <CoachText size="small" tone="muted">还没有复盘。回到教练页，记录这一周的完成情况和身体感受。</CoachText> : null}
          {visibleReviews.map((r, idx) => (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              accessibilityLabel={`查看 ${r.weekStart} 这一周的复盘`}
              onPress={() => navigation.navigate('CoachReview', { enrollmentId: r.enrollmentId, weekStart: r.weekStart })}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingVertical: 12,
                minHeight: 60,
                borderBottomWidth: idx < visibleReviews.length - 1 ? StyleSheet.hairlineWidth : 0,
                borderBottomColor: t.lineSoft,
                opacity: pressed ? sport.opacity.pressed : 1,
              })}
            >
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <CoachText style={{ fontWeight: '600' }}>{r.weekStart} 这一周 · {r.snapshot.completed}/{r.snapshot.planned} 次完成</CoachText>
                <CoachText size="small" tone="muted">
                  {effortText[r.effort]} · {r.adjustment === 'easier' ? '减少上爬时间' : r.adjustment === 'increase' ? '小幅增加' : '保持节奏'}
                </CoachText>
              </View>
              <UIIcon name="chevron-right" size={18} color={t.mutedStrong} />
            </Pressable>
          ))}
        </CoachSection>
      )}
      {length > count ? <Button title="查看更多记录" variant="secondary" onPress={() => setCount(n => n + 20)} /> : null}
    </> : null}
  </CoachPage>
}
