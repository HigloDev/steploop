import { getVoiceTemplate, voiceEventAllowed, VoiceEventKind, VoiceNumberSlot, VoiceSettings } from './voice-config'

export interface VoiceCompletedRound {
  id: string
  roundNumber: number
  floorsCompleted: number
  confirmedTopFloor?: number
  /** Append-only correction count or revision. A restored record is silently seeded. */
  correctionRevision?: number
  /** Durable confirmed return event; handles React batching through recovery/ready. */
  returnedToStartAt?: number
}

export interface VoiceObservation {
  workoutId: string
  mode: 'manual' | 'automatic' | 'full_auto'
  phase: string
  currentRoundNumber: number
  elapsedMs: number
  calories: number
  cumulativeFloors: number
  cumulativeSteps?: number
  /** Recovery duration supplied by the lifecycle timer, excluding elevator descent. */
  restElapsedMs?: number
  startFloor?: number
  completedRounds: VoiceCompletedRound[]
  /** Must come from actual elevator detection, not merely entering the return page. */
  elevatorDescending?: boolean
  /** Confirmed return, supplied by the recognizer or user confirmation. */
  returnedToStart?: boolean
}

export interface VoiceEvent {
  id: string
  kind: VoiceEventKind
  workoutId: string
  at: number
  expiresAt: number
  priority: number
  numbers: Partial<Record<VoiceNumberSlot, number>>
}

export interface VoiceObserverState {
  workoutId?: string
  previous?: VoiceObservation
  seen: Record<string, true>
  roundRevisions: Record<string, number>
}

export function initialVoiceObserverState(): VoiceObserverState {
  return { seen: {}, roundRevisions: {} }
}

