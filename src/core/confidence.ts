import { clamp } from './math'

export interface ConfidenceEvidence {
  motion?: number
  turn?: number
  dtw?: number
  baro?: number
}

const WEIGHTS: Record<keyof ConfidenceEvidence, number> = {
  motion: 0.32,
  turn: 0.28,
  dtw: 0.25,
  baro: 0.15,
}

// 无气压路径略保守：几何均值后轻微折扣，避免单靠动作证据冲到过高置信度。
const NO_BARO_DISCOUNT = 0.97
const EPS = 1e-6

export const FUSED_STABLE_WITH_BARO = 0.8
export const FUSED_STABLE_NO_BARO = 0.86

export function fuseConfidence(evidence: ConfidenceEvidence): number {
  let weightSum = 0
  let weightedLog = 0
  const entries: Array<[keyof ConfidenceEvidence, number | undefined]> = [
    ['motion', evidence.motion],
    ['turn', evidence.turn],
    ['dtw', evidence.dtw],
    ['baro', evidence.baro],
  ]
  for (const [key, value] of entries) {
    if (value === undefined || !Number.isFinite(value)) continue
    const w = WEIGHTS[key]
    weightSum += w
    weightedLog += w * Math.log(clamp(value, EPS, 1))
  }
  if (weightSum <= 0) return 0
  const fused = Math.exp(weightedLog / weightSum)
  const discounted = evidence.baro === undefined ? fused * NO_BARO_DISCOUNT : fused
  return clamp(discounted, 0, 1)
}

export function fusedQuality(
  fused: number,
  hasBarometer: boolean,
  interrupted: boolean,
): 'stable' | 'degraded' {
  if (interrupted) return 'degraded'
  const threshold = hasBarometer ? FUSED_STABLE_WITH_BARO : FUSED_STABLE_NO_BARO
  return fused >= threshold ? 'stable' : 'degraded'
}
