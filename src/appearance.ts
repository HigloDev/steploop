import { useSyncExternalStore } from 'react'
import { getAppearanceSnapshot, subscribeAppearance } from './services/appearance'

/** One shared selection for navigation, screens, native controls and posters. */
export function useAppearance() {
  return useSyncExternalStore(subscribeAppearance, getAppearanceSnapshot, getAppearanceSnapshot)
}
