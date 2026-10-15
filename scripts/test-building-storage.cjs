const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.join(__dirname, '..')

function harness() {
  const values = new Map()
  const loaded = new Map()
  let failWrites = false
  const asyncStorage = {
    async getItem(key) { return values.get(key) ?? null },
    async setItem(key, value) {
      await new Promise(resolve => setImmediate(resolve))
      if (failWrites) throw Error('disk full')
      values.set(key, value)
    },
    async removeItem(key) { values.delete(key) },
  }
  function load(file) {
    const absolute = path.join(root, file)
    if (loaded.has(absolute)) return loaded.get(absolute).exports
    const module = { exports: {} }
    loaded.set(absolute, module)
    const source = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText
    const resolve = name => {
      if (name === '@react-native-async-storage/async-storage') return asyncStorage
      if (name === './storage') return { listRoutes: async () => [] }
      if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(absolute), name + '.ts')))
      throw Error('Unexpected import: ' + name)
    }
    new Function('require', 'module', 'exports', source)(resolve, module, module.exports)
    return module.exports
  }
  return { storage: load('src/services/building-storage.ts'), values, failWrites(value) { failWrites = value } }
}

function template(id) {
  return { schemaVersion: 1, id, name: id, startFloor: 1,
    floors: [{ floorFrom: 1, floorTo: 2, heightM: 3, steps: 20, turns: 2, durationMs: 10000 }],
    barometer: true, createdAt: 1000, updatedAt: 1000, version: 1 }
}

test('concurrent building saves keep both independent templates', async () => {
  const h = harness()
  await Promise.all([h.storage.saveBuilding(template('a')), h.storage.saveBuilding(template('b'))])
  assert.deepEqual((await h.storage.listBuildings()).map(item => item.id).sort(), ['a', 'b'])
})

test('concurrent rename and result updates retain both changes', async () => {
  const h = harness()
  await h.storage.saveBuilding(template('a'))
  const result = { workoutId: 'workout-a', at: 2000, rounds: 1, floors: 1, ascentM: 3 }
  await Promise.all([h.storage.renameBuilding('a', 'Renamed'), h.storage.recordBuildingResult('a', result)])
  const saved = await h.storage.getBuilding('a')
  assert.equal(saved.name, 'Renamed')
  assert.deepEqual(saved.lastResult, result)
})

test('an imported building collection is immediately visible and cannot be overwritten by stale cache', async () => {
  const h = harness()
  await h.storage.saveBuilding(template('original'))
  await h.storage.listBuildings()
  h.values.set('steploop.buildings.v1', JSON.stringify([template('restored')]))
  await h.storage.saveBuilding(template('new'))
  assert.deepEqual((await h.storage.listBuildings()).map(item => item.id).sort(), ['new', 'restored'])
})

test('malformed local building collection is preserved when a save is attempted', async () => {
  const h = harness()
  h.values.set('steploop.buildings.v1', '{"corrupt":true}')
  await assert.rejects(h.storage.saveBuilding(template('new')), /无法读取/)
  assert.equal(h.values.get('steploop.buildings.v1'), '{"corrupt":true}')
})

test('failed building save leaves existing data intact and the next queued save can retry', async () => {
  const h = harness()
  await h.storage.saveBuilding(template('a'))
  h.failWrites(true)
  await assert.rejects(h.storage.saveBuilding(template('b')), /保存失败/)
  h.failWrites(false)
  await h.storage.saveBuilding(template('c'))
  assert.deepEqual((await h.storage.listBuildings()).map(item => item.id).sort(), ['a', 'c'])
})

test('calibration drafts for different workouts survive subsequent saves and targeted cleanup', async () => {
  const h = harness()
  await Promise.all([
    h.storage.savePendingTemplate({ workoutId: 'workout-a', template: template('a'), warnings: [] }),
    h.storage.savePendingTemplate({ workoutId: 'workout-b', template: template('b'), warnings: ['review'] }),
  ])
  assert.equal((await h.storage.loadPendingTemplate('workout-a')).template.id, 'a')
  await h.storage.clearPendingTemplate('workout-a')
  assert.equal(await h.storage.loadPendingTemplate('workout-a'), null)
  assert.equal((await h.storage.loadPendingTemplate('workout-b')).template.id, 'b')
})

test('legacy single-workout draft is retained when another draft is saved', async () => {
  const h = harness()
  h.values.set('steploop.pendingTemplate.v1', JSON.stringify({ workoutId: 'legacy', template: template('legacy'), warnings: [] }))
  await h.storage.savePendingTemplate({ workoutId: 'new', template: template('new'), warnings: [] })
  assert.equal((await h.storage.loadPendingTemplate('legacy')).template.id, 'legacy')
  assert.equal((await h.storage.loadPendingTemplate('new')).template.id, 'new')
})


test('clearing a recovery point waits for earlier writes and cannot resurrect a completed workout', async () => {
  const h = harness()
  const checkpoint = { schemaVersion: 1, workoutId: 'workout', startedAt: 1000, savedAt: 2000,
    startFloor: 1, calibrated: false, rounds: [] }
  await Promise.all([h.storage.saveFusionCheckpoint(checkpoint), h.storage.saveFusionCheckpoint(null)])
  assert.equal(await h.storage.loadFusionCheckpoint(), null)
})


test('building, draft, and checkpoint writes preserve a malformed journal and all existing data', async () => {
  const h = harness()
  await h.storage.saveBuilding(template('existing'))
  h.values.set('palou.storageJournal.v1', '{incomplete')
  const before = [...h.values.entries()]
  await assert.rejects(h.storage.saveBuilding(template('blocked')), /日志/)
  await assert.rejects(h.storage.savePendingTemplate({ workoutId: 'blocked', template: template('blocked'), warnings: [] }), /保存失败/)
  await assert.rejects(h.storage.saveFusionCheckpoint(null), /恢复点保存失败/)
  assert.deepEqual([...h.values.entries()], before)
})
