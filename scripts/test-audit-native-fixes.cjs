// Real hook, recorder and engine; only React/native/storage hosts are simulated.
// No device acceptance is implied by these deterministic acquisition/replay cases.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const repo = path.join(__dirname, '..')
const { synthesize } = require('./fusion-synth.cjs')

function sourceLoader(mocks = {}, globals = {}) {
  const cache = new Map()
  function load(file) {
    file = path.resolve(repo, file)
    if (cache.has(file)) return cache.get(file).exports
    const target = { exports: {} }
    cache.set(file, target)
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    const resolve = name => {
      if (Object.hasOwn(mocks, name)) return mocks[name]
      if (name.startsWith('.')) {
        const next = path.resolve(path.dirname(file), name)
        if (next.endsWith('.json')) return JSON.parse(fs.readFileSync(next, 'utf8'))
        return load(next + '.ts')
      }
      throw new Error(`Unexpected host dependency: ${name}`)
    }
    new Function('require', 'module', 'exports', ...Object.keys(globals), code)(resolve, target, target.exports, ...Object.values(globals))
    return target.exports
  }
  return load
}

function nativeHost({ firstAt = 100000 } = {}) {
  let now = 100000, poll, listener, queue = [], earliest = 1, dropped = 0
  const initial = { t: firstAt, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0, seq: 1, sessionId: 'native-test' }
  let latest = 1, gate, captureOldPage = false
  const load = sourceLoader({
    './privacy': { ensurePrivacyAuthorized: async () => {}, PrivacyAuthorizeError: class extends Error {} },
    './sensor-adapter': { expoSensorAdapter: {} },
    './background-training': {
      isBackgroundTrainingSupported: () => true,
      getBackgroundTrainingStatus: async () => ({ running: true, sessionId: 'native-test', latestSequence: 0 }),
      subscribeBackgroundSamples: fn => { listener = fn; fn(initial); return { remove() { listener = undefined } } },
      drainBackgroundSamples: async (after, limit) => {
        const read = () => ({ sessionId: 'native-test', samples: queue.filter(s => s.seq > after).slice(0, limit),
          earliestSequence: earliest, latestSequence: latest, droppedSamples: dropped, acknowledgedSequence: 0 })
        const page = captureOldPage ? read() : undefined
        if (gate) await gate.promise
        return page ?? read()
      },
    },
  }, { Date: class extends Date { static now() { return now } },
    setInterval: fn => { poll = fn; return 1 }, clearInterval() {}, setTimeout: () => 1, clearTimeout() {} })
  return {
    SensorRecorder: load('src/services/sensor.ts').SensorRecorder,
    enqueue(samples) {
      queue = samples.filter(s => s.t > initial.t).map((s, index) => ({ ...s, seq: index + 2, sessionId: 'native-test' }))
      latest = queue.at(-1)?.seq ?? 1
    },
    rotateBefore(seq) { queue = queue.filter(s => s.seq >= seq); earliest = seq; dropped = seq - 1 },
    removeSequence(sequence) { queue = queue.filter(sample => sample.seq !== sequence) },
    emitAll() { queue.forEach(sample => listener?.(sample)) },
    emitFrom(sequence) { queue.filter(sample => sample.seq >= sequence).forEach(sample => listener?.(sample)) },
    async poll(at) { now = at; poll?.(); await new Promise(resolve => setImmediate(resolve)) },
    delay() { let resolve; gate = { promise: new Promise(r => { resolve = r }) }; return () => { resolve(); gate = undefined } },
    captureOldPage(value) { captureOldPage = value },
  }
}

function reactHost() {
  const slots = []
  let cursor = 0, effects = []
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const react = {
    useState(value) { const i = cursor++; slots[i] ??= { value: typeof value === 'function' ? value() : value }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next }] },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value } },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) { const cleanup = slots[i]?.cleanup; slots[i] = { deps }; effects.push(() => { cleanup?.(); slots[i].cleanup = fn() }) } },
  }
  return { react, render(fn) { cursor = 0; const value = fn(); const pending = effects; effects = []; pending.forEach(e => e()); return value }, unmount() { slots.forEach(s => s.cleanup?.()) } }
}

