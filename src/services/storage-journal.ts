import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * 存储写入顺序化与操作日志。
 *
 * 背景（D02）：
 * - 导入 / 恢复快照等操作需要同时改写 routes、sessions、workouts 三个键，
 *   而 AsyncStorage 没有跨键事务。任一步失败或进程被杀都会留下“半提交”。
 * - 各页面的 saveRoute/saveSession 是各自「读-改-写」，并发调用会互相覆盖（lost update）。
 *
 * 本模块提供两件事：
 * 1. `runSerial`：把所有写入放进一条串行队列，杜绝读改写交错。
 * 2. 操作日志：写前记录 before/after 完整内容，写后置 committed。
 *    若启动时发现未提交日志，说明上次多键写入没有走完 → 回滚到 before。
 *
 * 回滚方向一律选择 **before**（而不是前滚到 after）：
 * 半提交状态下的 after 可能不完整，before 是最后一次已知一致状态。
 * 代价是这次导入需要用户重试，但绝不会出现“路线进来了、训练没进来”的脏数据。
 */

export const STORAGE_JOURNAL_KEY = 'palou.storageJournal.v1'

/**
 * 集合名 → AsyncStorage 键的**唯一**映射。
 * services/storage.ts 与 services/workout-storage.ts 都从这里取键，
 * 避免两处各写一遍导致「日志保护的键」与「实际写入的键」漂移。
 */
export const COLLECTION_KEYS = {
  routes: 'palou.routes.v3',
  sessions: 'palou.sessions.v1',
  workouts: 'palou.workouts.v1',
} as const

export type CollectionKey = keyof typeof COLLECTION_KEYS

export const COLLECTION_KEY_NAMES = Object.keys(COLLECTION_KEYS) as CollectionKey[]

export type JournalOperation =
  | 'import'
  | 'restore'
  | 'route-migration'
  | 'finish'
  // D08a：历史 repository 的「原始明细 + 增量聚合」成对写入。
  | 'history'

export type KeySnapshot = Record<CollectionKey, string | null>

export interface JournalEntry {
  id: string
  operation: JournalOperation
  createdAt: number
  before: KeySnapshot
  after: KeySnapshot
  committed: boolean
}

/**
 * D08a：任意存储键的写入日志（storage key → 内容，null 表示该键此前不存在）。
 *
 * 为什么需要它：历史记录保存要把「原始明细键」（palou.workouts.v1 /
 * palou.sessions.v1）与「增量聚合键」（palou.historyAgg.v1）当作一件事写入，
 * 否则进程被杀会留下「明细已裁剪、聚合没记上」的静默丢失。
 * 把 routes 等无关大键塞进日志既昂贵又易触碰单键容量上限，所以用按需范围而不是固定三键。
 */
export type ScopedKeySnapshot = Record<string, string | null>

/** 写入内容的体积/校验指纹（仅用于诊断，不作为恢复依据）。 */
export interface ScopedKeyFingerprint {
  bytes: number
  hash: number
}

export interface ScopedJournalEntry {
  id: string
  operation: JournalOperation
  createdAt: number
  /** 判别标记：true 表示 before/after 是存储键映射，而不是三个集合名。 */
  scoped: true
  /** 回滚目标：每个键的完整原始内容（null 表示该键此前不存在）。 */
  before: ScopedKeySnapshot
  /**
   * 仅记录指纹，不保存 after 全文：
   * - D08a 的恢复策略与 D02 一致——一律回滚 before（半提交状态下的 after 可能不完整）；
   * - 历史明细键可能有几百 KB，日志再存一份全文会让单键体积翻倍、逼近 AsyncStorage
   *   单键上限，反而制造「写入直接失败」的容量问题。
   */
  after: Record<string, ScopedKeyFingerprint>
  committed: boolean
}

function fingerprint(raw: string | null): ScopedKeyFingerprint {
  if (raw === null) return { bytes: -1, hash: 0 }
  let hash = 0
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) | 0
  }
  return { bytes: raw.length, hash }
}

export type AnyJournalEntry = JournalEntry | ScopedJournalEntry

let queueTail: Promise<unknown> = Promise.resolve()

/**
 * 串行执行队列。所有会写 AsyncStorage 的存储操作都应经由此函数。
 *
 * 队列永不因单个任务失败而中断：失败只 reject 该任务的 promise。
 * 注意：不要在此任务内部再次调用 `runSerial`，否则死锁。
 */
export function runSerial<T>(task: () => Promise<T>): Promise<T> {
  const result = queueTail.then(task, task)
  queueTail = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

/** 运行时校验集合键未被写错（防止日志与实际存储键漂移）。 */
export function assertCollectionKeys(
  actual: Partial<Record<CollectionKey, string>>,
): void {
  for (const key of COLLECTION_KEY_NAMES) {
    if (actual[key] !== COLLECTION_KEYS[key]) {
      throw new Error(
        `storage journal 集合键不匹配：${key} journal=${COLLECTION_KEYS[key]} storage=${String(actual[key])}`,
      )
    }
  }
}

async function readJournal(): Promise<AnyJournalEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_JOURNAL_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as AnyJournalEntry
    if (!value || typeof value !== 'object' || !value.before || !value.after) {
      return null
    }
    return value
  } catch {
    return null
  }
}

async function removeJournal(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_JOURNAL_KEY)
  } catch {
    // 删除失败不致命：已 committed 的日志在下次启动时会被直接清理。
  }
}

/**
 * 写入操作日志并置 committed=false。必须在任何键被改写前完成。
 * 日志写入失败即抛错，调用方不得继续写入。
 */
