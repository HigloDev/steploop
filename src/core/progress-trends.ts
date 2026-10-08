// 进步趋势（D09）：周/月/季分桶、同路线 PB、周目标、归档文案。
//
// 口径单一来源（避免各处重复实现导致漂移）：
// - 新 PRD 记录（floorCounting='transitions'）以真实完成的楼层差计入普通累计，
//   包括早停、用户确认/修正和低置信度；它们不能因为算法不可信而失去实际成果。
// - 未标新口径的旧记录继续 D06「有效训练」语义。个人最佳独立使用严格的
//   `isEligiblePersonalBestWorkout`，保持无修正、无中断、算法可信的规则。
// - 每条训练的总量用 `calculateWorkoutSummary`（结果页/历史卡片同一实现），
//   所以「同一轮在趋势与历史详情里的楼层数相同」。
// - 时区：桶起点完全由 `timeZoneOffsetMinutes` 决定（东为正，UTC+8 = 480）；
//   不传时使用运行机器本地时区（与 `startOfLocalWeek` 同一口径）。
//   测试一律显式传 offset，禁止依赖运行机器时区。
// - 统计不静默丢数据：`auditTrend()` 给出输入条数的完整去向
//   （计入 / 修正 / 无效 / 重复 / 结构无效 / 时间无效 / 窗口外），且等于输入总数。
//
// 纯函数，无 IO、无依赖注入；UI 只做展示。

import { isRoundLearnable } from './corrections'
import { getFloorTransitionCount } from './floors'
import { ClimbWorkout } from './types'
import { calculateWorkoutSummary } from './workout-summary'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

/**
 * 单次 `buildTrend` 允许生成的桶数上限（防御性上限，正常页面窗口远小于它）。
 * 超过上限时在 `auditTrend().truncated / truncatedInWindow` 里如实反映，不静默截断。
 */
const MAX_TREND_BUCKETS = 20_000

// ---------------------------------------------------------------------------
// 对外类型（合同冻结接口）
// ---------------------------------------------------------------------------

export type TrendBucket = 'week' | 'month' | 'quarter'

/** 被排除的记录数与原因计数（不得静默）。 */
export interface TrendExclusionCounts {
  /** 旧口径修正记录、或不满足普通累计条件的修正记录数。 */
  corrected: number
  /**
   * 其余无法计入的记录数：结构残缺（缺 id / rounds 非数组）、未完成、
   * 以及不可信的完整训练（含中断、置信度 < 0.8、trustworthy=false、manual/recovered）。
   */
  invalid: number
  /** 同一 sessionId 重复写入、只保留一条后被丢弃的条数。 */
  duplicate: number
}

export interface TrendPoint {
  /** 桶起始的本地时间戳（周一为一周起点；月/季为当月/当季 1 日 00:00 本地时间）。 */
  bucketStart: number
  label: string
  /** 计入的有效训练数。 */
  workouts: number
  floors: number
  ascentM: number
  activeDurationMs: number
  bestRoundMs?: number
  /** 该桶内被排除的记录数与原因计数（不得静默）。 */
  excluded: TrendExclusionCounts
}

export interface BuildTrendOptions {
  bucket: TrendBucket
  fromMs: number
  toMs: number
  /** 本地时区相对 UTC 的分钟偏移（东为正，如 UTC+8 = 480）。缺省用运行机器本地时区。 */
  timeZoneOffsetMinutes?: number
}

/**
 * 输入去向审计：`inputCount === unknownRecords + unbucketed + outsideRange +
 * counted + excluded.{corrected,invalid,duplicate} + truncatedInWindow`。
 * 任何一条输入都必须落在其中一个计数里（不得静默丢弃）。
 */
export interface TrendAudit {
  points: TrendPoint[]
  inputCount: number
  counted: number
  excluded: TrendExclusionCounts
  /** 结构无效（非对象 / 缺 id / rounds 非数组）：无法当作训练记录。 */
  unknownRecords: number
  /** 结构有效但参考时间无效：无法归入任何桶。 */
  unbucketed: number
  /** 参考时间在 [fromMs, toMs] 之外：不属于本次窗口（不是被过滤）。 */
  outsideRange: number
  /** 桶数被上限截断时窗口内无法落桶的条数（正常为 0）。 */
  truncatedInWindow: number
  truncated: boolean
}

