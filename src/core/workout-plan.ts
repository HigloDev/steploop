// D07：训练计划结构（热身/上爬/返回/恢复）——纯函数，无副作用。
//
// 设计要点：
// - 计划是「阶段序列」而不是只由目标数字驱动：
//   热身（只在最前）→ 每轮 [上爬 → 返回? → 恢复?]。
//   轮数固定（rounds: number）时序列有限，`nextPlanPhase` 越过末尾返回 undefined；
//   轮数由目标决定（rounds: 'until_goal'）时序列无限，何时结束由目标达成判定
//   （`planGoalReached` / `buildPlanFeedback`）决定。
// - 计时与计数归属明确：只有 climb 阶段计入净爬楼时长（activeDurationMs）与楼层/步数成绩；
//   返回计入 returnDurationMs、恢复计入 recoveryDurationMs，热身不进入任何既有汇总字段。
//   「休息不算上爬」由 `planPhaseAccounting` / `summarizePhaseDurations` 显式表达。
// - 与既有目标（open/rounds/floors/ascent/duration）兼容：`plan.goal` 直接复用 WorkoutGoal，
//   达成判定与文案和 workout-summary.checkGoalReached 逐字对齐（见 planGoalReached/planGoalMessage）。
// - 计划必须可确定性序列化：本模块内部**不调用** Date.now()/uid()/Math.random()，
//   时间戳与 id 一律由调用方显式传入；`serializePlan` 固定字段顺序、丢弃 undefined。

import {
  PlanPhaseKind,
  PlanProgress,
  WorkoutGoal,
  WorkoutPlan,
  WorkoutPlanPhase,
} from './types'

export const PLAN_SCHEMA_VERSION = 1

/** 阶段规范推进顺序：热身仅出现在最前，返回/恢复只出现在每轮上爬之后。 */
export const PLAN_PHASE_ORDER: readonly PlanPhaseKind[] = [
  'warmup',
  'climb',
  'return',
  'recovery',
]

/** 计划默认时长（毫秒）。构建函数可用选项覆盖，保证构建结果确定。 */
export const DEFAULT_WARMUP_MS = 5 * 60 * 1000
export const DEFAULT_RETURN_MS = 4 * 60 * 1000
export const DEFAULT_RECOVERY_MS = 2 * 60 * 1000

// === 阶段计时/计数归属 ===

/** 阶段时长计入哪个既有汇总字段；'none' 表示不进入任何既有字段（热身）。 */
export type PhaseDurationBucket = 'active' | 'return' | 'recovery' | 'none'

export interface PlanPhaseAccounting {
  durationBucket: PhaseDurationBucket
  /** 是否计入楼层/爬升成绩（只有上爬算成绩）。 */
  countsFloors: boolean
  /** 是否计入步数成绩。 */
  countsSteps: boolean
}

const PHASE_ACCOUNTING: Record<PlanPhaseKind, PlanPhaseAccounting> = {
  // 热身是准备环节：既不是上爬成绩，也没有对应的汇总字段（本任务不新增汇总字段）。
  warmup: { durationBucket: 'none', countsFloors: false, countsSteps: false },
  climb: { durationBucket: 'active', countsFloors: true, countsSteps: true },
  // 返回与恢复都是休息：只进各自的时长字段，永远不进净爬楼时长。
  return: { durationBucket: 'return', countsFloors: false, countsSteps: false },
  recovery: { durationBucket: 'recovery', countsFloors: false, countsSteps: false },
}

export function planPhaseAccounting(kind: PlanPhaseKind): PlanPhaseAccounting {
  return PHASE_ACCOUNTING[kind]
}

/** 只有上爬阶段计入净爬楼时长：休息（返回/恢复）与热身都不算上爬成绩。 */
export function countsAsActiveClimb(kind: PlanPhaseKind): boolean {
  return PHASE_ACCOUNTING[kind].durationBucket === 'active'
}

export interface PhaseDurationTotals {
  activeDurationMs: number
  returnDurationMs: number
  recoveryDurationMs: number
  /** 热身等既不计入净爬楼也不计入返回/恢复的时长（当前无对应汇总字段）。 */
  uncountedDurationMs: number
}

export function emptyPhaseDurationTotals(): PhaseDurationTotals {
  return {
    activeDurationMs: 0,
    returnDurationMs: 0,
    recoveryDurationMs: 0,
    uncountedDurationMs: 0,
  }
}

