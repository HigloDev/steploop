const test = require('node:test')
const assert = require('node:assert/strict')
const { AutoRoundRecognizer } = require('../node_modules/.cache/steploop-core/auto-round-recognizer')
const { buildBuilding, buildingFromRoute, learnBuilding, relativeAltitude } = require('../node_modules/.cache/steploop-core/building-model')
const { advanceFloor, getFloorTransitionCount, getRoundAchievementCount } = require('../node_modules/.cache/steploop-core/floors')
const { calculateAscentCalories } = require('../node_modules/.cache/steploop-core/calories')
const { validateBackupPayload } = require('../node_modules/.cache/steploop-core/backup-payload')
const { assessTrainingSensors } = require('../node_modules/.cache/steploop-core/sensor-self-test')
const { generateRound, replay, pressureAt, START, DT } = require('./synthetic-baro.cjs')

function template(start = 1, count = 14, heights = true) {
  return buildBuilding(start, Array.from({ length: count }, (_, i) => ({ floor: advanceFloor(start, i + 1), at: START + (i + 1) * 15000,
    heightM: heights ? (i + 1) * 3 : undefined, steps: 18, turns: 2, durationMs: 15000 })), START).building
}
function assertRound(engine, trace, index = 0, options = {}) {
  assert.equal(engine.rounds.length, index + 1, 'must end exactly one round on descent')
  const round = engine.rounds[index]
  assert.equal(round.floorsCompleted, trace.expectedFloors, JSON.stringify(round))
  assert.ok(Math.abs(round.endedAt - trace.descentAt) <= DT * 2,
    `end ${round.endedAt} must locate descent onset ${trace.descentAt}`)
  assert.ok(round.descentDetectedAt >= trace.descentAt + 2000, 'requires sustained descent')
  assert.ok(round.descentDetectedAt <= trace.descentAt + (options.stairs ? 10000 : 8000), 'bounded detection delay')
  assert.equal(round.finalFloor, advanceFloor(round.startFloor, trace.expectedFloors))
  return round
}

