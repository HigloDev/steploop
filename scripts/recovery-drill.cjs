// 迁移/恢复演练（D02 + D08a 的「可执行证据」）。
//
// 与单元测试的区别：这里按**真实使用顺序**跑一遍故障场景，并把每一步的实测数字
// 汇总成一份可读报告（Markdown），可以附在交接材料里，也可以在 D08b 换 SQLite 引擎后
// 原样重跑，用来证明「换引擎不改变恢复语义」。
//
// 用法：
//   node scripts/recovery-drill.cjs                      # 跑演练并打印报告
//   node scripts/recovery-drill.cjs --out <file.md>      # 同时写入报告文件
//   node scripts/recovery-drill.cjs --json <file.json>   # 机器可读结果
//
// 退出码：0 = 全部场景通过；1 = 有场景失败（逐条列出）；2 = 环境/编译产物问题。
//
// 诚实边界：
// - 演练跑在 Node + 内存 mock 的 AsyncStorage 上，**不是真机**：它能证明「代码在故障下的行为」，
//   不能证明真机崩溃/断电行为。真机部分见 BOUNDARIES_AND_BLOCKERS.md。
// - 演练不产生任何真实训练数据；所有记录都是合成值。

const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const servicesRoot = path.join(
  __dirname,
  '..',
  'node_modules',
  '.cache',
  'steploop-services',
)

// === 最小 AsyncStorage / 文件 / 分享 mock（与 scripts/test-data.cjs 同一套语义）===

const store = new Map()
const writtenFiles = new Map()
let setItemCount = 0
let failSetItemAt = 0
let failSetItemKey = null
let failSetItemKeyArmed = false

const AsyncStorageMock = {
  async getItem(key) {
    return store.has(key) ? store.get(key) : null
  },
  async setItem(key, value) {
    setItemCount += 1
    if (failSetItemAt > 0 && setItemCount === failSetItemAt) {
      throw new Error('mock: 模拟写入失败（存储满）')
    }
    if (failSetItemKeyArmed && key === failSetItemKey) {
      throw new Error(`mock: 模拟指定键写入失败（${key}）`)
    }
    store.set(key, String(value))
  },
  async removeItem(key) {
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

const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '@react-native-async-storage/async-storage') return AsyncStorageMock
  if (request === 'expo-file-system') {
    return { File: FileMock, Paths: { document: 'file://mock-documents' } }
  }
  if (request === 'expo-sharing') {
    return { async isAvailableAsync() { return false }, async shareAsync() {} }
  }
  if (request === 'expo-haptics') {
    return {
      async impactAsync() {},
      async notificationAsync() {},
      ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
      NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
    }
  }
  if (request === 'react-native') {
    return { Platform: { OS: 'android', select: (options) => options.android ?? options.default } }
  }
  return originalLoad.apply(this, arguments)
}

if (!fs.existsSync(servicesRoot)) {
  console.error(
    `缺少编译产物：${servicesRoot}\n请先运行 npm run build:services-test。`,
  )
  process.exitCode = 2
  return
}

const storage = require(path.join(servicesRoot, 'services', 'storage.js'))
const journal = require(path.join(servicesRoot, 'services', 'storage-journal.js'))
const repository = require(path.join(servicesRoot, 'services', 'history-repository.js'))
const migration = require(path.join(servicesRoot, 'services', 'history-migration.js'))

// === 演练基础设施 ===

const results = []

function record(id, title, passed, evidence, detail) {
  results.push({ id, title, passed, evidence, detail })
}

function armFailureAt(count) {
  failSetItemAt = count
  failSetItemKey = null
  failSetItemKeyArmed = false
  setItemCount = 0
}

function disarmFailure() {
  failSetItemAt = 0
  failSetItemKey = null
  failSetItemKeyArmed = false
  setItemCount = 0
}