export async function beginJournal(
  operation: JournalOperation,
  before: KeySnapshot,
  after: KeySnapshot,
  id = `${operation}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
): Promise<string> {
  const entry: JournalEntry = {
    id,
    operation,
    createdAt: Date.now(),
    before,
    after,
    committed: false,
  }
  await AsyncStorage.setItem(STORAGE_JOURNAL_KEY, JSON.stringify(entry))
  return id
}

/** 三个键全部写入并通过校验后再调用。 */
export async function commitJournal(id: string): Promise<void> {
  const entry = await readJournal()
  if (!entry || entry.id !== id) {
    // 日志丢失/被替换：宁可留下一条孤儿日志让下次启动回滚，也不要假装成功了。
    throw new Error(`storage journal commit failed: entry ${id} not found`)
  }
  await AsyncStorage.setItem(
    STORAGE_JOURNAL_KEY,
    JSON.stringify({ ...entry, committed: true }),
  )
  await removeJournal()
}

/**
 * D08a：按任意存储键范围写入操作日志（同一存储槽，互斥由调用方的串行队列保证）。
 * 与 `beginJournal` 的区别只是 before/after 用存储键而不是三个集合名。
 */
export async function beginScopedJournal(
  operation: JournalOperation,
  before: ScopedKeySnapshot,
  after: ScopedKeySnapshot,
  id = `${operation}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
): Promise<string> {
  const fingerprints: Record<string, ScopedKeyFingerprint> = {}
  for (const [key, raw] of Object.entries(after)) fingerprints[key] = fingerprint(raw)
  const entry: ScopedJournalEntry = {
    id,
    operation,
    createdAt: Date.now(),
    scoped: true,
    before,
    after: fingerprints,
    committed: false,
  }
  await AsyncStorage.setItem(STORAGE_JOURNAL_KEY, JSON.stringify(entry))
  return id
}

/** 范围内所有键写入并通过读回校验后再调用。 */
export async function commitScopedJournal(id: string): Promise<void> {
  const entry = await readJournal()
  if (!entry || entry.id !== id) {
    throw new Error(`storage journal commit failed: entry ${id} not found`)
  }
  await AsyncStorage.setItem(
    STORAGE_JOURNAL_KEY,
    JSON.stringify({ ...entry, committed: true }),
  )
  await removeJournal()
}

/**
 * 调用方已确认把三个键整体还原成功后清理日志。
 * 只有「确认还原成功」时才可调用；还原不完整必须保留日志交给启动恢复。
 */
export async function abandonJournal(): Promise<void> {
  await removeJournal()
}

export interface RecoveryReport {
  recovered: boolean
  operation?: JournalOperation
  entryId?: string
  /** 已还原的集合名（旧格式）或存储键（scoped 格式）。 */
  restored?: string[]
  failure?: string
}

/**
 * 启动时恢复：发现未提交日志 → 回滚 before → 清理日志。
 * 幂等：没有日志时返回 { recovered: false }。
 *
 * 兼容两种格式：
 * - 旧格式（D02）：before/after 只覆盖 routes/sessions/workouts 三个集合名；
 * - scoped 格式（D08a）：before/after 是任意存储键映射。
 * 两种格式都只还原 before 里**实际存在**的键，绝不因为字段缺失而写入 "undefined"。
 */
export async function recoverPendingJournal(): Promise<RecoveryReport> {
  const entry = await readJournal()
  if (!entry) return { recovered: false }
  if (entry.committed) {
    await removeJournal()
    return { recovered: false }
  }
  const targets: Array<[string, string | null]> = []
  if ('scoped' in entry && entry.scoped) {
    for (const [storageKey, content] of Object.entries(entry.before)) {
      targets.push([storageKey, content ?? null])
    }
  } else {
    const legacyBefore = entry.before as KeySnapshot
    for (const key of COLLECTION_KEY_NAMES) {
      if (!(key in legacyBefore)) continue
      targets.push([COLLECTION_KEYS[key], legacyBefore[key] ?? null])
    }
  }
  if (targets.length === 0) {
    // F23：日志存在但里面没有任何可识别的集合键（格式未知/被截断/来自更新版本）。
    // 此时**不能**返回 recovered=true 再把日志删掉：那等于「什么都没还原，却宣称已恢复，
    // 顺手销毁唯一的排查证据」。宁可报失败并保留日志。
    return {
      recovered: false,
      operation: entry.operation,
      entryId: entry.id,
      restored: [],
      failure:
        '日志中没有可识别的集合键，无法回滚；已保留日志以便排查（不会删除证据）',
    }
  }
  const restored: string[] = []
  const problems: string[] = []
  for (const [storageKey, target] of targets) {
    try {
      if (target === null) await AsyncStorage.removeItem(storageKey)
      else await AsyncStorage.setItem(storageKey, target)
      restored.push(storageKey)
    } catch (error) {
      problems.push(`${storageKey}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (problems.length) {
    // 保留日志，下次启动继续尝试，绝不静默丢弃未恢复的半提交状态。
    return {
      recovered: false,
      operation: entry.operation,
      entryId: entry.id,
      restored,
      failure: problems.join('; '),
    }
  }
  await removeJournal()
  return {
    recovered: true,
    operation: entry.operation,
    entryId: entry.id,
    restored,
  }
}

/** 测试用：清空串行队列尾（仅影响队列引用，不改变 AsyncStorage）。 */
export function __resetJournalQueueForTests(): void {
  queueTail = Promise.resolve()
}
