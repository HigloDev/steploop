const path = require('node:path')
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')
const test = require('node:test')

const project = path.resolve(__dirname, '..')
const output = path.join(project, 'node_modules/.cache/prd-metrics')
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--ignoreConfig',
  '--ignoreDeprecations', '6.0', '--lib', 'es2022', '--rootDir', 'src', '--outDir', output,
  '--module', 'commonjs', '--moduleResolution', 'node', '--target', 'es2022', '--skipLibCheck',
  'src/core/live-workout-metrics.ts', 'src/core/building-progress.ts'], { cwd: project, stdio: 'inherit' })
const { deriveLiveWorkoutMetrics } = require(path.join(output, 'core/live-workout-metrics.js'))
const { buildingProgress } = require(path.join(output, 'core/building-progress.js'))

function metrics(overrides = {}) {
  return deriveLiveWorkoutMetrics({
    rounds: [{ startFloor: 1, finalFloor: 15, floorsCompleted: 14,
      floorCounting: 'transitions', durationMs: 120000, steps: 280 }],
    phase: 'ascending', snapshot: { currentFloor: 3, activeMs: 30000, steps: 40 },
    startFloor: 1, totalElapsedMs: 300000, bodyWeightKg: 60, ...overrides,
  })
}

test('live totals combine saved rounds and current motion with distinct elapsed and climbing time', () => {
  const result = metrics()
  assert.equal(result.steps, 320)
  assert.equal(result.floors, 16)
  assert.equal(result.currentRoundActiveMs, 30000)
  assert.equal(result.activeMs, 150000)
  assert.equal(result.totalMs, 300000)
  assert.equal(result.nonClimbingMs, 150000)
  // Current net-energy model: 30 m inferred ascent, 60 kg, 150 s active.
  assert.ok(Math.abs(result.calories - 26.101816443594647) < 1e-9)
  assert.equal(result.floorsPerMinute, 6.4)
})

test('saving a round and entering the elevator do not count the old live snapshot twice', () => {
  for (const phase of ['round_complete', 'returning', 'recovering', 'round_ready', 'workout_complete']) {
    const result = metrics({ phase, snapshot: { currentFloor: 15, activeMs: 120000, steps: 280 } })
    assert.equal(result.floors, 14, phase)
    assert.equal(result.steps, 280, phase)
    assert.equal(result.activeMs, 120000, phase)
    assert.equal(result.currentRoundActiveMs, phase === 'round_ready' ? 0 : 120000, phase)
    assert.ok(Math.abs(result.calories - 20.881453154875718) < 1e-9, phase)
    assert.equal(result.nonClimbingMs, 180000, phase)
  }
})

test('preparing and starting a new round resets its own time while preserving accumulated motion', () => {
  for (const phase of ['round_ready', 'ascending']) {
    const result = metrics({ phase, snapshot: { currentFloor: 1, activeMs: 0, steps: 0 } })
    assert.equal(result.currentRoundActiveMs, 0)
    assert.equal(result.activeMs, 120000)
    assert.equal(result.floors, 14)
    assert.equal(result.steps, 280)
  }
})

test('legacy metadata stays intact while totals use traversed floor intervals', () => {
  const legacy = { startFloor: 1, finalFloor: 15, floorsCompleted: 15, durationMs: 120000, steps: 280 }
  assert.equal(metrics({ rounds: [legacy], phase: 'workout_complete' }).floors, 14)
  assert.equal(legacy.floorsCompleted, 15)
  assert.equal(metrics({ rounds: [], phase: 'ascending', snapshot: { currentFloor: 1, activeMs: 0, steps: 0 } }).floors, 0)
})

test('waiting changes only elapsed/rest time, and calories use the workout weight snapshot', () => {
  const before = metrics({ phase: 'recovering' })
  const after = metrics({ phase: 'recovering', totalElapsedMs: 360000 })
  assert.equal(after.calories, before.calories)
  assert.equal(after.steps, before.steps)
  assert.equal(after.activeMs, before.activeMs)
  assert.equal(after.nonClimbingMs - before.nonClimbingMs, 60000)
  assert.ok(Math.abs(metrics({ bodyWeightKg: 90 }).calories - 39.15272466539197) < 1e-9)
})

test('the result building reaches the exact cumulative count including above 60 and empty workouts', () => {
  for (const floors of [0, 1, 13, 28, 60, 73, 1000]) {
    const final = buildingProgress(floors, 10000)
    assert.equal(final.built, floors)
    assert.equal(final.total, floors)
    assert.equal(final.complete, true)
    assert.ok(final.visibleFloors.length <= 80)
    if (floors > 0) assert.equal(final.visibleFloors.at(-1), floors)
    assert.equal(buildingProgress(floors, 0).built, 0)
    assert.equal(buildingProgress(floors, 0, true).built, floors)
  }
})

test('animation progress stays monotonic and preserves floors when the drawing window scrolls', () => {
  let previous = 0
  for (let elapsed = 0; elapsed <= 6000; elapsed += 100) {
    const progress = buildingProgress(120, elapsed)
    assert.ok(progress.built >= previous)
    assert.ok(progress.built <= 120)
    previous = progress.built
  }
  assert.equal(previous, 120)
})
