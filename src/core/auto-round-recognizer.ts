import { BuildingAnchor, BuildingTemplate, FeatureFrame, WorkoutRound } from './types'
import { advanceFloor, getFloorTransitionCount } from './floors'
import { buildBuilding, learnBuilding, median, relativeAltitude } from './building-model'
import { BARO_V1 as P } from './sensor-params'
import { StairTurnGate } from './turn-gate'

type Point = { t: number; value: number }
type Mark = { floor: number; at: number; steps: number; turns: number; corrected: boolean }
export interface AutoRoundSnapshot {
  phase: 'ready' | 'climbing' | 'returning' | 'finished'
  currentFloor: number
  floors: number
  steps: number
  activeMs: number
  ascentM: number
  heightM?: number
  velocityMps?: number
  stale: boolean
  estimated: boolean
  calibration: boolean
  elevator: 'up' | 'down' | null
  roundNumber: number
  warnings: string[]
}

export function regressionSlope(points: Point[]): number {
  if (points.length < 2) return 0
  const origin = points[0].t
  const xs = points.map(p => (p.t - origin) / 1000)
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = points.reduce((a, b) => a + b.value, 0) / points.length
  const denominator = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0)
  return denominator ? points.reduce((sum, p, i) => sum + (xs[i] - mx) * (p.value - my), 0) / denominator : 0
}

/** Pure event-time engine. One instance owns ascent, descent and the next baseline. */
export class AutoRoundRecognizer {
  building?: BuildingTemplate
  readonly rounds: WorkoutRound[] = []
  private phase: AutoRoundSnapshot['phase'] = 'ready'
  private now = 0
  private pressures: Point[] = []
  private raw: Point[] = []
  private medians: Point[] = []
  private smooth: Point[] = []
  private p0?: number
  private baselineAt = 0
  private drift = 0
  private plateau?: { pressure: number; at: number; drift: number }
  private lastPressureAt = -Infinity
  private height = 0
  private velocity = 0
  private totalSteps = 0
  private totalTurns = 0
  private stepFrames: Array<{ t: number; start: number; steps: number }> = []
  private turnGate = new StairTurnGate()
  private roundStart = 0
  private roundSteps = 0
  private roundTurns = 0
  private floorSteps = 0
  private floorTurns = 0
  private floorCount = 0
  private activeFrames: Array<{ start: number; end: number; steps: number }> = []
  private marks: Mark[] = []
  private anchors: BuildingAnchor[] = []
  private observedAnchors: BuildingAnchor[] = []
  private estimated = false
  private corrected = false
  private peak = 0
  private peakAt = 0
  private elevatorSince?: number
  private elevatorDirection = 0
  private elevator: AutoRoundSnapshot['elevator'] = null
  private descentSince?: number
  private warnings: string[] = []
  private calibration = true
  private correctionOffset = 0

  constructor(readonly startFloor: number, building?: BuildingTemplate) {
    if (!Number.isInteger(startFloor) || startFloor === 0) throw new Error('起点楼层必须是非零整数')
    this.building = building
    this.calibration = !building?.floors.length
  }

  pushPressure(pressure: number, at: number): AutoRoundSnapshot {
    if (!Number.isFinite(pressure) || pressure <= 0 || !Number.isFinite(at) || at <= this.lastPressureAt || this.phase === 'finished') return this.snapshot()
    const gap = at - this.lastPressureAt > P.staleMs
    this.now = Math.max(this.now, at)
    this.lastPressureAt = at
    if (gap) {
      this.pressures = []; this.raw = []; this.medians = []; this.smooth = []
      this.plateau = undefined; this.elevatorSince = undefined; this.descentSince = undefined
      this.elevator = null
    }
    this.pressures.push({ t: at, value: pressure })
    this.pressures = this.pressures.filter(p => p.t >= at - P.historyMs)
    this.p0 ??= pressure
    if (!this.rounds.length && this.phase === 'ready' && !this.plateau) this.plateau = { pressure, at, drift: 0 }
    const rawHeight = relativeAltitude(pressure, this.p0) - this.drift * (at - this.baselineAt) / 1000
    this.raw.push({ t: at, value: rawHeight })
    this.raw = this.raw.filter(p => p.t >= at - P.historyMs)
    this.medians.push({ t: at, value: median(this.raw.filter(p => p.t >= at - P.medianMs).map(p => p.value)) })
    this.medians = this.medians.filter(p => p.t >= at - P.averageMs)
    this.height = this.medians.reduce((s, p) => s + p.value, 0) / this.medians.length
    this.smooth.push({ t: at, value: this.height })
    this.smooth = this.smooth.filter(p => p.t >= at - P.velocityMs)
    this.velocity = regressionSlope(this.smooth)
    this.finalizeMarks(at)

    if (this.phase !== 'climbing') {
      this.detectPlateau(at)
      this.tryStart(at)
    } else {
      if (rawHeight >= this.peak - P.peakToleranceM) { this.peak = Math.max(this.peak, rawHeight); this.peakAt = at }
      this.detectDescent(at, rawHeight)
      if (this.phase === 'climbing' && !this.elevator && this.velocity >= -P.descentSpeedMps) this.advance(at)
    }
    return this.snapshot()
  }