test('1 calibration 1→15, independent pressure, elevator descent and next automatic round', () => {
  const engine = new AutoRoundRecognizer(1)
  const first = generateRound({ calibration: true })
  replay(engine, first)
  assertRound(engine, first)
  assert.equal(engine.building.floors.length, 14)
  engine.building.floors.forEach((f, i) => assert.ok(Math.abs(f.cumulativeHeightM - (i + 1) * 3) < 0.12))
  const second = generateRound({ startAt: first.endedAt, speed: 0.1 })
  replay(engine, second)
  assertRound(engine, second, 1)
})
for (const speed of [0.05, 0.1, 0.2, 0.35]) test(`2 automatic speed ${speed} m/s`, () => {
  const engine = new AutoRoundRecognizer(1, template())
  const trace = generateRound({ speed })
  replay(engine, trace)
  assertRound(engine, trace)
})
test('3 forty-second rest at floor 7 retains progress and adds no active time', () => {
  const engine = new AutoRoundRecognizer(1, template())
  const trace = generateRound({ restAfter: 6 })
  const states = []
  replay(engine, trace, (s, e) => { if (e.t > trace.reachedAt[5] + 5000 && e.t < trace.reachedAt[5] + 39000) states.push(s) })
  const round = assertRound(engine, trace)
  assert.ok(states.every(s => s.floors === 6))
  assert.equal(new Set(states.map(s => s.activeMs)).size, 1)
  assert.ok(round.durationMs < trace.descentAt - trace.ascentAt - 40000)
})
test('4 partial round 1→10 ends without reaching template top', () => {
  const engine = new AutoRoundRecognizer(1, template())
  const trace = generateRound({ floors: 9 })
  replay(engine, trace); assertRound(engine, trace)
})
test('5 +0.5 hPa/10min, slow ascent, repeated rounds rebase independently', () => {
  const engine = new AutoRoundRecognizer(1, template())
  let at = START
  for (let i = 0; i < 3; i++) {
    const trace = generateRound({ startAt: at, speed: 0.05, drift: 0.5 })
    replay(engine, trace); assertRound(engine, trace, i); at = trace.endedAt
  }
})
test('6 pressure stops at floor 5 for 20s, estimated fallback then recovery', () => {
  const engine = new AutoRoundRecognizer(1, template())
  const trace = generateRound({ speed: 0.35, staleFromHeight: 12 })
  let sawStale = false, recovered = false
  replay(engine, trace, (s, e) => {
    if (e.t > trace.staleAt + 2000 && e.t < trace.staleAt + 20000) {
      sawStale ||= s.stale
      assert.equal(s.heightM, undefined); assert.equal(s.velocityMps, undefined)
    }
    if (sawStale && !s.stale) recovered = true
  })
  const r = assertRound(engine, trace)
  assert.ok(sawStale && recovered); assert.equal(r.estimated, true)
})
test('7 no barometer: core estimates with steps + turns; product gate forbids starting', () => {
  const engine = new AutoRoundRecognizer(1, template(1, 14, false))
  const trace = generateRound({ noBarometer: true, descent: 'none' })
  replay(engine, trace)
  // There is no observable descent without a vertical sensor. Never invent one.
  assert.equal(engine.rounds.length, 0)
  assert.equal(engine.snapshot().floors, 14)
  engine.finishEstimatedRound(trace.descentAt)
  assert.equal(engine.rounds[0].floorsCompleted, 14)
  assert.equal(engine.rounds[0].endedAt, trace.descentAt)
  assert.equal(engine.rounds[0].estimated, true)
  const good = { available: true, timestamps: [1, 1.2], validValues: true }
  assert.equal(assessTrainingSensors({ barometer: { ...good, available: false }, accelerometer: good, gyroscope: good }).canStart, false)
})
test('8 elevator up without steps counts no floors and creates no round', () => {
  const engine = new AutoRoundRecognizer(1, template())
  const trace = generateRound({ elevatorUp: true })
  replay(engine, trace, s => assert.equal(s.floors, 0))
  assert.equal(engine.rounds.length, 0, 'no ascent means no round transition at any timestamp')
})
test('9 staircase descent ends at highest attained floor', () => {
  const engine = new AutoRoundRecognizer(1, template())
  const trace = generateRound({ descent: 'stairs' })
  replay(engine, trace); assertRound(engine, trace, 0, { stairs: true })
})
test('10 missing calibration click splits double-height; extra click is fully undone', () => {
  const engine = new AutoRoundRecognizer(1)
  const trace = generateRound({ calibration: true, missedClick: 8, extraClickUndo: true })
  replay(engine, trace); assertRound(engine, trace)
  assert.equal(engine.building.floors.filter(f => f.estimated).length, 2)
  assert.equal(engine.building.floors.length, 14)
  assert.equal(engine.rounds[0].floorSplits.length, 14)
  assert.equal(engine.rounds[0].floorSplits.at(-1).floorTo, 15)
})
test('11 basement -2→10 is eleven transitions, zero never exists', () => {
  const engine = new AutoRoundRecognizer(-2)
  const trace = generateRound({ calibration: true, floors: 11 })
  replay(engine, trace); assertRound(engine, trace)
  assert.equal(engine.rounds[0].finalFloor, 10)
  assert.ok(engine.building.floors.every(f => f.floor !== 0))
  assert.equal(getFloorTransitionCount(-1, 1), 1)
})
test('extends above template top with median floor height', () => {
  const engine = new AutoRoundRecognizer(1, template())
  const trace = generateRound({ floors: 17 })
  replay(engine, trace); assertRound(engine, trace)
})
test('duplicate pressure timestamp cannot refresh stale signal', () => {
  const engine = new AutoRoundRecognizer(1, template())
  engine.pushPressure(1013.25, START)
  for (let i = 0; i < 100; i++) engine.pushPressure(1013, START)
  const state = engine.tick(START + 2001)
  assert.equal(state.stale, true); assert.equal(state.heightM, undefined)
  assert.equal(state.velocityMps, undefined)
})
test('height formula, recent-five medians, corrected anchors only, partial rounds excluded', () => {
  assert.ok(Math.abs(relativeAltitude(pressureAt(42), 1013.25) - 42) < 1e-6)
  let b = template()
  for (const height of [3.1, 3.2, 3.3, 3.4, 3.5, 3.6]) {
    b = learnBuilding(b, [{ floor: 2, heightM: height, at: 1, steps: 0, turns: 0, durationMs: 0 }], false, true, false, 2)
  }
  assert.deepEqual(b.floors[0].heightHistory, [3.2, 3.3, 3.4, 3.5, 3.6])
  assert.equal(b.floors[0].cumulativeHeightM, 3.4)
  const anchors = [{ floor: 2, heightM: 4, corrected: true }, { floor: 3, heightM: 8 }]
  const corrected = learnBuilding(b, anchors, true, true, false, 3)
  assert.equal(corrected.floors[1].cumulativeHeightM, b.floors[1].cumulativeHeightM)
  assert.deepEqual(learnBuilding(b, anchors, false, false, false, 3).floors, b.floors)
})
test('legacy conversion and backup versions preserve saved results', () => {
  const route = { id: 'old', name: 'old', startFloor: 1, endFloor: 15, totalAscentM: 42, createdAt: 1, updatedAt: 1, segments: [], markers: [] }
  assert.equal(buildingFromRoute(route).floors.length, 14)
  assert.equal(buildingFromRoute({ ...route, totalAscentM: 0 }), undefined)
  const workout = { recognitionVersion: 'motion-v3', rounds: [{ startFloor: 1, finalFloor: 15, floorsCompleted: 14 }] }
  for (const version of [1, 2, 3]) {
    const input = { version, routes: [route], sessions: [], workouts: [workout] }
    const result = validateBackupPayload(JSON.parse(JSON.stringify(input)))
    assert.ok(result.ok); assert.deepEqual(result.payload.workouts, [workout])
  }
  assert.equal(getRoundAchievementCount(workout.rounds[0]), 14)
})
test('calories depend on actual ascent, never on a slow timer', () => {
  const results = [0.05, 0.1, 0.2, 0.35].map(speed => calculateAscentCalories(42, 65))
  assert.equal(new Set(results).size, 1)
  assert.equal(calculateAscentCalories(0, 65), 0)
  assert.ok(calculateAscentCalories(84, 65) > results[0])
})
test('sensor self-check rejects frozen timestamps and invalid values', () => {
  const good = { available: true, timestamps: [1, 1.2], validValues: true }
  assert.equal(assessTrainingSensors({ barometer: good, accelerometer: good, gyroscope: good }).canStart, true)
  for (const bad of [{ ...good, timestamps: [1, 1] }, { ...good, validValues: false }]) {
    assert.equal(assessTrainingSensors({ barometer: bad, accelerometer: good, gyroscope: good }).canStart, false)
  }
})

