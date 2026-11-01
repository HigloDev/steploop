const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.join(__dirname, '..')
const WK = 'palou.workouts.v1'
const AGG = 'palou.historyAgg.v1'
const PRE = 'palou.backup.preImport.v1'
const SAFE = 'palou.backup.preUndo.v1'
const SAFE_PREFIX = 'palou.backup.preUndo.snapshot.'
const BUILDINGS = 'steploop.buildings.v1'
const HIDDEN = 'steploop.hiddenLegacyRoutes.v1'
const NOW = Date.parse('2026-10-23T12:00:00+08:00')
const RECENT = Date.parse('2026-10-22T09:00:00+08:00')
const OLD = Date.parse('2026-09-01T09:00:00+08:00')
const compiled = new Map()

function harness(initialValues) {
  const values = new Map(initialValues), loaded = new Map()
  let failKey, failReadKey, pausedWrite, fixedNow, trace
  class TestDate extends Date { static now() { return fixedNow ?? Date.now() } }
  const storageMock = {
    async getItem(key) {
      trace?.push({ operation: 'read', key })
      if (key === failReadKey) { failReadKey = undefined; throw Error('simulated read failure') }
      return values.get(key) ?? null
    },
    async setItem(key, value) {
      trace?.push({ operation: 'write', key, value })
      if (key === pausedWrite?.key) {
        const wait = pausedWrite; pausedWrite = undefined
        wait.reached(); await wait.released
      }
      if (key === failKey) { failKey = undefined; throw Error('simulated disk failure') }
      values.set(key, value)
    },
    async removeItem(key) {
      if (key === failKey) { failKey = undefined; throw Error('simulated disk failure') }
      values.delete(key)
    },
  }
  function load(relative) {
    const absolute = path.resolve(root, relative)
    if (loaded.has(absolute)) return loaded.get(absolute).exports
    if (absolute.endsWith('.json')) return JSON.parse(fs.readFileSync(absolute, 'utf8'))
    const module = { exports: {} }
    loaded.set(absolute, module)
    let source = compiled.get(absolute)
    if (!source) {
      source = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
      }).outputText
      compiled.set(absolute, source)
    }
    const resolve = name => {
      if (name === '@react-native-async-storage/async-storage') return storageMock
      if (name === 'react-native') return { NativeModules: {}, Platform: { OS: 'ios', select: o => o.ios ?? o.default } }
      if (name.startsWith('.')) return load(path.resolve(path.dirname(absolute), /\.json$/.test(name) ? name : name + '.ts'))
      throw Error('Unexpected import: ' + name)
    }
    new Function('require', 'module', 'exports', 'Date', source)(resolve, module, module.exports, TestDate)
    return module.exports
  }
  const storage = load('src/services/storage.ts'), history = load('src/services/history-repository.ts')
  const fusion = load('src/core/fusion-workout.ts'), progress = load('src/core/training-progress.ts')
  function workout(id, at, floors = 2) {
    const round = fusion.fusionRoundToWorkoutRound({
      id: id + '-r1', roundNumber: 1, kind: 'auto', startedAt: at, topAt: at + 60000, endedAt: at + 60000,
      startFloor: 1, finalFloor: 1 + floors, floors, ascentM: floors * 3, steps: floors * 12,
      activeMs: 60000, durationMs: 60000, estimated: false, confidence: 0.95,
      floorRecords: Array.from({ length: floors }, (_, i) => ({ floorTo: i + 2, reachedAt: at + (i + 1) * 60000 / floors,
        steps: 12, turns: 2, heightM: (i + 1) * 3, source: 'baro', confidence: 0.95, estimated: false })),
      endReason: 'workout_end', interruptions: [], baroCoverage: 1, notes: [],
    })
    return fusion.buildFusionWorkout({ id, startedAt: at, endedAt: at + 60000, status: 'completed', rounds: [round] })
  }
  return { storage, repo: history.historyRepository, buildings: load('src/services/building-storage.ts'), values, workout,
    startTrace() { trace = []; return trace },
    failReadOnce(key) { failReadKey = key }, setNow(value) { fixedNow = value },
    pauseNextWrite(key) {
      let reached, release
      const reachedPromise = new Promise(resolve => { reached = resolve })
      const released = new Promise(resolve => { release = resolve })
      pausedWrite = { key, reached, released }
      return { reached: reachedPromise, release }
    },
    failOnce(key) { failKey = key }, week(items) { const p = progress.deriveTrainingProgress(items, NOW); return [p.validWorkouts, p.floors] },
    raw(keys = [WK, AGG, BUILDINGS, HIDDEN, PRE, SAFE]) { return Object.fromEntries(keys.map(k => [k, values.get(k) ?? null])) },
    limit: load('src/core/backup-payload.ts').ARCHIVED_RECORD_INDEX_LIMIT,
  }
}
const payload = workouts => ({ version: 2, exportedAt: NOW, routes: [], sessions: [], workouts })
const ids = rows => rows.map(row => row.id)
const totals = s => [s.workoutCount, s.sessionCount, s.totalFloors, s.totalAscentM, s.trimmedTotal, s.removedTotal]
async function seed(h, prefix, count, at) {
  for (let i = 0; i < count; i++) await h.repo.saveWorkout(h.workout(`${prefix}-${i}`, at + i * 90000))
}

