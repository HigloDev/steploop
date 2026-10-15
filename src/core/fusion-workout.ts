/**
 * fusion-v1 结果 → 持久化记录（ClimbWorkout / WorkoutRound）。
 * 记录结构沿用旧类型，旧的记录页、备份、导出无需另起一套；新字段全部可选。
 */
import { ascentForFloors, BuildingTemplate } from './building-template'
import { applyRoundCorrection } from './corrections'
import { estimateClimbCalories } from './calories'
import { floorAfter, getRoundAchievementCount } from './floors'
import type { FusionRoundResult } from './fusion-engine'
import { FUSION_RECOGNITION_VERSION } from './sensor-params'
import type { ClimbWorkout, WorkoutRound } from './types'
import { calculateWorkoutSummary } from './workout-summary'

export function fusionRoundToWorkoutRound(round: FusionRoundResult): WorkoutRound {
  const splits = round.floorRecords.map((floor, index) => {
    const previous = index === 0 ? round.startedAt : round.floorRecords[index - 1].reachedAt
    return {
      floorFrom: index === 0 ? round.startFloor : round.floorRecords[index - 1].floorTo,
      floorTo: floor.floorTo,
      reachedAtMs: Math.max(0, floor.reachedAt - round.startedAt),
      splitDurationMs: Math.max(0, floor.reachedAt - previous),
      steps: floor.steps,
      confidence: floor.confidence,
    }
  })
  const durations = splits.map(split => split.splitDurationMs).filter(ms => ms > 0)
  return {
    id: round.id,
    roundNumber: round.roundNumber,
    recognitionVersion: FUSION_RECOGNITION_VERSION,
    floorCounting: 'transitions',
    roundKind: round.kind,
    estimated: round.estimated,
    endReason: round.endReason,
    notes: round.notes.length ? round.notes : undefined,
    floorConfirmation: round.kind === 'calibration' ? 'manual' : 'automatic',
    startedAt: round.startedAt,
    endedAt: round.topAt,
    // 本轮用时 = 起爬到登顶；顶层停留、下行、楼下休息不计入。
    durationMs: round.durationMs,
    startFloor: round.startFloor,
    targetFloor: round.finalFloor,
    finalFloor: round.finalFloor,
    floorsCompleted: round.floors,
    ascentM: round.ascentM,
    steps: round.steps,
    confidence: round.confidence,
    complete: round.floors > 0,
    completionReason: round.endReason === 'workout_end' ? 'manual_finish' : 'route_complete',
    completionSource: round.kind === 'calibration' ? 'manual' : 'automatic',
    trustworthy: !round.estimated,
    floorSplits: splits,
    events: [],
    interruptions: round.interruptions.map(gap => ({
      startMs: Math.max(0, gap.startMs - round.startedAt), endMs: Math.max(0, gap.endMs - round.startedAt),
    })),
    averageFloorMs: round.floors ? Math.round(round.durationMs / round.floors) : undefined,
    bestFloorSplitMs: durations.length ? Math.min(...durations) : undefined,
    fusionFloors: round.floorRecords.map(floor => ({
      floorTo: floor.floorTo,
      reachedAtMs: Math.max(0, floor.reachedAt - round.startedAt),
      steps: floor.steps, turns: floor.turns, heightM: floor.heightM,
      source: floor.source, confidence: floor.confidence, estimated: floor.estimated,
    })),
    userCorrectionCount: 0,
    // 活动时间单独保存：用于热量（durationMs 是墙钟用时）。
    activeMs: round.activeMs,
  }
}

/** 一轮的有步伐活动时间；旧记录没有该字段时退回本轮用时。 */
export function roundActiveMs(round: WorkoutRound): number {
  return Number.isFinite(round.activeMs) ? Math.max(0, round.activeMs as number) : Math.max(0, round.durationMs)
}

export interface BuildFusionWorkoutInput {
  id: string
  startedAt: number
  endedAt?: number
  status: ClimbWorkout['status']
  template?: BuildingTemplate
  rounds: WorkoutRound[]
  bodyWeightKg?: number
  createdAt?: number
}

