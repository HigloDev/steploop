const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')

const repo = path.join(__dirname, '..')
const compiled = path.join(repo, 'node_modules/.cache/prd-training-automation')
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--ignoreConfig', '--ignoreDeprecations', '6.0',
  '--lib', 'es2022', '--rootDir', 'src', '--outDir', compiled, '--module', 'commonjs', '--moduleResolution', 'node',
  '--target', 'es2020', '--esModuleInterop', '--skipLibCheck', 'src/core/training-automation.ts',
  'src/core/corrections.ts', 'src/core/workout-machine.ts', 'src/core/workout-summary.ts', 'src/core/analysis.ts',
  'src/core/route-model.ts', 'src/core/route-learning.ts', 'src/core/route-state.ts', 'src/core/sensor-visualization.ts',
  'src/core/recognizer.ts', 'src/core/free-recognizer.ts', 'src/services/round-coordinator.ts',
  'src/services/live-feature-pump.ts', 'src/services/typed-emitter.ts',
  'src/services/workout-evidence-store.ts', 'src/services/recorded-motion-recognizer.ts'], { cwd: repo, stdio: 'inherit' })
const { TrainingAutomation, resolveTrackingMode, trainingPhasePrompt } = require(path.join(compiled, 'core/training-automation.js'))
const { applyRoundCorrection } = require(path.join(compiled, 'core/corrections.js'))
const { RetainedSampleWindow, WorkoutEvidenceJournal } = require(path.join(compiled, 'services/workout-evidence-store.js'))

function input(t, height, steps = 0, extras = {}) {
  return { t, relativeHeightM: height, barometerAvailable: true, steps, ...extras }
}
function observeSeries(engine, from, duration, height, steps = () => 0) {
  const result = []
  for (let ms = 0; ms <= duration; ms += 400) {
    result.push(engine.observe(input(from + ms, height(ms), steps(ms))))
  }
  return result
}
function actions(updates) { return updates.flatMap(update => update.action ? [update.action] : []) }

test('legacy manual and assisted checkpoints map predictably', () => {
  assert.equal(resolveTrackingMode(undefined, 'manual'), 'manual')
  assert.equal(resolveTrackingMode(undefined, 'assisted'), 'automatic')
  assert.equal(resolveTrackingMode('full_auto', 'manual'), 'full_auto')
})

test('manual mode never ends, confirms return, or starts from sensor signals', () => {
  const engine = new TrainingAutomation('manual')
  for (const phase of ['ascending', 'returning', 'recovering', 'round_ready']) {
    engine.enterPhase(phase)
    const results = observeSeries(engine, 10000, 10000, ms => 30 - ms / 1000, ms => ms / 250)
    assert.equal(actions(results).length, 0)
  }
})

test('phase guidance follows return and ready phases without needing another sensor sample', () => {
  assert.match(trainingPhasePrompt('manual', 'ascending'), /结束本轮/)
  assert.match(trainingPhasePrompt('manual', 'round_complete'), /本轮已保存/)
  for (const phase of ['returning', 'start_confirmation']) {
    const prompt = trainingPhasePrompt('manual', phase)
    assert.match(prompt, /确认返回/)
    assert.doesNotMatch(prompt, /结束本轮/)
    const engine = new TrainingAutomation('manual')
    engine.enterPhase(phase)
    assert.equal(engine.observe(input(1000, 0)).status, prompt)
  }
  for (const phase of ['round_ready', 'recovering']) {
    assert.match(trainingPhasePrompt('manual', phase), /开始下一轮/)
    assert.match(trainingPhasePrompt('full_auto', phase), /等待向上脚步/)
  }
})

test('dismissing the actual-floor dialog replaces paused guidance immediately for every mode', () => {
  for (const mode of ['manual', 'automatic', 'full_auto']) {
    assert.match(trainingPhasePrompt(mode, 'returning', true), /自动衔接已暂停/)
    assert.doesNotMatch(trainingPhasePrompt(mode, 'returning', false), /暂停|确认实际楼层/)
    assert.equal(trainingPhasePrompt(mode, 'workout_complete'), '训练已结束')
  }
})

test('automatic mode gives endpoint confirmation without ending the round', () => {
  const engine = new TrainingAutomation('automatic')
  engine.enterPhase('ascending')
  const result = engine.observe(input(1000, 42, 300, { targetReached: true, reliableTarget: true }))
  assert.match(result.status, /确认实际楼层/)
  assert.equal(result.action, undefined)
})

test('full auto detects elevator descent after an ascent, ends exactly once at peak time', () => {
  const engine = new TrainingAutomation('full_auto')
  engine.enterPhase('ascending')
  observeSeries(engine, 1000, 6000, ms => ms / 200, ms => Math.floor(ms / 400))
  const results = observeSeries(engine, 7400, 9000, ms => 30 - ms / 600, () => 15)
  const events = actions(results)
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'finish_round')
  assert.equal(events[0].cause, 'elevator_down')
  assert.equal(events[0].at, 7000)
  assert.ok(results.some(result => result.elevatorDescending))
})

test('walking down stairs does not masquerade as an elevator completion', () => {
  const engine = new TrainingAutomation('full_auto')
  engine.enterPhase('ascending')
  observeSeries(engine, 1000, 4000, ms => 20 + ms / 1000, ms => ms / 400)
  const results = observeSeries(engine, 5400, 8000, ms => 24 - ms / 600, ms => 10 + Math.floor(ms / 400))
  assert.equal(actions(results).length, 0)
})

test('pressure noise and temporary phone handoff do not finish a round', () => {
  const engine = new TrainingAutomation('full_auto')
  engine.enterPhase('ascending')
  const results = observeSeries(engine, 1000, 20000,
    ms => 20 + Math.sin(ms / 1500) * 0.6,
    ms => Math.floor(ms / 600))
  assert.equal(actions(results).length, 0)
})

test('stable pressure at the old start height still requires human return confirmation', () => {
  const engine = new TrainingAutomation('full_auto')
  engine.enterPhase('returning')
  observeSeries(engine, 1000, 4000, () => 40)
  const descending = observeSeries(engine, 5400, 10000, ms => Math.max(0, 40 - ms / 250))
  assert.equal(actions(descending).length, 0)
  const resting = observeSeries(engine, 15800, 12000, () => 0.2)
  assert.deepEqual(actions(resting), [])
  assert.match(resting.at(-1).status, /确认返回/)
  engine.enterPhase('recovering')
  assert.equal(actions(observeSeries(engine, 30000, 30000, () => 0.2)).length, 0)
})

test('return confirmation is not emitted at start before any descent', () => {
  const engine = new TrainingAutomation('full_auto')
  engine.enterPhase('returning')
  assert.equal(actions(observeSeries(engine, 1000, 20000, () => 0)).length, 0)
})

test('passing through the start height while still moving does not confirm arrival', () => {
  const engine = new TrainingAutomation('full_auto')
  engine.enterPhase('returning')
  const results = observeSeries(engine, 1000, 10000, ms => 10 - ms / 400)
  assert.equal(actions(results).length, 0)
})

test('full-auto next round requires upward pressure trend plus at least four steps', () => {
  const engine = new TrainingAutomation('full_auto')
  engine.enterPhase('recovering')
  const result = actions(observeSeries(engine, 1000, 8000, ms => ms / 3000, ms => Math.floor(ms / 550)))
  assert.equal(result.length, 1)
  assert.equal(result[0].type, 'begin_next_round')
  assert.ok(result[0].climbStartedAt < result[0].at)
})

test('elevator ascent, stillness and level walking do not begin a stair round', () => {
  for (const [height, steps] of [
    [ms => ms / 500, () => 0],
    [() => 0.2, () => 0],
    [ms => Math.sin(ms / 1000) * 0.1, ms => Math.floor(ms / 500)],
  ]) {
    const engine = new TrainingAutomation('full_auto')
    engine.enterPhase('recovering')
    assert.equal(actions(observeSeries(engine, 1000, 20000, height, steps)).length, 0)
  }
})

test('automatic return/start suggestions require user confirmation', () => {
  const engine = new TrainingAutomation('automatic')
  engine.enterPhase('returning')
  observeSeries(engine, 1000, 4000, () => 40)
  observeSeries(engine, 5400, 10000, ms => Math.max(0, 40 - ms / 250))
  const resting = observeSeries(engine, 15800, 8000, () => 0.1)
  assert.equal(actions(resting).length, 0)
  assert.match(resting.at(-1).status, /确认返回/)
  engine.enterPhase('recovering')
  const climb = observeSeries(engine, 26000, 8000, ms => ms / 3000, ms => Math.floor(ms / 550))
  assert.equal(actions(climb).length, 0)
  assert.match(climb.at(-1).status, /开始下一轮/)
})

test('missing barometer, out-of-order times and gaps cannot trigger fabricated movement', () => {
  const engine = new TrainingAutomation('full_auto')
  engine.enterPhase('recovering')
  engine.observe(input(1000, 0, 0))
  engine.observe(input(1400, 0.2, 1))
  assert.equal(engine.observe(input(10000, 8, 100)).action, undefined)
  assert.equal(engine.observe(input(9000, 9, 105)).action, undefined)
  const missing = engine.observe(input(10400, undefined, 105, { barometerAvailable: false }))
  assert.match(missing.status, /气压计不可用/)
  assert.equal(missing.action, undefined)
})

