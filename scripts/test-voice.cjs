const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const fs = require('node:fs')
const Module = require('node:module')
const { execFileSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const compiled = path.join(root, 'node_modules', '.cache', 'steploop-voice')
execFileSync(process.execPath, [
  path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  '--ignoreConfig', '--ignoreDeprecations', '6.0', '--lib', 'es2022,dom',
  '--rootDir', 'src', '--outDir', compiled, '--module', 'commonjs',
  '--moduleResolution', 'node', '--target', 'es2022', '--esModuleInterop', '--skipLibCheck', '--resolveJsonModule',
  'src/core/voice-config.ts', 'src/core/voice-events.ts', 'src/core/voice-queue.ts',
  'src/services/voice-feedback.ts', 'src/services/voice-journal.ts',
], { cwd: root, stdio: 'pipe' })

const config = require(path.join(compiled, 'core', 'voice-config.js'))
const { observeVoiceEvents, initialVoiceObserverState } = require(path.join(compiled, 'core', 'voice-events.js'))
const { WorkoutVoiceQueue } = require(path.join(compiled, 'core', 'voice-queue.js'))
const settings = config.normalizeVoiceSettings()

test('unknown or old speaker settings use Serena; all four valid choices survive normalization', () => {
  for (const speaker of ['uncle_fu', 'dylan', 'serena', 'vivian']) assert.equal(config.normalizeVoiceSettings({ speaker }).speaker, speaker)
  for (const speaker of [undefined, null, '../private', 'xiaoxiao']) assert.equal(config.normalizeVoiceSettings({ speaker }).speaker, 'serena')
})

function observation(overrides = {}) {
  return {
    workoutId: 'voice-test-workout', mode: 'full_auto', phase: 'round_ready',
    currentRoundNumber: 1, elapsedMs: 0, calories: 0, cumulativeFloors: 0, cumulativeSteps: 0,
    startFloor: 1, completedRounds: [], ...overrides,
  }
}

function event(kind, id = kind, overrides = {}) {
  const template = config.VOICE_TEMPLATE_LIBRARY[kind]
  return {
    id: `voice-test-workout:${kind}:${id}`, kind, workoutId: 'voice-test-workout',
    at: 100, expiresAt: 120_000, priority: template.priority,
    numbers: { minutes: 20, calories: 100, roundNumber: 1, floors: 73, floor: 15, steps: 1000 },
    ...overrides,
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

function backend({ deferred = false, failing = false, fallback = false, suppressed, numberTtsUsed = false, numberTtsTexts } = {}) {
  const state = { calls: [], active: 0, maxActive: 0, stopped: 0, released: 0, settle: undefined }
  return Object.assign(state, {
    available() { return true },
    async play(segments, volume, options) {
      state.calls.push({ segments, volume, options })
      state.active += 1
      state.maxActive = Math.max(state.maxActive, state.active)
      try {
        if (failing) throw new Error('audio_focus_lost')
        if (deferred) await new Promise((resolve, reject) => { state.settle = { resolve, reject } })
        return {
          playedSegments: suppressed ? 0 : segments.length, numericFallback: fallback, numberTtsUsed, suppressed,
          numberTtsTexts: numberTtsTexts ?? (numberTtsUsed ? segments.filter((part) => part.kind === 'number').map((part) => part.value) : []),
          numberTtsEngine: numberTtsUsed ? 'android_text_to_speech' : undefined,
        }
      } finally { state.active -= 1 }
    },
    async stop() {
      state.stopped += 1
      state.settle?.reject(new Error('cancelled'))
      state.settle = undefined
    },
    async dispose() { state.released += 1 },
  })
}

test('numeric slots only; every fixed word and unit uses a bundled clip', () => {
  for (const kind of Object.keys(config.VOICE_TEMPLATE_LIBRARY)) {
    const segments = config.buildVoiceSegments(kind, event(kind).numbers, settings)
    for (const segment of segments) {
      if (segment.kind === 'number') assert.match(segment.value, /^-?\d{1,6}$/)
      else for (const speaker of ['serena', 'vivian', 'uncle_fu', 'dylan']) assert.ok(fs.existsSync(path.join(root, 'assets', 'voice', speaker, `${segment.id}.mp3`)))
    }
  }
  assert.throws(() => config.buildVoiceSegments('time_milestone', { minutes: NaN }, settings))
})

test('recorded fallback numbers read Chinese units, negatives, and decimals', () => {
  assert.deepEqual(config.recordedNumberClipIds('0'), ['n0'])
  assert.deepEqual(config.recordedNumberClipIds('10'), ['n10'])
  assert.deepEqual(config.recordedNumberClipIds('20'), ['n2', 'n10'])
  assert.deepEqual(config.recordedNumberClipIds('110'), ['n1', 'n100', 'n1', 'n10'])
  assert.deepEqual(config.recordedNumberClipIds('10001'), ['n1', 'n10000', 'n0', 'n1'])
  assert.deepEqual(config.recordedNumberClipIds('-1.5'), ['n_minus', 'n1', 'n_point', 'n5'])
  assert.throws(() => config.recordedNumberClipIds('20分钟'))
  assert.throws(() => config.recordedNumberClipIds('1/2'))
})

test('time and calorie thresholds cross once; restored history stays silent', () => {
  let current = observeVoiceEvents(initialVoiceObserverState(), observation(), settings, 0)
  current = observeVoiceEvents(current.state, observation({ elapsedMs: 20 * 60_000, calories: 100 }), settings, 100)
  assert.deepEqual(current.events.map((e) => e.kind).sort(), ['calorie_milestone', 'time_milestone'])
  current = observeVoiceEvents(current.state, observation({ elapsedMs: 20 * 60_000 + 1000, calories: 100 }), settings, 200)
  assert.equal(current.events.length, 0)
  const resumed = observeVoiceEvents(initialVoiceObserverState(), observation({ elapsedMs: 41 * 60_000, calories: 220 }), settings, 300)
  assert.equal(resumed.events.length, 0)
  const catchup = observeVoiceEvents(current.state, observation({ elapsedMs: 61 * 60_000, calories: 501 }), settings, 400)
  assert.deepEqual(catchup.events.map((e) => e.numbers), [{ minutes: 60 }, { calories: 500 }])
})

test('round completion and later correction preserve true floor count and revision', () => {
  let current = observeVoiceEvents(initialVoiceObserverState(), observation(), settings, 0)
  const round = { id: 'round-1', roundNumber: 1, floorsCompleted: 14, confirmedTopFloor: 15, correctionRevision: 1 }
  current = observeVoiceEvents(current.state, observation({ phase: 'round_complete', completedRounds: [round] }), settings, 100)
  assert.equal(current.events.length, 1)
  assert.equal(current.events[0].kind, 'round_finished')
  assert.equal(current.events[0].numbers.floors, 14)
  current = observeVoiceEvents(current.state, observation({ phase: 'round_complete', completedRounds: [{ ...round, correctionRevision: 2, confirmedTopFloor: 16 }] }), settings, 200)
  assert.equal(current.events[0].kind, 'correction')
  assert.equal(current.events[0].numbers.floor, 16)
  const repeated = observeVoiceEvents(current.state, current.state.previous, settings, 300)
  assert.equal(repeated.events.length, 0)
})

test('actual elevator and confirmed return are required; manual mode avoids automatic claims', () => {
  let current = observeVoiceEvents(initialVoiceObserverState(), observation(), settings, 0)
  current = observeVoiceEvents(current.state, observation({ phase: 'returning' }), settings, 100)
  assert.equal(current.events.length, 0)
  current = observeVoiceEvents(current.state, observation({ phase: 'returning', elevatorDescending: true }), settings, 200)
  assert.equal(current.events[0].kind, 'elevator_descending')
  current = observeVoiceEvents(current.state, observation({ phase: 'start_confirmation' }), settings, 300)
  assert.equal(current.events.length, 0)
  current = observeVoiceEvents(current.state, observation({ phase: 'recovering' }), settings, 400)
  assert.equal(current.events[0].kind, 'returned_to_start')
  let manual = observeVoiceEvents(initialVoiceObserverState(), observation({ mode: 'manual' }), settings, 0)
  manual = observeVoiceEvents(manual.state, observation({ mode: 'manual', phase: 'returning', elevatorDescending: true }), settings, 100)
  assert.equal(manual.events.length, 0)
})

test('completed training announces actual cumulative floors above 60', () => {
  const before = observeVoiceEvents(initialVoiceObserverState(), observation(), settings, 0)
  const finished = observeVoiceEvents(before.state, observation({ phase: 'workout_complete', cumulativeFloors: 73 }), settings, 100)
  assert.equal(finished.events[0].numbers.floors, 73)
})

test('durable return timestamps survive batched recovering and round_ready phases', () => {
  const round = { id: 'round-1', roundNumber: 1, floorsCompleted: 14 }
  const before = observeVoiceEvents(initialVoiceObserverState(), observation({ phase: 'returning', completedRounds: [round] }), settings, 0)
  const returned = observeVoiceEvents(before.state, observation({
    phase: 'round_ready', currentRoundNumber: 2,
    completedRounds: [{ ...round, returnedToStartAt: 100 }],
  }), settings, 100)
  assert.equal(returned.events[0].kind, 'returned_to_start')
  const repeat = observeVoiceEvents(returned.state, returned.state.previous, settings, 200)
  assert.equal(repeat.events.length, 0)
})

test('concise, standard and coach modes select the promised detail without replaying muted crossings', () => {
  const kinds = Object.keys(config.VOICE_TEMPLATE_LIBRARY)
  const concise = config.normalizeVoiceSettings({ detailMode: 'concise' })
  const standard = config.normalizeVoiceSettings({ detailMode: 'standard' })
  const coach = config.normalizeVoiceSettings({ detailMode: 'coach' })
  assert.deepEqual(kinds.filter((kind) => config.voiceEventAllowed(kind, concise)).sort(), ['returned_to_start', 'round_finished', 'workout_finished'])
  assert.equal(kinds.filter((kind) => config.voiceEventAllowed(kind, standard)).length, 8)
  assert.equal(kinds.filter((kind) => config.voiceEventAllowed(kind, coach)).length, 11)
  assert.equal(kinds.filter((kind) => config.voiceEventAllowed(kind, { ...coach, enabled: false })).length, 0)
  let current = observeVoiceEvents(initialVoiceObserverState(), observation(), standard, 0)
  current = observeVoiceEvents(current.state, observation({ cumulativeSteps: 1000, cumulativeFloors: 10 }), standard, 100)
  assert.equal(current.events.length, 0)
  current = observeVoiceEvents(current.state, observation({ cumulativeSteps: 1001, cumulativeFloors: 11 }), coach, 200)
  assert.equal(current.events.length, 0)
  current = observeVoiceEvents(current.state, observation({ cumulativeSteps: 3000, cumulativeFloors: 20 }), coach, 300)
  assert.deepEqual(current.events.map((entry) => entry.numbers), [{ steps: 3000 }, { floors: 20 }])
})

test('coach step and floor milestones coalesce crossings and extend past sixty floors', () => {
  const coach = config.normalizeVoiceSettings({ detailMode: 'coach' })
  let current = observeVoiceEvents(initialVoiceObserverState(), observation(), coach, 0)
  current = observeVoiceEvents(current.state, observation({ cumulativeSteps: 5010, cumulativeFloors: 73 }), coach, 100)
  assert.deepEqual(current.events.map((entry) => entry.numbers), [{ steps: 5000 }, { floors: 70 }])
  current = observeVoiceEvents(current.state, observation({ cumulativeSteps: 5011, cumulativeFloors: 74 }), coach, 200)
  assert.equal(current.events.length, 0)
  current = observeVoiceEvents(current.state, observation({ cumulativeSteps: 10000, cumulativeFloors: 94 }), coach, 300)
  assert.deepEqual(current.events.map((entry) => entry.numbers), [{ steps: 10000 }, { floors: 90 }])
  const restored = observeVoiceEvents(initialVoiceObserverState(), observation({ cumulativeSteps: 10000, cumulativeFloors: 94 }), coach, 400)
  assert.equal(restored.events.length, 0)
  const noExtension = config.normalizeVoiceSettings({ detailMode: 'coach', floorMilestoneInterval: 0 })
  const extension = observeVoiceEvents(restored.state, observation({ cumulativeSteps: 10000, cumulativeFloors: 101 }), noExtension, 500)
  assert.equal(extension.events.length, 0)
})

test('long rest reminder is gentle, once per completed round and excludes elevator descent', () => {
  const coach = config.normalizeVoiceSettings({ detailMode: 'coach' })
  const round = { id: 'rest-round-1', roundNumber: 1, floorsCompleted: 14 }
  let current = observeVoiceEvents(initialVoiceObserverState(), observation({ phase: 'recovering', completedRounds: [round], restElapsedMs: 179000 }), coach, 0)
  current = observeVoiceEvents(current.state, observation({ phase: 'recovering', completedRounds: [round], restElapsedMs: 180000 }), coach, 100)
  assert.deepEqual(current.events.map((entry) => entry.kind), ['rest_reminder'])
  assert.deepEqual(current.events[0].numbers, { minutes: 3 })
  current = observeVoiceEvents(current.state, observation({ phase: 'round_ready', completedRounds: [round], restElapsedMs: 240000 }), coach, 200)
  assert.equal(current.events.length, 0)
  const elevator = observeVoiceEvents(initialVoiceObserverState(), observation({ phase: 'returning', completedRounds: [round], restElapsedMs: 240000 }), coach, 300)
  assert.equal(elevator.events.length, 0)
  const restored = observeVoiceEvents(initialVoiceObserverState(), observation({ phase: 'recovering', completedRounds: [round], restElapsedMs: 240000 }), coach, 400)
  assert.equal(restored.events.length, 0)
})

test('first corrected round speaks confirmed floor in one completion utterance', () => {
  const before = observeVoiceEvents(initialVoiceObserverState(), observation(), settings, 0)
  const round = { id: 'confirmed-round', roundNumber: 1, floorsCompleted: 14, correctionRevision: 1, confirmedTopFloor: 15 }
  const completed = observeVoiceEvents(before.state, observation({ phase: 'round_complete', completedRounds: [round] }), settings, 100)
  assert.deepEqual(completed.events.map((entry) => entry.kind), ['round_finished'])
  const segments = config.buildVoiceSegments('round_finished', completed.events[0].numbers, settings)
  assert.deepEqual(segments.filter((part) => part.kind === 'number').map((part) => part.value), ['1', '14', '15'])
  assert.ok(segments.some((part) => part.kind === 'clip' && part.id === 'correction_suffix_plain'))
  const restored = observeVoiceEvents(initialVoiceObserverState(), observation({ phase: 'round_complete', completedRounds: [round], elapsedMs: 10000 }), settings, 200)
  assert.equal(restored.events.length, 0)
})

test('versioned JSON library replacement validates numeric slots and keeps encouragement optional', () => {
  const replacement = JSON.parse(JSON.stringify(config.DEFAULT_VOICE_LIBRARY))
  replacement.id = 'verified-replacement'
  replacement.version = '3.0.0'
  replacement.templates.time_milestone.id = 'time.replacement.v3'
  replacement.templates.time_milestone.parts[0].id = 'floors_prefix'
  const loaded = config.parseVoiceTemplateLibrary(replacement)
  const custom = config.normalizeVoiceSettings({ templateLibrary: loaded, encouragementEnabled: false })
  const parts = config.buildVoiceSegments('time_milestone', { minutes: 20 }, custom)
  assert.equal(parts[0].id, 'floors_prefix')
  assert.equal(parts.length, 3)
  const invalid = JSON.parse(JSON.stringify(replacement))
  invalid.templates.time_milestone.parts[1].slot = 'entireSentence'
  assert.throws(() => config.parseVoiceTemplateLibrary(invalid), /numeric slots only/)
  invalid.templates.time_milestone.parts[1] = { kind: 'clip', id: '../outside' }
  assert.throws(() => config.parseVoiceTemplateLibrary(invalid), /recorded clip IDs/)
  for (const kind of Object.keys(config.VOICE_TEMPLATE_LIBRARY)) {
    const muted = config.buildVoiceSegments(kind, event(kind).numbers, config.normalizeVoiceSettings({ detailMode: 'coach', encouragementEnabled: false }))
    assert.ok(muted.every((part) => part.kind !== 'clip' || !part.id.startsWith('encourage_')))
    assert.ok(muted.every((part) => part.kind !== 'clip' || !['time_suffix', 'calorie_suffix', 'round_started_suffix', 'workout_done', 'total_suffix', 'correction_suffix'].includes(part.id)))
  }
})

test('queue prioritizes round feedback, de-duplicates, plays sequentially and journals fallback', async () => {
  const output = backend({ fallback: true })
  const queue = new WorkoutVoiceQueue(output, { now: () => 100, gapMs: 0 })
  const events = [event('time_milestone'), event('round_finished')]
  queue.enqueue(events)
  queue.enqueue(events)
  await queue.waitUntilIdle()
  assert.equal(output.calls.length, 2)
  assert.equal(output.calls[0].segments[0].id, 'round_prefix')
  assert.equal(output.maxActive, 1)
  assert.equal(queue.getJournal().filter((e) => e.outcome === 'played').length, 2)
  assert.ok(queue.getJournal().filter((e) => e.outcome === 'played').every((e) => e.numericFallback))
  queue.enqueue(events)
  await queue.waitUntilIdle()
  assert.equal(output.calls.length, 2)
})

test('expiry and unavailable native modules are journaled without substituting haptics', async () => {
  const output = backend()
  const queue = new WorkoutVoiceQueue(output, { now: () => 200, gapMs: 0 })
  queue.enqueue([event('round_started', 'stale', { expiresAt: 100 })])
  await queue.waitUntilIdle()
  assert.equal(output.calls.length, 0)
  assert.equal(queue.getJournal().at(-1).outcome, 'expired')
  const unavailable = new WorkoutVoiceQueue({ ...output, available: () => false }, { now: () => 100, gapMs: 0 })
  unavailable.enqueue([event('round_started')])
  assert.equal(unavailable.getJournal().at(-1).outcome, 'unavailable')
})

test('turning voice off stops active audio and drops pending feedback', async () => {
  const output = backend({ deferred: true })
  const queue = new WorkoutVoiceQueue(output, { now: () => 100, gapMs: 0 })
  queue.enqueue([event('round_finished'), event('time_milestone')])
  await tick()
  queue.setSettings({ enabled: false })
  await queue.waitUntilIdle()
  assert.equal(output.stopped, 1)
  assert.equal(output.calls.length, 1)
  assert.equal(queue.getJournal().filter((e) => e.outcome === 'disabled').length, 2)
  assert.equal(queue.getJournal().filter((e) => e.outcome === 'played').length, 0)
  await queue.dispose()
  assert.equal(output.released, 1)
})

test('final completion cancels obsolete active announcements and drains the result', async () => {
  const output = backend({ deferred: true })
  const queue = new WorkoutVoiceQueue(output, { now: () => 100, gapMs: 0 })
  queue.enqueue([event('time_milestone')])
  await tick()
  queue.enqueue([event('workout_finished')])
  await tick()
  assert.equal(output.calls.length, 2)
  assert.equal(output.calls[1].segments[0].id, 'workout_done_plain')
  output.settle.resolve()
  await queue.waitUntilIdle()
  assert.equal(queue.getJournal().filter((e) => e.outcome === 'superseded').length, 1)
  assert.equal(queue.getJournal().filter((e) => e.outcome === 'played')[0].kind, 'workout_finished')
})

test('loss of audio focus does not block subsequent training feedback', async () => {
  const output = backend({ failing: true })
  const queue = new WorkoutVoiceQueue(output, { now: () => 100, gapMs: 0 })
  queue.enqueue([event('round_started'), event('time_milestone')])
  await queue.waitUntilIdle()
  assert.equal(output.calls.length, 2)
  assert.equal(queue.getJournal().filter((e) => e.outcome === 'failed').length, 2)
  assert.equal(output.active, 0)
})

test('stop cancels gap timers and audio; late callbacks cannot complete a cancelled event', async () => {
  const output = backend({ deferred: true })
  const queue = new WorkoutVoiceQueue(output, { now: () => 100, gapMs: 0 })
  queue.enqueue([event('round_started')])
  await tick()
  await queue.stop()
  assert.equal(output.active, 0)
  assert.equal(queue.getJournal().filter((e) => e.outcome === 'cancelled').length, 1)
  assert.equal(queue.getJournal().filter((e) => e.outcome === 'played').length, 0)
})

test('muting during the spacing gap clears its timer and safely drains an empty queue', async () => {
  const output = backend()
  const queue = new WorkoutVoiceQueue(output, { now: () => 100, gapMs: 60_000 })
  queue.enqueue([event('round_started'), event('time_milestone')])
  await tick()
  assert.equal(output.calls.length, 1)
  queue.setSettings({ enabled: false })
  await queue.waitUntilIdle()
  assert.equal(output.calls.length, 1)
  assert.equal(queue.getJournal().at(-1).outcome, 'disabled')
  await queue.dispose()
})

test('playback options and actual library, clips, numeric TTS and engine metadata reach the journal', async () => {
  const output = backend({ numberTtsUsed: true })
  const queue = new WorkoutVoiceQueue(output, { now: () => 100, gapMs: 0, settings: { rate: 1.1, bluetoothOnly: true, duckMusic: false, encouragementEnabled: false } })
  queue.enqueue([event('time_milestone')])
  await queue.waitUntilIdle()
  assert.deepEqual(output.calls[0].options, { speaker: 'serena', rate: 1.2, bluetoothOnly: true, duckMusic: false })
  const played = queue.getJournal().at(-1)
  assert.equal(played.libraryVersion, '2.0.0')
  assert.equal(played.templateId, 'time.progress.v2')
  assert.deepEqual(played.clipIds, ['time_prefix', 'minutes_unit'])
  assert.deepEqual(played.numericTexts, ['20'])
  assert.deepEqual(played.numberTtsTexts, ['20'])
  assert.equal(played.numberTtsEngine, 'android_text_to_speech')
  assert.deepEqual(played.enginesUsed, ['bundled_audio', 'number_tts'])
  assert.equal(played.playbackSource, 'prerecorded_and_number_tts')
  played.clipIds.push('outside_mutation')
  assert.equal(queue.getJournal().at(-1).clipIds.length, 2)
})

test('mixed recorded fallback logs only numbers that actually finished TTS playback', async () => {
  const output = backend({ fallback: true, numberTtsUsed: true, numberTtsTexts: ['15'] })
  const queue = new WorkoutVoiceQueue(output, { now: () => 100, gapMs: 0 })
  queue.enqueue([event('round_finished')])
  await queue.waitUntilIdle()
  const played = queue.getJournal().at(-1)
  assert.deepEqual(played.numericTexts, ['1', '73', '15'])
  assert.deepEqual(played.numberTtsTexts, ['15'])
  assert.deepEqual(played.enginesUsed, ['bundled_audio', 'recorded_number_pack', 'number_tts'])
})

test('Bluetooth and music suppression never become played feedback', async () => {
  for (const reason of ['bluetooth_unavailable', 'music_active']) {
    const output = backend({ suppressed: reason })
    const queue = new WorkoutVoiceQueue(output, { now: () => 100, gapMs: 0 })
    queue.enqueue([event('round_started')])
    await queue.waitUntilIdle()
    assert.equal(queue.getJournal().filter((entry) => entry.outcome === 'played').length, 0)
    assert.equal(queue.getJournal().at(-1).outcome, 'suppressed')
    assert.equal(queue.getJournal().at(-1).detail, reason)
    assert.equal(queue.getJournal().at(-1).playedSegments, 0)
  }
})

test('night quiet uses local 22–7 boundaries and does not replay a suppressed milestone in the morning', async () => {
  const quiet = config.normalizeVoiceSettings({ nightQuiet: true })
  for (const [hour, minute, expected] of [[21, 59, false], [22, 0, true], [6, 59, true], [7, 0, false]]) {
    assert.equal(config.isVoiceNightQuiet(quiet, new Date(2026, 9, 4, hour, minute).getTime()), expected)
  }
  let now = new Date(2026, 9, 4, 22, 0).getTime()
  const output = backend()
  const queue = new WorkoutVoiceQueue(output, { now: () => now, gapMs: 0, settings: quiet })
  queue.observe(observation())
  queue.observe(observation({ elapsedMs: 20 * 60000 }))
  await queue.waitUntilIdle()
  assert.equal(output.calls.length, 0)
  assert.equal(queue.getJournal().at(-1).detail, 'night_quiet')
  now = new Date(2026, 9, 5, 7, 0).getTime()
  queue.observe(observation({ elapsedMs: 20 * 60000 + 1000 }))
  await queue.waitUntilIdle()
  assert.equal(output.calls.length, 0)
})

test('new restrictive settings interrupt an active playlist and mode changes remove pending coach prompts', async () => {
  const output = backend({ deferred: true })
  const queue = new WorkoutVoiceQueue(output, { now: () => 100, gapMs: 0, settings: { detailMode: 'coach' } })
  queue.enqueue([event('round_finished'), event('step_milestone')])
  await tick()
  queue.setSettings({ bluetoothOnly: true, detailMode: 'concise' })
  await queue.waitUntilIdle()
  assert.equal(output.calls.length, 1)
  assert.equal(output.stopped, 1)
  assert.ok(queue.getJournal().some((entry) => entry.kind === 'step_milestone' && entry.outcome === 'disabled'))
  assert.equal(queue.getJournal().filter((entry) => entry.outcome === 'played').length, 0)
})

test('night boundary interrupts an already active announcement at the next observation', async () => {
  let now = new Date(2026, 9, 4, 21, 59, 59).getTime()
  const output = backend({ deferred: true })
  const queue = new WorkoutVoiceQueue(output, { now: () => now, gapMs: 0, settings: { nightQuiet: true } })
  queue.enqueue([event('round_finished', 'night-current', { expiresAt: now + 30000 })])
  await tick()
  now = new Date(2026, 9, 4, 22, 0).getTime()
  queue.observe(observation())
  await queue.waitUntilIdle()
  assert.equal(output.stopped, 1)
  assert.equal(queue.getJournal().at(-1).outcome, 'suppressed')
  assert.equal(queue.getJournal().at(-1).detail, 'night_quiet')
  assert.equal(queue.getJournal().filter((entry) => entry.outcome === 'played').length, 0)
})

test('encouragement rotates recorded variants without adjacent repeats and can be removed entirely', async () => {
  const output = backend()
  const queue = new WorkoutVoiceQueue(output, { now: () => 100, gapMs: 0 })
  queue.enqueue([event('time_milestone', 'first'), event('calorie_milestone', 'second')])
  await queue.waitUntilIdle()
  const spoken = output.calls.map((call) => call.segments.find((part) => part.kind === 'clip' && part.id.startsWith('encourage_')).id)
  assert.notEqual(spoken[0], spoken[1])
  queue.setSettings({ encouragementEnabled: false })
  queue.enqueue([event('time_milestone', 'third')])
  await queue.waitUntilIdle()
  assert.ok(output.calls[2].segments.every((part) => part.kind !== 'clip' || !part.id.startsWith('encourage_')))
})

const store = new Map()
const files = new Map()
let failJournalWrite = false
const originalLoad = Module._load
const voiceNativeModules = {}
Module._load = function(request, parent, isMain) {
  if (request === '@react-native-async-storage/async-storage') return {
    async getItem(key) { return store.get(key) ?? null },
    async setItem(key, value) { if (failJournalWrite) throw new Error('storage_full'); store.set(key, value) },
  }
  if (request === 'expo-file-system') return {
    Paths: { cache: 'cache' },
    File: class {
      constructor(dir, name) { this.uri = `file://${dir}/${name}` }
      write(content) { files.set(this.uri, content) }
    },
  }
  if (request === 'react-native') return { NativeModules: voiceNativeModules, Platform: { OS: 'android' } }
  return originalLoad.call(this, request, parent, isMain)
}
const service = require(path.join(compiled, 'services', 'voice-feedback.js'))

test('all four selected speakers reach the native playlist with matching recorded-number provenance', async () => {
  const calls = []
  voiceNativeModules.AndroidWorkoutVoice = {
    getCapabilities: async () => ({ speakers: ['uncle_fu', 'dylan', 'serena', 'vivian'] }),
    playSegments() { throw Error('legacy playback must not run') },
    async playSegmentsWithOptions(segments, volume, options) {
      calls.push({ segments, options }); return { playedSegments: 5, numericFallback: false, recordedNumberUsed: true }
    }, async stop() {}, async release() {},
  }
  try {
    for (const speaker of ['uncle_fu', 'dylan', 'serena', 'vivian']) {
      const voice = service.createWorkoutVoiceService({ persistJournal: false, settings: { speaker }, now: () => 100, gapMs: 0 })
      voice.enqueue([event('round_finished')]); await voice.waitUntilIdle()
      assert.equal(calls.at(-1).options.speaker, speaker)
      const played = voice.getJournal().find(entry => entry.outcome === 'played')
      assert.equal(played.playbackSource, 'prerecorded_with_recorded_numbers')
      assert.deepEqual(played.enginesUsed, ['bundled_audio', 'recorded_number_pack'])
      await voice.dispose()
    }
  } finally { delete voiceNativeModules.AndroidWorkoutVoice }
})

test('stopping during native capabilities lookup cannot start late audio', async () => {
  let resolveCapabilities, plays = 0
  voiceNativeModules.AndroidWorkoutVoice = {
    getCapabilities: () => new Promise(resolve => { resolveCapabilities = resolve }),
    playSegments() {}, async playSegmentsWithOptions() { plays++; return { playedSegments: 1, numericFallback: false } },
    async stop() {}, async release() {},
  }
  try {
    const voice = service.createWorkoutVoiceService({ persistJournal: false, now: () => 100 })
    voice.enqueue([event('round_finished')]); await tick()
    const stopped = voice.stop()
    resolveCapabilities({ speakers: ['serena'] })
    await stopped; assert.equal(plays, 0); await voice.dispose()
  } finally { delete voiceNativeModules.AndroidWorkoutVoice }
})

test('persistent journal keeps actual outcomes in order and exports JSON', async () => {
  const voice = service.createWorkoutVoiceService({ backend: backend(), gapMs: 0, now: () => 100 })
  voice.enqueue([event('round_started')])
  await voice.finish('voice-test-workout')
  const saved = await service.loadVoiceJournal('voice-test-workout')
  assert.equal(saved.schemaVersion, 1)
  assert.deepEqual(saved.entries.map((entry) => entry.outcome), ['queued', 'played'])
  const uri = await service.exportVoiceJournal('voice-test-workout')
  assert.deepEqual(JSON.parse(files.get(uri)), saved)
})

test('journal storage errors are explicit and never stop playback', async () => {
  failJournalWrite = true
  const output = backend()
  const voice = service.createWorkoutVoiceService({ backend: output, gapMs: 0, now: () => 100 })
  voice.enqueue([event('round_started', 'storage-error', { workoutId: 'voice-error-workout' })])
  await voice.waitUntilIdle()
  assert.equal(output.calls.length, 1)
  await assert.rejects(voice.flushJournal('voice-error-workout'), /voice_journal_write_failed/)
  failJournalWrite = false
  await voice.dispose()
})

test('a later successful write preserves buffered outcomes from a temporary storage failure', async () => {
  const id = 'voice-retry-workout'
  failJournalWrite = true
  const voice = service.createWorkoutVoiceService({ backend: backend(), gapMs: 0, now: () => 100 })
  voice.enqueue([event('round_started', 'before-storage-recovery', { workoutId: id })])
  await voice.waitUntilIdle()
  await assert.rejects(voice.flushJournal(id), /voice_journal_write_failed/)
  failJournalWrite = false
  voice.enqueue([event('round_finished', 'after-storage-recovery', { workoutId: id })])
  await voice.waitUntilIdle()
  await voice.flushJournal(id)
  const journal = await service.loadVoiceJournal(id)
  assert.deepEqual(journal.entries.map((entry) => entry.outcome), ['queued', 'played', 'queued', 'played'])
  assert.equal(journal.entries[0].kind, 'round_started')
  assert.equal(journal.entries[3].kind, 'round_finished')
  await voice.dispose()
})

test('corrupt existing journals stay intact rather than being filtered and overwritten', async () => {
  const id = 'voice-corrupt-workout'
  const key = 'palou.voice-journal.v1.' + id
  const original = JSON.stringify({ schemaVersion: 1, workoutId: id, updatedAt: 10, entries: [{ malformed: true }] })
  store.set(key, original)
  const voice = service.createWorkoutVoiceService({ backend: backend(), gapMs: 0, now: () => 100 })
  voice.enqueue([event('round_started', 'corruption', { workoutId: id })])
  await voice.waitUntilIdle()
  await assert.rejects(voice.flushJournal(id), /invalid_voice_journal_entry/)
  assert.equal(store.get(key), original)
  await voice.dispose()
})
