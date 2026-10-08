// storage/diagnostics 服务层数据安全测试（node:test，零依赖）。
// 依赖 services 编译产物，并用内存 mock 替换 AsyncStorage / expo-file-system / expo-sharing。
// 运行：npm run test:data

const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')

const servicesRoot =
  process.argv[2] ||
  path.join(__dirname, '..', 'node_modules', '.cache', 'steploop-services')

const store = new Map()
const writtenFiles = new Map()
const checkpointLifecycleEvents = []
let trainingStatus = { supported: true, running: false, sessionId: '' }
let trainingStatusError = null
let trainingStopError = null
let trainingStaysRunning = false
let trainingStopReportsStopped = false
let trainingStopHook = null
const TrainingNativeMock = {
  async status() {
    checkpointLifecycleEvents.push('status')
    if (trainingStatusError) throw trainingStatusError
    return { ...trainingStatus }
  },
  async stop() {
    checkpointLifecycleEvents.push('stop')
    if (trainingStopError) throw trainingStopError
    if (trainingStopHook) await trainingStopHook()
    if (!trainingStaysRunning) trainingStatus = { ...trainingStatus, running: false }
    return { ...trainingStatus, ...(trainingStopReportsStopped ? { running: false } : {}) }
  },
}
const NativeModulesMock = { AndroidTrainingSensors: TrainingNativeMock }

const AsyncStorageMock = {
  async getItem(key) {
    return store.has(key) ? store.get(key) : null
  },
  async setItem(key, value) {
    setItemCount += 1
    if (failSetItemAt > 0 && setItemCount === failSetItemAt) {
      throw new Error('AsyncStorage mock: 模拟写入失败（存储满）')
    }
    if (failSetItemKeyArmed && key === failSetItemKey) {
      throw new Error('AsyncStorage mock: 模拟指定键写入失败')
    }
    store.set(key, String(value))
    if (key === 'palou.workouts.v1') checkpointLifecycleEvents.push('save')
  },
  async removeItem(key) {
    if (key === 'palou.activeWorkout.v1') checkpointLifecycleEvents.push('clear')
    store.delete(key)
  },
  async clear() {
    store.clear()
  },
  async getAllKeys() {
    return Array.from(store.keys())
  },
}

class FileMock {
  constructor(dirOrUri, name) {
    if (name) {
      this.uri = `file://mock/${String(dirOrUri).replace(/\/+$/, '')}/${name}`
    } else {
      this.uri = String(dirOrUri)
    }
  }
  write(content) {
    writtenFiles.set(this.uri, String(content))
  }
  async text() {
    return writtenFiles.get(this.uri) ?? ''
  }
}

const PathsMock = { document: 'file://mock-documents' }

const SharingMock = {
  async isAvailableAsync() {
    return false
  },
  async shareAsync() {},
}

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === '@react-native-async-storage/async-storage') {
    return AsyncStorageMock
  }
  if (request === 'expo-file-system') {
    return { File: FileMock, Paths: PathsMock }
  }
  if (request === 'react-native') {
    // preferences 等服务只用到 Platform；mock 掉可以避免 Node 去解析 RN 的 Flow 源码。
    return {
      NativeModules: NativeModulesMock,
      Platform: {
        OS: 'android',
        select: (options) => options.android ?? options.default,
      },
    }
  }
  if (request === 'expo-haptics') {
    return {
      async impactAsync() {},
      async notificationAsync() {},
      ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
      NotificationFeedbackType: { Success: 'success', Error: 'error' },
    }
  }
  if (request === 'expo-sharing') {
    return SharingMock
  }
  return originalLoad.apply(this, arguments)
}

function loadService(rel) {
  return require(path.join(servicesRoot, rel))
}

// --- D02 故障注入：让第 N 次 setItem 抛错（模拟 AsyncStorage 满/写入失败） ---
let failSetItemAt = 0
let failSetItemKey = null
let failSetItemKeyArmed = false
let setItemCount = 0

function armSetItemFailure(atCount) {
  failSetItemAt = atCount
  failSetItemKey = null
  setItemCount = 0
}

/** 只让指定键的写入失败；其它键不受影响。 */
function armSetItemFailureForKey(key) {
  failSetItemAt = 0
  failSetItemKey = key
  failSetItemKeyArmed = true
  setItemCount = 0
}

function disarmSetItemFailure() {
  failSetItemAt = 0
  failSetItemKey = null
  failSetItemKeyArmed = false
  setItemCount = 0
}

const ROUTES_KEY = 'palou.routes.v3'
const SESSIONS_KEY = 'palou.sessions.v1'
const WORKOUTS_KEY = 'palou.workouts.v1'
const JOURNAL_KEY = 'palou.storageJournal.v1'
const COLLECTION_STORAGE_KEYS = [ROUTES_KEY, SESSIONS_KEY, WORKOUTS_KEY]

function snapshotStore(keys = COLLECTION_STORAGE_KEYS) {
  return Object.fromEntries(
    keys.map((key) => [key, store.has(key) ? store.get(key) : null]),
  )
}

function resetState() {
  store.clear()
  writtenFiles.clear()
  checkpointLifecycleEvents.length = 0
  trainingStatus = { supported: true, running: false, sessionId: '' }
  trainingStatusError = null
  trainingStopError = null
  trainingStaysRunning = false
  trainingStopReportsStopped = false
  trainingStopHook = null
  NativeModulesMock.AndroidTrainingSensors = TrainingNativeMock
  disarmSetItemFailure()
  // 清掉上一次测试留下的启动恢复缓存（生产环境每个进程只跑一次）
  loadService(path.join('services', 'storage.js')).__resetStorageForTests()
  loadService(path.join('services', 'workout-storage.js')).__resetWorkoutStorageForTests()
}

function makeRoute(id, name, updatedAt = 1000) {
  return {
    id,
    name,
    startFloor: 1,
    endFloor: 3,
    carryMode: 'pocket',
    floorHeightM: 3,
    totalAscentM: 6,
    device: { platform: 'android', model: 'test', system: 'test' },
    segments: [
      {
        id: `${id}-s1`,
        type: 'flight',
        startMs: 0,
        endMs: 1000,
        floorFrom: 1,
        floorTo: 2,
        ascentM: 3,
        stepCount: 8,
        features: [[0.5, 0.5, 0, 0]],
      },
    ],
    markers: [],
    createdAt: updatedAt,
    updatedAt,
    version: 1,
    status: 'verified',
  }
}

function makeSession(id, templateId = 'route-a') {
  return {
    id,
    templateId,
    templateVersion: 1,
    startedAt: 1000,
    endedAt: 2000,
    startFloor: 1,
    finalFloor: 2,
    floorsCompleted: 1,
    ascentM: 3,
    steps: 8,
    confidence: 0.9,
    complete: true,
    events: [],
    floorSplits: [],
    interruptions: [],
  }
}

function makeWorkout(id, templateId = 'route-a') {
  return {
    id,
    templateId,
    templateVersion: 1,
    routeSnapshot: {
      name: 'R',
      locationName: 'R',
      startFloor: 1,
      endFloor: 3,
      floorsPerRound: 2,
      ascentPerRoundM: 6,
    },
    goal: { type: 'open' },
    returnConfirmationMode: 'manual',
    status: 'completed',
    startedAt: 1000,
    endedAt: 5000,
    rounds: [],
    currentRoundNumber: 1,
    totalRoundsCompleted: 1,
    totalFloorsCompleted: 2,
    totalAscentM: 6,
    totalSteps: 16,
    activeDurationMs: 4000,
    returnDurationMs: 0,
    recoveryDurationMs: 0,
    totalElapsedMs: 4000,
    createdAt: 1000,
    updatedAt: 5000,
  }
}

function makePayload(routes, sessions = [], workouts = []) {
  return {
    version: 2,
    exportedAt: 999,
    routes,
    sessions,
    workouts,
  }
}

function makeDirtyDiagnosticBundle() {
  const samples = []
  for (let index = 0; index < 150; index += 1) {
    samples.push({
      t: index * 20,
      ax: 0,
      ay: 0,
      az: 1,
      gx: 0,
      gy: 0,
      gz: 0,
      alpha: 0,
      beta: 0,
      gamma: 0,
      pressure: 1000,
    })
  }
  return {
    version: 1,
    id: 'diagnostic-dirty',
    createdAt: 1_700_000_000_000,
    durationMs: 3000,
    activity: 'stationary',
    carryMode: 'pocket',
    routeTemplate: {
      ...makeRoute('route-cal', '真实路线'),
      location: {
        name: '真实建筑',
        address: '真实地址',
        latitude: 31,
        longitude: 121,
        accuracy: 10,
        source: 'gps',
        confirmedAt: 0,
      },
    },
    truth: { startFloor: 1, endFloor: 1, completedFloors: 0 },
    samples,
    annotations: [],
    gaps: [],
    capture: {
      platform: 'android',
      systemVersion: 'test',
      sampleIntervalTargetMs: 20,
      barometerAvailable: true,
      deviceCohortId: 'cohort-1',
    },
  }
}

test('backup-payload: mergeById 入参优先且不丢已有项', () => {
  resetState()
  const { mergeById } = loadService(path.join('core', 'backup-payload.js'))
  const merged = mergeById(
    [{ id: 'a', name: 'local-a' }, { id: 'b', name: 'local-b' }],
    [{ id: 'a', name: 'incoming-a' }, { id: 'c', name: 'incoming-c' }],
  )
  assert.deepEqual(
    merged.map((item) => item.id),
    ['a', 'c', 'b'],
  )
  assert.equal(merged.find((item) => item.id === 'a').name, 'incoming-a')
  assert.equal(merged.find((item) => item.id === 'b').name, 'local-b')
})

test('import merge: 不丢已有路线，入参同 id 覆盖', async () => {
  resetState()
  const storage = loadService(path.join('services', 'storage.js'))
  await storage.saveRoute(makeRoute('route-a', '本机A', 2000))
  await storage.saveRoute(makeRoute('route-b', '本机B', 1500))
  await storage.saveSession(makeSession('session-local'))
  await storage.saveSession(
    makeSession('session-keep'),
  )

  const result = await storage.importRawData(
    makePayload(
      [makeRoute('route-a', '备份A', 3000), makeRoute('route-c', '备份C', 2500)],
      [makeSession('session-incoming'), makeSession('session-local', 'route-c')],
      [makeWorkout('workout-1')],
    ),
  )

  assert.equal(result.mode, 'merge')
  assert.equal(result.snapshotCreated, true)
  assert.equal(result.routesCount, 3)
  const routes = await storage.listRoutes()
  const ids = routes.map((route) => route.id).sort()
  assert.deepEqual(ids, ['route-a', 'route-b', 'route-c'])
  assert.equal(routes.find((route) => route.id === 'route-a').name, '备份A')
  assert.equal(routes.find((route) => route.id === 'route-b').name, '本机B')

  const sessions = await storage.listSessions()
  const sessionIds = sessions.map((session) => session.id).sort()
  assert.ok(sessionIds.includes('session-local'))
  assert.ok(sessionIds.includes('session-keep'))
  assert.ok(sessionIds.includes('session-incoming'))
  assert.equal(
    sessions.find((session) => session.id === 'session-local').templateId,
    'route-c',
  )

  const workouts = JSON.parse(store.get('palou.workouts.v1'))
  assert.equal(workouts.length, 1)
  assert.equal(workouts[0].id, 'workout-1')
})

test('import replace: 覆盖前写入快照，可 restorePreImportSnapshot 恢复', async () => {
  resetState()
  const storage = loadService(path.join('services', 'storage.js'))
  await storage.saveRoute(makeRoute('route-local', '本机路线', 2000))
  await storage.saveSession(makeSession('session-local'))

  assert.equal(await storage.hasPreImportSnapshot(), false)

  const result = await storage.importRawData(
    makePayload([makeRoute('route-backup', '备份路线', 100)]),
    { mode: 'replace' },
  )

  assert.equal(result.mode, 'replace')
  assert.equal(result.snapshotCreated, true)
  assert.equal(await storage.hasPreImportSnapshot(), true)

  const replaced = await storage.listRoutes()
  assert.deepEqual(
    replaced.map((route) => route.id),
    ['route-backup'],
  )
  assert.equal((await storage.listSessions()).length, 0)

  const restored = await storage.restorePreImportSnapshot()
  assert.ok(restored)
  assert.equal(restored.routesCount, 1)
  assert.equal(restored.sessionsCount, 1)
  const routes = await storage.listRoutes()
  assert.deepEqual(
    routes.map((route) => route.id),
    ['route-local'],
  )
  assert.equal(routes[0].name, '本机路线')
  assert.equal((await storage.listSessions())[0].id, 'session-local')
})

