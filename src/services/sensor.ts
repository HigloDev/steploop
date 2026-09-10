import { Accelerometer, Gyroscope, DeviceMotion, Barometer } from 'expo-sensors'
import { BarometerStatus, SensorSample } from '../core/types'
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
  // 低功耗模式：仅订阅气压计，用于返回起点阶段辅助判断高度
  lowPowerMode?: boolean
  onSample?: (sample: SensorSample) => void
  onStatus?: (status: SensorStatus) => void
  onGap?: (gap: { startMs: number; endMs: number }) => void
  // 气压计状态回调：每次气压样本到达时触发，UI 据此显示气压/海拔/楼层变化
  onBarometer?: (status: BarometerStatus) => void
}

type RequiredSensor = 'accelerometer' | 'gyroscope'

// 目标 50Hz，低于 Android 12 对普通应用的 200Hz 上限，因此无需申请
// HIGH_SAMPLING_RATE_SENSORS；真实频率由诊断 V2 记录并作为样本质量门槛。
const UPDATE_INTERVAL_MS = 20
// 气压计采样间隔：气压变化慢，5Hz 足够，省电
const BAROMETER_INTERVAL_MS = 200

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
  private lowPowerMode: boolean
  private samples: SensorSample[] = []
  private latestGyro = { x: 0, y: 0, z: 0 }
  private latestMotion = { alpha: 0, beta: 0, gamma: 0 }
  private latestPressure: number | undefined  // 最新气压值（hPa）
  private barometerAvailable = false          // 设备是否支持气压计
  private barometerLastAt = 0                 // 上次气压样本时间戳
  private startedAt = 0
  private lastSampleAt = 0
  private gyroSampleAt = 0
  private watchdog?: ReturnType<typeof setInterval>
  private gapStartedAt?: number
  private running = false
  private accelSub?: { remove: () => void }
  private gyroSub?: { remove: () => void }
  private motionSub?: { remove: () => void }
  private baroSub?: { remove: () => void }

  constructor(options: SensorRecorderOptions = {}) {
    this.options = options
    this.lowPowerMode = options.lowPowerMode ?? false
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
    this.latestPressure = undefined
    this.barometerAvailable = false
    this.barometerLastAt = 0
    this.running = true

    try {
      if (!this.lowPowerMode) {
        // 正常模式：加速度 + 陀螺仪 + DeviceMotion + 气压计
        // 先设置采样间隔，再订阅，避免首批数据按默认间隔到达。
        Accelerometer.setUpdateInterval(UPDATE_INTERVAL_MS)
        Gyroscope.setUpdateInterval(UPDATE_INTERVAL_MS)
        DeviceMotion.setUpdateInterval(UPDATE_INTERVAL_MS)

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
            // 气压计若可用，把最新气压值附在样本上（可能 undefined）
            pressure: this.latestPressure,
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
            const rotation = value.rotation
            if (
              rotation &&
              Number.isFinite(rotation.alpha) &&
              Number.isFinite(rotation.beta) &&
              Number.isFinite(rotation.gamma)
            ) {
              this.latestMotion = {
                alpha: rotation.alpha,
                beta: rotation.beta,
                gamma: rotation.gamma,
              }
            }
          })
        } catch (error) {
          console.warn('[sensor] optional device motion unavailable', error)
        }
      }

      // 气压计订阅：可选传感器，缺失不阻塞主流程。两种模式都订阅。
      // 注意 expo-sensors 的 Barometer.isAvailableAsync() 在某些设备上行为不一致，
      // 这里采用「尝试订阅 + 失败降级」策略：3 秒内无样本视为不可用
      try {
        Barometer.setUpdateInterval(BAROMETER_INTERVAL_MS)
        this.baroSub = Barometer.addListener((value) => {
          // expo-sensors Barometer 返回 { pressure: number }（hPa）
          const pressure = Number(value.pressure)
          if (Number.isFinite(pressure) && pressure > 0) {
            this.latestPressure = pressure
            this.barometerAvailable = true
            this.barometerLastAt = Date.now()
            this.options.onBarometer?.({
              available: true,
              running: true,
              pressure,
              lastSampleAt: this.barometerLastAt,
            })
          }
        })
        // 3 秒后若仍未收到气压样本，标记为不可用并通知 UI
        setTimeout(() => {
          if (this.running && !this.barometerAvailable) {
            this.options.onBarometer?.({
              available: false,
              running: false,
              pressure: 0,
              lastSampleAt: 0,
            })
          }
        }, 3000)
      } catch (error) {
        console.warn('[sensor] barometer unavailable', error)
        this.barometerAvailable = false
        this.options.onBarometer?.({
          available: false,
          running: false,
          pressure: 0,
          lastSampleAt: 0,
        })
      }

      if (!this.lowPowerMode) {
        await this.waitForRequiredSamples()
        this.emitStatus('waiting')
        this.watchdog = setInterval(() => this.checkSignal(), 350)
      } else {
        // 低功耗模式无需等待加速度/陀螺仪样本，直接就绪
        this.emitStatus('good')
      }
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

  // 气压计是否可用（采集启动后才有意义）
  isBarometerAvailable(): boolean {
    return this.barometerAvailable
  }

  // 最新气压值（hPa），未启动或无气压计时为 undefined
  getLatestPressure(): number | undefined {
    return this.latestPressure
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
      this.baroSub?.remove()
    } catch (error) {
      console.warn('[sensor] cleanup failed', error)
    }
    this.accelSub = undefined
    this.gyroSub = undefined
    this.motionSub = undefined
    this.baroSub = undefined
  }
}
