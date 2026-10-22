const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

// A tiny React host exercises the actual Settings event handlers, not a copy.
function runtime() {
  const slots = []; let cursor = 0, effects = []
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const i = cursor++
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next }]
    },
    useRef: initial => slots[cursor++] ??= { current: initial },
    useEffect(callback) { const i = cursor++; if (!slots[i]) { slots[i] = {}; effects.push(callback) } },
  }
  return { react, render(fn) { cursor = 0; const tree = fn(); const pending = effects; effects = []; pending.forEach(fn => fn()); return tree } }
}
function load(file, mocks) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', '__DEV__', output)(name => {
    if (!(name in mocks)) throw Error('Unexpected import ' + name)
    return mocks[name]
  }, module, module.exports, false)
  return module.exports
}
function find(tree, label) {
  if (!tree || typeof tree !== 'object') return undefined
  if (Array.isArray(tree)) return tree.map(item => find(item, label)).find(Boolean)
  if (tree.props?.accessibilityLabel === label || tree.props?.testID === label) return tree
  return find(tree.props?.children, label)
}
const settle = () => new Promise(resolve => setImmediate(resolve))
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function harness(options = {}) {
  const hooks = runtime(), alerts = [], exports = [], state = { snapshot: true, safety: false, snapshots: [], failRead: false, restores: 0, imports: 0, ...options }
  let focus
  const native = { StyleSheet: { create: value => value, hairlineWidth: 1 }, useColorScheme: () => 'light', Alert: { alert: (...args) => alerts.push(args) } }
  const theme = load('src/theme.ts', { 'react-native': native })
  const backups = {
    hasPreImportSnapshot: async () => {
      if (state.readTask) { const task = state.readTask; state.readTask = null; return task.promise }
      if (state.failRead) throw Error('read failed'); return state.snapshot
    },
    listPreUndoSnapshots: async () => { if (state.failList) throw Error('list failed'); return state.snapshots.slice() },
    restorePreImportSnapshot: async () => {
      state.restores++
      if (state.restoreTask) await state.restoreTask.promise
      if (state.failRestore) throw Error('storage full')
      if (!state.snapshot) return null
      state.snapshot = false; state.safety = true
      state.snapshots.unshift({ id: `undo-${state.restores}`, savedAt: Date.parse('2026-10-23T08:00:00Z') + state.restores * 1000 })
      return { workoutsCount: 7, sessionsCount: 2, routesCount: 1 }
    },
    exportUndoSafetyBackup: async opts => {
      exports.push(opts)
      if (state.exportTask) await state.exportTask.promise
      if (state.failExport) throw Error('export failed')
      return { message: 'safety exported' }
    },
    exportBackup: async () => { exports.push('current'); return { message: 'exported' } },
    pickBackupPayload: async () => ({ version: 2, routes: [], sessions: [], workouts: [] }),
    previewBackupImport: async () => ({ incoming: { routes: 0, sessions: 0, workouts: 1 }, kept: { routes: 0, sessions: 0, workouts: 1 }, warnings: [] }),
    importBackupPayload: async () => { state.imports++; if (state.importTask) await state.importTask.promise; state.snapshot = true; return { snapshotCreated: true, routesCount: 0, sessionsCount: 0, workoutsCount: 1 } },
  }
  const mocks = {
    react: hooks.react, '../../app.json': require('../app.json'), 'react-native': native,
    '@expo/vector-icons': {}, '@expo/ui': {}, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '../services/backup': backups, '../services/export-csv': { exportWorkoutCsv: async () => ({ message: 'csv' }) },
    '../services/local-download-export': { isLocalDownloadExportAvailable: () => true },
    '../services/background-training': { isBackgroundTrainingSupported: () => true },
    '../services/workout-voice-settings': { voiceModeChoice: () => 'standard', voiceModePreferences: () => ({}) },
    '../services/preferences': { getPreferences: async () => ({}), savePreferences: async patch => patch, didPreferencesWriteFail: () => false, triggerHaptic: async () => {}, triggerHapticPattern: async () => {} },
    '../theme': theme,
  }
  for (const name of ['theme-switch', 'disclosure', 'voice-mode-selector', 'voice-speaker-selector', 'native-choice', 'background-training-readiness', 'Header', 'ui', 'completion-celebration']) mocks['../components/' + name] = {}
  const Screen = load('src/pages/Settings.tsx', mocks).default
  const navigation = { addListener: (_, cb) => { focus = cb; return () => {} }, navigate() {} }
  const render = () => hooks.render(() => Screen({ navigation }))
  render()
  return { state, alerts, exports, render, focus: () => focus(), row: label => find(render(), label) }
}