test('old standard backup retains recent details and weekly progress before archiving', async () => {
  const remote = harness(); await seed(remote, 'old', 100, OLD)
  const backup = JSON.parse(JSON.stringify(await remote.storage.exportRawData()))
  assert.ok(backup.archiveAggregate)
  const h = harness(); await seed(h, 'recent', 100, RECENT)
  const before = h.raw([WK, AGG])
  assert.deepEqual(h.week((await h.repo.listWorkouts({ limit: 1000 })).items), [100, 200])
  const preview = await h.storage.previewImportFromBackup(backup)
  const result = await h.storage.importRawData(backup)
  const kept = (await h.repo.listWorkouts({ limit: 1000 })).items
  assert.ok(kept.every(w => w.id.startsWith('recent-')))
  assert.deepEqual(h.week(kept), [100, 200])
  assert.equal(result.workoutsTruncated, preview.trimmed.workouts)
  assert.equal((await h.repo.summarize()).totalFloors, 400)
  await h.storage.importRawData(backup)
  assert.equal((await h.repo.summarize()).totalFloors, 400, 'retry must not count archived imports twice')
  // A separate first import proves undo still restores exact pre-import bytes.
  const undo = harness(); for (const [k, v] of Object.entries(before)) if (v !== null) undo.values.set(k, v)
  await undo.storage.importRawData(backup)
  await undo.storage.restorePreImportSnapshot()
  assert.deepEqual(undo.raw([WK, AGG]), before)
})

test('150 incoming workouts are fully accounted before trim; repeat and portable restore remain idempotent', async () => {
  const h = harness(), input = payload(Array.from({ length: 150 }, (_, i) => h.workout(`w-${i}`, OLD + i * 90000)))
  const result = await h.storage.importRawData(input)
  assert.equal(result.workoutsTruncated, 50)
  const before = await h.repo.summarize()
  assert.deepEqual(totals(before), [150, 0, 300, 900, 50, 0])
  assert.deepEqual(ids((await h.repo.listWorkouts({ limit: 1000 })).items).sort(), input.workouts.slice(50).map(w => w.id).sort())
  await h.storage.importRawData(input)
  assert.deepEqual(totals(await h.repo.summarize()), totals(before))
  const portable = JSON.parse(JSON.stringify(await h.storage.exportRawData()))
  const target = harness(); await target.storage.importRawData(portable)
  assert.deepEqual(totals(await target.repo.summarize()), totals(before))
  await target.storage.importRawData(input)
  assert.deepEqual(totals(await target.repo.summarize()), totals(before))
})

test('session imports also retain latest rows and archive every overflow contribution', async () => {
  const h = harness()
  const sessions = Array.from({ length: 150 }, (_, i) => ({ id: `s-${i}`, templateId: 'a', templateVersion: 1,
    startedAt: OLD + i * 90000, endedAt: OLD + i * 90000 + 60000, startFloor: 1, finalFloor: 3,
    floorsCompleted: 2, ascentM: 6, steps: 24, confidence: 0.95, complete: true, events: [], floorSplits: [], interruptions: [] }))
  await h.storage.importRawData({ ...payload([]), sessions })
  assert.deepEqual(totals(await h.repo.summarize()), [0, 150, 300, 900, 50, 0])
  assert.deepEqual(ids((await h.repo.listSessions({ limit: 1000 })).items).sort(), sessions.slice(50).map(s => s.id).sort())
  await h.storage.importRawData({ ...payload([]), sessions })
  assert.deepEqual(totals(await h.repo.summarize()), [0, 150, 300, 900, 50, 0])
})

