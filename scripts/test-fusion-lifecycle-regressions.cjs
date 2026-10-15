// Deterministic hook/native ownership regressions; fake hosts are not device acceptance.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const repo = path.join(__dirname, '..')
const core = name => require(path.join(repo, 'node_modules/.cache/steploop-core', `${name}.js`))

function loadSource(file, mocks, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(repo, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText
  const loaded = { exports: {} }
  const resolve = name => {
    if (name in mocks) return mocks[name]
    if (name.startsWith('../core/')) return core(name.slice('../core/'.length))
    throw Error(`Unexpected import: ${name}`)
  }
  new Function('require', 'module', 'exports', ...Object.keys(globals), source)(resolve, loaded, loaded.exports, ...Object.values(globals))
  return loaded.exports
}

function hookRuntime() {
  const slots = []
  let cursor = 0, effects = []
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'Fragment',
    useState(initial) {
      const index = cursor++
      slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next }]
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial } },
    useMemo(factory, deps) {
      const index = cursor++
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: factory(), deps }
      return slots[index].value
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps) },
    useEffect(callback, deps) {
      const index = cursor++
      if (!slots[index] || !same(slots[index].deps, deps)) {
        const cleanup = slots[index]?.cleanup
        slots[index] = { deps, cleanup }
        effects.push(() => { cleanup?.(); slots[index].cleanup = callback() })
      }
    },
  }
  return { react, unmount() { slots.forEach(slot => slot?.cleanup?.()) }, reset() { slots.length = 0; cursor = 0; effects = [] }, render(fn) { cursor = 0; const value = fn(); const pending = effects; effects = []; pending.forEach(effect => effect()); return value } }
}

async function sessionHarness(options = {}) {
  const runtime = hookRuntime()
  const state = { checkpoint: options.checkpoint ?? null, workouts: new Map(), pending: null, starts: 0, saves: 0, clears: 0, feedback: [], nativeStarts: 0, nativeStops: 0, nativeRunning: false, recorderStops: 0, evidenceSamples: 0 }
  let checkpointFailures = options.checkpointFailures ?? 0
  let now = 100000, interval, saveFailures = options.saveFailures ?? 0,
    pendingFailures = options.pendingFailures ?? 0, clearFailures = options.clearFailures ?? 0,
    completedCheckpointFailures = options.completedCheckpointFailures ?? 0
  class TaskDate extends Date { static now() { return now } }
  class Recorder { constructor(options) { state.recorderOptions = options } async start() { state.starts++; await options.recorderStart?.(state.starts) } async stop() { state.recorderStops++; await options.recorderStop?.() } }
  const buildings = {
    loadFusionCheckpoint: async () => state.checkpoint,
    getBuilding: async () => options.template,
    saveFusionCheckpoint: async checkpoint => {
      await options.checkpointWrite?.(checkpoint)
      if (checkpoint && checkpointFailures > 0) { checkpointFailures--; throw Error('checkpoint write failed') }
      if (checkpoint?.endedAt && completedCheckpointFailures > 0) { completedCheckpointFailures--; throw Error('completed checkpoint failed') }
      if (!checkpoint && clearFailures > 0) { clearFailures--; throw Error('checkpoint cleanup failed') }
      if (!checkpoint) state.clears++
      state.checkpoint = checkpoint ? structuredClone(checkpoint) : null
    },
    recordBuildingResult: async () => {},
    savePendingTemplate: async pending => {
      if (pendingFailures > 0) { pendingFailures--; throw Error('template save failed') }
      state.pending = structuredClone(pending)
    },
  }
  const exports = loadSource('src/hooks/useFusionWorkout.ts', {
    react: runtime.react,
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    'expo-keep-awake': { activateKeepAwakeAsync: async () => {}, deactivateKeepAwake() {} },
    '../services/building-storage': buildings,
    '../services/background-training': { isBackgroundTrainingSupported: () => !!options.nativeStart, startBackgroundTraining: async () => { state.nativeStarts++; await options.nativeStart(); state.nativeRunning = true; return { running: true } }, stopBackgroundTraining: async () => { state.nativeStops++; state.nativeRunning = false } },
    '../services/preferences': { getPreferences: async () => ({ bodyWeightKg: 65 }), triggerHaptic: async () => {}, triggerHapticPattern: async pattern => { state.feedback.push(pattern) } },
    '../services/sensor': { SensorRecorder: options.Recorder ?? Recorder, sensorStartErrorMessage: e => e.message },
    '../services/voice-feedback': { createWorkoutVoiceService: () => ({ observe() {}, finish: async () => {}, dispose: async () => {} }) },
    '../services/workout-voice-settings': { workoutVoiceSettings: () => ({}) },
    '../services/workout-storage': { saveWorkout: async workout => {
      state.saves++
      if (saveFailures > 0) { saveFailures--; throw Error('workout save failed') }
      state.workouts.set(workout.id, structuredClone(workout))
    } },
    '../services/workout-evidence': { createWorkoutEvidenceJournal: (_, report) => {
      state.reportEvidence = report
      report('')
      return { pushSample() { state.evidenceSamples++ }, gap() {}, close() {} }
    } },
  }, { Date: TaskDate, setInterval: fn => { interval = fn; return 1 }, clearInterval: () => { interval = undefined } })
  let api
  const render = () => api = runtime.render(() => exports.useFusionWorkout(options.params ?? {}))
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); return render() }
  render(); await settle(); interval?.(); render()
  return { state, get api() { return api }, render, settle, waitForCleanup: exports.waitForFusionCleanup, unmount() { runtime.unmount() }, remount() { runtime.unmount(); runtime.reset(); render() }, advance(ms) { now += ms }, tick() { interval?.(); render() }, mark() { now += 3000; api.markFloor(); render() } }
}


