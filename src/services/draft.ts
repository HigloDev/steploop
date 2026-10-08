import AsyncStorage from '@react-native-async-storage/async-storage'
import { CalibrationDraft, CarryMode, ManualMark } from '../core/types'

const DRAFT_KEY = 'palou.draft.calibrate.v1'
const THROTTLE_MS = 1000

export interface CalibrateProgress {
  routeName: string
  carryMode: CarryMode
  currentFloor: number
  manualMarks: ManualMark[]
  startedAt: number
  phase: 'ready' | 'recording'
}

type PersistedPayload =
  | { kind: 'draft'; draft: CalibrationDraft; savedAt: number }
  | { kind: 'progress'; progress: CalibrateProgress; savedAt: number }

let activeDraft: CalibrationDraft | undefined
let throttleTimer: ReturnType<typeof setTimeout> | undefined
let pendingPayload: PersistedPayload | undefined

function stripHeavyFields(draft: CalibrationDraft): CalibrationDraft {
  return { ...draft, samples: [] }
}

async function writeNow(payload: PersistedPayload): Promise<void> {
  try {
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(payload))
  } catch (err) {
    console.warn('[draft] persist failed', err)
  }
}

function schedulePersist(payload: PersistedPayload): void {
  pendingPayload = payload
  if (throttleTimer) return
  throttleTimer = setTimeout(() => {
    throttleTimer = undefined
    const next = pendingPayload
    pendingPayload = undefined
    if (next) void writeNow(next)
  }, THROTTLE_MS)
}

function flushPersist(): void {
  if (throttleTimer) {
    clearTimeout(throttleTimer)
    throttleTimer = undefined
  }
  const next = pendingPayload
  pendingPayload = undefined
  if (next) void writeNow(next)
}

export function setActiveDraft(draft: CalibrationDraft): void {
  activeDraft = draft
  pendingPayload = {
    kind: 'draft',
    draft: stripHeavyFields(draft),
    savedAt: Date.now(),
  }
  flushPersist()
}

export function getActiveDraft(): CalibrationDraft | undefined {
  return activeDraft
}

export function clearActiveDraft(): void {
  activeDraft = undefined
  pendingPayload = undefined
  if (throttleTimer) {
    clearTimeout(throttleTimer)
    throttleTimer = undefined
  }
  AsyncStorage.removeItem(DRAFT_KEY).catch(() => undefined)
}

export function saveCalibrateProgress(progress: CalibrateProgress): void {
  schedulePersist({ kind: 'progress', progress, savedAt: Date.now() })
}

export type RestoredCalibrateState =
  | { kind: 'draft'; draft: CalibrationDraft }
  | { kind: 'progress'; progress: CalibrateProgress }
  | null

export async function loadPersistedDraft(): Promise<RestoredCalibrateState> {
  try {
    const raw = await AsyncStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as PersistedPayload
    if (!value || typeof value !== 'object') return null
    if (value.kind === 'draft' && value.draft && typeof value.draft === 'object') {
      const draft: CalibrationDraft = { ...value.draft, samples: [] }
      activeDraft = draft
      return { kind: 'draft', draft }
    }
    if (
      value.kind === 'progress' &&
      value.progress &&
      typeof value.progress === 'object'
    ) {
      return { kind: 'progress', progress: value.progress }
    }
    return null
  } catch {
    return null
  }
}
