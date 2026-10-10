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
  return { react, render(fn) { cursor = 0; const value = fn(); const pending = effects; effects = []; pending.forEach(effect => effect()); return value } }
}

async function sessionHarness(options = {}) {
  const runtime = hookRuntime()
  const state = { checkpoint: options.checkpoint ?? null, workouts: new Map(), pending: null, starts: 0, saves: 0, clears: 0 }
  let now = 100000, interval, saveFailures = options.saveFailures ?? 0,
    pendingFailures = options.pendingFailures ?? 0, clearFailures = options.clearFailures ?? 0,
    completedCheckpointFailures = options.completedCheckpointFailures ?? 0
  class TaskDate extends Date { static now() { return now } }
  class Recorder { async start() { state.starts++ } async stop() {} }
  const buildings = {
    loadFusionCheckpoint: async () => state.checkpoint,
    getBuilding: async () => undefined,
    saveFusionCheckpoint: async checkpoint => {
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
    '../services/background-training': { isBackgroundTrainingSupported: () => false },
    '../services/preferences': { getPreferences: async () => ({ bodyWeightKg: 65 }), triggerHaptic: async () => {} },
    '../services/sensor': { SensorRecorder: Recorder, sensorStartErrorMessage: e => e.message },
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
      return { pushSample() {}, gap() {}, close() {} }
    } },
  }, { Date: TaskDate, setInterval: fn => { interval = fn; return 1 }, clearInterval: () => { interval = undefined } })
  let api
  const render = () => api = runtime.render(() => exports.useFusionWorkout(options.params ?? {}))
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); return render() }
  render(); await settle(); interval?.(); render()
  return { state, get api() { return api }, render, settle, advance(ms) { now += ms }, mark() { now += 3000; api.markFloor(); render() } }
}

test('failed workout save retains completed rounds and retries without duplicate results or elapsed time', async () => {
  const h = await sessionHarness({ saveFailures: 1 })
  h.mark(); h.mark()
  await assert.rejects(h.api.finish(), /workout save failed/)
  await h.settle()
  assert.equal(h.api.status, 'save_failed')
  assert.equal(h.api.canSaveLater, true)
  assert.equal(h.state.clears, 0)
  assert.equal(h.state.checkpoint.rounds[0].floors, 2)
  const endedAt = h.state.checkpoint.endedAt
  h.advance(60000)
  const id = await h.api.finish()
  await h.settle()
  assert.equal(h.state.workouts.size, 1)
  assert.equal(h.state.workouts.get(id).endedAt, endedAt)
  assert.equal(h.state.workouts.get(id).totalFloorsCompleted, 2)
  assert.equal(h.state.checkpoint, null)
  assert.equal(h.api.status, 'done')
})

test('successful evidence writes clear only evidence errors and preserve recovery guidance', async () => {
  const original = await sessionHarness({ saveFailures: 1 })
  original.mark()
  await assert.rejects(original.api.finish())
  const checkpoint = { ...structuredClone(original.state.checkpoint), endedAt: undefined }
  const restored = await sessionHarness({ checkpoint, params: { resume: true } })
  assert.match(restored.api.warning, /已恢复上次训练/)
  restored.state.reportEvidence('原始数据保存失败：磁盘已满')
  restored.render()
  assert.equal(restored.api.warning, '原始数据保存失败：磁盘已满')
  restored.state.reportEvidence('')
  restored.render()
  assert.match(restored.api.warning, /已恢复上次训练/)
  const fresh = await sessionHarness()
  assert.equal(fresh.api.warning, undefined)
})

test('failed calibration draft save remains retryable even after the workout itself was saved', async () => {
  const h = await sessionHarness({ pendingFailures: 1 })
  h.mark()
  await assert.rejects(h.api.finish(), /template save failed/)
  await h.settle()
  assert.equal(h.state.workouts.size, 1)
  assert.ok(h.state.checkpoint.endedAt)
  const id = await h.api.finish()
  assert.equal(h.state.pending.workoutId, id)
  assert.equal(h.state.workouts.size, 1)
  assert.equal(h.state.checkpoint, null)
})

test('checkpoint cleanup failure keeps the final save available for retry', async () => {
  const h = await sessionHarness({ clearFailures: 1 })
  h.mark()
  await assert.rejects(h.api.finish(), /checkpoint cleanup failed/)
  await h.settle()
  assert.equal(h.api.status, 'save_failed')
  assert.ok(h.state.checkpoint)
  await h.api.finish()
  assert.equal(h.state.workouts.size, 1)
  assert.equal(h.state.checkpoint, null)
})