test('switching to manual cancels motion holds; switching back requires fresh evidence', () => {
  const engine = new TrainingAutomation('full_auto')
  engine.enterPhase('recovering')
  observeSeries(engine, 1000, 2000, ms => ms / 3000, ms => Math.floor(ms / 550))
  engine.setMode('manual')
  assert.equal(engine.observe(input(3400, 1, 6)).action, undefined)
  engine.setMode('full_auto')
  assert.equal(engine.observe(input(4000, 1.2, 7)).action, undefined)
})

function originalRound() {
  return { id: 'round', roundNumber: 1, startedAt: 1000, endedAt: 100000,
    durationMs: 50000, floorCounting: 'transitions', startFloor: 1, targetFloor: 15,
    finalFloor: 12, floorsCompleted: 11, ascentM: 33, steps: 180, confidence: 0.4,
    complete: false, completionReason: 'manual_finish', floorSplits: [], events: [], interruptions: [],
    trustworthy: false, completionSource: 'automatic' }
}
test('15 actual vs 12 recognized records a preserved correction and fourteen ascent floors', () => {
  const original = originalRound()
  const corrected = applyRoundCorrection(original,
    { finalFloor: 15, floorsCompleted: 14, ascentM: 42, complete: true }, { at: 110000 })
  assert.equal(corrected.finalFloor, 15)
  assert.equal(corrected.floorsCompleted, 14)
  assert.equal(corrected.corrections[0].before.finalFloor, 12)
  assert.equal(corrected.corrections[0].after.finalFloor, 15)
  assert.equal(original.finalFloor, 12)
  assert.equal(corrected.confidence, original.confidence)
  assert.equal(corrected.trustworthy, false)
})
test('ending at start floor preserves a zero-ascent round and does not invent calories or height', () => {
  const corrected = applyRoundCorrection(originalRound(),
    { finalFloor: 1, floorsCompleted: 0, ascentM: 0, complete: false }, { at: 110000 })
  assert.equal(corrected.finalFloor, 1)
  assert.equal(corrected.floorsCompleted, 0)
  assert.equal(corrected.ascentM, 0)
  assert.equal(corrected.complete, false)
})

function sample(t) { return { t, ax: 1, ay: 2, az: 3, gx: 4, gy: 5, gz: 6, alpha: 7, beta: 8, gamma: 9, pressure: 1000 - t / 1e6 } }
test('live raw sample windows are bounded without modifying retained values or timestamps', () => {
  const window = new RetainedSampleWindow(100)
  for (let t = 0; t < 400000; t += 20) window.push(sample(t))
  const records = window.snapshot()
  assert.equal(records.length, 100)
  assert.equal(records.at(-1).t, 399900)
  assert.equal(records.at(-1).pressure, sample(399900).pressure)
  assert.equal(records[1].t - records[0].t, 100)
})

test('evidence persists incrementally, all phases, gaps and corrections in immutable chunks', () => {
  const files = new Map()
  const journal = new WorkoutEvidenceJournal({ workoutId: 'workout', roundNumber: 2, phase: 'returning', startedAt: 0 },
    { write: (name, content) => { assert.equal(files.has(name), false); files.set(name, content) } }, undefined, 'fixed-evidence')
  for (let t = 0; t <= 7000; t += 20) journal.pushSample(sample(t))
  assert.ok(files.size >= 4, 'journal flushes before finishing the workout')
  journal.gap(7200, 10000)
  journal.event('user_confirmed_floor', 10200, { before: 12, after: 15 })
  journal.close(11000)
  const chunks = [...files.values()].map(JSON.parse)
  const records = chunks.flatMap(chunk => chunk.records)
  assert.equal(records.filter(record => record.kind === 'sensor').length, 71)
  assert.ok(records.some(record => record.kind === 'gap' && record.startAt === 7200))
  assert.ok(records.some(record => record.kind === 'event' && record.detail?.after === 15))
  assert.ok(chunks.every(chunk => chunk.context.phase === 'returning'))
  assert.ok(chunks.every(chunk => chunk.sampling.method === 'original_sample_downsample'))
})

test('extended disk failure remains bounded and reports loss explicitly after recovery', () => {
  let failed = true
  let recovered
  const errors = []
  const journal = new WorkoutEvidenceJournal({ workoutId: 'workout', roundNumber: 1, phase: 'ascending', startedAt: 0 },
    { write: (_name, content) => { if (failed) throw new Error('disk full'); recovered = JSON.parse(content) } },
    message => errors.push(message), 'disk-failure')
  for (let t = 0; t < 400000; t += 100) journal.pushSample(sample(t))
  failed = false
  assert.equal(journal.flush(400000), true)
  assert.ok(recovered.records.length <= 1201)
  assert.equal(recovered.records[0].kind, 'retention_loss')
  assert.ok(recovered.records[0].omittedRecords > 0)
  assert.ok(errors.some(message => message.includes('disk full')))
  assert.equal(errors.at(-1), '')
})