test('same-id incoming edits win and equal timestamps retain stable source order', async () => {
  const h = harness()
  await h.repo.saveWorkout(h.workout('same', RECENT, 2))
  const items = [h.workout('same', RECENT, 3), h.workout('tie-b', RECENT), h.workout('tie-a', RECENT)]
  const plan = h.storage.computeImportPlan({ mode: 'merge', incomingRoutes: [], incomingSessions: [], incomingWorkouts: items,
    previousRoutes: [], previousSessions: [], previousWorkouts: [h.workout('same', RECENT)], carriedAggregate: null, hasLocalAggregate: true })
  assert.deepEqual(ids(plan.workouts), ['same', 'tie-b', 'tie-a'])
  await h.storage.importRawData(payload(items))
  assert.equal((await h.repo.getWorkout('same')).totalFloorsCompleted, 3)
  assert.equal((await h.repo.summarize()).totalFloors, 7)
})

test('retention dates follow occurrence time with explicit zero and missing timestamp fallbacks', () => {
  const h = harness()
  const workouts = [
    { ...h.workout('edited-old', OLD), updatedAt: NOW },
    { ...h.workout('zero-start', RECENT), startedAt: 0, endedAt: RECENT + 5000 },
    { ...h.workout('missing-start', RECENT), startedAt: undefined, endedAt: RECENT + 6000 },
    { ...h.workout('created-fallback', RECENT), startedAt: 0, endedAt: undefined, createdAt: RECENT + 7000 },
  ]
  const plan = h.storage.computeImportPlan({ mode: 'merge', incomingRoutes: [], incomingSessions: [], incomingWorkouts: workouts,
    previousRoutes: [], previousSessions: [], previousWorkouts: [], carriedAggregate: null, hasLocalAggregate: false })
  assert.deepEqual(ids(plan.workouts), ['created-fallback', 'missing-start', 'zero-start', 'edited-old'])
})

test('carried archive is adopted exactly and local legacy details are counted once', async () => {
  const source = harness(); await seed(source, 'remote', 105, OLD)
  const backup = JSON.parse(JSON.stringify(await source.storage.exportRawData()))
  const h = harness(); h.values.set(WK, JSON.stringify([h.workout('local-legacy', RECENT)]))
  await h.storage.importRawData(backup)
  assert.deepEqual(totals(await h.repo.summarize()), [106, 0, 212, 636, 6, 0])
  const replace = harness(); await seed(replace, 'local', 102, RECENT)
  await replace.storage.importRawData(backup, { mode: 'replace' })
  assert.deepEqual(totals(await replace.repo.summarize()), totals(await source.repo.summarize()))
})

test('overflow import failures roll back details and aggregate together', async () => {
  const h = harness(); await seed(h, 'local', 3, RECENT)
  const before = h.raw([WK, AGG])
  h.failOnce(AGG)
  await assert.rejects(h.storage.importRawData(payload(Array.from({ length: 150 }, (_, i) => h.workout(`incoming-${i}`, OLD + i)))), /已回滚/)
  assert.deepEqual(h.raw([WK, AGG]), before)
  assert.equal(h.values.has('palou.storageJournal.v1'), false)
})

test('failed later imports preserve the earlier successful import undo point atomically', async () => {
  for (const failureKey of [AGG, PRE]) {
    const h = harness(); await h.repo.saveWorkout(h.workout('original', OLD))
    await h.storage.importRawData(payload([h.workout('first-import', RECENT)]))
    await h.repo.saveWorkout(h.workout('new-training', RECENT + 90000))
    const before = h.raw(['palou.routes.v3', 'palou.sessions.v1', WK, AGG, PRE, SAFE])
    h.failOnce(failureKey)
    await assert.rejects(h.storage.importRawData(payload([h.workout('failed-import', RECENT)])), /已回滚/)
    assert.deepEqual(h.raw(Object.keys(before)), before)
    await h.storage.restorePreImportSnapshot()
    assert.deepEqual(ids((await h.repo.listWorkouts({ limit: 1000 })).items), ['original'])
    assert.ok((await h.storage.exportPreUndoData()).workouts.some(w => w.id === 'new-training'))
  }
})