async function workoutHost(native, template) {
  const runtime = reactHost(), saved = new Map(), evidenceGaps = []
  let now = 100000, tick, checkpoint, api
  const load = sourceLoader({
    react: runtime.react,
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    'expo-keep-awake': { activateKeepAwakeAsync: async () => {}, deactivateKeepAwake() {} },
    '../services/building-storage': { getBuilding: async () => template, loadFusionCheckpoint: async () => checkpoint,
      saveFusionCheckpoint: async c => { checkpoint = c }, savePendingTemplate: async () => {}, recordBuildingResult: async () => {} },
    '../services/background-training': { isBackgroundTrainingSupported: () => true, startBackgroundTraining: async () => ({ running: true }), stopBackgroundTraining: async () => ({ running: false }) },
    '../services/preferences': { getPreferences: async () => ({ bodyWeightKg: 65 }), triggerHaptic: async () => {}, triggerHapticPattern: async () => {} },
    '../services/sensor': { SensorRecorder: native.SensorRecorder, sensorStartErrorMessage: e => e.message },
    '../services/voice-feedback': { createWorkoutVoiceService: () => ({ observe() {}, finish: async () => {}, dispose: async () => {} }) },
    '../services/workout-voice-settings': { workoutVoiceSettings: () => ({}) },
    '../services/workout-storage': { saveWorkout: async w => { saved.set(w.id, structuredClone(w)) } },
    '../services/workout-evidence': { createWorkoutEvidenceJournal: () => ({ pushSample() {}, gap(...g) { evidenceGaps.push(g) }, close() {} }) },
  }, { Date: class extends Date { static now() { return now } }, setInterval: fn => { tick = fn; return 1 }, clearInterval: () => { tick = undefined } })
  const { useFusionWorkout, waitForFusionCleanup } = load('src/hooks/useFusionWorkout.ts')
  const render = () => api = runtime.render(() => useFusionWorkout({ templateId: template.id }))
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); render() }
  render(); await settle()
  assert.equal(api.status, 'running')
  return { saved, evidenceGaps, get api() { return api }, settle,
    at(at) { now = at; tick?.(); render() },
    async finish(at) { now = at; const id = await api.finish(); await settle(); return saved.get(id) },
    async close() { runtime.unmount(); await waitForFusionCleanup() },
  }
}

function fixture() {
  const template = sourceLoader()('src/core/fusion-calibration.ts').buildTemplateFromCalibration({
    startFloor: 1, barometer: true, now: 12000,
    boundaries: [{ t: 0, steps: 0, turns: 0, heightM: 0 }, { t: 12000, steps: 18, turns: 2, heightM: 3 }],
  }).template
  const data = synthesize([{ type: 'stand', durMs: 4000 }, { type: 'climb', floors: 3 }, { type: 'stand', durMs: 3000 }], { start: 100000, hz: 50 })
  return { template, data }
}

test('45 seconds of trailing acquisition loss warns and saves retained floors as degraded', async () => {
  const native = nativeHost(), { template, data } = fixture(), h = await workoutHost(native, template)
  native.enqueue(data.samples); await native.poll(data.end); await h.settle()
  const end = data.end + 45000
  await native.poll(end); h.at(end)
  assert.match(h.api.warning, /采样暂未更新/)
  const saved = await h.finish(end)
  assert.ok(saved.totalFloorsCompleted > 0)
  assert.equal(saved.trustQuality, 'degraded')
  assert.ok(saved.rounds.some(r => r.interruptions.some(g => g.endMs - g.startMs >= 45000)))
  assert.match(h.api.warning, /采样中断/)
  assert.ok(h.evidenceGaps.some(([a, b]) => b - a >= 45000))
  await h.close()
})

test('a complete delayed native replay is not a gap or a degraded result', async () => {
  const native = nativeHost(), { template, data } = fixture(), h = await workoutHost(native, template)
  const release = native.delay()
  native.enqueue(data.samples)
  await native.poll(data.end)
  h.at(data.end)
  assert.equal(h.api.warning, undefined, 'bridge delay alone is not a confirmed acquisition outage')
  release(); await h.settle()
  const saved = await h.finish(data.end)
  assert.ok(saved.totalFloorsCompleted > 0)
  assert.equal(saved.trustQuality, 'stable')
  assert.deepEqual(saved.rounds.flatMap(r => r.interruptions), [])
  assert.deepEqual(h.evidenceGaps, [])
  assert.equal(h.api.warning, undefined)
  await h.close()
})

test('rotated unread native samples mark loss without blocking save of retained floors', async () => {
  const native = nativeHost(), { template, data } = fixture(), h = await workoutHost(native, template)
  native.enqueue(data.samples.filter(s => s.t <= 118000)); await native.poll(118000)
  native.enqueue(data.samples)
  const firstRetained = data.samples.findIndex(s => s.t >= 129000) + 1
  native.rotateBefore(firstRetained); await native.poll(data.end); await h.settle()
  assert.match(h.api.warning, /数据已缺失/)
  const saved = await h.finish(data.end)
  assert.equal(h.api.status, 'done')
  assert.ok(saved.totalFloorsCompleted > 0)
  assert.equal(saved.trustQuality, 'degraded')
  assert.ok(saved.rounds.some(r => r.interruptions.length > 0))
  assert.ok(h.evidenceGaps.some(g => g[2] === 'native_journal_loss'))
  await h.close()
})

