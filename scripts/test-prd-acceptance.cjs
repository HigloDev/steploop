// Independent behavioral acceptance scenarios. These prove deterministic logic, not real stair accuracy.
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const assert = require('node:assert/strict')
const test = require('node:test')
const { spawnSync } = require('node:child_process')
const project = path.resolve(__dirname, '..')
const output = path.join(project, 'node_modules', '.cache', 'prd-acceptance')
const sources = ['src/core/corrections.ts', 'src/core/floors.ts', 'src/core/workout-summary.ts',
  'src/core/workout-machine.ts', 'src/core/training-automation.ts', 'src/core/voice-config.ts',
  'src/core/voice-events.ts', 'src/core/voice-queue.ts', 'src/core/training-progress.ts',
  'src/core/progress-trends.ts', 'src/services/workout-evidence-store.ts', 'src/services/background-training.ts']
const compiled = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--ignoreConfig', '--resolveJsonModule',
  '--ignoreDeprecations', '6.0', '--lib', 'es2022,dom', '--rootDir', 'src', '--outDir', output,
  '--module', 'commonjs', '--moduleResolution', 'node', '--target', 'es2022', '--esModuleInterop',
  '--skipLibCheck', ...sources], { cwd: project, encoding: 'utf8' })
if (compiled.status !== 0) throw new Error(compiled.stdout + compiled.stderr)
const { applyRoundCorrection, isRoundLearnable } = require(path.join(output, 'core/corrections.js'))
const { getFloorTransitionCount, getRoundAchievementCount } = require(path.join(output, 'core/floors.js'))
const { calculateWorkoutSummary } = require(path.join(output, 'core/workout-summary.js'))
const { TrainingAutomation, resolveTrackingMode } = require(path.join(output, 'core/training-automation.js'))
const { initialVoiceObserverState, observeVoiceEvents } = require(path.join(output, 'core/voice-events.js'))
const { DEFAULT_VOICE_SETTINGS, buildVoiceSegments, normalizeVoiceSettings } = require(path.join(output, 'core/voice-config.js'))
const { WorkoutVoiceQueue } = require(path.join(output, 'core/voice-queue.js'))
const { WorkoutEvidenceJournal } = require(path.join(output, 'services/workout-evidence-store.js'))
const { deriveTrainingProgress } = require(path.join(output, 'core/training-progress.js'))
const { computeWeekGoal, auditTrend } = require(path.join(output, 'core/progress-trends.js'))

function loadBackgroundBridge(native, linking) {
  const file = path.join(output, 'services/background-training.js')
  const actualRequire = require('node:module').createRequire(file)
  const reactNative = {
    Platform: { OS: 'android', Version: 36 },
    NativeModules: native ? { AndroidTrainingSensors: native } : {},
    Linking: linking,
    PermissionsAndroid: { PERMISSIONS: { ACTIVITY_RECOGNITION: 'activity', POST_NOTIFICATIONS: 'notification' },
      RESULTS: { GRANTED: 'granted' }, check: async () => true, request: async () => 'granted' },
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', fs.readFileSync(file, 'utf8'))(
    id => id === 'react-native' ? reactNative : actualRequire(id), module, module.exports)
  return module.exports
}

function nativeTrainingStatus(overrides = {}) {
  return { supported: true, running: false, sessionId: '', latestSequence: 0, earliestSequence: 1,
    acknowledgedSequence: 0, droppedSamples: 0, barometerAvailable: true, stepsAvailable: true,
    activityPermissionGranted: true, notificationsAllowed: true, lastError: null, ...overrides }
}

test('battery status from an older native module is explicitly false without requesting settings', async () => {
  let settingsRequests = 0
  const bridge = loadBackgroundBridge({ status: async () => nativeTrainingStatus(),
    requestIgnoreBatteryOptimizations: async () => { settingsRequests++; return { opened: true, destination: 'request_ignore' } } })
  const status = await bridge.getBackgroundTrainingStatus()
  assert.equal(status.batteryOptimizationIgnored, false)
  assert.equal(status.supported, true)
  assert.equal(settingsRequests, 0)
})