export interface PhaseDurationEntry {
  kind: PlanPhaseKind
  durationMs: number
}

/**
 * 把各阶段实测时长归入既有汇总口径。
 * 跳过某个阶段 = 不传入该阶段的记录：净爬楼时长不受休息阶段是否跳过影响。
 */
export function summarizePhaseDurations(
  entries: readonly PhaseDurationEntry[],
): PhaseDurationTotals {
  const totals = emptyPhaseDurationTotals()
  for (const entry of entries) {
    const ms = isFiniteNumber(entry.durationMs) ? Math.max(0, entry.durationMs) : 0
    switch (PHASE_ACCOUNTING[entry.kind].durationBucket) {
      case 'active':
        totals.activeDurationMs += ms
        break
      case 'return':
        totals.returnDurationMs += ms
        break
      case 'recovery':
        totals.recoveryDurationMs += ms
        break
      case 'none':
        totals.uncountedDurationMs += ms
        break
    }
  }
  return totals
}

// === 规范顺序与结构描述 ===

export function planPhaseRank(kind: PlanPhaseKind): number {
  return PLAN_PHASE_ORDER.indexOf(kind)
}

/** 单轮重复的阶段：climb[, return][, recovery]，顺序即推进顺序。 */
export function roundPhases(plan: WorkoutPlan): WorkoutPlanPhase[] {
  const phases: WorkoutPlanPhase[] = [plan.climbPerRound]
  if (plan.returnPerRound) phases.push(plan.returnPerRound)
  if (plan.recoveryPerRound) phases.push(plan.recoveryPerRound)
  return phases
}

/** 计划声明的阶段种类（去重、按规范顺序）。 */
export function planPhaseKinds(plan: WorkoutPlan): PlanPhaseKind[] {
  const kinds: PlanPhaseKind[] = []
  if (plan.warmup) kinds.push('warmup')
  for (const phase of roundPhases(plan)) {
    if (!kinds.includes(phase.kind)) kinds.push(phase.kind)
  }
  return kinds.sort((a, b) => planPhaseRank(a) - planPhaseRank(b))
}

function planPhaseForKind(
  plan: WorkoutPlan,
  kind: PlanPhaseKind,
): WorkoutPlanPhase | undefined {
  switch (kind) {
    case 'warmup':
      return plan.warmup
    case 'climb':
      return plan.climbPerRound
    case 'return':
      return plan.returnPerRound
    case 'recovery':
      return plan.recoveryPerRound
  }
}

export function canSkipPhase(plan: WorkoutPlan, phase: WorkoutPlanPhase): boolean {
  // 上爬是成绩来源：无论数据里写了什么，都不可跳过。
  if (phase.kind === 'climb') return false
  if (!planPhaseForKind(plan, phase.kind)) return false
  return phase.skippable === true
}

// === 阶段序列推进 ===

function planRoundCount(plan: WorkoutPlan): number | 'until_goal' {
  if (plan.rounds === 'until_goal') return 'until_goal'
  if (!isFiniteNumber(plan.rounds)) return 0
  return Math.max(0, Math.floor(plan.rounds))
}

/** 计划总阶段数；轮数由目标决定时为 'unknown'。 */
export function planPhaseCount(plan: WorkoutPlan): number | 'unknown' {
  const rounds = planRoundCount(plan)
  if (rounds === 'until_goal') return 'unknown'
  return rounds * roundPhases(plan).length + (plan.warmup ? 1 : 0)
}

/** 索引取阶段：有限计划越界返回 undefined；'until_goal' 计划按周期无限延伸。 */
export function planPhaseAtIndex(
  plan: WorkoutPlan,
  index: number,
): WorkoutPlanPhase | undefined {
  if (!Number.isInteger(index) || index < 0) return undefined
  let cursor = index
  if (plan.warmup) {
    if (cursor === 0) return plan.warmup
    cursor -= 1
  }
  const perRound = roundPhases(plan)
  if (perRound.length === 0) return undefined
  const rounds = planRoundCount(plan)
  if (rounds !== 'until_goal' && cursor >= rounds * perRound.length) return undefined
  return perRound[cursor % perRound.length]
}

/**
 * 物化阶段序列。有限计划返回完整序列；
 * 'until_goal' 计划必须用 options.rounds 指定预览轮数（默认 1 轮）。
 */
