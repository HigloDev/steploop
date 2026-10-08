const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const core = name => require(path.join(__dirname, '../node_modules/.cache/steploop-core', `${name}.js`))
const { RouteRecognizer } = core('recognizer')
const { FreeRecognizer } = core('free-recognizer')
const { PressureTrend } = core('pressure-trend')
const { vectorizeFrame, rebuildDraftBoundaries, buildSegments, analyzeCalibration } = core('analysis')
const { createMotionReference, recordMotionCheck, hasCheckedMotionReference } = core('route-motion')
const { getRoundAchievementCount } = core('floors')
const { calculateWorkoutSummary, roundFromSession } = core('workout-summary')

function frame(index, steps = 2, turn = 0) {
  return { startMs: index * 500, endMs: (index + 1) * 500, steps,
    cadence: steps * 120, energy: steps ? 0.12 : 0.01, turnRad: turn, headingTurnRad: turn, paused: steps ? 0 : 1 }
}
function route(turns = 1, checked = false) {
  const frames = Array.from({ length: 12 }, (_, index) => frame(index, 2,
    turns && index === 7 ? 1.2 : turns === 2 && index === 3 ? -1.2 : 0))
  return { id: 'motion-fixture', name: '模拟楼梯', startFloor: 1, endFloor: 2, carryMode: 'pocket', featureSpace: 'heading',
    floorHeightM: 3.3, totalAscentM: 3.3, device: { platform: 'test', model: 'test', system: 'test' },
    segments: [{ id: 'segment-1', type: 'flight', startMs: 0, endMs: 6000, floorFrom: 1, floorTo: 2,
      ascentM: 3.3, stepCount: 24, features: frames.map(f => vectorizeFrame(f)), turnCount: turns, boundaryConfirmed: true }],
    markers: [], createdAt: 0, updatedAt: 0, version: 1, status: 'needs_validation',
    motionReference: { version: 1, carryMode: 'pocket', allBoundariesMarked: true, checkedRuns: checked ? 5 : 0,
      checkedDays: checked ? ['2026-10-07', '2026-10-08'] : [], floorAnchors: [{ floor: 2, atMs: 6000 }] } }
}
function walk(rec, heightRate = 0.16, turns = 1) {
  for (let index = 0; index < 12; index++) {
    for (let ms = index * 500; ms <= (index + 1) * 500; ms += 100) rec.pushBarometer(1000 - heightRate * ms / 1000 / 8.3, ms)
    rec.pushFrame(frame(index, 2, turns && index === 7 ? 1.2 : turns === 2 && index === 3 ? -1.2 : 0))
  }
  return rec.snapshot()
}