export interface RoutePersonalBest {
  templateId: string
  bestRoundMs?: number
  bestWorkoutAscentM?: number
  bestWorkoutFloors?: number
  achievedAtMs?: number
  /** 是否来自被人工修正过的训练（修正过的成绩不得当 PB，除非显式允许）。 */
  fromCorrected: boolean
}

export interface WeekGoalProgress {
  weekStart: number
  targetWorkouts?: number
  targetFloors?: number
  targetAscentM?: number
  doneWorkouts: number
  doneFloors: number
  doneAscentM: number
  achieved: boolean
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function nonNegativeInt(value: unknown): number {
  return isFiniteNumber(value) ? Math.max(0, Math.round(value)) : 0
}

function pad2(value: number): string {
  return `${value}`.padStart(2, '0')
}

/**
 * 本地周起点（周一 00:00 本地时间）。与 D06 `training-progress.startOfLocalWeek` 同一实现，
 * 由 `training-progress` 转出，保证两处不会漂移。
 */
export function startOfLocalWeek(atMs: number): number {
  const date = new Date(atMs)
  const day = (date.getDay() + 6) % 7
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - day)
  return date.getTime()
}

/** 结构最小有效判定：非数组对象 + 非空字符串 id + rounds 是数组。 */
function isRecordShaped(value: unknown): value is ClimbWorkout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as { id?: unknown; rounds?: unknown }
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    Array.isArray(candidate.rounds)
  )
}

function roundsOf(workout: ClimbWorkout): ClimbWorkout['rounds'] {
  return Array.isArray(workout.rounds) ? workout.rounds : []
}

/**
 * 记录归属桶的参考时间：优先起点（与 D06 周累计按 startedAt 归属一致），
 * 旧记录缺 startedAt 时按结束/更新/创建时间回落，避免因为字段缺失丢掉整条记录。
 * 全部无效时返回 0（调用方计入 `unbucketed`）。
 */
function trendReferenceTime(workout: ClimbWorkout): number {
  const candidates = [
    workout.startedAt,
    workout.endedAt,
    workout.updatedAt,
    workout.createdAt,
  ]
  for (const candidate of candidates) {
    if (isFiniteNumber(candidate) && candidate > 0) return candidate
  }
  return 0
}

function hasInterruption(round: ClimbWorkout['rounds'][number]): boolean {
  return (round?.interruptions?.length ?? 0) > 0
}

function roundConfidence(round: ClimbWorkout['rounds'][number]): number {
  return isFiniteNumber(round?.confidence) ? round.confidence : 0
}

/** 是否存在人工修正链（D06 修正链非空）。 */
export function hasCorrectionChain(workout: ClimbWorkout): boolean {
  return roundsOf(workout).some(
    (round) =>
      !!round &&
      ((round.corrections?.length ?? 0) > 0 || (round.userCorrectionCount ?? 0) > 0),
  )
}

/** 结构/可信健康度：完成状态 + 至少一轮完成 + 无中断 + 置信度达标（不含「是否被修正」）。 */
function isStructurallyHealthy(workout: ClimbWorkout): boolean {
  if (!isRecordShaped(workout)) return false
  const rounds = roundsOf(workout)
  const completeRounds = rounds.filter((round) => round?.complete === true)
  return (
    workout.status === 'completed' &&
    completeRounds.length > 0 &&
    rounds.every((round) => !!round && !hasInterruption(round) && roundConfidence(round) >= 0.8)
  )
}

/** Strict PB eligibility remains independent of ordinary user accomplishments. */
export function isEligiblePersonalBestWorkout(workout: ClimbWorkout): boolean {
  if (!isStructurallyHealthy(workout)) return false
  if (workout.floorCounting === 'transitions' && !hasRecordedClimb(workout)) return false
  return roundsOf(workout).every((round) => isRoundLearnable(round))
}

function hasRecordedClimb(workout: ClimbWorkout): boolean {
  const rounds = roundsOf(workout)
  return rounds.every((round) => !!round && isFiniteNumber(round.startFloor) && isFiniteNumber(round.finalFloor)) &&
    rounds.some((round) => round.floorConfirmation !== 'pending' && getFloorTransitionCount(round.startFloor, round.finalFloor) > 0)
}

