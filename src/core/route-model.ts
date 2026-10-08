import { isRoundLearnable } from './corrections'
import { hasCheckedMotionReference } from './route-motion'
import {
  ClimbWorkout,
  DistributionSummary,
  RouteLearningModel,
  RouteTemplate,
  WorkoutRound,
} from './types'

export const ROUTE_MODEL_VERSION = 3 as const
export const ROUTE_ALGORITHM_VERSION = 'motion-v3'


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

/** 单指标变异系数 → [0,1] 得分。CV 越大得分越低，0.3125 为 0 分。 */
export function variationScore(values: number[]): number {
  if (values.length < 2) return 0.55
  const average = values.reduce((sum, v) => sum + v, 0) / values.length
  if (average <= 0) return 0
  const variance =
    values.reduce((sum, v) => sum + (v - average) ** 2, 0) / values.length
  const cv = Math.sqrt(variance) / average
  return Math.max(0, Math.min(1, 1 - cv * 3.2))
}

/** 从 DistributionSummary 计算变异得分（与 variationScore 同一公式）。 */
export function distributionVariationScore(dist: DistributionSummary): number {
  if (dist.count < 2) return 0.55
  if (dist.mean <= 0) return 0
  const cv = dist.standardDeviation / dist.mean
  return Math.max(0, Math.min(1, 1 - cv * 3.2))
}

/** 多指标加权一致性：各指标独立 clamp 后加权平均，单一离群指标不会拖垮整体。 */
export function weightedConsistency(
  metrics: Array<{ score: number; weight: number }>,
): number {
  const totalWeight = metrics.reduce((sum, m) => sum + m.weight, 0)
  if (totalWeight <= 0) return 0
  return metrics.reduce((sum, m) => sum + m.score * m.weight, 0) / totalWeight
}

export function isLearningEligibleRound(round: WorkoutRound): boolean {
  return (
    isRoundLearnable(round) &&
    round.completionReason === 'route_complete' &&
    round.interruptions.length === 0 &&
    round.confidence >= 0.8 &&
    round.durationMs >= 10_000 &&
    round.floorsCompleted > 0
  )
}

/**
 * F24：坏路线必须给出**可读原因**，而不是 `Cannot read properties of undefined`。
 * 备份文件可能来自损坏的导出或手工编辑，导入时这条错误会直接显示给用户。
 */
function assertRouteShape(route: RouteTemplate): void {
  if (!route || typeof route !== 'object') {
    throw new Error('路线数据无效：不是一个对象')
  }
  const label = route.name || route.id || '未知路线'
  if (!Array.isArray(route.segments)) {
    throw new Error(`路线「${label}」数据无效：缺少 segments 数组`)
  }
}

export function migrateRouteToV3(route: RouteTemplate): RouteTemplate {
  assertRouteShape(route)
  // 旧数据可能没有 markers：按「没有标记」处理，而不是抛 TypeError
  const markers = Array.isArray(route.markers) ? route.markers : []
  const safeRoute = markers === route.markers ? route : { ...route, markers }
  if (safeRoute.modelVersion === ROUTE_MODEL_VERSION && safeRoute.learning) return safeRoute
  const floors = Math.max(1, safeRoute.segments.length)
  const heights = safeRoute.segments.map((segment) => segment.ascentM)
  const steps = safeRoute.segments.map((segment) => segment.stepCount)
  const durations = safeRoute.segments.map((segment) => segment.endMs - segment.startMs)
  const turns = safeRoute.segments.map((segment) =>
    markers.filter(
      (marker) =>
        (marker.type === 'turn' || marker.type === 'manual_turn') &&
        marker.atMs >= segment.startMs &&
        marker.atMs <= segment.endMs,
    ).length,
  )
  const fromTrainingRounds = safeRoute.learningProvenance === 'training_rounds'
  const legacySample = !fromTrainingRounds && safeRoute.segments.length ? 1 : 0
  return {
    ...safeRoute,
    modelVersion: ROUTE_MODEL_VERSION,
    algorithmVersion: safeRoute.algorithmVersion ?? 'legacy-migrated',
    deviceCapabilities: safeRoute.deviceCapabilities ?? {
      barometerAvailable: 'unknown',
      effectiveSamplingHz: null,
    },
    learning: {
      sampleCount: legacySample,
      stability: legacySample ? 0.55 : 0,
      lastLearnedAt: legacySample ? safeRoute.verifiedAt ?? safeRoute.updatedAt : undefined,
      state: !fromTrainingRounds && safeRoute.status === 'verified' ? 'learning' : 'unlearned',
      reasonCode: legacySample ? 'collecting_samples' : 'no_eligible_samples',
      floorHeightM: distribution(heights.length ? heights : [safeRoute.totalAscentM / floors]),
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
  // 旧模型留作参考；不能靠自己预测的结果给自己增加“已核对”次数。
  if (!hasCheckedMotionReference(route)) return route
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
  const stability = weightedConsistency([
    { score: distributionVariationScore(stepDistribution), weight: 0.6 },
    { score: distributionVariationScore(durationDistribution), weight: 0.3 },
    { score: distributionVariationScore(turnDistribution), weight: 0.1 },
  ])
  const previous = route.learning
  const conflict =
    Boolean(previous?.stepsPerFloor.mean) &&
    Math.abs(stepDistribution.mean - previous!.stepsPerFloor.mean) /
      previous!.stepsPerFloor.mean >
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
    segments: route.segments,
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
