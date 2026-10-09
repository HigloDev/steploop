import { ClimbWorkout, WorkoutRound } from './types'
import { calculateWorkoutSummary } from './workout-summary'
import { getFloorTransitionCount } from './floors'

export function aggregateBaroWorkout(workout: ClimbWorkout, rounds: WorkoutRound[], at: number, finished = false): ClimbWorkout {
  const summary = calculateWorkoutSummary(rounds, workout.startedAt, at)
  const endFloor = Math.max(workout.routeSnapshot.endFloor, ...rounds.map(r => r.finalFloor))
  return { ...workout, recognitionVersion: 'baro-v1', floorCounting: 'transitions', rounds: [...rounds],
    routeSnapshot: { ...workout.routeSnapshot, endFloor,
      floorsPerRound: getFloorTransitionCount(workout.routeSnapshot.startFloor, endFloor),
      ascentPerRoundM: Math.max(workout.routeSnapshot.ascentPerRoundM, ...rounds.map(r => r.ascentM)) },
    status: finished ? 'completed' : 'active', endedAt: finished ? at : undefined,
    currentRoundNumber: rounds.length, totalRoundsCompleted: summary.completeRounds,
    totalFloorsCompleted: summary.totalFloors, totalAscentM: summary.totalAscentM, totalSteps: summary.totalSteps,
    activeDurationMs: summary.activeDurationMs, totalElapsedMs: summary.totalElapsedMs,
    returnDurationMs: summary.returnDurationMs, recoveryDurationMs: summary.recoveryDurationMs,
    bestRoundMs: summary.bestRoundMs, averageRoundMs: summary.averageRoundMs, latestRoundMs: summary.latestRoundMs,
    personalBestEligible: rounds.length > 0 && rounds.every(r => r.trustworthy),
    trustQuality: rounds.every(r => r.trustworthy) ? 'stable' : 'degraded',
    userCorrectionCount: rounds.reduce((s, r) => s + (r.userCorrectionCount ?? 0), 0),
    weeklyContribution: { workouts: rounds.some(r => r.floorsCompleted > 0) ? 1 : 0, floors: summary.totalFloors, ascentM: summary.totalAscentM }, updatedAt: at }
}