  pushFrame(frame: FeatureFrame): AutoRoundSnapshot {
    if (this.phase === 'finished') return this.snapshot()
    const at = frame.endMs // Frames use the same absolute acquisition clock as pressure events.
    this.now = Math.max(this.now, at)
    this.totalSteps += frame.steps
    this.stepFrames.push({ t: at, start: frame.startMs, steps: frame.steps })
    this.stepFrames = this.stepFrames.filter(f => f.t >= at - P.historyMs)
    const turn = this.turnGate.push(frame)
    if (turn) this.totalTurns++
    if (this.phase !== 'climbing') this.tryStart(at)
    if (this.phase === 'climbing') {
      if ((frame.steps > 0 || frame.energy >= P.activeEnergy) && this.activeFrames.at(-1)?.end !== at) {
        this.activeFrames.push({ start: frame.startMs, end: at, steps: frame.steps })
      }
      if (this.stale(at)) {
        this.estimated = true
        this.elevator = null; this.elevatorSince = undefined; this.descentSince = undefined
      }
      if (!this.elevator && (this.stale(at) || this.velocity >= -P.descentSpeedMps)) this.advance(at)
      // Learn at observed turns near a landing, not at the early announcement threshold.
      if (turn && !this.stale(at) && !this.calibration && this.building) {
        const target = this.building.floors.find(f => f.cumulativeHeightM !== undefined &&
          Math.abs(rawValue(this.raw) - f.cumulativeHeightM) < (f.heightM ?? P.defaultFloorM) * P.advanceHeightMargin)
        if (target) {
          this.observedAnchors = this.observedAnchors.filter(a => a.floor !== target.floor)
          this.observedAnchors.push({ floor: target.floor, at, heightM: rawValue(this.raw), steps: 0, turns: 0, durationMs: 0 })
        }
      }
    }
    return this.snapshot()
  }

  tick(at: number): AutoRoundSnapshot { this.now = Math.max(this.now, at); return this.snapshot() }
  private stale(at = this.now): boolean { return at - this.lastPressureAt > P.staleMs }

  private detectPlateau(at: number): void {
    const window = this.pressures.filter(p => p.t >= at - P.plateauMs)
    if (window.length < 2 || at - window[0].t < P.plateauMs) return
    const base = window[0].value
    const previous = window.at(-2)!
    const last = window.at(-1)!
    const instantaneous = relativeAltitude(last.value, previous.value) / ((last.t - previous.t) / 1000)
    // Freeze the stationary baseline before the first slow step, rather than
    // misclassifying early ascent as weather and subtracting it for the whole round.
    if (Math.abs(instantaneous) > P.maxWeatherDriftMps) return
    const heights = window.map(p => ({ t: p.t, value: relativeAltitude(p.value, base) }))
    const range = Math.max(...heights.map(p => p.value)) - Math.min(...heights.map(p => p.value))
    if (range <= P.plateauRangeM && this.stepsSince(at - P.plateauMs) === 0) {
      const slope = regressionSlope(heights)
      const slopes = [0, 1, 2].map(i => regressionSlope(heights.filter(p =>
        p.t >= window[0].t + i * P.medianMs && p.t <= window[0].t + (i + 1) * P.medianMs)))
      // Short oscillations must not turn into a linear correction over a long climb.
      // Accept weather drift only if independent one-second slopes agree.
      const stableDrift = slopes.every(s => Math.abs(s - slope) <= P.driftConsistencyMps) ? slope : 0
      this.plateau = { pressure: median(window.map(p => p.value)), at: (at + window[0].t) / 2,
        drift: Math.max(-P.maxWeatherDriftMps, Math.min(P.maxWeatherDriftMps, stableDrift)) }
      if (this.phase === 'returning') this.phase = 'ready'
      this.elevator = null
    }
  }

