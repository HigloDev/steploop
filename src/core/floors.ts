import { WorkoutRound } from './types'

/** 真实高度段数：1 层到 15 层之间有 14 段垂直爬升。 */
export function getFloorTransitionCount(startFloor: number, endFloor: number): number {
  return Math.max(0, Math.round(endFloor) - Math.round(startFloor))
}

/** 用户成绩口径：从 1 层出发并到达 15 层，记为完成 15 层。 */
export function getFloorAchievementCount(startFloor: number, reachedFloor: number): number {
  const transitions = getFloorTransitionCount(startFloor, reachedFloor)
  return transitions > 0 ? transitions + 1 : 0
}

/** 新旧训练记录统一换算，让旧版的 14 层记录也按新口径展示为 15 层。 */
export function getRoundAchievementCount(
  round: Pick<WorkoutRound, 'startFloor' | 'finalFloor' | 'floorsCompleted' | 'floorCounting' | 'floorConfirmation'>,
): number {
  if (round.floorConfirmation === 'pending') return 0
  if (round.floorCounting === 'transitions') {
    return getFloorTransitionCount(round.startFloor, round.finalFloor)
  }
  return (
    getFloorAchievementCount(round.startFloor, round.finalFloor) ||
    Math.max(0, round.floorsCompleted)
  )
}