/** Ordinary progress trusts the user's saved floor confirmation, independently of PB/model trust. */
export function isEligibleTrendWorkout(workout: ClimbWorkout): boolean {
  if (!isRecordShaped(workout)) return false
  if (workout.floorCounting !== 'transitions') return isEligiblePersonalBestWorkout(workout)
  return workout.status === 'completed' && hasRecordedClimb(workout)
}

/** 被排除训练的原因分类：修正链非空 → 'corrected'，其余 → 'invalid'（首因判定）。 */
export function classifyTrendExclusion(workout: ClimbWorkout): 'corrected' | 'invalid' {
  return hasCorrectionChain(workout) ? 'corrected' : 'invalid'
}

interface ShapedWorkout {
  workout: ClimbWorkout
  atMs: number
}

interface DuplicateResolution {
  /** 同 id 组内被选中的那条（在 shaped 数组中的下标）；下标与 shaped 一一对应。 */
  survivorIndex: number[]
}

function copyRank(entry: ShapedWorkout): { updatedAt: number; atMs: number } {
  const updatedAt = isFiniteNumber(entry.workout.updatedAt) ? entry.workout.updatedAt : -1
  return { updatedAt, atMs: entry.atMs }
}

/** 同 id 组内保留「最后一次写入」：updatedAt 更大者胜；平手取参考时间更晚者；再平手保留先出现者。 */
function isPreferredCopy(candidate: ShapedWorkout, incumbent: ShapedWorkout): boolean {
  const a = copyRank(candidate)
  const b = copyRank(incumbent)
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt
  if (a.atMs !== b.atMs) return a.atMs > b.atMs
  return false
}

function collectShaped(workouts: unknown): {
  shaped: ShapedWorkout[]
  unknownRecords: number
  unbucketed: number
} {
  const input = Array.isArray(workouts) ? workouts : []
  const shaped: ShapedWorkout[] = []
  let unknownRecords = 0
  let unbucketed = 0
  input.forEach((item) => {
    if (!isRecordShaped(item)) {
      unknownRecords += 1
      return
    }
    const atMs = trendReferenceTime(item)
    if (!(atMs > 0)) {
      unbucketed += 1
      return
    }
    shaped.push({ workout: item, atMs })
  })
  return { shaped, unknownRecords, unbucketed }
}

/** 去重（同一 sessionId 只保留一条），结果与数组顺序无关（由 updatedAt / 参考时间决定）。 */
function resolveDuplicates(shaped: ShapedWorkout[]): DuplicateResolution {
  const survivorById = new Map<string, number>()
  shaped.forEach((entry, index) => {
    const incumbent = survivorById.get(entry.workout.id)
    if (incumbent === undefined) {
      survivorById.set(entry.workout.id, index)
      return
    }
    if (isPreferredCopy(entry, shaped[incumbent])) {
      survivorById.set(entry.workout.id, index)
    }
  })
  const survivorIndex = shaped.map((entry) => survivorById.get(entry.workout.id) ?? 0)
  return { survivorIndex }
}

interface WorkoutTrendTotals {
  floors: number
  ascentM: number
  activeDurationMs: number
  bestRoundMs?: number
}

/** 单条训练口径：与结果页/历史卡片共用 `calculateWorkoutSummary`。 */
function workoutTrendTotals(workout: ClimbWorkout): WorkoutTrendTotals {
  const startedAt = isFiniteNumber(workout.startedAt) ? workout.startedAt : 0
  const rounds = workout.floorCounting === 'transitions'
    ? roundsOf(workout).map((round) => ({
      ...round,
      floorCounting: 'transitions' as const,
      ascentM: isFiniteNumber(round.ascentM) ? Math.max(0, round.ascentM) : 0,
      durationMs: isFiniteNumber(round.durationMs) ? Math.max(0, round.durationMs) : 0,
      steps: isFiniteNumber(round.steps) ? Math.max(0, round.steps) : 0,
    }))
    : roundsOf(workout)
  const summary = calculateWorkoutSummary(rounds, startedAt, workout.endedAt)
  return {
    floors: summary.totalFloors,
    ascentM: summary.totalAscentM,
    activeDurationMs: summary.activeDurationMs,
    bestRoundMs: summary.bestRoundMs,
  }
}

function emptyExclusions(): TrendExclusionCounts {
  return { corrected: 0, invalid: 0, duplicate: 0 }
}

