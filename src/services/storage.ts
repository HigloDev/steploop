import AsyncStorage from '@react-native-async-storage/async-storage'
import { preparationDeviceKey, scopePreparationToDevice } from './preparation-device'
import { ClimbSession, ClimbWorkout, RouteTemplate } from '../core/types'
import { normalizeSession } from '../core/session'
import { migrateRouteToV3 } from '../core/route-model'
import {
  mergeById,
  validateBackupPayload,
  type ArchiveAggregate,
} from '../core/backup-payload'
import {
  COLLECTION_KEYS,
  JournalOperation,
  KeySnapshot,
  abandonJournal,
  assertCollectionKeys,
  beginJournal,
  beginScopedJournal,
  commitJournal,
  commitScopedJournal,
  recoverPendingJournal,
  runSerial,
  __resetJournalQueueForTests,
} from './storage-journal'
import {
  HISTORY_AGG_KEY,
  HISTORY_SESSION_LIMIT,
  HISTORY_SESSIONS_KEY,
  HISTORY_WORKOUT_LIMIT,
  HISTORY_WORKOUTS_KEY,
  historyRepository,
  planHistoryLedgerChanges,
  readHistoryAggregateDoc,
  quarantineUnreadableCollection,
  readHistoryCollection,
  syncLegacyTrimMirror,
} from './history-repository'

const ROUTES_KEY = 'palou.routes.v3'
const V2_ROUTES_KEY = 'palou.routes.v2'
const LEGACY_ROUTES_KEY = 'palou.routes.v1'
const SESSIONS_KEY = HISTORY_SESSIONS_KEY
const WORKOUTS_KEY = HISTORY_WORKOUTS_KEY
const PRE_IMPORT_KEY = 'palou.backup.preImport.v1'
const STORAGE_META_KEY = 'palou.storageMeta.v1'

// 集合键的唯一来源是 storage-journal（日志必须覆盖到每一个被改写的键）。
const KEY_FOR_COLLECTION = COLLECTION_KEYS
assertCollectionKeys({
  routes: ROUTES_KEY,
  sessions: SESSIONS_KEY,
  workouts: WORKOUTS_KEY,
})

// D08a：容量上限由 history-repository 统一持有（原始明细受策略约束），此处仅对外保持既有常量。
export const SESSIONS_LIMIT = HISTORY_SESSION_LIMIT
export const CAPACITY_WARN_THRESHOLD = 90

export interface TrimEvent {
  collection: 'sessions' | 'workouts'
  removed: number
  remaining: number
}

let onTrim: ((event: TrimEvent) => void) | undefined

export function setStorageTrimListener(
  listener: ((event: TrimEvent) => void) | undefined,
): void {
  onTrim = listener
}

interface StorageMeta {
  sessionsTrimmed: number
  workoutsTrimmed: number
}

async function readMeta(): Promise<StorageMeta> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_META_KEY)
    if (!raw) return { sessionsTrimmed: 0, workoutsTrimmed: 0 }
    const value = JSON.parse(raw)
    return {
      sessionsTrimmed:
        typeof value?.sessionsTrimmed === 'number' ? value.sessionsTrimmed : 0,
      workoutsTrimmed:
        typeof value?.workoutsTrimmed === 'number' ? value.workoutsTrimmed : 0,
    }
  } catch {
    return { sessionsTrimmed: 0, workoutsTrimmed: 0 }
  }
}

// ---------------------------------------------------------------------------
// 启动恢复（D02）
// ---------------------------------------------------------------------------

let recoveryPromise: Promise<void> | null = null

/**
 * 首次读取/写入前检查未提交的存储操作日志并回滚。
 * 回滚失败不阻塞读取（用户至少能看到旧数据），但会在控制台明确报错。
 */
function ensureRecovered(): Promise<void> {
  if (!recoveryPromise) {
    recoveryPromise = recoverPendingJournal()
      .then((report) => {
        if (report.recovered) {
          console.warn(
            `[storage] 已回滚未完成的多键写入（${report.operation ?? 'unknown'} / ${report.entryId ?? '-'}）`,
          )
        } else if (report.failure) {
          console.error(
            `[storage] 未完成写入的自动回滚失败，将在下次启动重试：${report.failure}`,
          )
        }
      })
      .catch((error) => {
        console.error('[storage] 恢复检查失败', error)
      })
  }
  return recoveryPromise
}

