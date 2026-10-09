import { BarometerStatus, ClimbMode, FeatureFrame, SensorSample } from '../core/types'

/**
 * 单轮识别流水线的 owner（D03）。
 *
 * 为什么单独抽出来：原实现把「传感器 + 特征泵 + 识别器」三件套的生命周期
 * 写在 React hook 里，`cleanupInternal()` 里的 `stop()` 既不 await 也不做
 * generation 校验。结果是：
 *   - 快速「结束 → 立刻开始」时，旧 recorder 的监听器清理与新 recorder 的启动
 *     重叠，旧回调可能写入新一轮；
 *   - 3 秒气压降级定时器在 stop 之后才触发，向已结束的轮次上报状态。
 *
 * 这层是零 React 依赖的纯 TS，因此可以在 Node 下用 fake adapter 精确复现上述交错。
 *
 * 不变量：
 * 1. `start()` 必然先等待上一轮 `stop()` 完成，两轮 owner 绝不重叠。
 * 2. 每次 start/stop 递增 generation；旧 generation 的 sample/gap/status/barometer
 *    回调一律丢弃。
 * 3. `stop()` 完成后（disposed）到达的任何回调同样被丢弃。
 * 4. `stop()` 幂等：并发/重复调用共享同一个 stop promise。
 */

export type Listener<T> = (value: T) => void

export interface AccelerometerPayload {
  timestamp?: number
  x: number
  y: number
  z: number
}

export interface GyroscopePayload {
  timestamp?: number
  x: number
  y: number
  z: number
}

export interface DeviceMotionPayload {
  rotation?: {
    alpha?: number
    beta?: number
    gamma?: number
  }
}

export interface BarometerPayload {
  pressure: number
  timestamp?: number
}

export interface SensorSubscription {
  remove: () => void
}

/** 传感器驱动抽象；默认实现见 `sensor-adapter.ts`。 */
export interface SensorAdapter {
  setAccelerometerInterval(ms: number): void
  setGyroscopeInterval(ms: number): void
  setDeviceMotionInterval(ms: number): void
  setBarometerInterval(ms: number): void
  subscribeAccelerometer(listener: Listener<AccelerometerPayload>): SensorSubscription
  subscribeGyroscope(listener: Listener<GyroscopePayload>): SensorSubscription
  subscribeDeviceMotion(listener: Listener<DeviceMotionPayload>): SensorSubscription
  subscribeBarometer(listener: Listener<BarometerPayload>): SensorSubscription
}

export interface SensorGap {
  startMs: number
  endMs: number
}

export type { FeatureFrame, SensorSample }

export interface SensorStatusLike {
  signal: 'waiting' | 'good' | 'interrupted' | 'unsupported'
}

/** recorder 的最小接口（由 SensorRecorder 实现）。 */
export interface SensorRecorderLike {
  start(): Promise<void>
  stop(): Promise<unknown>
  getStartedAt(): number
  getSamples(): SensorSample[]
}

export interface FeaturePumpLike {
  push(sample: SensorSample): void
}

/** 识别器接口；快照类型由使用方参数化（core 的 RecognitionSnapshot）。 */
export interface RecognitionLike<Snapshot = unknown> {
  pushFrame(frame: FeatureFrame): Snapshot
  pushBarometer(pressure: number): Snapshot
  pause(atMs: number): void
  resume(atMs: number): void
  /** 每轮结束时的最终结果；具体结构由 core 决定。 */
  finish(endedAt?: number, mode?: ClimbMode): unknown
}

export interface CoordinatorHandlers<Snapshot = unknown> {
  onSample?: (sample: SensorSample) => void
  onFrame?: (snapshot: Snapshot) => void
  onGap?: (gap: SensorGap) => void
  onStatus?: (status: SensorStatusLike) => void
  onBarometer?: (status: BarometerStatus) => void
  onBarometerPush?: (snapshot: Snapshot) => void
}

export interface CoordinatorDeps<Snapshot = unknown> {
  adapter: SensorAdapter
  /** 每轮新建 recorder；注入工厂以便测试控制生命周期。 */
  createRecorder: (adapter: SensorAdapter, emit: CoordinatorEmit) => SensorRecorderLike
  createRecognizer: () => RecognitionLike<Snapshot>
  createPump: (onFrame: (frame: FeatureFrame) => void) => FeaturePumpLike
  /** 仅用于诊断/测试断言；识别器由 createRecognizer 提供。 */
  templateName?: string
  mode: ClimbMode
  handlers?: CoordinatorHandlers<Snapshot>
}

export interface CoordinatorEmit {
  sample(sample: SensorSample): void
  gap(gap: SensorGap): void
  status(status: SensorStatusLike): void
  barometer(status: BarometerStatus): void
}

