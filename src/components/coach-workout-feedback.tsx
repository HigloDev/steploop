import React, { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { Button } from './ui'
import { NativeChoice } from './native-choice'
import { CoachText } from './coach-ui'
import { ClimbWorkout } from '../core/types'
import { CoachEffort, courseById, sessionProgress } from '../core/coach'
import { RootStackNavigation } from '../navigation/types'
import { saveCoachEffort, syncCoachWorkouts } from '../services/coach-storage'

export function CoachWorkoutFeedback({ workout, navigation }: { workout: ClimbWorkout; navigation: RootStackNavigation }) {
  const [effort, setEffort] = useState<CoachEffort | ''>(''), [error, setError] = useState('')
  const [message, setMessage] = useState('正在同步课程进度…'), [busy, setBusy] = useState(false)
  const [hasRecord, setHasRecord] = useState(false)
  const lock = useRef(false)
  useEffect(() => {
    let live = true
    syncCoachWorkouts([workout]).then(s => {
      if (!live) return
      const record = s.workouts.find(w => w.id === workout.id)
      setHasRecord(!!record)
      setEffort(record?.effort ?? '')
      const session = s.sessions.find(v => v.id === workout.coach?.sessionId)
      setMessage(session && record ? sessionProgress(s, session).completed ? '已计入课程，这次安排已完成。' :
        record.minutes === 0 ? '已保留确认的楼层；缺少有效上爬时长，这次课程保持未完成。' : '已计入课程，未完成的部分也已保留。' :
        session ? '训练已保存，这次没有可计入课程的上爬记录。' :
        '训练已保存，原课程暂不在本机。')
    }).catch(() => { if (live) { setError('训练已保存，课程进度暂未同步。回到教练页可重新同步。'); setMessage('') } })
    return () => { live = false }
  }, [workout])
  const save = async (value: CoachEffort) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { await syncCoachWorkouts([workout]); await saveCoachEffort(workout.id, value); setEffort(value) }
    catch (e) { setError(e instanceof Error ? e.message : '训练感受未保存，请重试。') }
    finally { lock.current = false; setBusy(false) }
  }
  if (!workout.coach) return null
  return <View style={{ gap: 12, marginTop: 20 }}>
    <CoachText size="title">{courseById(workout.coach.courseId)?.name ?? '教练课程'}</CoachText>
    {message ? <CoachText tone="accent">{message}</CoachText> : null}
    <CoachText>先慢走缓和一下。今天练起来感觉怎样？</CoachText>
    <NativeChoice value={effort} disabled={busy || !hasRecord} options={[
      { value: 'comfortable', label: '舒适' }, { value: 'hard', label: '有些吃力' }, { value: 'unwell', label: '身体不适' },
    ]} onChange={value => void save(value as CoachEffort)} />
    {effort ? <CoachText tone={effort === 'unwell' ? 'error' : 'muted'} size="small">{effort === 'unwell'
      ? '感受已保存。先停止爬楼，必要时寻求专业建议；请到周复盘调整或暂停后续课程。' : '感受已保存，会用于每周复盘。'}</CoachText> : null}
    {error ? <CoachText tone="error" accessibilityRole="alert">{error}</CoachText> : null}
    <Button title="回到教练，查看进度与复盘" variant="secondary" onPress={() => navigation.popTo('Main', { screen: 'Coach' })} />
  </View>
}
