import { ClimbSession, ClimbWorkout } from '../core/types'
import {
  HISTORY_AGG_KEY,
  HISTORY_META_KEY,
  HISTORY_MIGRATION_KEY,
  HISTORY_ROLLBACK_KEY,
  HISTORY_SCHEMA_VERSION as REPOSITORY_SCHEMA_VERSION,
  HISTORY_SESSIONS_KEY,
  HISTORY_WORKOUTS_KEY,
  ensureHistoryRecovered,
  planHistoryLedgerChanges,
  quarantineUnreadableCollection,
  readHistoryAggregateDoc,
  readHistoryCollection,
  readHistoryRawKey,
  removeHistoryKey,
  writeHistoryRawKey,
} from './history-repository'
import { runSerial } from './storage-journal'

/**
 * 历史记录迁移（D08a）。
 *
 * D08a 的迁移只做三件事，**不搬动、不改写任何旧键的内容**：
 * 1. 把旧键（sessions/workouts/meta）的原始内容复制成一份回滚快照；
 * 2. 由旧数据 + 旧 meta 裁剪计数生成增量聚合文档（新增键 `palou.historyAgg.v1`）；
 * 3. 写迁移完成标记（新增键 `palou.historyMigration.v1`）。
 *
 * 因此：
 * - 迁移**可重入**：任何一步失败都会把状态置为 failed 并保留源数据，重跑即可完成；
 * - 迁移**可回滚**：`rollbackHistoryMigration()` 用快照把旧键恢复成逐字节一致；
 * - 迁移**不删源数据**：过程中从不写 routes/sessions/workouts。
 *
 * D08b（本轮未做）会把引擎换成 expo-sqlite；届时表结构与真机迁移验证独立进行。
 */

/** 与 repository 使用同一常量，避免两处版本号漂移。 */
export const HISTORY_SCHEMA_VERSION = REPOSITORY_SCHEMA_VERSION

interface HistoryRollbackSnapshot {
  version: number
  savedAt: number
  schemaVersion: number
  /** 迁移前各存储键的原始内容（null 表示当时不存在）。 */
  keys: Record<string, string | null>
}

