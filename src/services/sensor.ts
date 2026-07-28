import { Accelerometer, Gyroscope, DeviceMotion } from 'expo-sensors'
import { SensorSample } from '../core/types'
import {
  PrivacyAuthorizeError,
  ensurePrivacyAuthorized,
  privacyAuthorizeErrorMessage,
} from './privacy'

export interface SensorStatus {
  running: boolean
  signal: 'waiting' | 'good' | 'interrupted' | 'unsupported'
  lastSampleAt: number
}

export interface SensorRecorderOptions {
  retainSamples?: boolean
  onSample?: (sample: SensorSample) => void
  onStatus?: (status: SensorStatus) => void
  onGap?: (gap: { startMs: number; endMs: number }) => void
}

type RequiredSensor = 'accelerometer' | 'gyroscope'

// expo-sensors 在 Android 12+ 上需要 HIGH_SAMPLING_RATE_SENSORS 权限才能拿到 game 级别
// 的采样率（约 50Hz）。低于此速率时退回 ui 级别（约 16Hz），对步态检测仍够用。
const UPDATE_INTERVAL_MS = 20

export class SensorStartError extends Error {
  readonly sensor: RequiredSensor | 'privacy'
  readonly api: string
  readonly detail: string

  constructor(sensor: RequiredSensor | 'privacy', api: string, detail: string) {
    super(`${api}: ${detail}`)
    this.name = 'SensorStartError'
    this.sensor = sensor
    this.api = api
    this.detail = detail
  }
}

export function sensorStartErrorMessage(error: unknown): string {
  if (error instanceof PrivacyAuthorizeError) {
    return privacyAuthorizeErrorMessage(error)
  }
  if (!(error instanceof SensorStartError)) {
    return '传感器启动失败，请保持应用在前台、不要锁屏后重试。'
  }
  if (error.sensor === 'privacy') {
    return privacyAuthorizeErrorMessage(
      new PrivacyAuthorizeError('requirePrivacyAuthorize', error.detail),
    )
  }
  const label = error.sensor === 'accelerometer' ? '加速度计' : '陀螺仪'
  const detail = error.detail.toLowerCase()
  if (detail.includes('timeout') || detail.includes('no data')) {
    return `${label}已经启动，但 2 秒内没有返回数据。请保持应用在前台、不要锁屏、轻微晃动手机后重试。`
  }
  if (
    detail.includes('auth deny') ||
    detail.includes('permission') ||
    detail.includes('authorize')
  ) {
    return `${label}权限被拒绝。请在手机系统设置 → 应用 → 爬楼 → 权限中允许「运动与健身/身体传感器」访问。`
  }
  if (
    detail.includes('not support') ||
    detail.includes('unsupported') ||
    detail.includes('not found')
  ) {
    return `当前手机不支持${label}，无法进行路线识别。请确认设备传感器正常后重试。`
  }
  if (detail.includes('unavailable') || detail.includes('busy')) {
    return `${label}采样频率冲突或被占用，请关闭其他使用传感器的 App 后重试。`
  }
  return `${label}启动失败（${error.api}）：${error.detail}。请保持应用在前台后重试。`
}

export class SensorRecorder {
  private options: SensorRecorderOptions
  private samples: SensorSample[] = []
  private latestGyro = { x: 0, y: 0, z: 0 }
  private latestMotion = { alpha: 0, beta: 0, gamma: 0 }
  private startedAt = 0
  private lastSampleAt = 0
  private gyroSampleAt = 0
  private watchdog?: ReturnType<typeof setInterval>
  private gapStartedAt?: number
  private running = false
  private accelSub?: { remove: () => void }
  private gyroSub?: { remove: () => void }
  private motionSub?: { remove: () => void }

  constructor(options: SensorRecorderOptions = {}) {
    this.options = options
  }

