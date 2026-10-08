// 人工修正链（D06）：原值保留、追加记录、幂等、不得提高算法置信度。
//
// 单一事实来源：学习资格（isRoundLearnable）与修正链摘要（summarizeCorrectionChain）
// 都只在这里实现，route-model / route-learning / training-progress / export-csv /
// 结果页统一调用，避免各处重复的 `userCorrectionCount === 0` 判断产生口径漂移。

import { getFloorAchievementCount, getFloorTransitionCount } from './floors'
import { uid } from './math'
import { RoundCorrection, RoundCorrectionSnapshot, WorkoutRound } from './types'

export interface ApplyRoundCorrectionOptions {
  /** 修正时间（默认 Date.now()）。 */
  at?: number
  /** 修正原因（可选，用于结果页说明）。 */
  reason?: string
  /** 该轮是否因这次修正退出学习，默认 true。 */
  excludeFromLearning?: boolean
  /** 修正记录 id（默认生成）。 */
  id?: string
}

/** 修正链摘要，供结果页与汇总展示。 */
export interface CorrectionChainSummary {
  count: number
  corrected: boolean
  /** 第一次修正前的原始最终楼层；无修正时为 undefined。 */
  originalFinalFloor?: number
  /** 当前生效的最终楼层。 */
  latestFinalFloor: number
  /** 链中是否存在试图抬高置信度的记录（正常应为 false）。 */
  raisedConfidence: boolean
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 轮次当前值的快照。 */
function snapshotOf(round: WorkoutRound): RoundCorrectionSnapshot {
  return {
    finalFloor: round.finalFloor,
    floorsCompleted: round.floorsCompleted,
    ascentM: round.ascentM,
    complete: round.complete,
    confidence: round.confidence,
  }
}

/**
 * 由当前轮次 + patch 解析出「修正后」的快照。
 * - finalFloor 变化时按 `getFloorAchievementCount` 同一口径同步 floorsCompleted，
 *   并按原有「每层爬升」等比缩放 ascentM，避免成绩自相矛盾。
 * - confidence 只降不升：高于原值时夹到原值。
 */
function resolveAfter(
  round: WorkoutRound,
  patch: Partial<RoundCorrectionSnapshot>,
): RoundCorrectionSnapshot {
  const before = snapshotOf(round)
  const patchedFinalFloor = isFiniteNumber(patch.finalFloor)
    ? Math.round(patch.finalFloor)
    : undefined
  const finalFloor = patchedFinalFloor ?? before.finalFloor
  const finalChanged = patchedFinalFloor !== undefined && patchedFinalFloor !== before.finalFloor

  const floorsCompleted = isFiniteNumber(patch.floorsCompleted)
    ? Math.max(0, Math.round(patch.floorsCompleted))
    : finalChanged
      ? (round.floorCounting === 'transitions' ? getFloorTransitionCount : getFloorAchievementCount)(round.startFloor, finalFloor)
      : before.floorsCompleted
  const floorsChanged = floorsCompleted !== before.floorsCompleted

  const perFloorAscent =
    before.floorsCompleted > 0 && before.ascentM > 0
      ? before.ascentM / before.floorsCompleted
      : 0
  const ascentM = isFiniteNumber(patch.ascentM)
    ? Math.max(0, patch.ascentM)
    : floorsChanged && perFloorAscent > 0
      ? Math.round(perFloorAscent * floorsCompleted * 10) / 10
      : before.ascentM

  const confidence = isFiniteNumber(patch.confidence)
    ? Math.min(before.confidence, Math.max(0, patch.confidence))
    : before.confidence

  return {
    finalFloor,
    floorsCompleted,
    ascentM,
    complete: typeof patch.complete === 'boolean' ? patch.complete : before.complete,
    confidence,
  }
}

function sameSnapshot(a: RoundCorrectionSnapshot, b: RoundCorrectionSnapshot): boolean {
  return (
    a.finalFloor === b.finalFloor &&
    a.floorsCompleted === b.floorsCompleted &&
    a.ascentM === b.ascentM &&
    a.complete === b.complete &&
    a.confidence === b.confidence
  )
}

/**
 * 应用一次人工修正。
 * 契约：纯函数、幂等（同值不追加、返回原对象）、原值进 before、trustworthy=false、
 * completionSource='manual'、userCorrectionCount=链长、confidence 不得被抬高。
 */
export function applyRoundCorrection(
  round: WorkoutRound,
  patch: Partial<RoundCorrectionSnapshot>,
  options: ApplyRoundCorrectionOptions = {},
): WorkoutRound {
  const before = snapshotOf(round)
  const after = resolveAfter(round, patch)

  // 幂等：patch 没有改变任何字段时，不追加记录、不改写可信状态，直接返回原对象。
  if (sameSnapshot(before, after)) return round

  const chain = round.corrections ?? []
  const correction: RoundCorrection = {
    id: options.id ?? uid('corr'),
    at: isFiniteNumber(options.at) ? options.at : Date.now(),
    before,
    after,
    reason: options.reason,
    excludeFromLearning: options.excludeFromLearning ?? true,
  }
  const corrections = [...chain, correction]

  return {
    ...round,
    ...after,
    corrections,
    // 链长即修正次数：与 roundFromSession 既有「confirmedEndFloor ⇒ 1」行为一致，不重复计数。
    userCorrectionCount: corrections.length,
    completionSource: 'manual',
    trustworthy: false,
  }
}

/**
 * 该轮是否可以进入算法学习。
 * 只有无修正链、userCorrectionCount 为 0/undefined、trustworthy 不为 false、
 * completionSource 不是 manual/recovered、complete===true 时才为 true。
 */
export function isRoundLearnable(round: WorkoutRound): boolean {
  return (
    round.complete === true &&
    round.floorConfirmation !== 'pending' &&
    (round.corrections?.length ?? 0) === 0 &&
    (round.userCorrectionCount ?? 0) === 0 &&
    round.trustworthy !== false &&
    round.completionSource !== 'manual' &&
    round.completionSource !== 'recovered'
  )
}

/** 修正链摘要。 */
export function summarizeCorrectionChain(round: WorkoutRound): CorrectionChainSummary {
  const chain = round.corrections ?? []
  const first = chain[0]
  const latest = chain[chain.length - 1]
  return {
    count: chain.length,
    corrected: chain.length > 0,
    originalFinalFloor: first?.before.finalFloor,
    latestFinalFloor: latest ? latest.after.finalFloor : round.finalFloor,
    raisedConfidence: chain.some(
      (correction) => correction.after.confidence > correction.before.confidence,
    ),
  }
}
