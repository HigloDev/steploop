import type { FusionRoundResult, FusionSnapshot } from './fusion-engine'
import { DEFAULT_FLOOR_HEIGHT_M } from './sensor-params'
import {
  calorieDisplayValue, getWorkoutCalorieEstimate, isAutomaticStairCalorieProfile,
  recordStairCalorieDuration, StairCaloriePaceLabel, StairCalorieProfile,
  StairCalorieSegment, StairPace, WorkoutCalorieEstimate,
} from './segmented-calories'

const PACE_WINDOW_ACTIVE_MS = 8000
const PACE_WINDOW_MAX_POINTS = 48
const PACE_MIN_ACTIVE_MS = 4000
const PACE_MIN_STEPS = 4
const PACE_TRANSITION_ACTIVE_MS = 2000
const PACE_TRANSITION_STEPS = 3
const PACE_MIN_SPM = 30
const PACE_MAX_SPM = 220
const PACE_SLOW_MAX_SPM = 75
const PACE_FAST_MIN_SPM = 125
const STEP_SILENCE_MS = 6000
const PACE_SAMPLE_GAP_MS = 1500

interface PacePoint { activeMs: number; steps: number }

interface PaceWitness {
  phase: FusionSnapshot['phase']
  roundNumber: number
  elapsedMs: number
  activeMs: number
  steps: number
  lastStepElapsedMs: number
  points: PacePoint[]
  adoptedPace?: StairPace
  candidatePace?: StairPace
  candidateSinceActiveMs: number
  candidateSinceSteps: number
  label: StairCaloriePaceLabel
}

function generalPaceLabel(): StairCaloriePaceLabel {
  return { pace: 'general', paceSource: 'default' }
}

function sensorPaceLabel(pace: StairPace): StairCaloriePaceLabel {
  return { pace, paceSource: 'sensor' }
}

/** Product heuristics only; the Compendium supplies MET values, not cadence cutoffs. */
function classifyCadence(steps: number, activeMs: number): StairPace | undefined {
  if (!Number.isFinite(steps) || !Number.isFinite(activeMs) || steps < PACE_MIN_STEPS ||
      activeMs < PACE_MIN_ACTIVE_MS) return undefined
  const stepsPerMinute = steps * 60000 / activeMs
  if (!Number.isFinite(stepsPerMinute) || stepsPerMinute < PACE_MIN_SPM ||
      stepsPerMinute > PACE_MAX_SPM) return undefined
  if (stepsPerMinute >= PACE_FAST_MIN_SPM) return 'fast'
  if (stepsPerMinute < PACE_SLOW_MAX_SPM) return 'slow'
  return 'general'
}

/** Energy bookkeeping consumes engine measurements; it never advances the engine. */
export class FusionCalorieTracker {
  profile?: StairCalorieProfile
  private portions = new Map<number, StairCalorieSegment[]>()
  /** Restored rounds are durable evidence; never extend or relabel their old portions. */
  private restoredRounds = new Set<number>()
  private lastPaceByRound = new Map<number, StairCaloriePaceLabel>()
  private witness?: PaceWitness

  constructor(profile?: StairCalorieProfile, restored: FusionRoundResult[] = []) {
    this.profile = profile ? { ...profile } : undefined
    for (const round of restored) {
      this.portions.set(round.roundNumber, (round.calorieSegments ?? []).map(segment => ({ ...segment })))
      this.restoredRounds.add(round.roundNumber)
    }
  }

  /**
   * Sensor samples use acquisition time; UI/checkpoint snapshots use Date.now()
   * and can run ahead of delayed batches. Bookkeeping must not seed or advance
   * cadence evidence, but still reconciles earned calorie portions.
   */
  observe(
    snapshot: FusionSnapshot,
    rounds: FusionRoundResult[],
    source: 'sample' | 'bookkeeping' = 'sample',
  ): void {
    if (!this.profile) return
    const automatic = isAutomaticStairCalorieProfile(this.profile)
    const currentLabel = automatic
      ? source === 'sample'
        ? this.observeAutomaticPace(snapshot)
        : this.observeBookkeepingPace(snapshot)
      : undefined
    for (const round of rounds) {
      if (this.restoredRounds.has(round.roundNumber)) continue
      const paceLabel = automatic
        ? this.lastPaceByRound.get(round.roundNumber) ?? generalPaceLabel()
        : undefined
      this.portions.set(round.roundNumber, recordStairCalorieDuration(
        this.portions.get(round.roundNumber) ?? round.calorieSegments ?? [],
        round.activeMs, this.profile, round.roundNumber, 'stairs_up', 'climb_phase_assumption', paceLabel,
      ))
    }
    const current = this.current(snapshot, rounds, false)
    if (current) this.portions.set(current.roundNumber, recordStairCalorieDuration(
      this.portions.get(current.roundNumber) ?? [], current.durationMs, this.profile, current.roundNumber,
      'stairs_up', 'climb_phase_assumption', automatic ? currentLabel ?? generalPaceLabel() : undefined,
    ))
  }

