import { clamp } from './math'

function vectorDistance(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length)
  if (!length) return 1
  let sum = 0
  for (let index = 0; index < length; index += 1) {
    const weight = index === 2 ? 1.4 : 1
    sum += weight * (a[index] - b[index]) ** 2
  }
  return Math.sqrt(sum / length)
}

export function dtwDistance(
  observed: number[][],
  template: number[][],
  windowRatio = 0.45,
): number {
  if (!observed.length || !template.length) return Number.POSITIVE_INFINITY
  const n = observed.length
  const m = template.length
  const window = Math.max(Math.abs(n - m), Math.ceil(Math.max(n, m) * windowRatio))
  const previous = new Array<number>(m + 1).fill(Number.POSITIVE_INFINITY)
  previous[0] = 0

  for (let i = 1; i <= n; i += 1) {
    const current = new Array<number>(m + 1).fill(Number.POSITIVE_INFINITY)
    const from = Math.max(1, i - window)
    const to = Math.min(m, i + window)
    for (let j = from; j <= to; j += 1) {
      const cost = vectorDistance(observed[i - 1], template[j - 1])
      current[j] = cost + Math.min(current[j - 1], previous[j], previous[j - 1])
    }
    for (let j = 0; j <= m; j += 1) previous[j] = current[j]
  }
  return previous[m] / (n + m)
}

export function dtwConfidence(observed: number[][], template: number[][]): number {
  const distance = dtwDistance(observed, template)
  if (!Number.isFinite(distance)) return 0
  const lengthRatio =
    Math.min(observed.length, template.length) / Math.max(observed.length, template.length)
  return clamp(Math.exp(-distance * 3.8) * (0.7 + 0.3 * lengthRatio), 0, 1)
}