// ---------------------------------------------------------------------------
// 基础读写
// ---------------------------------------------------------------------------

export interface CapacityStatus {
  sessionsCount: number
  sessionsLimit: number
  sessionsTrimmed: number
  workoutsCount: number
  workoutsLimit: number
  workoutsTrimmed: number
  nearLimit: boolean
}

export async function getCapacityStatus(): Promise<CapacityStatus> {
  await ensureRecovered()
  const sessions = await readArray<ClimbSession>(SESSIONS_KEY)
  const workouts = await readArray<ClimbWorkout>(WORKOUTS_KEY)
  const meta = await readMeta()
  return {
    sessionsCount: sessions.length,
    sessionsLimit: SESSIONS_LIMIT,
    sessionsTrimmed: meta.sessionsTrimmed,
    workoutsCount: workouts.length,
    workoutsLimit: SESSIONS_LIMIT,
    workoutsTrimmed: meta.workoutsTrimmed,
    nearLimit:
      sessions.length >= CAPACITY_WARN_THRESHOLD ||
      workouts.length >= CAPACITY_WARN_THRESHOLD,
  }
}

async function readArray<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key)
    if (!raw) return []
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

async function readText(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key)
  } catch {
    return null
  }
}

/** 读取失败必须报错：写路径绝不能把「读不到」当成「没有数据」而覆盖用户数据。 */
async function readTextStrict(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key)
  } catch (error) {
    throw new Error(
      `本地存储读取失败（${key}）：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** 安全写入：存储满或异常时抛出统一 Error，调用方可捕获并提示用户。 */
async function setItemUnsafe(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    throw new Error(
      `本地存储写入失败，可能空间不足：${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** 单键读-改-写整体进入串行队列，避免并发写入互相覆盖。 */
async function readModifyWrite<T>(
  read: () => Promise<T[]>,
  mutate: (items: T[]) => T[],
  key: string,
): Promise<void> {
  await ensureRecovered()
  await runSerial(async () => {
    await setItemUnsafe(key, mutate(await read()))
  })
}

// ---------------------------------------------------------------------------
// 多键原子写入（操作日志 + 读回校验 + 失败回滚）
// ---------------------------------------------------------------------------

/**
 * 把任意一组存储键当成一件事写入（D08a 起用于「三集合 + 增量聚合」）。
 *
 * 顺序：begin 日志（含 before/after 原始内容）→ 逐键写 → 读回校验 → commit。
 * 任一步失败：用 before 回滚已写键；回滚完整则清理日志，回滚不完整则保留日志交给
 * 启动恢复，并在错误信息里写明「重启后将自动恢复」。绝不静默留下半提交。
 *
 * 使用前提：调用方已持有串行队列（在 runSerial 内部调用）。
 */
async function writeJournaledKeys(
  operation: JournalOperation,
  before: Record<string, string | null>,
  after: Record<string, string | null>,
): Promise<void> {
  const journalId = await beginScopedJournal(operation, before, after)
  const written: string[] = []
  try {
    for (const key of Object.keys(after)) {
      const value = after[key]
      if (value === null) await AsyncStorage.removeItem(key)
      else await AsyncStorage.setItem(key, value)
      written.push(key)
    }
    for (const key of written) {
      const expected = after[key]
      const actual = await readTextStrict(key)
      if (actual !== expected) {
        throw new Error(`${key} 读回校验失败（写入未生效）`)
      }
    }
  } catch (error) {
    const restoreProblems = await restoreKeysUnsafe(before, written)
    if (!restoreProblems.length) {
      // 已确认整体还原成功：日志不再需要，清掉以免下次启动做无谓回滚。
      await abandonJournal()
    }
    const detail = restoreProblems.length
      ? `；回滚不完整（${restoreProblems.join('; ')}），重启后将自动恢复`
      : '；已回滚到操作前状态'
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${detail}`,
    )
  }
  await commitScopedJournal(journalId)
}

async function restoreKeysUnsafe(
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

// ---------------------------------------------------------------------------
// 路线
// ---------------------------------------------------------------------------

/** 读取路线并在需要时把 v1/v2 惰性迁移为 v3（迁移写入同样受日志保护）。 */
async function listRoutesUnsafe(): Promise<RouteTemplate[]> {
  let routes = await readArray<RouteTemplate>(ROUTES_KEY)
  if (!routes.length) {
    const v2 = await readArray<RouteTemplate>(V2_ROUTES_KEY)
    const legacy = v2.length
      ? v2
      : await readArray<RouteTemplate>(LEGACY_ROUTES_KEY)
    if (legacy.length) {
      // 先完整转换，全部成功后再一次写入 V3。失败时继续读取旧数据，绝不清空。
      routes = legacy.map((route) => migrateRouteToV3(route))
      const before: KeySnapshot = {
        routes: await readText(ROUTES_KEY),
        sessions: await readText(SESSIONS_KEY),
        workouts: await readText(WORKOUTS_KEY),
      }
      const journalId = await beginJournal('route-migration', before, {
        ...before,
        routes: JSON.stringify(routes),
      })
      try {
        await AsyncStorage.setItem(ROUTES_KEY, JSON.stringify(routes))
        await commitJournal(journalId)
        // V3 写入成功后再清理旧键，避免备份/排障误读未迁移数据
        if (v2.length) await AsyncStorage.removeItem(V2_ROUTES_KEY)
        await AsyncStorage.removeItem(LEGACY_ROUTES_KEY)
      } catch (error) {
        console.warn('[storage] route v3 migration write failed', error)
        // 旧数据仍然可读；未提交日志会在下次启动被回滚。
      }
    }
  }
  return routes.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export async function listRoutes(): Promise<RouteTemplate[]> {
  await ensureRecovered()
  const routes = await listRoutesUnsafe()
  if (!routes.some(route => route.preparation)) return routes
  const deviceKey = await preparationDeviceKey()
  return routes.map(route => scopePreparationToDevice(route, deviceKey))
}

export async function getRoute(id: string): Promise<RouteTemplate | undefined> {
  return (await listRoutes()).find((route) => route.id === id)
}

export async function saveRoute(route: RouteTemplate): Promise<void> {
  const normalized = migrateRouteToV3(route)
  await readModifyWrite<RouteTemplate>(
    listRoutesUnsafe,
    (routes) => {
      const index = routes.findIndex((item) => item.id === normalized.id)
      if (index >= 0) routes[index] = normalized
      else routes.unshift(normalized)
      return routes
    },
    ROUTES_KEY,
  )
}

export async function deleteRoute(id: string): Promise<void> {
  await deleteRoutes([id])
}

export async function deleteRoutes(ids: string[]): Promise<void> {
  const idSet = new Set(ids)
  if (!idSet.size) return
  await ensureRecovered()
  await runSerial(async () => {
    const remainingRoutes = (await listRoutesUnsafe()).filter(
      (route) => !idSet.has(route.id),
    )
    await setItemUnsafe(ROUTES_KEY, remainingRoutes)
    if (!remainingRoutes.length) {
      await AsyncStorage.removeItem(LEGACY_ROUTES_KEY)
      await AsyncStorage.removeItem(V2_ROUTES_KEY)
    }
  })
}

export async function updateRouteLocation(
  id: string,
  location: RouteTemplate['location'],
): Promise<boolean> {
  if (!location) return false
  await ensureRecovered()
  return runSerial(async () => {
    const route = (await listRoutesUnsafe()).find((item) => item.id === id)
    if (!route) return false
    const updated = migrateRouteToV3({
      ...route,
      location,
      name: location.name,
      updatedAt: Date.now(),
    })
    const routes = await listRoutesUnsafe()
    const index = routes.findIndex((item) => item.id === updated.id)
    if (index >= 0) routes[index] = updated
    else routes.unshift(updated)
    await setItemUnsafe(ROUTES_KEY, routes)
    return true
  })
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

export interface SaveResult {
  truncated: boolean
  removed: number
}

/**
 * D08a：会话明细的读写全部委托 history-repository。
 * 返回值语义保持不变（truncated/removed）；被裁剪的记录不再「无声消失」——
 * repository 会把条数写进 meta 计数、并把它们的统计贡献永久留在增量聚合里。
 */
export async function saveSession(session: ClimbSession): Promise<SaveResult> {
  const { trimmed, total } = await historyRepository.saveSession(session)
  if (trimmed > 0) {
    console.warn(
      `[storage] sessions trimmed ${trimmed} oldest (limit ${SESSIONS_LIMIT})，已归档为统计`,
    )
    onTrim?.({ collection: 'sessions', removed: trimmed, remaining: total })
  }
  return { truncated: trimmed > 0, removed: trimmed }
}

export async function getSession(id: string): Promise<ClimbSession | undefined> {
  const session = await historyRepository.getSession(id)
  return session ? normalizeSession(session, await getRoute(session.templateId)) : undefined
}

export async function listSessions(limit?: number): Promise<ClimbSession[]> {
  const page = await historyRepository.listSessions(
    typeof limit === 'number' && limit >= 0 ? { limit } : undefined,
  )
  const normalized: ClimbSession[] = []
  for (const session of page.items) {
    try {
      normalized.push(normalizeSession(session, await getRoute(session.templateId)))
    } catch (err) {
      // 跳过损坏的单条会话，避免一条坏数据让整个 history 页崩溃
      console.warn('[steploop] skip corrupted session', session?.id, err)
    }
  }
  return normalized
}

export async function deleteSession(id: string): Promise<void> {
  await historyRepository.deleteSession(id)
}

// ---------------------------------------------------------------------------
// 备份 / 导入 / 恢复
// ---------------------------------------------------------------------------

export interface BackupPayload {
  version: 1 | 2
  exportedAt: number
  routes: RouteTemplate[]
  sessions: ClimbSession[]
  // 新增多轮训练记录，旧备份可能缺失，导入时按可选处理
  workouts?: ClimbWorkout[]
  capacity?: {
    sessionsCount: number
    sessionsLimit: number
    sessionsTrimmed: number
    workoutsCount: number
    workoutsLimit: number
    workoutsTrimmed: number
  }
  /**
   * D09 4c：可选携带「归档聚合」（长期统计账本）。
   * 没有该字段时行为与旧版完全一致（换设备会丢已裁剪记录的统计贡献，这是旧版已知缺陷）。
   */
  archiveAggregate?: ArchiveAggregate
}

/** 导出当前设备的路线与会话数据；路线走 listRoutes 以保证已迁移且不丢旧键数据。 */
export async function exportRawData(): Promise<BackupPayload> {
  await ensureRecovered()
  const sessions = await readArray<ClimbSession>(SESSIONS_KEY)
  const workouts = await readArray<ClimbWorkout>(WORKOUTS_KEY)
  const meta = await readMeta()
  // D09 4c：把「已归档明细的长期聚合」一并带走。
  // 没有这个字段时，换设备恢复会丢掉被容量策略裁剪掉的历史贡献（统计少算，明细也在源设备上）。
  const archiveAggregate = await readHistoryAggregateDoc()
  return {
    version: 2,
    exportedAt: Date.now(),
    routes: await listRoutes(),
    sessions,
    workouts,
    archiveAggregate: archiveAggregate ?? undefined,
    capacity: {
      sessionsCount: sessions.length,
      sessionsLimit: SESSIONS_LIMIT,
      sessionsTrimmed: meta.sessionsTrimmed,
      workoutsCount: workouts.length,
      workoutsLimit: SESSIONS_LIMIT,
      workoutsTrimmed: meta.workoutsTrimmed,
    },
  }
}

export type ImportMode = 'merge' | 'replace'

export interface PreImportSnapshot {
  savedAt: number
  routes: RouteTemplate[]
  sessions: ClimbSession[]
  workouts: ClimbWorkout[]
}

/**
 * F16：导入计划的**纯计算**（不写任何键）。
 * 预览与真正的导入共用这一段，避免「预览说保留 N 条、实际保留 M 条」这种最伤信任的漂移。
 */
export interface ImportPlanInput {
  mode: ImportMode
  incomingRoutes: RouteTemplate[]
  incomingSessions: ClimbSession[]
  incomingWorkouts: ClimbWorkout[]
  previousRoutes: RouteTemplate[]
  previousSessions: ClimbSession[]
  previousWorkouts: ClimbWorkout[]
  carriedAggregate: ArchiveAggregate | null
  hasLocalAggregate: boolean
}

export interface ImportPlan {
  routes: RouteTemplate[]
  sessions: ClimbSession[]
  workouts: ClimbWorkout[]
  sessionsTruncated: number
  workoutsTruncated: number
  adoptCarried: boolean
  archiveAggregateNote?: string
}

export function computeImportPlan(input: ImportPlanInput): ImportPlan {
  const {
    mode,
    incomingRoutes,
    incomingSessions,
    incomingWorkouts,
    previousRoutes,
    previousSessions,
    previousWorkouts,
    carriedAggregate,
    hasLocalAggregate,
  } = input

  let routes: RouteTemplate[]
  let sessions: ClimbSession[]
  let workouts: ClimbWorkout[]
  if (mode === 'replace') {
    routes = incomingRoutes
    sessions = incomingSessions.slice(0, SESSIONS_LIMIT)
    workouts = incomingWorkouts.slice(0, HISTORY_WORKOUT_LIMIT)
  } else {
    routes = sortRoutesByUpdatedAt(mergeById(previousRoutes, incomingRoutes))
    sessions = mergeById(previousSessions, incomingSessions).slice(0, SESSIONS_LIMIT)
    workouts = mergeById(previousWorkouts, incomingWorkouts).slice(
      0,
      HISTORY_WORKOUT_LIMIT,
    )
  }

  const mergedSessions =
    mode === 'replace' ? incomingSessions.length : mergeById(previousSessions, incomingSessions).length
  const mergedWorkouts =
    mode === 'replace' ? incomingWorkouts.length : mergeById(previousWorkouts, incomingWorkouts).length

  // D09 4c：备份携带的归档聚合如何落地，取决于本机是否已有账本。
  // - 本机无账本（新设备）：认领备份聚合，并把「保留明细」按**已入账**对待。
  // - replace：本机历史整体被备份替换，同样认领备份聚合。
  // - merge + 本机已有账本：两本账基期不同，合并必然重复计数，故不合并并留下可见说明。
  const adoptCarried =
    carriedAggregate !== null && (!hasLocalAggregate || mode === 'replace')
  let archiveAggregateNote: string | undefined
  if (carriedAggregate && !adoptCarried) {
    archiveAggregateNote =
      '备份里的归档统计未合并：本机已有归档账本，两台设备的账本基期不同，直接合并会重复计数。' +
      '如需以备份为准，请选择「替换本机数据」导入。'
  }

  return {
    routes,
    sessions,
    workouts,
    sessionsTruncated: Math.max(0, mergedSessions - SESSIONS_LIMIT),
    workoutsTruncated: Math.max(0, mergedWorkouts - HISTORY_WORKOUT_LIMIT),
    adoptCarried,
    archiveAggregateNote,
  }
}

/** 导入预览：只算不写，供 UI 在用户点「确认导入」之前如实告知后果。 */
export interface ImportPreview {
  mode: ImportMode
  incoming: { routes: number; sessions: number; workouts: number }
  kept: { routes: number; sessions: number; workouts: number }
  trimmed: { sessions: number; workouts: number }
  willCreateSnapshot: boolean
  archiveAggregate: { carried: boolean; adopted: boolean; note?: string }
  /** 需要用户知道的后果（空数组 = 无副作用提示）。 */
  warnings: string[]
}

export function previewImport(input: ImportPlanInput): ImportPreview {
  const plan = computeImportPlan(input)
  const warnings: string[] = []
  if (plan.sessionsTruncated > 0) {
    warnings.push(
      `会话明细上限 ${SESSIONS_LIMIT} 条：本次会裁掉最旧的 ${plan.sessionsTruncated} 条（统计仍会归档保留）。`,
    )
  }
  if (plan.workoutsTruncated > 0) {
    warnings.push(
      `训练明细上限 ${HISTORY_WORKOUT_LIMIT} 条：本次会裁掉最旧的 ${plan.workoutsTruncated} 条（统计仍会归档保留）。`,
    )
  }
  if (plan.archiveAggregateNote) {
    warnings.push(plan.archiveAggregateNote)
  }
  if (input.mode === 'replace') {
    warnings.push('「替换本机数据」会清空本机现有路线与历史（导入前快照仍可撤销）。')
  }
  return {
    mode: input.mode,
    incoming: {
      routes: input.incomingRoutes.length,
      sessions: input.incomingSessions.length,
      workouts: input.incomingWorkouts.length,
    },
    kept: {
      routes: plan.routes.length,
      sessions: plan.sessions.length,
      workouts: plan.workouts.length,
    },
    trimmed: {
      sessions: plan.sessionsTruncated,
      workouts: plan.workoutsTruncated,
    },
    willCreateSnapshot: true,
    archiveAggregate: {
      carried: input.carriedAggregate !== null,
      adopted: plan.adoptCarried,
      ...(plan.archiveAggregateNote ? { note: plan.archiveAggregateNote } : {}),
    },
    warnings,
  }
}

/**
 * F16：从备份 payload 生成本机相关的导入预览（读取本机现状，但不写任何键）。
 * UI 应在用户点「确认导入」之前调用它，把裁剪条数与归档认领后果如实告诉用户。
 */
export async function previewImportFromBackup(
  payload: BackupPayload,
  options?: { mode?: ImportMode },
): Promise<ImportPreview> {
  await ensureRecovered()
  const checked = validateBackupPayload(payload)
  if (!checked.ok) {
    throw new Error(checked.error)
  }
  const mode: ImportMode = options?.mode === 'replace' ? 'replace' : 'merge'
  const previousSessions = await readHistoryCollection<ClimbSession>('sessions')
  const previousWorkouts = await readHistoryCollection<ClimbWorkout>('workouts')
  const localAggregate = await readHistoryAggregateDoc()
  return previewImport({
    mode,
    incomingRoutes: checked.payload.routes.map((route) => migrateRouteToV3(route)),
    incomingSessions: checked.payload.sessions,
    incomingWorkouts: checked.payload.workouts ?? [],
    previousRoutes: mode === 'replace' ? [] : await listRoutesUnsafe(),
    previousSessions: previousSessions.items,
    previousWorkouts: previousWorkouts.items,
    carriedAggregate: checked.payload.archiveAggregate ?? null,
    hasLocalAggregate: localAggregate !== null,
  })
}

export interface ImportRawResult {
  routesCount: number
  sessionsCount: number
  workoutsCount: number
  mode: ImportMode
  snapshotCreated: boolean
  sessionsTruncated: number
  /** D08a 追加：导入时因容量策略裁掉的训练记录条数（已归档为统计）。 */
  workoutsTruncated?: number
  /** D09 4c 追加：归档聚合未随备份落地时的原因（为空表示正常认领或备份未携带）。 */
  archiveAggregateNote?: string
}

async function readSnapshot(): Promise<PreImportSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(PRE_IMPORT_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as PreImportSnapshot
    if (!value || !Array.isArray(value.routes) || !Array.isArray(value.sessions)) {
      return null
    }
    return {
      savedAt: typeof value.savedAt === 'number' ? value.savedAt : 0,
      routes: value.routes,
      sessions: value.sessions,
      workouts: Array.isArray(value.workouts) ? value.workouts : [],
    }
  } catch {
    return null
  }
}

/** 写导入前快照（覆盖式）。快照覆盖在导入失败时不应丢失，因此不在此处清理旧快照。 */
async function writePreImportSnapshotUnsafe(): Promise<void> {
  const snapshot: PreImportSnapshot = {
    savedAt: Date.now(),
    routes: await listRoutesUnsafe(),
    sessions: await readArray<ClimbSession>(SESSIONS_KEY),
    workouts: await readArray<ClimbWorkout>(WORKOUTS_KEY),
  }
  await setItemUnsafe(PRE_IMPORT_KEY, snapshot)
}

export async function preImportSnapshot(): Promise<void> {
  await ensureRecovered()
  await runSerial(writePreImportSnapshotUnsafe)
}

export async function hasPreImportSnapshot(): Promise<boolean> {
  await ensureRecovered()
  return (await readSnapshot()) !== null
}

/**
 * 恢复导入前快照。「三集合 + 增量聚合」走一次带日志的原子写入：
 * 任一步失败即整体回滚，快照本身保留以便重试。
 */
export async function restorePreImportSnapshot(): Promise<{
  routesCount: number
  sessionsCount: number
  workoutsCount: number
} | null> {
  await ensureRecovered()
  const snapshot = await readSnapshot()
  if (!snapshot) return null
  return runSerial(async () => {
    const previousSessions = await readHistoryCollection<ClimbSession>('sessions')
    const previousWorkouts = await readHistoryCollection<ClimbWorkout>('workouts')
    // 恢复同样受容量策略约束：原始明细不无限增长，被裁掉的计入聚合与计数。
    const sessions = snapshot.sessions.slice(0, SESSIONS_LIMIT)
    const workouts = snapshot.workouts.slice(0, HISTORY_WORKOUT_LIMIT)
    const sessionsTrimmed = Math.max(0, snapshot.sessions.length - SESSIONS_LIMIT)
    const workoutsTrimmed = Math.max(0, snapshot.workouts.length - HISTORY_WORKOUT_LIMIT)
    const plan = await planHistoryLedgerChanges(
      [
      {
        collection: 'sessions',
        previous: previousSessions.rows,
        next: sessions,
        policyTrimmed: sessionsTrimmed,
        corruptReasons: previousSessions.reasons,
        corruptDropped: previousSessions.rawCorrupt ? 1 : 0,
      },
      {
        collection: 'workouts',
        previous: previousWorkouts.rows,
        next: workouts,
        policyTrimmed: workoutsTrimmed,
        corruptReasons: previousWorkouts.reasons,
        corruptDropped: previousWorkouts.rawCorrupt ? 1 : 0,
      },
    ])
    const before: Record<string, string | null> = {
      [ROUTES_KEY]: await readTextStrict(ROUTES_KEY),
      [SESSIONS_KEY]: await readTextStrict(SESSIONS_KEY),
      [WORKOUTS_KEY]: await readTextStrict(WORKOUTS_KEY),
      [HISTORY_AGG_KEY]: plan.previousAggRaw,
    }
    const after: Record<string, string | null> = {
      [ROUTES_KEY]: JSON.stringify(snapshot.routes),
      [SESSIONS_KEY]: JSON.stringify(sessions),
      [WORKOUTS_KEY]: JSON.stringify(workouts),
      [HISTORY_AGG_KEY]: plan.aggRaw,
    }
    await writeJournaledKeys('restore', before, after)
    await syncLegacyTrimMirror(plan.doc)
    if (previousSessions.rawCorrupt || previousSessions.corrupt > 0) {
      await quarantineUnreadableCollection(
        'sessions',
        previousSessions.raw,
        previousSessions.reasons[0] ?? `${SESSIONS_KEY}: 内容不可解析`,
      )
    }
    if (previousWorkouts.rawCorrupt || previousWorkouts.corrupt > 0) {
      await quarantineUnreadableCollection(
        'workouts',
        previousWorkouts.raw,
        previousWorkouts.reasons[0] ?? `${WORKOUTS_KEY}: 内容不可解析`,
      )
    }
    if (sessionsTrimmed > 0) {
      console.warn(
        `[storage] restore trimmed ${sessionsTrimmed} sessions (limit ${SESSIONS_LIMIT})，已归档为统计`,
      )
      onTrim?.({
        collection: 'sessions',
        removed: sessionsTrimmed,
        remaining: sessions.length,
      })
    }
    return {
      routesCount: snapshot.routes.length,
      sessionsCount: sessions.length,
      workoutsCount: workouts.length,
    }
  })
}

function sortRoutesByUpdatedAt(routes: RouteTemplate[]): RouteTemplate[] {
  return routes.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

/**
 * 校验并导入备份文件；默认 merge 按 id 合并（入参优先），replace 覆盖但仍先快照。
 *
 * D02：多键写入受操作日志保护——第 N 键失败会整体回滚到导入前状态，
 * 不会留下「路线进来了、训练没进来」的半提交。
 * D08a：写入范围扩展为「三集合 + 增量聚合」，导入进来的记录计入长期统计，
 * 被容量策略裁掉的记录也把贡献留在聚合里（不再静默丢弃）。
 */
export async function importRawData(
  payload: BackupPayload,
  options?: { mode?: ImportMode },
): Promise<ImportRawResult> {
  await ensureRecovered()
  const checked = validateBackupPayload(payload)
  if (!checked.ok) {
    throw new Error(checked.error)
  }
  const mode: ImportMode = options?.mode === 'replace' ? 'replace' : 'merge'

  return runSerial(async () => {
    // 1) 先写导入前快照（用户可见的「撤销导入」依据）
    await writePreImportSnapshotUnsafe()

    const incomingRoutes = checked.payload.routes.map((route) => migrateRouteToV3(route))
    const incomingSessions = checked.payload.sessions
    const incomingWorkouts = checked.payload.workouts ?? []

    const previousSessions = await readHistoryCollection<ClimbSession>('sessions')
    const previousWorkouts = await readHistoryCollection<ClimbWorkout>('workouts')

    // F16：裁剪/认领逻辑与 previewImport 共用同一个纯函数，预览与真实导入不可能漂移。
    const localAggregate = await readHistoryAggregateDoc()
    const carriedAggregate = checked.payload.archiveAggregate ?? null
    const importPlan = computeImportPlan({
      mode,
      incomingRoutes,
      incomingSessions,
      incomingWorkouts,
      previousRoutes: mode === 'replace' ? [] : await listRoutesUnsafe(),
      previousSessions: previousSessions.items,
      previousWorkouts: previousWorkouts.items,
      carriedAggregate,
      hasLocalAggregate: localAggregate !== null,
    })
    const routes = importPlan.routes
    const sessions = importPlan.sessions
    const workouts = importPlan.workouts
    const sessionsTruncated = importPlan.sessionsTruncated
    const workoutsTruncated = importPlan.workoutsTruncated
    const adoptCarried = importPlan.adoptCarried
    const archiveAggregateNote = importPlan.archiveAggregateNote
    const sessionsLedgerPrevious = adoptCarried ? sessions : previousSessions.rows
    const workoutsLedgerPrevious = adoptCarried ? workouts : previousWorkouts.rows

    const plan = await planHistoryLedgerChanges(
      [
      {
        collection: 'sessions',
        previous: sessionsLedgerPrevious,
        next: sessions,
        policyTrimmed: sessionsTruncated,
        corruptReasons: previousSessions.reasons,
        corruptDropped: previousSessions.rawCorrupt ? 1 : 0,
      },
      {
        collection: 'workouts',
        previous: workoutsLedgerPrevious,
        next: workouts,
        policyTrimmed: workoutsTruncated,
        corruptReasons: previousWorkouts.reasons,
        corruptDropped: previousWorkouts.rawCorrupt ? 1 : 0,
      },
      ],
      adoptCarried ? { adoptAggregate: carriedAggregate } : undefined,
    )

    const before: Record<string, string | null> = {
      [ROUTES_KEY]: await readTextStrict(ROUTES_KEY),
      [SESSIONS_KEY]: await readTextStrict(SESSIONS_KEY),
      [WORKOUTS_KEY]: await readTextStrict(WORKOUTS_KEY),
      [HISTORY_AGG_KEY]: plan.previousAggRaw,
    }
    const after: Record<string, string | null> = {
      [ROUTES_KEY]: JSON.stringify(routes),
      [SESSIONS_KEY]: JSON.stringify(sessions),
      [WORKOUTS_KEY]: JSON.stringify(workouts),
      [HISTORY_AGG_KEY]: plan.aggRaw,
    }
    await writeJournaledKeys('import', before, after)
    await syncLegacyTrimMirror(plan.doc)

    if (previousSessions.rawCorrupt || previousSessions.corrupt > 0) {
      await quarantineUnreadableCollection(
        'sessions',
        previousSessions.raw,
        previousSessions.reasons[0] ?? `${SESSIONS_KEY}: 内容不可解析`,
      )
    }
    if (previousWorkouts.rawCorrupt || previousWorkouts.corrupt > 0) {
      await quarantineUnreadableCollection(
        'workouts',
        previousWorkouts.raw,
        previousWorkouts.reasons[0] ?? `${WORKOUTS_KEY}: 内容不可解析`,
      )
    }

    if (sessionsTruncated > 0) {
      console.warn(
        `[storage] import trimmed ${sessionsTruncated} sessions (limit ${SESSIONS_LIMIT})，已归档为统计`,
      )
      onTrim?.({
        collection: 'sessions',
        removed: sessionsTruncated,
        remaining: sessions.length,
      })
    }
    if (workoutsTruncated > 0) {
      console.warn(
        `[storage] import trimmed ${workoutsTruncated} workouts (limit ${HISTORY_WORKOUT_LIMIT})，已归档为统计`,
      )
    }
    return {
      routesCount: routes.length,
      sessionsCount: sessions.length,
      workoutsCount: workouts.length,
      mode,
      snapshotCreated: true,
      sessionsTruncated,
      workoutsTruncated,
      archiveAggregateNote,
    }
  })
}

/** 测试用：重置启动恢复缓存。生产代码不应调用。 */
export function __resetStorageForTests(): void {
  recoveryPromise = null
  __resetJournalQueueForTests()
}

// D08a：历史迁移入口（D08b 换回存储引擎时由同一契约调用；App/页面接线属后续任务）。
export {
  HISTORY_SCHEMA_VERSION as HISTORY_MIGRATION_SCHEMA_VERSION,
  migrateHistory,
  rollbackHistoryMigration,
} from './history-migration'