interface MigrationStatusRecord {
  schemaVersion: number
  state: 'none' | 'running' | 'done' | 'failed'
  migratedAt?: number
  lastError?: string
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readStatusRecord(): Promise<MigrationStatusRecord | null> {
  const raw = await readHistoryRawKey(HISTORY_MIGRATION_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as MigrationStatusRecord
    if (!parsed || typeof parsed !== 'object' || typeof parsed.state !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

async function writeStatusRecord(record: MigrationStatusRecord): Promise<void> {
  await writeHistoryRawKey(HISTORY_MIGRATION_KEY, JSON.stringify(record))
}

async function hasRollbackSnapshot(): Promise<boolean> {
  const raw = await readHistoryRawKey(HISTORY_ROLLBACK_KEY)
  return typeof raw === 'string' && raw.length > 0
}

/** 迁移前原始内容快照：只读源键，不写源键。 */
async function captureRollbackSnapshot(): Promise<HistoryRollbackSnapshot> {
  const keys: Record<string, string | null> = {}
  for (const key of [HISTORY_SESSIONS_KEY, HISTORY_WORKOUTS_KEY, HISTORY_META_KEY]) {
    keys[key] = await readHistoryRawKey(key)
  }
  return {
    version: 1,
    savedAt: Date.now(),
    schemaVersion: HISTORY_SCHEMA_VERSION,
    keys,
  }
}

/**
 * 执行迁移。幂等：已完成（同版本 done）时直接返回，不再写任何键。
 * 失败时不删除源数据，状态置为 failed 并返回原因，可安全重跑。
 */
export async function migrateHistory(): Promise<{
  schemaVersion: number
  migratedAt?: number
  state: 'none' | 'running' | 'done' | 'failed'
  lastError?: string
  hasRollbackSnapshot: boolean
}> {
  await ensureHistoryRecovered()
  return runSerial(async () => {
    const current = await readStatusRecord()
    if (current && current.state === 'done' && current.schemaVersion === HISTORY_SCHEMA_VERSION) {
      return {
        schemaVersion: current.schemaVersion,
        migratedAt: current.migratedAt,
        state: 'done' as const,
        lastError: current.lastError,
        hasRollbackSnapshot: await hasRollbackSnapshot(),
      }
    }

    try {
      await writeStatusRecord({
        schemaVersion: HISTORY_SCHEMA_VERSION,
        state: 'running',
      })

      // 1) 回滚快照：已存在则不覆盖（首次迁移前状态才是回滚目标）。
      if (!(await hasRollbackSnapshot())) {
        const snapshot = await captureRollbackSnapshot()
        await writeHistoryRawKey(HISTORY_ROLLBACK_KEY, JSON.stringify(snapshot))
      } else {
        console.warn('[history-migration] 回滚快照已存在，保留首次迁移前状态，不覆盖')
      }

      // 2) 增量聚合：已有当前版本的聚合就不重算（避免把计数清零）。
      const existingAggregate = await readHistoryAggregateDoc()
      let corruptNote: string | undefined
      if (!existingAggregate) {
        const workouts = await readHistoryCollection<ClimbWorkout>('workouts')
        const sessions = await readHistoryCollection<ClimbSession>('sessions')
        const plan = await planHistoryLedgerChanges([
          {
            collection: 'workouts',
            previous: workouts.rows,
            next: workouts.rows,
            policyTrimmed: 0,
            corruptReasons: workouts.reasons,
          },
          {
            collection: 'sessions',
            previous: sessions.rows,
            next: sessions.rows,
            policyTrimmed: 0,
            corruptReasons: sessions.reasons,
          },
        ])
        await writeHistoryRawKey(HISTORY_AGG_KEY, plan.aggRaw)
        if (workouts.rawCorrupt) {
          await quarantineUnreadableCollection(
            'workouts',
            workouts.raw,
            workouts.reasons[0] ?? `${HISTORY_WORKOUTS_KEY}: 内容不可解析`,
          )
        }
        if (sessions.rawCorrupt) {
          await quarantineUnreadableCollection(
            'sessions',
            sessions.raw,
            sessions.reasons[0] ?? `${HISTORY_SESSIONS_KEY}: 内容不可解析`,
          )
        }
        const corruptCount = workouts.corrupt + sessions.corrupt
        if (corruptCount > 0) {
          const reasons = [...workouts.reasons, ...sessions.reasons].slice(0, 5).join('；')
          corruptNote = `迁移完成，但有 ${corruptCount} 条损坏记录被跳过并隔离（原始内容未删除）：${reasons}`
          console.warn(`[history-migration] ${corruptNote}`)
        }
      }

      const migratedAt = Date.now()
      await writeStatusRecord({
        schemaVersion: HISTORY_SCHEMA_VERSION,
        state: 'done',
        migratedAt,
        lastError: corruptNote,
      })
      return {
        schemaVersion: HISTORY_SCHEMA_VERSION,
        migratedAt,
        state: 'done' as const,
        lastError: corruptNote,
        hasRollbackSnapshot: true,
      }
    } catch (error) {
      const lastError = messageOf(error)
      try {
        await writeStatusRecord({
          schemaVersion: HISTORY_SCHEMA_VERSION,
          state: 'failed',
          lastError,
        })
      } catch (statusError) {
        console.error('[history-migration] 失败状态写入也失败', statusError)
      }
      console.error('[history-migration] 迁移失败，源数据未删除，可重跑', lastError)
      return {
        schemaVersion: HISTORY_SCHEMA_VERSION,
        state: 'failed' as const,
        lastError,
        hasRollbackSnapshot: await hasRollbackSnapshot(),
      }
    }
  })
}

/**
 * 用迁移前快照把旧键恢复成逐字节一致，并删除迁移新增的聚合/状态键。
 * 幂等：可重复调用。无快照时返回 { restored: false, reason }。
 */
export async function rollbackHistoryMigration(): Promise<{ restored: boolean; reason?: string }> {
  await ensureHistoryRecovered()
  return runSerial(async () => {
    const raw = await readHistoryRawKey(HISTORY_ROLLBACK_KEY)
    if (!raw) return { restored: false, reason: '没有迁移前快照，无法回滚' }
    let snapshot: HistoryRollbackSnapshot
    try {
      snapshot = JSON.parse(raw) as HistoryRollbackSnapshot
    } catch (error) {
      return { restored: false, reason: `快照不可解析：${messageOf(error)}` }
    }
    const keys = snapshot?.keys
    if (!keys || typeof keys !== 'object') {
      return { restored: false, reason: '快照缺少原始键内容' }
    }
    try {
      for (const [key, value] of Object.entries(keys)) {
        await writeHistoryRawKey(key, typeof value === 'string' ? value : null)
      }
      // 迁移新增的键不属于「迁移前状态」，回滚时删除；快照本身保留以便重复回滚。
      await removeHistoryKey(HISTORY_AGG_KEY)
      await removeHistoryKey(HISTORY_MIGRATION_KEY)
    } catch (error) {
      return { restored: false, reason: messageOf(error) }
    }
    return { restored: true }
  })
}
