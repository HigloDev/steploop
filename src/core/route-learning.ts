import { ClimbWorkout, RouteTemplate, WorkoutRound } from './types'
import { isRoundLearnable } from './corrections'
import { getFloorAchievementCount, getRoundAchievementCount } from './floors'
import { hasCheckedMotionReference } from './route-motion'
import {
  isLearningEligibleRound,
  variationScore,
  weightedConsistency,
} from './route-model'

export { variationScore, weightedConsistency }

export type RouteLearningStage =
  | 'unlearned'
  | 'learning'
  | 'usable'
  | 'verified'
  | 'needs_review'

export interface RouteLearningSample {
  workoutId: string
  roundNumber: number
  recordedAt: number
  floors: number
  ascentM: number
  steps: number
  durationMs: number
}

export interface RouteLearningSummary {
  stage: RouteLearningStage
  stageLabel: string
  validCount: number
  targetCount: number
  remainingCount: number
  consistency: number
  averageFloors: number
  averageAscentM: number
  averageSteps: number
  averageDurationMs: number
  samples: RouteLearningSample[]
  message: string
}

function isValidRound(round: WorkoutRound): boolean {
  // 学习资格统一由 corrections.isRoundLearnable 判定（人工修正/手动来源/不可信轮次一律排除），
  // 这里只再叠加路线学习自身的门槛。
  return isRoundLearnable(round) && isLearningEligibleRound(round) && round.ascentM > 0
}

export function summarizeRouteLearning(
  route: RouteTemplate,
  workouts: ClimbWorkout[],
): RouteLearningSummary {
  const routeWorkouts = workouts
    .filter((workout) => workout.templateId === route.id)
    .sort((a, b) => a.startedAt - b.startedAt)

  const samples: RouteLearningSample[] = []
  routeWorkouts.forEach((workout) => {
    workout.rounds.filter(isValidRound).forEach((round) => {
      samples.push({
        workoutId: workout.id,
        roundNumber: round.roundNumber,
        recordedAt: workout.startedAt,
        floors: getRoundAchievementCount(round),
        ascentM: round.ascentM,
        steps: round.steps,
        durationMs: round.durationMs,
      })
    })
  })

  // 兼容旧版已经生成过模板、但还没有多轮训练记录的路线。
  // 把旧模板视为一份初始学习数据；新训练模板的数量只来自合格轮次。
  if (route.learningProvenance !== 'training_rounds' && !samples.length && route.segments.length > 0) {
    samples.push({
      workoutId: `legacy-${route.id}`,
      roundNumber: 1,
      recordedAt: route.verifiedAt ?? route.updatedAt,
      floors: Math.max(
        1,
        getFloorAchievementCount(route.startFloor, route.endFloor),
      ),
      ascentM: Math.max(0.1, route.totalAscentM),
      steps: route.segments.reduce(
        (sum, segment) => sum + segment.stepCount,
        0,
      ),
      durationMs: Math.max(
        10_000,
        route.segments.reduce(
          (maximum, segment) => Math.max(maximum, segment.endMs),
          0,
        ),
      ),
    })
  }

  const validCount = samples.length
  const average = (values: number[]) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0
  const durationScore = variationScore(samples.map((sample) => sample.durationMs))
  const stepScore = variationScore(samples.map((sample) => sample.steps))
  const consistency =
    validCount < 2
      ? validCount === 1
        ? 0.55
        : 0
      : weightedConsistency([
          { score: durationScore, weight: 0.3 },
          { score: stepScore, weight: 0.7 },
        ])

  const checked = route.motionReference?.checkedRuns ?? 0
  const stage: RouteLearningStage = hasCheckedMotionReference(route) ? 'verified' : checked >= 3 ? 'usable'
    : checked > 0 || (route.learningProvenance !== 'training_rounds' && route.segments.length) ? 'learning' : 'unlearned'

  const stageLabel: Record<RouteLearningStage, string> = {
    unlearned: '尚未核对',
    learning: '学习中',
    usable: '仍在核对',
    verified: '已多次核对',
    needs_review: '需要继续确认',
  }

  return {
    stage,
    stageLabel: stage === 'learning' ? '还需核对' : stageLabel[stage],
    validCount: checked,
    targetCount: stage === 'verified' ? checked : 5,
    remainingCount: Math.max(0, 5 - checked),
    consistency,
    averageFloors: average(samples.map((sample) => sample.floors)),
    averageAscentM: average(samples.map((sample) => sample.ascentM)),
    averageSteps: average(samples.map((sample) => sample.steps)),
    averageDurationMs: average(samples.map((sample) => sample.durationMs)),
    samples: samples.slice().reverse(),
    message: !route.segments.length ? '完成第一次正常爬楼后，请确认实际楼层，并记下中途楼层。' : !route.motionReference?.allBoundariesMarked
      ? '已有路线保留作参考。重新记录一次，每到一层点一下楼层标记，才能知道每层各自的走法。'
      : `已由你核对 ${checked} 次，需要至少 5 次、跨 2 天；过程中请记下至少两个实际楼层。`,
  }
}