export function planPhaseSequence(
  plan: WorkoutPlan,
  options?: { rounds?: number },
): WorkoutPlanPhase[] {
  const rounds = planRoundCount(plan)
  const limit =
    rounds === 'until_goal'
      ? Math.max(0, Math.floor(options?.rounds ?? 1))
      : rounds
  const sequence: WorkoutPlanPhase[] = []
  if (plan.warmup) sequence.push(plan.warmup)
  const perRound = roundPhases(plan)
  for (let round = 0; round < limit; round += 1) {
    for (const phase of perRound) sequence.push(phase)
  }
  return sequence
}

/** 位于 index 之前的阶段种类（即「已完成/已走过」的前缀）。 */
export function planPhaseKindsBefore(plan: WorkoutPlan, index: number): PlanPhaseKind[] {
  const kinds: PlanPhaseKind[] = []
  for (let i = 0; i < index; i += 1) {
    const phase = planPhaseAtIndex(plan, i)
    if (!phase) break
    kinds.push(phase.kind)
  }
  return kinds
}

/** 已完成的轮数：只有走完 climb 阶段才算完成一轮。 */
export function completedRoundCount(progress: PlanProgress): number {
  return progress.completedPhases.filter((kind) => kind === 'climb').length
}

export interface PlanProgressOptions {
  completedPhases?: PlanPhaseKind[]
  skippedPhases?: PlanPhaseKind[]
}

/**
 * 构造某个阶段索引处的进度快照。
 * completedPhases 缺省时由序列前缀推导（按阶段种类排除已跳过的种类，
 * 这是 PlanProgress.skippedPhases 的既有口径）；需要精确到轮次时由调用方显式传入。
 */
export function planProgressAt(
  plan: WorkoutPlan,
  index: number,
  options: PlanProgressOptions = {},
): PlanProgress {
  const skippedPhases = options.skippedPhases
    ? [...options.skippedPhases]
    : []
  const completedPhases = options.completedPhases
    ? [...options.completedPhases]
    : planPhaseKindsBefore(plan, index).filter(
        (kind) => !skippedPhases.includes(kind),
      )

  const rounds = planRoundCount(plan)
  const doneRounds = completedPhases.filter((kind) => kind === 'climb').length
  const remainingRounds: number | 'unknown' =
    rounds === 'until_goal' ? 'unknown' : Math.max(0, rounds - doneRounds)

  const totalPhases = planPhaseCount(plan)
  const phaseIndex =
    totalPhases === 'unknown'
      ? Math.max(0, Math.floor(index))
      : Math.min(Math.max(0, Math.floor(index)), totalPhases)

  let roundNumber: number
  if (rounds === 'until_goal') {
    roundNumber = Math.max(1, countClimbsUpTo(plan, index))
  } else if (rounds === 0) {
    roundNumber = 0
  } else {
    roundNumber = Math.min(rounds, Math.max(1, countClimbsUpTo(plan, index)))
  }

  return {
    phaseIndex,
    roundNumber,
    completedPhases,
    skippedPhases,
    remainingRounds,
  }
}

/** 轮次归属：阶段 index 属于第几轮 = 到该索引为止出现过的上爬阶段数（至少第 1 轮）。 */
function countClimbsUpTo(plan: WorkoutPlan, index: number): number {
  const before = planPhaseKindsBefore(plan, index).filter((kind) => kind === 'climb').length
  const current = planPhaseAtIndex(plan, index)
  return before + (current && current.kind === 'climb' ? 1 : 0)
}

export function initialPlanProgress(plan: WorkoutPlan): PlanProgress {
  return planProgressAt(plan, 0)
}

/** 当前应执行的阶段；有限计划结束后返回 undefined。 */
export function nextPlanPhase(
  plan: WorkoutPlan,
  progress: PlanProgress,
): WorkoutPlanPhase | undefined {
  return planPhaseAtIndex(plan, progress.phaseIndex)
}

export type PlanPhaseOutcome = 'completed' | 'skipped'

/**
 * 推进一个阶段。
 * - outcome='skipped' 且该阶段不可跳过（上爬/返回，或计划里未配置该阶段）时返回原进度（拒绝跳过）；
 * - 计划已结束时返回原进度（幂等）。
 */
