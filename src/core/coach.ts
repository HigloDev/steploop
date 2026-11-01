import type { ClimbWorkout, CoachWorkoutLink } from './types'
import { FUSION_RECOGNITION_VERSION } from './sensor-params'

export type CoachCourseId = 'weight' | 'beginner' | 'cardio'
export type CoachStatus = 'active' | 'paused' | 'maintaining' | 'completed'
export type CoachEffort = 'comfortable' | 'hard' | 'unwell'
export type CoachAdjustment = 'easier' | 'keep' | 'increase'

export const COACH_COURSES = [
  { id: 'weight' as const, name: '目标体重管理', duration: '12–24 周', icon: 'target' as const,
    description: '把体重目标拆成每周行动，记录变化，找到能坚持的节奏。',
    outcome: '目标设定 · 爬楼计划 · 体重趋势 · 每周复盘',
    lessons: ['认识自己的起点', '设定体重与时间目标', '建立每周运动节奏', '饮食、睡眠与久坐', '用趋势复盘', '达到目标后的维持'],
    source: '国家卫生健康委 · 体重管理指导原则（2024年版）',
    url: 'https://www.nhc.gov.cn/wjw/c100378/202412/f3f58b54fbeb4c87b14164fac898bf08.shtml' },
  { id: 'beginner' as const, name: '新手爬楼入门', duration: '4 周', icon: 'navigation' as const,
    description: '从一小段楼梯开始，学会热身、步速与恢复。',
    outcome: '动作准备 · 短段上爬 · 充分恢复 · 建立习惯',
    lessons: ['选一段合适的楼梯', '热身与全脚掌踏步', '找到舒适步速', '学会停下和恢复'],
    source: '香港卫生署 · 行楼梯健身心',
    url: 'https://www.chp.gov.hk/tc/static/90006.html' },
  { id: 'cardio' as const, name: '日常心肺提升', duration: '6 周', icon: 'activity' as const,
    description: '循序积累上爬时间，在熟悉的路线里观察自己的变化。',
    outcome: '稳定配速 · 分段上爬 · 恢复反馈 · 同路线比较',
    lessons: ['先建立稳定节奏', '上爬与恢复交替', '逐步积累有效时间', '观察同路线表现', '保持节奏', '回顾六周变化'],
    source: 'Allison 等 · 短时爬楼与心肺适能研究（2017）',
    url: 'https://doi.org/10.1249/MSS.0000000000001188' },
]

export interface CoachEnrollment {
  id: string
  courseId: CoachCourseId
  status: CoachStatus
  startedOn: string
  weeks: number
  weekdays: number[]
  level: 'new' | 'some'
  initialWeightKg?: number
  heightCm?: number
  targetWeightKg?: number
  goalMode: 'lose' | 'maintain'
  maintenanceSince?: string
  createdAt: number
  updatedAt: number
}
export interface CoachSession {
  id: string
  enrollmentId: string
  date: string
  week: number
  targetMinutes: number
  skipped?: boolean
}
export interface CoachWeighIn { id: string; date: string; weightKg: number; updatedAt: number }
export interface CoachWorkoutRecord {
  id: string
  enrollmentId: string
  sessionId: string
  endedAt: number
  minutes: number
  floors: number
  routeId: string
  effort?: CoachEffort
}
export interface CoachReview {
  id: string
  enrollmentId: string
  weekStart: string
  reviewedOn: string
  adjustment: CoachAdjustment
  effort: CoachEffort
  habit: 'steady' | 'needs_attention'
  note: string
  createdAt: number
  /** Save the evidence seen at review time so a later edit cannot rewrite the review. */
  snapshot: { completed: number; planned: number; minutes: number; weightChangeKg?: number }
}
export interface CoachState {
  version: 1
  enrollments: CoachEnrollment[]
  sessions: CoachSession[]
  weighIns: CoachWeighIn[]
  workouts: CoachWorkoutRecord[]
  reviews: CoachReview[]
}
export const emptyCoachState = (): CoachState => ({
  version: 1, enrollments: [], sessions: [], weighIns: [], workouts: [], reviews: [],
})

export function localDate(timestamp: number): string {
  const d = new Date(timestamp)
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}
export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return localDate(dateTimestamp(value)) === value
}
export function dateTimestamp(date: string): number { return new Date(date + 'T12:00:00').getTime() }
export function addDays(date: string, days: number): string {
  const d = new Date(dateTimestamp(date)); d.setDate(d.getDate() + days); return localDate(d.getTime())
}
export function weekStart(date: string): string {
  const day = new Date(dateTimestamp(date)).getDay() || 7
  return addDays(date, 1 - day)
}
export function endDate(enrollment: CoachEnrollment): string { return addDays(enrollment.startedOn, enrollment.weeks * 7 - 1) }
export function courseById(id: CoachCourseId) { return COACH_COURSES.find(c => c.id === id)! }
export function activeEnrollment(state: CoachState): CoachEnrollment | undefined {
  return state.enrollments.find(e => e.status === 'active' || e.status === 'maintaining')
}
export function latestWeight(state: CoachState, through: string): CoachWeighIn | undefined {
  return state.weighIns.filter(w => w.date <= through).sort((a, b) => b.date.localeCompare(a.date))[0]
}
export function decimalNumber(text: string): number {
  const normalized = text.trim().replace(',', '.')
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN
}

