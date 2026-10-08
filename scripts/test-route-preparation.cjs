const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const root = path.join(__dirname, '../node_modules/.cache/steploop-core')
const { assessPreparationRun, appendPreparationRun, nextPreparationStep, isRoutePrepared, PREPARATION_STEPS } = require(path.join(root, 'route-preparation.js'))
const { encodeRouteFile, decodeRouteFile, MAX_ROUTE_FILE_BYTES } = require(path.join(root, 'route-file.js'))
const { hasCheckedMotionReference } = require(path.join(root, 'route-motion.js'))
const { hasKnownRouteEnd } = require(path.join(root, 'route-state.js'))
const base = () => ({ id: 'r', name: '测试楼 · 东楼梯', startFloor: 1, endFloor: 3, carryMode: 'pocket',
  device: { platform: 'android', model: 'synthetic', system: 'test' }, floorHeightM: 0, totalAscentM: 0, segments: [], markers: [],
  createdAt: 1, updatedAt: 1, version: 1, status: 'draft', preparation: { version: 1, runs: [], elevator: 'present', deviceKey: 'test', referenceRevision: 1 } })
const frames = Array.from({ length: 80 }, (_, i) => ({ startMs: i * 500, endMs: (i + 1) * 500, steps: 1, cadence: 120, energy: 0.1, turnRad: 0, paused: 0 }))
const marks = [{ id: 'm1', type: 'floor', floor: 2, estimatedFloor: 2, atMs: 20000 }, { id: 'm2', type: 'floor', floor: 3, estimatedFloor: 3, atMs: 40000 }]
const input = step => ({ id: step, step, endedAt: 100000, durationMs: 40000, frames: step === 'rest' ? frames.map(f => ({...f, steps: 0})) : frames, pressures: step.startsWith('elevator') ? Array.from({length: 200}, (_, i) => ({atMs: i*200, pressure: 1000+(step === 'elevator_down' ? 1 : -1)*i*0.02})) : [], marks: step === 'check_end' || !step.startsWith('teach') && step !== 'check_floors' ? [] : marks,
  actualEndFloor: step === 'elevator_down' || step === 'walk' || step === 'rest' ? 1 : 3, estimatedEndFloor: step.startsWith('teach') || step.startsWith('check') ? 3 : 1,
  maxEstimatedFloor: step.startsWith('teach') || step.startsWith('check') ? 3 : 1, interrupted: false })
function through(steps = PREPARATION_STEPS) { let route = base(); for (const step of steps) route = appendPreparationRun(route, assessPreparationRun(route, input(step))); return route }