export function advancePlanProgress(
  plan: WorkoutPlan,
  progress: PlanProgress,
  outcome: PlanPhaseOutcome = 'completed',
): PlanProgress {
  const phase = planPhaseAtIndex(plan, progress.phaseIndex)
  if (!phase) return progress
  if (outcome === 'skipped' && !canSkipPhase(plan, phase)) return progress

  const completedPhases = [...progress.completedPhases]
  const skippedPhases = [...progress.skippedPhases]
  if (outcome === 'skipped') skippedPhases.push(phase.kind)
  else completedPhases.push(phase.kind)

  return planProgressAt(plan, progress.phaseIndex + 1, {
    completedPhases,
    skippedPhases,
  })
}

/**
 * 收尾（正常结束或中途中止）：保留已完成的阶段与轮次，剩余轮数置 0。
 * 中止时**不会**清空已完成轮。
 */
export function finishPlanProgress(
  plan: WorkoutPlan,
  progress: PlanProgress,
): PlanProgress {
  const totalPhases = planPhaseCount(plan)
  const next =
    totalPhases === 'unknown'
      ? { ...progress }
      : planProgressAt(plan, totalPhases, {
          completedPhases: progress.completedPhases,
          skippedPhases: progress.skippedPhases,
        })
  return { ...next, remainingRounds: 0 }
}

// === 目标达成与完成反馈 ===

export interface PlanFeedbackInput {
  /** 已完成的轮数（只有完成 climb 的轮计入）。 */
  completedRounds: number
  /** 净爬楼时长（毫秒）：只累计上爬阶段，不含返回/恢复/热身。 */
  activeDurationMs: number
  totalFloors: number
  /** ascent 目标需要；缺失按 0 处理（等同「尚未产生爬升」）。 */
  totalAscentM?: number
}

/** 与 workout-summary.checkGoalReached 的达成判定口径完全一致。 */
export function planGoalReached(
  goal: WorkoutGoal,
  input: PlanFeedbackInput,
): boolean {
  switch (goal.type) {
    case 'open':
      return false
    case 'rounds':
      return input.completedRounds >= goal.targetRounds
    case 'floors':
      return input.totalFloors >= goal.targetFloors
    case 'ascent':
      return (input.totalAscentM ?? 0) >= goal.targetAscentM
    case 'duration':
      return input.activeDurationMs >= goal.targetActiveDurationMs
  }
}

/** 目标达成文案；与 workout-summary.checkGoalReached 的 message 逐字一致。 */
export function planGoalMessage(
  goal: WorkoutGoal,
  input: PlanFeedbackInput,
): string {
  switch (goal.type) {
    case 'open':
      return ''
    case 'rounds':
      return planGoalReached(goal, input) ? `目标已完成：${goal.targetRounds} 轮` : ''
    case 'floors':
      return planGoalReached(goal, input) ? `目标已达到：${goal.targetFloors} 层` : ''
    case 'ascent':
      return planGoalReached(goal, input) ? `目标已达到：${goal.targetAscentM} 米` : ''
    case 'duration':
      return planGoalReached(goal, input) ? '净爬楼时间目标已达到' : ''
  }
}

export function describeGoalTarget(goal: WorkoutGoal): string {
  switch (goal.type) {
    case 'open':
      return '自由训练（不设数字目标）'
    case 'rounds':
      return `${goal.targetRounds} 轮`
    case 'floors':
      return `${goal.targetFloors} 层`
    case 'ascent':
      return `${goal.targetAscentM} 米`
    case 'duration':
      return `${formatPlanDuration(goal.targetActiveDurationMs)}净爬楼`
  }
}