/** 由轮次重新派生训练汇总（总数据永远从轮次计算，修正后不会自相矛盾）。 */
export function buildFusionWorkout(input: BuildFusionWorkoutInput): ClimbWorkout {
  const now = input.endedAt ?? Date.now()
  const summary = calculateWorkoutSummary(input.rounds, input.startedAt, input.endedAt)
  const template = input.template
  const floorsPerRound = template?.floors.length ?? 0
  return {
    id: input.id,
    recognitionVersion: FUSION_RECOGNITION_VERSION,
    buildingId: template?.id,
    trackingMode: 'full_auto',
    floorCounting: 'transitions',
    bodyWeightKg: input.bodyWeightKg,
    templateId: template?.id ?? 'fusion-unsaved',
    templateVersion: template?.version ?? 1,
    routeSnapshot: {
      name: template?.name ?? '新楼栋',
      locationName: template?.location?.name ?? template?.name ?? '新楼栋',
      startFloor: template?.startFloor ?? input.rounds[0]?.startFloor ?? 1,
      endFloor: template ? floorAfter(template.startFloor, floorsPerRound) : input.rounds[0]?.finalFloor ?? 1,
      floorsPerRound,
      ascentPerRoundM: template ? ascentForFloors(template, floorsPerRound) : 0,
    },
    goal: { type: 'open' },
    returnConfirmationMode: 'assisted',
    status: input.status,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    rounds: input.rounds,
    currentRoundNumber: input.rounds.length,
    totalRoundsCompleted: summary.completeRounds,
    totalFloorsCompleted: summary.totalFloors,
    totalAscentM: Number(summary.totalAscentM.toFixed(1)),
    totalSteps: summary.totalSteps,
    activeDurationMs: summary.activeDurationMs,
    returnDurationMs: 0,
    recoveryDurationMs: Math.max(0, summary.totalElapsedMs - summary.activeDurationMs),
    totalElapsedMs: summary.totalElapsedMs,
    bestRoundMs: summary.bestRoundMs,
    averageRoundMs: summary.averageRoundMs,
    latestRoundMs: summary.latestRoundMs,
    createdAt: input.createdAt ?? input.startedAt,
    updatedAt: now,
    trustQuality: input.rounds.some(round => round.estimated) ? 'degraded' : 'stable',
    userCorrectionCount: input.rounds.reduce((sum, round) => sum + (round.corrections?.length ?? 0), 0),
    completionSource: input.rounds.some(round => (round.corrections?.length ?? 0) > 0) ? 'mixed' : 'automatic',
  }
}

/**
 * 结算页修改某一轮的层数。爬升高度按模板逐层层高重新计算（没有模板时按 3m/层）。
 * 原值进入修正链，不覆盖；修正后的轮次不再标“估算”。
 */
export function correctRoundFloors(
  workout: ClimbWorkout,
  roundId: string,
  floors: number,
  template?: BuildingTemplate,
  at = Date.now(),
): ClimbWorkout {
  const target = Math.max(0, Math.min(300, Math.round(floors)))
  const rounds = workout.rounds.map(round => {
    if (round.id !== roundId) return round
    const finalFloor = floorAfter(round.startFloor, target)
    const corrected = applyRoundCorrection(round, { finalFloor, floorsCompleted: target, complete: target > 0 }, {
      at, reason: '结算页修改层数', ascentForFloors: count => ascentForFloors(template, count),
    })
    return corrected === round ? round : { ...corrected, targetFloor: finalFloor, estimated: false }
  })
  const rebuilt = buildFusionWorkout({
    id: workout.id, startedAt: workout.startedAt, endedAt: workout.endedAt, status: workout.status,
    template, rounds, bodyWeightKg: workout.bodyWeightKg, createdAt: workout.createdAt,
  })
  // 历史身份属于这次训练；删除或重命名模板不应改变已保存的楼栋名称和关联。
  return { ...workout, ...rebuilt, buildingId: workout.buildingId, templateId: workout.templateId,
    templateVersion: workout.templateVersion, routeSnapshot: workout.routeSnapshot, updatedAt: at }
}

/** 训练热量：爬升机械功 + 活动/休息代谢（详见 calories.ts）。 */
export function workoutCalories(workout: Pick<ClimbWorkout, 'rounds' | 'bodyWeightKg' | 'startedAt' | 'endedAt' | 'totalElapsedMs'>): number {
  const ascentM = workout.rounds.reduce((sum, round) => sum + (round.floorConfirmation === 'pending' ? 0 : round.ascentM), 0)
  const activeMs = workout.rounds.reduce((sum, round) => sum + roundActiveMs(round), 0)
  const elapsed = workout.totalElapsedMs || Math.max(0, (workout.endedAt ?? Date.now()) - workout.startedAt)
  return estimateClimbCalories({ ascentM, activeMs, restMs: Math.max(0, elapsed - activeMs), bodyWeightKg: workout.bodyWeightKg })
}

export function roundFloors(round: WorkoutRound): number {
  return getRoundAchievementCount(round)
}

export function isFusionWorkout(workout: Pick<ClimbWorkout, 'recognitionVersion'>): boolean {
  return workout.recognitionVersion === FUSION_RECOGNITION_VERSION
}