function deferred() { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

test('unmount while native start is pending stops the service after its late completion', async () => {
  const start = deferred()
  const h = await sessionHarness({ nativeStart: () => start.promise })
  assert.equal(h.state.nativeStarts, 1)
  h.unmount()
  await h.settle()
  start.resolve()
  await h.settle()
  assert.equal(h.state.nativeRunning, false)
  assert.equal(h.state.starts, 0)
})

test('a retry waits for the previous recorder cleanup before creating a new owner', async () => {
  const stop = deferred()
  const h = await sessionHarness({ recorderStart: async count => { if (count === 1) throw Error('start failed') }, recorderStop: () => stop.promise })
  assert.equal(h.api.status, 'error')
  h.api.retry(); await h.settle()
  assert.equal(h.state.starts, 1, 'old cleanup still owns the sensors')
  stop.resolve(); await h.settle()
  assert.equal(h.state.starts, 2)
  assert.equal(h.api.status, 'running')
  h.unmount(); await h.settle()
})

test('samples delivered after unmount cannot advance the abandoned engine', async () => {
  const h = await sessionHarness()
  const onSample = h.state.recorderOptions.onSample
  h.unmount(); await h.settle()
  // A captured callback can still be queued by the native bridge after unsubscribe.
  onSample({ t: 105000, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 })
  assert.equal(h.state.evidenceSamples, 0)
})

const { synthesize, runEngine } = require('./fusion-synth.cjs')
const engineModule = core('fusion-engine')
test('manual next round on a device without barometer cannot reuse the previous round steps', () => {
  const data = synthesize([{ type: 'stand', durMs: 4000 }, { type: 'climb', floors: 2, tap: true, tapTop: true }, { type: 'stand', durMs: 400 }], { noBaro: true })
  const { engine } = runEngine(engineModule, data)
  engine.nextRound(data.end)
  assert.equal(engine.getPhase(), 'waiting')
  engine.tick(data.end + 100)
  assert.equal(engine.getPhase(), 'waiting', 'old ascent steps must not start another round')
  const next = synthesize([{ type: 'walk', durMs: 6000 }], { noBaro: true, start: data.end + 500 })
  for (const sample of next.samples) engine.pushSample(sample)
  assert.equal(engine.getPhase(), 'climbing', 'fresh steps should still start a new round')
  assert.ok(engine.snapshot().ascentMs < 40000, 'the next round start cannot predate the manual boundary')
})


test('a fresh screen waits for the abandoned native start and keeps its own service alive', async () => {
  const start = deferred()
  let nativeCalls = 0
  const h = await sessionHarness({ nativeStart: () => ++nativeCalls === 1 ? start.promise : Promise.resolve() })
  h.remount(); await h.settle()
  assert.equal(h.state.nativeStarts, 1)
  start.resolve(); await h.settle()
  assert.equal(h.state.nativeStarts, 2)
  assert.equal(h.state.nativeRunning, true)
  assert.equal(h.state.starts, 1)
  assert.equal(h.api.status, 'running')
  h.unmount(); await h.settle()
  assert.equal(h.state.nativeRunning, false)
})


// Real SensorRecorder + real FusionWorkoutEngine, with only the native journal
// boundary delayed. This catches the ordering between drain, finish and save.
function delayedNativeJournal() {
  let poll, listener, gate, failure, failAfter, capturePage = false, queue = []
  const initial = { t: 100000, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0, seq: 1, sessionId: 'native-test' }
  const { TypedEmitter } = loadSource('src/services/typed-emitter.ts', {})
  const { SensorRecorder } = loadSource('src/services/sensor.ts', {
    './privacy': { ensurePrivacyAuthorized: async () => {}, PrivacyAuthorizeError: class extends Error {} },
    './sensor-adapter': { expoSensorAdapter: {} }, './typed-emitter': { TypedEmitter },
    './background-training': {
      isBackgroundTrainingSupported: () => true,
      getBackgroundTrainingStatus: async () => ({ running: true, sessionId: 'native-test', latestSequence: 0 }),
      subscribeBackgroundSamples: callback => { listener = callback; callback(initial); return { remove() { listener = undefined } } },
      drainBackgroundSamples: async (after, limit) => {
        const read = () => ({ sessionId: 'native-test', samples: queue.filter(sample => sample.seq > after).slice(0, limit), latestSequence: queue.at(-1)?.seq ?? 1 })
        const page = capturePage ? read() : undefined
        if (gate) await gate.promise
        if (failure || (failAfter !== undefined && after >= failAfter)) throw Error('journal temporarily unreadable')
        return page ?? read()
      },
    },
  }, { Date: class extends Date { static now() { return 100000 } }, setInterval: fn => { poll = fn; return 1 }, clearInterval() {}, setTimeout: () => 1, clearTimeout() {} })
  return { SensorRecorder,
    enqueue(samples) { queue = samples.filter(sample => sample.t > initial.t).map((sample, index) => ({ ...sample, seq: index + 2, sessionId: 'native-test' })) },
    delayReplay() { gate = deferred(); poll(); return () => { gate.resolve(); gate = undefined } },
    emitForeign() { listener?.({ ...queue.at(-1), seq: 999999, sessionId: 'other-workout' }) },
    fail(value) { failure = value }, failAfter(value) { failAfter = value }, emitLatest() { listener?.(queue.at(-1)) }, capture(value) { capturePage = value },
  }
}
function replayFixture() {
  const template = core('fusion-calibration').buildTemplateFromCalibration({ startFloor: 1,
    boundaries: [{ t: 0, steps: 0, turns: 0 }, { t: 12000, steps: 18, turns: 0 }], barometer: false, now: 12000 }).template
  const data = synthesize([{ type: 'stand', durMs: 4000 }, { type: 'walk', durMs: 24000 }], { noBaro: true, start: 100000 })
  const expected = runEngine(engineModule, data, { template }).engine.finish(data.end)
  assert.ok(expected.length > 0)
  return { template, data, expected }
}

test('finish waits for a delayed native journal and saves every acquired pre-finish floor', async () => {
  const native = delayedNativeJournal(), { template, data, expected } = replayFixture()
  const h = await sessionHarness({ Recorder: native.SensorRecorder, nativeStart: async () => {}, template, params: { templateId: template.id } })
  const future = synthesize([{ type: 'walk', durMs: 24000 }], { noBaro: true, start: data.end + 40 })
  native.enqueue([...data.samples, ...future.samples])
  const release = native.delayReplay()
  h.advance(data.end - 100000)
  const finishing = h.api.finish()
  await h.settle()
  assert.equal(h.api.status, 'finishing')
  assert.equal(h.state.workouts.size, 0)
  release()
  const id = await finishing
  assert.ok(id)
  const workout = h.state.workouts.get(id)
  assert.equal(workout.totalFloorsCompleted, expected.reduce((sum, round) => sum + round.floors, 0))
  assert.equal(workout.endedAt, data.end)
})

test('failed native drain stays retryable and does not freeze an incomplete result', async () => {
  const native = delayedNativeJournal(), { template, data } = replayFixture()
  const h = await sessionHarness({ Recorder: native.SensorRecorder, nativeStart: async () => {}, template, params: { templateId: template.id } })
  native.enqueue(data.samples); native.fail(true); h.advance(data.end - 100000)
  await assert.rejects(h.api.finish(), /journal temporarily unreadable/)
  await h.settle()
  assert.equal(h.api.status, 'save_failed')
  assert.equal(h.api.canSaveLater, false)
  assert.equal(h.state.workouts.size, 0)
  native.fail(false); h.advance(60000)
  const id = await h.api.finish()
  assert.ok(h.state.workouts.get(id).totalFloorsCompleted > 0)
  assert.equal(h.state.workouts.get(id).endedAt, data.end)
})


test('a failed checkpoint write cannot poison the shared cleanup barrier for a new screen', async () => {
  const h = await sessionHarness({ checkpointFailures: 2 })
  h.remount(); await h.settle()
  assert.equal(h.state.starts, 2)
  assert.equal(h.api.status, 'running')
  h.unmount(); await h.settle()
})

test('failed cleanup persistence blocks recovery until the retained snapshot is durably retried', async () => {
  let blocked = false
  const { template, expected } = replayFixture()
  const h = await sessionHarness({ params: { resume: true },
    checkpoint: { workoutId: 'retained-round', startedAt: 100000, savedAt: 100000,
      startFloor: 1, rounds: expected, template, calibrated: false },
    checkpointWrite: async () => { if (blocked) throw Error('disk full') },
  })
  const workoutId = h.api.workoutId
  blocked = true
  h.unmount(); await h.settle()
  await assert.rejects(h.waitForCleanup(), /上次训练尚未保存成功/)
  assert.equal(h.state.starts, 1)
  blocked = false
  await h.waitForCleanup()
  assert.equal(h.state.checkpoint.workoutId, workoutId)
  assert.equal(h.state.checkpoint.rounds.length, 1)
  assert.equal(h.state.checkpoint.rounds[0].floors, expected[0].floors)
})

test('explicit discard clears a failed in-memory checkpoint so recovery cannot resurrect it', async () => {
  const h = await sessionHarness({ checkpointFailures: 10 })
  await h.api.discard()
  h.unmount()
  await h.waitForCleanup()
  assert.equal(h.state.checkpoint, null)
})

for (const failed of [true, false]) test(failed
  ? 'a failed drain with a high-sequence live event retains the missing native samples for retry'
  : 'a successful old journal page cannot let a high-sequence live event skip the later page', async () => {
  const native = delayedNativeJournal(), { template, data, expected } = replayFixture()
  const h = await sessionHarness({ Recorder: native.SensorRecorder, nativeStart: async () => {}, template, params: { templateId: template.id } })
  native.capture(true)
  const release = native.delayReplay()
  native.enqueue(data.samples); native.emitLatest(); native.fail(failed)
  release(); await h.settle()
  native.fail(false); native.capture(false); h.advance(data.end - 100000)
  const id = await h.api.finish()
  assert.ok(id, 'unread low-sequence samples must still be replayed')
  assert.equal(h.state.workouts.get(id).totalFloorsCompleted, expected.reduce((sum, round) => sum + round.floors, 0))
})


test('a partial replay checkpoint is never labelled as a completed safely recoverable result', async () => {
  const native = delayedNativeJournal(), { template } = replayFixture()
  const data = synthesize([{ type: 'stand', durMs: 4000 }, { type: 'walk', durMs: 24000 },
    { type: 'stand', durMs: 25000 }, { type: 'walk', durMs: 45000 }], { noBaro: true, start: 100000 })
  const h = await sessionHarness({ Recorder: native.SensorRecorder, nativeStart: async () => {}, template, params: { templateId: template.id } })
  native.enqueue(data.samples); native.failAfter(2000); h.advance(data.end - 100000)
  await assert.rejects(h.api.finish(), /journal temporarily unreadable/)
  await h.settle()
  assert.ok(h.state.checkpoint.rounds.length > 0, 'completed early rounds still have a recovery point')
  assert.equal(h.state.checkpoint.endedAt, undefined, 'remaining native pages have not been drained')
  assert.equal(h.api.canSaveLater, false)
  native.failAfter(undefined)
  const id = await h.api.finish()
  const expected = runEngine(engineModule, data, { template }).engine.finish(data.end)
  assert.equal(h.state.workouts.get(id).totalFloorsCompleted, expected.reduce((sum, round) => sum + round.floors, 0))
})


test('recovery readers wait until the departing screen has saved its slow checkpoint', async () => {
  const write = deferred()
  let writes = 0, ready = false
  const h = await sessionHarness({ checkpointWrite: async () => { if (++writes === 2) await write.promise } })
  h.unmount()
  const cleanup = h.waitForCleanup().then(() => { ready = true })
  await h.settle()
  assert.equal(ready, false)
  write.resolve(); await cleanup
  assert.equal(ready, true)
  assert.ok(h.state.checkpoint)
})

test('late native events from another workout cannot block the current journal flush', async () => {
  const native = delayedNativeJournal(), { template, data, expected } = replayFixture()
  const h = await sessionHarness({ Recorder: native.SensorRecorder, nativeStart: async () => {}, template, params: { templateId: template.id } })
  native.enqueue(data.samples); native.emitForeign(); h.advance(data.end - 100000)
  const id = await h.api.finish()
  assert.equal(h.state.workouts.get(id).totalFloorsCompleted, expected.reduce((sum, round) => sum + round.floors, 0))
})