// ---------------------------------------------------------------------------
// 时区与桶
// ---------------------------------------------------------------------------

interface Zone {
  startOf(bucket: TrendBucket, atMs: number): number
  next(bucket: TrendBucket, bucketStart: number): number
  previous(bucket: TrendBucket, bucketStart: number): number
  label(bucket: TrendBucket, bucketStart: number): string
}

/** 运行机器本地时区（与 `startOfLocalWeek` 同一口径，用本地日历字段，DST 由 Date 处理）。 */
function localZone(): Zone {
  const startOf = (bucket: TrendBucket, atMs: number): number => {
    const date = new Date(atMs)
    if (bucket === 'week') return startOfLocalWeek(atMs)
    if (bucket === 'month') {
      date.setDate(1)
      date.setHours(0, 0, 0, 0)
      return date.getTime()
    }
    date.setMonth(Math.floor(date.getMonth() / 3) * 3, 1)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  const shift = (bucket: TrendBucket, bucketStart: number, direction: 1 | -1): number => {
    const date = new Date(bucketStart)
    if (bucket === 'week') date.setDate(date.getDate() + 7 * direction)
    else if (bucket === 'month') date.setMonth(date.getMonth() + direction, 1)
    else date.setMonth(date.getMonth() + 3 * direction, 1)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  return {
    startOf,
    next: (bucket, bucketStart) => shift(bucket, bucketStart, 1),
    previous: (bucket, bucketStart) => shift(bucket, bucketStart, -1),
    label: (bucket, bucketStart) => {
      const date = new Date(bucketStart)
      const year = date.getFullYear()
      const month = date.getMonth() + 1
      if (bucket === 'week') {
        const iso = isoWeekOf(year, month, date.getDate())
        return `${iso.year}-W${pad2(iso.week)}`
      }
      if (bucket === 'month') return `${year}-${pad2(month)}`
      return `${year}-Q${Math.floor((month - 1) / 3) + 1}`
    },
  }
}

/** 固定偏移时区（东为正）：位移到 UTC 后按 UTC 日历字段计算，因此与时区数据库无关。 */
function fixedZone(offsetMinutes: number): Zone {
  const shiftMs = Math.round(offsetMinutes) * MINUTE_MS
  const civil = (atMs: number): Date => new Date(atMs + shiftMs)
  const startOf = (bucket: TrendBucket, atMs: number): number => {
    const date = civil(atMs)
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth()
    if (bucket === 'week') {
      const day = (date.getUTCDay() + 6) % 7
      return Date.UTC(year, month, date.getUTCDate() - day) - shiftMs
    }
    if (bucket === 'month') return Date.UTC(year, month, 1) - shiftMs
    return Date.UTC(year, Math.floor(month / 3) * 3, 1) - shiftMs
  }
  const shift = (bucket: TrendBucket, bucketStart: number, direction: 1 | -1): number => {
    const date = civil(bucketStart)
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth()
    if (bucket === 'week') {
      return Date.UTC(year, month, date.getUTCDate() + 7 * direction) - shiftMs
    }
    if (bucket === 'month') return Date.UTC(year, month + direction, 1) - shiftMs
    return Date.UTC(year, month + 3 * direction, 1) - shiftMs
  }
  return {
    startOf,
    next: (bucket, bucketStart) => shift(bucket, bucketStart, 1),
    previous: (bucket, bucketStart) => shift(bucket, bucketStart, -1),
    label: (bucket, bucketStart) => {
      const date = civil(bucketStart)
      const year = date.getUTCFullYear()
      const month = date.getUTCMonth() + 1
      if (bucket === 'week') {
        const iso = isoWeekOf(year, month, date.getUTCDate())
        return `${iso.year}-W${pad2(iso.week)}`
      }
      if (bucket === 'month') return `${year}-${pad2(month)}`
      return `${year}-Q${Math.floor((month - 1) / 3) + 1}`
    },
  }
}

function resolveZone(timeZoneOffsetMinutes?: number): Zone {
  return isFiniteNumber(timeZoneOffsetMinutes)
    ? fixedZone(timeZoneOffsetMinutes)
    : localZone()
}

/** ISO 8601 周号（周一为一周起点，Thursday 规则）。日期字段来自调用方已解析的本地日历。 */
function isoWeekOf(year: number, month: number, day: number): { year: number; week: number } {
  const date = new Date(Date.UTC(year, month - 1, day))
  const dayNumber = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dayNumber + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3)
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / WEEK_MS)
  return { year: date.getUTCFullYear(), week }
}