// Run the actual orchestration hook with a deterministic hook scheduler and injected
// hardware/storage boundaries. This tests the user actions and persistence wiring,
// rather than assuming that an isolated detector is connected to the training flow.
function workoutHarness({ noRecognizer = false, saveFailsOnce = false, nativeStopFailures = 0,
  nativeAvailable = false, routeAvailable = false, firstCalibration = false, sessionOverrides = {},
  beforeBackgroundStop, lifecycle = [], trackingMode = 'manual', clockAt, saveBarrier, backgroundStartBarrier, hardware } = {}) {
  const ts = require('typescript')
  const fs = require('node:fs')
  const slots = []
  let cursor = 0
  let effects = []
  let dirty = false
  let current
  let roundOptions
  let starts = 0
  let modelUpdates = 0
  let saved
  let failNextSave = saveFailsOnce
  const nativeSupported = nativeAvailable || nativeStopFailures > 0
  let stopFailuresLeft = nativeStopFailures
  const checkpoints = []
  const recorders = []
  const journals = []
  const evidenceFiles = new Map()
  const captureLifecycle = []
  const clock = clockAt === undefined ? undefined : { now: clockAt }
  const hookDate = clock ? class extends Date { static now() { return clock.now } } : Date
  const timers = new Map()
  const addTimer = (fn, delay, repeat = false) => {
    // finishWorkout's asynchronous yield must settle without advancing a countdown.
    if (!clock || (!repeat && delay === 0)) return repeat ? setInterval(fn, delay) : setTimeout(fn, delay)
    const token = {}
    timers.set(token, { fn, at: clock.now + delay, repeat: repeat ? delay : 0 })
    return token
  }
  const removeTimer = (token, repeat = false) => {
    if (timers.delete(token)) return
    if (repeat) clearInterval(token)
    else clearTimeout(token)
  }
  const advanceTime = (ms) => {
    assert.ok(clock, 'this scenario must opt into the deterministic clock')
    const target = clock.now + ms
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      const [token, timer] = next
      clock.now = timer.at
      if (timer.repeat) timer.at += timer.repeat
      else timers.delete(token)
      timer.fn()
    }
    clock.now = target
  }
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const react = {
    useState(init) {
      const i = cursor++
      if (!slots[i]) slots[i] = { value: typeof init === 'function' ? init() : init }
      return [slots[i].value, next => {
        const value = typeof next === 'function' ? next(slots[i].value) : next
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true }
      }]
    },
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }) },
    useMemo(fn, deps) {
      const i = cursor++
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps }
      return slots[i].value
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps) },
    useEffect(fn, deps) {
      const i = cursor++
      if (!slots[i] || !same(slots[i].deps, deps)) {
        const previous = slots[i]
        slots[i] = { deps, cleanup: previous?.cleanup }
        effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn() })
      }
    },
  }
  const session = { id: 'sensor-session', templateId: 'route', templateVersion: 1,
    startedAt: Date.now() - 90000, endedAt: Date.now(), startFloor: 1, finalFloor: 12,
    floorsCompleted: 12, ascentM: 33, steps: 200, confidence: 0.4, complete: false,
    events: [], floorSplits: [], interruptions: [], durationMs: 60000, mode: 'formal',
    samples: [sample(Date.now())], evidenceId: 'raw-evidence',
    routeSnapshot: { name: 'route', locationName: 'route', startFloor: 1, endFloor: 15, totalAscentM: 42 },
    ...sessionOverrides }
  const round = {
    snapshot: { currentFloor: 12, steps: 200, activeMs: 60000, floorsCompleted: 12, ascentM: 33,
      confidence: 0.4, status: 'matching', quality: 'degraded', statusReason: '', canAutoComplete: false, activeSensorSources: [] },
    start: async () => { starts += 1 }, finish: () => noRecognizer ? null : session,
    cleanup: () => {}, cancelAutoComplete: () => {}, flushEvidence: () => {},
  }
  const template = { id: 'route', name: 'route', version: 1, startFloor: 1, endFloor: 15,
    floorHeightM: 3, totalAscentM: 42, segments: firstCalibration ? [] : [{ floorFrom: 1, floorTo: 2,
      stepCount: 20, ascentM: 3, startMs: 0, endMs: 6000, features: [] }], markers: [], carryMode: 'hand',
    status: firstCalibration ? 'draft' : 'verified', createdAt: 0, updatedAt: 0 }
  let persistedRoute = template
  const savedRoutes = []
  const newJournal = (context, onError) => {
    const id = `monitor-${journals.length + 1}`
    const journal = new WorkoutEvidenceJournal(context, { write: (name, content) => {
      assert.equal(evidenceFiles.has(name), false, 'a retained chunk is immutable')
      evidenceFiles.set(name, JSON.parse(content))
      captureLifecycle.push({ type: 'write', id, phase: context.phase })
    } }, onError, id)
    const push = journal.pushSample.bind(journal)
    const close = journal.close.bind(journal)
    journal.receivedSamples = []
    journal.closedByOwner = false
    journal.pushSample = value => { journal.receivedSamples.push(value); push(value) }
    journal.close = at => {
      journal.closedByOwner = true
      captureLifecycle.push({ type: 'close', id, phase: context.phase })
      return close(at)
    }
    journals.push(journal)
    return journal
  }
  const mockStorage = {
    createWorkout: options => ({ ...options, id: 'workout', status: 'active', startedAt: Date.now(),
      rounds: [], currentRoundNumber: 1, totalRoundsCompleted: 0, totalFloorsCompleted: 0,
      totalSteps: 0, totalAscentM: 0, activeDurationMs: 0, returnDurationMs: 0, recoveryDurationMs: 0,
      totalElapsedMs: 0, createdAt: Date.now(), updatedAt: Date.now() }),
    saveWorkout: async workout => {
      if (failNextSave) { failNextSave = false; throw new Error('disk write failed') }
      captureLifecycle.push({ type: 'save_enter' })
      if (saveBarrier) await saveBarrier(workout)
      saved = workout; lifecycle.push('saved'); captureLifecycle.push({ type: 'saved' })
    },
    saveActiveCheckpoint: async cp => { checkpoints.push(cp) }, clearActiveCheckpoint: async () => {},
    listWorkouts: async () => saved ? [saved] : [], loadActiveCheckpoint: async () => null,
  }
  function injectedRequire(name) {
    if (name === 'react') return react
    if (name === 'react-native') return { AppState: { addEventListener: () => ({ remove() {} }) } }
    if (name === './useClimbRoundSession') return { useClimbRoundSession: options => { roundOptions = options; return round } }
    if (name === '../services/workout-storage') return mockStorage
    if (name === '../services/storage') return {
      getRoute: async () => routeAvailable ? persistedRoute : undefined,
      saveRoute: async route => {
        persistedRoute = require(path.join(compiled, 'core/route-model.js')).migrateRouteToV3(route)
        savedRoutes.push(persistedRoute)
      },
    }
    if (name === '../services/sensor' && hardware) return { SensorRecorder: class extends hardware.SensorRecorder {
      constructor(options) { super(options); this.journal = journals.at(-1); this.stops = 0; recorders.push(this) }
      async start() { await super.start(); captureLifecycle.push({ type: 'start', id: this.journal.id, phase: this.journal.context.phase }) }
      async stop() { this.stops += 1; const result = await super.stop(); captureLifecycle.push({ type: 'stop', id: this.journal.id, phase: this.journal.context.phase }); return result }
    } }
    if (name === '../services/sensor') return { SensorRecorder: class {
      constructor(options) { this.options = options; this.journal = journals.at(-1); this.running = false; this.stops = 0; recorders.push(this) }
      getStartedAt() { return this.journal.context.startedAt }
      async start() { this.running = true; captureLifecycle.push({ type: 'start', id: this.journal.id, phase: this.journal.context.phase }) }
      async stop() { this.running = false; this.stops += 1; captureLifecycle.push({ type: 'stop', id: this.journal.id, phase: this.journal.context.phase }); return [] }
    } }
    if (name === '../services/workout-evidence') return { createWorkoutEvidenceJournal: newJournal, recordWorkoutEvidenceEvent() {} }
    if (name === '../services/background-training') return { isBackgroundTrainingSupported: () => nativeSupported,
      startBackgroundTraining: async () => { if (backgroundStartBarrier) await backgroundStartBarrier; return { running: nativeSupported } },
      stopBackgroundTraining: async () => { if (stopFailuresLeft-- > 0) throw new Error('native stop rejected'); lifecycle.push('stopped'); captureLifecycle.push({ type: 'native_stopped' }); return { running: false } } }
    if (name === '../core/route-model') {
      const routeModel = require(path.join(compiled, 'core/route-model.js'))
      return { ...routeModel, updateRouteModelFromWorkouts: (...args) => {
        modelUpdates += 1; return routeModel.updateRouteModelFromWorkouts(...args)
      } }
    }
    if (name.startsWith('../core/')) return require(path.join(compiled, name.slice(3) + '.js'))
    throw new Error(`Unmocked boundary: ${name}`)
  }
  const source = ts.transpileModule(fs.readFileSync(path.join(repo, 'src/hooks/useClimbWorkout.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', source)(
    injectedRequire, module, module.exports, hookDate,
    (fn, delay) => addTimer(fn, delay), token => removeTimer(token),
    (fn, delay) => addTimer(fn, delay, true), token => removeTimer(token, true))
  const options = { template, goal: { type: 'open' }, returnConfirmationMode: 'manual', trackingMode, bodyWeightKg: 75, beforeBackgroundStop }
  const render = () => {
    for (let i = 0; i < 30; i++) {
      cursor = 0; dirty = false
      current = module.exports.useClimbWorkout(options)
      const pending = effects; effects = []
      pending.forEach(run => run())
      if (!dirty) return current
    }
    throw new Error('hook render did not settle')
  }
  const settle = async () => { render(); await new Promise(resolve => setImmediate(resolve)); return render() }
  const cleanup = () => { for (const slot of slots) slot?.cleanup?.(); timers.clear() }
  render()
  return { get result() { return current }, get roundOptions() { return roundOptions }, get starts() { return starts },
    get saved() { return saved }, get modelUpdates() { return modelUpdates },
    get route() { return persistedRoute }, get now() { return hookDate.now() },
    savedRoutes, checkpoints, render, settle, cleanup, advanceTime,
    recorders, journals, evidenceFiles, captureLifecycle,
    get activeRecorder() { return recorders.findLast(recorder => recorder.running) },
    emitComplete: () => roundOptions.onComplete?.({ ...session, complete: true }) }
}

function emitMonitorMotion(harness, duration, height = () => 0, stepping = false) {
  const recorder = harness.activeRecorder
  assert.ok(recorder, `an active ${harness.result.phase} recorder is required`)
  const from = harness.now
  const delivered = []
  for (let ms = 0; ms <= duration; ms += 100) {
    if (!recorder.running) break
    if (ms) harness.advanceTime(100)
    const point = { t: from + ms, ax: 0, ay: 0, az: stepping && ms > 0 && ms % 600 === 0 ? 1.6 : 1,
      gx: 0, gy: 0, gz: 0, alpha: 0, beta: 0, gamma: 0,
      pressure: 1000 - height(ms) / 8.3 }
    recorder.options.onBarometer?.({ available: true, running: true, pressure: point.pressure, lastSampleAt: point.t })
    recorder.options.onSample(point)
    delivered.push(point)
    harness.render()
  }
  return delivered
}

function retainedSensors(harness, phase) {
  return [...harness.evidenceFiles.values()].filter(chunk => !phase || chunk.context.phase === phase)
    .flatMap(chunk => chunk.records).filter(record => record.kind === 'sensor').map(record => record.sample)
}

// Execute the real recorder with deterministic permission, native-bridge and Expo
// adapter boundaries. Its lifecycle/gap/cancellation implementation is not mocked.
function sensorHardware({ clockAt = 100000, privacyBarrier, privacyError, privacyRead, statusBarrier, drainBarrier, nativeAvailable = false } = {}) {
  const ts = require('typescript'), fs = require('node:fs')
  let now = clockAt
  const subscriptions = new Map(), timers = new Map()
  const calls = { nativeSubscriptions: 0, nativeStatusReads: 0, nativeDrains: 0 }
  const subscribe = (name, callback, value) => {
    const token = { name, remove() { subscriptions.delete(token) } }
    subscriptions.set(token, callback)
    callback(value)
    return token
  }
  const adapter = {
    setAccelerometerInterval() {}, setGyroscopeInterval() {}, setDeviceMotionInterval() {}, setBarometerInterval() {},
    subscribeAccelerometer: cb => subscribe('accel', cb, { x: 0, y: 0, z: 1 }),
    subscribeGyroscope: cb => subscribe('gyro', cb, { x: 0, y: 0, z: 0 }),
    subscribeDeviceMotion: cb => subscribe('motion', cb, { rotation: { alpha: 0, beta: 0, gamma: 0 } }),
    subscribeBarometer: cb => subscribe('baro', cb, { pressure: 1000 }),
  }
  const addTimer = (fn, delay, repeat = false) => {
    const token = {}
    timers.set(token, { fn, at: now + delay, repeat: repeat ? delay : 0 })
    return token
  }
  const advanceTime = ms => {
    const target = now + ms
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      const [token, timer] = next
      now = timer.at
      if (timer.repeat) timer.at += timer.repeat
      else timers.delete(token)
      timer.fn()
    }
    now = target
  }
  const runtime = {
    Date: class extends Date { static now() { return now } },
    setTimeout: (fn, delay) => addTimer(fn, delay), clearTimeout: token => timers.delete(token),
    setInterval: (fn, delay) => addTimer(fn, delay, true), clearInterval: token => timers.delete(token),
  }
  const module = { exports: {} }
  const injectedRequire = name => {
    if (name === './privacy') return { PrivacyAuthorizeError: class extends Error {},
      ensurePrivacyAuthorized: async () => {
        if (privacyRead) { await privacyRead(); return }
        if (privacyBarrier) await privacyBarrier
        if (privacyError) throw privacyError
      } }
    if (name === './sensor-adapter') return { expoSensorAdapter: adapter }
    if (name === './typed-emitter') return require(path.join(compiled, 'services/typed-emitter.js'))
    if (name === './background-training') return { isBackgroundTrainingSupported: () => nativeAvailable,
      getBackgroundTrainingStatus: async () => { calls.nativeStatusReads += 1; if (statusBarrier) await statusBarrier; return { running: true, sessionId: 'workout', latestSequence: 0 } },
      subscribeBackgroundSamples: callback => { calls.nativeSubscriptions += 1; return subscribe('native', callback, { ...sample(now), sessionId: 'workout', seq: 1 }) },
      drainBackgroundSamples: async () => { calls.nativeDrains += 1; if (drainBarrier) await drainBarrier; return { sessionId: 'workout', samples: [], latestSequence: 1 } },
    }
    throw new Error(`Unmocked recorder boundary: ${name}`)
  }
  const source = ts.transpileModule(fs.readFileSync(path.join(repo, 'src/services/sensor.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  new Function('require', 'module', 'exports', ...Object.keys(runtime), source)(injectedRequire, module, module.exports, ...Object.values(runtime))
  return { ...runtime, adapter, advanceTime, calls, subscriptions, timers,
    emit: (name, value) => { for (const [subscription, callback] of [...subscriptions]) if (subscription.name === name) callback(value) },
    SensorRecorder: module.exports.SensorRecorder, get now() { return now } }
}

function singleRoundHarness(hardware) {
  const ts = require('typescript'), fs = require('node:fs')
  const slots = [], journals = [], chunks = [], recorders = [], observations = [], gaps = []
  let cursor = 0, dirty = false, effects = [], current
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const react = {
    useState(initial) {
      const i = cursor++
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true } }]
    },
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }) },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps) },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) {
      const previous = slots[i]; slots[i] = { deps, cleanup: previous?.cleanup }
      effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn() })
    } },
  }
  const newJournal = (context, onError) => {
    const journal = new WorkoutEvidenceJournal(context, { write: (_name, content) => chunks.push(JSON.parse(content)) }, onError, `actual-round-${journals.length + 1}`)
    journals.push(journal)
    return journal
  }
  const injectedRequire = name => {
    if (name === 'react') return react
    if (name === '../services/sensor') return { SensorRecorder: class extends hardware.SensorRecorder {
      constructor(options) { super(options); recorders.push(this) }
    } }
    if (name === '../services/sensor-adapter') return { expoSensorAdapter: hardware.adapter }
    if (name === '../services/preferences') return { triggerHapticPattern() {}, triggerSound() {} }
    if (name === '../services/workout-evidence') return { WorkoutEvidenceJournal, RetainedSampleWindow, createWorkoutEvidenceJournal: newJournal }
    if (name.startsWith('../core/') || name === '../services/round-coordinator' || name === '../services/live-feature-pump' || name === '../services/recorded-motion-recognizer') {
      return require(path.join(compiled, name.slice(3) + '.js'))
    }
    throw new Error(`Unmocked round-hook boundary: ${name}`)
  }
  const source = ts.transpileModule(fs.readFileSync(path.join(repo, 'src/hooks/useClimbRoundSession.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const module = { exports: {} }
  const runtime = { Date: hardware.Date, setTimeout: hardware.setTimeout, clearTimeout: hardware.clearTimeout,
    setInterval: hardware.setInterval, clearInterval: hardware.clearInterval }
  new Function('require', 'module', 'exports', ...Object.keys(runtime), source)(injectedRequire, module, module.exports, ...Object.values(runtime))
  const options = { template: { id: 'route', name: 'route', version: 1, status: 'draft', startFloor: 1, endFloor: 15,
    floorHeightM: 3, totalAscentM: 42, segments: [], markers: [], carryMode: 'hand', createdAt: 0, updatedAt: 0 },
    mode: 'free', autoComplete: false, keepRunningInBackground: false, sensorAdapter: hardware.adapter,
    evidenceContext: { workoutId: 'workout', roundNumber: 1, phase: 'ascending', startedAt: hardware.now },
    onObservation: (point, motion) => observations.push({ point, motion }), onGap: gap => gaps.push(gap) }
  const render = () => {
    for (let i = 0; i < 30; i++) {
      cursor = 0; dirty = false; current = module.exports.useClimbRoundSession(options)
      const pending = effects; effects = []; pending.forEach(run => run())
      if (!dirty) return current
    }
    throw new Error('round-hook render did not settle')
  }
  const settle = async () => { render(); await new Promise(resolve => setImmediate(resolve)); return render() }
  const cleanup = () => { current.cleanup(); for (const slot of slots) slot?.cleanup?.() }
  render()
  return { get result() { return current }, options, render, settle, cleanup, journals, chunks, recorders, observations, gaps }
}

test('actual recorder cancellation survives a pending privacy read, including a late rejection', async () => {
  for (const privacyError of [undefined, new Error('late privacy read rejected')]) {
    let releasePrivacy
    const blocked = new Promise(resolve => { releasePrivacy = resolve })
    const hardware = sensorHardware({ privacyBarrier: blocked, privacyError })
    const statuses = []
    const recorder = new hardware.SensorRecorder({ onStatus: status => statuses.push(status) })
    const startup = recorder.start()
    try {
      await recorder.stop()
      const statusCount = statuses.length
      releasePrivacy()
      await assert.doesNotReject(startup)
      assert.equal(hardware.subscriptions.size, 0, 'a cancelled privacy await cannot subscribe late')
      assert.equal(statuses.length, statusCount, 'an obsolete failure cannot overwrite the current owner state')
      assert.equal(hardware.timers.size, 0)
    } finally { releasePrivacy(); await startup.catch(() => undefined); await recorder.stop() }
  }
})

test('actual recorder stop while native status is pending prevents subscriptions and obsolete status reports', async () => {
  let releaseStatus
  const blocked = new Promise(resolve => { releaseStatus = resolve })
  const hardware = sensorHardware({ nativeAvailable: true, statusBarrier: blocked })
  const statuses = []
  const recorder = new hardware.SensorRecorder({ keepRunningInBackground: true, onStatus: status => statuses.push(status) })
  const startup = recorder.start()
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(hardware.calls.nativeStatusReads, 1)
    await recorder.stop()
    const statusCount = statuses.length
    releaseStatus()
    await assert.doesNotReject(startup)
    assert.equal(hardware.calls.nativeSubscriptions, 0)
    assert.equal(hardware.subscriptions.size, 0)
    assert.equal(hardware.timers.size, 0)
    assert.equal(statuses.length, statusCount)
  } finally { releaseStatus(); await startup.catch(() => undefined); await recorder.stop() }
})

test('an obsolete privacy rejection cannot clean up a newer generation of the same actual recorder', async () => {
  let rejectOldPrivacy, reads = 0
  const oldPrivacy = new Promise((_resolve, reject) => { rejectOldPrivacy = reject })
  const hardware = sensorHardware({ privacyRead: () => ++reads === 1 ? oldPrivacy : Promise.resolve() })
  const statuses = []
  const recorder = new hardware.SensorRecorder({ onStatus: status => statuses.push(status) })
  const oldStart = recorder.start()
  try {
    await recorder.stop()
    await recorder.start()
    assert.equal(hardware.subscriptions.size, 4)
    const generation = recorder.getGeneration(), statusCount = statuses.length
    rejectOldPrivacy(new Error('old permission read failed'))
    await assert.doesNotReject(oldStart)
    assert.equal(recorder.getGeneration(), generation)
    assert.equal(hardware.subscriptions.size, 4)
    assert.equal(statuses.length, statusCount)
    const before = recorder.getSamples().length
    hardware.advanceTime(100)
    hardware.emit('accel', { x: 0, y: 0, z: 1.2 })
    assert.equal(recorder.getSamples().length, before + 1, 'the new generation continues recording')
  } finally { rejectOldPrivacy(new Error('cleanup')); await oldStart.catch(() => undefined); await recorder.stop() }
})

test('a cancelled native replay cannot remove or publish status over a newly started generation', async () => {
  let releaseDrain
  const blocked = new Promise(resolve => { releaseDrain = resolve })
  const hardware = sensorHardware({ nativeAvailable: true, drainBarrier: blocked })
  const statuses = []
  const recorder = new hardware.SensorRecorder({ keepRunningInBackground: true, onStatus: status => statuses.push(status) })
  const oldStart = recorder.start()
  let newStart
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(hardware.calls.nativeDrains, 1)
    await recorder.stop()
    newStart = recorder.start()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(hardware.calls.nativeDrains, 2)
    releaseDrain(); await oldStart; await newStart
    assert.equal(hardware.subscriptions.size, 1, 'only the new native subscription remains')
    assert.equal(statuses.filter(status => status.signal === 'good').length, 1)
    const before = recorder.getSamples().length
    hardware.advanceTime(100)
    hardware.emit('native', { ...sample(hardware.now), sessionId: 'workout', seq: 2 })
    assert.equal(recorder.getSamples().length, before + 1)
    await recorder.stop()
    assert.equal(hardware.subscriptions.size, 0)
    assert.equal(hardware.timers.size, 0)
  } finally { releaseDrain(); await oldStart.catch(() => undefined); if (newStart) await newStart.catch(() => undefined); await recorder.stop() }
})

