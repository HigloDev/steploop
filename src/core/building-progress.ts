export function buildingAnimationDuration(totalFloors: number): number {
  return Math.min(6000, Math.max(2000, 2000 + Math.max(0, totalFloors) * 35))
}

/** Logical floors are never capped. Only the visible drawing window is bounded. */
export function buildingProgress(totalFloors: number, elapsedMs: number, reducedMotion = false) {
  const total = Number.isFinite(totalFloors) ? Math.max(0, Math.floor(totalFloors)) : 0
  const duration = buildingAnimationDuration(total)
  const ratio = reducedMotion ? 1 : Math.min(1, Math.max(0, elapsedMs / duration))
  const built = Math.min(total, Math.floor(total * ratio))
  const firstVisibleFloor = Math.max(1, built - 79)
  return { total, built, duration, complete: ratio >= 1, firstVisibleFloor,
    visibleFloors: Array.from({ length: Math.min(80, built) }, (_, i) => firstVisibleFloor + i) }
}
