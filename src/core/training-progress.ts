import {
  ClimbWorkout,
  TrainingPersonalBest,
  TrainingProgress,
} from './types'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function startOfLocalWeek(atMs: number): number {
  const date = new Date(atMs)
  const day = (date.getDay() + 6) % 7
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - day)
  return date.getTime()
}

export function isPersonalBestEligible(workout: ClimbWorkout): boolean {
  const completedRounds = workout.rounds.filter((round) => round.complete)
  return (
    workout.status === 'completed' &&
    completedRounds.length > 0 &&
    workout.rounds.every(
      (round) =>
        round.complete &&
        round.interruptions.length === 0 &&
        (round.userCorrectionCount ?? 0) === 0 &&
        round.confidence >= 0.8,
    )
  )
}

export function deriveTrainingProgress(
  workouts: ClimbWorkout[],
  now = Date.now(),
): TrainingProgress {
  const weekStart = startOfLocalWeek(now)
  const weekEnd = weekStart + WEEK_MS - 1
  const eligible = workouts.filter(isPersonalBestEligible)
  const current = eligible.filter(
    (workout) => workout.startedAt >= weekStart && workout.startedAt <= weekEnd,
  )
  const activeWeeks = new Set(
    eligible.map((workout) => startOfLocalWeek(workout.startedAt)),
  )
  let consecutiveWeeks = 0
  for (let cursor = weekStart; activeWeeks.has(cursor); cursor -= WEEK_MS) {
    consecutiveWeeks += 1
  }
  const personalBests: Record<string, TrainingPersonalBest> = {}
  eligible.forEach((workout) => {
    const previous = personalBests[workout.templateId]
    if (previous && previous.durationMs <= workout.activeDurationMs) return
    personalBests[workout.templateId] = {
      routeId: workout.templateId,
      workoutId: workout.id,
      durationMs: workout.activeDurationMs,
      floors: workout.totalFloorsCompleted,
      ascentM: workout.totalAscentM,
      achievedAt: workout.endedAt ?? workout.updatedAt,
    }
  })
  return {
    weekStart,
    weekEnd,
    validWorkouts: current.length,
    floors: current.reduce(
      (sum, workout) => sum + workout.totalFloorsCompleted,
      0,
    ),
    ascentM: current.reduce((sum, workout) => sum + workout.totalAscentM, 0),
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
