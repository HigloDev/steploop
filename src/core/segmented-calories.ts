import { DEFAULT_BODY_WEIGHT_KG, estimateClimbCalories } from './calories'
export { DEFAULT_BODY_WEIGHT_KG } from './calories'
export const CALORIE_ALGORITHM_VERSION = 'segmented-met-v1' as const
export const CALORIE_MET_SOURCE = 'https://pacompendium.com/walking/'
export type StairPace = 'slow' | 'general' | 'fast'
export type CaloriePaceSource = 'default' | 'user'
export type CalorieActivity = 'stairs_up' | 'stairs_down' | 'walking' | 'elevator' | 'waiting'
export type CalorieActivitySource = 'motion_recognition' | 'climb_phase_assumption'
export const STAIR_PACE_OPTIONS: Array<{ value: StairPace; label: string }> = [
  { value: 'slow', label: '慢速' },
  { value: 'general', label: '一般' },
  { value: 'fast', label: '快速' },
]
/** 2024 Adult Compendium: 17133, 17131, 17134. No cadence thresholds or interpolation. */
export const STAIR_MET: Record<StairPace, number> = { slow: 4.5, general: 6.8, fast: 9.3 }

export interface StairCalorieProfile {
  algorithmVersion: typeof CALORIE_ALGORITHM_VERSION
  bodyWeightKg: number
  weightSource: 'workout_setting' | 'default_65kg'
  pace: StairPace
  paceSource: CaloriePaceSource
}

/** Measured motion in the climb phase. Non-ascent portions are retained but excluded. */
export interface StairCalorieSegment {
  roundNumber: number
  activity: CalorieActivity
  activitySource: CalorieActivitySource
  durationMs: number
  pace: StairPace
  paceSource: CaloriePaceSource
  /** null means outside this metric's scope, not zero real energy expenditure. */
  met: number | null
}

export interface WorkoutCalorieEstimate {
  algorithmVersion: typeof CALORIE_ALGORITHM_VERSION | 'legacy-met-8-v1' | 'legacy-height-v1'
  metric: 'active' | 'legacy_gross' | 'legacy_net'
  scope: 'recorded_ascent_only' | 'legacy_training_estimate'
  bodyWeightKg: number
  weightSource: StairCalorieProfile['weightSource']
  activeDurationMs: number
  /** Unrounded result. Round only once for all presentation and voice consumers. */
  kilocalories: number
  grossKilocalories?: number
  restingKilocalories?: number
  restingMet?: number
  metSource?: string
  formula: string
  segments: StairCalorieSegment[]
  assumedGeneralDurationMs?: number
  assumedActivityDurationMs?: number
  excludedMotionDurationMs?: number
  unestimatedMotionDurationMs?: number
}

export function isStairPace(value: unknown): value is StairPace {
  return value === 'slow' || value === 'general' || value === 'fast'
}

export function normalizeStairPace(value: unknown): StairPace {
  return isStairPace(value) ? value : 'general'
}

function nonNegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export function createStairCalorieProfile(bodyWeightKg?: number, pace?: StairPace): StairCalorieProfile {
  const hasWeight = typeof bodyWeightKg === 'number' && Number.isFinite(bodyWeightKg) && bodyWeightKg > 0
  return {
    algorithmVersion: CALORIE_ALGORITHM_VERSION,
    bodyWeightKg: hasWeight ? bodyWeightKg! : DEFAULT_BODY_WEIGHT_KG,
    weightSource: hasWeight ? 'workout_setting' : 'default_65kg',
    pace: normalizeStairPace(pace),
    paceSource: isStairPace(pace) ? 'user' : 'default',
  }
}

/**
 * Reconcile a round's cumulative measured ascent time. A pace change only labels
 * future time. Trimming handles backdated automatic ends without adding wall time.
 * Adjacent equal selections are merged, so storage grows with user changes, not frames.
 */