test('battery exemption follows refreshed native status, opening the request never fabricates a grant', async () => {
  let granted = false
  let settingsRequests = 0
  const bridge = loadBackgroundBridge({ status: async () => nativeTrainingStatus({ batteryOptimizationIgnored: granted }),
    requestIgnoreBatteryOptimizations: async () => { settingsRequests++; return { opened: true, destination: 'request_ignore' } } })
  assert.equal((await bridge.getBackgroundTrainingStatus()).batteryOptimizationIgnored, false)
  assert.equal((await bridge.requestIgnoreBatteryOptimizations()).opened, true)
  assert.equal(settingsRequests, 1)
  assert.equal((await bridge.getBackgroundTrainingStatus()).batteryOptimizationIgnored, false)
  granted = true
  assert.equal((await bridge.getBackgroundTrainingStatus()).batteryOptimizationIgnored, true)
})

test('declining battery exemption does not gate a user-initiated workout with activity permission', async () => {
  const started = []
  let stopped = 0
  const bridge = loadBackgroundBridge({ status: async () => nativeTrainingStatus({ batteryOptimizationIgnored: false }),
    requestIgnoreBatteryOptimizations: async () => ({ opened: true, destination: 'request_ignore' }),
    start: async options => { started.push(options); return nativeTrainingStatus({ running: true, sessionId: options.sessionId, batteryOptimizationIgnored: false }) },
    stop: async () => { stopped++; return nativeTrainingStatus({ batteryOptimizationIgnored: false }) } })
  await bridge.requestIgnoreBatteryOptimizations()
  const status = await bridge.startBackgroundTraining('manual-workout')
  assert.equal(status.running, true)
  assert.equal(status.batteryOptimizationIgnored, false)
  assert.equal(started.length, 1)
  assert.equal(started[0].sessionId, 'manual-workout')
  assert.equal(stopped, 0)
})

test('missing native power settings capability falls back only after an explicit user request', async () => {
  let opened = 0
  const bridge = loadBackgroundBridge(undefined, { openSettings: async () => { opened++ } })
  assert.equal(bridge.isBackgroundTrainingSupported(), false)
  assert.equal((await bridge.getBackgroundTrainingStatus()).batteryOptimizationIgnored, false)
  assert.equal(opened, 0)
  const request = await bridge.requestIgnoreBatteryOptimizations()
  assert.equal(request.opened, true)
  assert.equal(request.destination, 'application_details')
  assert.equal(opened, 1)
  await bridge.openBatteryOptimizationSettings()
  assert.equal(opened, 2)
  assert.equal((await bridge.getBackgroundTrainingStatus()).batteryOptimizationIgnored, false)
})

test('unavailable application settings resolves an honest unavailable result', async () => {
  const bridge = loadBackgroundBridge({ status: async () => nativeTrainingStatus() },
    { openSettings: async () => { throw new Error('vendor activity missing') } })
  const result = await bridge.requestIgnoreBatteryOptimizations()
  assert.equal(result.opened, false)
  assert.equal(result.destination, 'unavailable')
  const noSettings = loadBackgroundBridge(undefined, undefined)
  assert.equal((await noSettings.openBatteryOptimizationSettings()).opened, false)
})

function round(overrides = {}) {
  return { id: 'r1', roundNumber: 1, startedAt: 1000, endedAt: 121000, durationMs: 120000,
    startFloor: 1, targetFloor: 15, finalFloor: 12, floorsCompleted: 11, floorCounting: 'transitions',
    ascentM: 33, steps: 220, confidence: 0.7, complete: false, completionReason: 'manual',
    floorSplits: [], events: [], interruptions: [], ...overrides }
}

