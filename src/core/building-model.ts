import { BuildingAnchor, BuildingFloor, BuildingTemplate, RouteTemplate } from './types'
import { advanceFloor, getFloorTransitionCount } from './floors'
import { BARO_V1 as P } from './sensor-params'

export function median(values: number[]): number {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b)
  const n = sorted.length
  return n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : 0
}

export function relativeAltitude(pressure: number, baseline: number): number {
  return P.altitudeScale * (1 - (pressure / baseline) ** P.altitudeExponent)
}

export function isBuildingTemplate(value: unknown): value is BuildingTemplate {
  if (!value || typeof value !== 'object') return false
  const b = value as BuildingTemplate
  if (b.schemaVersion !== 1 || b.recognitionVersion !== 'baro-v1' ||
      !Number.isInteger(b.startFloor) || b.startFloor === 0 || !Array.isArray(b.floors)) return false
  return b.floors.every((f, i) => f && f.floor === advanceFloor(b.startFloor, i + 1) &&
    [f.steps, f.turns, f.durationMs].every(n => Number.isFinite(n) && n >= 0) &&
    (f.cumulativeHeightM === undefined || Number.isFinite(f.cumulativeHeightM)) &&
    (f.heightM === undefined || Number.isFinite(f.heightM)) &&
    Array.isArray(f.heightHistory) && f.heightHistory.every(Number.isFinite))
}

export function buildBuilding(startFloor: number, anchors: BuildingAnchor[], at: number): {
  building: BuildingTemplate; warnings: string[]
} {
  const deltas = anchors.map((a, i) => a.heightM === undefined ? undefined :
    a.heightM - (anchors[i - 1]?.heightM ?? 0))
  const typical = median(deltas.filter((h): h is number => h !== undefined && h >= P.minFloorM && h <= P.maxFloorM))
  const floors: BuildingFloor[] = []
  const warnings: string[] = []
  anchors.forEach((anchor, index) => {
    const delta = deltas[index]
    const ratio = typical > 0 && delta !== undefined ? delta / typical : 0
    const count = ratio >= P.missedFloorRatioMin && ratio <= P.missedFloorRatioMax ? 2 : 1
    if (delta !== undefined && (delta < P.minFloorM || delta > P.maxFloorM)) {
      warnings.push(`第 ${anchor.floor} 楼：这一层可能点早或点晚了`)
    }
    const before = anchors[index - 1]?.heightM ?? 0
    for (let part = 1; part <= count; part++) {
      const height = delta === undefined ? undefined : delta / count
      const cumulative = height === undefined ? undefined : before + height * part
      floors.push({ floor: advanceFloor(startFloor, floors.length + 1),
        heightM: height, cumulativeHeightM: cumulative, steps: anchor.steps / count,
        turns: anchor.turns / count, durationMs: anchor.durationMs / count,
        estimated: count > 1 || anchor.estimated === true || height === undefined,
        heightHistory: cumulative === undefined ? [] : [cumulative] })
    }
  })
  return { building: { schemaVersion: 1, recognitionVersion: 'baro-v1', startFloor, floors,
    calibratedAt: at, updatedAt: at, source: 'calibration' }, warnings }
}

/** Conversion is explicit at use time, never a rewrite of saved results. */
export function buildingFromRoute(route: RouteTemplate): BuildingTemplate | undefined {
  if (isBuildingTemplate(route.building) && route.building.floors.length) return route.building
  const count = getFloorTransitionCount(route.startFloor, route.endFloor)
  if (!count || !(route.totalAscentM > 0 || route.floorHeights?.length === count)) return undefined
  let height = 0
  const floors: BuildingFloor[] = Array.from({ length: count }, (_, i) => {
    const h = route.floorHeights?.[i] ?? route.totalAscentM / count
    height += h
    const segment = route.segments[i]
    return { floor: advanceFloor(route.startFloor, i + 1), heightM: h, cumulativeHeightM: height,
      steps: segment?.stepCount || P.defaultSteps,
      turns: segment ? route.markers.filter(m => (m.type === 'turn' || m.type === 'manual_turn') && m.atMs >= segment.startMs && m.atMs < segment.endMs).length : P.defaultTurns,
      durationMs: segment ? segment.endMs - segment.startMs : 0,
      estimated: true, heightHistory: [height] }
  })
  return { schemaVersion: 1, recognitionVersion: 'baro-v1', startFloor: route.startFloor,
    floors, calibratedAt: route.createdAt, updatedAt: route.updatedAt, source: 'legacy' }
}

export function learnBuilding(building: BuildingTemplate, anchors: BuildingAnchor[], corrected: boolean,
  reachedTop: boolean, estimated: boolean, at: number): BuildingTemplate {
  const eligible = corrected ? anchors.filter(a => a.corrected) : reachedTop && !estimated ? anchors : []
  const floors = building.floors.map(f => {
    const anchor = eligible.find(a => a.floor === f.floor && a.heightM !== undefined && !a.estimated)
    if (!anchor) return { ...f }
    const history = [...f.heightHistory, anchor.heightM!].slice(-P.learningRounds)
    return { ...f, cumulativeHeightM: median(history), heightHistory: history }
  })
  let previous = 0
  for (const f of floors) {
    if (f.cumulativeHeightM === undefined) continue
    if (f.cumulativeHeightM <= previous) return building // Reject inconsistent anchors as a whole.
    f.heightM = f.cumulativeHeightM - previous
    previous = f.cumulativeHeightM
  }
  return { ...building, floors, updatedAt: at }
}

export function routeWithBuilding(route: RouteTemplate, building: BuildingTemplate): RouteTemplate {
  return { ...route, building, recognitionVersion: 'baro-v1', algorithmVersion: 'baro-v1',
    startFloor: building.startFloor, endFloor: building.floors.at(-1)?.floor ?? building.startFloor,
    totalAscentM: building.floors.at(-1)?.cumulativeHeightM ?? building.floors.length * P.defaultFloorM,
    floorHeightM: median(building.floors.flatMap(f => f.heightM === undefined ? [] : [f.heightM])) || P.defaultFloorM,
    status: 'verified', updatedAt: building.updatedAt, version: route.version + 1 }
}