test('failed replace after legacy route migration keeps the original route available', async () => {
  const h = harness(); h.values.set('palou.routes.v1', JSON.stringify([legacyRoute()]))
  h.failOnce(AGG)
  await assert.rejects(h.storage.importRawData(payload([]), { mode: 'replace' }), /已回滚/)
  assert.equal((await h.storage.listRoutes())[0].id, 'route-a')
  assert.equal(await h.storage.hasPreImportSnapshot(), false)
})

test('bounded archive identity index rejects unsafe imports without blocking ordinary saves', async () => {
  const h = harness(); await seed(h, 'retained', 100, RECENT)
  const doc = JSON.parse(h.values.get(AGG))
  doc.workouts.archivedRecords = Object.fromEntries(Array.from({ length: h.limit }, (_, i) => [`archived-${i}`, {
    floors: 2, ascentM: 6, activeDurationMs: 60000, atMs: OLD, kind: 'trimmed',
  }]))
  Object.assign(doc.workouts, { writtenTotal: h.limit + 100, trimmedTotal: h.limit, detailCovered: h.limit,
    floors: h.limit * 2, ascentM: h.limit * 6, activeDurationMs: h.limit * 60000 })
  h.values.set(AGG, JSON.stringify(doc))
  const before = h.raw()
  await assert.rejects(h.storage.importRawData(payload([h.workout('incoming-old', OLD)])), /去重索引已达/)
  assert.deepEqual(h.raw(), before)
  await h.repo.saveWorkout(h.workout('new-training', RECENT + 99999999))
  assert.equal(Object.keys(JSON.parse(h.values.get(AGG)).workouts.archivedRecords).length, h.limit)
  assert.equal((await h.repo.summarize()).workoutCount, h.limit + 101)
})

test('undo preserves post-import workouts in an exportable safety backup and consumes its token', async () => {
  const h = harness(); await h.repo.saveWorkout(h.workout('original', OLD))
  await h.storage.importRawData(payload([h.workout('imported', RECENT)]))
  await h.repo.saveWorkout(h.workout('after-import', RECENT + 90000))
  const displaced = await h.storage.exportRawData()
  await h.storage.restorePreImportSnapshot()
  assert.equal(await h.storage.hasPreImportSnapshot(), false)
  assert.equal(await h.storage.hasPreUndoSnapshot(), true)
  assert.deepEqual(ids((await h.repo.listWorkouts({ limit: 1000 })).items), ['original'])
  const safety = await h.storage.exportPreUndoData()
  assert.deepEqual(safety.workouts, displaced.workouts)
  assert.deepEqual(safety.archiveAggregate, JSON.parse(JSON.stringify(displaced.archiveAggregate)))
  const safetyRaw = h.values.get(SAFE)
  assert.equal(await h.storage.restorePreImportSnapshot(), null)
  assert.equal(h.values.get(SAFE), safetyRaw)
  await h.storage.importRawData(payload([h.workout('another-import', RECENT)]))
  assert.equal(h.values.get(SAFE), safetyRaw, 'new imports keep the previous safety copy')
  const restored = harness(); await restored.storage.importRawData(safety, { mode: 'replace' })
  assert.deepEqual(ids((await restored.repo.listWorkouts({ limit: 1000 })).items).sort(), ['after-import', 'imported', 'original'])
})

test('failed undo preserves both snapshots and all current data for retry', async () => {
  const h = harness(); await h.repo.saveWorkout(h.workout('original', OLD))
  await h.storage.importRawData(payload([h.workout('imported', RECENT)]))
  h.values.set(SAFE, JSON.stringify({ savedAt: OLD, keys: {} }))
  const before = h.raw()
  h.failOnce(PRE)
  await assert.rejects(h.storage.restorePreImportSnapshot(), /已回滚/)
  assert.deepEqual(h.raw(), before)
  assert.equal(await h.storage.hasPreImportSnapshot(), true)
  await h.storage.restorePreImportSnapshot()
  assert.equal(await h.storage.hasPreImportSnapshot(), false)
  assert.equal((await h.storage.listPreUndoSnapshots()).length, 2, 'legacy single snapshot must survive append')
  assert.deepEqual((await h.storage.exportPreUndoData(`undo-${OLD}-legacy-0`)).workouts, [])
})

