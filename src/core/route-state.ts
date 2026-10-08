import { RouteTemplate } from './types'
import { getFloorAchievementCount } from './floors'

/**
 * 新建路线只有地点信息，终点楼层必须由真实采集确认。
 * 不能把 draft 里的历史占位楼层当成已知路线。
 */
export function hasKnownRouteEnd(route: RouteTemplate): boolean {
  return (
    route.segments.length > 0 &&
    route.endFloor > route.startFloor &&
    (route.totalAscentM > 0 || Boolean(route.preparation))
  )
}

export function getKnownFloorsPerRound(
  route: RouteTemplate,
): number | undefined {
  if (!hasKnownRouteEnd(route)) return undefined
  return getFloorAchievementCount(route.startFloor, route.endFloor)
}
