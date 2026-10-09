import AsyncStorage from '@react-native-async-storage/async-storage'
import { ClimbSession, ClimbWorkout } from '../core/types'
import {
  COLLECTION_KEYS,
  abandonJournal,
  assertCollectionKeys,
  beginScopedJournal,
  commitScopedJournal,
  recoverPendingJournal,
  runSerial,
} from './storage-journal'

/**
 * 历史记录 repository（D08a）。
 *
 * 目标与边界：
 * - **不引入新依赖**：存储引擎仍是 AsyncStorage；D08b 才会把引擎换成 expo-sqlite，
 *   本文件导出的接口就是那时必须保持不变的签名。
 * - 原始明细（ClimbWorkout / ClimbSession 列表）继续写在既有键
 *   `palou.workouts.v1` / `palou.sessions.v1` 上，旧数据无需转换即可读。
 * - 容量策略（原先的 100 条上限）不再是「静默删除」：
 *   被裁剪/删除的记录条数写入计数，且它们的**统计贡献**
 *   （次数/楼层/爬升/净时长/按天分桶）永久保留在增量聚合键
 *   `palou.historyAgg.v1` 里，因此 `summarize()` 覆盖全部历史。
 * - 不变量：`retained + trimmedTotal + removedTotal === writtenTotal`
 *   （写入总数 = 累计进入保留集合的写入事件数）。
 * - 明细与聚合是**两个键**，用 scoped 操作日志成对写入：任一步失败/进程被杀都回滚到
 *   操作前状态，不会出现「明细裁掉了、统计没记上」的静默丢失。
 * - 单条损坏数据只跳过并计数（`skippedCorrupt`），绝不因为一条坏数据清空集合；
 *   整个键不可解析时先把原始内容复制到隔离键，再继续，绝不静默丢弃。
 */

export const HISTORY_WORKOUTS_KEY = 'palou.workouts.v1'
export const HISTORY_SESSIONS_KEY = 'palou.sessions.v1'
export const HISTORY_META_KEY = 'palou.storageMeta.v1'
/** 增量聚合（永久保留）键：D08a 新增，迁移只新增键、不改旧键语义。 */
export const HISTORY_AGG_KEY = 'palou.historyAgg.v1'
/** 无法解析的旧键原始内容隔离区（架构文档要求「损坏项进入可导出隔离」）。 */
export const HISTORY_QUARANTINE_KEY = 'palou.historyQuarantine.v1'
export const HISTORY_MIGRATION_KEY = 'palou.historyMigration.v1'
export const HISTORY_ROLLBACK_KEY = 'palou.historyRollback.v1'

// 集合键仍以 storage-journal 为唯一来源，避免日志与实际写入的键漂移。
assertCollectionKeys({
  routes: COLLECTION_KEYS.routes,
  sessions: HISTORY_SESSIONS_KEY,
  workouts: HISTORY_WORKOUTS_KEY,
})

export const HISTORY_SCHEMA_VERSION = 2
export const HISTORY_WORKOUT_LIMIT = 100
export const HISTORY_SESSION_LIMIT = 100

const QUARANTINE_ENTRY_LIMIT = 5
const QUARANTINE_RAW_LIMIT = 64 * 1024
const CORRUPT_REASON_LIMIT = 20

// ---------------------------------------------------------------------------
// 冻结接口（D08a 实现；D08b 只替换实现，不改签名）
// ---------------------------------------------------------------------------