test('multiple undo histories retain earlier new training and remain uniquely selectable within one millisecond', async () => {
  const h = harness(); h.setNow(NOW)
  await h.repo.saveWorkout(h.workout('original', OLD))
  await h.storage.importRawData(payload([h.workout('import-a', RECENT)]))
  await h.repo.saveWorkout(h.workout('after-a', RECENT + 90000))
  await h.storage.restorePreImportSnapshot()
  const first = (await h.storage.listPreUndoSnapshots())[0]
  const firstPayload = await h.storage.exportPreUndoData(first.id)
  await h.storage.importRawData(payload([h.workout('import-b', RECENT)]))
  await h.repo.saveWorkout(h.workout('after-b', RECENT + 180000))
  const beforeFailure = h.raw()
  const allBeforeFailure = [...h.values].sort()
  h.failOnce(SAFE)
  await assert.rejects(h.storage.restorePreImportSnapshot(), /已回滚/)
  assert.deepEqual(h.raw(), beforeFailure)
  assert.deepEqual([...h.values].sort(), allBeforeFailure, 'failed append leaves no orphaned snapshot key')
  await h.storage.restorePreImportSnapshot()
  const history = await h.storage.listPreUndoSnapshots()
  assert.equal(history.length, 2)
  assert.notEqual(history[0].id, history[1].id)
  assert.equal(history[0].savedAt, history[1].savedAt)
  assert.equal(history[1].id, first.id)
  assert.deepEqual(await h.storage.exportPreUndoData(first.id), firstPayload)
  assert.deepEqual(ids((await h.storage.exportPreUndoData()).workouts).sort(), ['after-b', 'import-b', 'original'])
  assert.equal(await h.storage.exportPreUndoData('missing-id'), null)
  const restarted = harness(h.values)
  await restarted.storage.importRawData(payload([restarted.workout('import-c', RECENT)]))
  restarted.setNow(NOW)
  await restarted.storage.restorePreImportSnapshot()
  assert.equal(new Set((await restarted.storage.listPreUndoSnapshots()).map(s => s.id)).size, 3)
  const restored = harness(); await restored.storage.importRawData(await restarted.storage.exportPreUndoData(first.id), { mode: 'replace' })
  assert.ok((await restored.repo.getWorkout('after-a')), 'first undo history still restores the first new training')
})

test('safety snapshots use independent keys and later undo neither reads nor rewrites historical payloads', async () => {
  const h = harness(); h.setNow(NOW)
  await h.repo.saveWorkout(h.workout('original', OLD))
  const oldKeys = []
  for (let i = 0; i < 3; i++) {
    await h.storage.importRawData(payload([h.workout(`import-${i}`, RECENT)]))
    const large = h.workout(`new-training-${i}`, RECENT + 90000)
    large.rounds[0].notes = ['retained details '.repeat(7000)]
    await h.repo.saveWorkout(large)
    const trace = h.startTrace()
    await h.storage.restorePreImportSnapshot()
    for (const key of oldKeys) {
      assert.equal(trace.some(event => event.key === key), false, 'old snapshots must not be loaded or rewritten')
    }
    const journal = trace.filter(event => event.operation === 'write' && event.key === 'palou.storageJournal.v1')
      .map(event => JSON.parse(event.value)).find(entry => entry.operation === 'restore')
    assert.ok(journal)
    assert.equal(oldKeys.some(key => Object.hasOwn(journal.before, key)), false, 'old payloads must not grow the journal')
    const history = await h.storage.listPreUndoSnapshots()
    oldKeys.push(SAFE_PREFIX + history[0].id)
    assert.ok(h.values.get(oldKeys.at(-1)).length > 100000)
    const index = JSON.parse(h.values.get(SAFE))
    assert.equal(index.version, 2)
    assert.equal(index.snapshots.length, i + 1)
    assert.ok(h.values.get(SAFE).length < 1000, 'index contains metadata only')
  }
})