test('restoring an ended checkpoint retries saving without starting sensors and retains recalibration identity', async () => {
  const original = await sessionHarness({ saveFailures: 1, params: { recalibrateTemplateId: 'existing-building' } })
  original.mark()
  await assert.rejects(original.api.finish())
  const checkpoint = structuredClone(original.state.checkpoint)
  const restored = await sessionHarness({ checkpoint, params: { resume: true } })
  assert.equal(restored.api.status, 'save_failed')
  assert.equal(restored.state.starts, 0)
  const id = await restored.api.finish()
  assert.equal(restored.state.workouts.get(id).endedAt, checkpoint.endedAt)
  assert.equal(restored.state.pending.replaceTemplateId, 'existing-building')
})

test('concurrent finish actions share one save', async () => {
  const h = await sessionHarness()
  h.mark()
  const first = h.api.finish(), second = h.api.finish()
  assert.equal(first, second)
  assert.equal(await first, await second)
  assert.equal(h.state.saves, 1)
})

test('ending an empty calibration does not create an empty workout or template', async () => {
  const h = await sessionHarness()
  assert.equal(await h.api.finish(), undefined)
  assert.equal(h.state.workouts.size, 0)
  assert.equal(h.state.pending, null)
  assert.equal(h.state.checkpoint, null)
})

test('failed discard retains the stopped result and can recover by saving', async () => {
  const h = await sessionHarness({ clearFailures: 1 })
  h.mark()
  await assert.rejects(h.api.discard(), /checkpoint cleanup failed/)
  await h.settle()
  assert.equal(h.api.status, 'save_failed')
  assert.equal(h.api.canSaveLater, true)
  const endedAt = h.state.checkpoint.endedAt
  h.advance(30000)
  const id = await h.api.finish()
  assert.equal(h.state.workouts.get(id).endedAt, endedAt)
  assert.equal(h.state.workouts.get(id).totalFloorsCompleted, 1)
  assert.equal(h.state.checkpoint, null)
})

test('failed recovery point and workout writes keep the user on the save retry screen', async () => {
  const h = await sessionHarness({ saveFailures: 1, completedCheckpointFailures: 2 })
  h.mark()
  await assert.rejects(h.api.finish(), /workout save failed/)
  await h.settle()
  assert.equal(h.api.status, 'save_failed')
  assert.equal(h.api.canSaveLater, false)
  await h.api.finish()
  assert.equal(h.state.workouts.size, 1)
})

function storageHarness() {
  const values = new Map()
  let failWrite = false, failRead = false
  const storage = loadSource('src/services/building-storage.ts', {
    '@react-native-async-storage/async-storage': {
      getItem: async key => { if (failRead) throw Error('read failure'); return values.get(key) ?? null },
      setItem: async (key, value) => { if (failWrite) throw Error('write failure'); values.set(key, value) },
      removeItem: async key => { if (failWrite) throw Error('remove failure'); values.delete(key) },
    },
    './storage': { listRoutes: async () => [] },
  })
  return { storage, failWrite(value) { failWrite = value }, failRead(value) { failRead = value } }
}

test('failed building rename does not alter the cache; a subsequent retry persists the name', async () => {
  const h = storageHarness()
  const template = core('fusion-calibration').buildTemplateFromCalibration({
    startFloor: 1, boundaries: [{ t: 0, steps: 0, turns: 0 }, { t: 10000, steps: 20, turns: 2 }], barometer: false, name: 'Original', now: 10000,
  }).template
  await h.storage.saveBuilding(template)
  h.failWrite(true)
  await assert.rejects(h.storage.renameBuilding(template.id, 'Changed'), /保存失败/)
  assert.equal((await h.storage.getBuilding(template.id)).name, 'Original')
  h.failWrite(false)
  await h.storage.renameBuilding(template.id, 'Changed')
  assert.equal((await h.storage.getBuilding(template.id)).name, 'Changed')
})

test('building read failure is visible and a later read can recover', async () => {
  const h = storageHarness()
  h.failRead(true)
  await assert.rejects(h.storage.listBuildings(), /无法读取/)
  await assert.rejects(h.storage.loadFusionCheckpoint(), /恢复点暂时无法读取/)
  h.failRead(false)
  assert.deepEqual(await h.storage.listBuildings(), [])
})

test('checkpoint and calibration draft failures reject so the UI can offer recovery', async () => {
  const h = storageHarness()
  h.failWrite(true)
  await assert.rejects(h.storage.saveFusionCheckpoint(null), /恢复点保存失败/)
  await assert.rejects(h.storage.savePendingTemplate({ workoutId: 'test' }), /标定结果保存失败/)
})