export function recordStairCalorieDuration(
  before: readonly StairCalorieSegment[],
  activeDurationMs: number,
  profile: StairCalorieProfile,
  roundNumber: number,
  activity: CalorieActivity = 'stairs_up',
  activitySource: CalorieActivitySource = 'climb_phase_assumption',
): StairCalorieSegment[] {
  let remaining = nonNegativeFinite(activeDurationMs)
  const segments: StairCalorieSegment[] = []
  const previous: readonly StairCalorieSegment[] = Array.isArray(before) ? before : []
  for (const segment of previous) {
    if (remaining <= 0) break
    if (!segment || segment.roundNumber !== roundNumber || !isStairPace(segment.pace)) continue
    const durationMs = Math.min(remaining, nonNegativeFinite(segment.durationMs))
    if (durationMs <= 0) continue
    const recordedActivity = calorieActivity(segment.activity)
    segments.push({ ...segment, activity: recordedActivity, durationMs,
      activitySource: segment.activitySource ?? 'climb_phase_assumption',
      met: recordedActivity === 'stairs_up' ? STAIR_MET[segment.pace] : null })
    remaining -= durationMs
  }
  if (remaining > 0) {
    const pace = normalizeStairPace(profile.pace)
    const paceSource = profile.paceSource === 'user' ? 'user' : 'default'
    const last = segments.at(-1)
    if (last && last.pace === pace && last.paceSource === paceSource &&
        last.activity === activity && last.activitySource === activitySource) last.durationMs += remaining
    else segments.push({ roundNumber, activity, activitySource, durationMs: remaining,
      pace, paceSource, met: activity === 'stairs_up' ? STAIR_MET[pace] : null })
  }
  return segments
}

/** Consume existing recognition labels only; introduce no new sensor thresholds. */
export function calorieActivity(value: unknown): CalorieActivity {
  return value === 'stairs_down' || value === 'walking' || value === 'elevator' || value === 'waiting'
    ? value : 'stairs_up'
}

export function calorieActivitySource(value: unknown): CalorieActivitySource {
  return value === undefined || value === 'uncertain' ? 'climb_phase_assumption' : 'motion_recognition'
}

/** Reading a saved round may trim recorded portions, but must not invent lost ones. */
function recordedCalorieSegments(before: readonly StairCalorieSegment[], durationMs: number,
  profile: StairCalorieProfile, roundNumber: number): StairCalorieSegment[] {
  const recorded = (Array.isArray(before) ? before : []).filter((segment: StairCalorieSegment) =>
    segment && segment.roundNumber === roundNumber && isStairPace(segment.pace)) as StairCalorieSegment[]
  const recordedMs = recorded.reduce((sum, segment) => sum + nonNegativeFinite(segment.durationMs), 0)
  return recordStairCalorieDuration(recorded, Math.min(recordedMs, nonNegativeFinite(durationMs)), profile, roundNumber)
}

export interface CalorieWorkoutInput {
  bodyWeightKg?: number
  activeDurationMs: number
  calorieProfile?: StairCalorieProfile
  calorieEstimate?: WorkoutCalorieEstimate
  startedAt?: number
  endedAt?: number
  totalElapsedMs?: number
  rounds: ReadonlyArray<{ roundNumber: number; durationMs: number; activeMs?: number; ascentM?: number;
    floorConfirmation?: string; calorieSegments?: StairCalorieSegment[] }>
}

function roundMeasuredMs(round: CalorieWorkoutInput['rounds'][number]): number {
  return Number.isFinite(round.activeMs) ? nonNegativeFinite(round.activeMs!) : nonNegativeFinite(round.durationMs)
}

export interface CurrentCalorieRound {
  roundNumber: number
  durationMs: number
  segments: readonly StairCalorieSegment[]
}