test('import 默认 mode 为 merge', async () => {
  resetState()
  const storage = loadService(path.join('services', 'storage.js'))
  await storage.saveRoute(makeRoute('route-keep', '保留', 2000))
  const result = await storage.importRawData(
    makePayload([makeRoute('route-new', '新增', 100)]),
  )
  assert.equal(result.mode, 'merge')
  const ids = (await storage.listRoutes()).map((route) => route.id).sort()
  assert.deepEqual(ids, ['route-keep', 'route-new'])
})

test('import 校验失败时抛错且不写快照', async () => {
  resetState()
  const storage = loadService(path.join('services', 'storage.js'))
  await storage.saveRoute(makeRoute('route-a', '本机', 2000))
  await assert.rejects(
    () => storage.importRawData({ version: 99, routes: [], sessions: [] }),
    /不支持的备份版本/,
  )
  assert.equal(await storage.hasPreImportSnapshot(), false)
  assert.equal((await storage.listRoutes()).length, 1)
})

test('diagnostics serialize: 调用方忘 sanitize 时输出仍脱敏', () => {
  resetState()
  const diagnostics = loadService(path.join('services', 'diagnostics.js'))
  const bundle = makeDirtyDiagnosticBundle()
  const json = diagnostics.serializeDiagnosticBundle(bundle)
  const parsed = JSON.parse(json)
  assert.equal(parsed.createdAt, 0)
  assert.equal(parsed.routeTemplate.location, undefined)
  assert.equal(parsed.routeTemplate.device.model, 'redacted')
  assert.equal(parsed.routeTemplate.name, '诊断路线')
  assert.equal(parsed.samples[0].t, bundle.samples[0].t)
})

test('diagnostics export: 落盘内容无 location 且 createdAt=0', async () => {
  resetState()
  const diagnostics = loadService(path.join('services', 'diagnostics.js'))
  const bundle = makeDirtyDiagnosticBundle()
  const result = await diagnostics.exportDiagnosticBundle(bundle)
  assert.ok(result.filePath)
  const written = writtenFiles.get(result.filePath)
  assert.ok(written, 'export 应写出诊断文件')
  const parsed = JSON.parse(written)
  assert.equal(parsed.createdAt, 0)
  assert.equal(parsed.routeTemplate.location, undefined)
  assert.equal(parsed.routeTemplate.device.model, 'redacted')
  assert.ok(!written.includes('真实建筑'))
  assert.ok(!written.includes('真实地址'))
})

test('saveSession 截断标记: 超过上限时返回 truncated 且写入 meta', async () => {
  resetState()
  const storage = loadService(path.join('services', 'storage.js'))
  const limit = storage.SESSIONS_LIMIT
  for (let i = 0; i < limit; i += 1) {
    await storage.saveSession(makeSession(`s-${i}`))
  }
  const result = await storage.saveSession(makeSession('s-overflow'))
  assert.equal(result.truncated, true)
  assert.equal(result.removed, 1)
  const stored = JSON.parse(store.get('palou.sessions.v1'))
  assert.equal(stored.length, limit)
  assert.equal(stored[0].id, 's-overflow')
  assert.ok(!stored.find((s) => s.id === 's-0'), '最旧的应被丢弃')
  const meta = JSON.parse(store.get('palou.storageMeta.v1'))
  assert.equal(meta.sessionsTrimmed, 1)
})

test('saveSession 未触顶: 返回 truncated=false', async () => {
  resetState()
  const storage = loadService(path.join('services', 'storage.js'))
  const result = await storage.saveSession(makeSession('s-1'))
  assert.equal(result.truncated, false)
  assert.equal(result.removed, 0)
})

test('getCapacityStatus: 接近上限时 nearLimit=true', async () => {
  resetState()
  const storage = loadService(path.join('services', 'storage.js'))
  const threshold = storage.CAPACITY_WARN_THRESHOLD
  for (let i = 0; i < threshold; i += 1) {
    await storage.saveSession(makeSession(`s-${i}`))
  }
  const capacity = await storage.getCapacityStatus()
  assert.equal(capacity.sessionsCount, threshold)
  assert.equal(capacity.nearLimit, true)
  assert.equal(capacity.sessionsLimit, storage.SESSIONS_LIMIT)
})

test('exportRawData: capacity 字段包含截断统计', async () => {
  resetState()
  const storage = loadService(path.join('services', 'storage.js'))
  const limit = storage.SESSIONS_LIMIT
  for (let i = 0; i < limit + 3; i += 1) {
    await storage.saveSession(makeSession(`s-${i}`))
  }
  const payload = await storage.exportRawData()
  assert.ok(payload.capacity)
  assert.equal(payload.capacity.sessionsCount, limit)
  assert.equal(payload.capacity.sessionsTrimmed, 3)
  assert.equal(payload.capacity.sessionsLimit, limit)
})

test('draft 持久化: setActiveDraft 写入 AsyncStorage 且不含 samples', async () => {
  resetState()
  const draft = loadService(path.join('services', 'draft.js'))
  const samples = Array.from({ length: 200 }, (_, i) => ({
    t: i * 20,
    ax: 0,
    ay: 0,
    az: 9.8,
    gx: 0,
    gy: 0,
    gz: 0,
    alpha: 0,
    beta: 0,
    gamma: 0,
  }))
  const calibrationDraft = {
    seed: {
      name: '测试路线',
      carryMode: 'pocket',
      location: { name: '测试', address: '', latitude: 0, longitude: 0, accuracy: 0, source: 'manual', confirmedAt: 0 },
    },
    samples,
    frames: [],
    markers: [],
    boundaries: [0, 5000],
    inferred: {
      floorBoundaries: [0, 5000],
      estimatedFloorCount: 1,
      estimatedAscentM: 3,
      estimatedStepCount: 16,
      confidence: { floors: 0.8, height: 0.7, turns: 0.9, overall: 0.8 },
      perFloor: [],
    },
    startedAt: 1000,
    endedAt: 6000,
    gaps: [],
    manualMarks: [],
    estimatedAscentM: 3,
  }
  draft.setActiveDraft(calibrationDraft)
  const raw = store.get('palou.draft.calibrate.v1')
  assert.ok(raw, 'setActiveDraft 应立即写入 AsyncStorage')
  const persisted = JSON.parse(raw)
  assert.equal(persisted.kind, 'draft')
  assert.equal(persisted.draft.seed.name, '测试路线')
  assert.deepEqual(persisted.draft.samples, [], '持久化不应包含原始传感器样本')
  assert.equal(draft.getActiveDraft().samples.length, 200, '内存中仍保留完整 samples')
})

test('draft 恢复: loadPersistedDraft 从 AsyncStorage 读回并填充内存', async () => {
  resetState()
  const draft = loadService(path.join('services', 'draft.js'))
  store.set(
    'palou.draft.calibrate.v1',
    JSON.stringify({
      kind: 'draft',
      savedAt: 123,
      draft: {
        seed: {
          name: '恢复路线',
          carryMode: 'waist',
          location: { name: 'B', address: '', latitude: 0, longitude: 0, accuracy: 0, source: 'manual', confirmedAt: 0 },
        },
        samples: [],
        frames: [],
        markers: [],
        boundaries: [0, 3000],
        inferred: {
          floorBoundaries: [0, 3000],
          estimatedFloorCount: 1,
          estimatedAscentM: 3,
          estimatedStepCount: 10,
          confidence: { floors: 0.5, height: 0.5, turns: 0.5, overall: 0.5 },
          perFloor: [],
        },
        startedAt: 0,
        endedAt: 3000,
        gaps: [],
        manualMarks: [],
      },
    }),
  )
  const restored = await draft.loadPersistedDraft()
  assert.ok(restored)
  assert.equal(restored.kind, 'draft')
  assert.equal(restored.draft.seed.name, '恢复路线')
  assert.equal(restored.draft.seed.carryMode, 'waist')
  assert.deepEqual(restored.draft.samples, [])
  const active = draft.getActiveDraft()
  assert.ok(active, 'loadPersistedDraft 应同步填充内存 activeDraft')
  assert.equal(active.seed.name, '恢复路线')
})

test('draft 清除: clearActiveDraft 移除 AsyncStorage 键', async () => {
  resetState()
  const draft = loadService(path.join('services', 'draft.js'))
  store.set(
    'palou.draft.calibrate.v1',
    JSON.stringify({ kind: 'progress', savedAt: 1, progress: { routeName: 'X', carryMode: 'pocket', currentFloor: 1, manualMarks: [], startedAt: 0, phase: 'recording' } }),
  )
  draft.clearActiveDraft()
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(store.has('palou.draft.calibrate.v1'), false)
  assert.equal(draft.getActiveDraft(), undefined)
})

test('draft 进度: saveCalibrateProgress 节流后写入', async () => {
  resetState()
  const draft = loadService(path.join('services', 'draft.js'))
  draft.saveCalibrateProgress({
    routeName: '进度路线',
    carryMode: 'pocket',
    currentFloor: 3,
    manualMarks: [{ id: 'm1', type: 'floor', atMs: 1000, floor: 2 }],
    startedAt: 500,
    phase: 'recording',
  })
  assert.equal(store.has('palou.draft.calibrate.v1'), false, '节流期内不应立即写入')
  await new Promise((r) => setTimeout(r, 1100))
  const raw = store.get('palou.draft.calibrate.v1')
  assert.ok(raw, '节流到期后应写入')
  const persisted = JSON.parse(raw)
  assert.equal(persisted.kind, 'progress')
  assert.equal(persisted.progress.routeName, '进度路线')
  assert.equal(persisted.progress.currentFloor, 3)
  assert.equal(persisted.progress.manualMarks.length, 1)
})

test('draft 恢复进度: loadPersistedDraft 读回 progress', async () => {
  resetState()
  const draft = loadService(path.join('services', 'draft.js'))
  store.set(
    'palou.draft.calibrate.v1',
    JSON.stringify({
      kind: 'progress',
      savedAt: 99,
      progress: {
        routeName: '中断的标定',
        carryMode: 'waist',
        currentFloor: 5,
        manualMarks: [
          { id: 'a', type: 'turn', atMs: 100 },
          { id: 'b', type: 'floor', atMs: 200, floor: 2 },
        ],
        startedAt: 0,
        phase: 'recording',
      },
    }),
  )
  const restored = await draft.loadPersistedDraft()
  assert.ok(restored)
  assert.equal(restored.kind, 'progress')
  assert.equal(restored.progress.routeName, '中断的标定')
  assert.equal(restored.progress.currentFloor, 5)
  assert.equal(restored.progress.manualMarks.length, 2)
})

test('saveWorkout 截断标记: 超过上限时返回 truncated', async () => {
  resetState()
  const workoutStorage = loadService(path.join('services', 'workout-storage.js'))
  for (let i = 0; i < 100; i += 1) {
    await workoutStorage.saveWorkout(makeWorkout(`w-${i}`))
  }
  const result = await workoutStorage.saveWorkout(makeWorkout('w-overflow'))
  assert.equal(result.truncated, true)
  assert.equal(result.removed, 1)
  const stored = JSON.parse(store.get('palou.workouts.v1'))
  assert.equal(stored.length, 100)
  assert.equal(stored[0].id, 'w-overflow')
  const meta = JSON.parse(store.get('palou.storageMeta.v1'))
  assert.equal(meta.workoutsTrimmed, 1)
})

// ---------------------------------------------------------------------------
// D02：多键写入的操作日志、失败回滚与启动恢复
// ---------------------------------------------------------------------------

/**
 * 构造「已有用户数据 + 一次注定失败的导入」场景。
 * setItem 调用顺序：1=导入前快照 2=journal 3=routes 4=sessions 5=workouts
 */
async function seedAndFailImport(failAt) {
  const storage = loadService(path.join('services', 'storage.js'))
  await storage.saveRoute(makeRoute('route-a', '本机A', 2000))
  await storage.saveSession(makeSession('session-local'))
  const before = snapshotStore()
  armSetItemFailure(failAt)
  let error
  try {
    await storage.importRawData(
      makePayload([makeRoute('route-backup', '备份', 5000)]),
      { mode: 'replace' },
    )
  } catch (caught) {
    error = caught
  } finally {
    disarmSetItemFailure()
  }
  return { storage, before, error }
}

test('D02 导入第 2 次写入失败：三键整体回滚，无半提交', async () => {
  resetState()
  const { before, error } = await seedAndFailImport(2)
  assert.ok(error, '导入必须抛出错误而不是静默半成功')
  assert.deepEqual(snapshotStore(), before, '三个集合键必须与导入前逐字节一致')
  assert.equal(store.has(JOURNAL_KEY), false, '失败后日志必须被清理')
})

test('D02 导入第 3 次写入失败：routes 已写也要回滚', async () => {
  resetState()
  const { before, error } = await seedAndFailImport(3)
  assert.ok(error)
  assert.deepEqual(snapshotStore(), before)
  assert.equal(store.has(JOURNAL_KEY), false)
})

test('D02 导入第 4 次写入失败：routes/sessions 已写也要回滚', async () => {
  resetState()
  const { before, error } = await seedAndFailImport(4)
  assert.ok(error)
  assert.deepEqual(snapshotStore(), before)
  assert.equal(store.has(JOURNAL_KEY), false)
})