  private stepsSince(at: number): number { return this.stepFrames.filter(f => f.t >= at).reduce((s, f) => s + f.steps, 0) }
  private tryStart(at: number): void {
    if (this.phase === 'returning' || this.phase === 'finished') return
    const recent = this.stepFrames.filter(f => f.t >= at - P.historyMs && f.steps > 0)
    if (recent.reduce((s, f) => s + f.steps, 0) < P.startSteps) return
    const stale = this.stale(at)
    if (!stale) {
      if (!this.plateau) return
      const rise = relativeAltitude(this.pressures.at(-1)!.value, this.plateau.pressure) -
        this.plateau.drift * (at - this.plateau.at) / 1000
      if (rise < P.startRiseM || this.velocity > P.elevatorSpeedMps) return
      this.p0 = this.plateau.pressure; this.baselineAt = this.plateau.at; this.drift = this.plateau.drift
      this.raw = this.pressures.map(p => ({ t: p.t, value: relativeAltitude(p.value, this.p0!) - this.drift * (p.t - this.baselineAt) / 1000 }))
      this.medians = []; this.smooth = []; this.height = rawValue(this.raw)
    }
    this.phase = 'climbing'; this.roundStart = recent[0].start
    this.roundSteps = this.totalSteps - recent.reduce((s, f) => s + f.steps, 0)
    this.roundTurns = this.totalTurns; this.floorSteps = this.roundSteps; this.floorTurns = this.totalTurns
    this.floorCount = 0; this.peak = this.height; this.peakAt = at
    this.anchors = []; this.observedAnchors = []; this.marks = []
    this.finalizedMarks.clear()
    this.activeFrames = recent.map(f => ({ start: f.start, end: f.t, steps: f.steps }))
    this.estimated = stale; this.corrected = false; this.calibration = !this.building?.floors.length
    this.correctionOffset = 0; this.elevator = null; this.elevatorSince = undefined; this.descentSince = undefined
  }

  private detectDescent(at: number, rawHeight: number): void {
    const direction = Math.abs(this.velocity) > P.elevatorSpeedMps ? Math.sign(this.velocity) : 0
    if (direction && this.stepsSince(at - P.elevatorMs) <= P.elevatorMaxSteps) {
      if (direction !== this.elevatorDirection || this.elevatorSince === undefined) this.elevatorSince = at
      this.elevatorDirection = direction
      if (at - this.elevatorSince >= P.elevatorMs) {
        this.elevator = direction > 0 ? 'up' : 'down'
        if (direction < 0) this.endRound(this.peakAt, at, 'elevator')
      }
    } else { this.elevatorSince = undefined; this.elevatorDirection = 0; this.elevator = null }
    if (this.phase !== 'climbing') return
    if (this.velocity < -P.descentSpeedMps && this.peak - rawHeight >= P.descentDropM && this.stepsSince(at - P.recentStepsMs) > P.elevatorMaxSteps) {
      this.descentSince ??= at
      if (at - this.descentSince >= P.descentMs) this.endRound(this.peakAt, at, 'stairs')
    } else this.descentSince = undefined
  }

  private advance(at: number): void {
    if (this.calibration || !this.building) return
    if (!this.stale(at) && Math.abs(this.velocity) > P.elevatorSpeedMps && this.stepsSince(at - P.elevatorMs) <= P.elevatorMaxSteps) return
    const target = this.building.floors[this.floorCount]
    const typical = median(this.building.floors.flatMap(f => f.heightM === undefined ? [] : [f.heightM])) || P.defaultFloorM
    const steps = target?.steps || median(this.building.floors.map(f => f.steps)) || P.defaultSteps
    const turns = target?.turns ?? median(this.building.floors.map(f => f.turns))
    const pendingSteps = this.totalSteps - this.floorSteps
    const pendingTurns = this.totalTurns - this.floorTurns
    const fallback = this.stale(at) || target?.cumulativeHeightM === undefined && this.building.floors.every(f => f.cumulativeHeightM === undefined)
    const threshold = target?.cumulativeHeightM !== undefined ? target.cumulativeHeightM - P.advanceHeightMargin * (target.heightM ?? typical) :
      (this.building.floors.at(-1)?.cumulativeHeightM ?? this.building.floors.length * typical) +
      (this.floorCount - this.building.floors.length + P.extraFloorRatio) * typical
    if (fallback ? pendingSteps >= steps * P.fallbackStepsRatio && pendingTurns >= turns :
      this.height + this.correctionOffset >= threshold && pendingSteps >= steps * P.advanceStepsRatio) {
      this.floorCount++
      this.estimated ||= fallback
      this.anchors.push({ floor: advanceFloor(this.startFloor, this.floorCount), at,
        heightM: fallback ? undefined : this.height, steps: pendingSteps, turns: pendingTurns,
        durationMs: at - (this.anchors.at(-1)?.at ?? this.roundStart), estimated: fallback })
      this.floorSteps = this.totalSteps; this.floorTurns = this.totalTurns
    }
  }

