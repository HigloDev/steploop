import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  CoachEnrollment, CoachReview, CoachState, CoachEffort, CoachWeighIn,
  activeEnrollment, addDays, buildSessions, emptyCoachState, localDate, parseCoachState,
  sessionProgress, validateEnrollment, weeklySummary, weightGoalReached, workoutRecord, isDateKey,
} from '../core/coach'
import type { ClimbWorkout } from '../core/types'
import { runSerial } from './storage-journal'

export const COACH_STORAGE_KEY = 'palou.coach.v1'
export const COACH_DRAFT_KEY = 'palou.coachDraft.v1'

export async function getCoachDraft<T>(key: string): Promise<T | undefined> {
  const raw = await AsyncStorage.getItem(COACH_DRAFT_KEY + ':' + key)
  if (!raw) return undefined
  try { return JSON.parse(raw) as T } catch { throw new Error('草稿无法读取，请返回后重试。') }
}
export async function saveCoachDraft(key: string, value: unknown): Promise<void> {
  await runSerial(() => AsyncStorage.setItem(COACH_DRAFT_KEY + ':' + key, JSON.stringify(value)))
}
export async function clearCoachDraft(key: string): Promise<void> {
  await runSerial(() => AsyncStorage.removeItem(COACH_DRAFT_KEY + ':' + key))
}

/** Caller already holds the shared storage queue; also used by backup import. */
export async function readCoachStateUnsafe(): Promise<CoachState> {
  const raw = await AsyncStorage.getItem(COACH_STORAGE_KEY)
  if (raw === null) return emptyCoachState()
  try { return parseCoachState(JSON.parse(raw)) } catch {
    throw new Error('教练数据无法读取，原始数据已保留。请重试或导出备份。')
  }
}
export async function getCoachState(): Promise<CoachState> {
  return runSerial(async () => {
    // 1.1.5 runSerial recovers before invoking the task; re-enqueueing here deadlocks.
    return readCoachStateUnsafe()
  })
}
async function mutate(action: (s: CoachState) => void | boolean): Promise<CoachState> {
  return runSerial(async () => {
    const s = await readCoachStateUnsafe()
    if (action(s) === false) return s
    parseCoachState(s)
    try { await AsyncStorage.setItem(COACH_STORAGE_KEY, JSON.stringify(s)) } catch {
      throw new Error('教练记录未保存成功，请检查存储空间后重试；当前输入仍保留。')
    }
    return s
  })
}
export async function saveEnrollment(enrollment: CoachEnrollment, now: number): Promise<CoachState> {
  const error = validateEnrollment(enrollment)
  if (error) throw new Error(error)
  return mutate(s => {
    const previous = s.enrollments.find(e => e.id === enrollment.id)
    const today = localDate(now)
    s.enrollments = s.enrollments.map(e =>
      e.id !== enrollment.id && (e.status === 'active' || e.status === 'maintaining') ? { ...e, status: 'paused', updatedAt: now } : e)
    const next = { ...enrollment, updatedAt: now }
    const index = s.enrollments.findIndex(e => e.id === next.id)
    if (index < 0) s.enrollments.push(next); else s.enrollments[index] = next
    // Preserve all past and attempted sessions, including their original prescription.
    const retained = s.sessions.filter(v => v.enrollmentId !== next.id || v.date < today ||
      sessionProgress(s, v).minutes > 0 || v.skipped)
    const retainedIds = new Set(retained.map(v => v.id))
    s.sessions = [...retained, ...buildSessions(next).filter(v => !retainedIds.has(v.id) && (!previous || v.date >= today))]
    if (!previous && next.courseId === 'weight') {
      const reading: CoachWeighIn = { id: today, date: today, weightKg: next.initialWeightKg!, updatedAt: now }
      if (!s.weighIns.some(w => w.id === reading.id)) s.weighIns.push(reading)
    }
  })
}
export async function setEnrollmentStatus(id: string, status: CoachEnrollment['status'], now: number): Promise<CoachState> {
  return mutate(s => {
    const e = s.enrollments.find(v => v.id === id)
    if (!e) throw new Error('课程不存在，请刷新。')
    if (status === 'maintaining' && e.goalMode === 'lose' && !weightGoalReached(s, e, localDate(now))) {
      throw new Error('请先记录近期体重；至少两次记录达到目标后可转入维持。')
    }
    if ((status === 'active' || status === 'maintaining') && activeEnrollment(s)?.id !== id && activeEnrollment(s)) {
      throw new Error('请先暂停当前课程，再继续这门课。')
    }
    e.status = status; e.updatedAt = now
    if (status === 'maintaining') e.maintenanceSince = localDate(now)
  })
}
export async function saveWeighIn(date: string, weightKg: number, now: number): Promise<CoachState> {
  if (!isDateKey(date)) throw new Error('称重日期无效，请使用年-月-日。')
  if (!Number.isFinite(weightKg) || weightKg < 30 || weightKg > 250) throw new Error('请填写 30–250 公斤之间的实际体重。')
  return mutate(s => {
    const reading = { id: date, date, weightKg: Math.round(weightKg * 10) / 10, updatedAt: now }
    if (date > localDate(now) || date < addDays(localDate(now), -3660)) throw new Error('请填写今天或过去十年内的称重日期。')
    const index = s.weighIns.findIndex(w => w.id === date)
    if (index < 0) s.weighIns.push(reading); else s.weighIns[index] = reading
  })
}
export async function deleteWeighIn(id: string): Promise<CoachState> {
  return mutate(s => { s.weighIns = s.weighIns.filter(w => w.id !== id) })
}
export async function syncCoachWorkouts(workouts: ClimbWorkout[]): Promise<CoachState> {
  const records = workouts.map(workoutRecord).filter((w): w is NonNullable<typeof w> => !!w)
  if (!records.length) return getCoachState()
  return mutate(s => {
    let changed = false
    for (const w of records) {
      if (!s.enrollments.some(e => e.id === w.enrollmentId)) continue
      const index = s.workouts.findIndex(v => v.id === w.id)
      if (index < 0) { s.workouts.push(w); changed = true }
      else {
        const previous = s.workouts[index]
        if (previous.endedAt !== w.endedAt || previous.minutes !== w.minutes || previous.floors !== w.floors) {
          s.workouts[index] = { ...w, effort: previous.effort }; changed = true
        }
      }
    }
    return changed
  })
}
export async function saveCoachEffort(workoutId: string, effort: CoachEffort): Promise<CoachState> {
  return mutate(s => {
    const record = s.workouts.find(w => w.id === workoutId)
    if (!record) throw new Error('尚未找到这次课程记录，请刷新后重试。')
    record.effort = effort
  })
}