test('PRD: reached 15 / detected 12 can end, preserves recognition and actual height segments', () => {
  const original = round()
  const corrected = applyRoundCorrection(original, { finalFloor: 15, complete: true }, { at: 122000, id: 'user-15' })
  assert.equal(original.finalFloor, 12)
  assert.equal(corrected.finalFloor, 15)
  assert.equal(corrected.floorsCompleted, 14)
  assert.equal(corrected.ascentM, 42)
  assert.equal(corrected.corrections[0].before.finalFloor, 12)
  assert.equal(corrected.corrections[0].after.finalFloor, 15)
  assert.equal(corrected.confidence, original.confidence)
  assert.equal(isRoundLearnable(corrected), false)
  assert.equal(applyRoundCorrection(corrected, { finalFloor: 15, complete: true }), corrected)
})

test('PRD: end at 13 or zero ascent is a valid saved result, no fabricated climbing', () => {
  const early = applyRoundCorrection(round(), { finalFloor: 13 })
  assert.equal(early.floorsCompleted, 12)
  const zero = applyRoundCorrection(round(), { finalFloor: 1 })
  assert.equal(zero.floorsCompleted, 0)
  assert.equal(zero.ascentM, 0)
  assert.equal(getRoundAchievementCount(zero), 0)
})

test('PRD: 28 and 73 building layers are derived from complete workout totals, no 60 cap', () => {
  const two = [round({ id: 'a', finalFloor: 15 }), round({ id: 'b', finalFloor: 15 })]
  assert.equal(calculateWorkoutSummary(two, 1000, 500000).totalFloors, 28)
  const five = [...Array(5)].map((_, n) => round({ id: String(n), finalFloor: 15 }))
  five.push(round({ id: 'last', finalFloor: 4 }))
  const summary = calculateWorkoutSummary(five, 1000, 900000)
  assert.equal(summary.totalFloors, 73)
  assert.equal(summary.activeDurationMs, 6 * 120000)
  assert.equal(summary.totalElapsedMs, 899000)
})

test('PRD: elevator descent never contributes negative or fabricated positive new-workout ascent', () => {
  assert.equal(getFloorTransitionCount(15, 1), 0)
  const summary = calculateWorkoutSummary([round({ startFloor: 15, finalFloor: 1, floorsCompleted: 0, ascentM: 0 })], 1000, 2000)
  assert.equal(summary.totalFloors, 0)
  assert.equal(summary.totalAscentM, 0)
})

test('PRD: user-confirmed ascent contributes to ordinary totals and week goals without becoming PB or learning', () => {
  const now = Date.UTC(2026, 9, 4, 4)
  const corrected = applyRoundCorrection(round({ startedAt: now - 120000, endedAt: now }),
    { finalFloor: 15, complete: true }, { at: now, id: 'confirmed-actual-15' })
  const workout = { id: 'manual-confirmed', templateId: 'route', floorCounting: 'transitions',
    status: 'completed', startedAt: now - 120000, endedAt: now, updatedAt: now, createdAt: now - 120000,
    rounds: [corrected], totalFloorsCompleted: 11, totalAscentM: 33 }
  const progress = deriveTrainingProgress([workout], now)
  assert.equal(progress.validWorkouts, 1)
  assert.equal(progress.floors, 14)
  assert.equal(progress.ascentM, 42)
  assert.deepEqual(progress.personalBests, {})
  assert.equal(isRoundLearnable(corrected), false)
  const goals = computeWeekGoal([workout], { targetFloors: 14, targetWorkouts: 1, targetAscentM: 42 }, now)
  assert.equal(goals.doneFloors, 14)
  assert.equal(goals.doneWorkouts, 1)
  assert.equal(goals.achieved, true)
  const audit = auditTrend([workout], { bucket: 'week', fromMs: now - 86400000, toMs: now, timeZoneOffsetMinutes: 480 })
  assert.equal(audit.counted, 1)
  assert.equal(audit.points.reduce((sum, point) => sum + point.floors, 0), 14)
  assert.equal(audit.points.some(point => point.bestRoundMs !== undefined), false)
  const stationary = { ...workout, id: 'zero-climb', rounds: [round({ startFloor: 1, finalFloor: 1, floorsCompleted: 0, ascentM: 0 })] }
  assert.equal(deriveTrainingProgress([stationary], now).validWorkouts, 0)
})