test('motion-v3: less than one metre of pressure change cannot veto a complete walking pattern', () => {
  const rec = new RouteRecognizer(route(), 0), result = walk(rec)
  assert.equal(result.currentFloor, 2)
  assert.ok(result.ascentM < 1)
  assert.equal(result.canAutoComplete, false, 'the new reference has not been independently checked')
  assert.equal(rec.finish(6000).floorConfirmation, 'pending')
})
test('motion-v3: a checked reference can finish from walking, without the old metre requirement', () => {
  const rec = new RouteRecognizer(route(1, true), 0), result = walk(rec)
  assert.equal(result.currentFloor, 2)
  assert.equal(result.canAutoComplete, true)
  assert.equal(rec.finish(6000).floorConfirmation, 'automatic')
})
test('motion-v3: straight, one-turn and two-turn stairs use their own recorded turns', () => {
  for (const turns of [0, 1, 2]) assert.equal(walk(new RouteRecognizer(route(turns), 0), 0.16, turns).currentFloor, 2)
  assert.equal(walk(new RouteRecognizer(route(2), 0), 0.16, 1).currentFloor, 1)
})
test('motion-v3: pressure rising alone, even over many floors, never advances a floor', () => {
  const rec = new RouteRecognizer(route(), 0)
  for (let ms = 0; ms <= 60000; ms += 100) rec.pushBarometer(1000 - ms / 1000 * 2 / 8.3, ms)
  assert.equal(rec.snapshot().currentFloor, 1)
  assert.equal(rec.snapshot().activeMs, 0)
  assert.equal(rec.finish(60000).complete, false)
})
test('motion-v3: elevator vibration and turning a still phone do not create walking floors', () => {
  const rec = new RouteRecognizer(route(), 0)
  for (let i = 0; i < 24; i++) {
    rec.pushBarometer(1000 - i * 0.1, i * 500)
    rec.pushFrame({ ...frame(i, 0, i % 2 ? 1.4 : -1.4), energy: 0.7 })
  }
  assert.equal(rec.snapshot().currentFloor, 1)
  assert.equal(rec.snapshot().activeMs, 0)
  assert.equal(rec.finish(12000).events.filter(e => e.type === 'turn').length, 0)
})
test('motion-v3: level walking and walking down do not add floors, even with matching turns', () => {
  for (const rate of [0, -0.3]) assert.equal(walk(new RouteRecognizer(route(), 0), rate).currentFloor, 1)
})
test('motion-v3: missing pressure leaves a matched floor pending', () => {
  const rec = new RouteRecognizer(route(1, true), 0)
  for (let i = 0; i < 12; i++) rec.pushFrame(frame(i, 2, i === 7 ? 1.2 : 0))
  assert.equal(rec.snapshot().currentFloor, 2)
  assert.equal(rec.snapshot().canAutoComplete, false)
})
test('motion-v3: a pressure jump is ignored, stale data loses its direction, descent is not hidden by an old peak', () => {
  const trend = new PressureTrend()
  for (let ms = 0; ms <= 5000; ms += 100) trend.push(1000 - ms * 0.00003, ms)
  assert.equal(trend.snapshot(5000).direction, 'up')
  trend.push(998, 5100)
  assert.equal(trend.snapshot(5100).reliable, false)
  assert.ok(trend.snapshot(5100).relativeHeightM < 2)
  for (let ms = 5200; ms <= 11000; ms += 100) trend.push(998 + (ms - 5100) * 0.00006, ms)
  assert.equal(trend.snapshot(11000).direction, 'down')
  assert.equal(trend.snapshot(14000).reliable, false)
})
test('motion-v3: an interrupted run and a manually moved position cannot auto-finish', () => {
  const interrupted = new RouteRecognizer(route(1, true), 0)
  interrupted.pause(0); interrupted.resume(0)
  assert.equal(walk(interrupted).canAutoComplete, false)
  const marked = new RouteRecognizer(route(1, true), 0)
  marked.confirmFloor(2, 5000)
  assert.equal(marked.snapshot().currentFloor, 2)
  assert.equal(marked.snapshot().canAutoComplete, false)
})
test('motion-v3: unknown stairs never turn a fixed number of steps or turns into floors', () => {
  const rec = new FreeRecognizer({ ...route(), segments: [] }, 0)
  walk(rec, 0.8, 2)
  assert.equal(rec.snapshot().floorsCompleted, 0)
  assert.equal(rec.snapshot().canAutoComplete, false)
  rec.confirmFloor(5, 6000)
  assert.equal(rec.snapshot().currentFloor, 5)
  assert.equal(rec.finish(6000).floorConfirmation, 'pending')
})
test('motion-v3: pending rounds cannot earn floors, ascent, complete rounds or goals', () => {
  const rec = new RouteRecognizer(route(), 0); walk(rec)
  const round = { ...roundFromSession(rec.finish(6000), 1, 'manual_finish'), floorCounting: 'transitions' }
  assert.equal(getRoundAchievementCount(round), 0)
  const summary = calculateWorkoutSummary([round], 0, 6000)
  assert.equal(summary.totalFloors, 0); assert.equal(summary.totalAscentM, 0); assert.equal(summary.completeRounds, 0)
  assert.equal(summary.totalSteps, 24)
  const confirmed = { ...round, floorConfirmation: 'manual', complete: true }
  assert.equal(getRoundAchievementCount(confirmed), 1)
})
test('motion-v3: confirmed boundaries follow human marks and steps, pressure does not move them', () => {
  const frames = Array.from({ length: 24 }, (_, i) => frame(i, i < 12 ? 2 : 4))
  const draft = { frames, samples: [], manualMarks: [{ type: 'floor', floor: 3, atMs: 5000 }] }
  const expected = rebuildDraftBoundaries(draft, 4, 1)
  const changedPressure = { ...draft, samples: Array.from({ length: 120 }, (_, i) => ({ t: i * 100, pressure: 1000 - i })) }
  assert.deepEqual(rebuildDraftBoundaries(changedPressure, 4, 1), expected)
  assert.equal(expected[2], 5000)
  const segments = buildSegments({ ...draft, boundaries: expected }, 1, [3, 3, 3, 3])
  assert.equal(segments[1].boundaryConfirmed, true)
})
test('motion-v3: partial floor marks are useful anchors but cannot claim a fully checked reference', () => {
  const partial = createMotionReference('pocket', 1, 4, [{ type: 'floor', floor: 3, atMs: 5000 }])
  assert.equal(partial.allBoundariesMarked, false)
  const complete = createMotionReference('pocket', 1, 4, [2, 3, 4].map(floor => ({ type: 'floor', floor, atMs: floor * 3000 })))
  assert.equal(complete.allBoundariesMarked, true)
  assert.equal(complete.checkedRuns, 0)
})
test('motion-v3: independent human checks require matching intermediate floors, five runs, two days and the same carry', () => {
  let tpl = { ...route(), endFloor: 3 }
  const marks = [2, 3].map(floor => ({ type: 'floor', floor, estimatedFloor: floor, atMs: floor * 3000 }))
  const session = { recognitionVersion: 'motion-v3', finalFloor: 3, steps: 80, interruptions: [], manualFloorMarks: marks, endedAt: new Date(2026, 9, 7, 10).getTime() }
  assert.equal(recordMotionCheck(tpl, { ...session, manualFloorMarks: [] }, 3), tpl)
  assert.equal(recordMotionCheck(tpl, { ...session, manualFloorMarks: [{ ...marks[0], estimatedFloor: 1 }, marks[1]] }, 3), tpl)
  assert.equal(recordMotionCheck(tpl, session, 4), tpl)
  for (let i = 0; i < 5; i++) tpl = recordMotionCheck(tpl, { ...session, endedAt: session.endedAt + i * 60000 }, 3)
  assert.equal(hasCheckedMotionReference(tpl), false)
  tpl = recordMotionCheck(tpl, { ...session, endedAt: session.endedAt + 86400000 }, 3)
  assert.equal(hasCheckedMotionReference(tpl), true)
  assert.equal(recordMotionCheck(tpl, { ...session, endedAt: session.endedAt + 86400000 }, 3), tpl, 'one run cannot be counted twice')
  assert.equal(hasCheckedMotionReference({ ...tpl, carryMode: 'waist' }), false)
})
test('motion-v3: automated repeats do not check a route and cannot flatten its per-floor records', () => {
  const { updateRouteModelFromWorkouts } = core('route-model')
  const original = route(), copy = JSON.stringify(original)
  const changed = updateRouteModelFromWorkouts(original, [{ templateId: original.id, rounds: [] }])
  assert.equal(JSON.stringify(original), copy)
  assert.deepEqual(changed.segments, original.segments)
  assert.equal(changed.motionReference.checkedRuns, 0)
})

