export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function mean(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

export function nearestIndex(values: number[], target: number): number {
  let best = 0
  let distance = Number.POSITIVE_INFINITY
  values.forEach((value, index) => {
    const next = Math.abs(value - target)
    if (next < distance) {
      best = index
      distance = next
    }
  })
  return best
}