test('actual native resume closes one measured gap before stop and keeps later interruptions separate', async () => {
  for (const resumedSequence of [2, 3]) {
    const hardware = sensorHardware({ nativeAvailable: true })
    const gaps = []
    const recorder = new hardware.SensorRecorder({ keepRunningInBackground: true, onGap: gap => gaps.push({ ...gap }) })
    try {
      await recorder.start()
      hardware.advanceTime(5000)
      await new Promise(resolve => setImmediate(resolve))
      const drainsBeforeResume = hardware.calls.nativeDrains
      hardware.emit('native', { ...sample(hardware.now), sessionId: 'workout', seq: resumedSequence })
      await new Promise(resolve => setImmediate(resolve))
      assert.deepEqual(gaps, [{ startMs: 0, endMs: 5000 }])
      assert.equal(hardware.calls.nativeDrains - drainsBeforeResume, resumedSequence === 3 ? 1 : 0,
        'a simultaneous sequence jump really uses replay, but does not create another time gap')
      hardware.advanceTime(100)
      hardware.emit('native', { ...sample(hardware.now), sessionId: 'workout', seq: resumedSequence + 1 })
      hardware.advanceTime(4000)
      await new Promise(resolve => setImmediate(resolve))
      hardware.emit('native', { ...sample(hardware.now), sessionId: 'workout', seq: resumedSequence + 2 })
      await new Promise(resolve => setImmediate(resolve))
      const expected = [{ startMs: 0, endMs: 5000 }, { startMs: 5100, endMs: 9100 }]
      assert.deepEqual(gaps, expected, 'two interruptions retain their own original intervals')
      hardware.advanceTime(100)
      await recorder.stop()
      assert.deepEqual(gaps, expected, 'stopping after recovery cannot extend a closed interruption')
      assert.equal(hardware.subscriptions.size, 0)
      assert.equal(hardware.timers.size, 0)
    } finally { await recorder.stop() }
  }
})