function weekStartForReview(date: string): string {
  const d = new Date(date + 'T12:00:00')
  return addDays(date, 1 - (d.getDay() || 7))
}
export async function removeCoachWorkout(id: string): Promise<void> {
  // Existing users without coach data must not acquire an empty health-data document.
  if (await AsyncStorage.getItem(COACH_STORAGE_KEY) === null) return
  await mutate(s => { s.workouts = s.workouts.filter(w => w.id !== id) })
}
export async function skipCoachSession(id: string): Promise<CoachState> {
  return mutate(s => {
    const session = s.sessions.find(v => v.id === id)
    if (!session || sessionProgress(s, session).completed) throw new Error('这次课程已完成或不存在。')
    session.skipped = true
  })
}
export async function saveCoachReview(review: CoachReview): Promise<CoachState> {
  return mutate(s => {
    if (!isDateKey(review.reviewedOn) || review.weekStart !== weekStartForReview(review.reviewedOn) ||
        review.id !== review.enrollmentId + ':' + review.weekStart) {
      throw new Error('复盘日期已变化，请返回后重新打开。')
    }
    const e = s.enrollments.find(v => v.id === review.enrollmentId)
    if (!e || (e.status !== 'active' && e.status !== 'maintaining')) throw new Error('课程已暂停或结束，请返回教练页刷新。')
    const summary = weeklySummary(s, e, review.reviewedOn)
    if (review.adjustment === 'increase' && (!summary.canIncrease || review.effort !== 'comfortable')) {
      throw new Error('先完成本周课程并记录舒适的训练感受，再考虑增加。')
    }
    if (review.effort === 'unwell' && review.adjustment !== 'easier') throw new Error('身体不适时请先减量或暂停。')
    if (s.reviews.some(r => r.id === review.id)) throw new Error('本周已经复盘，下周再回顾。')
    s.reviews.push({ ...review, note: review.note.slice(0, 500), snapshot: { completed: summary.completed,
      planned: summary.planned, minutes: summary.minutes,
      ...(summary.weightChangeKg !== undefined ? { weightChangeKg: summary.weightChangeKg } : {}) } })
    const factor = review.adjustment === 'easier' ? 0.8 : review.adjustment === 'increase' ? 1.1 : 1
    for (const session of s.sessions) {
      if (session.enrollmentId === e.id && session.date > review.reviewedOn && !session.skipped && sessionProgress(s, session).minutes === 0) {
        session.targetMinutes = Math.max(2, Math.min(20, Math.round(session.targetMinutes * factor * 10) / 10))
      }
    }
    if (review.effort === 'unwell') { e.status = 'paused'; e.updatedAt = review.createdAt }
  })
}
