import { METERS_PER_HPA } from './sensor-params'

export type PressureDirection = 'up' | 'down' | 'level' | 'unknown'
export interface PressureTrendSnapshot {
  direction: PressureDirection
  reliable: boolean
  relativeHeightM: number
  speedMps: number
  changedAt: number
  reason: 'collecting' | 'continuous' | 'noisy_trend' | 'pressure_jump' | 'stale'
}

const TREND_WINDOW_MS = 12000
/** 判定 level 需要的最短观察跨度：不足时宁可 unknown，也不报 level。 */
const LEVEL_MIN_SPAN_MS = 9000
const LEVEL_MAX_CHANGE_M = 0.25
const DIRECTION_MIN_SPEED_MPS = 0.03

function slopeMps(points: Array<{ t: number; pressure: number }>): number {
  const t0 = points[0].t
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (const point of points) {
    const x = (point.t - t0) / 1000
    const y = -point.pressure * METERS_PER_HPA
    sx += x; sy += y; sxx += x * x; sxy += x * y
  }
  const n = points.length
  const denom = n * sxx - sx * sx
  return denom > 0 ? (n * sxy - sx * sy) / denom : 0
}

/** Relative pressure is context, never a floor counter or an endpoint requirement. */
export class PressureTrend {
  private points: Array<{ t: number; pressure: number }> = []
  private history: Array<{ t: number; pressure: number }> = []
  private baseline?: number
  private last?: { t: number; pressure: number }
  private blockedUntil = -Infinity
  private reason: PressureTrendSnapshot['reason'] = 'collecting'

  push(pressure: number, t: number): PressureTrendSnapshot {
    if (!Number.isFinite(pressure) || pressure <= 0 || !Number.isFinite(t)) return this.snapshot(t)
    if (this.last && t <= this.last.t) return this.snapshot(t)
    const previous = this.last
    this.last = { t, pressure }
    if (previous && t - previous.t > 1800) this.gap()
    this.history.push({ t, pressure })
    this.history = this.history.filter(point => point.t >= t - 12000)
    // A sudden offset is not sustained vertical travel. Start a fresh local window;
    // retain the display offset, rather than carrying the jump into later decisions.
    if (previous && t - previous.t <= 500 && Math.abs(pressure - previous.pressure) > 0.18) {
      if (this.baseline !== undefined) this.baseline += pressure - previous.pressure
      this.points = []
      this.blockedUntil = t + 2500
      this.reason = 'pressure_jump'
    }
    this.baseline ??= pressure
    this.points.push({ t, pressure })
    // 旧实现只看 ~4.5s 窗口、|Δh|<0.3m 判 level：0.06 m/s 的慢爬 4.5s 只上升 0.27m，
    // 会被误判为平地，识别器因此丢帧甚至清空进度。改为 12s 窗口 + 回归斜率累计判定。
    this.points = this.points.filter(point => point.t >= t - TREND_WINDOW_MS)
    return this.snapshot(t)
  }

  gap(): void {
    this.points = []
    this.history = []
    this.reason = 'collecting'
  }

  /** Four successive local medians must agree; a single offset or a noisy flat
   * trace cannot establish sustained direction. This is only fallback context. */
  private sustainedDirection(): 'up' | 'down' | undefined {
    const last = this.last
    if (!last || !this.history.length || last.t - this.history[0].t < 11500) return undefined
    const medians: number[] = []
    for (let index = 0; index < 4; index++) {
      const start = last.t - 12000 + index * 3000
      const points = this.history.filter(point => point.t > start && point.t <= start + 3000)
      if (points.length < 5 || points.at(-1)!.t - points[0].t < 2200) return undefined
      const pressures = points.map(point => point.pressure).sort((a, b) => a - b)
      medians.push(pressures[Math.floor(pressures.length / 2)])
    }
    const changes = medians.slice(1).map((pressure, index) => (medians[index] - pressure) * METERS_PER_HPA)
    if (changes.every(change => change > 0.24)) return 'up'
    if (changes.every(change => change < -0.24)) return 'down'
    return undefined
  }

  snapshot(t: number): PressureTrendSnapshot {
    const last = this.last
    const empty: PressureTrendSnapshot = { direction: 'unknown', reliable: false, relativeHeightM: 0,
      speedMps: 0, changedAt: last?.t ?? 0, reason: this.reason }
    if (!last || !Number.isFinite(t)) return empty
    const recent = this.points.slice(-5).map(point => point.pressure).sort((a, b) => a - b)
    const current = recent[Math.floor(recent.length / 2)] ?? last.pressure
    const relativeHeightM = ((this.baseline ?? current) - current) * METERS_PER_HPA
    if (t - last.t > 1800) return { ...empty, relativeHeightM, reason: 'stale' }
    const first = this.points[0]
    const span = first ? last.t - first.t : 0
    if (t < this.blockedUntil || span < 2200 || this.points.length < 5) {
      const sustained = this.sustainedDirection()
      return sustained ? { ...empty, relativeHeightM, direction: sustained, reliable: true, reason: 'noisy_trend' }
        : { ...empty, relativeHeightM }
    }
    const early = this.points.slice(0, 5).map(point => point.pressure).sort((a, b) => a - b)
    const initial = early[Math.floor(early.length / 2)]
    const changeM = (initial - current) * METERS_PER_HPA
    const speedMps = slopeMps(this.points)
    // 累计判定：只有足够长的跨度内累计变化很小才是 level；跨度不足时按斜率给方向或 unknown。
    let direction: PressureDirection
    if (speedMps > DIRECTION_MIN_SPEED_MPS && changeM > 0.15) direction = 'up'
    else if (speedMps < -DIRECTION_MIN_SPEED_MPS && changeM < -0.15) direction = 'down'
    else if (span >= LEVEL_MIN_SPAN_MS && Math.abs(changeM) < LEVEL_MAX_CHANGE_M) direction = 'level'
    // 短跨度只在斜率几乎为零、累计变化也很小时才判 level（0.06 m/s 慢爬 3s 已上升 0.18m，不会被误判）。
    else if (Math.abs(speedMps) < 0.02 && Math.abs(changeM) < 0.12) direction = 'level'
    else direction = 'unknown'
    return { direction, reliable: true, relativeHeightM, speedMps, changedAt: last.t, reason: 'continuous' }
  }
}