test('D02 导入第 5 次写入失败：workouts 失败整体回滚', async () => {
  resetState()
  const { before, error } = await seedAndFailImport(5)
  assert.ok(error)
  assert.deepEqual(snapshotStore(), before)
  assert.equal(store.has(JOURNAL_KEY), false)
})

test('D02 恢复快照第 1 键失败：整体回滚且快照保留可重试', async () => {
  resetState()
  const storage = loadService(path.join('services', 'storage.js'))
  await storage.saveRoute(makeRoute('route-local', '本机路线', 2000))
  await storage.saveSession(makeSession('session-local'))
  await storage.importRawData(
    makePayload([makeRoute('route-backup', '备份路线', 100)]),
    { mode: 'replace' },
  )
  const before = snapshotStore()
  armSetItemFailure(1)
  let error
  try {
    await storage.restorePreImportSnapshot()
  } catch (caught) {
    error = caught
  } finally {
    disarmSetItemFailure()
  }
  assert.ok(error, '恢复失败必须抛出错误')
  assert.deepEqual(snapshotStore(), before, '恢复失败不得留下半提交')
  assert.equal(await storage.hasPreImportSnapshot(), true, '失败后快照必须保留以便重试')

  // 解除故障后重试必须成功，并回到导入前数据
  const restored = await storage.restorePreImportSnapshot()
  assert.ok(restored)
  assert.equal(restored.routesCount, 1)
  assert.equal((await storage.listRoutes())[0].id, 'route-local')
  assert.equal((await storage.listSessions())[0].id, 'session-local')
})

test('D02 启动恢复：未提交日志 + routes 已写 + sessions/workouts 未写 → 回滚三键', async () => {
  resetState()
  const storage = loadService(path.join('services', 'storage.js'))
  const routes = [makeRoute('route-old', '旧路线', 1000)]
  const sessions = [makeSession('session-old')]
  const workouts = [makeWorkout('workout-old')]
  store.set(ROUTES_KEY, JSON.stringify(routes))
  store.set(SESSIONS_KEY, JSON.stringify(sessions))
  store.set(WORKOUTS_KEY, JSON.stringify(workouts))

  // 模拟「导入写到一半进程被杀」：before 完整，after 只有 routes 生效，日志未提交
  store.set(ROUTES_KEY, JSON.stringify([makeRoute('route-new', '新路线', 9000)]))
  store.delete(SESSIONS_KEY)
  store.delete(WORKOUTS_KEY)
  store.set(
    JOURNAL_KEY,
    JSON.stringify({
      id: 'import-crash',
      operation: 'import',
      createdAt: 1,
      before: {
        routes: JSON.stringify(routes),
        sessions: JSON.stringify(sessions),
        workouts: JSON.stringify(workouts),
      },
      after: {
        routes: JSON.stringify([makeRoute('route-new', '新路线', 9000)]),
        sessions: JSON.stringify([]),
        workouts: JSON.stringify([]),
      },
      committed: false,
    }),
  )
  // 模拟「进程重启」：清掉本次会话已缓存过的恢复结果
  storage.__resetStorageForTests()

  const recovered = await storage.listRoutes()
  assert.equal(recovered.length, 1)
  assert.equal(recovered[0].id, 'route-old', '未完成写入必须回滚到旧数据')
  assert.deepEqual(JSON.parse(store.get(SESSIONS_KEY)), sessions)
  assert.deepEqual(JSON.parse(store.get(WORKOUTS_KEY)), workouts)
  assert.equal(store.has(JOURNAL_KEY), false, '恢复成功后日志被清理')
})

test('D02 启动恢复：before 为 null 的键必须被删除而不是写入 "null"', async () => {
  resetState()
  const storage = loadService(path.join('services', 'storage.js'))
  store.set(ROUTES_KEY, JSON.stringify([makeRoute('route-new', '新', 1)]))
  store.set(
    JOURNAL_KEY,
    JSON.stringify({
      id: 'import-crash-2',
      operation: 'import',
      createdAt: 1,
      before: { routes: null, sessions: null, workouts: null },
      after: {
        routes: JSON.stringify([makeRoute('route-new', '新', 1)]),
        sessions: JSON.stringify([]),
        workouts: JSON.stringify([]),
      },
      committed: false,
    }),
  )
  storage.__resetStorageForTests()
  assert.deepEqual(await storage.listRoutes(), [])
  assert.equal(store.has(ROUTES_KEY), false, '原本不存在的键应被删除')
  assert.equal(store.get(ROUTES_KEY), undefined)
  assert.equal(store.has(JOURNAL_KEY), false)
})

test('D02 已提交日志（committed=true）不触发回滚', async () => {
  resetState()
  const storage = loadService(path.join('services', 'storage.js'))
  const routes = [makeRoute('route-kept', '保留', 1000)]
  store.set(ROUTES_KEY, JSON.stringify(routes))
  store.set(
    JOURNAL_KEY,
    JSON.stringify({
      id: 'import-committed',
      operation: 'import',
      createdAt: 1,
      before: { routes: null, sessions: null, workouts: null },
      after: {
        routes: JSON.stringify(routes),
        sessions: JSON.stringify([]),
        workouts: JSON.stringify([]),
      },
      committed: true,
    }),
  )
  const listed = await storage.listRoutes()
  assert.equal(listed[0].id, 'route-kept', '已提交的数据不得被回滚')
  assert.equal(store.has(JOURNAL_KEY), false, '已提交日志应被清理')
})

test('D02 同一导入连续执行两次：幂等，计数不变', async () => {
  resetState()
  const storage = loadService(path.join('services', 'storage.js'))
  const payload = makePayload(
    [makeRoute('route-x', 'X', 100)],
    [makeSession('session-x')],
    [makeWorkout('workout-x')],
  )
  const first = await storage.importRawData(payload)
  const firstState = snapshotStore()
  const second = await storage.importRawData(payload)
  assert.equal(first.routesCount, second.routesCount)
  assert.equal(first.sessionsCount, second.sessionsCount)
  assert.equal(first.workoutsCount, second.workoutsCount)
  assert.deepEqual(snapshotStore(), firstState, '重复导入不得改变数据或产生重复项')
})

test('D02 并发保存不同路线：不丢更新', async () => {
  resetState()
  const storage = loadService(path.join('services', 'storage.js'))
  await Promise.all([
    storage.saveRoute(makeRoute('route-1', '一', 1000)),
    storage.saveRoute(makeRoute('route-2', '二', 2000)),
    storage.saveRoute(makeRoute('route-3', '三', 3000)),
  ])
  const ids = (await storage.listRoutes()).map((route) => route.id).sort()
  assert.deepEqual(ids, ['route-1', 'route-2', 'route-3'])
})

test('D02 saveWorkout：meta 计数写失败不影响训练记录落盘', async () => {
  resetState()
  const workoutStorage = loadService(path.join('services', 'workout-storage.js'))
  for (let i = 0; i < 100; i += 1) {
    await workoutStorage.saveWorkout(makeWorkout(`w-${i}`))
  }
  // 第 101 条触发截断 → workouts 写入后紧跟 meta 计数写入；只让 meta 键失败
  armSetItemFailureForKey('palou.storageMeta.v1')
  let error
  let result
  try {
    result = await workoutStorage.saveWorkout(makeWorkout('w-final'))
  } catch (caught) {
    error = caught
  } finally {
    disarmSetItemFailure()
  }
  assert.equal(error, undefined, 'meta 计数失败不得让训练保存失败')
  assert.equal(result.truncated, true)
  const stored = JSON.parse(store.get(WORKOUTS_KEY))
  assert.equal(stored.length, 100)
  assert.equal(stored[0].id, 'w-final', '训练记录必须已落盘')
})

// ---------------------------------------------------------------------------
// D08a：历史 repository（分页 + 增量聚合 + 迁移/回滚）
//
// 本节的测试只**追加**在既有 28 条之后，不改动、不放宽任何既有断言。
// 关键不变量：retained + trimmedTotal + removedTotal === writtenTotal
// （原始明细受容量策略约束，但长期统计必须覆盖被裁剪的部分，一条都不许无声消失）。
// ---------------------------------------------------------------------------

const HISTORY_KEYS = {
  workouts: 'palou.workouts.v1',
  sessions: 'palou.sessions.v1',
  agg: 'palou.historyAgg.v1',
  meta: 'palou.storageMeta.v1',
  journal: 'palou.storageJournal.v1',
  quarantine: 'palou.historyQuarantine.v1',
  migration: 'palou.historyMigration.v1',
  rollback: 'palou.historyRollback.v1',
}

function loadRepository() {
  return loadService(path.join('services', 'history-repository.js'))
}

function loadMigration() {
  return loadService(path.join('services', 'history-migration.js'))
}

/** 清空存储并重置三个服务的启动恢复缓存（生产环境每个进程只恢复一次）。 */
function resetHistoryState() {
  store.clear()
  writtenFiles.clear()
  disarmSetItemFailure()
  loadService(path.join('services', 'storage.js')).__resetStorageForTests()
  loadService(path.join('services', 'workout-storage.js')).__resetWorkoutStorageForTests()
  loadRepository().__resetHistoryRepositoryForTests()
}

function makeWorkoutAt(id, options = {}) {
  const workout = makeWorkout(id, options.templateId)
  const atMs = options.atMs ?? 5000
  workout.startedAt = options.startedAt ?? atMs - 1000
  workout.endedAt = atMs
  workout.createdAt = workout.startedAt
  workout.updatedAt = atMs
  workout.totalFloorsCompleted = options.floors ?? 2
  workout.totalAscentM = options.ascentM ?? 6
  workout.activeDurationMs = options.durationMs ?? 4000
  return workout
}

function makeSessionAt(id, options = {}) {
  const session = makeSession(id, options.templateId)
  const atMs = options.atMs ?? 2000
  session.startedAt = options.startedAt ?? atMs - 1000
  session.endedAt = atMs
  session.floorsCompleted = options.floors ?? 1
  session.ascentM = options.ascentM ?? 3
  if (typeof options.durationMs === 'number') session.durationMs = options.durationMs
  return session
}

/** 与实现同一套「本地时区」规则，用于时区无关的断言。 */
function localDayOf(ms) {
  const date = new Date(ms)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

async function collectAllIds(listFn, pageSize) {
  const ids = []
  let offset = 0
  let guard = 0
  for (;;) {
    const page = await listFn({ offset, limit: pageSize })
    ids.push(...page.items.map((item) => item.id))
    if (!page.hasMore) return { ids, pages: guard + 1 }
    offset += page.items.length
    guard += 1
    if (guard > 1000) throw new Error('分页未收敛（hasMore 一直为 true）')
  }
}

test('D08a-1 保存 0/100/101/1000 条：分页无重复无遗漏且 retained+trimmedTotal===写入总数', async () => {
  for (const count of [0, 100, 101, 1000]) {
    resetHistoryState()
    const repository = loadRepository()
    for (let index = 0; index < count; index += 1) {
      await repository.historyRepository.saveWorkout(
        makeWorkoutAt(`w-${index}`, { atMs: 1000 + index * 1000 }),
      )
    }
    const summary = await repository.historyRepository.summarize()
    const expectedRetained = Math.min(count, 100)
    const expectedTrimmed = Math.max(0, count - 100)
    assert.equal(summary.workoutCount, count, `写入 ${count} 条的长期统计必须等于 ${count}`)
    assert.equal(summary.retainedWorkoutCount, expectedRetained)
    assert.equal(summary.trimmedTotal, expectedTrimmed)
    assert.equal(summary.removedTotal, 0)
    assert.equal(
      summary.retainedWorkoutCount + summary.trimmedTotal + summary.removedTotal,
      summary.writtenTotal,
      `retained + trimmedTotal + removedTotal 必须等于写入总数（count=${count}）`,
    )
    assert.equal(
      summary.retainedWorkoutCount + summary.trimmedTotal,
      count,
      `retained + trimmedTotal === 写入总数（count=${count}）`,
    )
    assert.equal(summary.writtenTotal, count)
    assert.equal(summary.aggregatesIncludeTrimmed, true)
    assert.equal(summary.trimmedWithoutDetail, 0)
    assert.equal(summary.reconciledDrift, 0)

    // 分页读取：无重复、无遗漏、条数等于仍保留的明细
    const { ids } = await collectAllIds(
      (query) => repository.historyRepository.listWorkouts(query),
      25,
    )
    assert.equal(ids.length, expectedRetained)
    assert.equal(new Set(ids).size, ids.length, '分页不得出现重复条目')
    if (count > 0) {
      assert.equal(ids[0], `w-${count - 1}`, '默认按最新在前排序')
      assert.equal(ids[ids.length - 1], `w-${count - expectedRetained}`)
    }

    // 旧键仍可读，且 meta 计数镜像与聚合一致（不再静默删除）
    const storedRows = JSON.parse(store.get(HISTORY_KEYS.workouts) ?? '[]')
    assert.equal(storedRows.length, expectedRetained, '原始明细必须受容量策略约束')
    const meta = JSON.parse(store.get(HISTORY_KEYS.meta) ?? '{}')
    assert.equal(meta.workoutsTrimmed ?? 0, expectedTrimmed)
  }
})

test('D08a-1b 0 条时仓库读取返回空页而不是抛错', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  const page = await repository.listWorkouts()
  assert.deepEqual(page.items, [])
  assert.equal(page.total, 0)
  assert.equal(page.hasMore, false)
  assert.equal(await repository.getWorkout('missing'), undefined)
  const summary = await repository.summarize()
  assert.equal(summary.workoutCount, 0)
  assert.equal(summary.sessionCount, 0)
  assert.equal(summary.trimmedTotal, 0)
  assert.deepEqual(summary.byDay, {})
})