test('actual native stop preserves a terminal interruption that has not resumed', async () => {
  const hardware = sensorHardware({ nativeAvailable: true })
  const gaps = []
  const recorder = new hardware.SensorRecorder({ keepRunningInBackground: true, onGap: gap => gaps.push({ ...gap }) })
  try {
    await recorder.start()
    hardware.advanceTime(4500)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(gaps, [], 'an open interruption is not closed before data or stop supplies its end')
    await recorder.stop()
    assert.deepEqual(gaps, [{ startMs: 0, endMs: 4500 }])
    await recorder.stop()
    assert.equal(gaps.length, 1, 'repeated stop cannot duplicate the terminal interval')
    assert.equal(hardware.subscriptions.size, 0)
    assert.equal(hardware.timers.size, 0)
  } finally { await recorder.stop() }
})

test('continuous native acquisition replay clears a stale watchdog without inventing lost samples', async () => {
  const hardware = sensorHardware({ nativeAvailable: true })
  const gaps = [], retained = []
  const recorder = new hardware.SensorRecorder({ keepRunningInBackground: true,
    onGap: gap => gaps.push({ ...gap }), onSample: point => retained.push(point) })
  try {
    await recorder.start()
    const origin = recorder.getStartedAt()
    hardware.advanceTime(5000)
    await new Promise(resolve => setImmediate(resolve))
    for (let i = 1; i <= 50; i++) {
      hardware.emit('native', { ...sample(origin + i * 100), sessionId: 'workout', seq: i + 1 })
    }
    assert.equal(retained.length, 51)
    assert.equal(retained.at(-1).t, hardware.now)
    await recorder.stop()
    assert.deepEqual(gaps, [], 'the retained acquisition timeline is continuous despite delayed JS delivery')
    assert.equal(hardware.subscriptions.size, 0)
  } finally { await recorder.stop() }
})

test('an actual waiting recorder stopped during privacy startup cannot outlive its phase', async () => {
  let releasePrivacy
  const blocked = new Promise(resolve => { releasePrivacy = resolve })
  const hardware = sensorHardware({ privacyBarrier: blocked })
  const harness = workoutHarness({ hardware, clockAt: hardware.now })
  try {
    harness.result.startWorkout(); await harness.settle()
    const ready = harness.recorders[0]
    assert.ok(ready)
    harness.result.beginAscending(); await harness.settle()
    releasePrivacy(); await harness.settle()
    assert.equal(harness.result.phase, 'ascending')
    assert.equal(harness.activeRecorder, undefined)
    assert.equal(hardware.subscriptions.size, 0)
    assert.equal(ready.journal.closedByOwner, true)
    assert.doesNotMatch(harness.result.automationStatus, /启动失败|监测不可用/)
  } finally { releasePrivacy(); harness.cleanup(); for (const recorder of harness.recorders) await recorder.stop() }
})

test('waiting completion retains an actual interrupted terminal gap with its original acquisition times', async () => {
  let releasePrivacy
  const blocked = new Promise(resolve => { releasePrivacy = resolve })
  const hardware = sensorHardware({ privacyBarrier: blocked })
  const harness = workoutHarness({ hardware, clockAt: hardware.now })
  try {
    harness.result.startWorkout(); await harness.settle()
    hardware.advanceTime(750); harness.advanceTime(750)
    releasePrivacy(); await harness.settle()
    const recorder = harness.activeRecorder
    const origin = recorder.getStartedAt()
    assert.equal(origin - recorder.journal.context.startedAt, 750, 'phase journal and acquisition clocks intentionally differ')
    const emitted = []
    recorder.on('gap', gap => emitted.push(gap))
    hardware.advanceTime(4500); harness.advanceTime(4500); harness.render()
    await harness.result.finishWorkout(); await harness.settle()
    assert.deepEqual(emitted, [{ startMs: 0, endMs: 4500 }])
    const retained = [...harness.evidenceFiles.values()].flatMap(chunk => chunk.records).filter(record => record.kind === 'gap')
    assert.equal(retained.length, 1)
    assert.equal(retained[0].startAt, origin)
    assert.equal(retained[0].endAt, origin + 4500)
    assert.equal(hardware.subscriptions.size, 0)
    assert.equal(harness.result.phase, 'workout_complete')
  } finally { releasePrivacy(); harness.cleanup(); for (const recorder of harness.recorders) await recorder.stop() }
})

test('actual ascending terminal gaps stay in their owner journal and late samples cannot reach the next round', async () => {
  const hardware = sensorHardware()
  const harness = singleRoundHarness(hardware)
  try {
    await harness.result.start({ startedAt: hardware.now - 2000, seedSamples: [sample(hardware.now - 2000)] }); await harness.settle()
    const first = harness.recorders[0]
    const origin = first.getStartedAt()
    assert.equal(origin - harness.journals[0].context.startedAt, 2000, 'full-auto seed precedes recorder acquisition')
    hardware.advanceTime(4500); harness.render()
    const session = harness.result.finish(); await harness.settle()
    assert.ok(session)
    const retained = harness.chunks.flatMap(chunk => chunk.records).filter(record => record.kind === 'gap')
    assert.equal(retained.length, 1)
    assert.equal(retained[0].startAt, origin)
    assert.equal(retained[0].endAt, origin + 4500)
    assert.equal(harness.gaps.length, 0, 'the stopped recognizer does not receive the terminal gap')
    harness.options.evidenceContext = { ...harness.options.evidenceContext, roundNumber: 2 }
    await harness.result.start(); await harness.settle()
    const observations = harness.observations.length
    const stale = { ...sample(hardware.now + 100), ax: 99 }
    first.options.onSample(stale)
    first.options.onGap?.({ startMs: 5000, endMs: 9000 })
    harness.render()
    assert.equal(harness.observations.length, observations)
    const second = harness.result.finish(); await harness.settle()
    assert.ok(second.samples.every(point => point.ax !== 99))
    const secondRecords = harness.chunks.filter(chunk => chunk.context.roundNumber === 2).flatMap(chunk => chunk.records)
    assert.equal(secondRecords.filter(record => record.kind === 'gap').length, 0)
    assert.equal(secondRecords.filter(record => record.kind === 'sensor' && record.sample.ax === 99).length, 0)
    assert.equal(hardware.subscriptions.size, 0)
  } finally { harness.cleanup(); for (const recorder of harness.recorders) await recorder.stop() }
})

test('an actual resumed ascent journals a normal gap once and still informs its current recognizer', async () => {
  const hardware = sensorHardware()
  const harness = singleRoundHarness(hardware)
  try {
    await harness.result.start({ startedAt: hardware.now - 2000 }); await harness.settle()
    const origin = harness.recorders[0].getStartedAt()
    hardware.advanceTime(4500)
    hardware.emit('accel', { x: 0, y: 0, z: 1 })
    await harness.settle()
    assert.deepEqual(harness.gaps, [{ startMs: 2000, endMs: 6500 }], 'recognition offsets use the seeded session clock')
    harness.result.finish(); await harness.settle()
    const gaps = harness.chunks.flatMap(chunk => chunk.records).filter(record => record.kind === 'gap')
    assert.equal(gaps.length, 1, 'direct evidence capture and coordinator recognition do not duplicate a gap')
    assert.equal(gaps[0].startAt, origin)
    assert.equal(gaps[0].endAt, origin + 4500)
    assert.equal(hardware.subscriptions.size, 0)
  } finally { harness.cleanup(); for (const recorder of harness.recorders) await recorder.stop() }
})

