import {
  buildVoiceSegments, DEFAULT_VOICE_LIBRARY, getVoiceTemplate, isVoiceNightQuiet, normalizeVoiceSettings,
  voiceEventAllowed, VoiceDetailMode, VoiceSegment, VoiceSettings,
} from './voice-config'
import { initialVoiceObserverState, observeVoiceEvents, VoiceEvent, VoiceObservation, VoiceObserverState } from './voice-events'
import type { VoiceSpeaker } from './voice-speaker'

export interface VoicePlaybackResult {
  recordedNumberUsed?: boolean
  playedSegments: number
  numericFallback: boolean
  numberTtsUsed?: boolean
  /** Native reports only synthesized numbers whose waveform actually finished playing. */
  numberTtsTexts?: string[]
  numberTtsEngine?: string
  suppressed?: 'bluetooth_unavailable' | 'music_active'
  partialPlayedSegments?: number
}

export interface VoicePlaybackOptions {
  speaker?: VoiceSpeaker
  rate: number
  bluetoothOnly: boolean
  duckMusic: boolean
}

export interface VoicePlaybackBackend {
  available(): boolean
  play(segments: VoiceSegment[], volume: number, options?: VoicePlaybackOptions): Promise<VoicePlaybackResult>
  /** Interrupts any pending native promise as well as audio playback. */
  stop(): Promise<void> | void
  dispose?(): Promise<void> | void
}

export interface VoiceJournalEntry {
  at: number
  workoutId: string
  eventId: string
  kind: VoiceEvent['kind']
  outcome: 'queued' | 'played' | 'failed' | 'expired' | 'cancelled' | 'disabled' | 'unavailable' | 'superseded' | 'suppressed'
  detail?: string
  numericFallback?: boolean
  playbackSource?: 'prerecorded' | 'prerecorded_and_number_tts' | 'prerecorded_number_fallback' | 'prerecorded_with_recorded_numbers'
  libraryId?: string
  libraryVersion?: string
  templateId?: string
  detailMode?: VoiceDetailMode
  clipIds?: string[]
  numericTexts?: string[]
  numberTtsTexts?: string[]
  enginesUsed?: Array<'bundled_audio' | 'number_tts' | 'recorded_number_pack'>
  numberTtsEngine?: string
  playedSegments?: number
  partialPlayedSegments?: number
  playbackOptions?: VoicePlaybackOptions & { volume: number }
}

export interface WorkoutVoiceOptions {
  settings?: Partial<VoiceSettings>
  now?: () => number
  onJournal?: (entry: VoiceJournalEntry) => void
  /** Avoid rapid consecutive announcements. Defaults to 600 ms. */
  gapMs?: number
}

/** Single playback owner. Feedback never throws into the training lifecycle. */
export class WorkoutVoiceQueue {
  private settings: VoiceSettings
  private observer: VoiceObserverState = initialVoiceObserverState()
  private pending: VoiceEvent[] = []
  private current?: VoiceEvent
  private running?: Promise<void>
  private journal: VoiceJournalEntry[] = []
  private generation = 0
  private stopped = false
  private disposed = false
  private lastPlayedAt = Number.NEGATIVE_INFINITY
  private encouragementIndex = 0
  private lastEncouragementId?: string
  private currentMetadata?: Partial<VoiceJournalEntry>
  private nextGap?: ReturnType<typeof setTimeout>
  private resolveGap?: () => void
  private readonly now: () => number

  constructor(private readonly backend: VoicePlaybackBackend, private readonly options: WorkoutVoiceOptions = {}) {
    this.settings = normalizeVoiceSettings(options.settings)
    this.now = options.now ?? Date.now
  }

  setSettings(next: Partial<VoiceSettings>): void {
    const previous = this.settings
    this.settings = normalizeVoiceSettings({
      ...this.settings, ...next,
      eventEnabled: { ...this.settings.eventEnabled, ...next.eventEnabled },
      templateOverrides: { ...this.settings.templateOverrides, ...next.templateOverrides },
    })
    if (!this.settings.enabled || this.settings.volume === 0) {
      this.cancelPending('disabled')
      void this.interruptCurrent('disabled')
    } else {
      // Remove events that were explicitly muted after being enqueued.
      this.pending = this.pending.filter((event) => {
        if (voiceEventAllowed(event.kind, this.settings)) return true
        this.record(event, 'disabled')
        return false
      })
      if (this.current && !voiceEventAllowed(this.current.kind, this.settings)) {
        void this.interruptCurrent('disabled')
      }
      if (this.current && (isVoiceNightQuiet(this.settings, this.now()) ||
          (!previous.bluetoothOnly && this.settings.bluetoothOnly) ||
          (previous.duckMusic && !this.settings.duckMusic) ||
          (previous.encouragementEnabled && !this.settings.encouragementEnabled))) {
        void this.interruptCurrent('cancelled')
      }
    }
  }