test('motion: live and calibration retain identical complete frames across irregular arrivals', () => {
  const { MotionFrameStream } = core('motion-signal')
  const { extractFrames } = core('analysis')
  const samples = []
  for (let t = 0; t < 12000; t += 17 + (t % 7)) samples.push({ t: 100000 + t,
    ax: 0, ay: 0, az: t % 600 >= 90 && t % 600 < 170 ? 1.6 : 1,
    gx: 0, gy: 0, gz: t % 2000 < 700 ? 0.7 : 0, alpha: 0, beta: 0, gamma: 0 })
  const live = [], stream = new MotionFrameStream(frame => live.push(frame))
  samples.forEach(sample => stream.push(sample))
  const calibration = extractFrames(samples)
  assert.deepEqual(live, calibration.slice(0, live.length))
  assert.ok(live.every((frame, index) => frame.startMs === index * 500 && frame.endMs === (index + 1) * 500))
  assert.ok(live.reduce((sum, frame) => sum + frame.steps, 0) >= 18, 'continuous steps must survive frame boundaries')
})

test('motion: frame boundaries do not discard rotation, even with sparse measured samples', () => {
  const { extractFrames } = core('analysis')
  for (const interval of [20, 115]) {
    const samples = []
    for (let t = 0; t <= 11950; t += interval) samples.push({ t, ax: 0, ay: 0, az: 1,
      gx: 0, gy: 0, gz: 0.5, alpha: 0, beta: 0, gamma: 0 })
    // End inside a frame so the final measured interval belongs to a nonempty partial frame.
    while (samples.at(-1).t % 500 === 0) samples.pop()
    const angle = extractFrames(samples).reduce((sum, frame) => sum + frame.headingTurnRad, 0)
    assert.ok(Math.abs(angle - samples.at(-1).t / 1000 * 0.5) < 1e-9)
  }
})

