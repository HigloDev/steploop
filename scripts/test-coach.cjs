// Real coach core/storage/backup code with an in-memory native persistence boundary.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const now = new Date('2026-10-27T12:00:00').getTime()
const clone = value => JSON.parse(JSON.stringify(value))

function environment(sharedStore = new Map()) {
  const store = sharedStore, cache = new Map(), mocks = new Map()
  let failKey, writeCount = 0
  const asyncStorage = {
    async getItem(key) { return store.get(key) ?? null },
    async setItem(key, value) {
      if (key === failKey) throw Error('simulated full disk')
      ++writeCount; store.set(key, value)
    },
    async removeItem(key) { store.delete(key) },
    async getAllKeys() { return [...store.keys()] },
  }
  function load(filename) {
    filename = path.resolve(filename)
    if (!path.extname(filename)) filename += fs.existsSync(filename + '.tsx') ? '.tsx' : '.ts'
    if (mocks.has(filename)) return mocks.get(filename)
    if (filename.endsWith('preparation-device.ts')) return { preparationDeviceKey: async () => 'coach-test-device', scopePreparationToDevice: r => r }
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }; cache.set(filename, module)
    if (filename.endsWith('.json')) { module.exports = JSON.parse(fs.readFileSync(filename, 'utf8')); return module.exports }
    const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.React,
    } }).outputText
    new Function('require', 'module', 'exports', js)(request => {
      if (mocks.has(request)) return mocks.get(request)
      if (request === '@react-native-async-storage/async-storage') return asyncStorage
      if (request === 'react-native') return { NativeModules: {}, Platform: { OS: 'android', select: options => options.android ?? options.default } }
      if (request.startsWith('.')) return load(path.resolve(path.dirname(filename), request))
      throw Error('Unexpected dependency: ' + request)
    }, module, module.exports)
    return module.exports
  }
  const core = load(path.join(root, 'src/core/coach.ts'))
  const service = load(path.join(root, 'src/services/coach-storage.ts'))
  return { store, load, core, service, asyncStorage, fail: key => { failKey = key },
    mock: (request, value) => mocks.set(request, value),
    writes: () => writeCount, storage: () => load(path.join(root, 'src/services/storage.ts')) }
}
function enrollment(overrides = {}) {
  return { id: 'weight-plan', courseId: 'weight', status: 'active', startedOn: '2026-10-27', weeks: 24,
    weekdays: [2, 4, 6], level: 'new', goalMode: 'lose', initialWeightKg: 80, heightCm: 175,
    targetWeightKg: 76, createdAt: now, updatedAt: now, ...overrides }
}
async function enrolled(env, value = enrollment()) { return env.service.saveEnrollment(value, now) }
function workout(env, session, minutes, id = 'workout-1', overrides = {}) {
  return { id, coach: { enrollmentId: session.enrollmentId, sessionId: session.id, courseId: 'weight',
    scheduledDate: session.date, targetMinutes: session.targetMinutes }, templateId: 'stairs',
    status: 'completed', activeDurationMs: minutes * 60000, totalFloorsCompleted: 14,
    startedAt: now - minutes * 60000, endedAt: now, ...overrides }
}
function review(env, overrides = {}) {
  return { id: 'weight-plan:2026-10-26', enrollmentId: 'weight-plan', weekStart: '2026-10-26',
    reviewedOn: '2026-10-27', effort: 'comfortable', adjustment: 'keep', habit: 'steady',
    note: 'Keep a comfortable pace', createdAt: now,
    snapshot: { completed: 999, planned: 999, minutes: 999 }, ...overrides }
}