export function formatPlanDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${seconds} 秒`
}

function describePhaseTarget(phase: WorkoutPlanPhase): string {
  const parts: string[] = []
  if (phase.targetDurationMs !== undefined) {
    parts.push(formatPlanDuration(phase.targetDurationMs))
  }
  if (phase.targetFloors !== undefined) parts.push(`${phase.targetFloors} 层`)
  if (parts.length === 0) parts.push('不限时')
  if (phase.skippable) parts.push('可跳过')
  return parts.join('／')
}

/** 结构描述：热身 → 每轮(上爬/返回/恢复) × 轮数。 */
export function describePlanStructure(plan: WorkoutPlan): string {
  const perRound = roundPhases(plan)
    .map((phase) => `${PHASE_LABELS[phase.kind]}（${describePhaseTarget(phase)}）`)
    .join(' → ')
  const rounds = plan.rounds === 'until_goal' ? '轮数由目标决定' : `${plan.rounds} 轮`
  const head = plan.warmup
    ? `热身（${describePhaseTarget(plan.warmup)}） → `
    : ''
  return `${head}每轮：${perRound} × ${rounds}`
}

const PHASE_LABELS: Record<PlanPhaseKind, string> = {
  warmup: '热身',
  climb: '上爬',
  return: '返回',
  recovery: '恢复',
}

export function planPhaseLabel(kind: PlanPhaseKind): string {
  return PHASE_LABELS[kind]
}

export interface PlanFeedback {
  lines: string[]
  achieved: boolean
}

/**
 * 完成反馈：阶段结构、目标、进度与净爬楼时长（口径说明）。
 * 跳过休息阶段只影响 return/recovery 时长，不会改变 achieved（休息不算上爬）。
 */
export function buildPlanFeedback(
  plan: WorkoutPlan,
  input: PlanFeedbackInput,
): PlanFeedback {
  const achieved = planGoalReached(plan.goal, input)
  const roundsLine =
    plan.rounds === 'until_goal'
      ? `已完成 ${input.completedRounds} 轮（轮数由目标决定）`
      : `已完成 ${input.completedRounds} / ${plan.rounds} 轮`
  const lines: string[] = [
    `计划：${plan.name}`,
    `结构：${describePlanStructure(plan)}`,
    `目标：${describeGoalTarget(plan.goal)}`,
    roundsLine,
    `净爬楼 ${formatPlanDuration(input.activeDurationMs)}（返回／恢复／热身不计入）`,
    `累计 ${input.totalFloors} 层`,
  ]
  const message = planGoalMessage(plan.goal, input)
  if (achieved && message) lines.push(message)
  return { lines, achieved }
}

// === 计划构建（旧目标兼容） ===

export interface BuildPlanOptions {
  /** 计划 id（显式传入，避免非确定性 id 生成）。 */
  id: string
  /** 构建时间（显式传入，避免 Date.now() 导致序列化不幂等）。 */
  now: number
  name?: string
  /** 单轮上爬目标楼层（路线层高）。 */
  climbTargetFloors?: number
  /** 单轮上爬目标时长。 */
  climbTargetDurationMs?: number
  includeWarmup?: boolean
  includeReturn?: boolean
  includeRecovery?: boolean
  warmupDurationMs?: number
  returnDurationMs?: number
  recoveryDurationMs?: number
}

/**
 * 由旧目标构建计划：
 * - rounds 目标 → 固定轮数（可判定结束，nextPlanPhase 会在末尾返回 undefined）；
 * - floors/ascent/duration/open → 'until_goal'（何时结束由目标达成判定）。
 * 五个旧目标全部可用，`plan.goal` 原样保留，达成判定与旧逻辑同口径。
 */
export function buildPlanFromGoal(
  goal: WorkoutGoal,
  options: BuildPlanOptions,
): WorkoutPlan {
  const rounds: number | 'until_goal' =
    goal.type === 'rounds' ? Math.max(1, Math.floor(goal.targetRounds)) : 'until_goal'

  const climbPerRound: WorkoutPlanPhase = {
    kind: 'climb',
    skippable: false,
  }
  if (isFiniteNumber(options.climbTargetFloors) && options.climbTargetFloors > 0) {
    climbPerRound.targetFloors = Math.floor(options.climbTargetFloors)
  }
  if (
    isFiniteNumber(options.climbTargetDurationMs) &&
    options.climbTargetDurationMs > 0
  ) {
    climbPerRound.targetDurationMs = options.climbTargetDurationMs
  }

  const warmup: WorkoutPlanPhase | undefined =
    options.includeWarmup === false
      ? undefined
      : {
          kind: 'warmup',
          targetDurationMs: options.warmupDurationMs ?? DEFAULT_WARMUP_MS,
          skippable: true,
        }
  const returnPerRound: WorkoutPlanPhase | undefined =
    options.includeReturn === false
      ? undefined
      : {
          kind: 'return',
          targetDurationMs: options.returnDurationMs ?? DEFAULT_RETURN_MS,
          skippable: false,
        }
  const recoveryPerRound: WorkoutPlanPhase | undefined =
    options.includeRecovery === false
      ? undefined
      : {
          kind: 'recovery',
          targetDurationMs: options.recoveryDurationMs ?? DEFAULT_RECOVERY_MS,
          skippable: true,
        }

  const plan: WorkoutPlan = {
    id: options.id,
    name: options.name ?? '训练计划',
    rounds,
    ...(warmup ? { warmup } : {}),
    climbPerRound,
    ...(returnPerRound ? { returnPerRound } : {}),
    ...(recoveryPerRound ? { recoveryPerRound } : {}),
    goal,
    createdAt: options.now,
    updatedAt: options.now,
    schemaVersion: PLAN_SCHEMA_VERSION,
  }

  return canonicalPlan(plan)
}

/** 判断某个目标能否给出固定轮数（用于 UI 展示「预计 N 轮」）。 */
export function planExpectedRounds(plan: WorkoutPlan): number | 'until_goal' {
  return planRoundCount(plan)
}

// === 序列化（确定性、幂等） ===

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPhaseKind(value: unknown): value is PlanPhaseKind {
  return (
    value === 'warmup' ||
    value === 'climb' ||
    value === 'return' ||
    value === 'recovery'
  )
}

function positiveNumber(value: unknown, label: string): number {
  if (!isFiniteNumber(value) || value <= 0) {
    throw new Error(`plan: ${label} 必须是正数`)
  }
  return value
}

function positiveInt(value: unknown, label: string): number {
  const parsed = positiveNumber(value, label)
  if (!Number.isInteger(parsed)) throw new Error(`plan: ${label} 必须是整数`)
  return parsed
}

/** 固定字段顺序（kind → targetDurationMs → targetFloors → skippable）并丢弃 undefined。 */
function canonicalPhase(phase: WorkoutPlanPhase): WorkoutPlanPhase {
  const canonical: WorkoutPlanPhase = {
    kind: phase.kind,
    ...(phase.targetDurationMs !== undefined
      ? { targetDurationMs: phase.targetDurationMs }
      : {}),
    ...(phase.targetFloors !== undefined ? { targetFloors: phase.targetFloors } : {}),
    // 上爬永远不可跳过：写出时也保持自洽。
    skippable: phase.kind === 'climb' ? false : phase.skippable === true,
  }
  return canonical
}

function canonicalGoal(goal: WorkoutGoal): WorkoutGoal {
  switch (goal.type) {
    case 'open':
      return { type: 'open' }
    case 'rounds':
      return { type: 'rounds', targetRounds: goal.targetRounds }
    case 'floors':
      return { type: 'floors', targetFloors: goal.targetFloors }
    case 'ascent':
      return { type: 'ascent', targetAscentM: goal.targetAscentM }
    case 'duration':
      return {
        type: 'duration',
        targetActiveDurationMs: goal.targetActiveDurationMs,
      }
  }
}

/** 固定字段顺序、丢弃 undefined，保证 json 稳定（幂等）。 */
export function canonicalPlan(plan: WorkoutPlan): WorkoutPlan {
  return {
    id: plan.id,
    name: plan.name,
    rounds:
      plan.rounds === 'until_goal'
        ? 'until_goal'
        : Math.max(0, Math.floor(plan.rounds)),
    ...(plan.warmup ? { warmup: canonicalPhase(plan.warmup) } : {}),
    climbPerRound: canonicalPhase(plan.climbPerRound),
    ...(plan.returnPerRound
      ? { returnPerRound: canonicalPhase(plan.returnPerRound) }
      : {}),
    ...(plan.recoveryPerRound
      ? { recoveryPerRound: canonicalPhase(plan.recoveryPerRound) }
      : {}),
    goal: canonicalGoal(plan.goal),
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    schemaVersion: PLAN_SCHEMA_VERSION,
  }
}

/** 确定性 JSON：不含 Date.now()/随机 id 等非确定性字段。 */
export function serializePlan(plan: WorkoutPlan): string {
  return JSON.stringify(canonicalPlan(plan))
}

/**
 * 宽松读入 + 规范写出：容忍缺省的 skippable/target*，但拒绝未知 schemaVersion、
 * 未知阶段/目标类型与非正数目标。
 */
export function normalizePlan(value: unknown): WorkoutPlan {
  if (typeof value !== 'object' || value === null) {
    throw new Error('plan: 计划必须是对象')
  }
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== PLAN_SCHEMA_VERSION) {
    throw new Error(`plan: 不支持的 schemaVersion：${String(raw.schemaVersion)}`)
  }
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new Error('plan: 缺少 id')
  }
  if (typeof raw.name !== 'string') throw new Error('plan: name 必须是字符串')
  if (!isFiniteNumber(raw.createdAt)) throw new Error('plan: createdAt 必须是数字')
  if (!isFiniteNumber(raw.updatedAt)) throw new Error('plan: updatedAt 必须是数字')

  let rounds: number | 'until_goal'
  if (raw.rounds === 'until_goal') {
    rounds = 'until_goal'
  } else if (isFiniteNumber(raw.rounds) && raw.rounds >= 0) {
    rounds = Math.floor(raw.rounds)
  } else {
    throw new Error(`plan: rounds 非法：${String(raw.rounds)}`)
  }

  const plan: WorkoutPlan = {
    id: raw.id,
    name: raw.name,
    rounds,
    climbPerRound: normalizePhase(raw.climbPerRound, 'climb'),
    goal: normalizeGoal(raw.goal),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    schemaVersion: PLAN_SCHEMA_VERSION,
  }
  if (raw.warmup !== undefined) plan.warmup = normalizePhase(raw.warmup, 'warmup')
  if (raw.returnPerRound !== undefined) {
    plan.returnPerRound = normalizePhase(raw.returnPerRound, 'return')
  }
  if (raw.recoveryPerRound !== undefined) {
    plan.recoveryPerRound = normalizePhase(raw.recoveryPerRound, 'recovery')
  }
  return canonicalPlan(plan)
}

function normalizePhase(value: unknown, expectedKind: PlanPhaseKind): WorkoutPlanPhase {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`plan: ${expectedKind} 阶段必须是对象`)
  }
  const raw = value as Record<string, unknown>
  if (!isPhaseKind(raw.kind)) {
    throw new Error(`plan: 未知阶段类型：${String(raw.kind)}`)
  }
  if (raw.kind !== expectedKind) {
    throw new Error(`plan: 阶段类型应为 ${expectedKind}，实际 ${raw.kind}`)
  }
  const skippable =
    raw.skippable === undefined
      ? raw.kind === 'warmup' || raw.kind === 'recovery'
      : raw.skippable === true
  const phase: WorkoutPlanPhase = {
    kind: raw.kind,
    // 上爬永远不可跳过：数据里写了 true 也会被夹回 false。
    skippable: raw.kind === 'climb' ? false : skippable,
  }
  if (raw.targetDurationMs !== undefined) {
    phase.targetDurationMs = positiveNumber(
      raw.targetDurationMs,
      `${expectedKind}.targetDurationMs`,
    )
  }
  if (raw.targetFloors !== undefined) {
    phase.targetFloors = positiveInt(raw.targetFloors, `${expectedKind}.targetFloors`)
  }
  return phase
}

function normalizeGoal(value: unknown): WorkoutGoal {
  if (typeof value !== 'object' || value === null) {
    throw new Error('plan: goal 必须是对象')
  }
  const raw = value as Record<string, unknown>
  switch (raw.type) {
    case 'open':
      return { type: 'open' }
    case 'rounds':
      return {
        type: 'rounds',
        targetRounds: positiveInt(raw.targetRounds, 'goal.targetRounds'),
      }
    case 'floors':
      return {
        type: 'floors',
        targetFloors: positiveInt(raw.targetFloors, 'goal.targetFloors'),
      }
    case 'ascent':
      return {
        type: 'ascent',
        targetAscentM: positiveNumber(raw.targetAscentM, 'goal.targetAscentM'),
      }
    case 'duration':
      return {
        type: 'duration',
        targetActiveDurationMs: positiveNumber(
          raw.targetActiveDurationMs,
          'goal.targetActiveDurationMs',
        ),
      }
    default:
      throw new Error(`plan: 未知目标类型：${String(raw.type)}`)
  }
}

/** JSON → 计划；任何结构问题都抛错（不静默降级）。 */
export function parsePlan(json: string): WorkoutPlan {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('plan: JSON 解析失败')
  }
  return normalizePlan(parsed)
}

export function isWorkoutPlan(value: unknown): value is WorkoutPlan {
  try {
    normalizePlan(value)
    return true
  } catch {
    return false
  }
}