// ---------------------------------------------------------------------------
// 趋势分桶
// ---------------------------------------------------------------------------

/**
 * 分桶并返回逐桶统计 + 输入去向审计。
 * - 窗口 [fromMs, toMs] 内的每个桶都会出现（含空桶：workouts=0），标签连续、不跳桶。
 * - 窗口外记录计入 `outsideRange`（不是被过滤掉的数据）。
 * - 空周/空月/空季仍然返回；`fromMs > toMs` 或非有限时返回空数组（不抛异常）。
 */
export function auditTrend(workouts: unknown, options: BuildTrendOptions): TrendAudit {
  const bucket: TrendBucket = options?.bucket ?? 'week'
  const zone = resolveZone(options?.timeZoneOffsetMinutes)
  const fromMs = options?.fromMs
  const toMs = options?.toMs
  const hasRange =
    isFiniteNumber(fromMs) && isFiniteNumber(toMs) && toMs >= fromMs

  const points: TrendPoint[] = []
  const pointByStart = new Map<number, TrendPoint>()
  let truncated = false
  if (hasRange) {
    const last = zone.startOf(bucket, toMs)
    let cursor = zone.startOf(bucket, fromMs)
    while (cursor <= last) {
      if (points.length >= MAX_TREND_BUCKETS) {
        truncated = true
        break
      }
      const point: TrendPoint = {
        bucketStart: cursor,
        label: zone.label(bucket, cursor),
        workouts: 0,
        floors: 0,
        ascentM: 0,
        activeDurationMs: 0,
        bestRoundMs: undefined,
        excluded: emptyExclusions(),
      }
      points.push(point)
      pointByStart.set(cursor, point)
      const next = zone.next(bucket, cursor)
      // 防御：非法日历运算导致不前进时停止，不进入死循环（并在审计里暴露）。
      if (!(next > cursor)) {
        truncated = true
        break
      }
      cursor = next
    }
  }

  const { shaped, unknownRecords, unbucketed } = collectShaped(workouts)
  const { survivorIndex } = resolveDuplicates(shaped)

  const excluded = emptyExclusions()
  let counted = 0
  let outsideRange = 0
  let truncatedInWindow = 0

  shaped.forEach((entry, index) => {
    if (!hasRange || entry.atMs < fromMs || entry.atMs > toMs) {
      outsideRange += 1
      return
    }
    const point = pointByStart.get(zone.startOf(bucket, entry.atMs))
    if (!point) {
      // 只可能发生在达到桶数上限时；如实计数，不静默丢弃。
      truncatedInWindow += 1
      return
    }
    if (survivorIndex[index] !== index) {
      excluded.duplicate += 1
      point.excluded.duplicate += 1
      return
    }
    if (!isEligibleTrendWorkout(entry.workout)) {
      const reason = classifyTrendExclusion(entry.workout)
      excluded[reason] += 1
      point.excluded[reason] += 1
      return
    }
    const totals = workoutTrendTotals(entry.workout)
    counted += 1
    point.workouts += 1
    point.floors += totals.floors
    point.ascentM += totals.ascentM
    point.activeDurationMs += totals.activeDurationMs
    if (
      isEligiblePersonalBestWorkout(entry.workout) &&
      isFiniteNumber(totals.bestRoundMs) &&
      (point.bestRoundMs === undefined || totals.bestRoundMs < point.bestRoundMs)
    ) {
      point.bestRoundMs = totals.bestRoundMs
    }
  })

  return {
    points,
    inputCount: Array.isArray(workouts) ? workouts.length : 0,
    counted,
    excluded,
    unknownRecords,
    unbucketed,
    outsideRange,
    truncatedInWindow,
    truncated,
  }
}

/** 周/月/季趋势（合同接口）。`auditTrend` 提供同一份结果的输入去向审计。 */
export function buildTrend(
  workouts: ClimbWorkout[],
  options: BuildTrendOptions,
): TrendPoint[] {
  return auditTrend(workouts, options).points
}