  setPace(pace: StairPace, snapshot: FusionSnapshot, rounds: FusionRoundResult[]): void {
    this.observe(snapshot, rounds, 'bookkeeping')
    if (this.profile && !isAutomaticStairCalorieProfile(this.profile)) {
      this.profile = { ...this.profile, pace, paceSource: 'user' }
    }
  }

  /** A recorder gap invalidates cadence evidence without deleting earned portions. */
  recordGap(): void {
    const roundNumber = this.witness?.roundNumber
    if (roundNumber !== undefined) this.lastPaceByRound.set(roundNumber, generalPaceLabel())
    this.witness = undefined
  }

  decorate(rounds: FusionRoundResult[]): FusionRoundResult[] {
    return this.profile ? rounds.map(round => ({ ...round,
      calorieSegments: (this.portions.get(round.roundNumber) ?? round.calorieSegments ?? []).map(segment => ({ ...segment })),
    })) : rounds
  }

  estimate(snapshot: FusionSnapshot, rounds: FusionRoundResult[], bodyWeightKg?: number): WorkoutCalorieEstimate {
    if (!this.profile) {
      const climbing = snapshot.phase === 'climbing' || snapshot.phase === 'calibrating'
      const ascentM = snapshot.ascentM ?? rounds.reduce((sum, round) => sum + round.ascentM, 0)
        + (climbing ? snapshot.roundFloors * DEFAULT_FLOOR_HEIGHT_M : 0)
      return getWorkoutCalorieEstimate({ bodyWeightKg, activeDurationMs: snapshot.activeMs,
        totalElapsedMs: snapshot.activeMs, rounds: [{ roundNumber: 0,
          durationMs: snapshot.activeMs, activeMs: snapshot.activeMs, ascentM }] })
    }
    const completed = this.decorate(rounds)
    const current = this.current(snapshot, rounds, true)
    return getWorkoutCalorieEstimate({ bodyWeightKg: this.profile.bodyWeightKg,
      activeDurationMs: snapshot.activeMs, calorieProfile: this.profile, rounds: completed },
    current ? { ...current, segments: this.portions.get(current.roundNumber) ?? [] } : undefined)
  }

  display(snapshot: FusionSnapshot, rounds: FusionRoundResult[], bodyWeightKg?: number): number {
    return calorieDisplayValue(this.estimate(snapshot, rounds, bodyWeightKg).kilocalories)
  }

  private current(snapshot: FusionSnapshot, rounds: FusionRoundResult[], includeCalibrationTop: boolean) {
    const climbing = snapshot.phase === 'climbing' || snapshot.phase === 'calibrating' ||
      (includeCalibrationTop && snapshot.phase === 'calibration_top')
    if (!climbing || rounds.some(round => round.roundNumber === snapshot.roundNumber)) return undefined
    return { roundNumber: snapshot.roundNumber,
      durationMs: Math.max(0, snapshot.activeMs - rounds.reduce((sum, round) => sum + round.activeMs, 0)) }
  }

  private observeBookkeepingPace(snapshot: FusionSnapshot): StairCaloriePaceLabel | undefined {
    const witness = this.witness
    if (!witness) return this.lastPaceByRound.get(snapshot.roundNumber)
    if (witness.phase !== snapshot.phase || witness.roundNumber !== snapshot.roundNumber) {
      this.witness = undefined
      return this.lastPaceByRound.get(snapshot.roundNumber)
    }
    return witness.label
  }