test('fresh install has no invented weight or progress', async () => {
  const e = environment(), s = await e.service.getCoachState()
  assert.equal(e.core.latestWeight(s, '2026-10-27'), undefined)
  assert.equal(e.core.activeEnrollment(s), undefined)
  assert.equal(e.store.has(e.service.COACH_STORAGE_KEY), false)
})
test('Fusion course counts movement evidence and keeps its link after editing floors', async () => {
  const e = environment(), s = await enrolled(e), session = s.sessions[0]
  const fusion = e.load(path.join(root, 'src/core/fusion-workout.ts'))
  const round = { id: 'round', roundNumber: 1, startFloor: 1, finalFloor: 3, targetFloor: 3,
    startedAt: now - 600000, endedAt: now, durationMs: 600000, activeMs: 60000,
    floorsCompleted: 2, ascentM: 6, steps: 80, complete: true, confidence: 1,
    floorSplits: [], events: [], userCorrectionCount: 0, floorConfirmation: 'manual' }
  const w = fusion.buildFusionWorkout({ id: 'fusion', startedAt: now - 600000, endedAt: now,
    status: 'completed', rounds: [round], coach: workout(e, session, 1).coach, bodyWeightKg: 79 })
  assert.equal(w.activeDurationMs, 600000, 'existing Fusion summary is unchanged')
  let state = await e.service.syncCoachWorkouts([w])
  assert.equal(state.workouts[0].minutes, 1, 'stationary wall time cannot advance the course')
  assert.equal(e.core.sessionProgress(state, session).completed, false)
  await e.service.saveCoachEffort(w.id, 'comfortable')
  const corrected = fusion.correctRoundFloors(w, 'round', 3, undefined, now + 1)
  assert.deepEqual(corrected.coach, w.coach)
  state = await e.service.syncCoachWorkouts([corrected, corrected])
  assert.equal(state.workouts.length, 1)
  assert.equal(state.workouts[0].floors, 3)
  assert.equal(state.workouts[0].minutes, 1)
  assert.equal(state.workouts[0].effort, 'comfortable')
  const stationary = { ...w, id: 'stationary', rounds: [{ ...round, activeMs: 0 }] }
  state = await e.service.syncCoachWorkouts([stationary])
  assert.equal(state.workouts.find(v => v.id === 'stationary').minutes, 0)
  state = await e.service.syncCoachWorkouts([{ ...w, id: 'no-motion-evidence', rounds: [{ ...round, activeMs: undefined }] }])
  assert.equal(state.workouts.find(v => v.id === 'no-motion-evidence').minutes, 0, 'missing evidence never falls back to wall time')
  state = await e.service.syncCoachWorkouts([{ ...w, id: 'continuation', rounds: [{ ...round, activeMs: 180000 }] }])
  assert.equal(e.core.sessionProgress(state, session).completed, true, 'separate saved sessions complete the same course together')
})
test('all three courses create real persisted schedules and survive restart', async () => {
  for (const courseId of ['weight', 'beginner', 'cardio']) {
    const e = environment(), s = await enrolled(e, enrollment({ courseId }))
    assert.ok(s.sessions.length)
    assert.equal(s.sessions[0].date, '2026-10-27')
    const restored = await environment(e.store).service.getCoachState()
    assert.deepEqual(restored, s)
    assert.equal(s.weighIns.length, courseId === 'weight' ? 1 : 0)
  }
})
test('weight goals reject underweight targets, excessive pace, and invalid schedules', () => {
  const { core } = environment()
  for (const patch of [{ targetWeightKg: 40 }, { targetWeightKg: 50, weeks: 12 }, { targetWeightKg: 81 },
    { weeks: 4 }, { weekdays: [] }, { weekdays: [1, 1] }, { weekdays: [0] }, { weekdays: [1, 2, 3, 4, 5] }]) {
    assert.ok(core.validateEnrollment(enrollment(patch)))
  }
  assert.equal(core.validateEnrollment(enrollment()), undefined)
})
test('calendar arithmetic handles month/year boundaries and rejects impossible dates', () => {
  const { core } = environment()
  assert.equal(core.addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(core.weekStart('2026-11-01'), '2026-10-26')
  assert.equal(core.isDateKey('2026-02-30'), false)
  assert.equal(core.isDateKey('2028-02-29'), true)
  assert.ok(Number.isNaN(core.decimalNumber('80kg')))
  assert.equal(core.decimalNumber('79,8'), 79.8)
})
test('new course pauses previous course while preserving its health history', async () => {
  const e = environment(); const before = await enrolled(e)
  const s = await enrolled(e, enrollment({ id: 'beginner', courseId: 'beginner' }))
  assert.equal(s.enrollments.find(v => v.id === 'weight-plan').status, 'paused')
  assert.equal(e.core.activeEnrollment(s).id, 'beginner')
  assert.deepEqual(s.weighIns, before.weighIns)
  assert.ok(s.sessions.some(v => v.enrollmentId === 'weight-plan'))
})
test('partial training is retained, retries accumulate, and repeated sync never double counts', async () => {
  const e = environment(), s = await enrolled(e), session = s.sessions[0]
  const first = workout(e, session, 1)
  let next = await e.service.syncCoachWorkouts([first, first])
  assert.equal(next.workouts.length, 1)
  assert.equal(e.core.sessionProgress(next, session).completed, false)
  await e.service.saveCoachEffort(first.id, 'hard')
  const writesBefore = e.writes()
  next = await e.service.syncCoachWorkouts([first])
  assert.equal(next.workouts[0].effort, 'hard')
  assert.equal(e.writes(), writesBefore, 'unchanged focus must not rewrite health history')
  next = await e.service.syncCoachWorkouts([workout(e, session, session.targetMinutes - 1, 'workout-2')])
  assert.equal(e.core.sessionProgress(next, session).completed, true)
})
test('cancelled and zero-duration workouts cannot complete a course session', async () => {
  const e = environment(), s = await enrolled(e), session = s.sessions[0]
  const next = await e.service.syncCoachWorkouts([
    workout(e, session, 0, 'empty', { totalFloorsCompleted: 0 }), workout(e, session, 50, 'cancelled', { status: 'cancelled' }),
  ])
  assert.equal(next.workouts.length, 0)
})
test('confirmed manual floors without motion-duration evidence remain visible without completing the course', async () => {
  const e = environment(), s = await enrolled(e), session = s.sessions[0]
  const next = await e.service.syncCoachWorkouts([workout(e, session, 0, 'manual', { totalFloorsCompleted: 2 })])
  assert.equal(next.workouts[0].floors, 2)
  assert.equal(next.workouts[0].minutes, 0)
  assert.equal(e.core.sessionProgress(next, session).completed, false)
  assert.equal((await e.service.saveCoachEffort('manual', 'comfortable')).workouts[0].effort, 'comfortable')
})
test('Fusion course entry uses remaining active minutes and preserves the course link', async () => {
  const e = environment(), s = await enrolled(e), session = s.sessions[0]
  const next = await e.service.syncCoachWorkouts([workout(e, session, 1)])
  const { remainingMinutes, coach } = e.core.buildCoachWorkoutContext(next, session, now)
  assert.equal(remainingMinutes, session.targetMinutes - 1)
  assert.equal(coach.sessionId, session.id)
  assert.throws(() => e.core.buildCoachWorkoutContext(next, s.sessions[1], now), /当天/)
})
test('past missed sessions never become catch-up debt', async () => {
  const e = environment(), s = await enrolled(e)
  const next = e.core.nextSession(s, s.enrollments[0], '2026-11-03')
  assert.equal(next.date, '2026-11-03')
})
test('skipping preserves partial effort and prevents restarting that session', async () => {
  const e = environment(), s = await enrolled(e), session = s.sessions[0]
  await e.service.syncCoachWorkouts([workout(e, session, 1)])
  const next = await e.service.skipCoachSession(session.id)
  assert.equal(next.workouts.length, 1)
  assert.throws(() => e.core.buildCoachWorkoutContext(next, next.sessions[0], now), /跳过/)
})
test('failed enrollment write leaves no phantom plan; retry uses the same identity', async () => {
  const e = environment()
  e.fail(e.service.COACH_STORAGE_KEY)
  await assert.rejects(enrolled(e), /未保存/)
  assert.equal((await e.service.getCoachState()).enrollments.length, 0)
  e.fail(undefined)
  await enrolled(e); await enrolled(e)
  assert.equal((await e.service.getCoachState()).enrollments.length, 1)
})
test('concurrent weigh-ins are serialized without losing independent dates', async () => {
  const e = environment(); await enrolled(e)
  await Promise.all([
    e.service.saveWeighIn('2026-10-25', 80.1, now),
    e.service.saveWeighIn('2026-10-26', 79.9, now),
    e.service.saveWeighIn('2026-10-27', 79.8, now),
  ])
  const s = await e.service.getCoachState()
  assert.equal(s.weighIns.length, 3)
  assert.equal(e.core.latestWeight(s, '2026-10-27').weightKg, 79.8)
})
test('weigh-in updates use one record per date and reject future/invalid input', async () => {
  const e = environment(); await enrolled(e)
  await e.service.saveWeighIn('2026-10-27', 79.84, now)
  const s = await e.service.getCoachState()
  assert.equal(s.weighIns.length, 1); assert.equal(s.weighIns[0].weightKg, 79.8)
  await assert.rejects(e.service.saveWeighIn('2026-10-28', 79, now), /日期/)
  await assert.rejects(e.service.saveWeighIn('2026-02-30', 79, now), /日期/)
  await assert.rejects(e.service.saveWeighIn('2026-10-27', NaN, now), /实际体重/)
})
test('sparse weight history is insufficient evidence, not stable weight', async () => {
  const e = environment(), s = await enrolled(e)
  assert.equal(e.core.weeklySummary(s, s.enrollments[0], '2026-10-27').weightChangeKg, undefined)
  await e.service.saveWeighIn('2026-10-20', 81, now)
  await e.service.saveWeighIn('2026-10-21', 80.8, now)
  await e.service.saveWeighIn('2026-10-26', 80.2, now)
  const next = await e.service.getCoachState()
  assert.ok(Math.abs(e.core.weeklySummary(next, next.enrollments[0], '2026-10-27').weightChangeKg + 0.8) < 0.001)
})
test('weekly review saves evidence, changes only future unstarted sessions, and is idempotent by rejection', async () => {
  const e = environment(), s = await enrolled(e)
  const first = clone(s.sessions[0]), future = clone(s.sessions[1])
  const next = await e.service.saveCoachReview(review(e, { adjustment: 'easier', effort: 'hard' }))
  assert.equal(next.sessions[0].targetMinutes, first.targetMinutes)
  assert.equal(next.sessions[1].targetMinutes, Math.round(future.targetMinutes * 0.8 * 10) / 10)
  assert.equal(next.reviews[0].snapshot.completed, 0, 'untrusted supplied snapshot is recomputed')
  await assert.rejects(e.service.saveCoachReview(review(e)), /已经复盘/)
})
test('weight stalls or missing effort cannot authorize an increase', async () => {
  const e = environment(); await enrolled(e)
  await assert.rejects(e.service.saveCoachReview(review(e, { adjustment: 'increase' })), /记录舒适/)
})
test('increase requires completed sessions with explicitly comfortable feedback', async () => {
  const e = environment(); const s = await enrolled(e, enrollment({ weekdays: [2] }))
  await e.service.syncCoachWorkouts([workout(e, s.sessions[0], s.sessions[0].targetMinutes)])
  await e.service.saveCoachEffort('workout-1', 'comfortable')
  const next = await e.service.saveCoachReview(review(e, { adjustment: 'increase' }))
  assert.equal(next.sessions[1].targetMinutes, Math.round(s.sessions[1].targetMinutes * 1.1 * 10) / 10)
})
test('unwell review pauses course instead of encouraging more training', async () => {
  const e = environment(); await enrolled(e)
  await assert.rejects(e.service.saveCoachReview(review(e, { effort: 'unwell' })), /暂停/)
  const next = await e.service.saveCoachReview(review(e, { effort: 'unwell', adjustment: 'easier' }))
  assert.equal(next.enrollments[0].status, 'paused')
  assert.equal(e.core.activeEnrollment(next), undefined)
})
test('maintenance requires at least two recent real weights at the target', async () => {
  const e = environment(); await enrolled(e)
  await e.service.saveWeighIn('2026-10-27', 75.8, now)
  await assert.rejects(e.service.setEnrollmentStatus('weight-plan', 'maintaining', now), /两次/)
  const later = new Date('2026-10-29T12:00:00').getTime()
  await e.service.saveWeighIn('2026-10-29', 76, later)
  const next = await e.service.setEnrollmentStatus('weight-plan', 'maintaining', later)
  assert.equal(next.enrollments[0].status, 'maintaining')
  assert.equal(next.enrollments[0].maintenanceSince, '2026-10-29')
})
test('replanning keeps already attempted prescriptions and the original review', async () => {
  const e = environment(); const s = await enrolled(e)
  await e.service.syncCoachWorkouts([workout(e, s.sessions[0], 1)])
  await e.service.saveCoachReview(review(e))
  const next = await enrolled(e, enrollment({ weekdays: [4, 6], targetWeightKg: 75 }))
  assert.ok(next.sessions.some(v => v.id === s.sessions[0].id))
  assert.equal(next.reviews.length, 1)
  assert.equal(next.workouts.length, 1)
})
test('deleting a weigh-in never rewrites a saved weekly snapshot', async () => {
  const e = environment(); await enrolled(e)
  const before = await e.service.saveCoachReview(review(e))
  const next = await e.service.deleteWeighIn('2026-10-27')
  assert.deepEqual(next.reviews, before.reviews)
  assert.equal(next.weighIns.length, 0)
})
test('deleting a training record removes its course contribution', async () => {
  const e = environment(), s = await enrolled(e)
  await e.service.syncCoachWorkouts([workout(e, s.sessions[0], 4)])
  await e.service.removeCoachWorkout('workout-1')
  assert.equal(e.core.sessionProgress(await e.service.getCoachState(), s.sessions[0]).completed, false)
})
test('corrupt/newer coach data is never silently replaced', async () => {
  for (const raw of ['{broken', JSON.stringify({ version: 99 }), JSON.stringify({ ...environment().core.emptyCoachState(), weighIns: [null] })]) {
    const e = environment(); e.store.set(e.service.COACH_STORAGE_KEY, raw)
    await assert.rejects(e.service.getCoachState(), /原始数据已保留/)
    await assert.rejects(enrolled(e))
    assert.equal(e.store.get(e.service.COACH_STORAGE_KEY), raw)
  }
})
test('merging coach backups preserves local active course and pauses incoming active course', async () => {
  const e = environment(), local = await enrolled(e)
  const other = environment(), incoming = await enrolled(other, enrollment({ id: 'other-plan' }))
  const merged = e.core.mergeCoachStates(local, incoming)
  assert.equal(e.core.activeEnrollment(merged).id, 'weight-plan')
  assert.equal(merged.enrollments.find(v => v.id === 'other-plan').status, 'paused')
  assert.equal(merged.weighIns.length, 1)
})
test('backup round trip and undo restore goal, weights, schedule, review, and course history together', async () => {
  const e = environment(), s = await enrolled(e)
  await e.service.syncCoachWorkouts([workout(e, s.sessions[0], 2)])
  await e.service.saveCoachReview(review(e))
  const storage = e.storage(), backup = await storage.exportRawData()
  assert.equal(backup.coach.workouts.length, 1)
  await e.service.saveWeighIn('2026-10-27', 79.2, now)
  const before = await e.service.getCoachState()
  await storage.importRawData(backup, { mode: 'replace' })
  assert.deepEqual(await e.service.getCoachState(), backup.coach)
  await storage.restorePreImportSnapshot()
  assert.deepEqual(await e.service.getCoachState(), before)
})
test('legacy backups leave coach data intact and explicitly preview that behavior', async () => {
  const e = environment(); const before = await enrolled(e), storage = e.storage()
  const old = { version: 2, exportedAt: now, routes: [], sessions: [], workouts: [] }
  const preview = await storage.previewImportFromBackup(old, { mode: 'replace' })
  assert.ok(preview.warnings.some(v => v.includes('保留本机')))
  await storage.importRawData(old, { mode: 'replace' })
  assert.deepEqual(await e.service.getCoachState(), before)
})
test('coach import and undo keep Fusion buildings in the same atomic snapshot', async () => {
  const e = environment(); await enrolled(e)
  const storage = e.storage(), buildings = e.load(path.join(root, 'src/services/building-storage.ts'))
  const template = id => ({ schemaVersion: 1, id, name: id, startFloor: 1,
    floors: [{ floorFrom: 1, floorTo: 2, heightM: 3, steps: 20, turns: 2, durationMs: 10000 }],
    barometer: false, createdAt: now, updatedAt: now, version: 1 })
  await buildings.saveBuilding(template('original'))
  const backup = await storage.exportRawData()
  await buildings.saveBuilding(template('local-added'))
  await e.service.saveWeighIn('2026-10-27', 79.3, now)
  const before = await e.service.getCoachState()
  await storage.importRawData(backup, { mode: 'replace' })
  assert.deepEqual((await buildings.listBuildings()).map(b => b.id), ['original'])
  assert.equal((await e.service.getCoachState()).weighIns[0].weightKg, 80)
  await storage.restorePreImportSnapshot()
  assert.deepEqual((await buildings.listBuildings()).map(b => b.id).sort(), ['local-added', 'original'])
  assert.deepEqual(await e.service.getCoachState(), before)
})
test('failed coach write during import rolls back the other collection keys', async () => {
  const e = environment(); await enrolled(e)
  const storage = e.storage(), backup = await storage.exportRawData()
  const previous = e.store.get(e.service.COACH_STORAGE_KEY)
  e.fail(e.service.COACH_STORAGE_KEY)
  await assert.rejects(storage.importRawData({ ...backup, coach: e.core.emptyCoachState() }, { mode: 'replace' }))
  e.fail(undefined)
  assert.equal(e.store.get(e.service.COACH_STORAGE_KEY), previous)
  assert.equal((await storage.exportRawData()).workouts.length, 0)
})
test('damaged coach backup is rejected before any local import write', async () => {
  const e = environment(); await enrolled(e)
  const storage = e.storage(), backup = await storage.exportRawData(), before = e.writes()
  await assert.rejects(storage.importRawData({ ...backup, coach: { version: 99 } }), /教练数据损坏/)
  assert.equal(e.writes(), before)
})
test('goal and review drafts survive restart without enrolling or changing progress', async () => {
  const e = environment(); await e.service.saveCoachDraft('goal:weight:new', { weight: '80.0', target: '76' })
  const restarted = environment(e.store)
  assert.deepEqual(await restarted.service.getCoachDraft('goal:weight:new'), { weight: '80.0', target: '76' })
  assert.equal((await restarted.service.getCoachState()).enrollments.length, 0)
})

// Exercise actual goal screen handlers/effects. Only native views/navigation are replaced.
async function mountGoal(env) {
  let cursor = 0, dirty = false, effects = [], tree
  const slots = [], navigations = []
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const react = {
    createElement(type, props, ...children) { return { type, props: { ...props, children } } },
    Fragment: 'Fragment',
    useState(initial) {
      const i = cursor++
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, next => {
        const value = typeof next === 'function' ? next(slots[i].value) : next
        if (!Object.is(slots[i].value, value)) { slots[i].value = value; dirty = true }
      }]
    },
    useRef(value) { const i = cursor++; if (!slots[i]) slots[i] = { current: value }; return slots[i] },
    useEffect(callback, deps) {
      const i = cursor++
      if (!slots[i] || !equal(slots[i].deps, deps)) { slots[i] = { deps }; effects.push(callback) }
    },
  }
  env.mock('react', react)
  env.mock(path.join(root, 'src/components/ui.tsx'), { Button: 'Button', Field: 'Field' })
  env.mock(path.join(root, 'src/components/native-choice.tsx'), { NativeChoice: 'NativeChoice' })
  env.mock(path.join(root, 'src/components/coach-ui.tsx'), { CoachPage: 'CoachPage', CoachSection: 'CoachSection', CoachText: 'CoachText', CoachMessage: 'CoachMessage' })
  env.mock(path.join(root, 'src/theme.ts'), { useTheme: () => ({ tapMin: 48 }) })
  // RN views have no behavior in these handler tests; real layout is checked on Android.
  env.mock('react-native', { Pressable: 'Pressable', View: 'View' })
  const Goal = env.load(path.join(root, 'src/pages/coach-goal.tsx')).default
  const navigation = { popTo: (...args) => navigations.push(args) }
  const render = () => { cursor = 0; effects = []; tree = Goal({ navigation, route: { params: { courseId: 'weight' } } }); effects.forEach(effect => effect()) }
  const flush = async () => {
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setImmediate(resolve))
      if (dirty) { dirty = false; render() }
    }
  }
  const nodes = () => {
    const all = []
    const visit = node => {
      if (Array.isArray(node)) return node.forEach(visit)
      if (!node || typeof node !== 'object') return
      all.push(node); visit(node.props?.children)
    }
    visit(tree); return all
  }
  render(); await flush()
  return { navigations, flush, nodes,
    async fill(label, value) { const node = nodes().find(n => n.type === 'Field' && n.props.label === label); assert.ok(node, label); node.props.onChangeText(value); await flush() },
    async confirm(label) { const node = nodes().find(n => n.type === 'NativeChoice' && n.props.options.some(o => o.label === label)); assert.ok(node, label); node.props.onChange('yes'); await flush() },
    async save() { const node = nodes().find(n => n.type === 'Button' && n.props.title === '保存目标，生成课程安排'); assert.ok(node); node.props.onPress(); await flush() },
  }
}
test('actual goal form blocks missing eligibility without inventing a default weight', async () => {
  const e = environment(), page = await mountGoal(e)
  assert.equal(page.nodes().find(n => n.type === 'Field' && n.props.label === '当前体重（公斤）').props.value, '')
  await page.save()
  assert.equal(page.navigations.length, 0)
  assert.equal((await e.service.getCoachState()).enrollments.length, 0)
})
test('actual goal form retains values after disk failure and successfully retries once', async () => {
  const e = environment(), page = await mountGoal(e)
  await page.fill('当前体重（公斤）', '80')
  await page.fill('身高（厘米）', '175')
  await page.fill('阶段目标体重（公斤）', '76')
  await page.confirm('我已满18岁')
  await page.confirm('目前适合自行运动')
  e.fail(e.service.COACH_STORAGE_KEY)
  await page.save()
  assert.equal(page.navigations.length, 0)
  assert.equal(page.nodes().find(n => n.type === 'Field' && n.props.label === '阶段目标体重（公斤）').props.value, '76')
  assert.ok(page.nodes().some(n => n.type === 'CoachMessage' && n.props.error.includes('未保存')))
  e.fail(undefined)
  await page.save()
  assert.equal(page.navigations.length, 1)
  const state = await e.service.getCoachState()
  assert.equal(state.enrollments.length, 1)
  assert.equal(state.weighIns[0].weightKg, 80)
  assert.ok(state.sessions.length)
})
test('actual goal form restores unfinished input on a fresh mount', async () => {
  const e = environment(), page = await mountGoal(e)
  await page.fill('当前体重（公斤）', '81.2')
  await page.fill('阶段目标体重（公斤）', '77')
  const restored = await mountGoal(environment(e.store))
  assert.equal(restored.nodes().find(n => n.type === 'Field' && n.props.label === '当前体重（公斤）').props.value, '81.2')
  assert.equal(restored.navigations.length, 0)
})