test('motion: a long missing interval cannot invent turns, steps or intermediate frames', () => {
  const { extractFrames } = core('analysis')
  const sample = t => ({ t, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 1, alpha: 0, beta: 0, gamma: 0 })
  const frames = extractFrames([0, 100, 200, 10000, 10100, 10200].map(sample))
  assert.equal(frames.length, 2)
  assert.equal(frames.reduce((sum, frame) => sum + frame.steps, 0), 0)
  assert.ok(frames.reduce((sum, frame) => sum + frame.headingTurnRad, 0) < 0.5)
})

test('motion-v3: a slow old recording does not impose its duration on a faster climb', () => {
  const template = route(0, true)
  template.segments[0].features = Array.from({ length: 100 }, () => [0, 0, 0, 1])
  template.segments[0].endMs = 50000
  const rec = new RouteRecognizer(template, 0)
  const result = walk(rec)
  assert.equal(result.currentFloor, 2)
  assert.equal(result.canAutoComplete, false, 'imperfect matching remains a provisional estimate')
  assert.equal(rec.finish(6000).events.filter(event => event.type === 'floor')[0].reasonCode, 'motion_trend_rescue_estimate')
})

test('motion-v3: level walking cannot supply the steps for a later upward reading', () => {
  const rec = new RouteRecognizer(route(0), 0)
  for (let i = 0; i < 60; i++) {
    rec.pushBarometer(1000, i * 500)
    rec.pushFrame(frame(i, 2))
  }
  for (let i = 60; i < 80; i++) {
    rec.pushBarometer(1000 - (i - 60) * 0.015, i * 500)
    rec.pushFrame(frame(i, 0))
  }
  rec.pushFrame(frame(80, 2))
  assert.equal(rec.snapshot().currentFloor, 1)
})

test('pressure: noisy sustained movement can provide direction without declaring the readings clean', () => {
  for (const direction of [1, -1]) {
    const trend = new PressureTrend()
    for (let t = 0; t <= 24000; t += 100) {
      const noise = (Math.floor(t / 100) % 2 ? 0.3 : -0.3)
      trend.push(1000 - direction * 0.3 * t / 1000 / 8.3 + noise, t)
    }
    const result = trend.snapshot(24000)
    assert.equal(result.direction, direction === 1 ? 'up' : 'down')
    assert.equal(result.reason, 'noisy_trend')
    assert.equal(trend.snapshot(28000).reliable, false)
    trend.gap()
    assert.equal(trend.snapshot(24000).reliable, false)
  }
})

test('pressure: noisy flat readings and an isolated lasting offset do not establish sustained ascent', () => {
  for (const offset of [false, true]) {
    const trend = new PressureTrend()
    for (let t = 0; t <= 24000; t += 100) {
      const noise = Math.floor(t / 100) % 2 ? 0.3 : -0.3
      const state = trend.push(1000 + noise - (offset && t >= 14000 ? 0.6 : 0), t)
      assert.notEqual(state.direction, 'up')
      assert.notEqual(state.direction, 'down')
    }
  }
})

test('motion-v3: noisy long-term direction never grants automatic completion to a checked route', () => {
  const rec = new RouteRecognizer(route(1, true), 0)
  for (let t = -12000; t <= 6000; t += 100) {
    rec.pushBarometer(1000 - t / 1000 * 0.3 / 8.3 + (Math.abs(t / 100) % 2 ? 0.3 : -0.3), t)
    if (t > 0 && t % 500 === 0) {
      const index = t / 500 - 1
      rec.pushFrame(frame(index, 2, index === 7 ? 1.2 : 0))
    }
  }
  assert.equal(rec.snapshot().currentFloor, 2)
  assert.equal(rec.snapshot().canAutoComplete, false)
})