test('D08a-2 150 条记录的 summarize：计数/楼层/爬升/时长与逐条求和一致', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  let floors = 0
  let ascent = 0
  let duration = 0
  for (let index = 0; index < 150; index += 1) {
    const record = makeWorkoutAt(`w-${index}`, {
      atMs: 1_700_000_000_000 + index * 86_400_000,
      floors: (index % 5) + 1,
      ascentM: ((index % 5) + 1) * 3,
      durationMs: 60_000 + index,
    })
    floors += record.totalFloorsCompleted
    ascent += record.totalAscentM
    duration += record.activeDurationMs
    await repository.saveWorkout(record)
  }
  const summary = await repository.summarize()
  assert.equal(summary.workoutCount, 150)
  assert.equal(summary.retainedWorkoutCount, 100)
  assert.equal(summary.trimmedTotal, 50)
  assert.equal(summary.totalFloors, floors, '楼层必须覆盖被裁剪的 50 条')
  assert.equal(summary.totalAscentM, ascent, '爬升必须覆盖被裁剪的 50 条')
  assert.equal(summary.totalActiveDurationMs, duration, '净时长必须覆盖被裁剪的 50 条')

  const byDayFloors = Object.values(summary.byDay).reduce(
    (sum, bucket) => sum + bucket.floors,
    0,
  )
  const byDayCount = Object.values(summary.byDay).reduce(
    (sum, bucket) => sum + bucket.workouts,
    0,
  )
  assert.equal(byDayFloors, floors, 'byDay 楼层合计必须等于逐条求和')
  assert.equal(byDayCount, 150, 'byDay 必须覆盖全部 150 条（含被裁剪的）')
  assert.equal(Object.keys(summary.byDay).length, 150, '按天分桶必须覆盖 150 天（含被裁剪的 50 条）')
  assert.equal(summary.aggregatesIncludeTrimmed, true)
})

test('D08a-2b byDay 跨本地时区午夜边界：固定时间戳断言', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  const midnight = new Date(2024, 0, 15, 0, 0, 0, 0).getTime()
  const nextDayKey = localDayOf(midnight)
  const previousDayKey = localDayOf(midnight - 1)
  assert.notEqual(nextDayKey, previousDayKey, '本地时区下两天必须是不同分桶')

  await repository.saveWorkout(makeWorkoutAt('w-before', { atMs: midnight - 1, floors: 7 }))
  await repository.saveWorkout(makeWorkoutAt('w-at', { atMs: midnight, floors: 3 }))
  await repository.saveSession(makeSessionAt('s-at', { atMs: midnight, floors: 2 }))

  const summary = await repository.summarize()
  assert.deepEqual(summary.byDay[nextDayKey], { workouts: 2, floors: 5 })
  assert.deepEqual(summary.byDay[previousDayKey], { workouts: 1, floors: 7 })
  assert.equal(summary.totalFloors, 12, '会话的楼层也计入长期统计')
  assert.equal(summary.earliestKeptAtMs, midnight - 1)
})

test('D08a-2c 分页过滤：fromMs/toMs/templateId/order 与 hasMore', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  for (let index = 0; index < 6; index += 1) {
    await repository.saveWorkout(
      makeWorkoutAt(`w-${index}`, {
        atMs: 1000 + index * 1000,
        templateId: index % 2 === 0 ? 'route-even' : 'route-odd',
      }),
    )
  }
  const filtered = await repository.listWorkouts({ fromMs: 3000, toMs: 5000 })
  assert.deepEqual(
    filtered.items.map((item) => item.id),
    ['w-4', 'w-3', 'w-2'],
  )
  assert.equal(filtered.total, 3)
  assert.equal(filtered.hasMore, false)

  const byTemplate = await repository.listWorkouts({ templateId: 'route-odd' })
  assert.deepEqual(
    byTemplate.items.map((item) => item.id),
    ['w-5', 'w-3', 'w-1'],
  )

  const oldestFirst = await repository.listWorkouts({ order: 'oldest', limit: 2 })
  assert.deepEqual(
    oldestFirst.items.map((item) => item.id),
    ['w-0', 'w-1'],
  )
  assert.equal(oldestFirst.total, 6)
  assert.equal(oldestFirst.offset, 0)
  assert.equal(oldestFirst.limit, 2)
  assert.equal(oldestFirst.hasMore, true)

  const secondPage = await repository.listWorkouts({ order: 'oldest', offset: 2, limit: 2 })
  assert.deepEqual(
    secondPage.items.map((item) => item.id),
    ['w-2', 'w-3'],
  )
  assert.equal(secondPage.hasMore, true)
  const lastPage = await repository.listWorkouts({ order: 'oldest', offset: 5, limit: 2 })
  assert.deepEqual(
    lastPage.items.map((item) => item.id),
    ['w-5'],
  )
  assert.equal(lastPage.hasMore, false)
})

test('D08a-2d 排序沿用旧 listWorkouts 口径（updatedAt），分桶用记录自身时间', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  // updatedAt 顺序与 endedAt 顺序刻意相反（旧实现按 updatedAt 倒序）
  const day1 = new Date(2024, 0, 15, 12, 0, 0).getTime()
  const day2 = new Date(2024, 0, 16, 12, 0, 0).getTime()
  const olderButRecentlyUpdated = makeWorkoutAt('w-updated-later', {
    atMs: day1,
    floors: 1,
  })
  olderButRecentlyUpdated.updatedAt = day2 + 10_000
  const newerButNotUpdated = makeWorkoutAt('w-ended-later', { atMs: day2, floors: 2 })
  newerButNotUpdated.updatedAt = day1
  await repository.saveWorkout(olderButRecentlyUpdated)
  await repository.saveWorkout(newerButNotUpdated)

  const page = await repository.listWorkouts()
  assert.deepEqual(
    page.items.map((item) => item.id),
    ['w-updated-later', 'w-ended-later'],
    '顺序必须沿用 updatedAt 倒序（旧语义）',
  )
  const summary = await repository.summarize()
  assert.deepEqual(summary.byDay[localDayOf(day1)], { workouts: 1, floors: 1 })
  assert.deepEqual(summary.byDay[localDayOf(day2)], { workouts: 1, floors: 2 })
})

test('D08a-3 单条损坏数据：跳过并计数，其余可读，集合不清空', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  const storage = loadService(path.join('services', 'storage.js'))
  const good = makeSessionAt('s-good')
  const corruptRow = '这不是一条会话'
  store.set(HISTORY_KEYS.sessions, JSON.stringify([good, corruptRow, { templateId: 'no-id' }]))

  const page = await repository.listSessions()
  assert.deepEqual(
    page.items.map((item) => item.id),
    ['s-good'],
    '损坏条必须被跳过，其余记录仍可读',
  )
  assert.equal(page.total, 1)
  const summary = await repository.summarize()
  assert.equal(summary.skippedCorrupt, 2, '跳过条数必须被记录（skippedCorrupt）')
  assert.equal(summary.sessionCount, 1)

  // 旧键未被清空：坏条仍留在原处（读取路径不写存储）
  const rawRows = JSON.parse(store.get(HISTORY_KEYS.sessions))
  assert.equal(rawRows.length, 3)
  assert.equal(store.has(HISTORY_KEYS.agg), false, '只读路径不应写聚合键')

  // 现有页面调用的 listSessions 仍然只返回可正常归一化的记录
  const legacySessions = await storage.listSessions()
  assert.deepEqual(
    legacySessions.map((item) => item.id),
    ['s-good'],
  )

  const migration = loadMigration()
  const status = await migration.migrateHistory()
  assert.equal(status.state, 'done')
  assert.match(String(status.lastError), /2 条损坏记录|损坏记录/, '迁移必须记录跳过原因')
  assert.ok(
    JSON.parse(store.get(HISTORY_KEYS.sessions)).length === 3,
    '迁移不得删除源数据',
  )
  // 条目级损坏的原始内容仍留在原键里（未被丢弃），因此没有丢失需要隔离；
  // 一旦写入路径真的要丢弃它们，原始字节会先进隔离区（见 D08a-3b / D08a-3c）。
  const aggDoc = JSON.parse(store.get(HISTORY_KEYS.agg))
  assert.ok(
    aggDoc.corruptReasons.some((reason) => String(reason).includes('sessions')),
    '损坏原因必须写进聚合文档以便导出诊断',
  )
})

test('D08a-3b 整个键不可解析：先隔离原始内容，再按策略覆盖，不静默丢弃', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  const corruptRaw = '{ "broken": '
  store.set(HISTORY_KEYS.workouts, corruptRaw)

  const beforeRead = await repository.listWorkouts()
  assert.deepEqual(beforeRead.items, [])
  const summary = await repository.summarize()
  assert.equal(summary.skippedCorrupt, 1)
  assert.equal(store.get(HISTORY_KEYS.workouts), corruptRaw, '只读不得改写损坏内容')

  await repository.saveWorkout(makeWorkoutAt('w-after-corrupt'))
  const quarantine = JSON.parse(store.get(HISTORY_KEYS.quarantine) ?? '{}')
  assert.equal(quarantine.entries[0].key, HISTORY_KEYS.workouts)
  assert.equal(quarantine.entries[0].raw, corruptRaw, '原始字节必须被隔离保存')
  assert.equal(
    JSON.parse(store.get(HISTORY_KEYS.workouts)).length,
    1,
    '隔离后新数据仍可写入',
  )
  const afterSave = await repository.summarize()
  assert.equal(afterSave.skippedCorrupt, 1, '被覆盖掉的损坏内容必须持久计数，不能随写入消失')
  assert.equal(afterSave.workoutCount, 1)
})

test('D08a-3c 导入丢弃条目级损坏行前先隔离原始字节', async () => {
  resetHistoryState()
  const storage = loadService(path.join('services', 'storage.js'))
  const good = makeWorkoutAt('w-good', { atMs: 1000 })
  const corruptRaw = JSON.stringify([good, '坏掉的一行'])
  store.set(HISTORY_KEYS.workouts, corruptRaw)

  const result = await storage.importRawData(
    makePayload([makeRoute('route-a', 'A', 1000)], [], [makeWorkoutAt('w-incoming', { atMs: 2000 })]),
  )
  assert.equal(result.workoutsTruncated, 0)
  const quarantine = JSON.parse(store.get(HISTORY_KEYS.quarantine) ?? '{}')
  assert.ok(Array.isArray(quarantine.entries) && quarantine.entries.length >= 1)
  assert.equal(quarantine.entries[0].key, HISTORY_KEYS.workouts)
  assert.equal(quarantine.entries[0].raw, corruptRaw, '丢弃前必须保留原始字节')
  const repository = loadRepository().historyRepository
  const summary = await repository.summarize()
  assert.equal(summary.skippedCorrupt, 1, '被丢弃的损坏条必须计数')
  assert.equal(summary.retainedWorkoutCount, 2)
})

test('D08a-4 迁移被中断：可重入、源数据仍在、可回滚', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  const migration = loadMigration()
  // 模拟「升级前的旧数据」：只有旧键，没有任何 D08a 新增键（聚合尚未自举）
  const legacyWorkouts = []
  for (let index = 0; index < 3; index += 1) {
    legacyWorkouts.push(makeWorkoutAt(`w-${index}`, { atMs: 1000 + index }))
  }
  store.set(HISTORY_KEYS.workouts, JSON.stringify(legacyWorkouts))
  store.set(HISTORY_KEYS.sessions, JSON.stringify([makeSessionAt('s-0')]))
  store.set(HISTORY_KEYS.meta, JSON.stringify({ sessionsTrimmed: 0, workoutsTrimmed: 0 }))
  const sourceBefore = {
    workouts: store.get(HISTORY_KEYS.workouts),
    sessions: store.get(HISTORY_KEYS.sessions),
    meta: store.get(HISTORY_KEYS.meta),
  }
  // 让聚合键写入失败，模拟「迁移写到一半被中断」
  armSetItemFailureForKey(HISTORY_KEYS.agg)
  const failed = await migration.migrateHistory()
  disarmSetItemFailure()
  assert.equal(failed.state, 'failed')
  assert.ok(failed.lastError, '失败必须带回原因')
  assert.deepEqual(
    {
      workouts: store.get(HISTORY_KEYS.workouts),
      sessions: store.get(HISTORY_KEYS.sessions),
      meta: store.get(HISTORY_KEYS.meta),
    },
    sourceBefore,
    '迁移失败不得删除/改写源数据',
  )

  const retried = await migration.migrateHistory()
  assert.equal(retried.state, 'done', '重跑必须幂等完成')
  assert.equal(retried.hasRollbackSnapshot, true)
  const status = await repository.migrationStatus()
  assert.equal(status.state, 'done')
  assert.equal(status.hasRollbackSnapshot, true)
  assert.equal(status.schemaVersion, 2)

  const summary = await repository.summarize()
  assert.equal(summary.workoutCount, 3)
  assert.equal(summary.sessionCount, 1)
  assert.equal(summary.retainedWorkoutCount, 3)
  assert.equal(summary.trimmedTotal, 0)
})

