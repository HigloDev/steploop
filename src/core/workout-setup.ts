import { RouteTemplate, TrackingMode, WorkoutGoal } from './types'
import { hasKnownRouteEnd } from './route-state'
import { buildPlanFromGoal } from './workout-plan'

export interface SavedWorkoutSetup {
  routeId: string
  routeVersion: number
  carryMode: RouteTemplate['carryMode']
  goal: WorkoutGoal
  planEnabled: boolean
  planWarmup: boolean
  planRecovery: boolean
  trackingMode?: TrackingMode
}

export function validGoal(value: unknown): value is WorkoutGoal {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.type === 'open') return true
  const limits: Record<string, [string, number, number]> = {
    rounds: ['targetRounds', 1, 50], floors: ['targetFloors', 1, 9999],
    ascent: ['targetAscentM', 1, 9999], duration: ['targetActiveDurationMs', 60000, 999 * 60000],
  }
  const limit = limits[String(v.type)]
  if (!limit) return false
  const n = v[limit[0]]
  return typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n) && n >= limit[1] && n <= limit[2]
}

export function restoreWorkoutSetup(route: RouteTemplate, value: unknown): SavedWorkoutSetup {
  const fallback: SavedWorkoutSetup = {
    routeId: route.id, routeVersion: route.version, carryMode: route.carryMode,
    goal: { type: 'open' }, planEnabled: false, planWarmup: true, planRecovery: true,
  }
  if (!value || typeof value !== 'object') return fallback
  const saved = value as SavedWorkoutSetup
  if (saved.routeId !== route.id || saved.routeVersion !== route.version || saved.carryMode !== route.carryMode || !validGoal(saved.goal)) return fallback
  return {
    ...fallback,
    goal: hasKnownRouteEnd(route) ? saved.goal : { type: 'open' },
    planEnabled: saved.planEnabled === true,
    planWarmup: saved.planWarmup !== false,
    planRecovery: saved.planRecovery !== false,
    ...(saved.trackingMode === 'manual' || saved.trackingMode === 'automatic' || saved.trackingMode === 'full_auto'
      ? { trackingMode: saved.trackingMode } : {}),
  }
}

export function describeWorkoutGoal(goal: WorkoutGoal): string {
  switch (goal.type) {
    case 'open': return '自由训练'
    case 'rounds': return `${goal.targetRounds} 轮`
    case 'floors': return `${goal.targetFloors} 层`
    case 'ascent': return `${goal.targetAscentM} 米爬升`
    case 'duration': return `${Math.round(goal.targetActiveDurationMs / 60000)} 分钟净爬楼`
  }
}

export function workoutEntryParams(route: RouteTemplate, setup: SavedWorkoutSetup, now: number) {
  const goal = hasKnownRouteEnd(route) ? setup.goal : { type: 'open' as const }
  return {
    id: route.id, goal, returnConfirmationMode: 'assisted' as const,
    trackingMode: setup.trackingMode ?? 'automatic',
    ...(setup.planEnabled ? { plan: buildPlanFromGoal(goal, {
      id: `plan-${route.id}-${now}`, now, name: `${route.name}计划`,
      includeWarmup: setup.planWarmup, includeReturn: true, includeRecovery: setup.planRecovery,
    }) } : {}),
  }
}
