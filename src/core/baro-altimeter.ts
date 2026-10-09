import {
  BARO_EXP,
  BARO_HISTORY_MS,
  BARO_MEAN_WINDOW_MS,
  BARO_MEDIAN_WINDOW_MS,
  BARO_SPEED_WINDOW_MS,
  BARO_SPIKE_M,
  BARO_STALE_MS,
  P0_HPA,
} from './sensor-params'

/** 国际气压公式：气压（hPa）→ 标准大气海拔（米）。只用于求差，绝对值不代表真实海拔。 */
export function pressureToAltitudeM(pressureHpa: number): number {
  return 44330 * (1 - Math.pow(pressureHpa / P0_HPA, BARO_EXP))
}

export interface AltitudePoint {
  /** 气压事件自身的时间戳（毫秒，墙钟）。 */
  t: number
  /** 平滑后的标准大气海拔（米）。 */
  altM: number
}

export interface BaroReading {
  /** 是否有过至少一个有效气压事件。 */
  available: boolean
  /** 距离最近一次气压事件超过 BARO_STALE_MS：停更，不得参与判定。 */
  stale: boolean
  /** 最近一次气压事件的时间戳。 */
  lastEventAt: number
  /** 平滑海拔（米）。 */
  altM: number
  /** 垂直速度（米/秒，向上为正）；数据不足时为 undefined。 */
  speedMps?: number
}

function median(values: number[]): number {
  if (!values.length) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * 气压高度计：只消费“真实的气压事件 + 事件自身时间戳”。
 *
 * 旧实现把 latestPressure 粘到每个加速度样本上，用加速度的新时间戳重复推送，
 * 气压计停更时会出现“新时间戳 + 旧值”，让算法误以为高度静止（慢爬被判平地）。
 * 这里：
 * 1. 时间戳不递增的事件直接丢弃；
 * 2. 先取 1s 中位数（压尖峰），再做 3s 平均；
 * 3. 与中位数偏离过大的单点视为开门压力跳变，丢弃；
 * 4. 超过 BARO_STALE_MS 无新事件 → stale。
 */
export class BaroAltimeter {
  private raw: Array<{ t: number; altM: number }> = []
  private medians: Array<{ t: number; altM: number }> = []
  private smoothed: AltitudePoint[] = []
  /** 1s 中位数序列（滞后约 0.5s），用于给点击时刻取“无滞后”的高度。 */
  private medianHistory: AltitudePoint[] = []
  private lastEventAt = 0
  private events = 0
  private rejected = 0

  /** 送入一个气压事件。返回新的平滑点（被丢弃时返回 undefined）。 */
  push(t: number, pressureHpa: number): AltitudePoint | undefined {
    if (!Number.isFinite(t) || !Number.isFinite(pressureHpa) || pressureHpa < 300 || pressureHpa > 1200) return undefined
    if (this.events && t <= this.lastEventAt) return undefined
    const altM = pressureToAltitudeM(pressureHpa)
    // 长时间停更后重新开始窗口，避免把停更前后的点混在一个中位数里。
    if (this.events && t - this.lastEventAt > BARO_STALE_MS) {
      this.raw = []
      this.medians = []
    }
    const window = this.raw.filter(point => point.t >= t - BARO_MEDIAN_WINDOW_MS)
    if (window.length >= 3) {
      const center = median(window.map(point => point.altM))
      if (Math.abs(altM - center) > BARO_SPIKE_M) {
        this.rejected += 1
        // 连续被拒说明是真实的高度跳变（例如停更后恢复），重新建立窗口。
        if (this.rejected < 4) return undefined
        this.raw = []
        this.medians = []
      }
    }
    this.rejected = 0
    this.lastEventAt = t
    this.events += 1
    this.raw.push({ t, altM })
    while (this.raw.length && this.raw[0].t < t - BARO_MEDIAN_WINDOW_MS) this.raw.shift()
    const med = median(this.raw.map(point => point.altM))
    this.medians.push({ t, altM: med })
    this.medianHistory.push({ t, altM: med })
    while (this.medianHistory.length && this.medianHistory[0].t < t - BARO_HISTORY_MS) this.medianHistory.shift()
    while (this.medians.length && this.medians[0].t < t - BARO_MEAN_WINDOW_MS) this.medians.shift()
    const mean = this.medians.reduce((sum, point) => sum + point.altM, 0) / this.medians.length
    const point = { t, altM: mean }
    this.smoothed.push(point)
    while (this.smoothed.length && this.smoothed[0].t < t - BARO_HISTORY_MS) this.smoothed.shift()
    return point
  }

  isStale(now: number): boolean {
    return !this.events || now - this.lastEventAt > BARO_STALE_MS
  }

  get hasData(): boolean {
    return this.events > 0
  }

  read(now: number): BaroReading {
    const last = this.smoothed.at(-1)
    return {
      available: this.hasData,
      stale: this.isStale(now),
      lastEventAt: this.lastEventAt,
      altM: last?.altM ?? NaN,
      speedMps: this.isStale(now) ? undefined : this.speedAt(now),
    }
  }

  /** 对最近 4s 平滑高度做最小二乘线性回归，返回斜率（米/秒）。 */
  speedAt(now: number, windowMs = BARO_SPEED_WINDOW_MS): number | undefined {
    const points = this.smoothed.filter(point => point.t >= now - windowMs && point.t <= now)
    if (points.length < 4 || points.at(-1)!.t - points[0].t < windowMs * 0.5) return undefined
    const t0 = points[0].t
    let sx = 0, sy = 0, sxx = 0, sxy = 0
    for (const point of points) {
      const x = (point.t - t0) / 1000
      sx += x; sy += point.altM; sxx += x * x; sxy += x * point.altM
    }
    const n = points.length
    const denom = n * sxx - sx * sx
    return denom > 0 ? (n * sxy - sx * sy) / denom : undefined
  }

  /** 某时刻 ±window 内平滑高度的中位数（用于标定点、平台基线）。 */
  altitudeAround(t: number, windowMs: number): number | undefined {
    const values = this.smoothed.filter(point => Math.abs(point.t - t) <= windowMs).map(point => point.altM)
    return values.length ? median(values) : undefined
  }

  /**
   * 某时刻的高度（补偿滤波滞后）：1s 中位数序列约滞后 0.5s，
   * 取 [t − window/2 + 0.5s, t + window + 0.5s] 内的中位数，结果以 t 为中心。
   */
  altitudeCentered(t: number, windowMs: number): number | undefined {
    const values = this.medianHistory
      .filter(point => point.t >= t - windowMs + 500 && point.t <= t + windowMs + 500)
      .map(point => point.altM)
    return values.length ? median(values) : undefined
  }

  /** [from, to] 区间内平滑高度的中位数。 */
  altitudeBetween(from: number, to: number): number | undefined {
    const values = this.smoothed.filter(point => point.t >= from && point.t <= to).map(point => point.altM)
    return values.length ? median(values) : undefined
  }

  latest(): AltitudePoint | undefined {
    return this.smoothed.at(-1)
  }

  history(from = -Infinity): AltitudePoint[] {
    return this.smoothed.filter(point => point.t >= from)
  }
}
