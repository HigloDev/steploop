'use strict'
// Acquisition timestamps adapted from origin/snapshot/mobile-1.1.0. These tests
// verify bridge delivery semantics, not real-world floor recognition accuracy.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
function load(file, mocks, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => {
    if (name in mocks) return mocks[name]
    throw Error(`Unexpected dependency: ${name}`)
  }, module, module.exports, ...Object.values(globals))
  return module.exports
}
function harness() {
  let now = 100000
  const events = {}, timers = [], samples = [], barometers = [], gaps = [], intervals = []
  const subscription = name => listener => { events[name] = listener; return { remove() { delete events[name] } } }
  const adapter = {
    setAccelerometerInterval() {}, setGyroscopeInterval() {}, setDeviceMotionInterval() {}, setBarometerInterval() {},
    subscribeAccelerometer: subscription('accel'), subscribeGyroscope: subscription('gyro'),
    subscribeDeviceMotion: subscription('motion'), subscribeBarometer: subscription('baro'),
  }
  class TaskDate extends Date { static now() { return now } }
  const { TypedEmitter } = load('src/services/typed-emitter.ts', {})
  const { SensorRecorder } = load('src/services/sensor.ts', {
    './privacy': { ensurePrivacyAuthorized: async () => {}, PrivacyAuthorizeError: class extends Error {} },
    './sensor-adapter': { expoSensorAdapter: adapter }, './typed-emitter': { TypedEmitter },
    './background-training': { isBackgroundTrainingSupported: () => false },
  }, { Date: TaskDate, setInterval: fn => { intervals.push(fn); return 1 }, clearInterval() {}, setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length }, clearTimeout() {} })
  const recorder = new SensorRecorder({ adapter, onSample: s => samples.push(s), onBarometer: b => barometers.push(b), onGap: gap => gaps.push(gap) })
  const accel = timestamp => events.accel({ x: 0, y: 0, z: 1, timestamp })
  return { recorder, samples, barometers, gaps, events, accel, check() { intervals.forEach(fn => fn()) }, now(value) { now = value },
    async start(timestamp = 10) {
      const started = recorder.start(); await Promise.resolve()
      events.gyro({ x: 0, y: 0, z: 0, timestamp }); accel(timestamp)
      timers.filter(t => t.delay === 50).forEach(t => t.fn())
      await started
    },
  }
}

test('delayed Expo callbacks retain acquisition intervals and the pressure event timestamp', async () => {
  const h = harness(); await h.start()
  h.events.baro({ pressure: 1000, timestamp: 10.01 })
  h.now(102000); h.check()
  h.accel(10.02); h.accel(10.04)
  assert.equal(h.samples[1].t - h.samples[0].t, 20)
  assert.equal(h.samples[2].t - h.samples[1].t, 20)
  assert.equal(h.samples[2].pressureT, 100010)
  assert.equal(h.samples[2].pressure, 1000)
  assert.deepEqual(h.gaps, [], 'bridge delay is not a sensor interruption')
  await h.recorder.stop()
})

test('a repeated pressure acquisition timestamp cannot refresh a stale reading', async () => {
  const h = harness(); await h.start()
  h.events.baro({ pressure: 1000, timestamp: 10.01 })
  h.now(105000)
  h.events.baro({ pressure: 900, timestamp: 10.01 })
  h.accel(15)
  assert.equal(h.samples.at(-1).pressure, 1000)
  assert.equal(h.samples.at(-1).pressureT, 100010)
  assert.equal(h.barometers.length, 1)
  await h.recorder.stop()
})

test('a recorder restart creates a fresh clock mapping and does not reuse the prior pressure', async () => {
  const h = harness(); await h.start()
  h.events.baro({ pressure: 1000, timestamp: 10.01 })
  await h.recorder.stop(); h.now(200000); await h.start(20)
  assert.equal(h.samples.at(-1).t, 200000)
  assert.equal(h.samples.at(-1).pressure, undefined)
  await h.recorder.stop()
})

test('legacy injected adapters without timestamps still use callback time', async () => {
  const h = harness(); await h.start(undefined)
  h.now(101000); h.events.baro({ pressure: 1000 }); h.accel(undefined)
  assert.equal(h.samples.at(-1).t, 101000)
  assert.equal(h.samples.at(-1).pressureT, 101000)
  await h.recorder.stop()
})

test('Expo adapter forwards accelerometer, gyroscope and barometer timestamps', () => {
  const handlers = {}, received = {}
  const sensor = key => ({ addListener(listener) { handlers[key] = listener; return { remove() {} } } })
  const { expoSensorAdapter: adapter } = load('src/services/sensor-adapter.ts', {
    'expo-sensors': { Accelerometer: sensor('accel'), Gyroscope: sensor('gyro'), Barometer: sensor('baro'), DeviceMotion: sensor('motion') },
  })
  adapter.subscribeAccelerometer(value => { received.accel = value })
  adapter.subscribeGyroscope(value => { received.gyro = value })
  adapter.subscribeBarometer(value => { received.baro = value })
  for (const key of ['accel', 'gyro', 'baro']) handlers[key]({ x: 1, y: 2, z: 3, pressure: 1000, timestamp: 12.25 })
  for (const key of ['accel', 'gyro', 'baro']) assert.equal(received[key].timestamp, 12.25)
})


test('a real acquisition gap remains visible even when no watchdog callback ran', async () => {
  const h = harness(); await h.start()
  h.now(105000); h.accel(15)
  assert.deepEqual(h.gaps, [{ startMs: 0, endMs: 5000 }])
  await h.recorder.stop()
})
