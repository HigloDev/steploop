import { StairTurnGate } from './turn-gate'
import { isRoutePrepared } from './route-preparation'
import { ClimbSession, ManualMark, RouteSegment, RouteTemplate } from './types'

/** Learn each segment's geometry from its recorded motion, never a universal two turns. */
export function segmentTurnCount(segment: RouteSegment): number {
  if (Number.isFinite(segment.turnCount)) return Math.max(0, Math.round(segment.turnCount!))
  const gate = new StairTurnGate()
  const duration = Math.max(500, segment.endMs - segment.startMs)
  const interval = duration / Math.max(1, segment.features.length)
  segment.features.forEach((vector, index) => gate.push({ startMs: index * interval,
    endMs: (index + 1) * interval, steps: Math.round((vector[0] ?? 0) * 240 * interval / 60000),
    cadence: (vector[0] ?? 0) * 240, energy: (vector[1] ?? 0) * 0.35,
    turnRad: (vector[2] ?? 0) * 1.2, headingTurnRad: (vector[2] ?? 0) * 1.2, paused: vector[3] ?? 0 }))
  gate.push({ startMs: duration, endMs: duration + 500, steps: 0, cadence: 0, energy: 0,
    turnRad: 0, headingTurnRad: 0, paused: 1 })
  return gate.completedTurns
}

export function hasCheckedMotionReference(route: RouteTemplate): boolean {
  if (route.preparation) return isRoutePrepared(route)
  const reference = route.motionReference
  return reference?.version === 1 && reference.carryMode === route.carryMode &&
    reference.allBoundariesMarked && reference.checkedRuns >= 5 && reference.checkedDays.length >= 2
}

export function createMotionReference(carryMode: RouteTemplate['carryMode'], startFloor: number,
  endFloor: number, marks: ManualMark[]): NonNullable<RouteTemplate['motionReference']> {
  const anchors = marks.filter(mark => mark.type === 'floor' && Number.isSafeInteger(mark.floor))
    .map(mark => ({ floor: mark.floor!, atMs: mark.atMs })).sort((a, b) => a.atMs - b.atMs)
  let previousAt = -1
  const allBoundariesMarked = endFloor > startFloor && Array.from({ length: Math.max(0, endFloor - startFloor) },
    (_, index) => startFloor + index + 1).every(floor => {
      const anchor = anchors.find(anchor => anchor.floor === floor && anchor.atMs > previousAt)
      if (!anchor) return false
      previousAt = anchor.atMs
      return true
    })
  return { version: 1, carryMode, allBoundariesMarked, checkedRuns: 0, checkedDays: [], checkedSessionIds: [], floorAnchors: anchors }
}

/** Only human observations made before correcting the estimate can count as a check. */
export function recordMotionCheck(route: RouteTemplate, session: ClimbSession, actualEndFloor: number): RouteTemplate {
  const reference = route.motionReference
  const sessionKey = session.id ?? `ended-${session.endedAt}`
  if (reference?.checkedSessionIds?.includes(sessionKey)) return route
  const marks = session.manualFloorMarks?.filter(mark => mark.type === 'floor') ?? []
  if (!reference?.allBoundariesMarked || reference.carryMode !== route.carryMode ||
    session.recognitionVersion !== 'motion-v3' || session.interruptions.length ||
    session.finalFloor !== actualEndFloor || actualEndFloor !== route.endFloor ||
    session.steps < 8 || marks.length < 2 ||
    marks.some(mark => mark.estimatedFloor !== mark.floor) ||
    new Set(marks.map(mark => mark.floor)).size < 2) return route
  const date = new Date(session.endedAt)
  const day = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  return { ...route, updatedAt: session.endedAt, motionReference: { ...reference,
    checkedRuns: reference.checkedRuns + 1, checkedDays: [...new Set([...reference.checkedDays, day])],
    checkedSessionIds: [...(reference.checkedSessionIds ?? []), sessionKey] } }
}
