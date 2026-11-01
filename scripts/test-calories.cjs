const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')

const project = path.join(__dirname, '..')
const output = path.join(project, 'node_modules/.cache/steploop-calories')
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--ignoreConfig', '--ignoreDeprecations', '6.0',
  '--lib', 'es2022', '--rootDir', 'src', '--outDir', output, '--module', 'commonjs', '--moduleResolution', 'node',
  '--target', 'es2022', '--esModuleInterop', '--resolveJsonModule', '--skipLibCheck',
  'src/core/segmented-calories.ts', 'src/core/fusion-calories.ts', 'src/core/share-payload.ts',
  'src/core/voice-events.ts'], { cwd: project, stdio: 'inherit' })
const energy = require(path.join(output, 'core/segmented-calories.js'))
const { FusionCalorieTracker } = require(path.join(output, 'core/fusion-calories.js'))
const { buildSharePayload } = require(path.join(output, 'core/share-payload.js'))
const { observeVoiceEvents, initialVoiceObserverState } = require(path.join(output, 'core/voice-events.js'))
const { DEFAULT_VOICE_SETTINGS } = require(path.join(output, 'core/voice-config.js'))

function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`) }
function round(number, durationMs, profile, segments = []) {
  return { roundNumber: number, durationMs, calorieSegments: energy.recordStairCalorieDuration(segments, durationMs, profile, number),
    startFloor: 1, finalFloor: 3, floorCounting: 'transitions', floorsCompleted: 2, steps: 50 }
}
function workout(profile, rounds) {
  return { id: 'energy-fixture', bodyWeightKg: profile.bodyWeightKg, calorieProfile: profile, rounds,
    activeDurationMs: rounds.reduce((sum, item) => sum + item.durationMs, 0), startedAt: 0, endedAt: 900000,
    routeSnapshot: { name: '私人路线', locationName: '私人地址' }, totalFloorsCompleted: 4,
    totalAscentM: 12, totalSteps: 100, totalRoundsCompleted: rounds.length }
}
function live(record, overrides = {}) {
  const rounds = record.rounds.map(item => ({ ...item, activeMs: item.activeMs ?? item.durationMs }))
  const currentNumber = overrides.currentRoundNumber ?? rounds.length + 1
  const climbing = overrides.phase === 'ascending' && !rounds.some(item => item.roundNumber === currentNumber)
  const segments = (overrides.currentCalorieSegments ?? []).filter(item => item.roundNumber === currentNumber)
  const currentMs = climbing ? segments.reduce((sum, item) => sum + item.durationMs, 0) : 0
  const activeMs = rounds.reduce((sum, item) => sum + item.activeMs, 0) + currentMs
  const tracker = new FusionCalorieTracker(record.calorieProfile, [...rounds,
    ...(segments.length ? [{ roundNumber: currentNumber, calorieSegments: segments }] : [])])
  const snapshot = { phase: climbing ? 'climbing' : 'waiting', roundNumber: currentNumber, activeMs,
    elapsedMs: overrides.totalElapsedMs ?? 900000, roundFloors: 0, ascentM: 0 }
  tracker.observe(snapshot, rounds)
  const calorieEstimate = record.calorieEstimate ?? tracker.estimate(snapshot, rounds, record.bodyWeightKg)
  return { calorieEstimate, calories: energy.calorieDisplayValue(calorieEstimate.kilocalories),
    activeMs, currentRoundActiveMs: currentMs }
}

test('2024 pace categories subtract exactly one standard resting MET', () => {
  for (const [pace, expected] of [['slow', 35], ['general', 58], ['fast', 83]]) {
    const profile = energy.createStairCalorieProfile(60, pace)
    const result = energy.getWorkoutCalorieEstimate(workout(profile, [round(1, 600000, profile)]))
    near(result.kilocalories, expected)
    near(result.grossKilocalories - result.kilocalories, 10)
    near(result.restingKilocalories, 10)
    assert.equal(result.metric, 'active')
    assert.equal(result.scope, 'recorded_ascent_only')
  }
})

test('pace changes partition future measured time and never recalculate earlier portions', () => {
  const general = energy.createStairCalorieProfile(60)
  let segments = energy.recordStairCalorieDuration([], 60000, general, 1)
  const first = JSON.stringify(segments)
  const fast = { ...general, pace: 'fast', paceSource: 'user' }
  segments = energy.recordStairCalorieDuration(segments, 60000, fast, 1)
  assert.equal(JSON.stringify(segments), first, 'changing pace during a wait adds no time')
  segments = energy.recordStairCalorieDuration(segments, 120000, fast, 1)
  assert.deepEqual(segments.map(s => [s.pace, s.durationMs, s.paceSource]), [['general', 60000, 'default'], ['fast', 60000, 'user']])
  const result = energy.getWorkoutCalorieEstimate(workout(fast, [round(1, 120000, fast, segments)]))
  near(result.kilocalories, 14.1)
  assert.equal(result.assumedGeneralDurationMs, 60000)
})

test('repeated frames merge selections without mutating the previous snapshot', () => {
  const profile = energy.createStairCalorieProfile(70, 'slow')
  const before = energy.recordStairCalorieDuration([], 500, profile, 1)
  let after = before
  for (let ms = 1000; ms <= 60000; ms += 500) after = energy.recordStairCalorieDuration(after, ms, profile, 1)
  assert.equal(before[0].durationMs, 500)
  assert.equal(after.length, 1)
  assert.equal(after[0].durationMs, 60000)
})

test('backdated automatic completion trims the last selected pace instead of repricing the round', () => {
  const slow = energy.createStairCalorieProfile(60, 'slow')
  const fast = energy.createStairCalorieProfile(60, 'fast')
  const first = energy.recordStairCalorieDuration([], 60000, slow, 1)
  const both = energy.recordStairCalorieDuration(first, 120000, fast, 1)
  const ended = energy.recordStairCalorieDuration(both, 90000, fast, 1)
  assert.deepEqual(ended.map(s => [s.pace, s.durationMs]), [['slow', 60000], ['fast', 30000]])
  near(energy.getWorkoutCalorieEstimate(workout(fast, [round(1, 90000, fast, ended)])).kilocalories, 7.65)
  assert.equal(both[1].durationMs, 60000)
})

test('known non-ascent motion is retained as evidence but cannot earn ascent calories', () => {
  const profile = energy.createStairCalorieProfile(60, 'fast')
  let segments = []
  for (const [ms, activity] of [[60000, 'stairs_up'], [120000, 'walking'], [180000, 'stairs_down'],
    [240000, 'elevator'], [300000, 'waiting']]) {
    segments = energy.recordStairCalorieDuration(segments, ms, profile, 1, activity, 'motion_recognition')
  }
  const record = workout(profile, [{ ...round(1, 300000, profile), calorieSegments: segments }])
  const result = energy.getWorkoutCalorieEstimate(record)
  near(result.kilocalories, 8.3)
  assert.equal(result.activeDurationMs, 60000)
  assert.equal(result.excludedMotionDurationMs, 240000)
  assert.equal(result.assumedActivityDurationMs, 0)
  assert.equal(result.segments.length, 5)
  assert.ok(result.segments.filter(s => s.activity !== 'stairs_up').every(s => s.met === null))
  assert.equal(live(record).calories, 8)
})

test('uncertain activity is explicitly a phase assumption and does not become a verified classification', () => {
  const profile = energy.createStairCalorieProfile(60)
  const segments = energy.recordStairCalorieDuration([], 60000, profile, 1,
    energy.calorieActivity('uncertain'), energy.calorieActivitySource('uncertain'))
  const result = energy.getWorkoutCalorieEstimate(workout(profile, [{ ...round(1, 60000, profile), calorieSegments: segments }]))
  near(result.kilocalories, 5.8)
  assert.equal(result.assumedActivityDurationMs, 60000)
  assert.equal(result.assumedGeneralDurationMs, 60000)
  assert.equal(result.segments[0].activitySource, 'climb_phase_assumption')
})

test('missing or partly lost saved segment evidence is reported instead of filled using the latest pace', () => {
  const profile = energy.createStairCalorieProfile(60, 'fast')
  for (const segments of [undefined, []]) {
    const record = workout(profile, [{ roundNumber: 1, durationMs: 60000, calorieSegments: segments }])
    const result = energy.getWorkoutCalorieEstimate(record)
    assert.equal(result.kilocalories, 0)
    assert.equal(result.unestimatedMotionDurationMs, 60000)
  }
  const partial = energy.recordStairCalorieDuration([], 30000, energy.createStairCalorieProfile(60, 'slow'), 1)
  const result = energy.getWorkoutCalorieEstimate(workout(profile, [{ roundNumber: 1, durationMs: 60000, calorieSegments: partial }]))
  near(result.kilocalories, 1.75)
  assert.equal(result.unestimatedMotionDurationMs, 30000)
  assert.equal(result.segments[0].pace, 'slow')
})

test('invalid durations and weights cannot produce NaN, Infinity or negative heat', () => {
  for (const duration of [0, -1, NaN, Infinity, -Infinity]) {
    for (const weight of [-1, 0, NaN, Infinity, undefined]) {
      const profile = energy.createStairCalorieProfile(weight)
      assert.equal(profile.bodyWeightKg, 65)
      assert.equal(profile.weightSource, 'default_65kg')
      assert.equal(energy.getWorkoutCalorieEstimate(workout(profile, [round(1, duration, profile)])).kilocalories, 0)
      assert.equal(energy.formatCalories(energy.getWorkoutCalorieEstimate(workout(profile, [round(1, duration, profile)])).kilocalories), '0')
    }
  }
  assert.equal(energy.normalizeStairPace('unverified_automatic'), 'general')
})

test('rounds retain different selections and use one workout weight snapshot', () => {
  const slow = energy.createStairCalorieProfile(60, 'slow')
  const fast = energy.createStairCalorieProfile(60, 'fast')
  const record = workout(fast, [round(1, 60000, slow), round(2, 60000, fast)])
  record.bodyWeightKg = 120 // A consumer preference must not replace the saved profile.
  const result = energy.getWorkoutCalorieEstimate(record)
  near(result.kilocalories, 11.8)
  assert.equal(result.bodyWeightKg, 60)
})

test('resting, returning, ready and complete phases cannot add stale current-round motion', () => {
  const profile = energy.createStairCalorieProfile(60, 'general')
  const record = workout(profile, [round(1, 60000, profile)])
  for (const phase of ['round_complete', 'returning', 'start_confirmation', 'recovering', 'round_ready', 'workout_complete']) {
    const before = live(record, { phase })
    const after = live(record, { phase, totalElapsedMs: 3600000 })
    near(before.calorieEstimate.kilocalories, 5.8)
    assert.equal(after.calories, before.calories)
    assert.equal(after.activeMs, 60000)
  }
})

test('live current portions become the same persisted result at the round boundary', () => {
  const profile = energy.createStairCalorieProfile(60, 'fast')
  const first = round(1, 60000, energy.createStairCalorieProfile(60, 'slow'))
  const current = round(2, 60000, profile)
  const record = workout(profile, [first])
  const before = live(record, { phase: 'ascending', currentRoundNumber: 2,
    snapshot: { currentFloor: 3, activeMs: 60000, steps: 50 }, currentCalorieSegments: current.calorieSegments })
  const completed = workout(profile, [first, current])
  completed.calorieEstimate = energy.getWorkoutCalorieEstimate(completed)
  assert.equal(before.calories, live(completed, { phase: 'workout_complete' }).calories)
  assert.deepEqual(before.calorieEstimate.segments, completed.calorieEstimate.segments)
  assert.equal(before.activeMs, 120000)
})

test('the saved-round/ascending React transition cannot count a round twice', () => {
  const profile = energy.createStairCalorieProfile(60, 'general')
  const saved = round(1, 60000, profile)
  const result = live(workout(profile, [saved]), { phase: 'ascending', currentRoundNumber: 1,
    currentCalorieSegments: saved.calorieSegments })
  assert.equal(result.activeMs, 60000)
  near(result.calorieEstimate.kilocalories, 5.8)
})

test('starting a recorder cannot borrow a previous round snapshot or segment buffer', () => {
  const profile = energy.createStairCalorieProfile(60, 'general')
  const saved = round(1, 60000, profile)
  const result = live(workout(profile, [saved]), { phase: 'ascending', currentRoundNumber: 2,
    currentCalorieSegments: saved.calorieSegments })
  assert.equal(result.currentRoundActiveMs, 0)
  assert.equal(result.activeMs, 60000)
  near(result.calorieEstimate.kilocalories, 5.8)
})

test('round once after summation, then share exactly the same integer without body-weight leakage', () => {
  const slow = energy.createStairCalorieProfile(60, 'slow')
  const general = energy.createStairCalorieProfile(60, 'general')
  const fast = energy.createStairCalorieProfile(60, 'fast')
  const record = workout(fast, [round(1, 120000, slow), round(2, 180000, general), round(3, 60000, fast)])
  const result = live(record)
  near(result.calorieEstimate.kilocalories, 32.7)
  assert.equal(result.calories, 33)
  for (const mode of ['summary', 'poster']) {
    const payload = buildSharePayload({ workout: record, mode })
    assert.match(payload.body, /爬楼活动热量：33千卡（估算）/)
    assert.doesNotMatch(payload.body, /私人|体重|workout_setting|segmented-met|60000/)
  }
})

test('voice milestone uses the same rounded value displayed at the crossing boundary', () => {
  const profile = energy.createStairCalorieProfile(60, 'fast')
  const record = workout(profile, [])
  const observation = calories => ({ workoutId: record.id, mode: 'manual', phase: 'ascending',
    currentRoundNumber: 1, elapsedMs: 400000, calories, cumulativeFloors: 0, completedRounds: [] })
  const settings = { ...DEFAULT_VOICE_SETTINGS, enabled: true, calorieMilestones: [50] }
  const initial = observeVoiceEvents(initialVoiceObserverState(), observation(49), settings, 1000)
  const current = round(1, 49.6 / 8.3 * 60000, profile)
  const metrics = live(record, { phase: 'ascending', currentRoundNumber: 1,
    snapshot: { currentFloor: 1, activeMs: current.durationMs, steps: 100 }, currentCalorieSegments: current.calorieSegments })
  assert.equal(energy.formatCalories(metrics.calorieEstimate.kilocalories), '50')
  const crossed = observeVoiceEvents(initial.state, observation(metrics.calories), settings, 2000)
  assert.equal(crossed.events.find(event => event.kind === 'calorie_milestone')?.numbers.calories, 50)
})

test('old 1.1.5 records preserve their height/activity model without rewriting saved aggregates', () => {
  const old = { rounds: [{ roundNumber: 1, durationMs: 1800000 }], bodyWeightKg: 70, activeDurationMs: 1,
    totalElapsedMs: 1800000 }
  const before = JSON.stringify(old)
  const result = energy.getWorkoutCalorieEstimate(old)
  assert.equal(result.kilocalories, 70)
  assert.equal(result.metric, 'legacy_net')
  assert.equal(energy.calorieMetricLabel(result), '估算消耗（旧口径）')
  assert.equal(JSON.stringify(old), before)
  assert.equal(energy.getWorkoutCalorieEstimate({ ...old, bodyWeightKg: undefined }).kilocalories, 65)
})

test('saved snapshots survive JSON roundtrip and remain authoritative on reopening', () => {
  const profile = energy.createStairCalorieProfile(65, 'general')
  const record = workout(profile, [round(1, 1800000, profile)])
  record.calorieEstimate = energy.getWorkoutCalorieEstimate(record)
  const restored = JSON.parse(JSON.stringify(record))
  restored.bodyWeightKg = 99
  restored.calorieProfile.pace = 'fast'
  assert.deepEqual(energy.getWorkoutCalorieEstimate(restored), record.calorieEstimate)
  near(restored.calorieEstimate.kilocalories, 188.5)
  assert.equal(energy.formatCalories(energy.getWorkoutCalorieEstimate(restored).kilocalories), '189')
})
