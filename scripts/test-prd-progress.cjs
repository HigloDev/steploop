const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.join(__dirname, '..')
const compiled = path.join(root, 'node_modules', '.cache', 'steploop-prd-progress')
execFileSync(process.execPath, [
  require.resolve('typescript/bin/tsc'), '--ignoreConfig', '--ignoreDeprecations', '6.0',
  '--lib', 'es2022', '--outDir', compiled, '--module', 'commonjs',
  '--moduleResolution', 'node', '--target', 'es2022', '--esModuleInterop', '--skipLibCheck',
  'src/core/training-progress.ts', 'src/core/progress-trends.ts', 'src/core/corrections.ts',
  'src/core/route-learning.ts',
], { cwd: root, stdio: 'pipe' })
const progress = require(path.join(compiled, 'training-progress.js'))
const trends = require(path.join(compiled, 'progress-trends.js'))
const { isRoundLearnable, applyRoundCorrection } = require(path.join(compiled, 'corrections.js'))
const { summarizeRouteLearning } = require(path.join(compiled, 'route-learning.js'))
const now = new Date(2026, 9, 4, 12).getTime()

function round(overrides = {}) {
  return {
    id: 'r1', floorCounting: 'transitions', roundNumber: 1,
    startedAt: now - 300_000, endedAt: now - 100_000, durationMs: 200_000,
    startFloor: 1, targetFloor: 15, finalFloor: 15, floorsCompleted: 14,
    ascentM: 42, steps: 420, confidence: 0.92, complete: true,
    completionReason: 'route_complete', floorSplits: [], events: [], interruptions: [],
    completionSource: 'automatic', trustworthy: true, ...overrides,
  }
}
function workout(overrides = {}) {
  const rounds = overrides.rounds ?? [round()]
  return {
    id: 'w1', floorCounting: 'transitions', templateId: 'route-a', templateVersion: 1,
    routeSnapshot: { name: 'A', locationName: 'A', startFloor: 1, endFloor: 15, floorsPerRound: 14, ascentPerRoundM: 42 },
    goal: { type: 'open' }, returnConfirmationMode: 'manual', status: 'completed',
    startedAt: now - 300_000, endedAt: now - 100_000, createdAt: now - 300_000,
    updatedAt: now - 100_000, rounds, currentRoundNumber: rounds.length,
    totalRoundsCompleted: 1, totalFloorsCompleted: 99, totalAscentM: 999,
    totalSteps: 420, activeDurationMs: 200_000, returnDurationMs: 0,
    recoveryDurationMs: 0, totalElapsedMs: 200_000, ...overrides,
  }
}
function trendOf(workouts) {
  return trends.auditTrend(workouts, { bucket: 'week', fromMs: now - 400_000, toMs: now, timeZoneOffsetMinutes: 480 })
}

test('confirmed 15F yields 14 real floors in weekly progress, goals and trend, but not PB or model learning', () => {
  const original = round({ finalFloor: 12, floorsCompleted: 11, ascentM: 33 })
  const corrected = applyRoundCorrection(original, { finalFloor: 15, floorsCompleted: 14, ascentM: 42 }, { at: now - 100_000, id: 'confirm-15' })
  const saved = workout({ rounds: [corrected] })
  const weekly = progress.deriveTrainingProgress([saved], now)
  assert.equal(weekly.validWorkouts, 1)
  assert.equal(weekly.floors, 14)
  assert.equal(weekly.ascentM, 42)
  assert.equal(weekly.consecutiveWeeks, 1)
  assert.deepEqual(weekly.personalBests, {})
  assert.equal(progress.isPersonalBestEligible(saved), false)
  assert.equal(trends.isEligibleTrendWorkout(saved), true)
  assert.deepEqual(trends.computeRoutePersonalBests([saved]), [])
  assert.equal(isRoundLearnable(corrected), false)
  const route = { id: 'route-a', segments: [], updatedAt: now, startFloor: 1, endFloor: 15, totalAscentM: 42 }
  assert.equal(summarizeRouteLearning(route, [saved]).validCount, 0)
  const audit = trendOf([saved])
  assert.equal(audit.counted, 1)
  assert.equal(audit.points[0].floors, 14)
  assert.equal(audit.points[0].ascentM, 42)
  assert.equal(audit.points[0].bestRoundMs, undefined)
  assert.equal(audit.excluded.corrected, 0)
  const goals = trends.computeWeekGoal([saved], { targetWorkouts: 1, targetFloors: 14, targetAscentM: 42 }, now)
  assert.equal(goals.achieved, true)
  assert.equal(goals.doneFloors, 14)
})