test('rotation of samples already delivered to JS does not degrade a complete recording', async () => {
  const native = nativeHost(), { template, data } = fixture(), h = await workoutHost(native, template)
  native.enqueue(data.samples); await native.poll(data.end)
  native.rotateBefore(1500); await native.poll(data.end)
  const saved = await h.finish(data.end)
  assert.equal(saved.trustQuality, 'stable')
  assert.deepEqual(h.evidenceGaps, [])
  await h.close()
})

test('a queued contiguous live prefix can recover a range removed from the disk journal', async () => {
  const native = nativeHost(), gaps = [], seen = []
  const recorder = new native.SensorRecorder({ keepRunningInBackground: true, onSample: s => seen.push(s.seq), onGap: g => gaps.push(g) })
  await recorder.start()
  const { data } = fixture()
  native.enqueue(data.samples)
  const release = native.delay()
  await native.poll(data.end)
  native.emitAll()
  native.rotateBefore(1500)
  release()
  await recorder.flush(data.end)
  assert.equal(seen.length, data.samples.length)
  assert.deepEqual(gaps, [])
  await recorder.stop()
})

test('a late first native sample exposes an initial acquisition gap', async () => {
  const native = nativeHost({ firstAt: 101800 }), gaps = []
  const recorder = new native.SensorRecorder({ keepRunningInBackground: true, onGap: g => gaps.push(g) })
  await recorder.start()
  assert.deepEqual(gaps.map(({ startMs, endMs }) => [startMs, endMs]), [[0, 1800]])
  await recorder.flush(101800)
  await recorder.stop()
})

test('an isolated queued suffix remains readable after an earlier range was evicted', async () => {
  const native = nativeHost(), gaps = [], seen = []
  const recorder = new native.SensorRecorder({ keepRunningInBackground: true, onSample: sample => seen.push(sample.seq), onGap: gap => gaps.push(gap) })
  await recorder.start()
  native.enqueue(Array.from({ length: 200 }, (_, index) => ({ t: 100020 + index * 20, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 })))
  const release = native.delay()
  await native.poll(104000)
  native.emitFrom(100)
  native.rotateBefore(150)
  release()
  await recorder.flush(104000)
  assert.deepEqual(seen, [1, ...Array.from({ length: 102 }, (_, index) => index + 100)])
  assert.deepEqual(gaps.map(gap => [gap.startMs, gap.endMs, gap.reason]), [[0, 1980, 'native_journal_loss']])
  await recorder.stop()
})

test('a queued live sample fills an interior disk sequence hole without a false gap', async () => {
  const native = nativeHost(), gaps = [], seen = []
  const recorder = new native.SensorRecorder({ keepRunningInBackground: true, onSample: sample => seen.push(sample.seq), onGap: gap => gaps.push(gap) })
  await recorder.start()
  native.enqueue(Array.from({ length: 200 }, (_, index) => ({ t: 100020 + index * 20, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 })))
  const release = native.delay()
  await native.poll(104000)
  native.emitFrom(50)
  native.removeSequence(50)
  release()
  await recorder.flush(104000)
  assert.deepEqual(seen, Array.from({ length: 201 }, (_, index) => index + 1))
  assert.deepEqual(gaps, [])
  await recorder.stop()
})

test('loss before the first ascent persists on the later saved workout', async () => {
  const native = nativeHost({ firstAt: 101800 }), { template, data } = fixture(), h = await workoutHost(native, template)
  native.enqueue(data.samples); await native.poll(data.end)
  const saved = await h.finish(data.end)
  assert.ok(saved.totalFloorsCompleted > 0)
  assert.equal(saved.trustQuality, 'degraded')
  assert.ok(saved.rounds.some(r => r.interruptions.length))
  await h.close()
})

test('explicit sequence loss is reported even below the timestamp gap threshold', async () => {
  const native = nativeHost(), gaps = []
  const recorder = new native.SensorRecorder({ keepRunningInBackground: true, onGap: gap => gaps.push(gap) })
  await recorder.start()
  native.enqueue([20, 40, 60, 80, 100].map(ms => ({ t: 100000 + ms, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 })))
  native.rotateBefore(5)
  await native.poll(100100)
  await recorder.flush(100100)
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].reason, 'native_journal_loss')
  assert.equal(gaps[0].endMs - gaps[0].startMs, 80)
  await recorder.stop()
})

test('an entirely evicted unread range closes with explicit loss instead of endless flush retries', async () => {
  const native = nativeHost(), gaps = []
  const recorder = new native.SensorRecorder({ keepRunningInBackground: true, onGap: gap => gaps.push(gap) })
  await recorder.start()
  native.enqueue([20, 40, 60].map(ms => ({ t: 100000 + ms, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 })))
  native.rotateBefore(5)
  await native.poll(100060)
  await recorder.flush(100060)
  assert.ok(gaps.some(g => g.reason === 'native_journal_loss'))
  await recorder.stop()
})
