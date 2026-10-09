import { ClimbSession, ClimbWorkout, RouteTemplate, WorkoutRound } from './types'
import { isBuildingTemplate } from './building-model'

export interface BackupPayloadLike {
  version: 1 | 2 | 3
  exportedAt: number
  routes: RouteTemplate[]
  sessions: ClimbSession[]
  workouts?: ClimbWorkout[]
  /**
   * D09：可选携带「归档聚合」（长期统计账本）。旧备份没有该字段，恢复行为完全不变。
   * 字段内容损坏时只忽略该字段并记录原因（在 `archiveAggregateProblems` 里），
   * 绝不因此拒绝整包备份。
   */
  archiveAggregate?: ArchiveAggregate
  /** D09：`archiveAggregate` 被逐项纠正或忽略的原因（不得静默）。 */
  archiveAggregateProblems?: string[]
}

/** 归档聚合的 schema 版本（与 historyRepository 的聚合文档一致；不匹配时忽略该字段）。 */
export const BACKUP_ARCHIVE_AGGREGATE_VERSION = 2

export interface ArchiveDayBucket {
  workouts: number
  floors: number
}

/**
 * 已归档/已离开保留集合记录的增量账本（结构镜像 history-repository 的 CollectionLedger）。
 * 只保留 `summarize()` 长期统计需要的字段；明细本身可以已被裁剪。
 */
export interface ArchiveLedger {
  writtenTotal: number
  trimmedTotal: number
  removedTotal: number
  detailCovered: number
  expectedRetained: number
  floors: number
  ascentM: number
  activeDurationMs: number
  byDay: Record<string, ArchiveDayBucket>
  firstAtMs?: number
  lastAtMs?: number
}

export interface ArchiveAggregate {
  schemaVersion: number
  workouts: ArchiveLedger
  sessions: ArchiveLedger
  skippedCorrupt: number
  corruptReasons: string[]
  updatedAt: number
}