  getSettings(): VoiceSettings {
    return normalizeVoiceSettings(this.settings)
  }

  observe(input: VoiceObservation): VoiceEvent[] {
    if (this.disposed) return []
    this.stopped = false
    if (this.current && isVoiceNightQuiet(this.settings, this.now())) void this.interruptCurrent('suppressed', 'night_quiet')
    if (this.observer.workoutId && this.observer.workoutId !== input.workoutId) {
      this.cancelPending('cancelled')
      void this.interruptCurrent('cancelled')
    }
    const observed = observeVoiceEvents(this.observer, input, this.settings, this.now())
    this.observer = observed.state
    this.enqueue(observed.events)
    return observed.events
  }

  /** Also accepts explicit events for calibration/correction previews and tests. */
  enqueue(events: VoiceEvent[]): void {
    if (this.disposed || this.stopped) return
    for (const event of events) {
      if (!voiceEventAllowed(event.kind, this.settings) || this.settings.volume === 0) {
        this.record(event, 'disabled')
        continue
      }
      if (isVoiceNightQuiet(this.settings, this.now())) {
        this.record(event, 'suppressed', 'night_quiet')
        continue
      }
      if (!this.backend.available()) {
        this.record(event, 'unavailable', 'native_voice_module_missing')
        continue
      }
      if (this.current?.id === event.id || this.pending.some((queued) => queued.id === event.id) ||
        this.journal.some((entry) => entry.eventId === event.id && entry.outcome === 'played')) continue
      if (event.kind === 'workout_finished') {
        this.cancelPending('superseded')
        if (this.current && this.current.kind !== 'workout_finished') void this.interruptCurrent('superseded')
      }
      if (event.kind === 'round_started') {
        // Arrival prompts cease to be relevant once climbing actually starts.
        if (this.current?.kind === 'returned_to_start' || this.current?.kind === 'elevator_descending') {
          void this.interruptCurrent('superseded')
        }
        this.pending = this.pending.filter((queued) => {
          if (queued.kind !== 'returned_to_start' && queued.kind !== 'elevator_descending') return true
          this.record(queued, 'superseded')
          return false
        })
      }
      this.pending.push(event)
      this.record(event, 'queued')
    }
    this.pending.sort((a, b) => b.priority - a.priority || a.at - b.at)
    this.ensurePump()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.cancelPending('cancelled')
    await this.interruptCurrent('cancelled')
    await this.waitUntilIdle()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await this.stop()
    try { await this.backend.dispose?.() } catch { /* Playback cleanup cannot damage training. */ }
  }

  async waitUntilIdle(): Promise<void> {
    while (this.running) await this.running
  }

  getJournal(): VoiceJournalEntry[] {
    return this.journal.map((entry) => this.copyEntry(entry))
  }

  private copyEntry(entry: VoiceJournalEntry): VoiceJournalEntry {
    return {
      ...entry, clipIds: entry.clipIds && [...entry.clipIds], numericTexts: entry.numericTexts && [...entry.numericTexts],
      numberTtsTexts: entry.numberTtsTexts && [...entry.numberTtsTexts], enginesUsed: entry.enginesUsed && [...entry.enginesUsed],
      playbackOptions: entry.playbackOptions && { ...entry.playbackOptions },
    }
  }

  private metadata(event: VoiceEvent): Partial<VoiceJournalEntry> {
    const library = this.settings.templateLibrary ?? DEFAULT_VOICE_LIBRARY
    return {
      libraryId: library.id, libraryVersion: library.version,
      templateId: getVoiceTemplate(event.kind, this.settings).id ?? `${library.id}.${event.kind}`,
      detailMode: this.settings.detailMode,
    }
  }

  private record(event: VoiceEvent, outcome: VoiceJournalEntry['outcome'], detail?: string, numericFallback?: boolean, playbackSource?: VoiceJournalEntry['playbackSource'], extra: Partial<VoiceJournalEntry> = {}) {
    const entry: VoiceJournalEntry = {
      at: this.now(), workoutId: event.workoutId, eventId: event.id, kind: event.kind, outcome, detail, numericFallback, playbackSource,
      ...this.metadata(event), ...extra,
    }
    this.journal.push(entry)
    if (this.journal.length > 1000) this.journal.splice(0, this.journal.length - 1000)
    try { this.options.onJournal?.(this.copyEntry(entry)) } catch { /* Observability is non-blocking. */ }
  }

  private cancelPending(outcome: VoiceJournalEntry['outcome']) {
    for (const event of this.pending) this.record(event, outcome)
    this.pending = []
  }