test('Undo requires confirmation, runs once, locks data actions, then exposes the safety backup', async () => {
  const h = harness({ restoreTask: deferred() }); await settle()
  assert.equal(h.row('撤销上次导入').props.disabled, false)
  h.row('撤销上次导入').props.onPress()
  assert.equal(h.state.restores, 0)
  assert.match(h.alerts[0][1], /新增或修改/)
  const confirm = h.alerts[0][2].find(button => button.style === 'destructive').onPress
  confirm(); confirm()
  assert.equal(h.state.restores, 1)
  for (const label of ['导入备份', '导出备份', '保存备份到下载', '导出成绩表 Excel', '撤销上次导入']) assert.equal(h.row(label).props.disabled, true, label)
  h.state.restoreTask.resolve(); await settle()
  assert.equal(h.row('撤销上次导入').props.disabled, true)
  assert.equal(h.row('导出撤销前备份').props.disabled, false)
  h.row('导出撤销前备份').props.onPress(); await settle()
  h.row('undo-backup-undo-1').props.onPress(); await settle()
  assert.deepEqual(h.exports, [{ destination: 'downloads', snapshotId: 'undo-1' }])
  h.focus(); await settle()
  assert.equal(h.row('撤销上次导入').props.disabled, true, 'consumed snapshot stays unavailable on refocus')
  assert.ok(h.row('导出撤销前备份'))
})

test('Failed Undo leaves recovery available and permits a successful retry', async () => {
  const h = harness({ failRestore: true }); await settle()
  const confirm = () => { h.row('撤销上次导入').props.onPress(); h.alerts.at(-1)[2].find(button => button.style === 'destructive').onPress() }
  confirm(); await settle()
  assert.equal(h.state.snapshot, true)
  assert.equal(h.row('撤销上次导入').props.disabled, false)
  assert.equal(h.row('导出撤销前备份'), undefined)
  assert.equal(h.alerts.at(-1)[0], '撤销失败')
  h.state.failRestore = false; confirm(); await settle()
  assert.equal(h.state.restores, 2)
  assert.ok(h.row('导出撤销前备份'))
})

test('Missing or unreadable recovery snapshots cannot trigger Undo and read failure is retryable', async () => {
  const h = harness({ snapshot: false, failRead: true }); await settle()
  assert.equal(h.row('撤销上次导入').props.disabled, true)
  assert.ok(h.row('重新读取恢复副本'))
  h.state.failRead = false; h.state.snapshot = true
  h.row('重新读取恢复副本').props.onPress(); await settle()
  assert.equal(h.row('撤销上次导入').props.disabled, false)
  h.state.snapshot = false
  h.row('撤销上次导入').props.onPress()
  h.alerts.at(-1)[2].find(button => button.style === 'destructive').onPress(); await settle()
  assert.equal(h.row('撤销上次导入').props.disabled, true)
  assert.equal(h.row('导出撤销前备份'), undefined)
})

test('Successful import enables Undo without restarting and cancellation releases the operation lock', async () => {
  const h = harness({ snapshot: false }); await settle()
  const preview = async () => {
    h.row('导入备份').props.onPress()
    h.alerts.at(-1)[2].find(button => button.text === '合并导入').onPress()
    await settle()
  }
  await preview()
  assert.equal(h.row('导出备份').props.disabled, true)
  h.alerts.at(-1)[2].find(button => button.text === '取消').onPress()
  assert.equal(h.row('导出备份').props.disabled, false)
  await preview()
  h.alerts.at(-1)[2].find(button => button.text === '确认导入').onPress(); await settle()
  assert.equal(h.state.imports, 1)
  assert.equal(h.row('撤销上次导入').props.disabled, false)
})