export interface HistoryPage<T> {
  items: T[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

export interface HistoryQuery {
  offset?: number
  limit?: number
  fromMs?: number
  toMs?: number
  templateId?: string
  order?: 'newest' | 'oldest'
}

export interface HistorySummary {
  /** 累计写入过的训练数（含原始记录已被裁剪的部分），来自增量聚合。 */
  workoutCount: number
  sessionCount: number
  /** 累计楼层/爬升/净时长（含已裁剪部分）。 */
  totalFloors: number
  totalAscentM: number
  totalActiveDurationMs: number
  firstAtMs?: number
  lastAtMs?: number
  /** 按天分桶（本地时区），来自增量聚合，含已裁剪部分。 */
  byDay: Record<string, { workouts: number; floors: number }>
  /** 当前仍保留原始明细的最早时间；被裁剪过则为裁剪后的最早一条。 */
  earliestKeptAtMs?: number
  /** 累计被裁剪的原始记录条数（meta 计数，不再静默）。 */
  trimmedTotal: number
  /** 仍保留原始明细的条数。 */
  retainedWorkoutCount: number
  /** 聚合是否包含已裁剪记录（正常应为 true）。 */
  aggregatesIncludeTrimmed: boolean
  /** 读取时跳过的损坏条数（不得因为坏条清空集合）。 */
  skippedCorrupt: number
  // --- 以下是 D08a 追加的可选诊断字段（契约允许加字段） ---
  /** 仍保留原始明细的会话条数。 */
  retainedSessionCount: number
  /** 累计写入事件数（retained + trimmedTotal + removedTotal）。 */
  writtenTotal: number
  /** 因删除/替换/恢复快照而离开保留集合的条数（非容量裁剪）。 */
  removedTotal: number
  /** 被计入 trimmedTotal/removedTotal 但缺少明细贡献的条数（例如 D08a 之前的旧裁剪）。 */
  trimmedWithoutDetail: number
  /** 读取时自动纠正的计数漂移（一次失败写入后的自愈量，正常为 0）。 */
  reconciledDrift: number
}

export interface HistoryMigrationStatus {
  schemaVersion: number
  migratedAt?: number
  /** 'none' | 'running' | 'done' | 'failed' */
  state: 'none' | 'running' | 'done' | 'failed'
  lastError?: string
  /** 迁移前的原始快照键是否存在（回滚依据）。 */
  hasRollbackSnapshot: boolean
}

export interface HistoryRepository {
  listWorkouts(query?: HistoryQuery): Promise<HistoryPage<ClimbWorkout>>
  getWorkout(id: string): Promise<ClimbWorkout | undefined>
  saveWorkout(workout: ClimbWorkout): Promise<{ trimmed: number; total: number }>
  deleteWorkout(id: string): Promise<void>
  listSessions(query?: HistoryQuery): Promise<HistoryPage<ClimbSession>>
  getSession(id: string): Promise<ClimbSession | undefined>
  saveSession(session: ClimbSession): Promise<{ trimmed: number; total: number }>
  deleteSession(id: string): Promise<void>
  /** 长期摘要：不依赖全量读取，用于历史页/进步页的汇总。 */
  summarize(): Promise<HistorySummary>
  /** 迁移状态（用于 UI 与诊断）。 */
  migrationStatus(): Promise<HistoryMigrationStatus>
}

// ---------------------------------------------------------------------------
// 索引与聚合数据结构
// ---------------------------------------------------------------------------

export type HistoryCollection = 'sessions' | 'workouts'

export const HISTORY_COLLECTIONS: HistoryCollection[] = ['workouts', 'sessions']

export const HISTORY_COLLECTION_KEYS: Record<HistoryCollection, string> = {
  sessions: HISTORY_SESSIONS_KEY,
  workouts: HISTORY_WORKOUTS_KEY,
}

export const HISTORY_COLLECTION_LIMITS: Record<HistoryCollection, number> = {
  sessions: HISTORY_SESSION_LIMIT,
  workouts: HISTORY_WORKOUT_LIMIT,
}

interface DayBucket {
  workouts: number
  floors: number
}

interface HistoryRecordMetrics {
  id: string
  floors: number
  ascentM: number
  activeDurationMs: number
  /** 归属日期/顺序用的时间戳（记录自身的时间，不取「写入时刻」）。 */
  atMs: number
}

/**
 * 每个集合的账本：只保存**已离开保留集合**的记录贡献 + 计数。
 * 仍保留的明细贡献在 summarize() 时按实际内容现算（live），所以明细更新不需要动账本。
 */
interface CollectionLedger {
  /** 累计写入事件数（进入保留集合的写入次数，含后来被裁剪的）。 */
  writtenTotal: number
  /** 因容量策略被裁剪的条数（写入 meta 计数，不再静默）。 */
  trimmedTotal: number
  /** 因删除/替换/恢复快照离开保留集合的条数。 */
  removedTotal: number
  /** 已把明细贡献记入账本的离开记录条数（用于 aggregatesIncludeTrimmed）。 */
  detailCovered: number
  /** 账本认为当前应保留的明细条数（与真实条数不一致时自愈计数）。 */
  expectedRetained: number
  floors: number
  ascentM: number
  activeDurationMs: number
  byDay: Record<string, DayBucket>
  firstAtMs?: number
  lastAtMs?: number
}

export interface HistoryAggregateDoc {
  schemaVersion: number
  workouts: CollectionLedger
  sessions: CollectionLedger
  /** 已被写入路径丢弃的损坏条数（当前仍可见的坏条由 summarize 现算）。 */
  skippedCorrupt: number
  corruptReasons: string[]
  migratedAt?: number
  updatedAt: number
}

type HistoryItem = { id: string } & Record<string, unknown>

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 结构有效的最小判定：非空对象且 id 为非空字符串。 */
function isHistoryItem(value: unknown): value is HistoryItem {
  return isObjectLike(value) && typeof value.id === 'string' && value.id.length > 0
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nonNegative(value: unknown): number {
  return Math.max(0, finiteNumber(value, 0))
}

function pickTime(...candidates: unknown[]): number {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return candidate
    }
  }
  return 0
}

function workoutAtMs(workout: ClimbWorkout): number {
  return pickTime(workout.endedAt, workout.startedAt, workout.updatedAt, workout.createdAt)
}

function sessionAtMs(session: ClimbSession): number {
  return pickTime(session.endedAt, session.startedAt)
}

function workoutMetrics(value: HistoryItem): HistoryRecordMetrics {
  const workout = value as unknown as ClimbWorkout
  return {
    id: value.id,
    floors: nonNegative(workout.totalFloorsCompleted),
    ascentM: nonNegative(workout.totalAscentM),
    activeDurationMs: nonNegative(workout.activeDurationMs),
    atMs: workoutAtMs(workout),
  }
}

function sessionMetrics(value: HistoryItem): HistoryRecordMetrics {
  const session = value as unknown as ClimbSession
  const duration =
    typeof session.durationMs === 'number' && Number.isFinite(session.durationMs)
      ? Math.max(0, session.durationMs)
      : Math.max(0, finiteNumber(session.endedAt, 0) - finiteNumber(session.startedAt, 0))
  return {
    id: value.id,
    floors: nonNegative(session.floorsCompleted),
    ascentM: nonNegative(session.ascentM),
    activeDurationMs: duration,
    atMs: sessionAtMs(session),
  }
}

function metricsOf(collection: HistoryCollection, value: HistoryItem): HistoryRecordMetrics {
  return collection === 'workouts' ? workoutMetrics(value) : sessionMetrics(value)
}

/** 本地时区 YYYY-MM-DD（不用 toISOString，避免 UTC 偏移把跨午夜记录算错天）。 */
export function localDayKey(atMs: number): string {
  const date = new Date(atMs)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function emptyLedger(): CollectionLedger {
  return {
    writtenTotal: 0,
    trimmedTotal: 0,
    removedTotal: 0,
    detailCovered: 0,
    expectedRetained: 0,
    floors: 0,
    ascentM: 0,
    activeDurationMs: 0,
    byDay: {},
  }
}

async function readRawStrict(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key)
  } catch (error) {
    throw new Error(
      `本地存储读取失败（${key}）：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function readRawLenient(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key)
  } catch {
    return null
  }
}

async function readJsonLenient<T>(key: string): Promise<T | null> {
  const raw = await readRawLenient(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 读取（损坏条跳过 + 整键不可解析时的隔离依据）
// ---------------------------------------------------------------------------

export interface HistoryCollectionRead<T> {
  /** 存储里原样的行（可能含损坏项；写路径用它做「之前」快照）。 */
  rows: unknown[]
  /** 结构有效的条目。 */
  items: T[]
  /** 本次读取跳过的损坏条数。 */
  corrupt: number
  reasons: string[]
  /** 整键不是合法 JSON 数组：写路径必须先隔离再覆盖。 */
  rawCorrupt: boolean
  raw: string | null
}

function parseCollection<T>(key: string, raw: string | null): HistoryCollectionRead<T> {
  if (raw === null || raw === '') {
    return { rows: [], items: [], corrupt: 0, reasons: [], rawCorrupt: false, raw }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      rows: [],
      items: [],
      corrupt: 1,
      reasons: [`${key}: JSON 解析失败（${error instanceof Error ? error.message : String(error)}）`],
      rawCorrupt: true,
      raw,
    }
  }
  if (!Array.isArray(parsed)) {
    return {
      rows: [],
      items: [],
      corrupt: 1,
      reasons: [`${key}: 内容不是数组（${typeof parsed}）`],
      rawCorrupt: true,
      raw,
    }
  }
  const items: T[] = []
  const reasons: string[] = []
  for (const row of parsed) {
    if (isHistoryItem(row)) items.push(row as unknown as T)
    else reasons.push(`${key}: 跳过结构损坏的条目（${describeRow(row)}）`)
  }
  return { rows: parsed, items, corrupt: reasons.length, reasons, rawCorrupt: false, raw }
}

function describeRow(row: unknown): string {
  if (row === null) return 'null'
  if (Array.isArray(row)) return 'array'
  if (typeof row === 'object') {
    const id = (row as { id?: unknown }).id
    return `缺少有效 id（id=${typeof id}）`
  }
  return typeof row
}

export async function readHistoryCollection<T>(
  collection: HistoryCollection,
): Promise<HistoryCollectionRead<T>> {
  const key = HISTORY_COLLECTION_KEYS[collection]
  return parseCollection<T>(key, await readRawStrict(key))
}

// ---------------------------------------------------------------------------
// 隔离区（损坏项不静默丢弃）
// ---------------------------------------------------------------------------

interface QuarantineEntry {
  key: string
  reason: string
  capturedAt: number
  truncated: boolean
  raw: string | null
}

/** 把无法解析的原始内容复制到隔离区；失败只告警，不影响主流程。 */
export async function quarantineUnreadableCollection(
  collection: HistoryCollection,
  raw: string | null,
  reason: string,
): Promise<void> {
  const key = HISTORY_COLLECTION_KEYS[collection]
  try {
    const existing = await readJsonLenient<{ version: number; entries: QuarantineEntry[] }>(
      HISTORY_QUARANTINE_KEY,
    )
    const entries = Array.isArray(existing?.entries) ? existing?.entries ?? [] : []
    const truncated = typeof raw === 'string' && raw.length > QUARANTINE_RAW_LIMIT
    const entry: QuarantineEntry = {
      key,
      reason,
      capturedAt: Date.now(),
      truncated,
      raw: truncated && typeof raw === 'string' ? raw.slice(0, QUARANTINE_RAW_LIMIT) : raw,
    }
    const next = [entry, ...entries.filter((item) => item?.key !== key)].slice(
      0,
      QUARANTINE_ENTRY_LIMIT,
    )
    await AsyncStorage.setItem(
      HISTORY_QUARANTINE_KEY,
      JSON.stringify({ version: 1, entries: next }),
    )
  } catch (error) {
    console.error('[history-repository] 损坏数据隔离失败', error)
  }
}

// ---------------------------------------------------------------------------
// meta 计数镜像（兼容旧读取方）
// ---------------------------------------------------------------------------

export interface LegacyTrimCounts {
  sessionsTrimmed: number
  workoutsTrimmed: number
}

async function readLegacyTrimCounts(): Promise<LegacyTrimCounts> {
  const raw = await readRawLenient(HISTORY_META_KEY)
  if (!raw) return { sessionsTrimmed: 0, workoutsTrimmed: 0 }
  try {
    const value = JSON.parse(raw) as Partial<LegacyTrimCounts>
    return {
      sessionsTrimmed: nonNegative(value?.sessionsTrimmed),
      workoutsTrimmed: nonNegative(value?.workoutsTrimmed),
    }
  } catch {
    return { sessionsTrimmed: 0, workoutsTrimmed: 0 }
  }
}

function legacyTrimmedFor(
  counts: LegacyTrimCounts,
  collection: HistoryCollection,
): number {
  return collection === 'sessions' ? counts.sessionsTrimmed : counts.workoutsTrimmed
}

/**
 * 把账本里的权威裁剪计数镜像回 `palou.storageMeta.v1`。
 * 这是派生值（自愈上一次写失败），失败不影响训练记录本身（D02 既有策略）。
 */
export async function syncLegacyTrimMirror(doc: HistoryAggregateDoc): Promise<void> {
  try {
    const existing = await readJsonLenient<Record<string, unknown>>(HISTORY_META_KEY)
    const merged = {
      ...(isObjectLike(existing) ? existing : {}),
      sessionsTrimmed: doc.sessions.trimmedTotal,
      workoutsTrimmed: doc.workouts.trimmedTotal,
    }
    await AsyncStorage.setItem(HISTORY_META_KEY, JSON.stringify(merged))
  } catch (error) {
    console.warn('[history-repository] 裁剪计数镜像写入失败（不影响训练记录）', error)
  }
}

// ---------------------------------------------------------------------------
// 账本维护
// ---------------------------------------------------------------------------

function bootstrapLedger(retainedCount: number, legacyTrimmed: number): CollectionLedger {
  return {
    ...emptyLedger(),
    writtenTotal: retainedCount + legacyTrimmed,
    trimmedTotal: legacyTrimmed,
    expectedRetained: retainedCount,
  }
}

function addBucket(byDay: Record<string, DayBucket>, day: string, floors: number): void {
  const bucket = byDay[day] ?? { workouts: 0, floors: 0 }
  byDay[day] = { workouts: bucket.workouts + 1, floors: bucket.floors + floors }
}

function removeBucket(byDay: Record<string, DayBucket>, day: string, floors: number): void {
  const bucket = byDay[day]
  if (!bucket) return
  const next = { workouts: bucket.workouts - 1, floors: bucket.floors - floors }
  if (next.workouts <= 0 && next.floors <= 0) delete byDay[day]
  else byDay[day] = { workouts: Math.max(0, next.workouts), floors: Math.max(0, next.floors) }
}

function touchRange(ledger: CollectionLedger, metrics: HistoryRecordMetrics): void {
  if (metrics.atMs <= 0) return
  ledger.firstAtMs =
    ledger.firstAtMs === undefined ? metrics.atMs : Math.min(ledger.firstAtMs, metrics.atMs)
  ledger.lastAtMs =
    ledger.lastAtMs === undefined ? metrics.atMs : Math.max(ledger.lastAtMs, metrics.atMs)
}

/** 记录离开保留集合：贡献永久写入账本（原始明细可以没了，统计必须还在）。 */
function addContribution(ledger: CollectionLedger, metrics: HistoryRecordMetrics): void {
  ledger.floors += metrics.floors
  ledger.ascentM += metrics.ascentM
  ledger.activeDurationMs += metrics.activeDurationMs
  if (metrics.atMs > 0) addBucket(ledger.byDay, localDayKey(metrics.atMs), metrics.floors)
  touchRange(ledger, metrics)
}

function removeContribution(ledger: CollectionLedger, metrics: HistoryRecordMetrics): void {
  ledger.floors = Math.max(0, ledger.floors - metrics.floors)
  ledger.ascentM = Math.max(0, ledger.ascentM - metrics.ascentM)
  ledger.activeDurationMs = Math.max(0, ledger.activeDurationMs - metrics.activeDurationMs)
  if (metrics.atMs > 0) removeBucket(ledger.byDay, localDayKey(metrics.atMs), metrics.floors)
}

export interface HistoryLedgerChange {
  collection: HistoryCollection
  /** 写入前存储里原样的行（可能含损坏项）。 */
  previous: unknown[]
  /** 本次写入后仍保留的行（已按容量策略裁剪）。 */
  next: unknown[]
  /** 本次因容量策略裁剪掉的条数。 */
  policyTrimmed: number
  corruptReasons?: string[]
  /** 整键不可解析（本次写入会把原始内容覆盖掉）：额外计入 skippedCorrupt。 */
  corruptDropped?: number
}

export interface HistoryLedgerPlan {
  doc: HistoryAggregateDoc
  aggRaw: string
  previousAggRaw: string | null
  /** 本次有多少条记录离开保留集合（容量裁剪 + 删除/替换）。0 表示纯追加/更新。 */
  departedCount: number
}

function parseAggregateDoc(raw: string | null): HistoryAggregateDoc | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObjectLike(parsed)) return null
  const doc = parsed as Partial<HistoryAggregateDoc>
  if (doc.schemaVersion !== HISTORY_SCHEMA_VERSION) return null
  if (!isObjectLike(doc.workouts) || !isObjectLike(doc.sessions)) return null
  const normalizeLedger = (value: unknown): CollectionLedger => {
    const ledger = (isObjectLike(value) ? value : {}) as Partial<CollectionLedger>
    return {
      ...emptyLedger(),
      ...ledger,
      writtenTotal: nonNegative(ledger.writtenTotal),
      trimmedTotal: nonNegative(ledger.trimmedTotal),
      removedTotal: nonNegative(ledger.removedTotal),
      detailCovered: nonNegative(ledger.detailCovered),
      expectedRetained: nonNegative(ledger.expectedRetained),
      floors: nonNegative(ledger.floors),
      ascentM: nonNegative(ledger.ascentM),
      activeDurationMs: nonNegative(ledger.activeDurationMs),
      byDay: isObjectLike(ledger.byDay) ? (ledger.byDay as Record<string, DayBucket>) : {},
    }
  }
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    workouts: normalizeLedger(doc.workouts),
    sessions: normalizeLedger(doc.sessions),
    skippedCorrupt: nonNegative(doc.skippedCorrupt),
    corruptReasons: Array.isArray(doc.corruptReasons)
      ? doc.corruptReasons.filter((item): item is string => typeof item === 'string')
      : [],
    migratedAt: typeof doc.migratedAt === 'number' ? doc.migratedAt : undefined,
    updatedAt: nonNegative(doc.updatedAt),
  }
}

export async function readHistoryAggregateDoc(): Promise<HistoryAggregateDoc | null> {
  return parseAggregateDoc(await readRawLenient(HISTORY_AGG_KEY))
}

function emptyAggregateDoc(): HistoryAggregateDoc {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    workouts: emptyLedger(),
    sessions: emptyLedger(),
    skippedCorrupt: 0,
    corruptReasons: [],
    updatedAt: 0,
  }
}

function pushCorruptReasons(doc: HistoryAggregateDoc, reasons: string[]): void {
  for (const reason of reasons) {
    if (!doc.corruptReasons.includes(reason)) doc.corruptReasons.push(reason)
  }
  if (doc.corruptReasons.length > CORRUPT_REASON_LIMIT) {
    doc.corruptReasons = doc.corruptReasons.slice(-CORRUPT_REASON_LIMIT)
  }
}

function applyLedgerChange(
  base: CollectionLedger,
  previous: HistoryRecordMetrics[],
  next: HistoryRecordMetrics[],
  policyTrimmed: number,
): CollectionLedger {
  const updated: CollectionLedger = { ...base, byDay: { ...base.byDay } }
  const previousById = new Map(previous.map((item) => [item.id, item]))
  const nextById = new Map(next.map((item) => [item.id, item]))

  // 计数漂移自愈：上一次写入失败会留下 expectedRetained 与实际条数不一致。
  const drift = previous.length - base.expectedRetained
  if (drift !== 0) {
    updated.writtenTotal = Math.max(0, base.writtenTotal + drift)
    console.warn(
      `[history-repository] 聚合计数漂移 ${drift} 条，已按实际保留条数自愈（上一次写入未完成）`,
    )
  }

  // 新进入保留集合的写入事件（同 id 更新不算新写入）。
  let ingested = 0
  for (const metrics of next) {
    if (previousById.has(metrics.id)) continue
    ingested += 1
    touchRange(updated, metrics)
  }
  updated.writtenTotal += ingested
  updated.expectedRetained = next.length

  // 离开保留集合的记录：贡献永久进账本，并区分「容量裁剪」与「用户删除/替换」。
  const gone = previous.filter((metrics) => !nextById.has(metrics.id))
  let usedPolicy = 0
  for (const metrics of gone) {
    addContribution(updated, metrics)
    if (usedPolicy < policyTrimmed) {
      updated.trimmedTotal += 1
      usedPolicy += 1
    } else {
      updated.removedTotal += 1
    }
    updated.detailCovered += 1
  }
  return updated
}

/**
 * 计算「原始明细 + 增量聚合」成对写入中的聚合内容（纯规划，不写存储）。
 * 调用方负责把返回的 aggRaw 与明细键一起放进同一次带日志的写入。
 */
export async function planHistoryLedgerChanges(
  changes: HistoryLedgerChange[],
  options?: {
    /**
     * 本机没有账本时（例如新设备导入备份）用来「认领」备份里携带的归档聚合。
     * 只在本机账本缺失时生效，避免把两台设备的账本混在一起重复计数。
     */
    adoptAggregate?: HistoryAggregateDoc | null
  },
): Promise<HistoryLedgerPlan> {
  const previousAggRaw = await readRawLenient(HISTORY_AGG_KEY)
  const existing = parseAggregateDoc(previousAggRaw) ?? options?.adoptAggregate ?? null
  const legacyTrimCounts = await readLegacyTrimCounts()
  const doc = existing ?? emptyAggregateDoc()
  let departedCount = 0

  for (const collection of HISTORY_COLLECTIONS) {
    const change = changes.find((item) => item.collection === collection)
    if (!change && existing) continue
    const previousRows = change ? change.previous : await readHistoryCollection(collection).then((read) => read.rows)
    const nextRows = change ? change.next : previousRows
    const policyTrimmed = change ? Math.max(0, change.policyTrimmed) : 0
    const previousValid = previousRows.filter(isHistoryItem)
    const nextValid = nextRows.filter(isHistoryItem)
    const base = existing
      ? doc[collection]
      : bootstrapLedger(previousValid.length, legacyTrimmedFor(legacyTrimCounts, collection))
    const departedBefore = base.trimmedTotal + base.removedTotal
    doc[collection] = applyLedgerChange(
      base,
      previousValid.map((item) => metricsOf(collection, item)),
      nextValid.map((item) => metricsOf(collection, item)),
      policyTrimmed,
    )
    if (change) {
      departedCount +=
        doc[collection].trimmedTotal + doc[collection].removedTotal - departedBefore
    }
    if (change) {
      const droppedCorrupt =
        previousRows.length - previousValid.length + Math.max(0, change.corruptDropped ?? 0)
      if (droppedCorrupt > 0) {
        doc.skippedCorrupt += droppedCorrupt
        pushCorruptReasons(
          doc,
          (change.corruptReasons ?? []).length
            ? change.corruptReasons ?? []
            : [`${HISTORY_COLLECTION_KEYS[collection]}: 写入时丢弃 ${droppedCorrupt} 条损坏记录`],
        )
      }
    }
  }
  doc.updatedAt = Date.now()
  return { doc, aggRaw: JSON.stringify(doc), previousAggRaw, departedCount }
}

// ---------------------------------------------------------------------------
// 写入（带日志的成对写入 / 纯追加的单键写入）
// ---------------------------------------------------------------------------

async function writeRawStrict(key: string, raw: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, raw)
  } catch (error) {
    throw new Error(
      `本地存储写入失败，可能空间不足：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * 纯追加/更新（本次没有任何记录离开保留集合）：
 * 只写明细键，聚合键**尽力**跟上——因为聚合的 retained 贡献是读取时按实际内容现算的，
 * 唯一可能滞后的只有 writtenTotal/expectedRetained 计数，而这会在下次成功写入时按
 * 实际保留条数自愈（summarize 也会在内存里如实纠正并暴露 reconciledDrift）。
 * 这样避免为每次保存都写一份日志，把 AsyncStorage 的单键体积翻倍。
 */
async function writeAppendOnly(
  collectionKey: string,
  valueRaw: string,
  previousRaw: string | null,
  plan: HistoryLedgerPlan,
): Promise<void> {
  await writeRawStrict(collectionKey, valueRaw)
  try {
    const actual = await readRawStrict(collectionKey)
    if (actual !== valueRaw) {
      throw new Error(`${collectionKey} 读回校验失败（写入未生效）`)
    }
  } catch (error) {
    // 读回校验失败：用内存中的写入前内容还原，避免用户看到「保存成功但其实没写进去」。
    await restoreScopedKeys({ [collectionKey]: previousRaw }, [collectionKey])
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}；已回滚到操作前状态`,
    )
  }
  try {
    await AsyncStorage.setItem(HISTORY_AGG_KEY, plan.aggRaw)
  } catch (error) {
    console.warn(
      '[history-repository] 增量聚合写入失败，计数将在下次成功写入时自愈（训练记录已保存）',
      error,
    )
  }
}

async function restoreScopedKeys(
  before: Record<string, string | null>,
  keys: readonly string[],
): Promise<string[]> {
  const problems: string[] = []
  for (const key of keys) {
    try {
      const value = key in before ? before[key] : null
      if (value === null || value === undefined) await AsyncStorage.removeItem(key)
      else await AsyncStorage.setItem(key, value)
    } catch (error) {
      problems.push(`${key}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return problems
}

/**
 * 把「明细键 + 聚合键」当成一件事写入。
 * 顺序：begin 日志 → 写明细 → 写聚合 → 读回校验 → commit；任一步失败整体回滚。
 * 进程被杀时启动恢复（recoverPendingJournal）会按日志回滚，不留半提交。
 */
async function writeHistoryPair(
  collectionKey: string,
  valueRaw: string,
  plan: HistoryLedgerPlan,
): Promise<void> {
  const before: Record<string, string | null> = {
    [collectionKey]: await readRawStrict(collectionKey),
    [HISTORY_AGG_KEY]: plan.previousAggRaw,
  }
  const after: Record<string, string | null> = {
    [collectionKey]: valueRaw,
    [HISTORY_AGG_KEY]: plan.aggRaw,
  }
  const journalId = await beginScopedJournal('history', before, after)
  const written: string[] = []
  try {
    for (const key of Object.keys(after)) {
      const value = after[key]
      if (value === null) await AsyncStorage.removeItem(key)
      else await AsyncStorage.setItem(key, value)
      written.push(key)
    }
    for (const key of written) {
      const actual = await readRawStrict(key)
      if (actual !== after[key]) {
        throw new Error(`${key} 读回校验失败（写入未生效）`)
      }
    }
  } catch (error) {
    const problems = await restoreScopedKeys(before, written)
    if (!problems.length) await abandonJournal()
    const detail = problems.length
      ? `；回滚不完整（${problems.join('; ')}），重启后将自动恢复`
      : '；已回滚到操作前状态'
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${detail}`,
    )
  }
  await commitScopedJournal(journalId)
}

// ---------------------------------------------------------------------------
// 分页
// ---------------------------------------------------------------------------

interface PageEntry<T> {
  item: T
  /** 记录自身时间：用于 fromMs/toMs 过滤与按天分桶。 */
  at: number
  /** 排序时间：训练沿用旧 listWorkouts 的 updatedAt 口径，保证顺序语义不回归。 */
  sortAt: number
  templateId: string
}

function paginate<T>(entries: PageEntry<T>[], query?: HistoryQuery): HistoryPage<T> {
  const order = query?.order === 'oldest' ? 'oldest' : 'newest'
  const offset = Math.max(0, Math.floor(query?.offset ?? 0))
  const requestedLimit = query?.limit
  const fromMs = query?.fromMs
  const toMs = query?.toMs
  const templateId = query?.templateId

  const filtered = entries.filter((entry) => {
    if (typeof fromMs === 'number' && entry.at < fromMs) return false
    if (typeof toMs === 'number' && entry.at > toMs) return false
    if (typeof templateId === 'string' && entry.templateId !== templateId) return false
    return true
  })
  filtered.sort((a, b) => (order === 'newest' ? b.sortAt - a.sortAt : a.sortAt - b.sortAt))

  const total = filtered.length
  const unlimited =
    typeof requestedLimit !== 'number' || !Number.isFinite(requestedLimit) || requestedLimit < 0
  const limit = unlimited ? total : Math.floor(requestedLimit)
  const items = unlimited
    ? filtered.slice(offset).map((entry) => entry.item)
    : filtered.slice(offset, offset + limit).map((entry) => entry.item)
  return {
    items,
    total,
    offset,
    limit,
    hasMore: offset + items.length < total,
  }
}

async function listInCollection<T>(
  collection: HistoryCollection,
  query?: HistoryQuery,
): Promise<HistoryPage<T>> {
  const read = await readHistoryCollection<T>(collection)
  const entries: PageEntry<T>[] = read.items.map((item) => {
    const metrics = metricsOf(collection, item as unknown as HistoryItem)
    const raw = item as unknown as Record<string, unknown>
    const sortAt =
      collection === 'workouts'
        ? pickTime(raw.updatedAt, raw.endedAt, raw.startedAt, raw.createdAt)
        : pickTime(raw.endedAt, raw.startedAt)
    return {
      item,
      at: metrics.atMs,
      sortAt,
      templateId: String(raw.templateId ?? ''),
    }
  })
  return paginate(entries, query)
}

// ---------------------------------------------------------------------------
// 写入 / 删除
// ---------------------------------------------------------------------------

export interface SaveHistoryResult {
  trimmed: number
  total: number
}

async function saveInCollection(
  collection: HistoryCollection,
  record: { id: string },
): Promise<SaveHistoryResult> {
  const key = HISTORY_COLLECTION_KEYS[collection]
  const limit = HISTORY_COLLECTION_LIMITS[collection]
  return runSerial(async () => {
    const read = await readHistoryCollection<unknown>(collection)
    const rows = read.rows
    const withoutSameId = rows.filter(
      (row) => !(isHistoryItem(row) && row.id === record.id),
    )
    const nextRows = [record, ...withoutSameId]
    const kept = nextRows.slice(0, limit)
    const policyTrimmed = Math.max(0, nextRows.length - limit)
    const plan = await planHistoryLedgerChanges([
      {
        collection,
        previous: rows,
        next: kept,
        policyTrimmed,
        corruptReasons: read.reasons,
        corruptDropped: read.rawCorrupt ? 1 : 0,
      },
    ])
    const valueRaw = JSON.stringify(kept)
    if (valueRaw !== read.raw || plan.aggRaw !== plan.previousAggRaw) {
      // 整键不可解析时先隔离原始字节，再覆盖（先备份、后写入，不留「覆盖了才失败」的窗口）。
      if (read.rawCorrupt) {
        await quarantineUnreadableCollection(
          collection,
          read.raw,
          read.reasons[0] ?? `${key}: 内容不可解析`,
        )
      }
      if (plan.departedCount === 0 && !read.rawCorrupt) {
        await writeAppendOnly(key, valueRaw, read.raw, plan)
      } else {
        // 有记录离开保留集合（容量裁剪/整键损坏被覆盖）：必须与聚合一起原子写入，
        // 否则「明细已裁掉、统计没记上」就是静默丢失。
        await writeHistoryPair(key, valueRaw, plan)
      }
      await syncLegacyTrimMirror(plan.doc)
    }
    return { trimmed: policyTrimmed, total: kept.length }
  })
}

async function deleteInCollection(
  collection: HistoryCollection,
  id: string,
): Promise<void> {
  const key = HISTORY_COLLECTION_KEYS[collection]
  return runSerial(async () => {
    const read = await readHistoryCollection<unknown>(collection)
    const nextRows = read.rows.filter((row) => !(isHistoryItem(row) && row.id === id))
    if (nextRows.length === read.rows.length) return
    const plan = await planHistoryLedgerChanges([
      {
        collection,
        previous: read.rows,
        next: nextRows,
        policyTrimmed: 0,
        corruptReasons: read.reasons,
        corruptDropped: read.rawCorrupt ? 1 : 0,
      },
    ])
    if (read.rawCorrupt) {
      await quarantineUnreadableCollection(
        collection,
        read.raw,
        read.reasons[0] ?? `${key}: 内容不可解析`,
      )
    }
    await writeHistoryPair(key, JSON.stringify(nextRows), plan)
    await syncLegacyTrimMirror(plan.doc)
  })
}

// ---------------------------------------------------------------------------
// 摘要
// ---------------------------------------------------------------------------

function mergeByDay(
  ...sources: Array<Record<string, DayBucket>>
): Record<string, { workouts: number; floors: number }> {
  const merged: Record<string, { workouts: number; floors: number }> = {}
  for (const source of sources) {
    for (const [day, bucket] of Object.entries(source)) {
      const current = merged[day] ?? { workouts: 0, floors: 0 }
      merged[day] = {
        workouts: current.workouts + nonNegative(bucket?.workouts),
        floors: current.floors + nonNegative(bucket?.floors),
      }
    }
  }
  return merged
}

function bucketsFrom(metrics: HistoryRecordMetrics[]): Record<string, DayBucket> {
  const byDay: Record<string, DayBucket> = {}
  for (const item of metrics) {
    if (item.atMs > 0) addBucket(byDay, localDayKey(item.atMs), item.floors)
  }
  return byDay
}

function minTime(...values: Array<number | undefined>): number | undefined {
  const positive = values.filter(
    (value): value is number => typeof value === 'number' && value > 0,
  )
  return positive.length ? Math.min(...positive) : undefined
}

function maxTime(...values: Array<number | undefined>): number | undefined {
  const positive = values.filter(
    (value): value is number => typeof value === 'number' && value > 0,
  )
  return positive.length ? Math.max(...positive) : undefined
}

async function summarize(): Promise<HistorySummary> {
  await ensureRecovered()
  const [workoutRead, sessionRead, aggDoc, legacyTrimCounts] = await Promise.all([
    readHistoryCollection<ClimbWorkout>('workouts'),
    readHistoryCollection<ClimbSession>('sessions'),
    readHistoryAggregateDoc(),
    readLegacyTrimCounts(),
  ])

  const liveWorkouts = workoutRead.items.map((item) =>
    workoutMetrics(item as unknown as HistoryItem),
  )
  const liveSessions = sessionRead.items.map((item) =>
    sessionMetrics(item as unknown as HistoryItem),
  )

  let reconciledDrift = 0
  const ledgerFor = (
    collection: HistoryCollection,
    ledger: CollectionLedger | undefined,
    retainedCount: number,
  ): CollectionLedger => {
    if (ledger) return ledger
    return bootstrapLedger(retainedCount, legacyTrimmedFor(legacyTrimCounts, collection))
  }

  const workoutLedger = ledgerFor('workouts', aggDoc?.workouts, liveWorkouts.length)
  const sessionLedger = ledgerFor('sessions', aggDoc?.sessions, liveSessions.length)
  const ledgerWithDrift = (
    ledger: CollectionLedger,
    retainedCount: number,
  ): CollectionLedger => {
    const drift = retainedCount - ledger.expectedRetained
    if (drift === 0) return ledger
    reconciledDrift += drift
    return { ...ledger, writtenTotal: Math.max(0, ledger.writtenTotal + drift) }
  }
  const workoutsLedger = ledgerWithDrift(workoutLedger, liveWorkouts.length)
  const sessionsLedger = ledgerWithDrift(sessionLedger, liveSessions.length)

  const totalFloors =
    workoutsLedger.floors +
    sessionsLedger.floors +
    liveWorkouts.reduce((sum, item) => sum + item.floors, 0) +
    liveSessions.reduce((sum, item) => sum + item.floors, 0)
  const totalAscentM =
    workoutsLedger.ascentM +
    sessionsLedger.ascentM +
    liveWorkouts.reduce((sum, item) => sum + item.ascentM, 0) +
    liveSessions.reduce((sum, item) => sum + item.ascentM, 0)
  const totalActiveDurationMs =
    workoutsLedger.activeDurationMs +
    sessionsLedger.activeDurationMs +
    liveWorkouts.reduce((sum, item) => sum + item.activeDurationMs, 0) +
    liveSessions.reduce((sum, item) => sum + item.activeDurationMs, 0)

  const trimmedTotal = workoutsLedger.trimmedTotal + sessionsLedger.trimmedTotal
  const removedTotal = workoutsLedger.removedTotal + sessionsLedger.removedTotal
  const detailCovered = workoutsLedger.detailCovered + sessionsLedger.detailCovered
  const departed = trimmedTotal + removedTotal

  return {
    workoutCount: workoutsLedger.writtenTotal,
    sessionCount: sessionsLedger.writtenTotal,
    totalFloors,
    totalAscentM,
    totalActiveDurationMs,
    firstAtMs: minTime(workoutsLedger.firstAtMs, sessionsLedger.firstAtMs),
    lastAtMs: maxTime(workoutsLedger.lastAtMs, sessionsLedger.lastAtMs),
    byDay: mergeByDay(
      workoutsLedger.byDay,
      sessionsLedger.byDay,
      bucketsFrom(liveWorkouts),
      bucketsFrom(liveSessions),
    ),
    earliestKeptAtMs: minTime(
      liveWorkouts.reduce<number | undefined>(
        (min, item) => minTime(min, item.atMs),
        undefined,
      ),
      liveSessions.reduce<number | undefined>(
        (min, item) => minTime(min, item.atMs),
        undefined,
      ),
    ),
    trimmedTotal,
    retainedWorkoutCount: liveWorkouts.length,
    aggregatesIncludeTrimmed: departed === detailCovered,
    skippedCorrupt:
      nonNegative(aggDoc?.skippedCorrupt) + workoutRead.corrupt + sessionRead.corrupt,
    retainedSessionCount: liveSessions.length,
    writtenTotal: workoutsLedger.writtenTotal + sessionsLedger.writtenTotal,
    removedTotal,
    trimmedWithoutDetail: Math.max(0, departed - detailCovered),
    reconciledDrift,
  }
}

// ---------------------------------------------------------------------------
// 迁移状态
// ---------------------------------------------------------------------------

async function migrationStatus(): Promise<HistoryMigrationStatus> {
  const [statusRaw, rollbackRaw, aggDoc] = await Promise.all([
    readRawLenient(HISTORY_MIGRATION_KEY),
    readRawLenient(HISTORY_ROLLBACK_KEY),
    readHistoryAggregateDoc(),
  ])
  const hasRollbackSnapshot = typeof rollbackRaw === 'string' && rollbackRaw.length > 0
  let parsed: Partial<HistoryMigrationStatus> | null = null
  if (statusRaw) {
    try {
      const value = JSON.parse(statusRaw) as unknown
      if (isObjectLike(value)) parsed = value as Partial<HistoryMigrationStatus>
    } catch {
      parsed = null
    }
  }
  if (parsed && typeof parsed.state === 'string') {
    return {
      schemaVersion: nonNegative(parsed.schemaVersion) || HISTORY_SCHEMA_VERSION,
      migratedAt: typeof parsed.migratedAt === 'number' ? parsed.migratedAt : undefined,
      state: parsed.state as HistoryMigrationStatus['state'],
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : undefined,
      hasRollbackSnapshot,
    }
  }
  if (aggDoc) {
    return {
      schemaVersion: aggDoc.schemaVersion,
      migratedAt: aggDoc.migratedAt,
      state: 'done',
      hasRollbackSnapshot,
    }
  }
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    state: 'none',
    hasRollbackSnapshot,
  }
}

// ---------------------------------------------------------------------------
// 启动恢复（与 storage/workout-storage 同一份日志）
// ---------------------------------------------------------------------------

let recoveryPromise: Promise<void> | null = null

function ensureRecovered(): Promise<void> {
  if (!recoveryPromise) {
    recoveryPromise = recoverPendingJournal()
      .then((report) => {
        if (report.recovered) {
          console.warn(
            `[history-repository] 已回滚未完成的写入（${report.operation ?? 'unknown'} / ${report.entryId ?? '-'}）`,
          )
        } else if (report.failure) {
          console.error(
            `[history-repository] 未完成写入的自动回滚失败，将在下次启动重试：${report.failure}`,
          )
        }
      })
      .catch((error) => {
        console.error('[history-repository] 恢复检查失败', error)
      })
  }
  return recoveryPromise
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

export const historyRepository: HistoryRepository = {
  async listWorkouts(query?: HistoryQuery) {
    await ensureRecovered()
    return listInCollection<ClimbWorkout>('workouts', query)
  },
  async getWorkout(id: string) {
    const page = await historyRepository.listWorkouts({ limit: Number.MAX_SAFE_INTEGER })
    return page.items.find((item) => item.id === id)
  },
  async saveWorkout(workout: ClimbWorkout) {
    await ensureRecovered()
    return saveInCollection('workouts', workout)
  },
  async deleteWorkout(id: string) {
    await ensureRecovered()
    return deleteInCollection('workouts', id)
  },
  async listSessions(query?: HistoryQuery) {
    await ensureRecovered()
    return listInCollection<ClimbSession>('sessions', query)
  },
  async getSession(id: string) {
    const page = await historyRepository.listSessions({ limit: Number.MAX_SAFE_INTEGER })
    return page.items.find((item) => item.id === id)
  },
  async saveSession(session: ClimbSession) {
    await ensureRecovered()
    return saveInCollection('sessions', session)
  },
  async deleteSession(id: string) {
    await ensureRecovered()
    return deleteInCollection('sessions', id)
  },
  summarize,
  migrationStatus,
}

// ---------------------------------------------------------------------------
// 迁移/诊断使用的原始键读写（带读回校验）
// ---------------------------------------------------------------------------

/** 首次读写前回滚未提交的多键写入（与 storage / workout-storage 同一份日志）。 */
export async function ensureHistoryRecovered(): Promise<void> {
  await ensureRecovered()
}

export async function readHistoryRawKey(key: string): Promise<string | null> {
  return readRawStrict(key)
}

/** 写单个存储键并读回校验；raw=null 表示删除该键。 */
export async function writeHistoryRawKey(key: string, raw: string | null): Promise<void> {
  if (raw === null) await AsyncStorage.removeItem(key)
  else await AsyncStorage.setItem(key, raw)
  const actual = await readRawStrict(key)
  if (actual !== raw) {
    throw new Error(`${key} 读回校验失败（写入未生效）`)
  }
}

export async function removeHistoryKey(key: string): Promise<void> {
  await AsyncStorage.removeItem(key)
}

/** 测试用：重置启动恢复缓存（生产代码不应调用）。 */
export function __resetHistoryRepositoryForTests(): void {
  recoveryPromise = null
}