test('single-round cleanup during actual sensor startup cannot revive isRunning or leave listeners behind', async () => {
  let releasePrivacy
  const blocked = new Promise(resolve => { releasePrivacy = resolve })
  const hardware = sensorHardware({ privacyBarrier: blocked })
  const harness = singleRoundHarness(hardware)
  const startup = harness.result.start()
  try {
    await harness.settle()
    assert.equal(harness.recorders.length, 1)
    harness.result.cleanup(); await harness.settle()
    releasePrivacy(); await assert.doesNotReject(startup); await harness.settle()
    assert.equal(harness.result.isRunning, false)
    assert.equal(hardware.subscriptions.size, 0)
    assert.equal(hardware.timers.size, 0)
  } finally { releasePrivacy(); await startup.catch(() => undefined); harness.cleanup(); for (const recorder of harness.recorders) await recorder.stop() }
})

test('single-round cleanup before queued startup prevents creation of an abandoned owner', async () => {
  const hardware = sensorHardware()
  const harness = singleRoundHarness(hardware)
  const startup = harness.result.start()
  try {
    harness.result.cleanup()
    await startup; await harness.settle()
    assert.equal(harness.recorders.length, 0)
    assert.equal(harness.result.isRunning, false)
    assert.equal(hardware.subscriptions.size, 0)
  } finally { harness.cleanup(); for (const recorder of harness.recorders) await recorder.stop() }
})

test('manual ready, round-complete and recovery retain measured motion without advancing automatically', async () => {
  const harness = workoutHarness({ clockAt: 100000, nativeAvailable: true })
  try {
    harness.result.startWorkout(); await harness.settle()
    assert.equal(harness.result.phase, 'round_ready')
    const ready = harness.activeRecorder
    assert.ok(ready)
    assert.equal(ready.options.keepRunningInBackground, true)
    assert.equal(ready.options.retainSamples, false)
    const readyPoints = emitMonitorMotion(harness, 8000, ms => ms / 3000, true)
    assert.equal(harness.result.phase, 'round_ready')
    assert.equal(harness.starts, 0)
    harness.result.beginAscending(); await harness.settle()
    assert.equal(ready.running, false)
    assert.equal(ready.journal.closedByOwner, true)
    assert.deepEqual(retainedSensors(harness, 'round_ready'), readyPoints)
    ready.options.onSample({ ...readyPoints.at(-1), t: harness.now + 100 })
    assert.equal(ready.journal.receivedSamples.length, readyPoints.length, 'a late callback from the previous owner is rejected')

    await harness.result.finishRound({ confirmedEndFloor: 15 }); await harness.settle()
    assert.equal(harness.result.phase, 'round_complete')
    const complete = harness.activeRecorder
    assert.ok(complete)
    const completePoints = emitMonitorMotion(harness, 5000, ms => 42 - ms / 120, false)
    assert.equal(harness.result.phase, 'round_complete', 'manual result display has no automatic return timer')
    harness.result.beginReturning(); await harness.settle()
    assert.equal(complete.running, false)
    assert.equal(complete.journal.closedByOwner, true)
    assert.deepEqual(retainedSensors(harness, 'round_complete'), completePoints)
    harness.result.confirmReturnedToStart(); await harness.settle()
    assert.equal(harness.result.phase, 'recovering')
    const recovery = harness.activeRecorder
    const recoveryPoints = emitMonitorMotion(harness, 8000, ms => ms / 3000, true)
    recovery.options.onGap({ startMs: 1000, endMs: 46000 }); harness.render()
    assert.match(harness.result.backgroundGapWarning, /45 秒/)
    assert.equal(harness.result.phase, 'recovering', 'upward footsteps never start a manual round')
    assert.equal(harness.starts, 1)
    const saved = await harness.result.finishWorkout(); await harness.settle()
    assert.equal(saved.rounds.length, 1)
    assert.equal(harness.result.phase, 'workout_complete')
    assert.equal(recovery.running, false)
    assert.equal(recovery.journal.closedByOwner, true)
    assert.deepEqual(retainedSensors(harness, 'recovering'), recoveryPoints)
    const recoveryGap = [...harness.evidenceFiles.values()].filter(chunk => chunk.context.phase === 'recovering')
      .flatMap(chunk => chunk.records).find(record => record.kind === 'gap')
    assert.equal(recoveryGap.startAt, recovery.journal.context.startedAt + 1000)
    assert.equal(recoveryGap.endAt, recovery.journal.context.startedAt + 46000)
    assert.equal(harness.activeRecorder, undefined)
    const stoppedAt = harness.captureLifecycle.findIndex(item => item.type === 'native_stopped')
    assert.ok(stoppedAt > harness.captureLifecycle.findLastIndex(item => item.type === 'write'), 'all evidence flushes before native service stops')
  } finally { harness.cleanup() }
})

test('waiting mode changes preserve the recorder and phase timer while requiring fresh stair evidence', async () => {
  const harness = workoutHarness({ clockAt: 200000 })
  try {
    harness.result.startWorkout(); await harness.settle()
    const ready = harness.activeRecorder
    assert.ok(ready)
    emitMonitorMotion(harness, 8000, ms => ms / 3000, true)
    const elapsed = harness.result.timer.phaseElapsedMs
    harness.result.setTrackingMode('full_auto'); await harness.settle()
    assert.equal(harness.activeRecorder, ready)
    assert.equal(harness.result.timer.phaseElapsedMs, elapsed)
    emitMonitorMotion(harness, 400, ms => 2.7 + ms / 3000, true)
    assert.equal(harness.result.phase, 'round_ready', 'manual samples cannot satisfy a newly enabled automatic hold')
    harness.result.setTrackingMode('automatic'); await harness.settle()
    emitMonitorMotion(harness, 6000, ms => 3 + ms / 3000, true)
    assert.equal(harness.result.phase, 'round_ready', 'assisted upward motion still requires a user action')
    assert.equal(harness.activeRecorder, ready)
    harness.result.setTrackingMode('full_auto'); await harness.settle()
    emitMonitorMotion(harness, 6000, ms => 5 + ms / 3000, true)
    await harness.settle()
    assert.equal(harness.result.phase, 'ascending', 'fresh sustained pressure and footsteps start full-auto')
    assert.equal(harness.starts, 1)
    assert.equal(ready.running, false)
    assert.equal(ready.journal.closedByOwner, true)
  } finally { harness.cleanup() }
})

test('mode changes persist the current checkpoint independently of capture and never write one during final save', async () => {
  let releaseSave
  const blocked = new Promise(resolve => { releaseSave = resolve })
  const harness = workoutHarness({ clockAt: 250000, saveBarrier: () => blocked })
  let completion
  try {
    harness.result.startWorkout(); await harness.settle()
    const ready = harness.activeRecorder
    harness.advanceTime(1500); harness.render()
    const elapsed = harness.result.timer.phaseElapsedMs
    harness.result.setTrackingMode('full_auto'); await harness.settle()
    assert.equal(harness.checkpoints.at(-1).trackingMode, 'full_auto', 'restarting must restore the user\'s latest mode')
    assert.equal(harness.checkpoints.at(-1).phase, 'round_ready')
    assert.equal(harness.activeRecorder, ready)
    assert.equal(harness.result.timer.phaseElapsedMs, elapsed)
    harness.result.beginAscending(); await harness.settle()
    harness.result.setTrackingMode('manual'); await harness.settle()
    assert.equal(harness.checkpoints.at(-1).trackingMode, 'manual')
    assert.equal(harness.checkpoints.at(-1).phase, 'ascending')
    assert.equal(harness.starts, 1)
    completion = harness.result.finishWorkout({ confirmedEndFloor: 15 })
    await new Promise(resolve => setTimeout(resolve, 5)); await harness.settle()
    const writesBeforeModeChange = harness.checkpoints.length
    harness.result.setTrackingMode('automatic'); await harness.settle()
    assert.equal(harness.checkpoints.length, writesBeforeModeChange, 'final persistence owns the checkpoint while saving')
    releaseSave(); await completion; await harness.settle()
    const writesAfterSave = harness.checkpoints.length
    harness.result.setTrackingMode('manual'); await harness.settle()
    assert.equal(harness.checkpoints.length, writesAfterSave, 'a completed workout must not resurrect its recovery point')
  } finally { releaseSave(); if (completion) await completion; harness.cleanup() }
})

test('an obsolete full-auto timer cannot advance after mode changes before effect cleanup', async () => {
  const harness = workoutHarness({ clockAt: 280000, trackingMode: 'full_auto' })
  try {
    harness.result.startWorkout(); harness.render()
    harness.result.beginAscending(); await harness.settle()
    await harness.result.finishRound({ confirmedEndFloor: 15 }); await harness.settle()
    const recorder = harness.activeRecorder
    harness.advanceTime(299)
    harness.result.setTrackingMode('automatic')
    harness.advanceTime(1)
    harness.render()
    assert.equal(harness.result.phase, 'round_complete', 'the old 300ms timer no longer owns this mode')
    assert.equal(harness.activeRecorder, recorder)
    harness.advanceTime(1999); harness.render()
    assert.equal(harness.result.phase, 'round_complete')
    harness.advanceTime(1); await harness.settle()
    assert.equal(harness.result.phase, 'returning', 'the new assisted timer gets its entire 2000ms delay')
  } finally { harness.cleanup() }
})

