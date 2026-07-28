import { RouteLocation, RouteTemplate } from './types'

const EARTH_RADIUS_M = 6371000

function radians(value: number): number {
  return (value * Math.PI) / 180
}

export function distanceMeters(
  from: Pick<RouteLocation, 'latitude' | 'longitude'>,
  to: Pick<RouteLocation, 'latitude' | 'longitude'>,
): number {
  const latitudeDelta = radians(to.latitude - from.latitude)
  const longitudeDelta = radians(to.longitude - from.longitude)
  const fromLatitude = radians(from.latitude)
  const toLatitude = radians(to.latitude)
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export interface RouteWithDistance {
  route: RouteTemplate
  distanceM?: number
}

export function routesByDistance(
  routes: RouteTemplate[],
  current?: Pick<RouteLocation, 'latitude' | 'longitude'>,
): RouteWithDistance[] {
  return routes
    .map((route) => ({
      route,
      distanceM:
        current && route.location ? Math.round(distanceMeters(current, route.location)) : undefined,
    }))
    .sort((a, b) => {
      if (a.distanceM === undefined) return 1
      if (b.distanceM === undefined) return -1
      return a.distanceM - b.distanceM
    })
}
