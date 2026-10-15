import { getFloorTransitionCount, getRoundAchievementCount } from './floors'
import { isEligiblePersonalBestWorkout, isEligibleTrendWorkout, startOfLocalWeek } from './progress-trends'
import {
  ClimbWorkout,
  TrainingPersonalBest,
  TrainingProgress,
  WorkoutRound,
} from './types'

// 周起点与普通训练累计判定由 progress-trends 提供（D09 + PRD 新口径），
// 保证历史页「本周向上」卡片与周/月/季趋势口径一致；
// 这里转出 `startOfLocalWeek`，既有调用方与导出签名保持不变。
export { startOfLocalWeek }

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 单轮楼层口径：优先使用轮次自身记录值（训练保存时的口径），
 * 缺失或为 0 时回落到起止楼层派生，保证旧记录（无 corrections 字段）同样可读。
 */
/** 周累计与记录/结算页同一楼层口径（爬升段数），不再优先信任旧记录里缓存的 floorsCompleted。 */
function roundFloors(round: WorkoutRound): number {
  return getRoundAchievementCount(round)
}

/**
 * 由轮次派生训练口径的总量。周累计不再直接信任 workout 上缓存的旧值：
 * 人工修正只改轮次，缓存值会过期，导致周累计与详情（calculateWorkoutSummary）不一致。
 */
function workoutTotals(workout: ClimbWorkout): {
  floors: number
  ascentM: number
  activeDurationMs: number
} {
  return workout.rounds.reduce(
    (totals, round) => ({
      floors: totals.floors + (round.floorConfirmation === 'pending' ? 0 : workout.floorCounting === 'transitions'
        ? getFloorTransitionCount(round.startFloor, round.finalFloor) : roundFloors(round)),
      ascentM: totals.ascentM + (round.floorConfirmation === 'pending' ? 0 : workout.floorCounting === 'transitions'
        ? Number.isFinite(round.ascentM) ? Math.max(0, round.ascentM) : 0 : round.ascentM),
      activeDurationMs: totals.activeDurationMs + (workout.floorCounting === 'transitions'
        ? Number.isFinite(round.durationMs) ? Math.max(0, round.durationMs) : 0 : round.durationMs),
    }),
    { floors: 0, ascentM: 0, activeDurationMs: 0 },
  )
}

/** Personal best remains strict; ordinary cumulative progress has a separate eligibility rule. */
export function isPersonalBestEligible(workout: ClimbWorkout): boolean {
  return isEligiblePersonalBestWorkout(workout)
}

export function deriveTrainingProgress(
  workouts: ClimbWorkout[],
  now = Date.now(),
): TrainingProgress {
  const weekStart = startOfLocalWeek(now)
  const weekEnd = weekStart + WEEK_MS - 1
  const ordinary = workouts.filter(isEligibleTrendWorkout)
  const eligible = workouts.filter(isPersonalBestEligible)
  const current = ordinary.filter(
    (workout) => workout.startedAt >= weekStart && workout.startedAt <= weekEnd,
  )
  const activeWeeks = new Set(
    ordinary.map((workout) => startOfLocalWeek(workout.startedAt)),
  )
  let consecutiveWeeks = 0
  for (let cursor = weekStart; activeWeeks.has(cursor); cursor -= WEEK_MS) {
    consecutiveWeeks += 1
  }
  const personalBests: Record<string, TrainingPersonalBest> = {}
  eligible.forEach((workout) => {
    const previous = personalBests[workout.templateId]
    const totals = workoutTotals(workout)
    if (previous && previous.durationMs <= totals.activeDurationMs) return
    personalBests[workout.templateId] = {
      routeId: workout.templateId,
      workoutId: workout.id,
      durationMs: totals.activeDurationMs,
      floors: totals.floors,
      ascentM: totals.ascentM,
      achievedAt: workout.endedAt ?? workout.updatedAt,
    }
  })
  return {
    weekStart,
    weekEnd,
    validWorkouts: current.length,
    floors: current.reduce((sum, workout) => sum + workoutTotals(workout).floors, 0),
    ascentM: current.reduce(
      (sum, workout) => sum + workoutTotals(workout).ascentM,
      0,
    ),
    consecutiveWeeks,
    personalBests,
  }
}

export function trainingSuggestion(
  workout: ClimbWorkout,
  progress: TrainingProgress,
): string {
  if (!isPersonalBestEligible(workout)) {
    return '本次存在中断或人工修正，建议下次保持手机位置固定后再比较成绩。'
  }
  const best = progress.personalBests[workout.templateId]
  if (best?.workoutId === workout.id) {
    return '这是这条路线的新个人最佳；下次优先保持同样节奏，而不是盲目加速。'
  }
  const completeRounds = workout.rounds.filter((round) => round.complete)
  if (completeRounds.length >= 3) {
    const first = completeRounds[0].durationMs
    const last = completeRounds[completeRounds.length - 1].durationMs
    if (last > first * 1.08) {
      return '后程速度有所下降，下次尝试把前两轮节奏放稳。'
    }
  }
  return '本次节奏稳定；下次可以保持路线不变，尝试小幅提升总楼层。'
}