export class RoundRecognitionCoordinator<Snapshot = unknown> {
  private deps: CoordinatorDeps<Snapshot>
  private handlers: CoordinatorHandlers<Snapshot>

  private generation = 0
  private running = false
  private disposed = false
  private recorder?: SensorRecorderLike
  private recognizer?: RecognitionLike<Snapshot>
  private pump?: FeaturePumpLike
  private stopPromise?: Promise<unknown>
  private startPromise?: Promise<void>
  /** 第 N 个 owner 的序号，用于诊断与断言。 */
  private ownerId = 0

  constructor(deps: CoordinatorDeps<Snapshot>) {
    this.deps = deps
    this.handlers = deps.handlers ?? {}
    this.emit = this.makeEmit(0)
  }

  private emit: CoordinatorEmit

  // --- 测试/诊断用只读视图 ---
  getGeneration(): number {
    return this.generation
  }

  getOwnerId(): number {
    return this.ownerId
  }

  isRunning(): boolean {
    return this.running
  }

  getRecognizer(): RecognitionLike<Snapshot> | undefined {
    return this.recognizer
  }

  getRecorder(): SensorRecorderLike | undefined {
    return this.recorder
  }

  setHandlers(handlers: CoordinatorHandlers<Snapshot>): void {
    this.handlers = { ...this.handlers, ...handlers }
  }

  /** 回调是否属于当前 owner（generation 未失效且未 dispose）。 */
  isCurrent(): boolean {
    return this.running && !this.disposed
  }

  /**
   * 本轮专属的事件出口。
   *
   * 关键点：出口绑定创建它的 generation，而不是读 `this.generation`。
   * 因此即便旧一轮的 recorder 在 stop 尚未完成时又吐出一次回调，
   * 也不会被当成本轮事件（recorder 内部守卫之外的第二次防线）。
   */
  private makeEmit(generation: number): CoordinatorEmit {
    const active = (): boolean =>
      this.running && !this.disposed && this.generation === generation
    return {
      sample: (sample) => {
        if (!active()) return
        this.pump?.push(sample)
        this.handlers.onSample?.(sample)
      },
      gap: (gap) => {
        if (!active()) return
        this.handlers.onGap?.(gap)
      },
      status: (status) => {
        if (!active()) return
        this.handlers.onStatus?.(status)
      },
      barometer: (status) => {
        if (!active()) return
        this.handlers.onBarometer?.(status)
        if (status.available && status.pressure > 0 && this.recognizer) {
          this.handlers.onBarometerPush?.(
            this.recognizer.pushBarometer(status.pressure),
          )
        }
      },
    }
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = this.doStart().finally(() => {
      this.startPromise = undefined
    })
    return this.startPromise
  }

  private async doStart(): Promise<void> {
    // 1) 先等待上一轮真正停止：单 owner 的关键
    await this.stopRecorder()
    // 2) 建立新一轮 owner；generation 递增使旧回调立即失效
    this.generation += 1
    const generation = this.generation
    this.ownerId = generation
    this.disposed = false
    this.running = true
    // 本轮专属出口：旧 generation 的回调一律丢弃
    this.emit = this.makeEmit(generation)
    try {
      this.recognizer = this.deps.createRecognizer()
      this.pump = this.deps.createPump((frame) => {
        if (!this.isCurrent() || this.generation !== generation) return
        const recognizer = this.recognizer
        if (!recognizer) return
        this.handlers.onFrame?.(recognizer.pushFrame(frame))
      })
      this.recorder = this.deps.createRecorder(this.deps.adapter, this.emit)
      await this.recorder.start()
    } catch (error) {
      // 构造或启动失败：不得留下「running=true 但没有 owner」的半成品
      this.running = false
      this.disposed = true
      this.recognizer = undefined
      this.pump = undefined
      await this.stopRecorder()
      throw error
    }
    if (this.disposed) {
      // start 期间被 stop/卸载抢先：收尾，避免留下无人拥有的 recorder
      await this.stopRecorder()
    }
  }

  /** 幂等：并发/重复调用共享同一个 stop promise。 */
  async stop(): Promise<void> {
    if (!this.running && !this.recorder) {
      this.disposed = true
      return
    }
    this.disposed = true
    this.running = false
    this.pump = undefined
    await this.stopRecorder()
  }

  private stopRecorder(): Promise<unknown> {
    if (!this.stopPromise) {
      // 注意：必须在闭包里捕获当前 recorder。若在 finally 里读 this.recorder，
      // 而新一轮已经创建了自己的 recorder，就会停错对象（旧轮永不停止 → 双 owner）。
      const recorder = this.recorder
      this.recorder = undefined
      this.stopPromise = Promise.resolve(recorder ? recorder.stop() : undefined).finally(
        () => {
          this.stopPromise = undefined
        },
      )
    }
    return this.stopPromise
  }
}
