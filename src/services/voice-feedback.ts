import { NativeModules, Platform } from 'react-native'
import { VoiceSegment } from '../core/voice-config'
import { VoicePlaybackBackend, VoicePlaybackOptions, VoicePlaybackResult, WorkoutVoiceOptions, WorkoutVoiceQueue } from '../core/voice-queue'
import { appendVoiceJournalEntry, flushVoiceJournal } from './voice-journal'
import { normalizeVoiceSpeaker } from '../core/voice-speaker'

interface AndroidWorkoutVoiceModule {
  playSegments(segments: VoiceSegment[], volume: number): Promise<VoicePlaybackResult>
  playSegmentsWithOptions?(segments: VoiceSegment[], volume: number, options: VoicePlaybackOptions): Promise<VoicePlaybackResult>
  stop(): Promise<void>
  release(): Promise<void>
  getCapabilities(): Promise<{ prerecorded: boolean; numberTts: boolean; recordedNumbers: boolean; platform: string; speakers?: string[] }>
}

function nativeVoice(): AndroidWorkoutVoiceModule | undefined {
  return Platform.OS === 'android'
    ? NativeModules?.AndroidWorkoutVoice as AndroidWorkoutVoiceModule | undefined
    : undefined
}

export function isWorkoutVoiceAvailable(): boolean {
  const module = nativeVoice()
  return !!module?.playSegments && !!module.stop
}

export async function getWorkoutVoiceCapabilities() {
  const module = nativeVoice()
  if (!module) return { prerecorded: false, numberTts: false, recordedNumbers: false, platform: Platform.OS }
  return module.getCapabilities()
}

export class WorkoutVoiceService extends WorkoutVoiceQueue {
  flushJournal(workoutId: string): Promise<void> {
    return flushVoiceJournal(workoutId)
  }

  /** Use after the final event; navigation can happen while this promise drains. */
  async finish(workoutId: string): Promise<void> {
    await this.waitUntilIdle()
    await this.flushJournal(workoutId)
    await this.dispose()
  }
}

export function createWorkoutVoiceService(
  options: WorkoutVoiceOptions & { backend?: VoicePlaybackBackend; persistJournal?: boolean } = {},
): WorkoutVoiceService {
  if (!options.backend && isWorkoutVoiceAvailable()) {
    // Check the bundled voice packs without starting playback or a system TTS engine.
    void getWorkoutVoiceCapabilities().catch(() => { /* Recorded clips/numbers remain available. */ })
  }
  let playbackGeneration = 0
  let released = false
  const backend: VoicePlaybackBackend = options.backend ?? {
    available: isWorkoutVoiceAvailable,
    async play(segments, volume, playbackOptions) {
      const generation = ++playbackGeneration
      const module = nativeVoice()
      if (!module) throw new Error('native_voice_module_missing')
      const normalized = { rate: 1, bluetoothOnly: false, duckMusic: true, ...playbackOptions, speaker: normalizeVoiceSpeaker(playbackOptions?.speaker) }
      const capabilities = await module.getCapabilities()
      if (released || generation !== playbackGeneration) throw new Error('voice_playback_cancelled')
      if (!capabilities.speakers?.includes(normalized.speaker)) throw new Error('voice_pack_requires_native_update')
      if (module.playSegmentsWithOptions) return module.playSegmentsWithOptions(segments, volume, normalized)
      // Older installed native builds cannot enforce output/privacy options.
      if (normalized.bluetoothOnly) return { playedSegments: 0, numericFallback: false, suppressed: 'bluetooth_unavailable' }
      if (!normalized.duckMusic) return { playedSegments: 0, numericFallback: false, suppressed: 'music_active' }
      if (normalized.rate !== 1) throw new Error('voice_options_require_native_update')
      return module.playSegments(segments, volume)
    },
    async stop() { playbackGeneration += 1; await nativeVoice()?.stop() },
    async dispose() { released = true; playbackGeneration += 1; await nativeVoice()?.release() },
  }
  return new WorkoutVoiceService(backend, {
    ...options,
    onJournal(entry) {
      if (options.persistJournal !== false) void appendVoiceJournalEntry(entry)
      options.onJournal?.(entry)
    },
  })
}

export type { VoiceObservation, VoiceCompletedRound } from '../core/voice-events'
export type { VoiceSettings } from '../core/voice-config'
export type { VoiceJournalEntry } from '../core/voice-queue'
export { loadVoiceJournal, exportVoiceJournal, flushVoiceJournal, voiceJournalWriteError } from './voice-journal'
