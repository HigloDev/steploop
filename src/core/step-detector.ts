import {
  CADENCE_WINDOW_MS,
  STEP_FLOOR_RISE_MS,
  STEP_HIGH_RATIO,
  STEP_LOW_RATIO,
  STEP_MIN_HIGH_G,
  STEP_MIN_INTERVAL_MS,
  STEP_PEAK_DECAY_MS,
} from './sensor-params'

/**
 * 自适应阈值 + 迟滞计步器。
 *
 * 输入是“去重力后的加速度幅值包络”（单位 g，MotionSignalProcessor 的 smooth 值）。
 * - 峰值包络按 STEP_PEAK_DECAY_MS 指数衰减，底噪缓慢跟随信号；
 * - 高阈值 = max(下限, 底噪 + 0.5 × 动态范围)，信号上穿高阈值记一步；
 * - 必须先跌破低阈值（迟滞）才能记下一步，避免同一步的抖动被重复计数；
 * - 旧实现是固定 0.13g 阈值、无迟滞：轻踩的慢爬会漏步，用力的快爬会多计。
 */
export class AdaptiveStepDetector {
  private peak = 0
  private floor = 0
  private armed = true
  private lastAt?: number
  private lastStepAt = -Infinity
  private stepTimes: number[] = []

  /** 送入一个包络值，返回本次是否记一步。 */
  push(t: number, value: number): boolean {
    if (!Number.isFinite(t) || !Number.isFinite(value)) return false
    if (this.lastAt !== undefined && t <= this.lastAt) return false
    const dt = this.lastAt === undefined ? 20 : Math.min(500, t - this.lastAt)
    if (this.lastAt === undefined || t - this.lastAt > 1800) {
      // 长时间无数据：重新建立包络，避免沿用旧的峰值。
      this.peak = value
      this.floor = value
      this.armed = true
    }
    this.lastAt = t
    this.peak = Math.max(value, this.peak * Math.exp(-dt / STEP_PEAK_DECAY_MS))
    if (value < this.floor) this.floor = value
    else this.floor += (value - this.floor) * Math.min(1, dt / STEP_FLOOR_RISE_MS)
    const range = Math.max(0, this.peak - this.floor)
    const high = Math.max(STEP_MIN_HIGH_G, this.floor + STEP_HIGH_RATIO * range)
    const low = Math.min(high * 0.75, this.floor + STEP_LOW_RATIO * range)
    if (!this.armed) {
      if (value <= low) this.armed = true
      return false
    }
    if (value >= high && t - this.lastStepAt >= STEP_MIN_INTERVAL_MS) {
      this.armed = false
      this.lastStepAt = t
      this.stepTimes.push(t)
      while (this.stepTimes.length && this.stepTimes[0] < t - CADENCE_WINDOW_MS) this.stepTimes.shift()
      return true
    }
    return false
  }

  /** 步频（步/分钟）：用窗口内真实步间隔的中位数计算；不足两步返回 0。 */
  cadenceAt(t: number): number {
    const times = this.stepTimes.filter(time => time >= t - CADENCE_WINDOW_MS)
    if (times.length < 2) return 0
    const intervals = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b)
    const median = intervals[Math.floor(intervals.length / 2)]
    return median > 0 ? Math.min(240, 60000 / median) : 0
  }

  reset(): void {
    this.peak = 0
    this.floor = 0
    this.armed = true
    this.lastAt = undefined
    this.lastStepAt = -Infinity
    this.stepTimes = []
  }
}
