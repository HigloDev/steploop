import { ActiveWorkoutCheckpoint, ClimbWorkout } from '../core/types'
import { calculateWorkoutSummary, buildInterruptedRound } from '../core/workout-summary'
import { hasKnownRouteEnd } from '../core/route-state'
import { getFloorAchievementCount, getFloorTransitionCount } from '../core/floors'
import { getRoute } from './storage'
import { saveWorkout, getWorkout, loadActiveCheckpoint, clearActiveCheckpoint } from './workout-storage'
import { getBackgroundTrainingStatus, stopBackgroundTraining } from './background-training'

async function matchingCheckpoint(expected?: ActiveWorkoutCheckpoint): Promise<ActiveWorkoutCheckpoint | null> {
  const current = await loadActiveCheckpoint()
  if (expected && current?.workoutId !== expected.workoutId) {
    throw new Error('未完成训练已发生变化，请刷新后重试；当前恢复点已保留。')
  }
  if (current && (typeof current.workoutId !== 'string' || !current.workoutId.trim())) {
    throw new Error('无法确认未完成训练的编号，恢复点已保留，请先导出备份。')
  }
  return current
}

async function requireMatchingCheckpoint(expected: ActiveWorkoutCheckpoint): Promise<ActiveWorkoutCheckpoint> {
  const current = await matchingCheckpoint(expected)
  // matchingCheckpoint rejects a missing checkpoint when an expected owner is supplied.
  if (!current) throw new Error('未完成训练已发生变化，请刷新后重试；当前恢复点已保留。')
  return current
}

async function trainingStatus() {
  try {
    return await getBackgroundTrainingStatus()
  } catch {
    throw new Error('无法确认后台采集状态，恢复点已保留，请重试。')
  }
}

async function stopCheckpointTraining(cp: ActiveWorkoutCheckpoint): Promise<void> {
  const before = await trainingStatus()
  if (!before.running) return
  if (before.sessionId !== cp.workoutId) {
    throw new Error('后台正在记录另一场训练，本次恢复点已保留；请先结束正在运行的训练。')
  }
  // A new checkpoint must not be stopped because an old confirmation dialog remained open.
  await requireMatchingCheckpoint(cp)
  let stopped
  try {
    stopped = await stopBackgroundTraining()
  } catch {
    throw new Error('后台采集未能停止，恢复点已保留，请重试。')
  }
  const after = await trainingStatus()
  if (stopped.running || after.running) {
    throw new Error('后台采集尚未停止，恢复点已保留，请重试。')
  }
}

async function stopThenClearCheckpoint(cp: ActiveWorkoutCheckpoint): Promise<void> {
  await stopCheckpointTraining(cp)
  // Stopping is asynchronous; do not remove a different workout's newly written checkpoint.
  await requireMatchingCheckpoint(cp)
  await clearActiveCheckpoint()
}

/** Abandon only the current checkpoint's capture service; failure leaves recovery available. */
export async function discardCheckpointAsAbandoned(cp?: ActiveWorkoutCheckpoint): Promise<void> {
  const current = await matchingCheckpoint(cp)
  if (!current) return
  await stopThenClearCheckpoint(current)
}

async function finishSavedCheckpoint(cp: ActiveWorkoutCheckpoint, workout: ClimbWorkout): Promise<ClimbWorkout> {
  try {
    await stopThenClearCheckpoint(cp)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`训练记录已经保存，但${message}`)
  }
  return workout
}

export async function saveCheckpointAsCompleted(
  cp: ActiveWorkoutCheckpoint,
): Promise<ClimbWorkout | null> {
  // Prefer the current persisted snapshot over stale data from a confirmation dialog.
  cp = await requireMatchingCheckpoint(cp)
  const alreadySaved = await getWorkout(cp.workoutId)
  if (alreadySaved?.status === 'completed') {
    if (alreadySaved.templateId !== cp.templateId) {
      throw new Error('已保存训练与恢复点的路线不一致，恢复点已保留，请先导出备份。')
    }
    // A failed stop/clear must not regenerate interrupted rounds or change the saved end time.
    return finishSavedCheckpoint(cp, alreadySaved)
  }
  const route = await getRoute(cp.templateId)
  if (!route) throw new Error('路线已不存在，请先保留这次未完成记录，再决定是否放弃。')
  // ascending 被中断时无法恢复半轮特征：把本轮记录为 interrupted 轮次，
  // 与 resumeFromCheckpoint 行为保持一致，让历史记录可见这次中断
  const completedRounds = Array.isArray(cp.completedRounds) ? cp.completedRounds : []
  const rounds =
    cp.phase === 'ascending' || cp.phase === 'countdown'
      ? [...completedRounds, buildInterruptedRound(cp, route)]
      : completedRounds
  const summary = calculateWorkoutSummary(rounds, cp.startedAt, Date.now(), { warmupDurationMs: cp.warmupDurationMs })
  const knownEnd = hasKnownRouteEnd(route)
  const workout: ClimbWorkout = {
    id: cp.workoutId,
    trackingMode: cp.trackingMode,
    floorCounting: cp.floorCounting,
    bodyWeightKg: cp.bodyWeightKg,
    templateId: cp.templateId,
    templateVersion: route.version,
    routeSnapshot: {
      name: route.name,
      locationName: route.location?.name ?? route.name,
      startFloor: route.startFloor,
      endFloor: knownEnd ? route.endFloor : route.startFloor,
      floorsPerRound: knownEnd
        ? (cp.floorCounting === 'transitions' ? getFloorTransitionCount : getFloorAchievementCount)(route.startFloor, route.endFloor)
        : 0,
      ascentPerRoundM: knownEnd ? route.totalAscentM : 0,
    },
    goal: knownEnd ? cp.goal : { type: 'open' },
    returnConfirmationMode: cp.returnConfirmationMode,
    status: 'completed',
    startedAt: cp.startedAt,
    endedAt: Date.now(),
    rounds,
    currentRoundNumber: cp.currentRoundNumber,
    totalRoundsCompleted: summary.completeRounds,
    totalFloorsCompleted: summary.totalFloors,
    totalAscentM: summary.totalAscentM,
    totalSteps: summary.totalSteps,
    activeDurationMs: summary.activeDurationMs,
    ...(cp.warmupDurationMs !== undefined ? { warmupDurationMs: cp.warmupDurationMs } : {}),
    returnDurationMs: summary.returnDurationMs,
    recoveryDurationMs: summary.recoveryDurationMs,
    totalElapsedMs: summary.totalElapsedMs,
    bestRoundMs: summary.bestRoundMs,
    averageRoundMs: summary.averageRoundMs,
    latestRoundMs: summary.latestRoundMs,
    createdAt: cp.startedAt,
    updatedAt: Date.now(),
    ...(cp.plan ? { plan: cp.plan, planProgress: cp.planProgress } : {}),
  }
  await saveWorkout(workout)
  return finishSavedCheckpoint(cp, workout)
}

