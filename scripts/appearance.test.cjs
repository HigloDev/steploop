const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function compile(file, requireModule = () => { throw Error('Unexpected dependency') }) {
  const context = { exports: {}, require: requireModule }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context)
  return context.exports
}
const catalog = compile('skin-catalog.ts')
function store(storage) {
  return compile('services/appearance.ts', name => {
    if (name === '@react-native-async-storage/async-storage') return { __esModule: true, default: storage }
    if (name === '../skin-catalog') return catalog
    throw Error('Unexpected dependency: ' + name)
  })
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const plain = value => JSON.parse(JSON.stringify(value))
const flush = () => new Promise(resolve => setImmediate(resolve))

test('unknown, removed or malformed appearance choices recover to the original defaults', () => {
  for (const input of [null, [], 42, 'pikachu', { skinId: 'unknown', mode: 'other' }]) {
    assert.deepEqual(plain(catalog.normalizeAppearance(input)), { skinId: 'classic', mode: 'system' })
  }
  assert.deepEqual(plain(catalog.normalizeAppearance({ skinId: 'eva-unit-01', mode: 'dark', unexpected: true })), { skinId: 'eva-unit-01', mode: 'dark' })
})

test('cold start restores an independent appearance key and reads it once', async () => {
  const keys = []
  const api = store({ getItem: async key => { keys.push(key); return '{"skinId":"woodland","mode":"dark"}' } })
  await Promise.all([api.hydrateAppearance(), api.hydrateAppearance()])
  assert.deepEqual(keys, ['steploop.appearance.v1'])
  assert.deepEqual(plain(api.getAppearanceSnapshot()), { skinId: 'woodland', mode: 'dark', hydrated: true, saving: false, error: null })
})

test('rapid skin and mode changes are written in order; the latest selection survives restart', async () => {
  const started = deferred(), firstWrite = deferred(), writes = []
  let saved = null
  const storage = {
    getItem: async () => saved,
    setItem: async (key, value) => {
      writes.push([key, JSON.parse(value)])
      if (writes.length === 1) { started.resolve(); await firstWrite.promise }
      saved = value
    },
  }
  const api = store(storage)
  await api.hydrateAppearance()
  const a = api.saveAppearance({ skinId: 'pikachu' })
  await started.promise
  const b = api.saveAppearance({ mode: 'dark' })
  const c = api.saveAppearance({ skinId: 'k-on' })
  await flush()
  assert.equal(writes.length, 1)
  assert.equal(api.getAppearanceSnapshot().skinId, 'k-on')
  assert.equal(api.getAppearanceSnapshot().mode, 'dark')
  assert.equal(api.getAppearanceSnapshot().saving, true)
  firstWrite.resolve()
  assert.deepEqual(await Promise.all([a, b, c]), [true, true, true])
  assert.deepEqual(writes.map(([, value]) => value), [
    { skinId: 'pikachu', mode: 'system' }, { skinId: 'pikachu', mode: 'dark' }, { skinId: 'k-on', mode: 'dark' },
  ])
  const restarted = store(storage)
  await restarted.hydrateAppearance()
  assert.equal(restarted.getAppearanceSnapshot().skinId, 'k-on')
  assert.equal(restarted.getAppearanceSnapshot().mode, 'dark')
})

test('write failure keeps the visible choice, reports it as unsaved and allows retry', async () => {
  let fail = true, saved
  const api = store({ getItem: async () => null, setItem: async (_, value) => { if (fail) throw Error('Disk full'); saved = value } })
  assert.equal(await api.saveAppearance({ skinId: 'night-run', mode: 'light' }), false)
  assert.equal(api.getAppearanceSnapshot().skinId, 'night-run')
  assert.equal(api.getAppearanceSnapshot().error, 'write')
  assert.equal(api.getAppearanceSnapshot().saving, false)
  fail = false
  assert.equal(await api.saveAppearance(), true)
  assert.equal(api.getAppearanceSnapshot().error, null)
  assert.deepEqual(JSON.parse(saved), { skinId: 'night-run', mode: 'light' })
})

test('a failed older write cannot replace the latest choice or its saving state', async () => {
  const gate = deferred(), started = deferred()
  let calls = 0
  const api = store({ getItem: async () => null, setItem: async () => {
    if (++calls === 1) { started.resolve(); await gate.promise; throw Error('First write failed') }
  } })
  const first = api.saveAppearance({ skinId: 'eva-unit-01' })
  await started.promise
  const second = api.saveAppearance({ skinId: 'eva-unit-02', mode: 'dark' })
  await flush(); gate.resolve()
  assert.deepEqual(await Promise.all([first, second]), [false, true])
  assert.equal(api.getAppearanceSnapshot().skinId, 'eva-unit-02')
  assert.equal(api.getAppearanceSnapshot().error, null)
})

test('read failures and corrupt JSON do not block startup; retry can restore the saved choice', async () => {
  for (const corrupt of [false, true]) {
    let fail = true
    const api = store({ getItem: async () => {
      if (fail) { if (corrupt) return '{broken'; throw Error('Storage unavailable') }
      return '{"skinId":"eva-unit-02","mode":"light"}'
    } })
    await api.hydrateAppearance()
    assert.equal(api.getAppearanceSnapshot().hydrated, true)
    assert.equal(api.getAppearanceSnapshot().error, 'read')
    fail = false
    await api.hydrateAppearance(true)
    assert.equal(api.getAppearanceSnapshot().skinId, 'eva-unit-02')
    assert.equal(api.getAppearanceSnapshot().error, null)
  }
})

test('subscribers observe changes and unsubscribe without leaking; reads keep a stable snapshot', async () => {
  const api = store({ getItem: async () => null, setItem: async () => {} })
  assert.equal(api.getAppearanceSnapshot(), api.getAppearanceSnapshot())
  let notifications = 0
  const unsubscribe = api.subscribeAppearance(() => { notifications++ })
  await api.hydrateAppearance()
  await api.saveAppearance({ skinId: 'woodland' })
  assert.equal(notifications, 3)
  unsubscribe()
  await api.saveAppearance({ mode: 'dark' })
  assert.equal(notifications, 3)
})
