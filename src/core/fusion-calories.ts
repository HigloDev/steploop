import type { FusionRoundResult, FusionSnapshot } from './fusion-engine'
import { DEFAULT_FLOOR_HEIGHT_M } from './sensor-params'
import {
  calorieDisplayValue, getWorkoutCalorieEstimate, recordStairCalorieDuration,
  StairCalorieProfile, StairCalorieSegment, StairPace, WorkoutCalorieEstimate,
} from './segmented-calories'

/** Energy bookkeeping consumes engine measurements; it never advances the engine. */
export class FusionCalorieTracker {
  profile?: StairCalorieProfile
  private portions = new Map<number, StairCalorieSegment[]>()
  private missingRestored = new Set<number>()

  constructor(profile?: StairCalorieProfile, restored: FusionRoundResult[] = []) {
    this.profile = profile ? { ...profile } : undefined
    for (const round of restored) {
      this.portions.set(round.roundNumber, (round.calorieSegments ?? []).map(segment => ({ ...segment })))
      if (!round.calorieSegments) this.missingRestored.add(round.roundNumber)
    }
  }

  observe(snapshot: FusionSnapshot, rounds: FusionRoundResult[]): void {
    if (!this.profile) return
    for (const round of rounds) {
      if (this.missingRestored.has(round.roundNumber)) continue
      this.portions.set(round.roundNumber, recordStairCalorieDuration(
        this.portions.get(round.roundNumber) ?? round.calorieSegments ?? [],
        round.activeMs, this.profile, round.roundNumber,
      ))
    }
    const current = this.current(snapshot, rounds)
    if (current) this.portions.set(current.roundNumber, recordStairCalorieDuration(
      this.portions.get(current.roundNumber) ?? [], current.durationMs, this.profile, current.roundNumber,
    ))
  }

  setPace(pace: StairPace, snapshot: FusionSnapshot, rounds: FusionRoundResult[]): void {
    this.observe(snapshot, rounds)
    if (this.profile) this.profile = { ...this.profile, pace, paceSource: 'user' }
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
    const current = this.current(snapshot, rounds)
    return getWorkoutCalorieEstimate({ bodyWeightKg: this.profile.bodyWeightKg,
      activeDurationMs: snapshot.activeMs, calorieProfile: this.profile, rounds: completed },
    current ? { ...current, segments: this.portions.get(current.roundNumber) ?? [] } : undefined)
  }

  display(snapshot: FusionSnapshot, rounds: FusionRoundResult[], bodyWeightKg?: number): number {
    return calorieDisplayValue(this.estimate(snapshot, rounds, bodyWeightKg).kilocalories)
  }

  private current(snapshot: FusionSnapshot, rounds: FusionRoundResult[]) {
    const climbing = ['climbing', 'calibrating', 'calibration_top'].includes(snapshot.phase)
    if (!climbing || rounds.some(round => round.roundNumber === snapshot.roundNumber)) return undefined
    return { roundNumber: snapshot.roundNumber,
      durationMs: Math.max(0, snapshot.activeMs - rounds.reduce((sum, round) => sum + round.activeMs, 0)) }
  }
}
