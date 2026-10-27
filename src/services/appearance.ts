import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppearanceSelection, DEFAULT_APPEARANCE, normalizeAppearance } from '../skin-catalog'

export const APPEARANCE_KEY = 'steploop.appearance.v1'
export interface AppearanceSnapshot extends AppearanceSelection {
  hydrated: boolean
  saving: boolean
  error: 'read' | 'write' | null
}
let snapshot: AppearanceSnapshot = { ...DEFAULT_APPEARANCE, hydrated: false, saving: false, error: null }
const listeners = new Set<() => void>()
let hydration: Promise<void> | undefined
let writeQueue: Promise<void> = Promise.resolve()
let revision = 0

export function getAppearanceSnapshot(): AppearanceSnapshot { return snapshot }
export function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function publish(next: AppearanceSnapshot) {
  snapshot = next
  listeners.forEach(listener => listener())
}

export function hydrateAppearance(retry = false): Promise<void> {
  if (hydration && !retry) return hydration
  const startedAt = revision
  hydration = (async () => {
    try {
      const raw = await AsyncStorage.getItem(APPEARANCE_KEY)
      const selection = normalizeAppearance(raw ? JSON.parse(raw) : undefined)
      if (revision === startedAt) publish({ ...selection, hydrated: true, saving: false, error: null })
    } catch {
      if (revision === startedAt) publish({ ...snapshot, hydrated: true, saving: false, error: 'read' })
    }
  })()
  return hydration
}

/** Serialized writes retain the user's latest choice even when taps are rapid. */
export async function saveAppearance(patch: Partial<AppearanceSelection> = {}): Promise<boolean> {
  await hydrateAppearance()
  const selection = normalizeAppearance({ skinId: snapshot.skinId, mode: snapshot.mode, ...patch })
  const currentRevision = ++revision
  publish({ ...selection, hydrated: true, saving: true, error: null })
  let success = false
  const write = writeQueue.then(async () => {
    try {
      await AsyncStorage.setItem(APPEARANCE_KEY, JSON.stringify(selection))
      success = true
      if (revision === currentRevision) publish({ ...selection, hydrated: true, saving: false, error: null })
    } catch {
      if (revision === currentRevision) publish({ ...selection, hydrated: true, saving: false, error: 'write' })
    }
  })
  writeQueue = write.catch(() => undefined)
  await write
  return success
}
