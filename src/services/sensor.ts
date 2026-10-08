import { BarometerStatus, SensorSample } from '../core/types'
import {
  PrivacyAuthorizeError,
  ensurePrivacyAuthorized,
  privacyAuthorizeErrorMessage,
} from './privacy'
import {
  SensorAdapter,
  SensorStatusLike,
  SensorSubscription,
} from './round-coordinator'
import { expoSensorAdapter } from './sensor-adapter'
import { TypedEmitter } from './typed-emitter'
import {
  BackgroundTrainingSample,
  drainBackgroundSamples,
  getBackgroundTrainingStatus,
  isBackgroundTrainingSupported,
  subscribeBackgroundSamples,
} from './background-training'

export interface SensorStatus {
  running: boolean
  signal: 'waiting' | 'good' | 'interrupted' | 'unsupported'
  lastSampleAt: number
}

export interface SensorRecorderOptions {
  retainSamples?: boolean
  keepRunningInBackground?: boolean
  // 低功耗模式：仅订阅气压计，用于返回起点阶段辅助判断高度
  lowPowerMode?: boolean
  onSample?: (sample: SensorSample) => void
  onStatus?: (status: SensorStatus) => void
  onGap?: (gap: { startMs: number; endMs: number }) => void
  // 气压计状态回调：每次气压样本到达时触发，UI 据此显示气压/海拔/楼层变化
  onBarometer?: (status: BarometerStatus) => void
  /** 传感器驱动；默认走 expo-sensors，测试可注入 fake。 */
  adapter?: SensorAdapter
}

/** recorder 向外发出的事件（供 RoundRecognitionCoordinator 消费）。 */
export interface SensorRecorderEvents extends Record<string, unknown> {
  sample: SensorSample
  gap: { startMs: number; endMs: number }
  status: SensorStatusLike
  barometer: BarometerStatus
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
    return `${label}权限被拒绝。请在手机系统设置 → 应用 → 循阶 → 权限中允许传感器访问后重试。`
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
  private adapter: SensorAdapter
  private lowPowerMode: boolean
  private emitter = new TypedEmitter<SensorRecorderEvents>()
  private generation = 0
  private currentGeneration = 0
  private barometerTimeout?: ReturnType<typeof setTimeout>
  private unremovedSubscriptions: SensorSubscription[] = []
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
  private accelSub?: SensorSubscription
  private gyroSub?: SensorSubscription
  private motionSub?: SensorSubscription
  private baroSub?: SensorSubscription
  private nativeSub?: SensorSubscription
  private nativePoll?: ReturnType<typeof setInterval>
  private lastRetainedAt = 0

  constructor(options: SensorRecorderOptions = {}) {
    this.options = options
    this.lowPowerMode = options.lowPowerMode ?? false
    this.adapter = options.adapter ?? expoSensorAdapter
  }

  /**
   * 订阅 recorder 事件。coordinator 用它在每轮 generation 变化后丢弃旧回调。
   * 保留 onSample/onStatus/... 选项是为了兼容既有调用点。
   */
  on<K extends keyof SensorRecorderEvents>(
    event: K,
    listener: (value: SensorRecorderEvents[K]) => void,
  ): this {
    this.emitter.on(event, listener)
    return this
  }

  /** 当前采样代次；每次 start 递增，用于断言旧回调被隔离。 */
  getGeneration(): number {
    return this.generation
  }