test('D08a-4b 回滚快照写入失败：状态 failed 且源数据不动', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  const migration = loadMigration()
  await repository.saveWorkout(makeWorkoutAt('w-keep'))
  const rawBefore = store.get(HISTORY_KEYS.workouts)
  armSetItemFailureForKey(HISTORY_KEYS.rollback)
  const failed = await migration.migrateHistory()
  disarmSetItemFailure()
  assert.equal(failed.state, 'failed')
  assert.equal(failed.hasRollbackSnapshot, false)
  assert.equal(store.get(HISTORY_KEYS.workouts), rawBefore)
  // 解除故障后重跑可完成
  const retried = await migration.migrateHistory()
  assert.equal(retried.state, 'done')
  assert.equal(retried.hasRollbackSnapshot, true)
})

test('D08a-5 迁移后回滚：旧键内容逐字节一致且回滚可重复', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  const migration = loadMigration()
  for (let index = 0; index < 4; index += 1) {
    await repository.saveWorkout(makeWorkoutAt(`w-${index}`, { atMs: 2000 + index }))
  }
  await repository.saveSession(makeSessionAt('s-legacy'))
  const before = {
    workouts: store.get(HISTORY_KEYS.workouts),
    sessions: store.get(HISTORY_KEYS.sessions),
    meta: store.get(HISTORY_KEYS.meta),
  }
  const migrated = await migration.migrateHistory()
  assert.equal(migrated.state, 'done')
  assert.ok(store.has(HISTORY_KEYS.agg), '迁移必须新增聚合键')

  const rolledBack = await migration.rollbackHistoryMigration()
  assert.equal(rolledBack.restored, true)
  assert.equal(store.get(HISTORY_KEYS.workouts), before.workouts, '旧键必须逐字节一致')
  assert.equal(store.get(HISTORY_KEYS.sessions), before.sessions)
  assert.equal(store.get(HISTORY_KEYS.meta), before.meta)
  assert.equal(store.has(HISTORY_KEYS.agg), false, '迁移新增的聚合键应被移除')
  assert.equal(store.has(HISTORY_KEYS.migration), false)

  const statusAfterRollback = await repository.migrationStatus()
  assert.equal(statusAfterRollback.state, 'none')
  assert.equal(statusAfterRollback.hasRollbackSnapshot, true)

  // 回滚幂等：再回滚一次仍成功，且数据仍然一致
  const again = await migration.rollbackHistoryMigration()
  assert.equal(again.restored, true)
  assert.equal(store.get(HISTORY_KEYS.workouts), before.workouts)

  // 回滚后仍可读且汇总自举（不依赖聚合键）
  const summary = await repository.summarize()
  assert.equal(summary.retainedWorkoutCount, 4)
  assert.equal(summary.workoutCount, 4)
  assert.equal(summary.sessionCount, 1)
  const page = await repository.listWorkouts({ limit: 2 })
  assert.equal(page.total, 4)
  assert.equal(page.hasMore, true)
})

test('D08a-5b 无快照时回滚返回原因而不是假装成功', async () => {
  resetHistoryState()
  const migration = loadMigration()
  const result = await migration.rollbackHistoryMigration()
  assert.equal(result.restored, false)
  assert.match(String(result.reason), /没有迁移前快照/)
})

test('D08a-6 进行中的 checkpoint 在 200 条历史裁剪后仍可恢复', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  const workoutStorage = loadService(path.join('services', 'workout-storage.js'))
  const checkpoint = {
    workoutId: 'workout-active',
    templateId: 'route-a',
    rounds: [{ roundNumber: 1, floors: 2 }],
    savedAt: 123456,
    generation: 7,
  }
  await workoutStorage.saveActiveCheckpoint(checkpoint)
  assert.ok(store.has('palou.activeWorkout.v1'))

  for (let index = 0; index < 200; index += 1) {
    await repository.saveWorkout(makeWorkoutAt(`w-${index}`, { atMs: 1000 + index }))
  }
  const summary = await repository.summarize()
  assert.equal(summary.workoutCount, 200)
  assert.equal(summary.trimmedTotal, 100)

  const restored = await workoutStorage.loadActiveCheckpoint()
  assert.deepEqual(restored, checkpoint, 'checkpoint 永不参与裁剪/清理')
  assert.ok(store.has('palou.activeWorkout.v1'))
})

test('D08a-7 冻结接口与既有导出签名不变', async () => {
  resetHistoryState()
  const repository = loadRepository()
  const storage = loadService(path.join('services', 'storage.js'))
  const workoutStorage = loadService(path.join('services', 'workout-storage.js'))
  for (const name of [
    'listWorkouts',
    'getWorkout',
    'saveWorkout',
    'deleteWorkout',
    'listSessions',
    'getSession',
    'saveSession',
    'deleteSession',
    'summarize',
    'migrationStatus',
  ]) {
    assert.equal(
      typeof repository.historyRepository[name],
      'function',
      `historyRepository.${name} 必须存在`,
    )
  }
  for (const name of [
    'listSessions',
    'saveSession',
    'listWorkouts',
    'saveWorkout',
    'getWorkout',
    'deleteWorkout',
    'loadActiveCheckpoint',
    'saveActiveCheckpoint',
    'clearActiveCheckpoint',
    'exportRawData',
    'importRawData',
    'restorePreImportSnapshot',
    'getCapacityStatus',
  ]) {
    const owner = name.startsWith('listWorkouts') ||
      name === 'saveWorkout' ||
      name === 'getWorkout' ||
      name === 'deleteWorkout' ||
      name === 'loadActiveCheckpoint' ||
      name === 'saveActiveCheckpoint' ||
      name === 'clearActiveCheckpoint'
      ? workoutStorage
      : storage
    assert.equal(typeof owner[name], 'function', `${name} 必须仍然导出`)
  }
  assert.equal(storage.SESSIONS_LIMIT, 100)
  assert.equal(storage.CAPACITY_WARN_THRESHOLD, 90)
  assert.equal(typeof storage.migrateHistory, 'function')
  assert.equal(typeof storage.rollbackHistoryMigration, 'function')
  assert.equal(storage.HISTORY_MIGRATION_SCHEMA_VERSION, 2)
})

test('D08a-8 SESSIONS_LIMIT 不再静默删除：裁剪计数可观测且贡献进聚合', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  const storage = loadService(path.join('services', 'storage.js'))
  let trimmedEvents = []
  storage.setStorageTrimListener((event) => trimmedEvents.push(event))

  const limit = storage.SESSIONS_LIMIT
  for (let index = 0; index < limit + 1; index += 1) {
    await storage.saveSession(makeSessionAt(`s-${index}`, { floors: 1, ascentM: 3 }))
  }
  const result = await storage.saveSession(makeSessionAt('s-overflow', { floors: 1, ascentM: 3 }))
  assert.equal(result.truncated, true)
  assert.equal(result.removed, 1)
  assert.equal(trimmedEvents.length, 2, '每次裁剪都必须通知 UI（不再静默）')
  assert.deepEqual(trimmedEvents[1], { collection: 'sessions', removed: 1, remaining: limit })

  const meta = JSON.parse(store.get(HISTORY_KEYS.meta))
  assert.equal(meta.sessionsTrimmed, 2, '裁剪必须写入 meta 计数')
  const summary = await repository.summarize()
  assert.equal(summary.sessionCount, limit + 2)
  assert.equal(summary.trimmedTotal, 2)
  assert.equal(summary.retainedSessionCount, limit)
  assert.equal(summary.totalFloors, limit + 2, '被裁剪会话的楼层仍计入长期统计')
  assert.equal(summary.totalAscentM, (limit + 2) * 3)
  assert.equal(summary.aggregatesIncludeTrimmed, true)
  assert.equal(summary.trimmedWithoutDetail, 0)
  assert.equal(
    summary.retainedSessionCount + summary.trimmedTotal + summary.removedTotal,
    summary.writtenTotal,
  )
  storage.setStorageTrimListener(undefined)
})

test('D08a-9 容量策略保持：nearLimit 告警与写入失败如实报错', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  const storage = loadService(path.join('services', 'storage.js'))
  const threshold = storage.CAPACITY_WARN_THRESHOLD
  for (let index = 0; index < threshold; index += 1) {
    await repository.saveWorkout(makeWorkoutAt(`w-${index}`, { atMs: 1000 + index }))
  }
  const capacity = await storage.getCapacityStatus()
  assert.equal(capacity.workoutsCount, threshold)
  assert.equal(capacity.nearLimit, true)
  assert.equal(capacity.workoutsLimit, storage.SESSIONS_LIMIT)

  // 写入失败必须抛错，不得假装成功
  const rawBefore = store.get(HISTORY_KEYS.workouts)
  armSetItemFailureForKey(HISTORY_KEYS.workouts)
  let error
  try {
    await repository.saveWorkout(makeWorkoutAt('w-fail'))
  } catch (caught) {
    error = caught
  } finally {
    disarmSetItemFailure()
  }
  assert.ok(error, '存储写入失败必须抛出错误')
  assert.equal(error.message.includes('重启后将自动恢复'), false)
  assert.equal(store.get(HISTORY_KEYS.workouts), rawBefore, '失败后明细必须与写入前一致')
  const summary = await repository.summarize()
  assert.equal(summary.workoutCount, threshold, '失败的写入不得计入长期统计')
})

test('D08a-9b 纯追加时聚合写失败：训练记录仍落盘，计数在下次写入自愈', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  for (let index = 0; index < 3; index += 1) {
    await repository.saveWorkout(makeWorkoutAt(`w-${index}`, { atMs: 1000 + index }))
  }
  const aggBefore = store.get(HISTORY_KEYS.agg)

  // 没有记录离开保留集合时，聚合键写失败不得让训练保存失败（D02 既有策略）
  armSetItemFailureForKey(HISTORY_KEYS.agg)
  let error
  let result
  try {
    result = await repository.saveWorkout(makeWorkoutAt('w-4th', { atMs: 9999 }))
  } catch (caught) {
    error = caught
  } finally {
    disarmSetItemFailure()
  }
  assert.equal(error, undefined, '聚合写失败不得让训练记录保存失败')
  assert.equal(result.total, 4)
  assert.equal(JSON.parse(store.get(HISTORY_KEYS.workouts)).length, 4, '训练记录必须已落盘')
  assert.equal(store.get(HISTORY_KEYS.agg), aggBefore, '聚合键仍是旧内容（写入失败）')

  // 汇总按实际保留条数如实纠正，并暴露漂移量（不假装一切正常）
  const repaired = await repository.summarize()
  assert.equal(repaired.workoutCount, 4)
  assert.equal(repaired.reconciledDrift, 1)
  assert.equal(
    repaired.retainedWorkoutCount + repaired.retainedSessionCount + repaired.trimmedTotal + repaired.removedTotal,
    repaired.writtenTotal,
  )

  // 下一次成功写入把纠正后的计数持久化
  await repository.saveWorkout(makeWorkoutAt('w-5th', { atMs: 10_000 }))
  const settled = await repository.summarize()
  assert.equal(settled.workoutCount, 5)
  assert.equal(settled.reconciledDrift, 0, '成功写入后漂移必须被持久化修正')
})

test('D08a-9d 有记录离开保留集合时聚合写失败：整体回滚并如实报错', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  const limit = 100
  for (let index = 0; index < limit; index += 1) {
    await repository.saveWorkout(makeWorkoutAt(`w-${index}`, { atMs: 1000 + index }))
  }
  const workoutsBefore = store.get(HISTORY_KEYS.workouts)
  const aggBefore = store.get(HISTORY_KEYS.agg)

  // 第 101 条会裁剪掉最旧一条：明细与聚合必须一起写，聚合失败即整体回滚
  armSetItemFailureForKey(HISTORY_KEYS.agg)
  let error
  try {
    await repository.saveWorkout(makeWorkoutAt('w-overflow', { atMs: 99_999 }))
  } catch (caught) {
    error = caught
  } finally {
    disarmSetItemFailure()
  }
  assert.ok(error, '裁剪路径的成对写入失败必须抛错')
  assert.equal(store.get(HISTORY_KEYS.workouts), workoutsBefore, '明细必须已回滚')
  assert.equal(store.get(HISTORY_KEYS.agg), aggBefore, '聚合必须保持写入前内容')
  assert.equal(store.has(HISTORY_KEYS.journal), false, '回滚完整后日志必须被清理')
  const summary = await repository.summarize()
  assert.equal(summary.workoutCount, limit, '失败写入不得计入长期统计')
  assert.equal(summary.trimmedTotal, 0)
  assert.equal(summary.retainedWorkoutCount, limit)
  assert.equal(summary.reconciledDrift, 0)
})