  private newWitness(snapshot: FusionSnapshot): PaceWitness {
    const label = generalPaceLabel()
    this.lastPaceByRound.set(snapshot.roundNumber, label)
    for (const roundNumber of this.lastPaceByRound.keys()) {
      if (roundNumber < snapshot.roundNumber - 8) this.lastPaceByRound.delete(roundNumber)
    }
    return {
      phase: snapshot.phase,
      roundNumber: snapshot.roundNumber,
      elapsedMs: snapshot.elapsedMs,
      activeMs: snapshot.activeMs,
      steps: snapshot.steps,
      lastStepElapsedMs: snapshot.elapsedMs,
      points: [{ activeMs: snapshot.activeMs, steps: snapshot.steps }],
      candidateSinceActiveMs: snapshot.activeMs,
      candidateSinceSteps: snapshot.steps,
      label,
    }
  }

  private observeAutomaticPace(snapshot: FusionSnapshot): StairCaloriePaceLabel | undefined {
    if (snapshot.phase !== 'climbing' && snapshot.phase !== 'calibrating') {
      if (this.witness && (this.witness.phase !== snapshot.phase ||
          this.witness.roundNumber !== snapshot.roundNumber)) this.witness = undefined
      return undefined
    }
    let witness = this.witness
    if (!witness || witness.phase !== snapshot.phase || witness.roundNumber !== snapshot.roundNumber) {
      this.witness = witness = this.newWitness(snapshot)
      return witness.label
    }
    if (snapshot.elapsedMs < witness.elapsedMs || snapshot.activeMs < witness.activeMs ||
        snapshot.steps < witness.steps) {
      this.invalidateWitness(witness.roundNumber)
      this.witness = witness = this.newWitness(snapshot)
      return witness.label
    }
    if (snapshot.elapsedMs - witness.elapsedMs > PACE_SAMPLE_GAP_MS) {
      this.invalidateWitness(witness.roundNumber)
      this.witness = witness = this.newWitness(snapshot)
      return witness.label
    }
    if (snapshot.elapsedMs - witness.lastStepElapsedMs > STEP_SILENCE_MS) {
      this.invalidateWitness(witness.roundNumber)
      this.witness = witness = this.newWitness(snapshot)
      return witness.label
    }
    if (snapshot.activeMs === witness.activeMs && snapshot.steps === witness.steps) {
      witness.elapsedMs = snapshot.elapsedMs
      return witness.label
    }

    const stepped = snapshot.steps > witness.steps
    if (stepped) {
      witness.lastStepElapsedMs = snapshot.elapsedMs
      // Keep one point per step transition. At sensor rate this is both a
      // cadence window and a bounded queue, instead of a short wall-clock cap.
      witness.points.push({ activeMs: snapshot.activeMs, steps: snapshot.steps })
    }
    witness.elapsedMs = snapshot.elapsedMs
    witness.activeMs = snapshot.activeMs
    witness.steps = snapshot.steps
    while (witness.points.length > PACE_WINDOW_MAX_POINTS ||
        (witness.points.length > 1 && snapshot.activeMs - witness.points[0].activeMs > PACE_WINDOW_ACTIVE_MS)) {
      witness.points.shift()
    }

    const oldest = witness.points[0]
    const measuredPace = classifyCadence(snapshot.steps - oldest.steps, snapshot.activeMs - oldest.activeMs)
    if (!measuredPace) {
      witness.candidatePace = undefined
      witness.label = generalPaceLabel()
      this.lastPaceByRound.set(witness.roundNumber, witness.label)
      return witness.label
    }

    if (witness.adoptedPace === undefined) {
      witness.adoptedPace = measuredPace
      witness.candidatePace = measuredPace
      witness.candidateSinceActiveMs = snapshot.activeMs
      witness.candidateSinceSteps = snapshot.steps
    } else if (measuredPace !== witness.adoptedPace) {
      if (witness.candidatePace !== measuredPace) {
        witness.candidatePace = measuredPace
        witness.candidateSinceActiveMs = snapshot.activeMs
        witness.candidateSinceSteps = snapshot.steps
      }
      if (snapshot.activeMs - witness.candidateSinceActiveMs >= PACE_TRANSITION_ACTIVE_MS &&
          snapshot.steps - witness.candidateSinceSteps >= PACE_TRANSITION_STEPS) {
        witness.adoptedPace = measuredPace
      }
    }

    witness.label = sensorPaceLabel(witness.adoptedPace!)
    this.lastPaceByRound.set(witness.roundNumber, witness.label)
    return witness.label
  }

  private invalidateWitness(roundNumber: number): void {
    this.lastPaceByRound.set(roundNumber, generalPaceLabel())
    this.witness = undefined
  }
}