  async start(): Promise<void> {
    if (this.running) return
    // Android 上没有微信版的官方隐私弹窗，但保留入口，便于未来加权限请求。
    try {
      await ensurePrivacyAuthorized()
    } catch (error) {
      throw new SensorStartError(
        'privacy',
        'requirePrivacyAuthorize',
        error instanceof PrivacyAuthorizeError ? error.detail : String(error),
      )
    }
    this.samples = []
    this.startedAt = Date.now()
    this.lastSampleAt = 0
    this.gyroSampleAt = 0
    this.running = true

    // 先设置采样间隔，再订阅，避免首批数据按默认间隔到达。
    Accelerometer.setUpdateInterval(UPDATE_INTERVAL_MS)
    Gyroscope.setUpdateInterval(UPDATE_INTERVAL_MS)
    DeviceMotion.setUpdateInterval(UPDATE_INTERVAL_MS)

    try {
      this.accelSub = Accelerometer.addListener((value) => {
        const now = Date.now()
        if (this.gapStartedAt) {
          this.options.onGap?.({
            startMs: this.gapStartedAt - this.startedAt,
            endMs: now - this.startedAt,
          })
          this.gapStartedAt = undefined
        }
        const sample: SensorSample = {
          t: now,
          ax: Number(value.x) || 0,
          ay: Number(value.y) || 0,
          az: Number(value.z) || 0,
          gx: this.latestGyro.x,
          gy: this.latestGyro.y,
          gz: this.latestGyro.z,
          alpha: this.latestMotion.alpha,
          beta: this.latestMotion.beta,
          gamma: this.latestMotion.gamma,
        }
        if (this.options.retainSamples !== false) this.samples.push(sample)
        this.lastSampleAt = now
        this.options.onSample?.(sample)
      })

      this.gyroSub = Gyroscope.addListener((value) => {
        this.gyroSampleAt = Date.now()
        this.latestGyro = {
          x: Number(value.x) || 0,
          y: Number(value.y) || 0,
          z: Number(value.z) || 0,
        }
      })

      // DeviceMotion 为补充信息，识别目前只用加速度+陀螺仪 Z，缺失不应阻塞真机。
      try {
        this.motionSub = DeviceMotion.addListener((value) => {
          const o = value.orientation
          if (typeof o === 'number') {
            this.latestMotion = {
              alpha: o,
              beta: 0,
              gamma: 0,
            }
          }
        })
      } catch (error) {
        console.warn('[sensor] optional device motion unavailable', error)
      }

      await this.waitForRequiredSamples()
      this.emitStatus('waiting')
      this.watchdog = setInterval(() => this.checkSignal(), 350)
    } catch (error) {
      this.running = false
      await this.cleanup()
      this.emitStatus('unsupported')
      throw error
    }
  }

  async stop(): Promise<SensorSample[]> {
    if (!this.running) return this.samples
    this.running = false
    if (this.gapStartedAt) {
      this.options.onGap?.({
        startMs: this.gapStartedAt - this.startedAt,
        endMs: Date.now() - this.startedAt,
      })
      this.gapStartedAt = undefined
    }
    if (this.watchdog) clearInterval(this.watchdog)
    await this.cleanup()
    this.emitStatus('waiting')
    return this.samples
  }

  getSamples(): SensorSample[] {
    return this.samples
  }

  getStartedAt(): number {
    return this.startedAt
  }

  private checkSignal(): void {
    if (!this.running) return
    const now = Date.now()
    if (!this.lastSampleAt) {
      this.emitStatus('waiting')
      return
    }
    const interrupted = now - this.lastSampleAt > 1000
    if (interrupted && !this.gapStartedAt) this.gapStartedAt = this.lastSampleAt
    this.emitStatus(interrupted ? 'interrupted' : 'good')
  }

  private emitStatus(signal: SensorStatus['signal']): void {
    this.options.onStatus?.({
      running: this.running,
      signal,
      lastSampleAt: this.lastSampleAt,
    })
  }

  private waitForRequiredSamples(): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 2000
      const check = () => {
        if (!this.running) {
          reject(new SensorStartError('accelerometer', 'startAccelerometer', 'startup canceled'))
          return
        }
        if (this.lastSampleAt && this.gyroSampleAt) {
          resolve()
          return
        }
        if (Date.now() >= deadline) {
          const sensor: RequiredSensor = this.lastSampleAt ? 'gyroscope' : 'accelerometer'
          const api = sensor === 'accelerometer' ? 'startAccelerometer' : 'startGyroscope'
          reject(new SensorStartError(sensor, api, 'no data timeout'))
          return
        }
        setTimeout(check, 50)
      }
      check()
    })
  }

  private async cleanup(): Promise<void> {
    try {
      this.accelSub?.remove()
      this.gyroSub?.remove()
      this.motionSub?.remove()
    } catch (error) {
      console.warn('[sensor] cleanup failed', error)
    }
    this.accelSub = undefined
    this.gyroSub = undefined
    this.motionSub = undefined
  }
}