  markFloor(at: number, floor = advanceFloor(this.startFloor, this.floorCount + 1)): void {
    if (this.phase !== 'climbing' || !Number.isInteger(floor) || floor === 0 || floor < this.startFloor) return
    this.marks.push({ floor, at, steps: this.totalSteps - this.roundSteps,
      turns: this.totalTurns - this.roundTurns, corrected: !this.calibration })
    this.floorCount = getFloorTransitionCount(this.startFloor, floor)
    this.floorSteps = this.totalSteps; this.floorTurns = this.totalTurns
    if (!this.calibration) {
      this.corrected = true
      const target = this.building?.floors[this.floorCount - 1]?.cumulativeHeightM
      this.correctionOffset = target === undefined || this.stale(at) ? 0 : target - this.height
    }
    this.finalizeMarks(at)
  }

  undoMark(): void {
    if (!this.calibration || this.phase !== 'climbing') return
    this.marks.pop()
    this.anchors = this.anchors.slice(0, this.marks.length)
    this.floorCount = this.marks.length
    this.floorSteps = this.roundSteps + (this.marks.at(-1)?.steps ?? 0)
    this.floorTurns = this.roundTurns + (this.marks.at(-1)?.turns ?? 0)
    this.warnings = []
  }

  private finalizedMarks = new Map<Mark, BuildingAnchor>()
  private finalizeMarks(at: number, force = false): void {
    this.marks.forEach((mark, index) => {
      if (this.finalizedMarks.has(mark) || !force && at < mark.at + P.anchorRadiusMs) return
      const points = this.raw.filter(p => Math.abs(p.t - mark.at) <= P.anchorRadiusMs)
      const previous = this.marks[index - 1]
      const anchor: BuildingAnchor = { floor: mark.floor, at: mark.at,
        heightM: points.length ? median(points.map(p => p.value)) : undefined,
        steps: mark.steps - (previous?.steps ?? 0), turns: mark.turns - (previous?.turns ?? 0),
        durationMs: mark.at - (previous?.at ?? this.roundStart), estimated: !points.length, corrected: mark.corrected }
      this.finalizedMarks.set(mark, anchor)
    })
    if (this.calibration) {
      this.anchors = this.marks.flatMap(m => this.finalizedMarks.get(m) ? [this.finalizedMarks.get(m)!] : [])
      this.warnings = buildBuilding(this.startFloor, this.anchors, at).warnings
    }
  }

  /** Only for devices lacking an observable vertical signal. No fake elevator inference. */
  finishEstimatedRound(at: number): void {
    if (this.phase !== 'climbing') return
    this.estimated = true
    this.endRound(at, at, 'manual')
    this.phase = 'ready'; this.stepFrames = []; this.plateau = undefined
  }

  finish(at: number): void {
    if (this.phase === 'finished') return
    if (this.phase === 'climbing') this.endRound(at, at, 'finish')
    this.phase = 'finished'; this.now = at
  }

