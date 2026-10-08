import AsyncStorage from '@react-native-async-storage/async-storage'
import { File, Paths } from 'expo-file-system'
import { VoiceJournalEntry } from '../core/voice-queue'

const KEY_PREFIX = 'palou.voice-journal.v1.'
const writes = new Map<string, Promise<void>>()
const errors = new Map<string, string>()
const pendingEntries = new Map<string, VoiceJournalEntry[]>()

export interface SavedVoiceJournal {
  schemaVersion: 1
  workoutId: string
  updatedAt: number
  entries: VoiceJournalEntry[]
}

function validEntry(value: unknown): value is VoiceJournalEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<VoiceJournalEntry>
  return typeof entry.at === 'number' && Number.isFinite(entry.at) &&
    typeof entry.workoutId === 'string' && typeof entry.eventId === 'string' &&
    typeof entry.kind === 'string' && typeof entry.outcome === 'string'
}

async function readJournal(workoutId: string): Promise<SavedVoiceJournal> {
  const raw = await AsyncStorage.getItem(KEY_PREFIX + workoutId)
  if (!raw) return { schemaVersion: 1, workoutId, updatedAt: 0, entries: [] }
  const saved = JSON.parse(raw) as SavedVoiceJournal
  if (saved.schemaVersion !== 1 || saved.workoutId !== workoutId || !Array.isArray(saved.entries)) {
    throw new Error('invalid_voice_journal')
  }
  if (!saved.entries.every((entry) => validEntry(entry) && entry.workoutId === workoutId)) {
    // Never replace a corrupted existing journal with a silently filtered record.
    throw new Error('invalid_voice_journal_entry')
  }
  return saved
}

/** Serial per-workout writes ensure queued/played/error entries retain order. */
export function appendVoiceJournalEntry(entry: VoiceJournalEntry): Promise<void> {
  const workoutId = entry.workoutId
  const snapshot: VoiceJournalEntry = {
    ...entry, clipIds: entry.clipIds && [...entry.clipIds], numericTexts: entry.numericTexts && [...entry.numericTexts],
    numberTtsTexts: entry.numberTtsTexts && [...entry.numberTtsTexts], enginesUsed: entry.enginesUsed && [...entry.enginesUsed],
    playbackOptions: entry.playbackOptions && { ...entry.playbackOptions },
  }
  pendingEntries.set(workoutId, [...(pendingEntries.get(workoutId) ?? []), snapshot].slice(-1000))
  const previous = writes.get(workoutId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(async () => {
    const pending = [...(pendingEntries.get(workoutId) ?? [])]
    if (pending.length === 0) return
    const saved = await readJournal(workoutId)
    // A long workout can retain up to 1000 queue/playback outcomes without unbounded growth.
    saved.entries = [...saved.entries, ...pending].slice(-1000)
    saved.updatedAt = pending.at(-1)!.at
    await AsyncStorage.setItem(KEY_PREFIX + workoutId, JSON.stringify(saved))
    const completed = new Set(pending)
    pendingEntries.set(workoutId, (pendingEntries.get(workoutId) ?? []).filter((item) => !completed.has(item)))
    errors.delete(workoutId)
  }).catch((error: unknown) => {
    errors.set(workoutId, error instanceof Error ? error.message : String(error))
  })
  writes.set(workoutId, next)
  return next
}

export async function flushVoiceJournal(workoutId: string): Promise<void> {
  await writes.get(workoutId)
  const error = errors.get(workoutId)
  if (error) throw new Error(`voice_journal_write_failed: ${error}`)
}

export async function loadVoiceJournal(workoutId: string): Promise<SavedVoiceJournal> {
  await flushVoiceJournal(workoutId)
  return readJournal(workoutId)
}

/** Share-ready JSON; root diagnostics can also directly attach loadVoiceJournal(). */
export async function exportVoiceJournal(workoutId: string): Promise<string> {
  const journal = await loadVoiceJournal(workoutId)
  const safeId = workoutId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)
  const file = new File(Paths.cache, `palou-voice-${safeId}.json`)
  file.write(JSON.stringify(journal, null, 2))
  return file.uri
}

export function voiceJournalWriteError(workoutId: string): string | undefined {
  return errors.get(workoutId)
}