export function validateEnrollment(e: CoachEnrollment): string | undefined {
  if (!COACH_COURSES.some(c => c.id === e.courseId)) return '课程不存在。'
  if (!isDateKey(e.startedOn)) return '开始日期无效。'
  if (!Number.isInteger(e.weeks) || e.weeks < 4 || e.weeks > 52) return '课程周期应为 4–52 周。'
  if (!e.weekdays.length || e.weekdays.length > 4 || new Set(e.weekdays).size !== e.weekdays.length ||
      e.weekdays.some(d => !Number.isInteger(d) || d < 1 || d > 7)) return '请选择每周 1–4 个训练日，给恢复留些时间。'
  if (e.courseId !== 'weight') return undefined
  if (e.weeks < 12) return '体重管理请至少安排 12 周，给习惯和趋势留些时间。'
  const weight = e.initialWeightKg, height = e.heightCm, target = e.targetWeightKg
  if (!Number.isFinite(weight) || weight! < 30 || weight! > 250) return '请填写 30–250 公斤之间的当前体重。'
  if (!Number.isFinite(height) || height! < 120 || height! > 220) return '请填写 120–220 厘米之间的身高。'
  if (!Number.isFinite(target) || target! < 30 || target! > 250) return '请填写有效的目标体重。'
  if (e.goalMode === 'lose') {
    if (target! >= weight!) return '减重目标应低于当前体重；也可以选择维持体重。'
    if (target! / (height! / 100) ** 2 < 18.5) return '该目标低于成人健康体重参考下限，请调整目标或咨询专业人员。'
    if ((weight! - target!) / e.weeks > Math.min(1, weight! * 0.01)) return '目标进度过快，请延长时间或先设一个较小的阶段目标。'
  }
  return undefined
}