test('D08a-9c 进程在成对写入中途被杀：启动恢复按 scoped 日志回滚明细与聚合', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  const storage = loadService(path.join('services', 'storage.js'))
  const workoutStorage = loadService(path.join('services', 'workout-storage.js'))
  for (let index = 0; index < 3; index += 1) {
    await repository.saveWorkout(makeWorkoutAt(`w-${index}`, { atMs: 1000 + index }))
  }
  const workoutsBefore = store.get(HISTORY_KEYS.workouts)
  const aggBefore = store.get(HISTORY_KEYS.agg)

  // 模拟「明细已写、聚合还没写、进程被杀」：明细键是新内容，日志未提交
  const partialRows = [
    makeWorkoutAt('w-crash', { atMs: 9999 }),
    ...JSON.parse(workoutsBefore),
  ].slice(0, 100)
  store.set(HISTORY_KEYS.workouts, JSON.stringify(partialRows))
  store.set(
    HISTORY_KEYS.journal,
    JSON.stringify({
      id: 'history-crash',
      operation: 'history',
      createdAt: 1,
      scoped: true,
      before: {
        [HISTORY_KEYS.workouts]: workoutsBefore,
        [HISTORY_KEYS.agg]: aggBefore,
      },
      after: {
        [HISTORY_KEYS.workouts]: JSON.stringify(partialRows),
        [HISTORY_KEYS.agg]: JSON.stringify({ schemaVersion: 2 }),
      },
      committed: false,
    }),
  )

  // 模拟进程重启：清掉三个服务缓存的恢复结果
  storage.__resetStorageForTests()
  workoutStorage.__resetWorkoutStorageForTests()
  loadRepository().__resetHistoryRepositoryForTests()

  const items = await workoutStorage.listWorkouts()
  assert.deepEqual(
    items.map((item) => item.id).sort(),
    ['w-0', 'w-1', 'w-2'],
    '未提交的成对写入必须整体回滚',
  )
  assert.equal(store.get(HISTORY_KEYS.workouts), workoutsBefore)
  assert.equal(store.get(HISTORY_KEYS.agg), aggBefore)
  assert.equal(store.has(HISTORY_KEYS.journal), false, '恢复成功后日志必须被清理')
  const summary = await repository.summarize()
  assert.equal(summary.workoutCount, 3)
  assert.equal(
    summary.retainedWorkoutCount + summary.retainedSessionCount + summary.trimmedTotal + summary.removedTotal,
    summary.writtenTotal,
  )
})

test('D08a-10 导入计入长期统计且重复导入不重复计数', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  const storage = loadService(path.join('services', 'storage.js'))
  const payload = makePayload(
    [makeRoute('route-a', 'A', 1000)],
    [makeSessionAt('s-import', { floors: 2, ascentM: 6 })],
    [
      makeWorkoutAt('w-import-1', { floors: 3, ascentM: 9, atMs: 3000 }),
      makeWorkoutAt('w-import-2', { floors: 4, ascentM: 12, atMs: 4000 }),
    ],
  )
  const first = await storage.importRawData(payload)
  assert.equal(first.workoutsCount, 2)
  assert.equal(first.workoutsTruncated, 0)
  const afterFirst = await repository.summarize()
  assert.equal(afterFirst.workoutCount, 2)
  assert.equal(afterFirst.sessionCount, 1)
  assert.equal(afterFirst.totalFloors, 3 + 4 + 2)
  assert.equal(afterFirst.totalAscentM, 9 + 12 + 6)

  const second = await storage.importRawData(payload)
  assert.equal(second.workoutsCount, 2)
  const afterSecond = await repository.summarize()
  assert.equal(afterSecond.workoutCount, 2, '重复导入同一 payload 不得重复计数')
  assert.equal(afterSecond.sessionCount, 1)
  assert.equal(afterSecond.totalFloors, afterFirst.totalFloors)
  assert.equal(
    afterSecond.retainedWorkoutCount +
      afterSecond.retainedSessionCount +
      afterSecond.trimmedTotal +
      afterSecond.removedTotal,
    afterSecond.writtenTotal,
  )
})

test('D08a-10b 删除记录：保留计数与统计同步下降，不变量保持', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  for (let index = 0; index < 3; index += 1) {
    await repository.saveWorkout(
      makeWorkoutAt(`w-${index}`, { floors: 1, ascentM: 3, atMs: 1000 + index }),
    )
  }
  const before = await repository.summarize()
  assert.equal(before.writtenTotal, 3)
  await repository.deleteWorkout('w-1')
  const after = await repository.summarize()
  assert.equal(after.retainedWorkoutCount, 2)
  assert.equal(after.removedTotal, 1)
  assert.equal(after.trimmedTotal, 0)
  assert.equal(after.writtenTotal, 3, '删除不改变累计写入数，只改变保留/移除分类')
  // 删除只把明细移出保留集合：累计统计（写入过的历史）不减少，removedTotal 如实暴露。
  assert.equal(after.totalFloors, before.totalFloors, '删除不减少累计楼层（累计口径）')
  assert.equal(
    after.retainedWorkoutCount +
      after.retainedSessionCount +
      after.trimmedTotal +
      after.removedTotal,
    after.writtenTotal,
  )
  assert.equal(await repository.getWorkout('w-1'), undefined)
})

test('D08a-11 旧数据（已有 meta 裁剪计数）首次保存时自举，不丢历史计数', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  // 模拟升级前状态：保留 100 条 + meta 已记 7 条裁剪（旧代码的静默裁剪）
  const legacy = []
  for (let index = 0; index < 100; index += 1) {
    legacy.push(makeWorkoutAt(`w-old-${index}`, { atMs: 1000 + index }))
  }
  store.set(HISTORY_KEYS.workouts, JSON.stringify(legacy))
  store.set(HISTORY_KEYS.meta, JSON.stringify({ sessionsTrimmed: 0, workoutsTrimmed: 7 }))

  const beforeSave = await repository.summarize()
  assert.equal(beforeSave.workoutCount, 107, '自举必须把旧 meta 裁剪计数算进累计写入')
  assert.equal(beforeSave.trimmedTotal, 7)
  assert.equal(beforeSave.retainedWorkoutCount, 100)
  assert.equal(
    beforeSave.aggregatesIncludeTrimmed,
    false,
    '升级前的裁剪记录没有明细贡献，必须如实标记而不是假装包含',
  )
  assert.equal(beforeSave.trimmedWithoutDetail, 7)

  await repository.saveWorkout(makeWorkoutAt('w-new', { atMs: 9999 }))
  const afterSave = await repository.summarize()
  assert.equal(afterSave.workoutCount, 108)
  assert.equal(afterSave.trimmedTotal, 8)
  assert.equal(afterSave.retainedWorkoutCount, 100)
  assert.equal(
    afterSave.retainedWorkoutCount + afterSave.trimmedTotal + afterSave.removedTotal,
    afterSave.writtenTotal,
  )
  const meta = JSON.parse(store.get(HISTORY_KEYS.meta))
  assert.equal(meta.workoutsTrimmed, 8)
})

test('D09-4c 导出→新设备导入后，已归档记录的长期统计不丢失（总控接线用例）', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  const storage = loadService(path.join('services', 'storage.js'))

  // 源设备：写 105 条（容量策略保留 100 条，5 条明细被归档进账本）
  for (let index = 0; index < 105; index += 1) {
    await repository.saveWorkout(
      makeWorkoutAt(`w-4c-${index}`, { atMs: 1000 + index, floors: 3, ascentM: 9 }),
    )
  }
  const sourceSummary = await repository.summarize()
  assert.equal(sourceSummary.retainedWorkoutCount, 100)
  assert.equal(sourceSummary.trimmedTotal, 5)
  assert.equal(sourceSummary.workoutCount, 105, '账本必须覆盖全部 105 条')

  const exported = await storage.exportRawData()
  assert.ok(exported.archiveAggregate, '导出必须携带归档聚合（4c 接线）')
  assert.equal(exported.archiveAggregate.schemaVersion, 2)
  assert.equal(exported.workouts.length, 100, '明细仍受容量策略约束')

  // 新设备：只有备份文件（清空存储，模拟换机）
  resetHistoryState()
  const result = await storage.importRawData(JSON.parse(JSON.stringify(exported)))
  assert.equal(result.archiveAggregateNote, undefined, '本机无账本时应认领备份聚合')

  const restored = await repository.summarize()
  assert.equal(restored.workoutCount, sourceSummary.workoutCount)
  assert.equal(restored.totalFloors, sourceSummary.totalFloors)
  assert.equal(restored.totalAscentM, sourceSummary.totalAscentM)
  assert.equal(restored.totalActiveDurationMs, sourceSummary.totalActiveDurationMs)
  assert.equal(restored.trimmedTotal, 5)
  assert.equal(restored.retainedWorkoutCount, 100)
  assert.deepEqual(restored.byDay, sourceSummary.byDay)
  assert.equal(
    restored.retainedWorkoutCount + restored.trimmedTotal + restored.removedTotal,
    restored.writtenTotal,
    '认领聚合后不变量仍成立，且保留明细没有被重复计入',
  )
})

test('D09-4c merge + 本机已有账本时不合并账本，并留下可见原因', async () => {
  resetHistoryState()
  const repository = loadRepository().historyRepository
  const storage = loadService(path.join('services', 'storage.js'))

  await repository.saveWorkout(makeWorkoutAt('w-local-1', { atMs: 1111 }))
  const localSummary = await repository.summarize()
  // 用真实账本结构构造一个「远端账本」（本机账本形状 + 远端自己的裁剪计数）
  const remoteAgg = JSON.parse(store.get(HISTORY_KEYS.agg))
  remoteAgg.workouts.writtenTotal += 7
  remoteAgg.workouts.trimmedTotal += 7
  const backup = {
    version: 2,
    exportedAt: 2222,
    routes: [],
    sessions: [],
    workouts: [makeWorkoutAt('w-remote-1', { atMs: 3333 })],
    archiveAggregate: remoteAgg,
  }

  const result = await storage.importRawData(backup, { mode: 'merge' })
  assert.ok(result.archiveAggregateNote, 'merge 时必须如实说明未合并账本')
  const merged = await repository.summarize()
  assert.equal(merged.retainedWorkoutCount, 2, '两条明细都在（merge 语义）')
  assert.equal(
    merged.trimmedTotal,
    localSummary.trimmedTotal,
    '本机账本不得被远端账本污染（否则会重复计数）',
  )
  assert.equal(
    merged.retainedWorkoutCount + merged.trimmedTotal + merged.removedTotal,
    merged.writtenTotal,
    'merge 后不变量仍成立',
  )
})

