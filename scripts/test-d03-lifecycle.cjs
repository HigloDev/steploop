// D03：单轮识别生命周期（单 owner / generation 隔离 / await 清理 / 卸载后无副作用）。
//
// 这里测的是真实链路：RoundRecognitionCoordinator + 真实 SensorRecorder，
// 只把 expo-sensors 驱动换成 fake adapter、把隐私门换成已同意。
// 因此「旧一轮回调不得写入新一轮」不是靠 mock 断言，而是靠真实 generation 逻辑证明。
//
// 运行：npm run test:d03

const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')

const servicesRoot =
  process.argv[2] ||
  path.join(__dirname, '..', 'node_modules', '.cache', 'steploop-services')

// --- 让隐私门直接通过（SensorRecorder.start 会调用它） ---
const originalLoad = Module._load
const stubModules = new Map([
  [
    path.join(servicesRoot, 'services', 'privacy.js'),
    {
      PrivacyAuthorizeError: class extends Error {},
      ensurePrivacyAuthorized: async () => undefined,
      privacyAuthorizeErrorMessage: () => '',
    },
  ],
  ['expo-sensors', {}],
  // Native background capture is unavailable in these foreground lifecycle tests.
  // Keep SensorRecorder and its adapter real; only the RN host is represented here.
  ['react-native', { NativeModules: {}, Platform: { OS: 'android', Version: 36 } }],
])
Module._load = function (request, parent, isMain) {
  if (stubModules.has(request)) return stubModules.get(request)
  const resolved = (() => {
    try {
      return Module._resolveFilename(request, parent, isMain)
    } catch {
      return null
    }
  })()
  if (resolved && stubModules.has(resolved)) return stubModules.get(resolved)
  return originalLoad.apply(this, arguments)
}

const { RoundRecognitionCoordinator } = require(path.join(
  servicesRoot,
  'services',
  'round-coordinator.js',
))
const { SensorRecorder } = require(path.join(servicesRoot, 'services', 'sensor.js'))

// --- fake 传感器驱动 ---
function createFakeAdapter() {
  const state = {
    subscriptions: [],
    intervals: [],
  }
  const make = (name) => (listener) => {
    const sub = {
      name,
      listener,
      removed: false,
      remove() {
        if (this.removed) {
          throw new Error(`double remove: ${name}`)
        }
        this.removed = true
      },
    }
    state.subscriptions.push(sub)
    return sub
  }
  state.adapter = {
    setAccelerometerInterval: (ms) => state.intervals.push(['accel', ms]),
    setGyroscopeInterval: (ms) => state.intervals.push(['gyro', ms]),
    setDeviceMotionInterval: (ms) => state.intervals.push(['motion', ms]),
    setBarometerInterval: (ms) => state.intervals.push(['baro', ms]),
    subscribeAccelerometer: make('accelerometer'),
    subscribeGyroscope: make('gyroscope'),
    subscribeDeviceMotion: make('deviceMotion'),
    subscribeBarometer: make('barometer'),
  }
  state.active = () => state.subscriptions.filter((s) => !s.removed)
  state.emitAccel = (payload) => {
    for (const sub of state.subscriptions) {
      if (sub.name === 'accelerometer' && !sub.removed) sub.listener(payload)
    }
  }
  state.emitBaro = (payload) => {
    for (const sub of state.subscriptions) {
      if (sub.name === 'barometer' && !sub.removed) sub.listener(payload)
    }
  }
  return state
}

function createFakeRecognizer() {
  const frames = []
  const barometers = []
  return {
    frames,
    barometers,
    pushFrame: (frame) => {
      frames.push(frame)
      return { currentFloor: 1 + frames.length, status: 'matching' }
    },
    pushBarometer: (pressure) => {
      barometers.push(pressure)
      return { currentFloor: 1, status: 'matching' }
    },
    pause: () => undefined,
    resume: () => undefined,
    finish: () => ({ id: 'session' }),
  }
}

const TEMPLATE = { startFloor: 1, name: 'test-route' }

/** 组装一个使用真实 SensorRecorder 的 coordinator。 */
function createHarness(options = {}) {
  const adapterState = createFakeAdapter()
  const recognizers = []
  const frames = []
  const barometerPushes = []
  const coordinator = new RoundRecognitionCoordinator({
    adapter: adapterState.adapter,
    templateName: TEMPLATE.name,
    mode: 'formal',
    createRecognizer: () => {
      const recognizer = options.createRecognizer
        ? options.createRecognizer()
        : createFakeRecognizer()
      recognizers.push(recognizer)
      return recognizer
    },
    // pump 必须真的把样本转成帧交给识别器，否则「旧回调被丢弃」无法被观察
    createPump: (onFrame) => ({
      push: (sample) => onFrame({ t: sample.t, features: [[1, 1, 0, 0]] }),
    }),
    createRecorder: (adapter, emit) => {
      const recorder = new SensorRecorder({
        adapter,
        retainSamples: options.retainSamples ?? false,
      })
      recorder.on('sample', emit.sample)
      recorder.on('barometer', emit.barometer)
      recorder.on('status', emit.status)
      return recorder
    },
    handlers: {
      onFrame: (snapshot) => frames.push(snapshot),
      onBarometerPush: (snapshot) => barometerPushes.push(snapshot),
    },
  })
  return { coordinator, adapterState, recognizers, frames, barometerPushes }
}