export function buildSessions(enrollment: CoachEnrollment): CoachSession[] {
  const sessions: CoachSession[] = []
  for (let day = 0; day < enrollment.weeks * 7; day++) {
    const date = addDays(enrollment.startedOn, day)
    if (!enrollment.weekdays.includes(new Date(dateTimestamp(date)).getDay() || 7)) continue
    const week = Math.floor(day / 7) + 1
    const base = enrollment.courseId === 'beginner' ? 3 : enrollment.level === 'new' ? 4 : 8
    const increment = enrollment.courseId === 'beginner' ? Math.floor((week - 1) / 2) : Math.floor((week - 1) / 3)
    sessions.push({ id: enrollment.id + ':' + date, enrollmentId: enrollment.id, date, week,
      targetMinutes: Math.min(base + increment, enrollment.courseId === 'beginner' ? 6 : 15) })
  }
  return sessions
}
export function sessionProgress(state: CoachState, session: CoachSession) {
  const workouts = state.workouts.filter(w => w.sessionId === session.id && w.enrollmentId === session.enrollmentId)
  const minutes = workouts.reduce((sum, w) => sum + w.minutes, 0)
  return { workouts, minutes, completed: minutes + 0.001 >= session.targetMinutes }
}
export function nextSession(state: CoachState, e: CoachEnrollment, today: string): CoachSession | undefined {
  // Missed days never become catch-up debt. Today and future days remain available.
  return state.sessions.filter(s => s.enrollmentId === e.id && s.date >= today && !s.skipped &&
    !sessionProgress(state, s).completed).sort((a, b) => a.date.localeCompare(b.date))[0]
}
export function weeklySummary(state: CoachState, e: CoachEnrollment, date: string) {
  const start = weekStart(date), end = addDays(start, 6)
  const sessions = state.sessions.filter(s => s.enrollmentId === e.id && s.date >= start && s.date <= end)
  const workouts = state.workouts.filter(w => w.enrollmentId === e.id && localDate(w.endedAt) >= start && localDate(w.endedAt) <= date)
  const readings = state.weighIns.filter(w => w.date >= start && w.date <= date)
  const prior = state.weighIns.filter(w => w.date >= addDays(start, -7) && w.date < start)
  const average = (values: CoachWeighIn[]) => values.reduce((sum, w) => sum + w.weightKg, 0) / values.length
  const weightChangeKg = readings.length >= 2 && prior.length >= 2 ? average(readings) - average(prior) : undefined
  const completed = sessions.filter(s => sessionProgress(state, s).completed).length
  const attempted = sessions.filter(s => sessionProgress(state, s).minutes > 0).length
  const minutes = workouts.reduce((sum, w) => sum + w.minutes, 0)
  const canIncrease = sessions.length > 0 && completed / sessions.length >= 0.8 &&
    workouts.length > 0 && workouts.every(w => w.effort === 'comfortable')
  return { start, end, planned: sessions.length, completed, attempted, minutes, readings: readings.length,
    weightChangeKg, canIncrease }
}
export function weightGoalReached(state: CoachState, e: CoachEnrollment, today: string): boolean {
  if (e.courseId !== 'weight' || e.goalMode !== 'lose' || !e.targetWeightKg) return false
  const readings = state.weighIns.filter(w => w.date >= e.startedOn && w.date >= addDays(today, -6) && w.date <= today)
  return readings.length >= 2 && readings.reduce((sum, w) => sum + w.weightKg, 0) / readings.length <= e.targetWeightKg
}
export function reviewAdvice(summary: ReturnType<typeof weeklySummary>, effort: CoachEffort): string {
  if (effort === 'unwell') return '先暂停爬楼；疼痛、胸闷、头晕或异常气短时停止运动，并寻求适合自己的专业建议。'
  if (effort === 'hard') return '后续减少上爬时间，多留恢复；漏练的课程不用补量。'
  if (!summary.planned) return '本周没有安排课程。先选好方便训练的日子。'
  if (summary.completed < summary.planned * 0.8) return '先保持或减轻安排，找到能坚持的节奏，不用加倍补练。'
  return '可以保持目前节奏；每次都感觉轻松时，再小幅增加。体重短期不变不代表需要加量。'
}
export function habitLesson(e: CoachEnrollment, week: number): { title: string; text: string } {
  if (e.courseId === 'beginner') return {
    title: ['先选一段好走的楼梯', '一步一级，找到节奏', '给恢复留足时间', '把舒服的节奏留下来'][Math.min(3, week - 1)],
    text: '楼梯要明亮、干燥、通风且有扶手。先平地热身，踏稳全脚掌，不跨级、不负重、不冲刺；需要时停下休息，结束后慢走缓和。',
  }
  if (e.courseId === 'cardio') return {
    title: '用熟悉的路线观察进步',
    text: '以能控制呼吸的步速上爬，分段完成，充分恢复。同路线表现只作自我比较；没有心率设备时不会推断心率或心肺评分。',
  }
  return [
    { title: '这一周，从一件小事开始', text: '选一个容易坚持的习惯：用白水替代含糖饮料、规律吃饭，或每坐一段时间起身活动。爬楼和饮食、睡眠一起影响长期体重。' },
    { title: '看趋势，给身体一点时间', text: '尽量在相近时间和条件下称重。单次体重会波动，至少每周记录一次；记录较密时比较周均值，不用因一天的变化加练或节食。' },
    { title: '把运动安排进生活', text: '爬楼之外也可以步行，并安排适合自己的力量练习。这些活动可补充总体运动量，本课程不会把未记录的活动计入成绩。' },
    { title: '达到目标后，继续照顾自己', text: '保持规律饮食和活动，持续记录体重。维持期允许自然波动；目标日期是复盘节点，不是必须达标的承诺。' },
  ][Math.floor((week - 1) / 2) % 4]
}
export function buildCoachWorkoutContext(state: CoachState, session: CoachSession, now: number): {
  remainingMinutes: number; coach: CoachWorkoutLink
} {
  const e = state.enrollments.find(v => v.id === session.enrollmentId)
  if (!e || (e.status !== 'active' && e.status !== 'maintaining')) throw new Error('课程已暂停或结束，请先返回教练页。')
  if (session.skipped || sessionProgress(state, session).completed) throw new Error('这次课程已完成或跳过，请选择下一次。')
  if (session.date !== localDate(now)) throw new Error('请在安排当天开始课程，漏练无需补量。')
  const remaining = Math.max(0.1, session.targetMinutes - sessionProgress(state, session).minutes)
  return { remainingMinutes: remaining, coach: { enrollmentId: e.id, courseId: e.courseId, sessionId: session.id,
    scheduledDate: session.date, targetMinutes: session.targetMinutes } }
}
export function workoutRecord(w: ClimbWorkout): CoachWorkoutRecord | undefined {
  // Fusion durationMs includes stationary time; only movement evidence advances a course.
  const activeMs = w.recognitionVersion === FUSION_RECOGNITION_VERSION
    ? w.rounds.reduce((sum, round) => sum + (Number.isFinite(round.activeMs) && round.activeMs! >= 0 ? round.activeMs! : 0), 0)
    : w.activeDurationMs
  if (!w.coach || w.status !== 'completed' || !Number.isFinite(activeMs) ||
      activeMs < 0 || !Number.isFinite(w.endedAt)) return undefined
  const floors = Number.isFinite(w.totalFloorsCompleted) ? Math.max(0, w.totalFloorsCompleted) : 0
  // A confirmed manual floor count can exist without motion-duration evidence.
  // Keep those floors visible, but never fabricate time or complete a timed course.
  if (activeMs === 0 && floors === 0) return undefined
  return { id: w.id, enrollmentId: w.coach.enrollmentId, sessionId: w.coach.sessionId, endedAt: w.endedAt!,
    minutes: activeMs / 60000, floors, routeId: w.templateId }
}

