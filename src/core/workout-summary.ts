import { uid } from './math'
import {
  ClimbSession,
  ClimbWorkout,
  WorkoutGoal,
  WorkoutRound,
  WorkoutSummary,
} from './types'
import {
  getFloorAchievementCount,
  getRoundAchievementCount,
} from './floors'

/**
 * 计算训练汇总。纯函数，所有总数据从轮次数据派生。
 *
 * 关键派生规则：
 * - activeDurationMs = Σ round.durationMs（净爬楼时间，不含返回/恢复）
 * - totalElapsedMs = (endedAt ?? now) - startedAt（训练总历时）
 * - returnDurationMs / recoveryDurationMs 由各轮累计
 * - 最快/最慢/平均仅统计 complete 轮次
 * - 前后半程按完成轮次中点切分
 * - 变异系数 = 标准差 / 平均值
 */
export function calculateWorkoutSummary(
  rounds: WorkoutRound[],
  startedAt: number,
  endedAt?: number,
): WorkoutSummary {
  const completeRounds = rounds.filter((r) => r.complete)
  const totalRounds = rounds.length
  const totalFloors = rounds.reduce(
    (sum, round) => sum + getRoundAchievementCount(round),
    0,
  )
  const totalAscentM = rounds.reduce((sum, r) => sum + r.ascentM, 0)
  const totalSteps = rounds.reduce((sum, r) => sum + r.steps, 0)
  const activeDurationMs = rounds.reduce((sum, r) => sum + r.durationMs, 0)
  const returnDurationMs = rounds.reduce(
    (sum, r) => sum + (r.returnDurationMs ?? 0),
    0,
  )
  const recoveryDurationMs = rounds.reduce(
    (sum, r) => sum + (r.recoveryDurationMs ?? 0),
    0,
  )
  const totalElapsedMs = Math.max(0, (endedAt ?? Date.now()) - startedAt)

  // 仅完整轮参与最快/最慢/平均统计
  const completeDurations = completeRounds
    .map((r) => r.durationMs)
    .sort((a, b) => a - b)
  const bestRoundMs = completeDurations[0]
  const worstRoundMs = completeDurations.at(-1)
  const averageRoundMs = completeDurations.length
    ? Math.round(
        completeDurations.reduce((s, d) => s + d, 0) / completeDurations.length,
      )
    : undefined
  const latestRoundMs = rounds.at(-1)?.durationMs

  // 前后半程：按完成轮次中点切分
  let firstHalfAvgMs: number | undefined
  let secondHalfAvgMs: number | undefined
  let secondHalfDeclinePct: number | undefined
  if (completeRounds.length >= 2) {
    const half = Math.floor(completeRounds.length / 2)
    const firstHalf = completeRounds.slice(0, half)
    const secondHalf = completeRounds.slice(half)
    const firstSum = firstHalf.reduce((s, r) => s + r.durationMs, 0)
    const secondSum = secondHalf.reduce((s, r) => s + r.durationMs, 0)
    firstHalfAvgMs = Math.round(firstSum / firstHalf.length)
    secondHalfAvgMs = Math.round(secondSum / secondHalf.length)
    if (firstHalfAvgMs > 0) {
      secondHalfDeclinePct = Math.round(
        ((secondHalfAvgMs - firstHalfAvgMs) / firstHalfAvgMs) * 100,
      )
    }
  }

  // 变异系数 = 标准差 / 平均值
  let coefficientOfVariation: number | undefined
  if (completeDurations.length >= 2) {
    const mean =
      completeDurations.reduce((s, d) => s + d, 0) / completeDurations.length
    const variance =
      completeDurations.reduce((s, d) => s + (d - mean) ** 2, 0) /
      completeDurations.length
    coefficientOfVariation = mean > 0 ? Math.sqrt(variance) / mean : 0
  }

  return {
    totalRounds,
    completeRounds: completeRounds.length,
    totalFloors,
    totalAscentM,
    totalSteps,
    activeDurationMs,
    returnDurationMs,
    recoveryDurationMs,
    totalElapsedMs,
    bestRoundMs,
    worstRoundMs,
    averageRoundMs,
    latestRoundMs,
    firstHalfAvgMs,
    secondHalfAvgMs,
    secondHalfDeclinePct,
    coefficientOfVariation,
  }
}

/**
 * 展示层映射：旧单轮 ClimbSession → 单轮 ClimbWorkout。
 * 不写回存储，仅用于历史页/结果页统一渲染。
 */
