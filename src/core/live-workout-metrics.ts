import { calculateStairCalories, estimateClimbCalories } from './calories'
import { getFloorTransitionCount, getRoundAchievementCount } from './floors'
import type { RecognitionSnapshot, WorkoutPhase, WorkoutRound } from './types'
import type { FusionRoundResult, FusionSnapshot } from './fusion-engine'
import { DEFAULT_FLOOR_HEIGHT_M } from './sensor-params'

/** 旧版记录与工具的统计接口继续保留。 */
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
  const confirmedFloors = input.rounds.reduce((sum, round) => sum + getRoundAchievementCount(round), 0)
  return {
    activeMs, steps, floors, confirmedFloors, totalMs,
    currentRoundActiveMs: climbing ? Math.max(0, input.snapshot.activeMs)
      : input.phase === 'round_ready' || input.phase === 'setup' ? 0 : (input.rounds.at(-1)?.durationMs ?? 0),
    nonClimbingMs: Math.max(0, totalMs - activeMs),
    calories: calculateStairCalories(activeMs, input.bodyWeightKg),
    floorsPerMinute: activeMs > 0 ? floors / (activeMs / 60000) : 0,
  }
}

export function liveWorkoutMetrics(snapshot: FusionSnapshot, rounds: FusionRoundResult[], bodyWeightKg?: number) {
  const climbing = snapshot.phase === 'climbing' || snapshot.phase === 'calibrating'
  const ascentM = Math.max(0, snapshot.ascentM ?? (rounds.reduce((sum, round) => sum + round.ascentM, 0) +
    (climbing ? snapshot.roundFloors * DEFAULT_FLOOR_HEIGHT_M : 0)))
  const ascentMs = Math.max(0, snapshot.ascentMs ?? snapshot.activeMs)
  return {
    steps: Math.max(0, Math.round(snapshot.steps)),
    ascentM,
    floorsPerMinute: ascentMs >= 1000 ? snapshot.totalFloors * 60000 / ascentMs : 0,
    calories: estimateClimbCalories({ ascentM, activeMs: snapshot.activeMs, bodyWeightKg }),
  }
}