/** Reject damaged or newer data instead of silently replacing a user's health history. */
export function parseCoachState(value: unknown): CoachState {
  const fail = () => { throw new Error('教练数据无法读取，原始数据已保留。请重试或导出备份。') }
  if (!value || typeof value !== 'object') return fail()
  const s = value as CoachState
  if (s.version !== 1 || !['enrollments', 'sessions', 'weighIns', 'workouts', 'reviews'].every(k => Array.isArray((s as any)[k]))) return fail()
  const id = (v: any) => v && typeof v.id === 'string' && v.id.length > 0
  const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  if (s.enrollments.some(e => !id(e) || validateEnrollment(e) || !['active', 'paused', 'maintaining', 'completed'].includes(e.status) ||
      !['new', 'some'].includes(e.level) || !['lose', 'maintain'].includes(e.goalMode) || !number(e.updatedAt) || !number(e.createdAt))) return fail()
  if (s.sessions.some(v => !id(v) || typeof v.enrollmentId !== 'string' || !isDateKey(v.date) || !number(v.targetMinutes) ||
      v.targetMinutes <= 0 || v.targetMinutes > 60 || !Number.isInteger(v.week) || v.week < 1)) return fail()
  if (s.weighIns.some(v => !id(v) || !isDateKey(v.date) || !number(v.weightKg) || v.weightKg < 30 || v.weightKg > 250 || !number(v.updatedAt))) return fail()
  if (s.workouts.some(v => !id(v) || typeof v.enrollmentId !== 'string' || typeof v.sessionId !== 'string' ||
      !number(v.endedAt) || !number(v.minutes) || v.minutes < 0 || !number(v.floors) ||
      (v.effort !== undefined && !['comfortable', 'hard', 'unwell'].includes(v.effort)))) return fail()
  if (s.reviews.some(v => !id(v) || !isDateKey(v.weekStart) || !isDateKey(v.reviewedOn) ||
      typeof v.enrollmentId !== 'string' || !['easier', 'keep', 'increase'].includes(v.adjustment) ||
      !['comfortable', 'hard', 'unwell'].includes(v.effort) || !['steady', 'needs_attention'].includes(v.habit) ||
      typeof v.note !== 'string' || !number(v.createdAt) || !v.snapshot ||
      !number(v.snapshot.completed) || !number(v.snapshot.planned) || !number(v.snapshot.minutes))) return fail()
  for (const rows of [s.enrollments, s.sessions, s.weighIns, s.workouts, s.reviews]) {
    if (new Set(rows.map(v => v.id)).size !== rows.length) return fail()
  }
  if (s.enrollments.filter(e => e.status === 'active' || e.status === 'maintaining').length > 1) return fail()
  return s
}

export function mergeCoachStates(local: CoachState, incoming: CoachState): CoachState {
  const merge = <T extends { id: string }>(a: T[], b: T[]) => {
    const map = new Map(a.map(v => [v.id, v])); b.forEach(v => { if (!map.has(v.id)) map.set(v.id, v) }); return [...map.values()]
  }
  const active = activeEnrollment(local)
  const enrollments = merge(local.enrollments, incoming.enrollments.map(e =>
    active && e.id !== active.id && (e.status === 'active' || e.status === 'maintaining') ? { ...e, status: 'paused' as const } : e))
  // If the device had no active course, keep only the first imported active course.
  let foundActive = false
  const normalized = enrollments.map(e => {
    if (e.status !== 'active' && e.status !== 'maintaining') return e
    if (foundActive) return { ...e, status: 'paused' as const }
    foundActive = true; return e
  })
  return parseCoachState({ version: 1, enrollments: normalized, sessions: merge(local.sessions, incoming.sessions),
    weighIns: merge(local.weighIns, incoming.weighIns), workouts: merge(local.workouts, incoming.workouts),
    reviews: merge(local.reviews, incoming.reviews) })
}