/**
 * 等待第 count 轮 recorder 完成订阅。
 * 注意统计的是「累计创建的加速度订阅数」而非活跃数：上一轮的订阅在 stop 后
 * 会被标记 removed 但仍留在数组里，按活跃数统计会永远等不到第 2 轮。
 */
async function waitForSubscriptions(adapterState, count, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const total = adapterState.subscriptions.filter(
      (s) => s.name === 'accelerometer',
    ).length
    if (total >= count) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`等待第 ${count} 轮加速度订阅超时`)
}

/** 触发一次加速度样本（满足 recorder 的启动就绪条件需要加速度 + 陀螺仪）。 */
function emitReadySample(adapterState) {
  for (const sub of adapterState.subscriptions) {
    if (sub.removed) continue
    if (sub.name === 'gyroscope') sub.listener({ x: 0, y: 0, z: 0 })
    if (sub.name === 'accelerometer') {
      sub.listener({ x: 0, y: 0, z: 1 })
    }
  }
}

test('D03 recorder 启动：订阅加速度/陀螺仪/气压，stop 后监听器全部移除', async () => {
  const { coordinator, adapterState } = createHarness()
  const started = coordinator.start()
  await waitForSubscriptions(adapterState, 1)
  emitReadySample(adapterState)
  await started
  assert.equal(adapterState.active().length >= 3, true, '应至少有加速度/陀螺仪/气压订阅')

  await coordinator.stop()
  assert.equal(adapterState.active().length, 0, 'stop 后不得残留任何监听器')
})

test('D03 单 owner：start 必须等待上一轮 stop 完成，两轮不重叠', async () => {
  const { coordinator, adapterState } = createHarness()
  const first = coordinator.start()
  await waitForSubscriptions(adapterState, 1)
  emitReadySample(adapterState)
  await first
  const firstOwner = coordinator.getOwnerId()

  // 先发起 stop（不 await），紧接着 start：start 内部必须等待 stop 完成
  const stopping = coordinator.stop()
  const second = coordinator.start()
  await waitForSubscriptions(adapterState, 2, 5000)
  emitReadySample(adapterState)
  await second
  await stopping

  const secondOwner = coordinator.getOwnerId()
  assert.equal(secondOwner, firstOwner + 1, '新一轮应拿到新的 owner id')
  assert.equal(
    adapterState.subscriptions.filter((s) => !s.removed).length >= 3,
    true,
    '新一轮订阅必须存在',
  )
  // 旧一轮的订阅必须已移除：同一时刻只有一个 owner
  const removed = adapterState.subscriptions.filter((s) => s.removed)
  assert.equal(removed.length >= 3, true, '旧一轮的监听器必须已被移除')

  // 收尾：停掉第 2 轮，否则 recorder 的看门狗定时器会拖住测试进程
  await coordinator.stop()
  assert.equal(adapterState.active().length, 0, '最终不得残留任何监听器')
})

test('D03 generation 隔离：旧一轮手持引用发出的样本不进新一轮', async () => {
  const { coordinator, adapterState, recognizers } = createHarness()
  const first = coordinator.start()
  await waitForSubscriptions(adapterState, 1)
  emitReadySample(adapterState)
  await first
  // 保留旧一轮的订阅引用（模拟「stop 尚未完成时又收到一次回调」）
  const staleSubs = adapterState.subscriptions.filter((s) => !s.removed)
  const staleAccel = staleSubs.find((s) => s.name === 'accelerometer')
  assert.ok(staleAccel)

  await coordinator.stop()
  const staleGeneration = coordinator.getGeneration()

  const second = coordinator.start()
  await waitForSubscriptions(adapterState, 2)
  emitReadySample(adapterState, () => {
    console.log('AT-EMIT2', {
      active: adapterState.active().map((s) => s.name),
      owner: coordinator.getOwnerId(),
      running: coordinator.isRunning(),
      recGen: coordinator.getRecorder()?.getGeneration(),
    })
  })
  await second
  const newGeneration = coordinator.getGeneration()
  assert.notEqual(newGeneration, staleGeneration, 'generation 必须递增')

  const recognizer = coordinator.getRecognizer()
  const framesBefore = recognizer.frames.length
  // 旧一轮的监听器即便被再次触发，也必须被 generation 守卫丢弃
  staleAccel.listener({ x: 9, y: 9, z: 9 })
  assert.equal(
    recognizer.frames.length,
    framesBefore,
    '旧 generation 的样本不得写入新一轮识别器',
  )

  // 收尾：停掉第 2 轮，避免泄漏看门狗定时器
  await coordinator.stop()
  assert.equal(adapterState.active().length, 0)
})

