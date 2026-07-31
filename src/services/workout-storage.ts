import AsyncStorage from '@react-native-async-storage/async-storage'
import { ActiveWorkoutCheckpoint, ClimbWorkout } from '../core/types'
import { uid } from '../core/math'

const WORKOUTS_KEY = 'palou.workouts.v1'
const ACTIVE_CHECKPOINT_KEY = 'palou.activeWorkout.v1'
const WORKOUTS_LIMIT = 100

async function readArray<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key)
    if (!raw) return []
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
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

export async function listWorkouts(): Promise<ClimbWorkout[]> {
  const workouts = await readArray<ClimbWorkout>(WORKOUTS_KEY)
  return workouts.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export async function getWorkout(id: string): Promise<ClimbWorkout | undefined> {
  return (await listWorkouts()).find((w) => w.id === id)
}

export async function saveWorkout(workout: ClimbWorkout): Promise<void> {
  workout.updatedAt = Date.now()
  const workouts = await readArray<ClimbWorkout>(WORKOUTS_KEY)
  const index = workouts.findIndex((item) => item.id === workout.id)
  if (index >= 0) workouts[index] = workout
  else workouts.unshift(workout)
  await safeWrite(WORKOUTS_KEY, workouts.slice(0, WORKOUTS_LIMIT))
}

export async function deleteWorkout(id: string): Promise<void> {
  await safeWrite(
    WORKOUTS_KEY,
    (await readArray<ClimbWorkout>(WORKOUTS_KEY)).filter((w) => w.id !== id),
  )
}

export async function loadActiveCheckpoint(): Promise<ActiveWorkoutCheckpoint | null> {
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
      // 忽略删除失败
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
}): ClimbWorkout {
  const now = Date.now()
  return {
    id: uid('workout'),
    templateId: params.templateId,
    templateVersion: params.templateVersion,
    routeSnapshot: params.routeSnapshot,
    goal: params.goal,
    returnConfirmationMode: params.returnConfirmationMode,
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
