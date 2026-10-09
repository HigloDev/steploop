import { getFloorTransitionCount, getRoundAchievementCount } from './floors'
import { calculateStairCalories } from './calories'
import { RecognitionSnapshot, WorkoutPhase, WorkoutRound } from './types'

/** 展示与播报共用实时统计；当前轮仅在上爬阶段计入，结算后不能重复相加。 */
export function deriveLiveWorkoutMetrics(input: {
  rounds: WorkoutRound[]; phase: WorkoutPhase; snapshot: RecognitionSnapshot;
  startFloor: number; totalElapsedMs: number; bodyWeightKg: number;
}) {
  const climbing = input.phase === 'ascending'
  const activeMs = input.rounds.reduce((sum, round) => sum + Math.max(0, round.durationMs), 0)
    + (climbing ? Math.max(0, input.snapshot.activeMs) : 0)
  const steps = input.rounds.reduce((sum, round) => sum + Math.max(0, round.steps), 0)
    + (climbing ? Math.max(0, input.snapshot.steps) : 0)
  const floors = input.rounds.reduce((sum, round) => sum + getRoundAchievementCount(round), 0)
    + (climbing ? getFloorTransitionCount(input.startFloor, input.snapshot.currentFloor) : 0)
  const totalMs = Math.max(0, input.totalElapsedMs)
  return {
    activeMs, steps, floors, totalMs,
    currentRoundActiveMs: climbing ? Math.max(0, input.snapshot.activeMs)
      : input.phase === 'round_ready' || input.phase === 'setup' ? 0 : (input.rounds.at(-1)?.durationMs ?? 0),
    nonClimbingMs: Math.max(0, totalMs - activeMs),
    calories: calculateStairCalories(activeMs, input.bodyWeightKg),
    floorsPerMinute: activeMs > 0 ? floors / (activeMs / 60000) : 0,
  }
}