test('D03 卸载/stop 之后到达的回调不产生任何副作用', async () => {
  const { coordinator, adapterState } = createHarness()
  const started = coordinator.start()
  await waitForSubscriptions(adapterState, 1)
  emitReadySample(adapterState)
  await started
  const captured = adapterState.subscriptions.filter((s) => !s.removed)

  await coordinator.stop()
  const recognizer = coordinator.getRecognizer()
  const framesBefore = recognizer ? recognizer.frames.length : 0
  for (const sub of captured) {
    if (sub.name === 'accelerometer') sub.listener({ x: 1, y: 1, z: 1 })
    if (sub.name === 'barometer') sub.listener({ pressure: 1000 })
  }
  const framesAfter = coordinator.getRecognizer()
    ? coordinator.getRecognizer().frames.length
    : 0
  assert.equal(framesAfter, framesBefore, 'stop 之后的回调不得推进识别状态')
})

test('D03 stop 幂等：并发调用共享同一个停止过程', async () => {
  const { coordinator, adapterState } = createHarness()
  const started = coordinator.start()
  await waitForSubscriptions(adapterState, 1)
  emitReadySample(adapterState)
  await started

  const results = await Promise.all([
    coordinator.stop(),
    coordinator.stop(),
    coordinator.stop(),
  ])
  assert.equal(results.length, 3)
  assert.equal(adapterState.active().length, 0)
  // 再次 stop（已停止）不得抛错
  await coordinator.stop()
})

test('D03 气压降级定时器：stop 之后不再向已结束的轮次上报', async () => {
  const { coordinator, adapterState } = createHarness()
  const barometerReports = []
  coordinator.setHandlers({
    onBarometer: (status) => barometerReports.push(status),
  })
  const started = coordinator.start()
  await waitForSubscriptions(adapterState, 1)
  emitReadySample(adapterState)
  await started

  await coordinator.stop()
  const countAtStop = barometerReports.length
  // 等待超过 3 秒的降级窗口
  await new Promise((resolve) => setTimeout(resolve, 3200))
  assert.equal(
    barometerReports.length,
    countAtStop,
    'stop 之后气压降级定时器不得再上报',
  )
})

test('D03 气压样本：可用时推进识别器并透传状态', async () => {
  const { coordinator, adapterState } = createHarness()
  const barometerReports = []
  coordinator.setHandlers({
    onBarometer: (status) => barometerReports.push(status),
  })
  const started = coordinator.start()
  await waitForSubscriptions(adapterState, 1)
  emitReadySample(adapterState)
  await started

  adapterState.emitBaro({ pressure: 1013.2 })
  const recognizer = coordinator.getRecognizer()
  assert.equal(recognizer.barometers.length, 1, '气压应推入识别器一次')
  assert.equal(recognizer.barometers[0], 1013.2)
  assert.equal(barometerReports.length, 1)
  assert.equal(barometerReports[0].available, true)
  await coordinator.stop()
})

test('D03 移除失败：一个监听器移除抛错不影响其余监听器清理', async () => {
  const { coordinator, adapterState } = createHarness()
  const started = coordinator.start()
  await waitForSubscriptions(adapterState, 1)
  emitReadySample(adapterState)
  await started

  // 让第一个订阅的 remove 第一次抛错（第二次成功），验证「重试 + 其余继续清理」
  const broken = adapterState.subscriptions.find((s) => !s.removed)
  const realRemove = broken.remove.bind(broken)
  let attempts = 0
  broken.remove = () => {
    attempts += 1
    if (attempts === 1) throw new Error('native remove failed (first attempt)')
    realRemove()
  }
  await coordinator.stop()
  assert.equal(attempts, 2, '失败的移除必须被重试一次')
  const stillActive = adapterState.active()
  assert.equal(
    stillActive.length,
    0,
    `移除失败也必须继续清理其余监听器，实际残留 ${stillActive
      .map((s) => s.name)
      .join(',')}`,
  )
})

test('D03 重复 stop 已停止的 recorder 不得抛错，且不残留监听器', async () => {
  const { coordinator, adapterState } = createHarness()
  const started = coordinator.start()
  await waitForSubscriptions(adapterState, 1)
  emitReadySample(adapterState)
  await started
  await coordinator.stop()
  // 再走一次完整 stop 路径
  await coordinator.stop()
  assert.equal(adapterState.active().length, 0)
})

test('D03 start 失败：不得留下无 owner 的 recorder', async () => {
  const { coordinator, adapterState } = createHarness({
    createRecognizer: () => {
      throw new Error('recognizer boom')
    },
  })
  await assert.rejects(() => coordinator.start(), /recognizer boom/)
  assert.equal(adapterState.active().length, 0, '创建失败不得订阅任何传感器')
  assert.equal(coordinator.isRunning(), false)
})