  private endRound(end: number, detectedAt: number, reason: string): void {
    this.finalizeMarks(detectedAt, true)
    if (this.calibration && this.anchors.length) {
      const built = buildBuilding(this.startFloor, this.anchors, detectedAt)
      this.building = built.building; this.warnings = built.warnings
      this.floorCount = built.building.floors.length
      this.estimated ||= built.building.floors.some(f => f.estimated)
    } else if (this.building) {
      const corrections = this.marks.flatMap(m => this.finalizedMarks.get(m) ? [this.finalizedMarks.get(m)!] : [])
      this.building = learnBuilding(this.building, this.corrected ? corrections : this.observedAnchors,
        this.corrected, this.floorCount >= this.building.floors.length, this.estimated, detectedAt)
    }
    const frames = this.activeFrames.filter(f => f.end <= end)
    const estimatedHeight = this.heightForFloors()
    const anchors = this.calibration ? this.anchors : [...this.anchors, ...this.marks.flatMap(m => this.finalizedMarks.get(m) ? [this.finalizedMarks.get(m)!] : [])]
    let splitAt = this.roundStart
    const splits = this.calibration && this.building ? this.building.floors.map(f => {
      splitAt += f.durationMs
      return { floor: f.floor, at: splitAt, durationMs: f.durationMs, steps: f.steps }
    }) : anchors.filter(a => !a.corrected)
    this.rounds.push({ id: `baro-${this.roundStart}-${this.rounds.length + 1}`, recognitionVersion: 'baro-v1',
      roundNumber: this.rounds.length + 1, floorCounting: 'transitions', startedAt: this.roundStart,
      endedAt: Math.max(this.roundStart, end), descentDetectedAt: reason === 'elevator' || reason === 'stairs' ? detectedAt : undefined,
      durationMs: frames.reduce((sum, f) => sum + f.end - f.start, 0),
      startFloor: this.startFloor, targetFloor: this.building?.floors.at(-1)?.floor ?? advanceFloor(this.startFloor, this.floorCount),
      finalFloor: advanceFloor(this.startFloor, this.floorCount), floorsCompleted: this.floorCount,
      ascentM: this.floorCount ? estimatedHeight : 0,
      steps: frames.reduce((sum, f) => sum + f.steps, 0), estimated: this.estimated,
      confidence: this.estimated ? 0.5 : 0.9, complete: this.floorCount > 0,
      completionReason: reason === 'manual' || reason === 'finish' ? 'manual_finish' : 'route_complete',
      completionSource: this.corrected || reason === 'manual' ? 'manual' : 'automatic',
      trustworthy: !this.estimated && !this.corrected, userCorrectionCount: this.marks.filter(m => m.corrected).length,
      buildingAnchors: anchors,
      floorSplits: splits.map((a, i) => ({ floorFrom: advanceFloor(this.startFloor, i),
        floorTo: a.floor, reachedAtMs: a.at - this.roundStart, splitDurationMs: a.durationMs, steps: a.steps })),
      events: [], interruptions: [] })
    this.phase = 'returning'; this.plateau = undefined; this.stepFrames = []
    this.finalizedMarks.clear(); this.activeFrames = []
  }

  snapshot(): AutoRoundSnapshot {
    const stale = this.stale()
    const cutoff = !stale && rawValue(this.raw) < this.peak - P.peakToleranceM ? this.peakAt : this.now
    const ascentM = this.calibration ? (this.anchors.at(-1)?.heightM ?? this.heightForFloors()) : this.heightForFloors()
    return { phase: this.phase, currentFloor: advanceFloor(this.startFloor, this.floorCount), floors: this.floorCount,
      steps: Math.max(0, this.totalSteps - this.roundSteps),
      activeMs: this.activeFrames.filter(f => f.end <= cutoff).reduce((s, f) => s + f.end - f.start, 0),
      ascentM: this.floorCount ? Math.max(0, ascentM) : 0,
      heightM: stale ? undefined : this.height, velocityMps: stale ? undefined : this.velocity,
      stale, estimated: this.estimated, calibration: this.calibration,
      elevator: stale ? null : this.elevator, roundNumber: this.rounds.length + (this.phase === 'climbing' ? 1 : 0), warnings: this.warnings }
  }

  private heightForFloors(): number {
    const floors = this.building?.floors ?? []
    const typical = median(floors.flatMap(f => f.heightM === undefined ? [] : [f.heightM])) || P.defaultFloorM
    if (this.floorCount > floors.length && floors.at(-1)?.cumulativeHeightM !== undefined) {
      return floors.at(-1)!.cumulativeHeightM! + (this.floorCount - floors.length) * typical
    }
    return floors[this.floorCount - 1]?.cumulativeHeightM ?? this.floorCount * typical
  }
}

function rawValue(points: Point[]): number { return points.at(-1)?.value ?? 0 }