// === F16：导入预览（只算不写）与真实导入必须一致 ===
test('F16 previewImport 与真实导入一致：裁剪条数、认领归档、警告文案', async () => {
  const storage = loadService(path.join('services', 'storage.js'))
  storage.__resetStorageForTests()

  // 造 130 条本机会话 + 20 条备份会话（merge 后 150 > 上限 100 → 裁 50）
  const localSessions = Array.from({ length: 130 }, (_, i) => ({
    id: `local-${i}`,
    templateId: 'route-1',
    startedAt: 1_000 + i,
    endedAt: 2_000 + i,
    floors: 10,
    ascentM: 30,
    durationMs: 60_000,
    steps: 100,
  }))
  const incomingSessions = Array.from({ length: 20 }, (_, i) => ({
    id: `backup-${i}`,
    templateId: 'route-1',
    startedAt: 5_000 + i,
    endedAt: 6_000 + i,
    floors: 10,
    ascentM: 30,
    durationMs: 60_000,
    steps: 100,
  }))

  const planInput = {
    mode: 'merge',
    incomingRoutes: [],
    incomingSessions,
    incomingWorkouts: [],
    previousRoutes: [],
    previousSessions: localSessions,
    previousWorkouts: [],
    carriedAggregate: null,
    hasLocalAggregate: false,
  }
  const preview = storage.previewImport(planInput)
  const plan = storage.computeImportPlan(planInput)

  assert.equal(preview.kept.sessions, plan.sessions.length, '预览与计划必须给出同样的保留条数')
  assert.equal(preview.trimmed.sessions, plan.sessionsTruncated, '预览与计划的裁剪条数必须一致')
  assert.equal(preview.trimmed.sessions, 50, '130+20 条 merge 后应裁掉 50 条')
  assert.ok(
    preview.warnings.some((line) => /裁掉最旧的 50 条/.test(line)),
    '预览必须把裁剪后果说清楚',
  )
  assert.ok(
    preview.warnings.some((line) => /统计仍会归档保留/.test(line)),
    '预览必须说明裁剪不等于统计丢失',
  )

  // 归档聚合：本机无账本 + 备份携带 → 应认领，且不产生「未合并」警告
  const carried = { version: 2, sessions: {}, workouts: {} }
  const withAggregate = storage.previewImport({
    ...planInput,
    carriedAggregate: carried,
    hasLocalAggregate: false,
  })
  assert.equal(withAggregate.archiveAggregate.carried, true)
  assert.equal(withAggregate.archiveAggregate.adopted, true)
  assert.equal(withAggregate.warnings.length, preview.warnings.length, '认领时不应新增警告')

  // 归档聚合：本机已有账本 + merge → 不认领，必须给出可见说明（与导入返回值同一句话）
  const notAdopted = storage.previewImport({
    ...planInput,
    carriedAggregate: carried,
    hasLocalAggregate: true,
  })
  assert.equal(notAdopted.archiveAggregate.adopted, false)
  assert.ok(
    notAdopted.archiveAggregate.note &&
      /未合并/.test(notAdopted.archiveAggregate.note),
    '不认领时必须给出原因',
  )
  assert.ok(
    notAdopted.warnings.some((line) => /未合并/.test(line)),
    '原因必须出现在 warnings 里，UI 才可能展示',
  )

  // replace 模式必须警告「会清空本机数据」
  const replacePreview = storage.previewImport({ ...planInput, mode: 'replace' })
  assert.ok(
    replacePreview.warnings.some((line) => /替换本机数据/.test(line)),
    'replace 必须给出清空警告',
  )
  assert.equal(replacePreview.kept.sessions, 20, 'replace 只保留备份里的会话')
})

test('F16 previewImport 是纯函数：调用前后不产生任何存储写入', async () => {
  const storage = loadService(path.join('services', 'storage.js'))
  storage.__resetStorageForTests()
  const before = new Map(store)
  const writesBefore = setItemCount
  storage.previewImport({
    mode: 'replace',
    incomingRoutes: [],
    incomingSessions: [{ id: 'x', templateId: 'r', startedAt: 1, endedAt: 2 }],
    incomingWorkouts: [],
    previousRoutes: [],
    previousSessions: [],
    previousWorkouts: [],
    carriedAggregate: null,
    hasLocalAggregate: false,
  })
  assert.deepEqual(store, before, '预览不得改变任何存储键')
  assert.equal(setItemCount, writesBefore, '预览不得调用写入')
})

test('F16 导入预览与真实导入的裁剪结果一致（端到端，写入真实存储）', async () => {
  const storage = loadService(path.join('services', 'storage.js'))
  storage.__resetStorageForTests()

  // 先写入 130 条会话（本机明细上限 100，写入过程会按策略裁剪）
  for (let i = 0; i < 130; i += 1) {
    await storage.saveSession({
      id: `seed-${i}`,
      templateId: 'route-1',
      startedAt: 10_000 + i,
      endedAt: 20_000 + i,
      floors: 10,
      ascentM: 30,
      durationMs: 60_000,
      steps: 100,
    })
  }

  const payload = {
    version: 2,
    exportedAt: 1,
    routes: [],
    sessions: Array.from({ length: 20 }, (_, i) => ({
      id: `incoming-${i}`,
      templateId: 'route-1',
      startedAt: 100_000 + i,
      endedAt: 200_000 + i,
      floors: 10,
      ascentM: 30,
      durationMs: 60_000,
      steps: 100,
    })),
    workouts: [],
  }

  // 预览与真实导入必须给出**同一组数字**（这是 F16 的核心保证：
  // 用户看到的「会裁掉多少条」必须等于实际裁掉的条数）。
  const preview = await storage.previewImportFromBackup(payload, { mode: 'merge' })
  assert.ok(
    preview.kept.sessions <= 100,
    `预览保留条数不得超过上限 100（实际 ${preview.kept.sessions}）`,
  )
  assert.ok(preview.trimmed.sessions >= 0)

  const result = await storage.importRawData(payload, { mode: 'merge' })
  assert.equal(result.sessionsCount, preview.kept.sessions, '导入保留条数必须与预览一致')
  assert.equal(
    result.sessionsTruncated,
    preview.trimmed.sessions,
    '导入裁剪条数必须与预览一致',
  )

  // 导入后本机条数也必须等于预览承诺的保留条数
  const after = await storage.exportRawData()
  assert.equal(
    after.sessions.length,
    preview.kept.sessions,
    '导入后实际落盘条数必须等于预览承诺',
  )
})

test('four voice preferences survive cold reload without changing unrelated preferences', async () => {
  const file = path.join(servicesRoot, 'services', 'preferences.js')
  const oldModule = require.cache[file]
  const oldRaw = store.get('palou.prefs.v1')
  try {
    store.set('palou.prefs.v1', JSON.stringify({ bodyWeightKg: 73, hapticFeedback: false, voiceMode: 'coach' }))
    delete require.cache[file]
    let prefs = require(file)
    assert.equal((await prefs.getPreferences()).voiceSpeaker, 'serena')
    for (const speaker of ['uncle_fu', 'dylan', 'serena', 'vivian']) {
      await prefs.savePreferences({ voiceSpeaker: speaker })
      delete require.cache[file]; prefs = require(file)
      const restored = await prefs.getPreferences()
      assert.equal(restored.voiceSpeaker, speaker)
      assert.equal(restored.bodyWeightKg, 73)
      assert.equal(restored.voiceMode, 'coach')
      assert.equal(restored.hapticFeedback, false)
    }
    await prefs.savePreferences({ voiceSpeaker: '../invalid' })
    assert.equal((await prefs.getPreferences()).voiceSpeaker, 'serena')
  } finally {
    if (oldRaw === undefined) store.delete('palou.prefs.v1'); else store.set('palou.prefs.v1', oldRaw)
    delete require.cache[file]
    if (oldModule) require.cache[file] = oldModule
  }
})

// === D11 选项 C：一次性「训练中不要锁屏」提示 ===
test('D11-C 后台暂停提示：偏好默认未看过、写入后持久化', async () => {
  const prefs = loadService(path.join('services', 'preferences.js'))
  const storage = loadService(path.join('services', 'storage.js'))
  storage.__resetStorageForTests()

  const before = await prefs.getPreferences()
  assert.equal(
    before.backgroundPauseHintSeen,
    undefined,
    '默认值必须是「未看过」（undefined/false），首次进入训练页才会提示',
  )

  await prefs.savePreferences({ backgroundPauseHintSeen: true })
  const after = await prefs.getPreferences()
  assert.equal(after.backgroundPauseHintSeen, true, '关掉提示后必须持久化')

  // 其它偏好不能被这次写入破坏
  assert.equal(after.hapticFeedback, before.hapticFeedback)
  assert.equal(after.bodyWeightKg, before.bodyWeightKg)
})

test('D11-C 开始前说明按偏好显示，统一开始入口与帮助可用', () => {
  const fs = require('node:fs')
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/workout-entry.ts'), 'utf8')
  assert.match(source, /backgroundPauseHintSeen === true/)
  assert.match(source, /savePreferences\(\{ backgroundPauseHintSeen: true \}\)/)
  assert.match(source, /后台缺段/)
  assert.match(source, /手动修正最终楼层/)
  for (const page of ['TrainHome', 'WorkoutSetup']) {
    const content = fs.readFileSync(path.join(__dirname, '..', `src/pages/${page}.tsx`), 'utf8')
    assert.match(content, /await confirmBackgroundRecording\(\)/)
  }
  const settings = fs.readFileSync(path.join(__dirname, '..', 'src/pages/Settings.tsx'), 'utf8')
  assert.match(settings, /训练记录说明/)
  assert.match(settings, /锁屏或切到其它应用时，系统会暂停传感器/)
})

// === F23：格式未知的日志不得「假装恢复成功」并销毁证据 ===
test('F23 未知格式日志：不得宣称已恢复、不得删除日志', async () => {
  const storage = loadService(path.join('services', 'storage.js'))
  const journal = loadService(path.join('services', 'storage-journal.js'))
  storage.__resetStorageForTests()
  await storage.clearAllForTests?.()

  // 手工构造一份「有日志、但 before 里没有任何集合名」的日志（模拟格式演进/截断）
  store.set(
    journal.STORAGE_JOURNAL_KEY,
    JSON.stringify({
      id: 'unknown-shape',
      operation: 'import',
      committed: false,
      createdAt: 1,
      before: { 'palou.someFutureKey.v9': 'whatever' },
      after: { 'palou.someFutureKey.v9': 'other' },
    }),
  )

  const report = await journal.recoverPendingJournal()
  assert.equal(report.recovered, false, '没有可还原目标时不得报告成功')
  assert.ok(report.failure && /没有可识别的集合键/.test(report.failure), '必须给出可读原因')
  assert.ok(
    store.get(journal.STORAGE_JOURNAL_KEY) != null,
    '必须保留日志：删掉就等于销毁唯一的排查证据',
  )
})


test('精简流程：上次目标仅在路线版本和携带方式一致时复用', () => {
  const core = loadService('core/workout-setup.js')
  const route = makeRoute('setup-route', '楼梯')
  const saved = { routeId: route.id, routeVersion: route.version, carryMode: route.carryMode,
    goal: { type: 'rounds', targetRounds: 7 }, planEnabled: true, planWarmup: true, planRecovery: false }
  assert.equal(core.restoreWorkoutSetup(route, saved).goal.targetRounds, 7)
  for (const changed of [{ ...route, id: 'other' }, { ...route, version: route.version + 1 }, { ...route, carryMode: 'waist' }]) {
    assert.deepEqual(core.restoreWorkoutSetup(changed, saved).goal, { type: 'open' })
    assert.equal(core.restoreWorkoutSetup(changed, saved).planEnabled, false)
  }
  for (const goal of [{ type: 'rounds', targetRounds: -2 }, { type: 'duration', targetActiveDurationMs: NaN }, { type: 'unknown' }]) {
    assert.deepEqual(core.restoreWorkoutSetup(route, { ...saved, goal }).goal, { type: 'open' })
  }
  const draft = { ...route, segments: [], endFloor: route.startFloor, status: 'draft' }
  assert.deepEqual(core.restoreWorkoutSetup(draft, saved).goal, { type: 'open' })
})

test('精简流程：单次开始生成真实计划，净爬楼目标与热身分开', () => {
  const core = loadService('core/workout-setup.js')
  const route = makeRoute('setup-route', '楼梯')
  const settings = { ...core.restoreWorkoutSetup(route), goal: { type: 'duration', targetActiveDurationMs: 600000 },
    planEnabled: true, planWarmup: true, planRecovery: true }
  const params = core.workoutEntryParams(route, settings, 1200)
  assert.equal(params.id, route.id)
  assert.equal(params.goal.targetActiveDurationMs, 600000)
  assert.equal(params.plan.createdAt, 1200)
  assert.ok(params.plan.warmup)
  assert.ok(params.plan.recoveryPerRound)
  assert.deepEqual(core.workoutEntryParams({ ...route, segments: [], endFloor: route.startFloor }, settings, 1200).goal, { type: 'open' })
})

function simplificationCheckpoint() {
  return { workoutId: 'resume-simplification', templateId: 'resume-route', phase: 'round_ready',
    currentRoundNumber: 1, savedAt: 3000, startedAt: 1000, completedRounds: [],
    goal: { type: 'open' }, returnConfirmationMode: 'assisted' }
}

test('精简恢复：路线不存在时保留检查点，不能声称已保存', async () => {
  resetState()
  const cp = simplificationCheckpoint()
  const w = loadService('services/workout-storage.js')
  await w.saveActiveCheckpoint(cp)
  await assert.rejects(loadService('services/checkpoint-completion.js').saveCheckpointAsCompleted(cp), /路线已不存在/)
  assert.equal((await w.loadActiveCheckpoint()).workoutId, cp.workoutId)
  assert.equal((await w.listWorkouts()).length, 0)
})

test('精简恢复：保存失败保留检查点，成功保存后再清除', async () => {
  resetState()
  const storage = loadService('services/storage.js')
  const w = loadService('services/workout-storage.js')
  const completion = loadService('services/checkpoint-completion.js')
  await storage.saveRoute(makeRoute('resume-route', '楼梯'))
  const cp = simplificationCheckpoint()
  await w.saveActiveCheckpoint(cp)
  armSetItemFailure(1)
  await assert.rejects(completion.saveCheckpointAsCompleted(cp))
  disarmSetItemFailure()
  assert.equal((await w.loadActiveCheckpoint()).workoutId, cp.workoutId)
  await completion.saveCheckpointAsCompleted(cp)
  assert.equal(await w.loadActiveCheckpoint(), null)
  assert.equal((await w.listWorkouts()).filter(x => x.id === cp.workoutId).length, 1)
})