test('All safety snapshots remain selectable across pages, and exporting is single flight and retryable', async () => {
  const snapshots = Array.from({ length: 12 }, (_, index) => ({ id: `history-${index}`, savedAt: Date.parse('2026-10-23T08:00:00Z') - index * 86400000 }))
  const h = harness({ snapshots, exportTask: deferred(), failExport: true }); await settle()
  h.row('导出撤销前备份').props.onPress()
  assert.ok(h.row('undo-backup-history-0'))
  assert.equal(h.row('undo-backup-history-5'), undefined)
  h.row('较早的撤销前备份').props.onPress()
  h.row('较早的撤销前备份').props.onPress()
  assert.ok(h.row('undo-backup-history-11'))
  assert.equal(h.row('较早的撤销前备份').props.disabled, true)
  const exportOldest = h.row('undo-backup-history-11').props.onPress
  exportOldest(); exportOldest()
  assert.equal(h.exports.length, 1)
  for (const label of ['导入备份', '导出备份', '撤销上次导入', 'undo-backup-history-10', '较新的撤销前备份']) assert.equal(h.row(label).props.disabled, true)
  h.state.exportTask.resolve(); await settle()
  assert.equal(h.row('undo-backup-history-11').props.disabled, false)
  h.state.failExport = false
  h.row('undo-backup-history-11').props.onPress(); await settle()
  assert.deepEqual(h.exports, [{ destination: 'downloads', snapshotId: 'history-11' }, { destination: 'downloads', snapshotId: 'history-11' }])
  h.row('较新的撤销前备份').props.onPress()
  assert.ok(h.row('undo-backup-history-5'))
})

test('A safety-history read error is retryable without claiming there are no backups', async () => {
  const h = harness({ failList: true, snapshots: [{ id: 'preserved', savedAt: Date.now() }] }); await settle()
  assert.equal(h.row('撤销上次导入').props.disabled, true)
  assert.ok(h.row('重新读取恢复副本'))
  h.state.failList = false
  h.row('重新读取恢复副本').props.onPress(); await settle()
  h.row('导出撤销前备份').props.onPress()
  assert.ok(h.row('undo-backup-preserved'))
})

test('A stale focus read cannot re-enable a consumed undo token or hide its new safety copy', async () => {
  const h = harness(); await settle()
  h.row('撤销上次导入').props.onPress()
  const confirm = h.alerts.at(-1)[2].find(button => button.style === 'destructive').onPress
  const stale = deferred(); h.state.readTask = stale
  h.focus()
  confirm(); await settle()
  assert.equal(h.state.restores, 1)
  assert.ok(h.row('导出撤销前备份'))
  stale.resolve(true); await settle()
  assert.equal(h.row('撤销上次导入').props.disabled, true)
  assert.ok(h.row('导出撤销前备份'))
})

test('Repeated import confirmation or its old cancel callback cannot repeat the write or release the lock', async () => {
  const h = harness({ importTask: deferred(), snapshot: false }); await settle()
  h.row('导入备份').props.onPress()
  h.alerts.at(-1)[2].find(button => button.text === '合并导入').onPress(); await settle()
  const buttons = h.alerts.at(-1)[2]
  buttons.find(button => button.text === '确认导入').onPress()
  buttons.find(button => button.text === '确认导入').onPress()
  buttons.find(button => button.text === '取消').onPress()
  assert.equal(h.state.imports, 1)
  assert.equal(h.row('导出备份').props.disabled, true)
  h.state.importTask.resolve(); await settle()
  assert.equal(h.row('撤销上次导入').props.disabled, false)
})

