import {
  ClimbWorkout,
  DistributionSummary,
  RouteLearningModel,
  RouteTemplate,
  WorkoutRound,
} from './types'

export const ROUTE_MODEL_VERSION = 3 as const
export const ROUTE_ALGORITHM_VERSION = 'trusted-v2.0.0'

function distribution(values: number[]): DistributionSummary {
  const safe = values.filter((value) => Number.isFinite(value) && value >= 0)
  if (!safe.length) {
    return { count: 0, mean: 0, standardDeviation: 0, minimum: 0, maximum: 0 }
  }
  const mean = safe.reduce((sum, value) => sum + value, 0) / safe.length
  const variance =
    safe.reduce((sum, value) => sum + (value - mean) ** 2, 0) / safe.length
  return {
    count: safe.length,
    mean,
    standardDeviation: Math.sqrt(variance),
    minimum: Math.min(...safe),
    maximum: Math.max(...safe),
  }
}

function bounded(value: number, baseline: number, ratio = 0.2): number {
  if (!Number.isFinite(baseline) || baseline <= 0) return value
  return Math.min(baseline * (1 + ratio), Math.max(baseline * (1 - ratio), value))
}

export function isLearningEligibleRound(round: WorkoutRound): boolean {
  return (
    round.complete &&
    round.completionReason === 'route_complete' &&
    round.interruptions.length === 0 &&
    (round.userCorrectionCount ?? 0) === 0 &&
    round.confidence >= 0.8 &&
    round.durationMs >= 10_000 &&
    round.floorsCompleted > 0
  )
}

export function migrateRouteToV3(route: RouteTemplate): RouteTemplate {
  if (route.modelVersion === ROUTE_MODEL_VERSION && route.learning) return route
  const floors = Math.max(1, route.segments.length)
  const heights = route.segments.map((segment) => segment.ascentM)
  const steps = route.segments.map((segment) => segment.stepCount)
  const durations = route.segments.map((segment) => segment.endMs - segment.startMs)
  const turns = route.segments.map((segment) =>
    route.markers.filter(
      (marker) =>
        (marker.type === 'turn' || marker.type === 'manual_turn') &&
        marker.atMs >= segment.startMs &&
        marker.atMs <= segment.endMs,
    ).length,
  )
  const legacySample = route.segments.length ? 1 : 0
  return {
    ...route,
    modelVersion: ROUTE_MODEL_VERSION,
    algorithmVersion: route.algorithmVersion ?? 'legacy-migrated',
    deviceCapabilities: route.deviceCapabilities ?? {
      barometerAvailable: 'unknown',
      effectiveSamplingHz: null,
    },
    learning: {
      sampleCount: legacySample,
      stability: legacySample ? 0.55 : 0,
      lastLearnedAt: legacySample ? route.verifiedAt ?? route.updatedAt : undefined,
      state: route.status === 'verified' ? 'learning' : 'unlearned',
      reasonCode: legacySample ? 'collecting_samples' : 'no_eligible_samples',
      floorHeightM: distribution(heights.length ? heights : [route.totalAscentM / floors]),
      stepsPerFloor: distribution(steps),
      durationPerFloorMs: distribution(durations),
      turnsPerFloor: distribution(turns),
    },
  }
}

export function updateRouteModelFromWorkouts(
  routeInput: RouteTemplate,
  workouts: ClimbWorkout[],
  atMs = Date.now(),
): RouteTemplate {
  const route = migrateRouteToV3(routeInput)
  const rounds = workouts
    .filter((workout) => workout.templateId === route.id)
    .flatMap((workout) => workout.rounds)
    .filter(isLearningEligibleRound)
    .slice(-20)
  if (!rounds.length) return route

  const heights = rounds.map((round) => round.ascentM / round.floorsCompleted)
  const steps = rounds.map((round) => round.steps / round.floorsCompleted)
  const durations = rounds.map((round) => round.durationMs / round.floorsCompleted)
  const turns = rounds.map((round) =>
    round.events.filter((event) => event.type === 'turn').length /
    round.floorsCompleted,
  )
  const heightDistribution = distribution(heights)
  const stepDistribution = distribution(steps)
  const durationDistribution = distribution(durations)
  const turnDistribution = distribution(turns)
  const coefficient = (item: DistributionSummary) =>
    item.mean > 0 ? item.standardDeviation / item.mean : 1
  const stability = Math.max(
    0,
    Math.min(
      1,
      1 -
        coefficient(heightDistribution) * 0.4 -
        coefficient(stepDistribution) * 0.35 -
        coefficient(durationDistribution) * 0.2 -
        coefficient(turnDistribution) * 0.05,
    ),
  )
  const previous = route.learning
  const conflict =
    Boolean(previous?.floorHeightM.mean) &&
    Math.abs(heightDistribution.mean - previous!.floorHeightM.mean) /
      previous!.floorHeightM.mean >
      0.25
  const sampleCount = rounds.length
  const state: RouteLearningModel['state'] = conflict
    ? 'needs_review'
    : sampleCount >= 5 && stability >= 0.8
      ? 'verified'
      : sampleCount >= 3 && stability >= 0.68
        ? 'usable'
        : 'learning'
  const reasonCode: RouteLearningModel['reasonCode'] = conflict
    ? 'sample_conflict'
    : state === 'verified'
      ? 'verified_samples'
      : state === 'usable'
        ? 'consistent_samples'
        : 'collecting_samples'
  const boundedDistribution = (
    next: DistributionSummary,
    prior: DistributionSummary | undefined,
  ): DistributionSummary => ({
    ...next,
    mean: bounded(next.mean, prior?.mean ?? 0),
  })

  return {
    ...route,
    algorithmVersion: ROUTE_ALGORITHM_VERSION,
    status:
      state === 'verified'
        ? 'verified'
        : state === 'needs_review'
          ? 'needs_validation'
          : route.status,
    verifiedAt: state === 'verified' ? route.verifiedAt ?? atMs : route.verifiedAt,
    updatedAt: atMs,
    learning: {
      sampleCount,
      stability,
      lastLearnedAt: atMs,
      state,
      reasonCode,
      floorHeightM: boundedDistribution(heightDistribution, previous?.floorHeightM),
      stepsPerFloor: boundedDistribution(stepDistribution, previous?.stepsPerFloor),
      durationPerFloorMs: boundedDistribution(
        durationDistribution,
        previous?.durationPerFloorMs,
      ),
      turnsPerFloor: boundedDistribution(turnDistribution, previous?.turnsPerFloor),
    },
  }
}
