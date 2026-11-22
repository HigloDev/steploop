type CompletionAssetPair = { motion: number; still: number }

export const GLACIER_FLIGHT_DURATION_MS = 2240
export const GLACIER_FLIGHT_ASPECT = 576 / 490

const light: CompletionAssetPair[] = [
  { motion: require('../../assets/skins/glacier-glass/completion/light-3.webp'), still: require('../../assets/skins/glacier-glass/completion/light-3-still.webp') },
  { motion: require('../../assets/skins/glacier-glass/completion/light-4.webp'), still: require('../../assets/skins/glacier-glass/completion/light-4-still.webp') },
  { motion: require('../../assets/skins/glacier-glass/completion/light-5.webp'), still: require('../../assets/skins/glacier-glass/completion/light-5-still.webp') },
  { motion: require('../../assets/skins/glacier-glass/completion/light-6.webp'), still: require('../../assets/skins/glacier-glass/completion/light-6-still.webp') },
  { motion: require('../../assets/skins/glacier-glass/completion/light-7.webp'), still: require('../../assets/skins/glacier-glass/completion/light-7-still.webp') },
  { motion: require('../../assets/skins/glacier-glass/completion/light-8.webp'), still: require('../../assets/skins/glacier-glass/completion/light-8-still.webp') },
  { motion: require('../../assets/skins/glacier-glass/completion/light-9.webp'), still: require('../../assets/skins/glacier-glass/completion/light-9-still.webp') },
  { motion: require('../../assets/skins/glacier-glass/completion/light-10.webp'), still: require('../../assets/skins/glacier-glass/completion/light-10-still.webp') },
]

const dark: CompletionAssetPair[] = [
  { motion: require('../../assets/skins/glacier-glass/completion/dark-3.webp'), still: require('../../assets/skins/glacier-glass/completion/dark-3-still.webp') },
  { motion: require('../../assets/skins/glacier-glass/completion/dark-4.webp'), still: require('../../assets/skins/glacier-glass/completion/dark-4-still.webp') },
  { motion: require('../../assets/skins/glacier-glass/completion/dark-5.webp'), still: require('../../assets/skins/glacier-glass/completion/dark-5-still.webp') },
  { motion: require('../../assets/skins/glacier-glass/completion/dark-6.webp'), still: require('../../assets/skins/glacier-glass/completion/dark-6-still.webp') },
  { motion: require('../../assets/skins/glacier-glass/completion/dark-7.webp'), still: require('../../assets/skins/glacier-glass/completion/dark-7-still.webp') },
  { motion: require('../../assets/skins/glacier-glass/completion/dark-8.webp'), still: require('../../assets/skins/glacier-glass/completion/dark-8-still.webp') },
  { motion: require('../../assets/skins/glacier-glass/completion/dark-9.webp'), still: require('../../assets/skins/glacier-glass/completion/dark-9-still.webp') },
  { motion: require('../../assets/skins/glacier-glass/completion/dark-10.webp'), still: require('../../assets/skins/glacier-glass/completion/dark-10-still.webp') },
]

/** Match the representative storey count from AchievementBuilding. */
export function getGlacierCompletionAssets(floors: number, isDark: boolean): CompletionAssetPair {
  const count = Number.isFinite(floors) ? Math.max(0, floors) : 0
  const storeys = Math.min(10, Math.max(3, Math.ceil(Math.sqrt(count))))
  return (isDark ? dark : light)[storeys - 3]
}

export function getGlacierCompletionHeightScale(floors: number): number {
  const count = Number.isFinite(floors) ? Math.max(0, floors) : 0
  const storeys = Math.min(10, Math.max(3, Math.ceil(Math.sqrt(count))))
  const modelHeight = 0.523 + storeys * 0.379 + 0.283
  const nativeHeight = Math.min(0.735 / modelHeight, GLACIER_FLIGHT_ASPECT * 0.219, 0.238) * (modelHeight + 0.05)
  // The window bands represent groups of floors. The visible height uses the full total.
  const displayHeight = 0.29 + 0.50 * (count / (count + 19))
  return displayHeight / nativeHeight
}