test('human floor boundaries bind independent segments; height is not invented', () => {
  const route = through(['teach_first'])
  assert.deepEqual(route.segments.map(s => [s.floorFrom, s.floorTo, s.stepCount]), [[1, 2, 40], [2, 3, 40]])
  assert.ok(route.segments.every(s => s.boundaryConfirmed && s.ascentM === 0))
  assert.equal(hasKnownRouteEnd(route), true)
  assert.equal(nextPreparationStep(route), 'teach_again')
  assert.equal(isRoutePrepared(route), false)
})
test('sufficient teaching repetitions cannot replace independent checks', () => {
  const route = through(['teach_first', 'teach_again'])
  assert.equal(nextPreparationStep(route), 'check_floors')
  assert.equal(hasCheckedMotionReference(route), false)
})
test('a wrong intermediate floor fails even when the endpoint agrees', () => {
  const route = through(['teach_first', 'teach_again'])
  const run = assessPreparationRun(route, { ...input('check_floors'), marks: [{ ...marks[0], estimatedFloor: 1 }, marks[1]] })
  assert.equal(run.passed, false)
  const next = appendPreparationRun(route, run)
  assert.equal(nextPreparationStep(next), 'check_floors')
  assert.deepEqual(next.segments, route.segments)
  assert.equal(next.preparation.runs.at(-1).marks[0].estimatedFloor, 1)
})
test('uninterrupted check uses its unassisted endpoint', () => {
  const run = assessPreparationRun(base(), { ...input('check_end'), estimatedEndFloor: 2 })
  assert.equal(run.passed, false)
})
test('sensor interruption cannot pass even with correct answers', () => {
  for (const step of PREPARATION_STEPS) assert.equal(assessPreparationRun(base(), { ...input(step), interrupted: true }).passed, false)
})
test('missing, reversed, or repeated floor taps do not create a route', () => {
  for (const wrong of [marks.slice(1), [...marks].reverse(), [marks[0], marks[0]], [marks[0], { ...marks[1], atMs: 20000 }]])
    assert.equal(assessPreparationRun(base(), { ...input('teach_first'), marks: wrong }).passed, false)
})
test('second teaching ascent must agree with the first per-floor footsteps', () => {
  const route = through(['teach_first'])
  const run = assessPreparationRun(route, { ...input('teach_again'), frames: frames.map(f => ({ ...f, steps: 3 })) })
  assert.equal(run.passed, false)
})
test('elevator, flat walking and rest reject any false ascent including one later corrected', () => {
  for (const step of ['elevator_down', 'elevator_up', 'walk', 'rest']) {
    assert.equal(assessPreparationRun(base(), { ...input(step), maxEstimatedFloor: 2, estimatedEndFloor: 1 }).passed, false)
    assert.equal(assessPreparationRun(base(), { ...input(step), durationMs: 19000 }).passed, false)
  }
})
test('flat walking check cannot be passed by remaining still', () => {
  assert.equal(assessPreparationRun(base(), { ...input('walk'), frames: frames.map(f => ({ ...f, steps: 0 })) }).passed, false)
})
test('whole ordered workflow becomes ready; duplicate saves are idempotent', () => {
  const route = through()
  assert.equal(isRoutePrepared(route), true)
  assert.equal(hasCheckedMotionReference(route), true)
  assert.equal(appendPreparationRun(route, route.preparation.runs[0]), route)
  assert.throws(() => appendPreparationRun(base(), { ...input('check_end'), passed: true }), /路线已更新/)
})
test('a staircase without elevator explicitly excludes that scope', () => {
  let route = base(); route.preparation.elevator = 'absent'
  for (const step of PREPARATION_STEPS.filter(s => !s.startsWith('elevator'))) route = appendPreparationRun(route, assessPreparationRun(route, input(step)))
  assert.equal(isRoutePrepared(route), true)
  assert.equal(route.preparation.elevator, 'absent')
  assert.equal(route.preparation.runs.some(r => r.step.startsWith('elevator')), false)
})
test('share roundtrip retains route binding and elevator evidence but excludes personal histories and local identity', () => {
  const route = through(); route.workouts = ['PRIVATE WORKOUT']; route.sessions = ['PRIVATE SESSION']; route.rawSamples = ['PRIVATE RAW']; route.preparation.deviceKey = 'PRIVATE DEVICE'
  const content = encodeRouteFile(route)
  assert.ok(!content.includes('PRIVATE'))
  const imported = decodeRouteFile(content)
  assert.deepEqual(imported.segments, route.segments)
  assert.ok(imported.preparation.runs.find(r => r.step === 'elevator_down').frames.length)
  assert.equal(imported.preparation.runs.find(r => r.step === 'check_floors').passed, false)
  assert.equal(nextPreparationStep(imported), 'check_floors')
  assert.equal(isRoutePrepared(imported), false)
  assert.equal(route.status, 'verified', 'export cannot mutate original route')
})
test('damaged and foreign files fail before storage receives them', () => {
  for (const value of ['{', '{}', JSON.stringify({ format: 'backup', version: 1 }), ' '.repeat(MAX_ROUTE_FILE_BYTES + 1)]) assert.throws(() => decodeRouteFile(value))
  const file = JSON.parse(encodeRouteFile(through()))
  file.route.segments[0].features[0][0] = null
  assert.throws(() => decodeRouteFile(JSON.stringify(file)))
  file.route.segments = []
  assert.throws(() => decodeRouteFile(JSON.stringify(file)))
})
test('legacy real routes stay intact but never masquerade as newly checked routes', () => {
  const legacy = base(); delete legacy.preparation; legacy.status = 'verified'
  const before = JSON.stringify(legacy)
  assert.equal(isRoutePrepared(legacy), false)
  assert.equal(nextPreparationStep(legacy), 'teach_first')
  assert.equal(JSON.stringify(legacy), before)
})