test('early ending and low-confidence manual confirmation still contribute to ordinary progress', () => {
  const saved = workout({ rounds: [round({
    finalFloor: 13, floorsCompleted: 12, ascentM: 36, complete: false,
    completionReason: 'manual_finish', completionSource: 'manual', trustworthy: false,
    confidence: 0.25, interruptions: [{ startMs: 1000, endMs: 2000 }],
  })] })
  assert.equal(progress.deriveTrainingProgress([saved], now).floors, 12)
  assert.equal(trendOf([saved]).counted, 1)
  assert.equal(trends.computeWeekGoal([saved], { targetFloors: 12 }, now).achieved, true)
  assert.deepEqual(trends.computeRoutePersonalBests([saved]), [])
  assert.equal(isRoundLearnable(saved.rounds[0]), false)
})

test('zero true ascent cannot inflate ordinary workouts or floors from stale cached values', () => {
  const saved = workout({ rounds: [round({
    finalFloor: 1, floorsCompleted: 99, ascentM: 99, durationMs: 15_000,
    completionSource: 'manual', trustworthy: false,
  })] })
  const weekly = progress.deriveTrainingProgress([saved], now)
  assert.equal(weekly.validWorkouts, 0)
  assert.equal(weekly.floors, 0)
  assert.equal(weekly.ascentM, 0)
  assert.equal(trendOf([saved]).counted, 0)
  const goals = trends.computeWeekGoal([saved], { targetFloors: 1, targetWorkouts: 1 }, now)
  assert.equal(goals.doneWorkouts, 0)
  assert.equal(goals.doneFloors, 0)
  assert.equal(goals.achieved, false)
})

test('unflagged historical manual/corrected records retain their original exclusion behavior', () => {
  const oldRound = round({ floorCounting: undefined, floorsCompleted: 15 })
  const old = workout({ floorCounting: undefined, rounds: [oldRound] })
  const corrected = workout({
    id: 'legacy-corrected', floorCounting: undefined,
    rounds: [applyRoundCorrection(oldRound, { finalFloor: 13 }, { at: now, id: 'old-correction' })],
  })
  const manual = workout({
    id: 'legacy-manual', floorCounting: undefined,
    rounds: [round({ floorCounting: undefined, completionSource: 'manual', trustworthy: false })],
  })
  const weekly = progress.deriveTrainingProgress([old, corrected, manual], now)
  assert.equal(weekly.validWorkouts, 1)
  assert.equal(weekly.floors, 14)
  assert.equal(oldRound.floorsCompleted, 15, 'reading progress must not rewrite historical metadata')
  assert.equal(weekly.personalBests['route-a'].workoutId, old.id)
  const audit = trendOf([old, corrected, manual])
  assert.equal(audit.counted, 1)
  assert.equal(audit.points[0].floors, 14)
  assert.equal(audit.excluded.corrected, 1)
  assert.equal(audit.excluded.invalid, 1)
})

test('new automatic clean records can still earn a PB; corrected faster records cannot replace it', () => {
  const clean = workout({ id: 'clean' })
  const corrected = workout({ id: 'manual-faster', rounds: [round({
    durationMs: 50_000, completionSource: 'manual', trustworthy: false,
    userCorrectionCount: 1,
  })] })
  const weekly = progress.deriveTrainingProgress([clean, corrected], now)
  assert.equal(weekly.floors, 28)
  assert.equal(weekly.validWorkouts, 2)
  assert.equal(weekly.personalBests['route-a'].workoutId, 'clean')
  assert.equal(trends.computeRoutePersonalBests([clean, corrected])[0].bestRoundMs, 200_000)
  assert.equal(trendOf([clean, corrected]).points[0].bestRoundMs, 200_000)
})

test('workout transition flag controls totals even when a round lacks its flag; no inputs mutate', () => {
  const saved = workout({ rounds: [round({ floorCounting: undefined, floorsCompleted: 15 })] })
  const before = JSON.stringify(saved)
  assert.equal(progress.deriveTrainingProgress([saved], now).floors, 14)
  assert.equal(trendOf([saved]).points[0].floors, 14)
  assert.equal(JSON.stringify(saved), before)
})
