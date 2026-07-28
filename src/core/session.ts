import { ClimbSession, RouteTemplate } from './types'

export function splitDurations(session: Pick<ClimbSession, 'floorSplits'>): number[] {
  if (!Array.isArray(session?.floorSplits)) return []
  return session.floorSplits.map((split, index) =>
    Math.max(0, split.elapsedMs - (session.floorSplits[index - 1]?.elapsedMs ?? 0)),
  )
}

export function normalizeSession(session: ClimbSession, route?: RouteTemplate): ClimbSession {
  const safeSession = {
    ...session,
    floorSplits: Array.isArray(session.floorSplits) ? session.floorSplits : [],
    interruptions: Array.isArray(session.interruptions) ? session.interruptions : [],
    events: Array.isArray(session.events) ? session.events : [],
  }
  const durationMs =
    session.durationMs ?? Math.max(0, (session.endedAt ?? 0) - (session.startedAt ?? 0))
  const durations = splitDurations(safeSession)
  return {
    ...safeSession,
    mode: session.mode ?? 'formal',
    routeSnapshot: session.routeSnapshot ?? {
      name: route?.name ?? '已删除的路线',
      locationName: route?.location?.name ?? route?.name ?? '已删除的路线',
      startFloor: route?.startFloor ?? session.startFloor,
      endFloor: route?.endFloor ?? session.finalFloor,
      totalAscentM: route?.totalAscentM ?? session.ascentM,
    },
    durationMs,
    averageFloorMs:
      session.averageFloorMs ??
      (session.floorsCompleted ? Math.round(durationMs / session.floorsCompleted) : 0),
    bestFloorSplitMs: session.bestFloorSplitMs ?? (durations.length ? Math.min(...durations) : 0),
  }
}

export function shareSafePayload(session: ClimbSession): Record<string, unknown> {
  const normalized = normalizeSession(session)
  return {
    routeName: normalized.routeSnapshot?.locationName,
    completedAt: normalized.endedAt,
    complete: normalized.complete,
    floorsCompleted: normalized.floorsCompleted,
    ascentM: normalized.ascentM,
    durationMs: normalized.durationMs,
    steps: normalized.steps,
    startFloor: normalized.startFloor,
    finalFloor: normalized.finalFloor,
  }
}