for (const [mode, delay] of [['full_auto', 300], ['automatic', 2000]]) {
  test(`${mode} result countdown respects pause and mode changes without restarting raw capture or phase time`, async () => {
    const harness = workoutHarness({ clockAt: 300000 })
    try {
      harness.result.startWorkout(); harness.render()
      harness.result.beginAscending(); await harness.settle()
      await harness.result.finishRound({ confirmedEndFloor: 15 }); await harness.settle()
      const complete = harness.activeRecorder
      assert.ok(complete)
      harness.advanceTime(1500); harness.render()
      assert.equal(harness.result.timer.phaseElapsedMs, 1500)
      harness.result.setTrackingMode(mode); await harness.settle()
      harness.result.setAutomaticTransitionsPaused(true); await harness.settle()
      emitMonitorMotion(harness, 5000, () => 42)
      assert.equal(harness.result.phase, 'round_complete')
      assert.equal(harness.activeRecorder, complete)
      assert.equal(harness.result.timer.phaseElapsedMs, 6500)
      assert.match(harness.result.automationStatus, /暂停/)
      harness.result.setAutomaticTransitionsPaused(false); await harness.settle()
      harness.advanceTime(delay - 1); harness.render()
      assert.equal(harness.result.phase, 'round_complete')
      harness.result.setTrackingMode('manual'); await harness.settle()
      harness.advanceTime(delay + 1); harness.render()
      assert.equal(harness.result.phase, 'round_complete', 'manual mode cancels the previous pending timer')
      assert.equal(harness.activeRecorder, complete)
      harness.result.setTrackingMode(mode); await harness.settle()
      harness.advanceTime(delay - 1); harness.render()
      assert.equal(harness.result.phase, 'round_complete')
      harness.advanceTime(1); await harness.settle()
      assert.equal(harness.result.phase, 'returning')
      assert.equal(complete.running, false)
      assert.equal(complete.journal.closedByOwner, true)
      assert.ok(retainedSensors(harness, 'round_complete').length > 0)
    } finally { harness.cleanup() }
  })
}

test('pending final save continues raw retention but suppresses automatic arrival and new monitors', async () => {
  let releaseSave
  const blocked = new Promise(resolve => { releaseSave = resolve })
  const harness = workoutHarness({ clockAt: 400000, nativeAvailable: true, trackingMode: 'full_auto',
    saveBarrier: () => blocked })
  try {
    harness.result.startWorkout(); harness.render()
    harness.result.beginAscending(); await harness.settle()
    for (let i = 0; i < 5; i++) harness.roundOptions.onBarometer({ available: true, running: true, pressure: 1000 })
    await harness.result.finishRound({ confirmedEndFloor: 15 }); await harness.settle()
    harness.result.beginReturning(); await harness.settle()
    const returning = harness.activeRecorder
    emitMonitorMotion(harness, 2400, () => 42)
    emitMonitorMotion(harness, 4000, ms => Math.max(0, 42 - ms * 42 / 4000))
    assert.equal(harness.result.phase, 'returning')
    const countBeforeSave = harness.recorders.length
    const completion = harness.result.finishWorkout()
    await new Promise(resolve => setTimeout(resolve, 5)); await harness.settle()
    assert.ok(harness.captureLifecycle.some(item => item.type === 'save_enter'))
    const duringSave = emitMonitorMotion(harness, 6000, () => 0)
    await harness.settle()
    assert.equal(harness.result.phase, 'returning', 'stable arrival cannot dispatch while completion owns the workflow')
    assert.equal(harness.activeRecorder, returning)
    assert.equal(harness.recorders.length, countBeforeSave)
    releaseSave(); await completion; await harness.settle()
    assert.equal(harness.result.phase, 'workout_complete')
    assert.equal(harness.activeRecorder, undefined)
    assert.equal(harness.recorders.length, countBeforeSave, 'asynchronous monitor startup cannot escape successful completion')
    const retained = retainedSensors(harness, 'returning')
    assert.deepEqual(retained.slice(-duringSave.length), duringSave)
    const saveIndex = harness.captureLifecycle.findIndex(item => item.type === 'saved')
    const finalCloseIndex = harness.captureLifecycle.findLastIndex(item => item.type === 'close')
    const nativeStopIndex = harness.captureLifecycle.findIndex(item => item.type === 'native_stopped')
    assert.ok(saveIndex < finalCloseIndex && finalCloseIndex < nativeStopIndex)
  } finally { releaseSave(); harness.cleanup() }
})

test('saving an ascent cannot start a result-display recorder after the workout is marked complete', async () => {
  let releaseSave
  const blocked = new Promise(resolve => { releaseSave = resolve })
  const harness = workoutHarness({ clockAt: 500000, nativeAvailable: true, saveBarrier: () => blocked })
  let completion
  try {
    harness.result.startWorkout(); await harness.settle()
    harness.result.beginAscending(); await harness.settle()
    const owners = harness.recorders.length
    completion = harness.result.finishWorkout({ confirmedEndFloor: 15 })
    await new Promise(resolve => setTimeout(resolve, 5)); await harness.settle()
    assert.equal(harness.result.phase, 'round_complete')
    assert.equal(harness.result.workout.status, 'completed')
    assert.equal(harness.activeRecorder, undefined)
    assert.equal(harness.recorders.length, owners)
    releaseSave(); await completion; await harness.settle()
    assert.equal(harness.result.phase, 'workout_complete')
    assert.equal(harness.recorders.length, owners)
  } finally { releaseSave(); if (completion) await completion; harness.cleanup() }
})

test('ending during asynchronous background startup never leaves a waiting recorder behind', async () => {
  let releaseStart
  const blocked = new Promise(resolve => { releaseStart = resolve })
  const harness = workoutHarness({ clockAt: 600000, nativeAvailable: true, backgroundStartBarrier: blocked })
  let completion
  try {
    harness.result.startWorkout(); await harness.settle()
    assert.equal(harness.recorders.length, 0)
    completion = harness.result.finishWorkout()
    await new Promise(resolve => setTimeout(resolve, 5)); await harness.settle()
    assert.equal(harness.saved.status, 'completed')
    releaseStart(); await completion; await harness.settle()
    assert.equal(harness.result.phase, 'workout_complete')
    assert.equal(harness.recorders.length, 0, 'a stale async phase owner cannot attach after successful save')
    assert.equal(harness.captureLifecycle.at(-1).type, 'native_stopped')
  } finally { releaseStart(); if (completion) await completion; harness.cleanup() }
})

test('a failed final save keeps its existing waiting evidence open until a successful retry', async () => {
  const harness = workoutHarness({ clockAt: 700000, nativeAvailable: true, saveFailsOnce: true })
  try {
    harness.result.startWorkout(); await harness.settle()
    const ready = harness.activeRecorder
    emitMonitorMotion(harness, 2000)
    await assert.rejects(harness.result.finishWorkout(), /disk write failed/)
    await harness.settle()
    assert.equal(harness.activeRecorder, ready)
    assert.equal(ready.journal.closedByOwner, false)
    assert.equal(harness.captureLifecycle.some(item => item.type === 'native_stopped'), false)
    const retriedPoints = emitMonitorMotion(harness, 3000)
    await harness.result.finishWorkout(); await harness.settle()
    assert.equal(harness.result.phase, 'workout_complete')
    assert.equal(ready.journal.closedByOwner, true)
    assert.equal(harness.activeRecorder, undefined)
    assert.deepEqual(retainedSensors(harness, 'round_ready').slice(-(retriedPoints.length - 1)), retriedPoints.slice(1))
  } finally { harness.cleanup() }
})

test('actual training hook manually finishes at15 from12 and journals correction without checkpoint sample buffers', async () => {
  const harness = workoutHarness()
  try {
    harness.result.startWorkout(); harness.render()
    harness.result.beginAscending(); await harness.settle()
    assert.equal(harness.roundOptions.autoComplete, false)
    assert.equal(await harness.result.finishRound({ confirmedEndFloor: 15 }), true)
    harness.render()
    const round = harness.result.workout.rounds[0]
    assert.equal(round.finalFloor, 15)
    assert.equal(round.floorsCompleted, 14)
    assert.equal(round.corrections[0].before.finalFloor, 12)
    assert.equal(round.evidenceId, 'raw-evidence')
    assert.equal(round.complete, true)
    assert.equal(harness.result.phase, 'round_complete')
    assert.equal(harness.checkpoints.at(-1).trackingMode, 'manual')
    assert.equal('samples' in harness.checkpoints.at(-1).completedRounds[0], false)
  } finally { harness.cleanup() }
})

test('actual hook keeps zero-ascent ending available and saves complete history', async () => {
  const harness = workoutHarness()
  try {
    harness.result.startWorkout(); harness.render()
    harness.result.beginAscending(); await harness.settle()
    const saved = await harness.result.finishWorkout({ confirmedEndFloor: 1 })
    harness.render()
    assert.equal(saved.rounds[0].finalFloor, 1)
    assert.equal(saved.rounds[0].floorsCompleted, 0)
    assert.equal(saved.rounds[0].ascentM, 0)
    assert.equal(saved.status, 'completed')
    assert.equal(saved.bodyWeightKg, 75)
    assert.equal(harness.result.phase, 'workout_complete')
  } finally { harness.cleanup() }
})

test('actual hook ends and saves authoritative13 even when the sensor never started', async () => {
  const harness = workoutHarness({ noRecognizer: true })
  try {
    harness.result.startWorkout(); harness.render()
    harness.result.beginAscending(); await harness.settle()
    assert.equal(await harness.result.finishRound({ confirmedEndFloor: 13 }), true)
    harness.render()
    const round = harness.result.workout.rounds[0]
    assert.equal(round.finalFloor, 13)
    assert.equal(round.floorsCompleted, 12)
    assert.equal(round.steps, 0)
    assert.equal(round.durationMs, 0)
    assert.equal(round.confidence, 0)
    assert.equal(round.trustworthy, false)
  } finally { harness.cleanup() }
})

