import { WorkoutRound } from './types'

/**
 * 楼层口径（全应用统一）：按实际爬升段数计算。
 * - 1 楼到 15 楼记 14 层；
 * - 楼层编号没有 0 楼：-1 楼到 1 楼记 1 层，-2 楼到 10 楼记 11 层。
 */
export function getFloorTransitionCount(startFloor: number, endFloor: number): number {
  const start = Math.round(startFloor)
  const end = Math.round(endFloor)
  if (end <= start) return 0
  const skipsZero = start < 0 && end > 0 ? 1 : 0
  return Math.max(0, end - start - skipsZero)
}

/** 从 startFloor 往上爬 transitions 层后到达的楼层号（跳过 0 楼）。 */
export function floorAfter(startFloor: number, transitions: number): number {
  const start = normalizeFloorNumber(startFloor)
  const count = Number.isFinite(transitions) ? Math.max(0, Math.round(transitions)) : 0
  const raw = start + count
  return start < 0 && raw >= 0 ? raw + 1 : raw
}

/** 可选的起始楼层（跳过 0）。 */
export function normalizeFloorNumber(floor: number): number {
  if (!Number.isFinite(floor)) return 1
  const value = Math.round(floor)
  return value === 0 ? (floor < 0 ? -1 : 1) : value
}

/** 楼层选择器前后移动，地下 1 楼与地上 1 楼直接相邻。 */
export function shiftFloorNumber(floor: number, direction: -1 | 1): number {
  const next = normalizeFloorNumber(floor) + direction
  return next === 0 ? direction : next
}

/**
 * @deprecated 旧版“到达口径”（1→15 记 15 层）已废弃，统一改为爬升段数。
 * 保留函数名只为兼容旧调用，返回值与 getFloorTransitionCount 相同。
 */
export function getFloorAchievementCount(startFloor: number, reachedFloor: number): number {
  return getFloorTransitionCount(startFloor, reachedFloor)
}

/** 新旧训练记录统一换算为爬升段数；待确认（pending）的旧记录不计成绩。 */
export function getRoundAchievementCount(
  round: Pick<WorkoutRound, 'startFloor' | 'finalFloor' | 'floorsCompleted' | 'floorCounting' | 'floorConfirmation'>,
): number {
  if (round.floorConfirmation === 'pending') return 0
  const transitions = Number.isFinite(round.startFloor) && Number.isFinite(round.finalFloor)
    ? getFloorTransitionCount(round.startFloor, round.finalFloor) : 0
  if (transitions > 0 || round.floorCounting === 'transitions') return transitions
  return Math.max(0, Math.round(round.floorsCompleted || 0))
}