function observe(automation, time, height, steps, extra = {}) {
  return automation.observe({ t: time, relativeHeightM: height, steps, barometerAvailable: true, ...extra })
}

test('PRD: manual and automatic keep confirmation; full_auto finishes elevator once', () => {
  assert.equal(resolveTrackingMode(undefined, 'assisted'), 'automatic')
  for (const mode of ['manual', 'automatic', 'full_auto']) {
    const a = new TrainingAutomation(mode)
    a.enterPhase('ascending')
    const actions = []
    for (let i = 0; i < 18; i++) {
      const result = observe(a, 1000 + i * 500, i * 2.5, i * 2)
      if (result.action) actions.push(result.action)
    }
    for (let i = 0; i < 24; i++) {
      const result = observe(a, 10000 + i * 500, Math.max(0, 42.5 - i * 3), 34)
      if (result.action) actions.push(result.action)
    }
    assert.equal(actions.length, mode === 'full_auto' ? 1 : 0)
    if (mode === 'full_auto') {
      assert.equal(actions[0].type, 'finish_round')
      assert.equal(actions[0].cause, 'elevator_down')
      assert.equal(actions[0].at, 9500)
    }
  }
})

test('PRD: return arrival and actual next ascent are different, waiting never starts a round', () => {
  const a = new TrainingAutomation('full_auto')
  a.enterPhase('returning')
  let returned
  for (let i = 0; i < 26; i++) {
    const result = observe(a, 1000 + i * 500, Math.max(0, 30 - i * 3), 0)
    if (result.action) { assert.equal(returned, undefined); returned = result.action }
  }
  assert.equal(returned.type, 'returned_to_start')
  a.enterPhase('recovering')
  for (let i = 0; i < 16; i++) assert.equal(observe(a, 20000 + i * 500, i % 2 ? 0.06 : 0, 0).action, undefined)
  let began
  for (let i = 0; i < 10; i++) {
    const result = observe(a, 30000 + i * 500, i * 0.25, i)
    if (result.action) { assert.equal(began, undefined); began = result.action }
  }
  assert.equal(began.type, 'begin_next_round')
  assert.ok(began.climbStartedAt < began.at)
})

test('PRD: pressure alone, missing pressure, and discontinuous samples cannot start full_auto ascent', () => {
  const a = new TrainingAutomation('full_auto')
  a.enterPhase('recovering')
  for (let i = 0; i < 12; i++) assert.equal(observe(a, 1000 + i * 500, i * 0.5, 0).action, undefined)
  a.gap()
  assert.equal(observe(a, 15000, 10, 10).action, undefined)
  assert.equal(a.observe({ t: 16000, steps: 12, barometerAvailable: false }).action, undefined)
  assert.equal(observe(a, 17000, 11, 14).action, undefined)
})

const observation = (overrides = {}) => ({ workoutId: 'w', mode: 'full_auto', phase: 'ascending',
  currentRoundNumber: 1, elapsedMs: 10000, calories: 10, cumulativeFloors: 0, completedRounds: [], ...overrides })

test('PRD: same time/calorie/round milestone is announced once and resumed history is silent', () => {
  const calorieThreshold = DEFAULT_VOICE_SETTINGS.calorieMilestones[0]
  let result = observeVoiceEvents(initialVoiceObserverState(), observation(), DEFAULT_VOICE_SETTINGS, 1)
  result = observeVoiceEvents(result.state, observation({ elapsedMs: 1200000, calories: calorieThreshold }), DEFAULT_VOICE_SETTINGS, 2)
  assert.equal(result.events.filter(e => e.kind === 'time_milestone').length, 1)
  assert.equal(result.events.filter(e => e.kind === 'calorie_milestone').length, 1)
  result = observeVoiceEvents(result.state, observation({ elapsedMs: 1200000, calories: calorieThreshold }), DEFAULT_VOICE_SETTINGS, 3)
  assert.equal(result.events.length, 0)
  const historical = observation({ elapsedMs: 2400000, calories: 200, completedRounds: [{ id: 'old', roundNumber: 1, floorsCompleted: 14 }] })
  assert.equal(observeVoiceEvents(initialVoiceObserverState(), historical, DEFAULT_VOICE_SETTINGS, 4).events.length, 0)
})