  async start(): Promise<void> {
    if (this.running) return
    // Own cancellation before the first async boundary. stop() must invalidate a
    // pending privacy/status read as well as an already subscribed recorder.
    const generation = ++this.generation
    this.currentGeneration = generation
    // Android 上没有微信版的官方隐私弹窗，但保留入口，便于未来加权限请求。
    try {
      await ensurePrivacyAuthorized()
    } catch (error) {
      if (generation !== this.generation) return
      throw new SensorStartError(
        'privacy',
        'requirePrivacyAuthorize',
        error instanceof PrivacyAuthorizeError ? error.detail : String(error),
      )
    }
    if (generation !== this.generation) return
    this.samples = []
    this.lastRetainedAt = 0
    this.startedAt = Date.now()
    this.lastSampleAt = 0
    this.gyroSampleAt = 0
    this.latestPressure = undefined
    this.barometerAvailable = false
    this.barometerLastAt = 0
    this.running = true
    this.currentGeneration = generation

    try {
      if (this.options.keepRunningInBackground && isBackgroundTrainingSupported()) {
        const nativeStatus = await getBackgroundTrainingStatus()
        if (!this.isActiveGeneration(generation)) return
        if (nativeStatus.running) {
          await this.startNativeCapture(generation, nativeStatus.sessionId, nativeStatus.latestSequence)
          return
        }
      }
      if (!this.lowPowerMode) {
        // 正常模式：加速度 + 陀螺仪 + DeviceMotion + 气压计
        // 先设置采样间隔，再订阅，避免首批数据按默认间隔到达。
        this.adapter.setAccelerometerInterval(UPDATE_INTERVAL_MS)
        this.adapter.setGyroscopeInterval(UPDATE_INTERVAL_MS)
        this.adapter.setDeviceMotionInterval(UPDATE_INTERVAL_MS)

        this.accelSub = this.adapter.subscribeAccelerometer((value) => {
          if (!this.isActiveGeneration(generation)) return
          const now = Date.now()
          if (this.gapStartedAt) {
            this.emitGap({
              startMs: this.gapStartedAt - this.startedAt,
              endMs: now - this.startedAt,
            })
            this.gapStartedAt = undefined
          }
          const sample: SensorSample = {
            t: now,
            ax: value.x,
            ay: value.y,
            az: value.z,
            gx: this.latestGyro.x,
            gy: this.latestGyro.y,
            gz: this.latestGyro.z,
            alpha: this.latestMotion.alpha,
            beta: this.latestMotion.beta,
            gamma: this.latestMotion.gamma,
            // 气压计若可用，把最新气压值附在样本上（可能 undefined）
            pressure: this.latestPressure,
          }
          this.retainSample(sample)
          this.lastSampleAt = now
          this.options.onSample?.(sample)
          this.emitter.emit('sample', sample)
        })

        this.gyroSub = this.adapter.subscribeGyroscope((value) => {
          if (!this.isActiveGeneration(generation)) return
          this.gyroSampleAt = Date.now()
          this.latestGyro = { x: value.x, y: value.y, z: value.z }
        })

        // DeviceMotion 为补充信息，识别目前只用加速度+陀螺仪 Z，缺失不应阻塞真机。
        try {
          this.motionSub = this.adapter.subscribeDeviceMotion((value) => {
            if (!this.isActiveGeneration(generation)) return
            const rotation = value.rotation
            if (
              rotation &&
              Number.isFinite(rotation.alpha) &&
              Number.isFinite(rotation.beta) &&
              Number.isFinite(rotation.gamma)
            ) {
              // 上面已用 Number.isFinite 收窄，但可选属性类型仍是 number | undefined
              this.latestMotion = {
                alpha: rotation.alpha as number,
                beta: rotation.beta as number,
                gamma: rotation.gamma as number,
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
        this.adapter.setBarometerInterval(BAROMETER_INTERVAL_MS)
        this.baroSub = this.adapter.subscribeBarometer((value) => {
          if (!this.isActiveGeneration(generation)) return
          const pressure = value.pressure
          if (Number.isFinite(pressure) && pressure > 0) {
            this.latestPressure = pressure
            this.barometerAvailable = true
            this.barometerLastAt = Date.now()
            this.emitBarometer({
              available: true,
              running: true,
              pressure,
              lastSampleAt: this.barometerLastAt,
            })
          }
        })
        // 3 秒后若仍未收到气压样本，标记为不可用并通知 UI。
        // 定时器受 generation 保护：stop 之后触发不会再向已结束的轮次上报。
        this.barometerTimeout = setTimeout(() => {
          if (
            this.isActiveGeneration(generation) &&
            this.running &&
            !this.barometerAvailable
          ) {
            this.emitBarometer({
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
        this.emitBarometer({
          available: false,
          running: false,
          pressure: 0,
          lastSampleAt: 0,
        })
      }

      if (!this.lowPowerMode) {
        await this.waitForRequiredSamples(generation)
        if (!this.isActiveGeneration(generation)) return
        this.emitStatus('waiting')
        this.watchdog = setInterval(() => this.checkSignal(), 350)
      } else {
        // 低功耗模式无需等待加速度/陀螺仪样本，直接就绪
        this.emitStatus('good')
      }
    } catch (error) {
      // A cancelled old start cannot clean up a newer generation or emit failure
      // into its status stream. stop() already owns cleanup for the cancelled one.
      if (generation !== this.generation) return
      this.running = false
      await this.cleanup()
      this.emitStatus('unsupported')
      throw error
    }
  }

  /** Native journal is authoritative during a bridge pause; replay uses the original timestamps. */
  private async startNativeCapture(generation: number, sessionId: string, initialSequence: number): Promise<void> {
    let lastSequence = initialSequence
    let replaying = false
    let closed = false
    const pending: BackgroundTrainingSample[] = []
    const deliver = (sample: BackgroundTrainingSample) => {
      if (!this.isActiveGeneration(generation) || sample.sessionId !== sessionId || sample.seq <= lastSequence) return
      lastSequence = sample.seq
      if (sample.t < this.startedAt) return
      // Native acquisition time, rather than delayed JS delivery, decides whether
      // an interruption is real. Fresh acquisition closes the watchdog's pending
      // marker; only a measured timestamp gap below is retained. Otherwise stop()
      // would extend an already recovered gap or invent one after continuous replay.
      if (sample.t > this.lastSampleAt) this.gapStartedAt = undefined
      if (this.lastSampleAt > 0 && sample.t - this.lastSampleAt > 1500) {
        this.emitGap({ startMs: this.lastSampleAt - this.startedAt, endMs: sample.t - this.startedAt })
      }
      this.lastSampleAt = sample.t
      this.gyroSampleAt = sample.t
      this.latestGyro = { x: sample.gx, y: sample.gy, z: sample.gz }
      if (sample.pressure !== undefined && sample.pressure > 0 && Number.isFinite(sample.pressure)) {
        this.latestPressure = sample.pressure
        this.barometerAvailable = true
        if (sample.t - this.barometerLastAt >= BAROMETER_INTERVAL_MS) {
          this.barometerLastAt = sample.t
          this.emitBarometer({ available: true, running: true, pressure: sample.pressure, lastSampleAt: sample.t })
        }
      }
      this.retainSample(sample)
      this.options.onSample?.(sample)
      this.emitter.emit('sample', sample)
    }
    const replay = async () => {
      if (replaying || closed || !this.isActiveGeneration(generation)) return
      replaying = true
      try {
        while (!closed && this.isActiveGeneration(generation)) {
          const page = await drainBackgroundSamples(lastSequence, 2000)
          if (page.sessionId !== sessionId) break
          for (const sample of page.samples) deliver(sample)
          if (page.samples.length < 2000 || lastSequence >= page.latestSequence) break
        }
      } catch (error) {
        console.warn('[sensor] native replay failed', error)
        if (this.isActiveGeneration(generation)) this.emitStatus('interrupted')
      } finally {
        replaying = false
        const ordered = pending.splice(0).sort((a, b) => a.seq - b.seq)
        for (const sample of ordered) deliver(sample)
      }
    }
    this.nativeSub = subscribeBackgroundSamples(sample => {
      if (closed || !this.isActiveGeneration(generation)) return
      if (replaying) { pending.push(sample); return }
      if (sample.seq > lastSequence + 1) { pending.push(sample); void replay(); return }
      deliver(sample)
    })
    const subscription = this.nativeSub
    this.nativeSub = { remove: () => { closed = true; pending.length = 0; subscription.remove() } }
    this.nativePoll = setInterval(() => { void replay(); this.checkSignal() }, 500)
    await replay()
    if (!this.isActiveGeneration(generation)) return
    await this.waitForRequiredSamples(generation)
    if (!this.isActiveGeneration(generation)) return
    this.emitStatus('good')
  }

  private retainSample(sample: SensorSample): void {
    if (this.options.retainSamples === false) return
    if (this.options.keepRunningInBackground && sample.t - this.lastRetainedAt < 100) return
    this.lastRetainedAt = sample.t
    this.samples.push(sample)
    // The complete analysis trace is streamed separately; the in-memory learning window is bounded.
    if (this.options.keepRunningInBackground && this.samples.length > 36000) this.samples.splice(0, 1000)
  }

  async stop(): Promise<SensorSample[]> {
    // Also cancel start() while it is awaiting privacy/native status and has no
    // subscriptions yet. A later resolution must not create a new live owner.
    this.generation += 1
    if (!this.running) {
      // 已停止：仍需保证监听器被移除（例如 start 失败后的收尾重试）
      await this.cleanup()
      return this.samples
    }
    this.running = false
    if (this.barometerTimeout) {
      clearTimeout(this.barometerTimeout)
      this.barometerTimeout = undefined
    }
    if (this.gapStartedAt) {
      this.emitGap({
        startMs: this.gapStartedAt - this.startedAt,
        endMs: Date.now() - this.startedAt,
      })
      this.gapStartedAt = undefined
    }
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = undefined
    // 等待监听器真正移除后再返回：调用方（coordinator）据此避免与新 recorder 重叠
    const stillUnremoved = await this.cleanup()
    if (stillUnremoved.length) {
      // 明确暴露，不假装清理成功
      console.error(
        `[sensor] ${stillUnremoved.length} 个监听器两次移除失败，已在下一次 stop 重试`,
      )
    }
    this.emitStatus('waiting')
    return this.samples
  }

  /** 当前代次是否有效（running 且 generation 未被 stop/新 start 取代）。 */
  private isActiveGeneration(generation: number): boolean {
    return this.running && this.currentGeneration === generation && this.generation === generation
  }

  private emitGap(gap: { startMs: number; endMs: number }): void {
    this.options.onGap?.(gap)
    this.emitter.emit('gap', gap)
  }

  private emitBarometer(status: BarometerStatus): void {
    this.options.onBarometer?.(status)
    this.emitter.emit('barometer', status)
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
    const status: SensorStatus = {
      running: this.running,
      signal,
      lastSampleAt: this.lastSampleAt,
    }
    this.options.onStatus?.(status)
    this.emitter.emit('status', status)
  }

  private waitForRequiredSamples(generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 2000
      const check = () => {
        if (!this.isActiveGeneration(generation)) {
          resolve()
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

  /**
   * 移除全部原生监听器。
   *
   * 三个要求：
   * 1. 每个订阅独立 try/catch —— 一个传感器移除失败不得让其余监听器泄漏；
   * 2. 失败的订阅先记下来，其余清理完成后重试一次（异步 native 移除常是瞬时的）；
   * 3. 重试后仍失败则把订阅对象转交 `unremovedSubscriptions`，由上层（coordinator）
   *    继续持有并再次清理，绝不静默丢弃。
   */
  private async cleanup(): Promise<SensorSubscription[]> {
    if (this.nativePoll) clearInterval(this.nativePoll)
    this.nativePoll = undefined
    const pending = this.unremovedSubscriptions.splice(
      0,
      this.unremovedSubscriptions.length,
    )
    const subs: Array<[string, SensorSubscription | undefined]> = [
      ['accelerometer', this.accelSub],
      ['gyroscope', this.gyroSub],
      ['deviceMotion', this.motionSub],
      ['barometer', this.baroSub],
      ['nativeTraining', this.nativeSub],
      ...pending.map((sub, index) => [`pending-${index}`, sub] as [string, SensorSubscription]),
    ]
    this.accelSub = undefined
    this.gyroSub = undefined
    this.motionSub = undefined
    this.baroSub = undefined
    this.nativeSub = undefined
    const failures: string[] = []
    const retry: Array<[string, SensorSubscription]> = []
    for (const [name, sub] of subs) {
      if (!sub) continue
      try {
        sub.remove()
      } catch (error) {
        retry.push([name, sub])
        failures.push(
          `${name}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    const stillUnremoved: SensorSubscription[] = []
    if (retry.length) {
      console.warn(`[sensor] cleanup failed for ${failures.join('; ')}（重试一次）`)
      await Promise.resolve()
      for (const [name, sub] of retry) {
        try {
          sub.remove()
        } catch (error) {
          stillUnremoved.push(sub)
          console.warn(
            `[sensor] ${name} listener remove failed twice: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      }
    }
    this.unremovedSubscriptions.push(...stillUnremoved)
    return stillUnremoved
  }

  /** 两次尝试后仍未能移除的订阅；下一次 stop 会再次尝试。 */
  getUnremovedSubscriptions(): readonly SensorSubscription[] {
    return this.unremovedSubscriptions
  }
}