test('automatic correction resets current floor evidence, learns only its anchor, next round independent', () => {
  const initial = template()
  const engine = new AutoRoundRecognizer(1, initial)
  const trace = generateRound()
  const correctedAt = trace.reachedAt[5]
  let corrected = false
  replay(engine, trace, (state, event) => {
    if (!corrected && event.t >= correctedAt) {
      engine.markFloor(event.t, 6)
      assert.equal(engine.snapshot().currentFloor, 6)
      corrected = true
    }
  })
  const first = assertRound(engine, { ...trace, expectedFloors: 13 })
  assert.equal(first.userCorrectionCount, 1)
  assert.equal(first.buildingAnchors.filter(a => a.corrected).length, 1)
  assert.equal(engine.building.floors[4].heightHistory.length, 2)
  engine.building.floors.forEach((f, i) => {
    if (i !== 4) {
      assert.deepEqual(f.heightHistory, initial.floors[i].heightHistory)
      assert.equal(f.cumulativeHeightM, initial.floors[i].cumulativeHeightM)
    }
  }) // Adjacent h_k changes by definition when H_(k-1) changes; other H_k evidence stays intact.
  const saved = JSON.stringify(first)
  const next = generateRound({ startAt: trace.endedAt })
  replay(engine, next)
  assertRound(engine, next, 1)
  assert.equal(JSON.stringify(engine.rounds[0]), saved)
})

test('calibration anomaly is warned without blocking; centered click height includes future pressure', () => {
  const engine = new AutoRoundRecognizer(1)
  const trace = generateRound({ calibration: true, floors: 2, floorHeight: 7 })
  replay(engine, trace)
  assertRound(engine, trace)
  assert.ok(engine.snapshot().warnings.some(w => w.includes('这一层可能点早或点晚了')))
  assert.equal(engine.building.floors.length, 2)
  assert.ok(Math.abs(engine.building.floors[0].cumulativeHeightM - 7) < 0.1)
})

test('noisy fresh pressure and irregular event delivery do not duplicate floors or rounds', () => {
  const engine = new AutoRoundRecognizer(1, template())
  const trace = generateRound({ speed: 0.1 })
  let n = 0
  trace.events = trace.events.flatMap(e => {
    if (e.type !== 'pressure') return [e]
    const event = { ...e, pressure: e.pressure + Math.sin(n++ * 0.7) * 0.002 }
    return [event, event] // Duplicate delivery is not a new measurement.
  })
  replay(engine, trace)
  assertRound(engine, trace)
})

test('new templates survive JSON backups and corrupt template schemas are rejected', () => {
  const route = { id: 'new', building: template(), recognitionVersion: 'baro-v1' }
  const input = { version: 3, routes: [route], sessions: [], workouts: [] }
  const restored = validateBackupPayload(JSON.parse(JSON.stringify(input)))
  assert.ok(restored.ok); assert.deepEqual(restored.payload.routes[0].building, route.building)
  assert.equal(validateBackupPayload({ ...input, routes: [{ ...route, building: { ...route.building, floors: {} } }] }).ok, false)
})