test('PRD: return screen alone does not claim elevator arrival; next round follows true state', () => {
  let r = observeVoiceEvents(initialVoiceObserverState(), observation(), DEFAULT_VOICE_SETTINGS, 1)
  r = observeVoiceEvents(r.state, observation({ phase: 'returning' }), DEFAULT_VOICE_SETTINGS, 2)
  assert.equal(r.events.some(e => e.kind === 'returned_to_start' || e.kind === 'elevator_descending'), false)
  r = observeVoiceEvents(r.state, observation({ phase: 'recovering', returnedToStart: true }), DEFAULT_VOICE_SETTINGS, 3)
  assert.equal(r.events.filter(e => e.kind === 'returned_to_start').length, 1)
  r = observeVoiceEvents(r.state, observation({ phase: 'ascending', currentRoundNumber: 2 }), DEFAULT_VOICE_SETTINGS, 4)
  assert.equal(r.events.filter(e => e.kind === 'round_started').length, 1)
})

test('PRD: replaceable recorded phrase segments + numeric TTS, missing numbers are not spoken as a sentence', () => {
  const segments = buildVoiceSegments('time_milestone', { minutes: 20 }, normalizeVoiceSettings())
  assert.ok(segments.some(s => s.kind === 'clip'))
  assert.ok(segments.some(s => s.kind === 'number' && /^\d+$/.test(s.value)))
  assert.equal(segments.filter(s => s.kind === 'number').length, 1)
})

test('PRD: voice cancellation resolves playback without orphan queue or false played evidence', async () => {
  let rejectPlayback
  const backend = { available: () => true, play: () => new Promise((_, reject) => { rejectPlayback = reject }),
    stop: () => { rejectPlayback?.(new Error('cancelled')) } }
  const queue = new WorkoutVoiceQueue(backend, { gapMs: 0, now: () => 10 })
  queue.enqueue([{ id: 'w:finish', kind: 'workout_finished', workoutId: 'w', at: 1, expiresAt: 100, priority: 100, numbers: { floors: 28 } }])
  await new Promise(resolve => setImmediate(resolve))
  await queue.stop()
  const journal = queue.getJournal()
  assert.ok(journal.some(entry => entry.outcome === 'cancelled'))
  assert.equal(journal.some(entry => entry.outcome === 'played'), false)
})

test('PRD: voice options reach playback and Bluetooth/music suppression cannot be recorded as played', async () => {
  for (const reason of ['bluetooth_unavailable', 'music_active']) {
    let received
    const queue = new WorkoutVoiceQueue({ available: () => true,
      play: async (segments, volume, options) => {
        received = { segments, volume, options }
        return { playedSegments: 2, partialPlayedSegments: 2, numericFallback: false, suppressed: reason }
      }, stop() {} },
    { gapMs: 0, now: () => 10, settings: { speaker: 'vivian', rate: 0.8, bluetoothOnly: true, duckMusic: false, volume: 0.25 } })
    queue.enqueue([{ id: `w:${reason}`, kind: 'workout_finished', workoutId: 'w', at: 1,
      expiresAt: 100, priority: 100, numbers: { floors: 28 } }])
    await queue.waitUntilIdle()
    assert.deepEqual(received.options, { speaker: 'vivian', rate: 0.8, bluetoothOnly: true, duckMusic: false })
    assert.equal(received.volume, 0.25)
    assert.ok(received.segments.some(segment => segment.kind === 'clip'))
    const result = queue.getJournal().find(entry => entry.outcome === 'suppressed')
    assert.equal(result.detail, reason)
    assert.equal(result.playedSegments, 0)
    assert.equal(result.partialPlayedSegments, 2)
    assert.equal(queue.getJournal().some(entry => entry.outcome === 'played'), false)
  }
  for (const importedRate of [NaN, -1, 0.75, 1.1, 3]) {
    assert.ok([0.8, 1, 1.2].includes(normalizeVoiceSettings({ rate: importedRate }).rate))
  }
})