test('精简恢复：清除失败上抛，重试保存不会重复计账', async () => {
  resetState()
  const storage = loadService('services/storage.js')
  const w = loadService('services/workout-storage.js')
  const completion = loadService('services/checkpoint-completion.js')
  await storage.saveRoute(makeRoute('resume-route', '楼梯'))
  const cp = simplificationCheckpoint()
  await w.saveActiveCheckpoint(cp)
  const original = AsyncStorageMock.removeItem
  AsyncStorageMock.removeItem = async key => { if (key === 'palou.activeWorkout.v1') throw new Error('remove failed'); return original(key) }
  try { await assert.rejects(completion.saveCheckpointAsCompleted(cp), /未能清除/) }
  finally { AsyncStorageMock.removeItem = original }
  assert.equal((await w.loadActiveCheckpoint()).workoutId, cp.workoutId)
  await completion.saveCheckpointAsCompleted(cp)
  assert.equal(await w.loadActiveCheckpoint(), null)
  assert.equal((await w.listWorkouts()).filter(x => x.id === cp.workoutId).length, 1)
})

async function prepareCheckpointLifecycle({ withRound = false } = {}) {
  resetState()
  const storage = loadService('services/storage.js')
  const w = loadService('services/workout-storage.js')
  const cp = simplificationCheckpoint()
  if (withRound) {
    cp.currentRoundNumber = 2
    cp.completedRounds = [{ id: 'completed-before-interruption', roundNumber: 1,
      startedAt: 1000, endedAt: 2500, durationMs: 1500, startFloor: 1, targetFloor: 3,
      finalFloor: 3, floorsCompleted: 3, ascentM: 6, steps: 18, confidence: 0.9,
      complete: true, completionReason: 'auto_finish', floorSplits: [], events: [], interruptions: [] }]
  }
  await storage.saveRoute(makeRoute(cp.templateId, '待恢复路线'))
  await w.saveActiveCheckpoint(cp)
  trainingStatus = { supported: true, running: true, sessionId: cp.workoutId }
  checkpointLifecycleEvents.length = 0
  return { cp, w, completion: loadService('services/checkpoint-completion.js') }
}

test('恢复服务生命周期：放弃当前会话必须确认停止后再清恢复点', async () => {
  const { cp, w, completion } = await prepareCheckpointLifecycle()
  await completion.discardCheckpointAsAbandoned()
  assert.deepEqual(checkpointLifecycleEvents, ['status', 'stop', 'status', 'clear'])
  assert.equal(trainingStatus.running, false)
  assert.equal(await w.loadActiveCheckpoint(), null)
  assert.equal((await w.listWorkouts()).length, 0, '放弃不能伪造已保存成绩')
  assert.equal(trainingStatus.sessionId, cp.workoutId)
})

test('恢复服务生命周期：已停止服务即使留有旧 sessionId 也可清恢复点', async () => {
  const { cp, w, completion } = await prepareCheckpointLifecycle()
  trainingStatus = { supported: true, running: false, sessionId: 'old-other-session' }
  await completion.discardCheckpointAsAbandoned(cp)
  assert.deepEqual(checkpointLifecycleEvents, ['status', 'clear'])
  assert.equal(await w.loadActiveCheckpoint(), null)
})

test('恢复服务生命周期：缺少原生模块的旧版本仍可放弃恢复点', async () => {
  const { cp, w } = await prepareCheckpointLifecycle()
  const paths = ['services/background-training.js', 'services/checkpoint-completion.js']
    .map(rel => require.resolve(path.join(servicesRoot, rel)))
  delete NativeModulesMock.AndroidTrainingSensors
  for (const modulePath of paths) delete require.cache[modulePath]
  try {
    await loadService('services/checkpoint-completion.js').discardCheckpointAsAbandoned(cp)
    assert.equal(await w.loadActiveCheckpoint(), null)
    assert.deepEqual(checkpointLifecycleEvents, ['clear'], '无模块时不得调用模拟的服务')
  } finally {
    NativeModulesMock.AndroidTrainingSensors = TrainingNativeMock
    for (const modulePath of paths) delete require.cache[modulePath]
  }
})

for (const action of ['discard', 'save']) {
  const run = (completion, cp) => action === 'discard'
    ? completion.discardCheckpointAsAbandoned(cp)
    : completion.saveCheckpointAsCompleted(cp)

  test(`恢复服务生命周期：${action} 遇到其他会话时不停止、不清除当前恢复点`, async () => {
    const { cp, w, completion } = await prepareCheckpointLifecycle({ withRound: true })
    const originalCheckpoint = JSON.stringify(await w.loadActiveCheckpoint())
    trainingStatus = { supported: true, running: true, sessionId: 'another-active-workout' }
    await assert.rejects(run(completion, cp), /另一|其他/)
    assert.equal(JSON.stringify(await w.loadActiveCheckpoint()), originalCheckpoint)
    assert.equal(trainingStatus.running, true)
    assert.equal(trainingStatus.sessionId, 'another-active-workout')
    assert.equal(checkpointLifecycleEvents.includes('stop'), false)
    assert.equal(checkpointLifecycleEvents.includes('clear'), false)
    assert.equal((await w.listWorkouts()).length, action === 'save' ? 1 : 0,
      '保存成功的记录必须保留；放弃不生成成绩')
  })

  test(`恢复服务生命周期：${action} 的原生停止抛错时保留恢复点并给出可重试错误`, async () => {
    const { cp, w, completion } = await prepareCheckpointLifecycle()
    trainingStopError = new Error('native training stop failed')
    await assert.rejects(run(completion, cp), /后台.*停止|停止.*后台/)
    assert.equal((await w.loadActiveCheckpoint()).workoutId, cp.workoutId)
    assert.equal(trainingStatus.running, true)
    assert.equal(checkpointLifecycleEvents.includes('clear'), false)
    assert.equal((await w.listWorkouts()).length, action === 'save' ? 1 : 0)
  })

  test(`恢复服务生命周期：${action} 不采信停止返回值，实际仍运行时保留恢复点`, async () => {
    const { cp, w, completion } = await prepareCheckpointLifecycle()
    trainingStaysRunning = true
    trainingStopReportsStopped = true
    await assert.rejects(run(completion, cp), /后台.*停止|停止.*后台/)
    assert.equal((await w.loadActiveCheckpoint()).workoutId, cp.workoutId)
    assert.equal(trainingStatus.running, true)
    assert.deepEqual(checkpointLifecycleEvents.filter(x => x !== 'save'), ['status', 'stop', 'status'])
    assert.equal((await w.listWorkouts()).length, action === 'save' ? 1 : 0)
  })

  test(`恢复服务生命周期：${action} 无法读取服务状态时不得清恢复点`, async () => {
    const { cp, w, completion } = await prepareCheckpointLifecycle()
    trainingStatusError = new Error('native status unavailable')
    await assert.rejects(run(completion, cp), /后台.*状态/)
    assert.equal((await w.loadActiveCheckpoint()).workoutId, cp.workoutId)
    assert.equal(checkpointLifecycleEvents.includes('stop'), false)
    assert.equal(checkpointLifecycleEvents.includes('clear'), false)
  })
}

test('恢复服务生命周期：保存、停止、复查、清除的顺序可观察', async () => {
  const { cp, w, completion } = await prepareCheckpointLifecycle({ withRound: true })
  trainingStopHook = async () => {
    assert.equal((await w.getWorkout(cp.workoutId)).totalFloorsCompleted, 3,
      '停止服务前成绩必须已写入')
    assert.equal((await w.loadActiveCheckpoint()).workoutId, cp.workoutId,
      '停止服务前恢复点必须仍在')
  }
  const result = await completion.saveCheckpointAsCompleted(cp)
  assert.equal(result.id, cp.workoutId)
  assert.deepEqual(checkpointLifecycleEvents, ['save', 'status', 'stop', 'status', 'clear'])
  assert.equal(await w.loadActiveCheckpoint(), null)
})

test('恢复服务生命周期：停止失败后重试复用已保存成绩，结束时间和中断轮都不改写', async () => {
  const { cp, w, completion } = await prepareCheckpointLifecycle({ withRound: true })
  cp.phase = 'ascending'
  cp.currentRoundStartedAt = 2700
  await w.saveActiveCheckpoint(cp)
  trainingStopError = new Error('first stop failed')
  await assert.rejects(completion.saveCheckpointAsCompleted(cp), /已经保存/)
  const firstSaved = JSON.stringify(await w.getWorkout(cp.workoutId))
  const firstSummary = await loadRepository().historyRepository.summarize()
  assert.equal(JSON.parse(firstSaved).rounds.length, 2)
  trainingStopError = null
  checkpointLifecycleEvents.length = 0
  const retried = await completion.saveCheckpointAsCompleted(cp)
  assert.equal(JSON.stringify(retried), firstSaved)
  assert.equal(JSON.stringify(await w.getWorkout(cp.workoutId)), firstSaved)
  assert.deepEqual(checkpointLifecycleEvents, ['status', 'stop', 'status', 'clear'])
  assert.equal(await w.loadActiveCheckpoint(), null)
  const afterRetry = await loadRepository().historyRepository.summarize()
  for (const key of ['workoutCount', 'writtenTotal', 'totalFloors', 'totalAscentM', 'totalActiveDurationMs']) {
    assert.equal(afterRetry[key], firstSummary[key], `重试不得重复或改变 ${key}`)
  }
})

test('恢复服务生命周期：过期恢复点参数不能停止新会话或删除新恢复点', async () => {
  const { cp, w, completion } = await prepareCheckpointLifecycle()
  const replacement = { ...cp, workoutId: 'new-recovery-owner' }
  await w.saveActiveCheckpoint(replacement)
  trainingStatus = { supported: true, running: true, sessionId: replacement.workoutId }
  for (const action of [() => completion.discardCheckpointAsAbandoned(cp), () => completion.saveCheckpointAsCompleted(cp)]) {
    await assert.rejects(action(), /发生变化|已变化/)
  }
  assert.deepEqual(await w.loadActiveCheckpoint(), replacement)
  assert.equal(checkpointLifecycleEvents.includes('stop'), false)
  assert.equal(checkpointLifecycleEvents.includes('clear'), false)
  assert.equal((await w.listWorkouts()).length, 0)
})

test('恢复服务生命周期：停止等待期间换了恢复点时保留新恢复点', async () => {
  const { cp, w, completion } = await prepareCheckpointLifecycle()
  const replacement = { ...cp, workoutId: 'replacement-while-stopping' }
  trainingStopHook = () => w.saveActiveCheckpoint(replacement)
  await assert.rejects(completion.discardCheckpointAsAbandoned(cp), /发生变化|已变化/)
  assert.deepEqual(await w.loadActiveCheckpoint(), replacement)
  assert.equal(checkpointLifecycleEvents.includes('clear'), false)
})

test('恢复服务生命周期：保存存储失败时不先停止采集，也不丢恢复点', async () => {
  const { cp, w, completion } = await prepareCheckpointLifecycle()
  armSetItemFailure(1)
  try { await assert.rejects(completion.saveCheckpointAsCompleted(cp), /写入失败/) }
  finally { disarmSetItemFailure() }
  assert.equal((await w.loadActiveCheckpoint()).workoutId, cp.workoutId)
  assert.equal(trainingStatus.running, true)
  assert.equal(checkpointLifecycleEvents.includes('stop'), false)
  assert.equal(checkpointLifecycleEvents.includes('clear'), false)
})

test('新路线检查绑定本机，来自另一部手机的检查不直接继承', async () => {
  const device = loadService(path.join('services', 'preparation-device.js'))
  const route = makeRoute('prepared-scope', '保留这条真实路线')
  route.preparation = { version: 1, deviceKey: 'other-device', elevator: 'present', referenceRevision: 100,
    runs: [{ id: 'teach', step: 'teach_first', passed: true }, { id: 'check', step: 'check_floors', passed: true }] }
  const before = JSON.stringify(route)
  const scoped = device.scopePreparationToDevice(route, 'this-device')
  assert.equal(scoped.preparation.localChecksRequired, true)
  assert.equal(scoped.preparation.runs[0].passed, true)
  assert.equal(scoped.preparation.runs[1].passed, false)
  assert.equal(JSON.stringify(route), before, 'read-time scoping must not mutate stored source')
  assert.deepEqual(scoped.segments, route.segments)
  assert.equal(device.scopePreparationToDevice(route, 'other-device'), route)
})

test('旧路线没有新检查字段时读取不改写旧记录', () => {
  const device = loadService(path.join('services', 'preparation-device.js'))
  const old = makeRoute('old-real-route', '旧路线仍然保留')
  assert.equal(device.scopePreparationToDevice(old, 'local'), old)
})
