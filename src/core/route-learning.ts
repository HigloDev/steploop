import { ClimbWorkout, RouteTemplate, WorkoutRound } from './types'
import { isRoundLearnable } from './corrections'
import { getFloorAchievementCount, getRoundAchievementCount } from './floors'
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
  const floorScore = variationScore(samples.map((sample) => sample.floors))
  const ascentScore = variationScore(samples.map((sample) => sample.ascentM))
  const stepScore = variationScore(samples.map((sample) => sample.steps))
  const consistency =
    validCount < 2
      ? validCount === 1
        ? 0.55
        : 0
      : weightedConsistency([
          { score: floorScore, weight: 0.4 },
          { score: ascentScore, weight: 0.4 },
          { score: stepScore, weight: 0.2 },
        ])

  let stage: RouteLearningStage = 'unlearned'
  if (validCount > 0 && validCount < 3) stage = 'learning'
  if (validCount >= 3 && consistency >= 0.68) stage = 'usable'
  if (validCount >= 5 && consistency >= 0.8) stage = 'verified'
  if (validCount >= 3 && consistency < 0.55) stage = 'needs_review'

  const stageLabel: Record<RouteLearningStage, string> = {
    unlearned: '尚未学习',
    learning: '学习中',
    usable: '基本可用',
    verified: '路线已验证',
    needs_review: '需要继续确认',
  }

  const message: Record<RouteLearningStage, string> = {
    unlearned: route.learningProvenance === 'training_rounds' && route.segments.length > 0
      ? '实际成果已记录，路线尚无可验证的学习数据，请继续采集验证。'
      : '完成第一次正常爬楼后，生成这条路线的初步数据。',
    learning: `已有 ${validCount} 次有效数据，再积累 ${Math.max(
      1,
      3 - validCount,
    )} 次可进行初步判断。`,
    usable: '多次结果已经接近，可以正常训练；继续积累到约 5 次会更稳。',
    verified: '多次爬楼结果稳定，这条路线已经形成可靠的参考。',
    needs_review: '最近几次差异较大，应用会继续学习，不会强行确定路线。',
  }

  return {
    stage,
    stageLabel: stageLabel[stage],
    validCount,
    targetCount: stage === 'verified' ? validCount : 5,
    remainingCount: Math.max(0, 5 - validCount),
    consistency,
    averageFloors: average(samples.map((sample) => sample.floors)),
    averageAscentM: average(samples.map((sample) => sample.ascentM)),
    averageSteps: average(samples.map((sample) => sample.steps)),
    averageDurationMs: average(samples.map((sample) => sample.durationMs)),
    samples: samples.slice().reverse(),
    message: message[stage],
  }
}