/** The only entry point for live, saved, recovered, voice and shared calorie values. */
export function getWorkoutCalorieEstimate(
  workout: CalorieWorkoutInput,
  currentRound?: CurrentCalorieRound,
): WorkoutCalorieEstimate {
  const saved = workout.calorieEstimate
  if (!currentRound && saved && Number.isFinite(saved.kilocalories) && saved.kilocalories >= 0 &&
      Number.isFinite(saved.bodyWeightKg) && saved.bodyWeightKg > 0 && Array.isArray(saved.segments) &&
      (saved.metric === 'active' || saved.metric === 'legacy_gross' || saved.metric === 'legacy_net')) return saved
  const profile = workout.calorieProfile
  if (!profile || profile.algorithmVersion !== CALORIE_ALGORITHM_VERSION) {
    // Current 1.1.5 used the height/activity/capped-rest model. Preserve that model
    // for records without new metadata; never reinterpret them as legacy 8 MET.
    const weight = createStairCalorieProfile(Number.isFinite(workout.bodyWeightKg) &&
      workout.bodyWeightKg! > 20 && workout.bodyWeightKg! < 300 ? workout.bodyWeightKg : undefined)
    const completedMs = Array.isArray(workout.rounds)
      ? workout.rounds.reduce((sum, round) => sum + roundMeasuredMs(round), 0)
      : nonNegativeFinite(workout.activeDurationMs)
    const activeDurationMs = completedMs + nonNegativeFinite(currentRound?.durationMs ?? 0)
    const ascentM = (workout.rounds ?? []).reduce((sum, round) => sum +
      (round.floorConfirmation === 'pending' ? 0 : (round.ascentM ?? 0)), 0)
    const elapsed = workout.totalElapsedMs || Math.max(0, (workout.endedAt ?? Date.now()) - (workout.startedAt ?? Date.now()))
    const kilocalories = estimateClimbCalories({ ascentM, activeMs: activeDurationMs,
      restMs: Math.max(0, elapsed - activeDurationMs), bodyWeightKg: weight.bodyWeightKg })
    return {
      algorithmVersion: 'legacy-height-v1', metric: 'legacy_net', scope: 'legacy_training_estimate',
      bodyWeightKg: weight.bodyWeightKg, weightSource: weight.weightSource, activeDurationMs,
      kilocalories, formula: '1.1.5 height + horizontal activity + capped rest', segments: [],
    }
  }
  const weight = createStairCalorieProfile(profile.bodyWeightKg)
  const segments = workout.rounds.flatMap(round => recordedCalorieSegments(
    round.calorieSegments ?? [], roundMeasuredMs(round), profile, round.roundNumber,
  ))
  if (currentRound && !workout.rounds.some(round => round.roundNumber === currentRound.roundNumber)) {
    segments.push(...recordedCalorieSegments(currentRound.segments, currentRound.durationMs, profile, currentRound.roundNumber))
  }
  const ascentSegments = segments.filter(segment => segment.activity === 'stairs_up')
  const activeDurationMs = ascentSegments.reduce((sum, segment) => sum + segment.durationMs, 0)
  const grossKilocalories = ascentSegments.reduce((sum, segment) => sum + (segment.met ?? 0) * weight.bodyWeightKg * segment.durationMs / 3_600_000, 0)
  const kilocalories = ascentSegments.reduce((sum, segment) => sum + Math.max(0, (segment.met ?? 0) - 1) * weight.bodyWeightKg * segment.durationMs / 3_600_000, 0)
  return {
    algorithmVersion: CALORIE_ALGORITHM_VERSION, metric: 'active', scope: 'recorded_ascent_only',
    bodyWeightKg: weight.bodyWeightKg, weightSource: profile.weightSource,
    activeDurationMs, kilocalories, grossKilocalories,
    restingKilocalories: weight.bodyWeightKg * activeDurationMs / 3_600_000,
    restingMet: 1, metSource: CALORIE_MET_SOURCE,
    formula: 'sum(max(MET - 1, 0) * kg * hours)', segments,
    assumedGeneralDurationMs: ascentSegments.filter(segment => segment.paceSource === 'default').reduce((sum, segment) => sum + segment.durationMs, 0),
    assumedActivityDurationMs: ascentSegments.filter(segment => segment.activitySource === 'climb_phase_assumption').reduce((sum, segment) => sum + segment.durationMs, 0),
    excludedMotionDurationMs: segments.filter(segment => segment.activity !== 'stairs_up').reduce((sum, segment) => sum + segment.durationMs, 0),
    unestimatedMotionDurationMs: Math.max(0, workout.rounds.reduce((sum, round) => sum + roundMeasuredMs(round), 0)
      + (currentRound && !workout.rounds.some(round => round.roundNumber === currentRound.roundNumber) ? nonNegativeFinite(currentRound.durationMs) : 0)
      - segments.reduce((sum, segment) => sum + segment.durationMs, 0)),
  }
}

export function calorieMetricLabel(estimate: WorkoutCalorieEstimate): string {
  return estimate.metric === 'active' ? '爬楼活动热量' : '估算消耗（旧口径）'
}

export function calorieDisplayValue(kilocalories: number): number {
  return Math.round(nonNegativeFinite(kilocalories))
}

export function formatCalories(kilocalories: number): string {
  return calorieDisplayValue(kilocalories).toString()
}