export interface ArchiveAggregateReadResult {
  /** 'absent'：旧备份没有该字段；'ok'：可用；'invalid'：字段损坏，已忽略但不拒绝整包。 */
  state: 'absent' | 'ok' | 'invalid'
  aggregate?: ArchiveAggregate
  problems: string[]
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nonNegative(value: unknown): number {
  const finite = finiteNumber(value)
  return finite === undefined ? 0 : Math.max(0, finite)
}

function optionalTime(value: unknown): number | undefined {
  const finite = finiteNumber(value)
  return finite === undefined || finite <= 0 ? undefined : finite
}

const ARCHIVE_LEDGER_NUMERIC_FIELDS = [
  'writtenTotal',
  'trimmedTotal',
  'removedTotal',
  'detailCovered',
  'expectedRetained',
  'floors',
  'ascentM',
  'activeDurationMs',
] as const

function normalizeLedger(
  value: unknown,
  label: string,
  problems: string[],
): ArchiveLedger {
  const source = isObjectLike(value) ? value : {}
  if (!isObjectLike(value)) {
    problems.push(`${label} 不是对象，已按空账本处理`)
  }
  // 逐字段归一：缺失按 0，存在但不是有限数字则按 0 处理并留下可解释原因（不静默）。
  const numbers: Record<string, number> = {}
  for (const field of ARCHIVE_LEDGER_NUMERIC_FIELDS) {
    const raw = source[field]
    if (raw === undefined || raw === null) {
      numbers[field] = 0
      continue
    }
    const finite = finiteNumber(raw)
    if (finite === undefined) {
      problems.push(`${label}.${field} 不是有限数字（${typeof raw}），已按 0 处理`)
      numbers[field] = 0
      continue
    }
    numbers[field] = Math.max(0, finite)
  }
  const byDay: Record<string, ArchiveDayBucket> = {}
  if (isObjectLike(source.byDay)) {
    for (const [day, bucket] of Object.entries(source.byDay)) {
      if (!isObjectLike(bucket)) {
        problems.push(`${label}.byDay['${day}'] 不是对象，已忽略该天分桶`)
        continue
      }
      const workoutsRaw = bucket.workouts
      const floorsRaw = bucket.floors
      if (
        (workoutsRaw !== undefined && finiteNumber(workoutsRaw) === undefined) ||
        (floorsRaw !== undefined && finiteNumber(floorsRaw) === undefined)
      ) {
        problems.push(`${label}.byDay['${day}'] 含非有限数字，已按 0 处理`)
      }
      byDay[day] = {
        workouts: nonNegative(workoutsRaw),
        floors: nonNegative(floorsRaw),
      }
    }
  } else if (source.byDay !== undefined) {
    problems.push(`${label}.byDay 不是对象，已忽略按天分桶`)
  }
  // 可选字段在无效时**省略键**（而不是留 undefined）：JSON 往返后对象逐字段一致。
  const ledger: ArchiveLedger = {
    writtenTotal: numbers.writtenTotal,
    trimmedTotal: numbers.trimmedTotal,
    removedTotal: numbers.removedTotal,
    detailCovered: numbers.detailCovered,
    expectedRetained: numbers.expectedRetained,
    floors: numbers.floors,
    ascentM: numbers.ascentM,
    activeDurationMs: numbers.activeDurationMs,
    byDay,
  }
  const firstAtMs = optionalTime(source.firstAtMs)
  const lastAtMs = optionalTime(source.lastAtMs)
  if (firstAtMs !== undefined) ledger.firstAtMs = firstAtMs
  if (lastAtMs !== undefined) ledger.lastAtMs = lastAtMs
  return ledger
}

/**
 * 读取备份载荷里的归档聚合（纯函数）。
 * - 字段缺失 → 'absent'（旧备份：恢复方完全不做额外动作，行为不变）。
 * - 结构/版本不符或整体不可辨 → 'invalid' + problems（调用方应告警并继续恢复其余数据）。
 * - 可用 → 'ok'，并把非有限数字、坏的天分桶逐项纠正（原因写进 problems）。
 */
export function readArchiveAggregate(value: unknown): ArchiveAggregateReadResult {
  if (value === undefined || value === null) {
    return { state: 'absent', problems: [] }
  }
  if (!isObjectLike(value)) {
    return {
      state: 'invalid',
      problems: [`归档聚合字段不是对象（${Array.isArray(value) ? 'array' : typeof value}），已忽略`],
    }
  }
  if (value.schemaVersion !== BACKUP_ARCHIVE_AGGREGATE_VERSION) {
    return {
      state: 'invalid',
      problems: [
        `归档聚合 schemaVersion=${String(value.schemaVersion)} 不受支持（期望 ${BACKUP_ARCHIVE_AGGREGATE_VERSION}），已忽略`,
      ],
    }
  }
  if (!isObjectLike(value.workouts) || !isObjectLike(value.sessions)) {
    return {
      state: 'invalid',
      problems: ['归档聚合缺少 workouts/sessions 账本，已忽略'],
    }
  }
  const problems: string[] = []
  const aggregate: ArchiveAggregate = {
    schemaVersion: BACKUP_ARCHIVE_AGGREGATE_VERSION,
    workouts: normalizeLedger(value.workouts, 'workouts', problems),
    sessions: normalizeLedger(value.sessions, 'sessions', problems),
    skippedCorrupt: nonNegative(value.skippedCorrupt),
    corruptReasons: Array.isArray(value.corruptReasons)
      ? value.corruptReasons.filter((item): item is string => typeof item === 'string')
      : [],
    updatedAt: nonNegative(value.updatedAt),
  }
  return { state: 'ok', aggregate, problems }
}

export function mergeById<T extends { id: string }>(
  existing: T[],
  incoming: T[],
): T[] {
  if (!incoming.length) return existing.slice()
  if (!existing.length) return incoming.slice()
  const incomingIds = new Set(incoming.map((item) => item.id))
  const kept = existing.filter((item) => !incomingIds.has(item.id))
  return [...incoming, ...kept]
}

/**
 * 备份往返时修正链必须原样保留（D06）：
 * - 合法数组：原引用直接透传，导出→导入后链完整；
 * - 脏数据（非数组）：降级为空链，避免旧备份/外部文件把结果页打崩。
 * 不影响旧备份：旧记录没有该字段时不做任何改写。
 * 全部记录都合法时返回原数组引用，保证与导入前的对象同一性不变。
 */
function sanitizeWorkoutCorrections(workouts: ClimbWorkout[]): ClimbWorkout[] {
  let changed = false
  const next = workouts.map((workout) => {
    if (!workout || !Array.isArray(workout.rounds)) return workout
    let workoutChanged = false
    const rounds = workout.rounds.map((round) => {
      if (
        !round ||
        round.corrections === undefined ||
        Array.isArray(round.corrections)
      ) {
        return round
      }
      workoutChanged = true
      const cleaned: WorkoutRound = { ...round }
      delete cleaned.corrections
      return cleaned
    })
    if (!workoutChanged) return workout
    changed = true
    return { ...workout, rounds }
  })
  return changed ? next : workouts
}

/**
 * 备份载荷校验（纯函数）。storage.importRawData 与设置页预览共用同一规则。
 */
export function validateBackupPayload(
  value: unknown,
): { ok: true; payload: BackupPayloadLike } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: '备份内容格式无效' }
  }
  const payload = value as Partial<BackupPayloadLike>
  if (payload.version !== 1 && payload.version !== 2 && payload.version !== 3) {
    return { ok: false, error: `不支持的备份版本：${String(payload.version)}` }
  }
  if (!Array.isArray(payload.routes) || !Array.isArray(payload.sessions)) {
    return { ok: false, error: '备份内容缺少 routes 或 sessions 字段' }
  }
  if (payload.routes.some(route => route?.building !== undefined && !isBuildingTemplate(route.building))) {
    return { ok: false, error: '备份中的楼宇模板格式无效，请保留原文件并检查数据。' }
  }
  const workouts = Array.isArray(payload.workouts) ? payload.workouts : []
  const payloadWithoutArchive: BackupPayloadLike = {
    version: payload.version,
    exportedAt: typeof payload.exportedAt === 'number' ? payload.exportedAt : 0,
    routes: payload.routes,
    sessions: payload.sessions,
    workouts: sanitizeWorkoutCorrections(workouts),
  }
  // D09 验收 4c：归档聚合是**可选**字段。
  // - 旧备份没有该字段：结果对象里不出现这两个键（恢复行为与 D06/D08a 时期完全一致）。
  // - 字段损坏：只忽略该字段并把原因带出来，整包仍然 ok（不拒绝恢复其余数据）。
  const archive = readArchiveAggregate(payload.archiveAggregate)
  if (archive.state === 'ok' && archive.aggregate) {
    payloadWithoutArchive.archiveAggregate = archive.aggregate
    if (archive.problems.length) {
      payloadWithoutArchive.archiveAggregateProblems = archive.problems
    }
  } else if (archive.state === 'invalid') {
    payloadWithoutArchive.archiveAggregateProblems = archive.problems
  }
  return { ok: true, payload: payloadWithoutArchive }
}