  private async interruptCurrent(outcome: VoiceJournalEntry['outcome'], detail?: string) {
    this.generation += 1
    if (this.nextGap) clearTimeout(this.nextGap)
    this.nextGap = undefined
    this.resolveGap?.()
    this.resolveGap = undefined
    if (this.current) {
      this.record(this.current, outcome, detail, undefined, undefined, this.currentMetadata)
      this.current = undefined
      this.currentMetadata = undefined
    }
    try { await this.backend.stop() } catch { /* Native modules may already be invalidated. */ }
  }

  private ensurePump() {
    if (this.running || this.pending.length === 0 || this.stopped || this.disposed) return
    this.running = this.pump().finally(() => {
      this.running = undefined
      if (this.pending.length > 0 && !this.stopped && !this.disposed) this.ensurePump()
    })
  }

  private async gap() {
    const wait = Math.max(0, (this.options.gapMs ?? 600) - (this.now() - this.lastPlayedAt))
    if (wait === 0) return
    await new Promise<void>((resolve) => {
      this.resolveGap = resolve
      this.nextGap = setTimeout(() => {
        this.nextGap = undefined
        this.resolveGap = undefined
        resolve()
      }, wait)
    })
  }

  private async pump() {
    while (this.pending.length > 0 && !this.stopped && !this.disposed) {
      await this.gap()
      if (this.stopped || this.disposed || this.pending.length === 0) break
      const event = this.pending.shift()!
      if (!voiceEventAllowed(event.kind, this.settings) || this.settings.volume === 0) {
        this.record(event, 'disabled')
        continue
      }
      if (isVoiceNightQuiet(this.settings, this.now())) {
        this.record(event, 'suppressed', 'night_quiet')
        continue
      }
      if (event.expiresAt < this.now()) {
        this.record(event, 'expired')
        continue
      }
      const generation = this.generation
      this.current = event
      let metadata: Partial<VoiceJournalEntry> = this.metadata(event)
      try {
        const segments = buildVoiceSegments(event.kind, event.numbers, this.settings, this.encouragementIndex, this.lastEncouragementId)
        const playbackOptions = { speaker: this.settings.speaker, rate: this.settings.rate, bluetoothOnly: this.settings.bluetoothOnly, duckMusic: this.settings.duckMusic }
        metadata = {
          ...metadata, clipIds: segments.flatMap((segment) => segment.kind === 'clip' ? [segment.id] : []),
          numericTexts: segments.flatMap((segment) => segment.kind === 'number' ? [segment.value] : []),
          playbackOptions: { ...playbackOptions, volume: this.settings.volume },
        }
        this.currentMetadata = metadata
        const result = await this.backend.play(segments, this.settings.volume, playbackOptions)
        if (generation === this.generation) {
          if (result.suppressed) {
            this.record(event, 'suppressed', result.suppressed, result.numericFallback, undefined, {
              ...metadata, playedSegments: 0, partialPlayedSegments: result.partialPlayedSegments,
              numberTtsTexts: result.numberTtsTexts && [...result.numberTtsTexts], numberTtsEngine: result.numberTtsEngine,
            })
            continue
          }
          if (!Number.isFinite(result.playedSegments) || result.playedSegments <= 0) throw new Error('voice_no_segments_played')
          this.record(event, 'played', undefined, result.numericFallback,
            result.numericFallback ? 'prerecorded_number_fallback' :
              result.numberTtsUsed ? 'prerecorded_and_number_tts' : result.recordedNumberUsed ? 'prerecorded_with_recorded_numbers' : 'prerecorded', {
                ...metadata, playedSegments: result.playedSegments,
                numberTtsTexts: result.numberTtsTexts && [...result.numberTtsTexts],
                numberTtsEngine: result.numberTtsEngine,
                enginesUsed: ['bundled_audio', ...(result.numericFallback || result.recordedNumberUsed ? ['recorded_number_pack' as const] : []), ...(result.numberTtsUsed ? ['number_tts' as const] : [])],
              })
          this.lastPlayedAt = this.now()
          this.encouragementIndex += 1
          const encouragementIds = getVoiceTemplate(event.kind, this.settings).parts.flatMap((part) => part.kind === 'encouragement' ? part.pool : [])
          this.lastEncouragementId = segments.flatMap((part) => part.kind === 'clip' && encouragementIds.includes(part.id) ? [part.id] : []).at(-1) ?? this.lastEncouragementId
        }
      } catch (error) {
        if (generation === this.generation) this.record(event, 'failed', error instanceof Error ? error.message : String(error), undefined, undefined, metadata)
      } finally {
        if (generation === this.generation) {
          this.current = undefined
          this.currentMetadata = undefined
        }
      }
    }
  }
}
