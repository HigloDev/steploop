import AsyncStorage from '@react-native-async-storage/async-storage'
import { ActiveWorkoutCheckpoint, ClimbWorkout } from '../core/types'
import { uid } from '../core/math'
import { recoverPendingJournal } from './storage-journal'
import {
  HISTORY_WORKOUT_LIMIT,
  historyRepository,
} from './history-repository'

const ACTIVE_CHECKPOINT_KEY = 'palou.activeWorkout.v1'

let recoveryPromise: Promise<void> | null = null

/** 与会话/路线共享同一份存储操作日志，避免读到半提交状态。 */
function ensureRecovered(): Promise<void> {
  if (!recoveryPromise) {
    recoveryPromise = recoverPendingJournal()
      .then((report) => {
        if (report.recovered) {
          console.warn(
            `[workout-storage] 已回滚未完成的多键写入（${report.operation ?? 'unknown'}）`,
          )
        } else if (report.failure) {
          console.error(
            `[workout-storage] 未完成写入的自动回滚失败，将在下次启动重试：${report.failure}`,
          )
        }
      })
      .catch((error) => {
        console.error('[workout-storage] 恢复检查失败', error)
      })
  }
  return recoveryPromise
}

async function safeWrite(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    throw new Error(
      `本地存储写入失败，可能空间不足：${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** D08a：训练明细的读写委托 history-repository（原始明细受容量策略约束 + 增量聚合永久保留）。 */
export async function listWorkouts(): Promise<ClimbWorkout[]> {
  const page = await historyRepository.listWorkouts({ limit: Number.MAX_SAFE_INTEGER })
  return page.items
}

export async function getWorkout(id: string): Promise<ClimbWorkout | undefined> {
  return historyRepository.getWorkout(id)
}

export interface SaveWorkoutResult {
  truncated: boolean
  removed: number
}

export async function saveWorkout(workout: ClimbWorkout): Promise<SaveWorkoutResult> {
  // 保持既有语义：保存时刷新 updatedAt（列表按它倒序）。
  workout.updatedAt = Date.now()
  const { trimmed, total } = await historyRepository.saveWorkout(workout)
  if (trimmed > 0) {
    console.warn(
      `[workout-storage] workouts trimmed ${trimmed} oldest (limit ${HISTORY_WORKOUT_LIMIT})，已归档为统计`,
    )
  }
  return { truncated: trimmed > 0, removed: trimmed }
}

export async function deleteWorkout(id: string): Promise<void> {
  await historyRepository.deleteWorkout(id)
}

export async function loadActiveCheckpoint(): Promise<ActiveWorkoutCheckpoint | null> {
  await ensureRecovered()
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_CHECKPOINT_KEY)
    if (!raw) return null
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

export async function saveActiveCheckpoint(
  cp: ActiveWorkoutCheckpoint | null,
): Promise<void> {
  if (cp === null) {
    try {
      await AsyncStorage.removeItem(ACTIVE_CHECKPOINT_KEY)
    } catch {
      throw new Error('未能清除未完成训练，请重试。')
    }
    return
  }
  await safeWrite(ACTIVE_CHECKPOINT_KEY, cp)
}

export async function clearActiveCheckpoint(): Promise<void> {
  await saveActiveCheckpoint(null)
}

/**
 * 创建新训练对象（未持久化）。由 useClimbWorkout 在 startWorkout 时调用。
 */
export function createWorkout(params: {
  templateId: string
  templateVersion: number
  routeSnapshot: ClimbWorkout['routeSnapshot']
  goal: ClimbWorkout['goal']
  returnConfirmationMode: ClimbWorkout['returnConfirmationMode']
  trackingMode?: ClimbWorkout['trackingMode']
  bodyWeightKg?: number
}): ClimbWorkout {
  const now = Date.now()
  return {
    id: uid('workout'),
    templateId: params.templateId,
    templateVersion: params.templateVersion,
    routeSnapshot: params.routeSnapshot,
    goal: params.goal,
    returnConfirmationMode: params.returnConfirmationMode,
    trackingMode: params.trackingMode ?? 'automatic',
    floorCounting: 'transitions',
    bodyWeightKg: params.bodyWeightKg,
    status: 'active',
    startedAt: now,
    rounds: [],
    currentRoundNumber: 0,
    totalRoundsCompleted: 0,
    totalFloorsCompleted: 0,
    totalAscentM: 0,
    totalSteps: 0,
    activeDurationMs: 0,
    returnDurationMs: 0,
    recoveryDurationMs: 0,
    totalElapsedMs: 0,
    createdAt: now,
    updatedAt: now,
  }
}

/** 测试用：重置启动恢复缓存。生产代码不应调用。 */
export function __resetWorkoutStorageForTests(): void {
  recoveryPromise = null
}