test('The actual backup and storage modules export each selected safety snapshot with all portable collections', async () => {
  const values = new Map(), files = new Map(), downloads = [], loaded = new Map()
  const snapshots = ['newest', 'older'].map((id, index) => ({
    id, savedAt: Date.parse('2026-10-23T08:00:00Z') - index * 86400000,
    keys: {
      'palou.routes.v3': JSON.stringify([{ id: `route-${id}`, name: id, extra: 'route preserved' }]),
      'palou.sessions.v1': JSON.stringify([{ id: `session-${id}`, floorCount: index + 1 }]),
      'palou.workouts.v1': JSON.stringify([{ id: `training-${id}`, totalFloors: index + 2, interruptions: [{ startAt: 1, endAt: 2 }] }]),
      'steploop.buildings.v1': JSON.stringify([{ id: `building-${id}`, floorHeight: 3.1 }]),
      'steploop.hiddenLegacyRoutes.v1': JSON.stringify([`hidden-${id}`]),
      'palou.historyAgg.v1': JSON.stringify({ version: 1, workouts: { totalFloors: index + 100 }, sessions: { totalFloors: index + 200 } }),
      'palou.storageMeta.v1': JSON.stringify({ trimmed: index + 3 }),
    },
  }))
  values.set('palou.backup.preUndo.v1', JSON.stringify(snapshots))
  const native = { NativeModules: {}, Platform: { OS: 'ios', select: options => options.ios ?? options.default } }
  const mocks = {
    '@react-native-async-storage/async-storage': {
      getItem: async key => values.get(key) ?? null,
      setItem: async (key, value) => { values.set(key, value) },
      removeItem: async key => { values.delete(key) },
    },
    'react-native': native,
    'expo-file-system': { Paths: { document: 'file:///documents/' }, File: class {
      constructor(directory, name) { this.uri = directory + (name ?? '') }
      write(json) { files.set(this.uri, json) }
    } },
    'expo-sharing': { isAvailableAsync: async () => false },
    'expo-document-picker': {},
    './local-download-export': { saveLocalFileToDownloads: async (uri, displayName) => {
      downloads.push({ uri, json: JSON.parse(files.get(uri)) })
      return { uri: 'content://downloads/' + displayName, directory: 'Download', displayName }
    } },
  }
  function actual(relative) {
    const absolute = path.resolve(__dirname, '..', relative)
    if (loaded.has(absolute)) return loaded.get(absolute).exports
    if (absolute.endsWith('.json')) return JSON.parse(fs.readFileSync(absolute, 'utf8'))
    const module = { exports: {} }; loaded.set(absolute, module)
    const output = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    new Function('require', 'module', 'exports', output)(name => {
      if (name in mocks) return mocks[name]
      if (name.startsWith('.')) return actual(path.resolve(path.dirname(absolute), name + (/\.json$/.test(name) ? '' : '.ts')))
      throw Error('Unexpected import ' + name)
    }, module, module.exports)
    return module.exports
  }
  const backup = actual('src/services/backup.ts')
  assert.deepEqual((await backup.listPreUndoSnapshots()).map(item => item.id), ['newest', 'older'])
  for (const snapshot of snapshots) {
    await backup.exportUndoSafetyBackup({ destination: 'downloads', snapshotId: snapshot.id })
    const payload = downloads.at(-1).json
    assert.equal(payload.version, 2)
    assert.equal(payload.exportedAt, snapshot.savedAt)
    for (const [property, key] of Object.entries({ routes: 'palou.routes.v3', sessions: 'palou.sessions.v1', workouts: 'palou.workouts.v1', buildings: 'steploop.buildings.v1', hiddenLegacyRouteIds: 'steploop.hiddenLegacyRoutes.v1', archiveAggregate: 'palou.historyAgg.v1' })) {
      assert.deepEqual(payload[property], JSON.parse(snapshot.keys[key]), property)
    }
  }
  assert.notEqual(downloads[0].uri, downloads[1].uri, 'local fallback files must not overwrite another selected snapshot')
  assert.equal(values.get('palou.backup.preUndo.v1'), JSON.stringify(snapshots), 'export must leave every stored safety copy untouched')
  await backup.exportUndoSafetyBackup({ destination: 'downloads' })
  assert.equal(downloads.at(-1).json.workouts[0].id, 'training-newest', 'omitting the id remains backwards compatible')
  await assert.rejects(backup.exportUndoSafetyBackup({ snapshotId: 'missing' }), /没有可导出/)
  assert.equal(downloads.length, 3)
})
