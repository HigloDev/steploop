import { uid } from './math'
import { PressureTrend } from './pressure-trend'
import { StairTurnGate } from './turn-gate'
import { ClimbMode, ClimbSession, FeatureFrame, RecognitionSnapshot, RouteTemplate } from './types'

/** An unknown staircase records movement; a user supplies actual floor labels. */
export class FreeRecognizer {
  private totalSteps = 0
  private actualFloor?: number
  private activeMs = 0
  private paused = false
  private lastAt = 0
  private events: ClimbSession['events'] = []
  private interruptions: ClimbSession['interruptions'] = []
  private readonly pressure = new PressureTrend()
  private readonly turnGate = new StairTurnGate()

  constructor(private template: RouteTemplate, private startedAt = Date.now()) {}

  pushBarometer(pressure: number, atMs = Date.now() - this.startedAt): RecognitionSnapshot {
    if (this.paused) return this.snapshot()
    this.lastAt = Math.max(this.lastAt, atMs)
    this.pressure.push(pressure, atMs)
    return this.snapshot()
  }

  pushFrame(frame: FeatureFrame): RecognitionSnapshot {
    if (this.paused) return this.snapshot()
    this.lastAt = Math.max(this.lastAt, frame.endMs)
    this.totalSteps += Math.max(0, frame.steps)
    const trend = this.pressure.snapshot(this.lastAt)
    if (frame.steps > 0 && !(trend.reliable && trend.direction === 'down')) this.activeMs += Math.max(0, frame.endMs - frame.startMs)
    const turn = this.turnGate.push(frame)
    if (turn) this.events.push({ t: turn.atMs, type: 'turn', direction: turn.direction, confidence: turn.confidence })
    return this.snapshot()
  }

  pause(atMs: number): void {
    if (this.paused) return
    this.paused = true
    this.interruptions.push({ startMs: atMs, endMs: atMs })
    this.events.push({ t: atMs, type: 'gap', confidence: 1 })
    this.pressure.gap()
    this.turnGate.reset()
  }

  confirmFloor(floor: number, _atMs: number): RecognitionSnapshot {
    if (Number.isSafeInteger(floor) && floor >= this.template.startFloor) this.actualFloor = floor
    return this.snapshot()
  }

  resume(atMs: number): void {
    if (!this.paused) return
    this.paused = false
    const gap = this.interruptions.at(-1)
    if (gap) gap.endMs = atMs
    this.events.push({ t: atMs, type: 'resume', confidence: 1 })
    this.lastAt = atMs
  }

  snapshot(): RecognitionSnapshot {
    const trend = this.pressure.snapshot(this.lastAt)
    return { currentFloor: this.actualFloor ?? this.template.startFloor, floorsCompleted: 0,
      ascentM: Number(Math.max(0, trend.relativeHeightM).toFixed(1)), steps: this.totalSteps,
      confidence: 0, status: this.paused ? 'paused' : 'matching',
      lastTurn: this.events.filter(event => event.type === 'turn').at(-1)?.direction,
      activeMs: this.activeMs, quality: 'degraded',
      statusReason: this.paused ? 'sensor_interrupted' : 'unknown_route_needs_confirmation',
      canAutoComplete: false, activeSensorSources: ['motion', 'turn', ...(trend.reliable ? ['barometer' as const] : [])],
      floorStatus: 'needs_confirmation', pressureDirection: trend.direction, pressureReliable: trend.reliable,
      motionActivity: trend.direction === 'down' ? 'stairs_down' : trend.direction === 'up' ? 'stairs_up' : 'uncertain' }
  }

  finish(endedAt = Date.now(), mode: ClimbMode = 'free'): ClimbSession {
    const snapshot = this.snapshot()
    return { id: uid('session'), templateId: this.template.id, templateVersion: this.template.version,
      startedAt: this.startedAt, endedAt, startFloor: this.template.startFloor, finalFloor: snapshot.currentFloor,
      floorsCompleted: 0, ascentM: snapshot.ascentM, steps: this.totalSteps, confidence: 0, complete: false,
      events: this.events, floorSplits: [], interruptions: this.interruptions, mode,
      floorConfirmation: 'pending', recognitionVersion: 'motion-v3',
      routeSnapshot: { name: this.template.name, locationName: this.template.location?.name ?? this.template.name,
        startFloor: this.template.startFloor, endFloor: this.template.endFloor, totalAscentM: this.template.totalAscentM },
      durationMs: this.activeMs, averageFloorMs: 0, bestFloorSplitMs: 0 }
  }
}