/** Pure state reducer. Time comes from the caller, so replay is deterministic. */
export function observeVoiceEvents(
  before: VoiceObserverState,
  input: VoiceObservation,
  settings: VoiceSettings,
  at: number,
): { state: VoiceObserverState; events: VoiceEvent[] } {
  const first = before.workoutId !== input.workoutId || !before.previous
  const state: VoiceObserverState = first
    ? { workoutId: input.workoutId, seen: {}, roundRevisions: {} }
    : { ...before, seen: { ...before.seen }, roundRevisions: { ...before.roundRevisions } }
  const events: VoiceEvent[] = []
  const previous = first ? undefined : before.previous
  function emit(kind: VoiceEventKind, key: string, numbers: VoiceEvent['numbers'] = {}) {
    const id = `${input.workoutId}:${kind}:${key}`
    if (state.seen[id]) return
    state.seen[id] = true
    if (!voiceEventAllowed(kind, settings)) return
    const template = getVoiceTemplate(kind, settings)
    events.push({ id, kind, workoutId: input.workoutId, at, expiresAt: at + template.expiresAfterMs, priority: template.priority, numbers })
  }
  function seed(kind: VoiceEventKind, key: string) {
    state.seen[`${input.workoutId}:${kind}:${key}`] = true
  }

  // Resumed training never replays already completed rounds or historical milestones.
  for (const round of input.completedRounds) {
    if (first) {
      seed('round_finished', round.id)
    } else if (!previous!.completedRounds.some((old) => old.id === round.id)) {
      emit('round_finished', round.id, {
        roundNumber: round.roundNumber, floors: round.floorsCompleted,
        ...((round.correctionRevision ?? 0) > 0 && round.confirmedTopFloor !== undefined ? { floor: round.confirmedTopFloor } : {}),
      })
    }
    const revision = round.correctionRevision ?? 0
    const oldRevision = state.roundRevisions[round.id]
    if (!first && oldRevision !== undefined && revision > oldRevision && round.confirmedTopFloor !== undefined) {
      emit('correction', `${round.id}:${revision}`, { floor: round.confirmedTopFloor })
    }
    state.roundRevisions[round.id] = revision
    if (round.returnedToStartAt !== undefined && Number.isFinite(round.returnedToStartAt)) {
      if (first) seed('returned_to_start', String(round.roundNumber))
      else if (input.mode !== 'manual') emit('returned_to_start', String(round.roundNumber), { floor: input.startFloor ?? 1 })
    }
  }

  if (input.phase === 'ascending' || input.phase === 'climbing') {
    // A restored mid-round snapshot is not a new round start.
    if (!first || input.elapsedMs < 5000) emit('round_started', String(input.currentRoundNumber), { roundNumber: input.currentRoundNumber })
    else seed('round_started', String(input.currentRoundNumber))
  }

  if (input.mode !== 'manual' && input.elevatorDescending) {
    emit('elevator_descending', String(input.currentRoundNumber))
  }
  const confirmedReturn = input.returnedToStart === true ||
    (input.phase === 'recovering' && previous &&
      (previous.phase === 'returning' || previous.phase === 'start_confirmation'))
  if (input.mode !== 'manual' && confirmedReturn && !first) {
    emit('returned_to_start', String(input.currentRoundNumber), { floor: input.startFloor ?? 1 })
  }
  if (input.phase === 'workout_complete' || input.phase === 'finished') {
    if (!first || input.elapsedMs < 5000) emit('workout_finished', 'finish', { floors: input.cumulativeFloors })
    else seed('workout_finished', 'finish')
  }

  function crossing(kind: 'time_milestone' | 'calorie_milestone' | 'step_milestone' | 'floor_milestone', thresholds: number[], value: number, oldValue: number | undefined, slot: 'minutes' | 'calories' | 'steps' | 'floors') {
    if (!Number.isFinite(value)) return
    const crossed = thresholds.filter((threshold) => threshold <= value && (oldValue === undefined || threshold > oldValue))
    // After interruption announce only the latest crossing, rather than a backlog.
    for (const threshold of crossed.slice(0, -1)) seed(kind, String(threshold))
    const latest = crossed.at(-1)
    if (latest === undefined) return
    if (first || input.phase === 'workout_complete' || input.phase === 'finished') seed(kind, String(latest))
    else emit(kind, String(latest), { [slot]: latest })
  }
  crossing('time_milestone', settings.timeMilestonesMinutes, input.elapsedMs / 60_000, previous ? previous.elapsedMs / 60_000 : undefined, 'minutes')
  crossing('calorie_milestone', settings.calorieMilestones, input.calories, previous?.calories, 'calories')
  crossing('step_milestone', settings.stepMilestones, input.cumulativeSteps ?? 0, previous?.cumulativeSteps, 'steps')
  const floorThresholds = [...settings.floorMilestones]
  const lastConfigured = floorThresholds.at(-1) ?? 0
  if (settings.floorMilestoneInterval > 0 && input.cumulativeFloors > lastConfigured) {
    // Calculate only the latest extension, rather than allocating a list for a tall result.
    const extension = lastConfigured + Math.floor((input.cumulativeFloors - lastConfigured) / settings.floorMilestoneInterval) * settings.floorMilestoneInterval
    if (extension > lastConfigured && extension <= 999_999) floorThresholds.push(extension)
  }
  crossing('floor_milestone', floorThresholds, input.cumulativeFloors, previous?.cumulativeFloors, 'floors')
  if (input.completedRounds.length > 0 && ['recovering', 'round_complete', 'round_ready', 'resting'].includes(input.phase) &&
      Number.isFinite(input.restElapsedMs) && input.restElapsedMs! >= settings.restReminderMinutes * 60_000) {
    const key = `${input.completedRounds.at(-1)!.id}:${settings.restReminderMinutes}`
    if (first) seed('rest_reminder', key)
    else emit('rest_reminder', key, { minutes: settings.restReminderMinutes })
  }
  state.previous = {
    ...input,
    completedRounds: input.completedRounds.map((round) => ({ ...round })),
  }
  return { state, events }
}