export function buildWorkoutFromSession(session: ClimbSession): ClimbWorkout {
  const startFloor = session.startFloor
  const endFloor = session.routeSnapshot?.endFloor ?? session.finalFloor
  const floorsPerRound = getFloorAchievementCount(startFloor, endFloor)
  const ascentPerRoundM = session.routeSnapshot?.totalAscentM ?? session.ascentM
  const durationMs =
    session.durationMs ?? Math.max(0, session.endedAt - session.startedAt)

  const round: WorkoutRound = {
    id: session.id,
    roundNumber: 1,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationMs,
    startFloor,
    targetFloor: endFloor,
    finalFloor: session.finalFloor,
    floorsCompleted:
      getFloorAchievementCount(startFloor, session.finalFloor) ||
      session.floorsCompleted,
    ascentM: session.ascentM,
    steps: session.steps,
    confidence: session.confidence,
    complete: session.complete,
    completionReason: session.complete ? 'route_complete' : 'manual_finish',
    floorSplits: session.floorSplits.map((split, index, arr) => ({
      floorFrom: index === 0 ? startFloor : arr[index - 1].floor,
      floorTo: split.floor,
      reachedAtMs: split.atMs,
      splitDurationMs: split.elapsedMs,
    })),
    events: session.events,
    interruptions: session.interruptions,
    averageFloorMs: session.averageFloorMs,
    bestFloorSplitMs: session.bestFloorSplitMs,
  }

  return {
    id: session.id,
    templateId: session.templateId,
    templateVersion: session.templateVersion,
    routeSnapshot: {
      name: session.routeSnapshot?.name ?? '已删除的路线',
      locationName: session.routeSnapshot?.locationName ?? '已删除的路线',
      startFloor,
      endFloor,
      floorsPerRound,
      ascentPerRoundM,
    },
    goal: { type: 'open' },
    returnConfirmationMode: 'manual',
    status: 'completed',
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    rounds: [round],
    currentRoundNumber: 1,
    totalRoundsCompleted: session.complete ? 1 : 0,
    totalFloorsCompleted:
      getFloorAchievementCount(startFloor, session.finalFloor) ||
      session.floorsCompleted,
    totalAscentM: session.ascentM,
    totalSteps: session.steps,
    activeDurationMs: durationMs,
    returnDurationMs: 0,
    recoveryDurationMs: 0,
    totalElapsedMs: durationMs,
    bestRoundMs: session.complete ? durationMs : undefined,
    averageRoundMs: session.complete ? durationMs : undefined,
    latestRoundMs: durationMs,
    sharePosterCreatedAt: session.sharePosterCreatedAt,
    createdAt: session.startedAt,
    updatedAt: session.endedAt,
  }
}

/**
 * 检查训练目标是否达成。
 * floors/ascent/duration 达标仅提示，不在楼梯中途自动停止。
 */
export function checkGoalReached(
  summary: WorkoutSummary,
  goal: WorkoutGoal,
): { reached: boolean; message: string } {
  switch (goal.type) {
    case 'open':
      return { reached: false, message: '' }
    case 'rounds':
      if (summary.completeRounds >= goal.targetRounds) {
        return {
          reached: true,
          message: `目标已完成：${goal.targetRounds} 轮`,
        }
      }
      return { reached: false, message: '' }
    case 'floors':
      if (summary.totalFloors >= goal.targetFloors) {
        return {
          reached: true,
          message: `目标已达到：${goal.targetFloors} 层`,
        }
      }
      return { reached: false, message: '' }
    case 'ascent':
      if (summary.totalAscentM >= goal.targetAscentM) {
        return {
          reached: true,
          message: `目标已达到：${goal.targetAscentM} 米`,
        }
      }
      return { reached: false, message: '' }
    case 'duration':
      if (summary.activeDurationMs >= goal.targetActiveDurationMs) {
        return {
          reached: true,
          message: '净爬楼时间目标已达到',
        }
      }
      return { reached: false, message: '' }
  }
}

/**
 * 由 ClimbSession 构造 WorkoutRound（供 useClimbWorkout 在 ascending 完成时调用）。
 */
export function roundFromSession(
  session: ClimbSession,
  roundNumber: number,
  completionReason: WorkoutRound['completionReason'],
): WorkoutRound {
  const startFloor = session.startFloor
  const achievementFloors =
    getFloorAchievementCount(startFloor, session.finalFloor) ||
    session.floorsCompleted
  return {
    id: uid('round'),
    roundNumber,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationMs:
      session.durationMs ?? Math.max(0, session.endedAt - session.startedAt),
    startFloor,
    targetFloor: session.routeSnapshot?.endFloor ?? session.finalFloor,
    finalFloor: session.finalFloor,
    floorsCompleted: achievementFloors,
    ascentM: session.ascentM,
    steps: session.steps,
    confidence: session.confidence,
    complete: session.complete,
    completionReason,
    floorSplits: session.floorSplits.map((split, index, arr) => ({
      floorFrom: index === 0 ? startFloor : arr[index - 1].floor,
      floorTo: split.floor,
      reachedAtMs: split.atMs,
      splitDurationMs: split.elapsedMs,
    })),
    events: session.events,
    interruptions: session.interruptions,
    averageFloorMs: session.averageFloorMs,
    bestFloorSplitMs: session.bestFloorSplitMs,
  }
}