test('switching mode during an ascent changes completion policy without restarting or losing that round', async () => {
  const harness = workoutHarness()
  try {
    harness.result.startWorkout(); harness.render()
    harness.result.beginAscending(); await harness.settle()
    assert.equal(harness.starts, 1)
    harness.result.setTrackingMode('full_auto'); await harness.settle()
    assert.equal(harness.starts, 1)
    assert.equal(harness.roundOptions.autoComplete, true)
    harness.result.setTrackingMode('automatic'); await harness.settle()
    assert.equal(harness.starts, 1)
    assert.equal(harness.roundOptions.autoComplete, false)
  } finally { harness.cleanup() }
})

test('failed final save can retry without duplicating rounds or permanently locking the finish action', async () => {
  const harness = workoutHarness({ saveFailsOnce: true })
  try {
    harness.result.startWorkout(); harness.render()
    harness.result.beginAscending(); await harness.settle()
    await assert.rejects(harness.result.finishWorkout({ confirmedEndFloor: 15 }), /disk write failed/)
    harness.render()
    const saved = await harness.result.finishWorkout()
    harness.render()
    assert.equal(saved.rounds.length, 1)
    assert.equal(saved.rounds[0].finalFloor, 15)
    assert.deepEqual(saved.weeklyContribution, { workouts: 1, floors: 14, ascentM: 42 })
    assert.equal(saved.personalBestEligible, false)
    assert.equal(harness.result.phase, 'workout_complete')
  } finally { harness.cleanup() }
})

test('manual floor confirmation owns the round while full-auto transitions are paused', async () => {
  const harness = workoutHarness()
  try {
    harness.result.startWorkout(); harness.render()
    harness.result.setTrackingMode('full_auto'); harness.render()
    harness.result.beginAscending(); await harness.settle()
    harness.result.setAutomaticTransitionsPaused(true); harness.render()
    assert.equal(harness.roundOptions.autoComplete, false)
    harness.emitComplete(); harness.render()
    assert.equal(harness.result.workout.rounds.length, 0)
    assert.equal(harness.result.phase, 'ascending')
    assert.equal(await harness.result.finishRound({ confirmedEndFloor: 15 }), true)
    harness.result.setAutomaticTransitionsPaused(false); harness.render()
    assert.equal(harness.result.workout.rounds[0].finalFloor, 15)
    assert.equal(harness.result.workout.rounds.length, 1)
  } finally { harness.cleanup() }
})

test('a service stop failure reports saved-but-still-running and safely retries', async () => {
  const harness = workoutHarness({ nativeStopFailures: 2 })
  try {
    harness.result.startWorkout(); harness.render()
    harness.result.beginAscending(); await harness.settle()
    await assert.rejects(harness.result.finishWorkout({ confirmedEndFloor: 15 }), /训练已保存.*后台采集服务未停止/)
    harness.render()
    assert.equal(harness.saved.rounds.length, 1)
    assert.match(harness.result.backgroundServiceStopError, /native stop rejected/)
    assert.equal(harness.result.phase, 'round_complete')
    await harness.result.finishWorkout(); harness.render()
    assert.equal(harness.result.backgroundServiceStopError, '')
    assert.equal(harness.result.phase, 'workout_complete')
  } finally { harness.cleanup() }
})

test('final voice drains after saving the workout and before stopping native capture', async () => {
  const lifecycle = []
  const harness = workoutHarness({
    nativeAvailable: true,
    lifecycle,
    beforeBackgroundStop: async (saved) => {
      assert.equal(saved.status, 'completed')
      assert.equal(saved.rounds[0].finalFloor, 15)
      lifecycle.push('final_voice')
    },
  })
  try {
    harness.result.startWorkout(); harness.render()
    harness.result.beginAscending(); await harness.settle()
    await harness.result.finishWorkout({ confirmedEndFloor: 15 }); harness.render()
    assert.deepEqual(lifecycle, ['saved', 'final_voice', 'stopped'])
    assert.equal(harness.result.phase, 'workout_complete')
  } finally { harness.cleanup() }
})

test('a real sensor gap remains visible after fresh motion and requires explicit dismissal', async () => {
  const harness = workoutHarness({ nativeAvailable: true })
  try {
    harness.result.startWorkout(); harness.render()
    harness.result.beginAscending(); await harness.settle()
    harness.roundOptions.onGap({ startMs: 1000, endMs: 46000 }); harness.render()
    assert.match(harness.result.backgroundGapWarning, /45 秒/)
    harness.roundOptions.onObservation({ t: Date.now(), pressure: 1000 }, { stepPulse: 1 }); harness.render()
    assert.match(harness.result.backgroundGapWarning, /45 秒/)
    harness.result.beginAscending(); harness.render()
    assert.match(harness.result.backgroundGapWarning, /45 秒/)
    harness.result.dismissBackgroundGapWarning(); harness.render()
    assert.equal(harness.result.backgroundGapWarning, '')
  } finally { harness.cleanup() }
})

test('zero or manually corrected training never reruns route learning from older history', async () => {
  const trusted = workoutHarness({ routeAvailable: true, sessionOverrides: { confidence: 0.95 } })
  try {
    trusted.result.startWorkout(); trusted.render()
    trusted.result.beginAscending(); await trusted.settle()
    trusted.emitComplete(); await trusted.settle()
    await trusted.result.finishWorkout(); trusted.render()
    assert.equal(trusted.modelUpdates, 1, 'actual eligible automatic round reaches the model update boundary')
    assert.equal(trusted.route.learning.sampleCount, 1)
  } finally { trusted.cleanup() }
  for (const confirmedEndFloor of [1, 13, 15]) {
    const harness = workoutHarness({ routeAvailable: true })
    try {
      harness.result.startWorkout(); harness.render()
      harness.result.beginAscending(); await harness.settle()
      await harness.result.finishWorkout({ confirmedEndFloor }); harness.render()
      assert.equal(harness.modelUpdates, 0, `confirmed ${confirmedEndFloor}`)
      assert.equal(harness.saved.rounds.length, 1)
    } finally { harness.cleanup() }
  }
})

test('first free training with zero confirmed ascent keeps the draft route empty', async () => {
  const harness = workoutHarness({ firstCalibration: true, routeAvailable: true,
    sessionOverrides: { mode: 'free', startedAt: 1000, endedAt: 9000,
      samples: Array.from({ length: 80 }, (_, i) => sample(1000 + i * 100)) } })
  try {
    harness.result.startWorkout(); harness.render()
    harness.result.beginAscending(); await harness.settle()
    await harness.result.finishWorkout({ confirmedEndFloor: 1 }); harness.render()
    assert.equal(harness.saved.rounds[0].floorsCompleted, 0)
    assert.equal(harness.savedRoutes.length, 0, 'zero ascent must not fabricate a one-floor template')
    assert.equal(harness.result.templateGenerated, false)
    assert.equal(harness.route.segments.length, 0)
  } finally { harness.cleanup() }
})

test('first manual floor confirmation produces a pending template with no valid learning sample', async () => {
  const harness = workoutHarness({ firstCalibration: true, routeAvailable: true,
    sessionOverrides: { mode: 'free', startedAt: 1000, endedAt: 9000,
      samples: Array.from({ length: 80 }, (_, i) => sample(1000 + i * 100)) } })
  try {
    harness.result.startWorkout(); harness.render()
    harness.result.beginAscending(); await harness.settle()
    await harness.result.finishWorkout({ confirmedEndFloor: 15 }); harness.render()
    assert.equal(harness.saved.rounds[0].floorsCompleted, 14)
    assert.equal(harness.saved.rounds[0].trustworthy, false)
    assert.equal(harness.route.segments.length, 14)
    assert.equal(harness.route.learningProvenance, 'training_rounds')
    assert.equal(harness.route.learning.sampleCount, 0)
    const { summarizeRouteLearning } = require(path.join(compiled, 'core/route-learning.js'))
    const learning = summarizeRouteLearning(harness.route, [harness.saved])
    assert.equal(learning.validCount, 0)
    assert.equal(learning.samples.length, 0)
    assert.equal(learning.stage, 'unlearned')
    assert.equal(harness.modelUpdates, 0)
  } finally { harness.cleanup() }
})

test('actual floor marks preserve the estimate and raw record while keeping this round running', async () => {
  const hardware = sensorHardware(), harness = singleRoundHarness(hardware)
  try {
    await harness.result.start(); await harness.settle()
    harness.result.markActualFloor(3); harness.render()
    assert.equal(harness.result.snapshot.currentFloor, 3)
    assert.equal(harness.result.isRunning, true)
    const session = harness.result.finish(); await harness.settle()
    assert.equal(session.manualFloorMarks.length, 1)
    assert.equal(session.manualFloorMarks[0].floor, 3)
    assert.equal(session.manualFloorMarks[0].estimatedFloor, 1)
    assert.equal(session.floorConfirmation, 'pending')
    assert.ok(harness.chunks.flatMap(chunk => chunk.records).some(record => record.kind === 'event' && record.name === 'actual_floor_mark' && record.detail.estimatedFloor === 1))
    const { replayExactInputs } = require('./replay-motion-evidence.cjs')
    const replay = replayExactInputs(harness.chunks.flatMap(chunk => chunk.records))
    assert.equal(replay.state.currentFloor, 3)
    assert.equal(replay.matchesSavedSnapshot, true)
    assert.equal(replay.manualAnchors, 1)
  } finally { harness.cleanup(); for (const recorder of harness.recorders) await recorder.stop() }
})