test('PRD: mixed numeric TTS/fallback evidence lists only numbers actually synthesized and played', async () => {
  for (const suppress of [false, true]) {
    const queue = new WorkoutVoiceQueue({ available: () => true,
      play: async () => ({ playedSegments: suppress ? 0 : 4, partialPlayedSegments: suppress ? 4 : undefined,
        numericFallback: true, numberTtsUsed: true, numberTtsTexts: ['15'],
        numberTtsEngine: 'android_text_to_speech', ...(suppress ? { suppressed: 'bluetooth_unavailable' } : {}) }), stop() {} },
    { gapMs: 0, now: () => 10, settings: { templateOverrides: { workout_finished: {
      id: 'mixed-number-evidence', priority: 100, expiresAfterMs: 100,
      parts: [{ kind: 'clip', id: 'round_prefix' }, { kind: 'number', slot: 'roundNumber' },
        { kind: 'number', slot: 'floors' }, { kind: 'number', slot: 'floor' }],
    } } } })
    queue.enqueue([{ id: `w:mixed:${suppress}`, kind: 'workout_finished', workoutId: 'w', at: 1,
      expiresAt: 100, priority: 100, numbers: { roundNumber: 1, floors: 73, floor: 15 } }])
    await queue.waitUntilIdle()
    const entry = queue.getJournal().find(item => item.outcome === (suppress ? 'suppressed' : 'played'))
    assert.deepEqual(entry.numericTexts, ['1', '73', '15'])
    assert.deepEqual(entry.numberTtsTexts, ['15'])
    assert.equal(entry.numberTtsEngine, 'android_text_to_speech')
    if (suppress) assert.equal(queue.getJournal().some(item => item.outcome === 'played'), false)
  }
})

test('PRD: quiet hours apply at local 22:00 through 06:59 with no audio calls', async () => {
  for (const [hour, minute, quiet] of [[21, 59, false], [22, 0, true], [6, 59, true], [7, 0, false]]) {
    const now = new Date(2026, 9, 4, hour, minute).getTime()
    let calls = 0
    const queue = new WorkoutVoiceQueue({ available: () => true,
      play: async () => { calls++; return { playedSegments: 1, numericFallback: false } }, stop() {} },
    { gapMs: 0, now: () => now, settings: { nightQuiet: true } })
    queue.enqueue([{ id: `w:${hour}:${minute}`, kind: 'workout_finished', workoutId: 'w', at: now,
      expiresAt: now + 1000, priority: 100, numbers: { floors: 28 } }])
    await queue.waitUntilIdle()
    assert.equal(calls, quiet ? 0 : 1)
    const entries = queue.getJournal()
    assert.equal(entries.some(entry => entry.outcome === 'suppressed' && entry.detail === 'night_quiet'), quiet)
    assert.equal(entries.some(entry => entry.outcome === 'played'), !quiet)
  }
})

