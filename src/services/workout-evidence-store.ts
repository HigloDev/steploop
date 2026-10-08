import { RecognitionSnapshot, SensorSample, WorkoutPhase } from '../core/types'
import { uid } from '../core/math'

export interface WorkoutEvidenceContext {
  workoutId: string
  roundNumber: number
  phase: WorkoutPhase
  startedAt: number
}

export type WorkoutEvidenceRecord =
  | { kind: 'sensor'; sample: SensorSample }
  | { kind: 'recognition'; at: number; snapshot: RecognitionSnapshot }
  | { kind: 'gap'; startAt: number; endAt: number; reason: string }
  | { kind: 'event'; at: number; name: string; detail?: unknown }
  | { kind: 'retention_loss'; at: number; omittedRecords: number; reason: string }

export interface WorkoutEvidenceChunk {
  schemaVersion: 1
  evidenceId: string
  context: WorkoutEvidenceContext
  sequence: number
  /** Retained samples are original measured values at <=10 Hz, never interpolated. */
  sampling: { retainedIntervalMs: 100; method: 'original_sample_downsample' }
  records: WorkoutEvidenceRecord[]
}

/** Narrow synchronous backend: Expo File.write in production, in-memory disk in tests. */
export interface WorkoutEvidenceBackend {
  write(name: string, content: string): void
}

export class RetainedSampleWindow {
  private samples: SensorSample[] = []
  private lastAt = -Infinity
  constructor(private readonly limit = 36000, private readonly intervalMs = 100) {}

  push(sample: SensorSample): void {
    if (!Number.isFinite(sample.t) || sample.t - this.lastAt < this.intervalMs) return
    this.lastAt = sample.t
    this.samples.push({ ...sample })
    if (this.samples.length > this.limit + 1000) this.samples.splice(0, 1001)
  }

  snapshot(): SensorSample[] {
    return this.samples.slice(-this.limit)
  }
}

/**
 * Incremental local evidence journal. Its buffer is independent of workout checkpoints,
 * so a heartbeat never serializes the whole sensor history. Write failures are visible;
 * an extended storage failure produces an explicit loss record instead of silent eviction.
 */
export class WorkoutEvidenceJournal {
  readonly id: string
  private records: WorkoutEvidenceRecord[] = []
  private sequence = 0
  private lastSampleAt = -Infinity
  private lastRecognitionAt = -Infinity
  private lastFloor?: number
  private lastFlushAt: number
  private closed = false
  private lostRecords = 0

  constructor(
    readonly context: WorkoutEvidenceContext,
    private readonly backend: WorkoutEvidenceBackend,
    private readonly onError: (message: string) => void = () => undefined,
    id = uid(`evidence-r${context.roundNumber}-${context.phase}`),
  ) {
    this.id = id
    this.lastFlushAt = context.startedAt
    this.event('phase_start', context.startedAt, { phase: context.phase })
    this.flush(context.startedAt)
  }

  pushSample(sample: SensorSample): void {
    if (this.closed || !Number.isFinite(sample.t)) return
    if (sample.t - this.lastSampleAt < 100) return
    this.lastSampleAt = sample.t
    this.records.push({ kind: 'sensor', sample: { ...sample } })
    this.maybeFlush(sample.t)
  }

  pushRecognition(snapshot: RecognitionSnapshot, at: number): void {
    if (this.closed || !Number.isFinite(at)) return
    if (at - this.lastRecognitionAt < 1000 && snapshot.currentFloor === this.lastFloor) return
    this.lastRecognitionAt = at
    this.lastFloor = snapshot.currentFloor
    this.records.push({ kind: 'recognition', at, snapshot: { ...snapshot } })
    this.maybeFlush(at)
  }

  gap(startAt: number, endAt: number, reason = 'sensor_interrupted'): void {
    if (this.closed) return
    this.records.push({ kind: 'gap', startAt, endAt, reason })
    this.flush(endAt)
  }

  event(name: string, at: number, detail?: unknown): void {
    if (this.closed) return
    this.records.push({ kind: 'event', at, name, ...(detail === undefined ? {} : { detail }) })
    this.maybeFlush(at)
  }

  private maybeFlush(at: number): void {
    if (at - this.lastFlushAt >= 2000 || this.records.length >= 100) this.flush(at)
    // Bound the failure buffer by record count, including exact recognition inputs.
    if (this.records.length > 1200) {
      this.lostRecords += this.records.length - 1200
      this.records.splice(0, this.records.length - 1200)
    }
  }

  flush(at = Date.now()): boolean {
    if (!this.records.length && !this.lostRecords) return true
    const records = this.lostRecords
      ? [{ kind: 'retention_loss' as const, at, omittedRecords: this.lostRecords,
          reason: 'storage_write_failed_buffer_limit' }, ...this.records]
      : this.records
    const chunk: WorkoutEvidenceChunk = {
      schemaVersion: 1,
      evidenceId: this.id,
      context: this.context,
      sequence: this.sequence,
      sampling: { retainedIntervalMs: 100, method: 'original_sample_downsample' },
      records,
    }
    try {
      this.backend.write(`${this.id}-${String(this.sequence).padStart(7, '0')}.json`, JSON.stringify(chunk))
      this.sequence += 1
      this.lastFlushAt = at
      this.records = []
      this.lostRecords = 0
      this.onError('')
      return true
    } catch (error) {
      this.lastFlushAt = at // Back off to the next 2-second interval rather than 10 writes/sec.
      this.onError(`原始数据保存失败：${error instanceof Error ? error.message : String(error)}。训练可继续，请留意数据缺失并及时导出。`)
      return false
    }
  }

  close(at = Date.now()): boolean {
    if (this.closed) return this.flush(at)
    this.event('phase_end', at)
    this.closed = true
    return this.flush(at)
  }
}