test('restart during undo rolls back new snapshot keys and preserves the existing history index', async () => {
  const h = harness(); await h.repo.saveWorkout(h.workout('original', OLD))
  await h.storage.importRawData(payload([h.workout('import-a', RECENT)]))
  await h.storage.restorePreImportSnapshot()
  await h.storage.importRawData(payload([h.workout('import-b', RECENT)]))
  const before = [...h.values].sort()
  const pause = h.pauseNextWrite(SAFE)
  const undo = h.storage.restorePreImportSnapshot()
  await pause.reached
  const restarted = harness(h.values)
  assert.equal(await restarted.storage.hasPreImportSnapshot(), true)
  assert.deepEqual([...restarted.values].sort(), before)
  assert.equal((await restarted.storage.listPreUndoSnapshots()).length, 1)
  pause.release(); await undo
})

test('unreadable pre-import snapshots surface retryable errors without changing original data', async () => {
  const h = harness(); await h.storage.importRawData(payload([h.workout('imported', RECENT)]))
  const before = h.raw()
  h.failReadOnce(PRE)
  await assert.rejects(h.storage.hasPreImportSnapshot(), /读取失败/)
  assert.deepEqual(h.raw(), before)
  assert.equal(await h.storage.hasPreImportSnapshot(), true)
  h.values.set(PRE, '{corrupt')
  const corruptBefore = h.raw()
  await assert.rejects(h.storage.hasPreImportSnapshot(), /快照无法读取/)
  await assert.rejects(h.storage.restorePreImportSnapshot(), /快照无法读取/)
  assert.deepEqual(h.raw(), corruptBefore)
})

function legacyRoute() {
  return { id: 'route-a', name: 'Legacy A', startFloor: 1, endFloor: 3, totalAscentM: 6,
    segments: [{ ascentM: 3, stepCount: 12, startMs: 0, endMs: 1000 }, { ascentM: 3, stepCount: 12, startMs: 1000, endMs: 2000 }], createdAt: 1, updatedAt: 1, version: 1 }
}

test('deleting a renamed legacy building hides its source while retaining original route bytes', async () => {
  const h = harness(), original = JSON.stringify([legacyRoute()])
  h.values.set('palou.routes.v3', original)
  await h.buildings.renameBuilding('legacy_route-a', 'Renamed A')
  await h.buildings.deleteBuilding('building_route-a')
  assert.deepEqual(await h.buildings.listBuildings(), [])
  assert.equal(h.values.get('palou.routes.v3'), original)
  assert.deepEqual(JSON.parse(h.values.get(HIDDEN)), ['route-a'])
})

test('failed replacement-building deletion restores hidden-source state', async () => {
  const h = harness(); h.values.set('palou.routes.v3', JSON.stringify([legacyRoute()]))
  await h.buildings.renameBuilding('legacy_route-a', 'Renamed A')
  const before = h.raw([BUILDINGS, HIDDEN])
  h.failOnce(BUILDINGS)
  await assert.rejects(h.buildings.deleteBuilding('building_route-a'), /保存失败/)
  assert.deepEqual(h.raw([BUILDINGS, HIDDEN]), before)
  await h.buildings.deleteBuilding('building_route-a')
  assert.deepEqual(await h.buildings.listBuildings(), [])
})

test('process interruption between hiding legacy source and removing replacement retains a consistent building', async () => {
  const h = harness(), original = JSON.stringify([legacyRoute()])
  h.values.set('palou.routes.v3', original)
  await h.buildings.renameBuilding('legacy_route-a', 'Renamed A')
  const pause = h.pauseNextWrite(BUILDINGS)
  const deletion = h.buildings.deleteBuilding('building_route-a')
  await pause.reached
  const restarted = harness(h.values)
  const buildings = await restarted.buildings.listBuildings()
  assert.equal(buildings.length, 1)
  assert.equal(buildings[0].name, 'Renamed A')
  assert.equal(restarted.values.get('palou.routes.v3'), original)
  assert.deepEqual(JSON.parse(restarted.values.get(HIDDEN)), ['route-a'])
  pause.release(); await deletion
  assert.deepEqual(await h.buildings.listBuildings(), [])
  assert.equal(h.values.get('palou.routes.v3'), original)
})