/**
 * 「最近 span 个桶」窗口：终点是 `now`（当前未结束的桶也算在内），起点是当前桶往前
 * `span - 1` 个桶的起点。窗口端点属于展示范围，不是统计口径，所以由调用方给 span。
 */
export function recentTrendWindow(
  bucket: TrendBucket,
  span: number,
  now = Date.now(),
  timeZoneOffsetMinutes?: number,
): { fromMs: number; toMs: number } {
  const zone = resolveZone(timeZoneOffsetMinutes)
  const count = Math.max(1, Math.floor(isFiniteNumber(span) ? span : 1))
  let fromMs = zone.startOf(bucket, now)
  for (let index = 1; index < count; index += 1) {
    fromMs = zone.previous(bucket, fromMs)
  }
  return { fromMs, toMs: now }
}

// ---------------------------------------------------------------------------
// 同路线 PB
// ---------------------------------------------------------------------------

/** 该训练的时间（用于 achievedAtMs）：结束时间优先，旧记录回落。 */
function achievementTime(workout: ClimbWorkout): number | undefined {
  const candidates = [workout.endedAt, workout.updatedAt, workout.startedAt, workout.createdAt]
  for (const candidate of candidates) {
    if (isFiniteNumber(candidate) && candidate > 0) return candidate
  }
  return undefined
}

/**
 * 同路线 PB：每条路线一条，取「单轮最快用时最短」的一次训练（`bestRoundMs` 最小），
 * 并把该次训练的整体成绩一并返回，避免出现「用时来自 A、楼层来自 B」的拼接记录。
 * - 默认只考虑 `isEligiblePersonalBestWorkout` 的训练（修正过的成绩不得当 PB）。
 * - `allowCorrected: true` 时放行「有修正链但其余健康」的训练，并标记 `fromCorrected: true`。
 * - 同一 sessionId 重复写入先按 `updatedAt` 去重（与趋势同一口径）。
 */
export function computeRoutePersonalBests(
  workouts: ClimbWorkout[],
  options: { allowCorrected?: boolean } = {},
): RoutePersonalBest[] {
  const allowCorrected = options?.allowCorrected === true
  const { shaped } = collectShaped(workouts)
  const { survivorIndex } = resolveDuplicates(shaped)

  const best = new Map<string, RoutePersonalBest>()
  shaped.forEach((entry, index) => {
    if (survivorIndex[index] !== index) return
    const workout = entry.workout
    const eligible = isEligiblePersonalBestWorkout(workout)
    const corrected = hasCorrectionChain(workout)
    if (!eligible && !(allowCorrected && corrected && isStructurallyHealthy(workout))) {
      return
    }
    const totals = workoutTrendTotals(workout)
    // 没有完整轮（bestRoundMs 缺失）或净用时为 0 的「成绩」不能作为 PB。
    if (!isFiniteNumber(totals.bestRoundMs) || totals.bestRoundMs <= 0) return
    const candidate: RoutePersonalBest = {
      templateId: workout.templateId,
      bestRoundMs: totals.bestRoundMs,
      bestWorkoutAscentM: totals.ascentM,
      bestWorkoutFloors: totals.floors,
      achievedAtMs: achievementTime(workout),
      fromCorrected: corrected,
    }
    const previous = best.get(workout.templateId)
    if (!previous) {
      best.set(workout.templateId, candidate)
      return
    }
    const previousRound = previous.bestRoundMs ?? Number.POSITIVE_INFINITY
    const candidateRound = candidate.bestRoundMs ?? Number.POSITIVE_INFINITY
    if (candidateRound < previousRound) {
      best.set(workout.templateId, candidate)
      return
    }
    if (candidateRound === previousRound) {
      // 平手时取更早达成的一次，保证结果与输入顺序无关。
      const previousAt = previous.achievedAtMs ?? Number.POSITIVE_INFINITY
      const candidateAt = candidate.achievedAtMs ?? Number.POSITIVE_INFINITY
      if (candidateAt < previousAt) best.set(workout.templateId, candidate)
    }
  })

  return [...best.values()].sort((a, b) => a.templateId.localeCompare(b.templateId))
}

// ---------------------------------------------------------------------------
// 周目标
// ---------------------------------------------------------------------------

/** 目标值：只在「有限且 > 0」时视为已设置；未设置/非法（含 0）一律返回 undefined 而不是 0。 */
function normalizeTarget(value: unknown): number | undefined {
  if (!isFiniteNumber(value) || value <= 0) return undefined
  return value
}

