const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.join(__dirname, '..')
const core = name => require(path.join(root, 'node_modules/.cache/steploop-core', name + '.js'))
const { normalizeFloorNumber, floorAfter, shiftFloorNumber } = core('floors')
const { FusionWorkoutEngine } = core('fusion-engine')
const { WorkoutFeedbackTracker } = core('workout-feedback')
const { liveWorkoutMetrics } = core('live-workout-metrics')
const { buildWeeklyAchievement, weeklyShareText } = core('weekly-achievement')
const { buildFusionWorkout, fusionRoundToWorkoutRound } = core('fusion-workout')
const { normalizeBuildingTemplate } = core('building-template')

test('completion sound waits for the native finished event, releases once, and silently disabled playback resolves', async () => {
  let listener, releases = 0, finished = 0, enabled = true, plays = 0
  const player = { addListener: (_, callback) => { listener = callback; return { remove: () => { listener = undefined } } },
    play: () => { plays++ }, pause: () => {}, release: () => { releases++ } }
  const mocks = {
    'expo-audio': { createAudioPlayer: () => player, setAudioModeAsync: async () => {} },
    'react-native': { AppState: { currentState: 'active' } },
    './preferences': { getPreferences: async () => ({ completionSound: enabled }) },
    '../../assets/audio/building-complete.wav': 42,
  }
  const module = { exports: {} }
  const js = ts.transpileModule(fs.readFileSync(path.join(root, 'src/services/completion-sound.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  new Function('require', 'module', 'exports', '__DEV__', js)(name => { assert.ok(name in mocks, name); return mocks[name] }, module, module.exports, false)
  const stop = await module.exports.playCompletionSound(() => { finished++ })
  assert.equal(plays, 1)
  assert.equal(finished, 0)
  listener({ isLoaded: true, didJustFinish: false })
  assert.equal(finished, 0)
  listener({ isLoaded: true, didJustFinish: true })
  assert.equal(finished, 1)
  assert.equal(releases, 1)
  stop()
  assert.equal(releases, 1)
  enabled = false
  await module.exports.playCompletionSound(() => { finished++ })
  assert.equal(finished, 2)
  assert.equal(plays, 1)
})

test('floor input, selection, engine entry and old template normalization never produce floor zero', () => {
  for (const invalid of [0, -0, NaN, Infinity]) assert.equal(normalizeFloorNumber(invalid), 1)
  assert.equal(normalizeFloorNumber(-0.2), -1)
  assert.equal(shiftFloorNumber(1, -1), -1)
  assert.equal(shiftFloorNumber(-1, 1), 1)
  assert.equal(floorAfter(-2, 2), 1)
  assert.equal(floorAfter(0, 0), 1)
  const engine = new FusionWorkoutEngine({ startedAt: 1000, startFloor: 0 })
  assert.equal(engine.snapshot().currentFloor, 1)
  engine.markFloor(4000)
  assert.equal(engine.snapshot().currentFloor, 2)
  const raw = { id: 'old-zero', startFloor: 0, floors: [{ heightM: 3 }] }
  const normalized = normalizeBuildingTemplate(raw)
  assert.equal(normalized.startFloor, 1)
  assert.equal(normalized.floors[0].floorFrom, 1)
  assert.equal(normalized.floors[0].floorTo, 2)
  assert.equal(raw.startFloor, 0, 'read normalization does not rewrite saved source data')
  const templateEngine = new FusionWorkoutEngine({ startedAt: 1000, template: { ...normalized, startFloor: 0 } })
  assert.equal(templateEngine.snapshot().startFloor, 1)
})

test('floor achievement feedback is distinct, once per advance, with no replay on recovery or round rollover', () => {
  const tracker = new WorkoutFeedbackTracker({ totalFloors: 15, completedRounds: 1 })
  assert.equal(tracker.observe({ totalFloors: 15, completedRounds: 1 }), undefined)
  assert.equal(tracker.observe({ totalFloors: 16, completedRounds: 1 }), 'floor')
  assert.equal(tracker.observe({ totalFloors: 16, completedRounds: 1 }), undefined)
  assert.equal(tracker.observe({ totalFloors: 30, completedRounds: 2 }), 'round_complete')
  assert.equal(tracker.observe({ totalFloors: 30, completedRounds: 2 }), undefined)
  assert.equal(tracker.observe({ totalFloors: 31, completedRounds: 2 }), 'floor')
})

test('live metrics include current ascent and exclude elevator/rest time from floor frequency', () => {
  const snapshot = { phase: 'climbing', steps: 480, totalFloors: 20, roundFloors: 5,
    activeMs: 240000, ascentMs: 300000, ascentM: 63, elapsedMs: 900000 }
  const metrics = liveWorkoutMetrics(snapshot, [], 85)
  assert.equal(metrics.steps, 480)
  assert.equal(metrics.floorsPerMinute, 4)
  assert.equal(metrics.ascentM, 63)
  assert.ok(metrics.calories > 40)
  const waiting = liveWorkoutMetrics({ ...snapshot, phase: 'waiting', elapsedMs: 1500000 }, [], 85)
  assert.deepEqual(waiting, metrics)
  assert.equal(liveWorkoutMetrics({ ...snapshot, ascentMs: 0, totalFloors: 0, ascentM: 0, activeMs: 0 }, [], 85).floorsPerMinute, 0)
})

function workout(id, at, floors, status = 'completed') {
  const round = { id: id + '-round', roundNumber: 1, kind: 'auto', startedAt: at, topAt: at + 120000,
    endedAt: at + 120000, startFloor: -1, finalFloor: floorAfter(-1, floors), floors,
    ascentM: floors * 3, steps: floors * 18, activeMs: 100000, durationMs: 120000, confidence: 0.95,
    estimated: false, floorRecords: [], endReason: 'elevator_down', interruptions: [], baroCoverage: 1, notes: [] }
  const result = buildFusionWorkout({ id, startedAt: at, endedAt: at + 120000, status,
    rounds: [fusionRoundToWorkoutRound(round)], bodyWeightKg: 85 })
  result.routeSnapshot.name = 'PRIVATE BUILDING'
  result.routeSnapshot.locationName = 'PRIVATE ADDRESS'
  return result
}

test('weekly share matches corrected round totals, local week range and seven day buckets without leaking private data', () => {
  const now = new Date(2026, 9, 10, 20).getTime()
  const saturday = new Date(2026, 9, 10, 9).getTime()
  const friday = saturday - 86400000
  const corrected = workout('private-id-corrected', friday, 12)
  corrected.totalFloorsCompleted = 999 // stale cache must not drive the poster
  const records = [workout('private-id-1', saturday, 10), corrected,
    workout('private-id-cancelled', saturday, 40, 'cancelled'), workout('private-id-old', saturday - 7 * 86400000, 100)]
  const week = buildWeeklyAchievement(records, now)
  assert.equal(week.floors, 22)
  assert.equal(week.ascentM, 66)
  assert.equal(week.workouts, 2)
  assert.equal(week.steps, 396)
  assert.equal(week.days.length, 7)
  assert.deepEqual(week.days.map(day => day.floors), [0, 0, 0, 0, 12, 10, 0])
  assert.equal(week.streak, 2)
  const text = weeklyShareText(week)
  assert.match(text, /22 层/)
  assert.match(text, /10\.05 — 10\.11/)
  assert.doesNotMatch(JSON.stringify(week) + text, /PRIVATE|private-id|location|routeSnapshot/)
  const empty = buildWeeklyAchievement([], now)
  assert.equal(empty.floors, 0)
  assert.equal(empty.workouts, 0)
  assert.ok(empty.days.every(day => day.floors === 0))
})

test('Android floor pulse reaches the vibration service; turning feedback off suppresses milestones and buttons', async () => {
  const calls = []
  let saved = JSON.stringify({ hapticFeedback: true })
  const haptics = { ImpactFeedbackStyle: {}, AndroidHaptics: { Segment_Tick: 'tick' },
    performAndroidHapticsAsync: async effect => calls.push(effect) }
  const mocks = {
    '@react-native-async-storage/async-storage': { getItem: async () => saved, setItem: async (_, value) => { saved = value } },
    'expo-haptics': haptics,
    'react-native': { Platform: { OS: 'android' }, Vibration: { vibrate: pattern => calls.push(pattern) } },
    '../core/voice-speaker': { normalizeVoiceSpeaker: () => 'serena' },
  }
  const module = { exports: {} }
  const js = ts.transpileModule(fs.readFileSync(path.join(root, 'src/services/preferences.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  new Function('require', 'module', 'exports', js)(name => { assert.ok(name in mocks, name); return mocks[name] }, module, module.exports)
  await module.exports.triggerHapticPattern('floor')
  assert.deepEqual(calls, [[0, 65, 80, 65]])
  await module.exports.triggerHaptic('selection')
  assert.equal(calls[1], 'tick')
  await module.exports.savePreferences({ hapticFeedback: false })
  await module.exports.triggerHapticPattern('floor')
  await module.exports.triggerHapticPattern('goal_complete')
  await module.exports.triggerHaptic('selection')
  assert.equal(calls.length, 2)
})

test('completion audio is a real short PCM bell, and playback requests no recording permissions', () => {
  const wav = fs.readFileSync(path.join(root, 'assets/audio/building-complete.wav'))
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.readUInt32LE(24), 44100)
  assert.equal(wav.readUInt16LE(34), 16)
  assert.equal(wav.readUInt32LE(40) / 88200, 2.5)
  let peak = 0
  for (let offset = 44; offset < wav.length; offset += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)))
  assert.ok(peak > 12000 && peak < 17000, 'audible with headroom, never clipped')
  const audioPlugin = require('../app.json').expo.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-audio')
  assert.equal(audioPlugin[1].recordAudioAndroid, false)
  assert.equal(audioPlugin[1].microphonePermission, false)
  assert.equal(audioPlugin[1].enableBackgroundPlayback, false)
})