test('PRD: quiet hours are rechecked after a playback gap and Bluetooth-only switch interrupts current audio', async () => {
  let now = new Date(2026, 9, 4, 21, 59, 59, 999).getTime()
  let calls = 0
  const queue = new WorkoutVoiceQueue({ available: () => true,
    play: async () => { calls++; return { playedSegments: 1, numericFallback: false } }, stop() {} },
  { gapMs: 10, now: () => now, settings: { nightQuiet: true } })
  const event = id => ({ id, kind: 'round_finished', workoutId: 'w', at: now,
    expiresAt: now + 5000, priority: 80, numbers: { floors: 14, roundNumber: 1 } })
  queue.enqueue([event('before-quiet')])
  await queue.waitUntilIdle()
  queue.enqueue([event('crosses-quiet')])
  now += 1
  await queue.waitUntilIdle()
  assert.equal(calls, 1)
  assert.ok(queue.getJournal().some(entry => entry.eventId === 'crosses-quiet' && entry.detail === 'night_quiet'))
  let rejectCurrent
  let stopCalls = 0
  const changing = new WorkoutVoiceQueue({ available: () => true,
    play: () => new Promise((_, reject) => { rejectCurrent = reject }),
    stop() { stopCalls++; rejectCurrent?.(new Error('cancelled')) } }, { gapMs: 0, now: () => 10 })
  changing.enqueue([{ id: 'current', kind: 'workout_finished', workoutId: 'w', at: 1,
    expiresAt: 100, priority: 100, numbers: { floors: 14 } }])
  await new Promise(resolve => setImmediate(resolve))
  changing.setSettings({ bluetoothOnly: true })
  await changing.waitUntilIdle()
  assert.equal(stopCalls, 1)
  assert.equal(changing.getJournal().some(entry => entry.outcome === 'played'), false)
  assert.ok(changing.getJournal().some(entry => entry.outcome === 'cancelled'))
})

test('PRD: evidence preserves original timestamp, pressure, recognition and correction event', () => {
  const writes = []
  const journal = new WorkoutEvidenceJournal({ workoutId: 'w', roundNumber: 1, phase: 'ascending', startedAt: 1000 },
    { write: (_, content) => writes.push(JSON.parse(content)) }, undefined, 'evidence')
  const sample = { t: 1100, ax: 1, ay: 2, az: 3, gx: 0.1, gy: 0.2, gz: 0.3, alpha: 0, beta: 0, gamma: 0, pressure: 1001.25 }
  journal.pushSample(sample)
  sample.pressure = 999
  journal.pushRecognition({ currentFloor: 12, status: 'matching' }, 1150)
  journal.event('manual_floor_correction', 1200, { detected: 12, confirmed: 15 })
  journal.close(1300)
  const records = writes.flatMap(chunk => chunk.records)
  assert.equal(records.find(record => record.kind === 'sensor').sample.pressure, 1001.25)
  assert.equal(records.find(record => record.kind === 'sensor').sample.t, 1100)
  assert.equal(records.find(record => record.kind === 'recognition').snapshot.currentFloor, 12)
  assert.equal(records.find(record => record.name === 'manual_floor_correction').detail.confirmed, 15)
})

test('native prebuild integration is reproducible, non-exported health service, permissions idempotent', () => {
  const plugin = require('../plugins/withAndroidTrainingModule')
  const manifest = { application: [{ $: {}, service: [] }] }
  plugin.configureTrainingManifest(manifest)
  plugin.configureTrainingManifest(manifest)
  const services = manifest.application[0].service
  assert.equal(services.length, 1)
  assert.equal(services[0].$['android:exported'], 'false')
  assert.equal(services[0].$['android:foregroundServiceType'], 'health')
  assert.equal(new Set(manifest['uses-permission'].map(p => p.$['android:name'])).size, manifest['uses-permission'].length)
  assert.ok(manifest['uses-permission'].some(p => p.$['android:name'] === 'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'))
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'palou-prd-native-'))
  try {
    const directory = path.join(temp, 'app/src/main/java/com/zxn/palou')
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, 'MainApplication.kt'), 'PackageList(this).packages.apply {\n}\n')
    plugin.installTrainingSources(temp)
    const first = fs.readFileSync(path.join(directory, 'MainApplication.kt'), 'utf8')
    plugin.installTrainingSources(temp)
    assert.equal(fs.readFileSync(path.join(directory, 'MainApplication.kt'), 'utf8'), first)
    assert.equal(fs.readFileSync(path.join(directory, 'AndroidTrainingService.kt'), 'utf8'), fs.readFileSync(path.join(project, 'native/android-training/AndroidTrainingService.kt'), 'utf8'))
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})