/**
 * 本周目标进度（本地周，周一 00:00 起；口径与趋势桶一致：去重 + 有效训练）。
 * - 三个维度各自判定：只有「已设置的目标」全部达成才算 `achieved=true`。
 * - 一个目标都没设置时 `achieved=false`（没有目标就不是「已达成」），且目标字段为 undefined。
 */
export function computeWeekGoal(
  workouts: ClimbWorkout[],
  goal: { targetWorkouts?: number; targetFloors?: number; targetAscentM?: number },
  now = Date.now(),
): WeekGoalProgress {
  const weekStart = startOfLocalWeek(now)
  const weekEnd = weekStart + WEEK_MS - 1
  const { shaped } = collectShaped(workouts)
  const { survivorIndex } = resolveDuplicates(shaped)

  let doneWorkouts = 0
  let doneFloors = 0
  let doneAscentM = 0
  shaped.forEach((entry, index) => {
    if (survivorIndex[index] !== index) return
    if (entry.atMs < weekStart || entry.atMs > weekEnd) return
    if (!isEligibleTrendWorkout(entry.workout)) return
    const totals = workoutTrendTotals(entry.workout)
    doneWorkouts += 1
    doneFloors += totals.floors
    doneAscentM += totals.ascentM
  })

  const targetWorkouts = normalizeTarget(goal?.targetWorkouts)
  const targetFloors = normalizeTarget(goal?.targetFloors)
  const targetAscentM = normalizeTarget(goal?.targetAscentM)
  const dimensions: Array<boolean | undefined> = [
    targetWorkouts === undefined ? undefined : doneWorkouts >= targetWorkouts,
    targetFloors === undefined ? undefined : doneFloors >= targetFloors,
    targetAscentM === undefined ? undefined : doneAscentM >= targetAscentM,
  ]
  const judged = dimensions.filter((value): value is boolean => value !== undefined)
  return {
    weekStart,
    targetWorkouts,
    targetFloors,
    targetAscentM,
    doneWorkouts,
    doneFloors,
    doneAscentM,
    achieved: judged.length > 0 && judged.every(Boolean),
  }
}

// ---------------------------------------------------------------------------
// 归档文案（验收 4b）：纯函数决定文案，页面只展示
// ---------------------------------------------------------------------------

/** 归档文案所需的三个数字，全部原样来自 `historyRepository.summarize()`。 */
export interface ArchiveSummaryLike {
  trimmedTotal: number
  aggregatesIncludeTrimmed: boolean
  retainedWorkoutCount: number
}

export interface ArchiveNotice {
  text: string
  /** 归档条数（原样来自 summarize()，页面不得重算）。 */
  trimmedTotal: number
  /** 仍保留明细的训练条数（原样来自 summarize()）。 */
  retainedWorkoutCount: number
}

/**
 * 由 `summarize()` 的三个字段生成「更早的记录已归档为统计」文案。
 * - 未发生归档（trimmedTotal<=0）返回 undefined：页面不显示任何容量/归档提示。
 * - 不使用「丢弃/删除」措辞：归档记录的贡献仍在长期累计里。
 * - `aggregatesIncludeTrimmed !== true` 时如实说明长期累计尚未确认覆盖全部归档记录。
 */
export function describeArchiveNotice(
  summary: ArchiveSummaryLike | undefined | null,
): ArchiveNotice | undefined {
  if (!summary || typeof summary !== 'object') return undefined
  const trimmedTotal = nonNegativeInt(summary.trimmedTotal)
  if (trimmedTotal <= 0) return undefined
  const retainedWorkoutCount = nonNegativeInt(summary.retainedWorkoutCount)
  const text =
    summary.aggregatesIncludeTrimmed === true
      ? `更早的 ${trimmedTotal} 条记录已归档为统计：明细已裁剪，但次数/楼层/爬升/时长/按天分桶仍计入长期累计；当前保留明细 ${retainedWorkoutCount} 条。`
      : `更早的 ${trimmedTotal} 条记录已归档为统计：明细已裁剪，长期累计尚未确认覆盖全部归档记录（统计口径可能偏小）；当前保留明细 ${retainedWorkoutCount} 条。`
  return { text, trimmedTotal, retainedWorkoutCount }
}