function route(id, name, updatedAt = 1_000) {
  return {
    id,
    name,
    startFloor: 1,
    endFloor: 3,
    carryMode: 'pocket',
    floorHeightM: 3,
    totalAscentM: 6,
    device: { platform: 'android', model: 'drill', system: 'drill' },
    segments: [
      {
        id: `${id}-s1`,
        type: 'flight',
        startMs: 0,
        endMs: 1_000,
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

function session(id, startedAt) {
  return {
    id,
    templateId: 'route-drill',
    startedAt,
    endedAt: startedAt + 60_000,
    floors: 10,
    ascentM: 30,
    durationMs: 60_000,
    steps: 100,
  }
}

async function resetAll() {
  store.clear()
  disarmFailure()
  storage.__resetStorageForTests()
  journal.__resetJournalQueueForTests?.()
  await storage.__resetStorageForTests()
}

// === 场景 1：多键写入中途失败 → 不得留下半套数据 ===

async function scenarioPartialWrite() {
  await resetAll()
  await storage.saveRoute(route('route-drill', '演练路线'))
  await storage.saveSession(session('before-1', 1_000))

  // 让「导入」这次多键写入的第 1 次 setItem 就失败（最坏情况：写到一半断电）
  armFailureAt(1)
  let threw = false
  try {
    await storage.importRawData(
      {
        version: 2,
        exportedAt: 1,
        routes: [route('incoming-route', '导入路线')],
        sessions: [session('incoming-1', 5_000)],
        workouts: [],
      },
      { mode: 'merge' },
    )
  } catch {
    threw = true
  }
  disarmFailure()

  // 模拟进程重启：清掉内存缓存，再读一次
  storage.__resetStorageForTests()
  const after = await storage.exportRawData()
  const incomingPresent = after.sessions.some((item) => item.id === 'incoming-1')
  const previousIntact = after.sessions.some((item) => item.id === 'before-1')

  record(
    'S1',
    '多键写入中途失败：不得留下半套数据',
    threw && !incomingPresent && previousIntact,
    `写入抛错=${threw}；导入记录落盘=${incomingPresent}；原记录仍在=${previousIntact}`,
    '写入失败必须整体不生效，且原有数据不能被破坏',
  )
}

// === 场景 2：未提交日志 → 启动恢复回滚到一致状态 ===

async function scenarioJournalRecovery() {
  await resetAll()
  await storage.saveSession(session('stable-1', 1_000))
  const before = await storage.exportRawData()

  // 直接构造一份「未提交」日志：before=当前，after=被污染的值
  const { STORAGE_JOURNAL_KEY } = journal
  // 旧格式日志的 before/after 以**集合名**为键（scoped 格式才用存储键）；
  // 这里刻意用旧格式，顺带覆盖「旧版本升级后留下的未提交日志」这条真实路径。
  const polluted = [session('polluted-1', 9_000)]
  store.set(
    STORAGE_JOURNAL_KEY,
    JSON.stringify({
      id: 'drill-entry',
      operation: 'import',
      committed: false,
      createdAt: Date.now(),
      before: { sessions: JSON.stringify(before.sessions) },
      after: { sessions: JSON.stringify(polluted) },
    }),
  )
  store.set(repository.HISTORY_SESSIONS_KEY, JSON.stringify(polluted))

  // 模拟重启后的恢复
  storage.__resetStorageForTests()
  const report = await journal.recoverPendingJournal()
  const after = await storage.exportRawData()
  const journalCleared = store.get(STORAGE_JOURNAL_KEY) == null
  const stableBack = after.sessions.some((item) => item.id === 'stable-1')
  const pollutedGone = !after.sessions.some((item) => item.id === 'polluted-1')

  record(
    'S2',
    '未提交日志：启动恢复回滚到一致状态并清理日志',
    report.recovered === true && journalCleared && stableBack && pollutedGone,
    `recovered=${report.recovered}；restored=${JSON.stringify(report.restored ?? [])}；日志已清理=${journalCleared}；原记录恢复=${stableBack}；污染记录已回滚=${pollutedGone}`,
    '恢复必须回滚未提交的写入，而不是把半套数据当结果',
  )
}

// === 场景 2b（F23）：无法识别的日志 → 不得假装恢复成功、不得销毁证据 ===

async function scenarioUnknownJournal() {
  await resetAll()
  const { STORAGE_JOURNAL_KEY } = journal
  store.set(
    STORAGE_JOURNAL_KEY,
    JSON.stringify({
      id: 'unknown-shape',
      operation: 'import',
      committed: false,
      createdAt: Date.now(),
      before: { 'palou.someFutureKey.v9': 'whatever' },
      after: { 'palou.someFutureKey.v9': 'other' },
    }),
  )

  const report = await journal.recoverPendingJournal()
  const journalKept = store.get(STORAGE_JOURNAL_KEY) != null

  record(
    'S2b',
    '无法识别的日志：fail closed 并保留证据',
    report.recovered === false && journalKept && Boolean(report.failure),
    `recovered=${report.recovered}；日志保留=${journalKept}；原因=${report.failure ?? '—'}`,
    '「什么都没还原却报成功，还删掉日志」是最坏的组合：既没恢复，又毁了排查证据',
  )
}

// === 场景 3：导入后可撤销（导入前快照）===

async function scenarioImportUndo() {
  await resetAll()
  await storage.saveRoute(route('route-drill', '演练路线'))
  await storage.saveSession(session('original-1', 1_000))

  await storage.importRawData(
    {
      version: 2,
      exportedAt: 2,
      routes: [route('route-drill', '演练路线')],
      sessions: [session('imported-1', 7_000)],
      workouts: [],
    },
    { mode: 'merge' },
  )
  const afterImport = await storage.exportRawData()
  const importedPresent = afterImport.sessions.some((item) => item.id === 'imported-1')

  // 返回快照恢复后的条数；没有快照时返回 null（这里必须非 null）
  const restored = await storage.restorePreImportSnapshot()
  const afterUndo = await storage.exportRawData()
  const importedGone = !afterUndo.sessions.some((item) => item.id === 'imported-1')
  const originalBack = afterUndo.sessions.some((item) => item.id === 'original-1')

  record(
    'S3',
    '导入可撤销：恢复导入前快照回到原状态',
    importedPresent &&
      restored !== null &&
      restored.sessionsCount === 1 &&
      importedGone &&
      originalBack,
    `导入生效=${importedPresent}；撤销恢复会话数=${restored?.sessionsCount ?? 'null'}；导入记录已移除=${importedGone}；原记录恢复=${originalBack}`,
    '用户点错导入必须能整体撤销',
  )
}

// === 场景 4：历史迁移可回滚（旧键逐字节还原）===

async function scenarioMigrationRollback() {
  await resetAll()
  // 构造「迁移前」的旧形态数据：旧键 + 旧 meta
  const legacySessions = [session('legacy-1', 1_000), session('legacy-2', 2_000)]
  store.set(repository.HISTORY_SESSIONS_KEY, JSON.stringify(legacySessions))
  store.set(repository.HISTORY_WORKOUTS_KEY, JSON.stringify([]))
  const legacyRoutes = [{ id: 'route-drill', name: '演练路线', version: 3 }]
  store.set('palou.routes.v3', JSON.stringify(legacyRoutes))

  const beforeBytes = {
    sessions: store.get(repository.HISTORY_SESSIONS_KEY),
    routes: store.get('palou.routes.v3'),
  }

  const migrated = await migration.migrateHistory()
  const rollback = await migration.rollbackHistoryMigration()
  const afterBytes = {
    sessions: store.get(repository.HISTORY_SESSIONS_KEY),
    routes: store.get('palou.routes.v3'),
  }

  const sessionsIdentical = beforeBytes.sessions === afterBytes.sessions
  const routesIdentical = beforeBytes.routes === afterBytes.routes

  record(
    'S4',
    '历史迁移可回滚：旧键逐字节还原',
    migrated.hasRollbackSnapshot === true &&
      rollback.restored === true &&
      sessionsIdentical &&
      routesIdentical,
    `迁移 state=${migrated.state}；有回滚快照=${migrated.hasRollbackSnapshot}；回滚 restored=${rollback.restored}（${rollback.reason ?? '—'}）；会话键逐字节相同=${sessionsIdentical}；路线键逐字节相同=${routesIdentical}`,
    '回滚必须还原到迁移前的字节，而不是「看起来差不多」',
  )
}

// === 场景 5：容量裁剪可观测，且统计不丢 ===

async function scenarioTrimAccounting() {
  await resetAll()
  const total = 130
  for (let index = 0; index < total; index += 1) {
    await storage.saveSession(session(`trim-${index}`, 1_000 + index))
  }
  const summary = await repository.historyRepository.summarize()
  const raw = await storage.exportRawData()
  const kept = raw.sessions.length
  const limit = repository.HISTORY_SESSION_LIMIT

  // 账本口径（含已裁剪部分）：sessionCount 是累计写入过的会话数，trimmedTotal 是被裁掉的条数。
  const accounted = summary.sessionCount
  const trimmed = summary.trimmedTotal
  const retainedPlusTrimmed = kept + trimmed

  record(
    'S5',
    '容量裁剪可观测：累计口径守恒，统计不随明细消失',
    kept <= limit && accounted === total && retainedPlusTrimmed === total,
    `写入=${total}；落盘保留=${kept}（上限 ${limit}）；账本 sessionCount=${accounted}；trimmedTotal=${trimmed}；保留+裁剪=${retainedPlusTrimmed}；聚合含已裁剪=${summary.aggregatesIncludeTrimmed}`,
    '裁剪可以发生，但累计统计必须守恒且可见',
  )
}

// === 主流程 ===

async function main(argv) {
  let outPath = null
  let jsonPath = null
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') {
      outPath = argv[index + 1]
      index += 1
    } else if (argv[index] === '--json') {
      jsonPath = argv[index + 1]
      index += 1
    }
  }

  const scenarios = [
    scenarioPartialWrite,
    scenarioJournalRecovery,
    scenarioUnknownJournal,
    scenarioImportUndo,
    scenarioMigrationRollback,
    scenarioTrimAccounting,
  ]
  for (const scenario of scenarios) {
    try {
      await scenario()
    } catch (error) {
      record(
        scenario.name,
        '场景执行失败',
        false,
        error instanceof Error ? error.message : String(error),
        '场景本身抛错即视为失败（不允许把异常当通过）',
      )
    }
  }

  const passed = results.filter((item) => item.passed).length
  const lines = []
  lines.push('# 迁移/恢复演练报告（自动生成）')
  lines.push('')
  lines.push(`生成时间：${new Date().toISOString()}`)
  lines.push(`运行环境：Node ${process.version} + 内存 mock AsyncStorage（**不是真机**）`)
  lines.push('')
  lines.push(`结果：**${passed}/${results.length} 通过**`)
  lines.push('')
  lines.push('| 场景 | 结论 | 实测证据 |')
  lines.push('| --- | --- | --- |')
  for (const item of results) {
    lines.push(
      `| ${item.id} ${item.title} | ${item.passed ? '✅ 通过' : '⛔ 失败'} | ${item.evidence} |`,
    )
  }
  lines.push('')
  lines.push('## 边界（不得当成真机证据）')
  lines.push('')
  lines.push('- 演练跑在内存 mock 上：证明的是**代码在故障下的行为**，不是真机崩溃/断电行为。')
  lines.push('- 真机部分（强杀恢复、锁屏 30 分钟、断电）仍为 BLOCKED，见 `BOUNDARIES_AND_BLOCKERS.md`。')
  lines.push('- 换 SQLite 引擎（D08b）后应原样重跑本演练，用于证明恢复语义未被改变。')

  const markdown = `${lines.join('\n')}\n`
  if (outPath) {
    fs.writeFileSync(path.resolve(outPath), markdown, 'utf8')
    console.log(`已写入演练报告：${path.resolve(outPath)}`)
  }
  if (jsonPath) {
    fs.writeFileSync(
      path.resolve(jsonPath),
      `${JSON.stringify({ generatedAt: new Date().toISOString(), passed, total: results.length, results }, null, 2)}\n`,
      'utf8',
    )
    console.log(`已写入机器可读结果：${path.resolve(jsonPath)}`)
  }
  if (!outPath && !jsonPath) process.stdout.write(markdown)

  for (const item of results) {
    console.log(`${item.passed ? '✅' : '⛔'} ${item.id} ${item.title}`)
  }
  if (passed !== results.length) {
    console.error(`\n⛔ 演练未全部通过（${passed}/${results.length}）`)
    return 1
  }
  return 0
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 2
  })

module.exports = { main }
