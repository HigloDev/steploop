// D09 进步趋势测试（node:test，零依赖）。
//
// 自行编译 core 到**本任务专属产出目录**（node_modules/.cache/steploop-core-d09），
// 避免与并发 worker 争用 node_modules/.cache/steploop-core（D07 正在用 build:core）。
// 运行：node --test scripts/test-progress.cjs
//
// 时区纪律：所有跨周/跨月断言都显式传 timeZoneOffsetMinutes（固定偏移），
// 不依赖运行机器时区；另有用例证明「不传 offset」时与 training-progress.startOfLocalWeek 一致。

const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')

const repoRoot = path.join(__dirname, '..')
const compiledRoot = path.join(repoRoot, 'node_modules', '.cache', 'steploop-core-d09')

execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    '--ignoreConfig',
    '--ignoreDeprecations',
    '6.0',
    '--lib',
    'es2022',
    '--outDir',
    'node_modules/.cache/steploop-core-d09',
    '--module',
    'commonjs',
    '--moduleResolution',
    'node',
    '--target',
    'es2020',
    '--esModuleInterop',
    '--skipLibCheck',
    'src/core/types.ts',
    'src/core/floors.ts',
    'src/core/math.ts',
    'src/core/workout-summary.ts',
    'src/core/corrections.ts',
    'src/core/training-progress.ts',
    'src/core/progress-trends.ts',
    'src/core/backup-payload.ts',
  ],
  { cwd: repoRoot, stdio: 'inherit' },
)

function load(module) {
  return require(path.join(compiledRoot, `${module}.js`))
}

// ---------------------------------------------------------------------------
// 4c 端到端（services 层）：单独编译到本任务专属目录，只编译 D08a 的
// history-repository + storage-journal（不涉及 D07 正在改的 workout-* 文件），
// 并用内存 mock 替换 AsyncStorage。用来证明「归档聚合进备份 → 新设备 summarize() 不丢」。
// ---------------------------------------------------------------------------

const servicesRoot = path.join(repoRoot, 'node_modules', '.cache', 'steploop-services-d09')

execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    '--ignoreConfig',
    '--ignoreDeprecations',
    '6.0',
    '--lib',
    'es2022',
    '--types',
    'node',
    '--rootDir',
    'src',
    '--outDir',
    'node_modules/.cache/steploop-services-d09',
    '--module',
    'commonjs',
    '--moduleResolution',
    'node',
    '--target',
    'es2020',
    '--esModuleInterop',
    '--skipLibCheck',
    'src/services/history-repository.ts',
    'src/services/storage-journal.ts',
  ],
  { cwd: repoRoot, stdio: 'inherit' },
)

const storageStore = new Map()
const AsyncStorageMock = {
  async getItem(key) {
    return storageStore.has(key) ? storageStore.get(key) : null
  },
  async setItem(key, value) {
    storageStore.set(key, String(value))
  },
  async removeItem(key) {
    storageStore.delete(key)
  },
  async clear() {
    storageStore.clear()
  },
  async getAllKeys() {
    return Array.from(storageStore.keys())
  },
}

const Module = require('node:module')
const originalModuleLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === '@react-native-async-storage/async-storage') return AsyncStorageMock
  return originalModuleLoad.apply(this, arguments)
}

function loadRepository() {
  return require(path.join(servicesRoot, 'services', 'history-repository.js'))
}

const MINUTE_MS = 60 * 1000
const TZ_UTC8 = 480

// ---------------------------------------------------------------------------
// 固定时间戳（全部用 UTC 字面量，不依赖运行机器时区）
// ---------------------------------------------------------------------------

// UTC+8：2026-09-20（周日）23:59 与 2026-09-21（周一）00:01
const SUN_2359_UTC8 = Date.parse('2026-09-20T15:59:00Z')
const MON_0001_UTC8 = Date.parse('2026-09-20T16:01:00Z')
// 对应的本地周一 00:00 起点（UTC+8）
const WEEK_W38_START_UTC8 = Date.parse('2026-09-13T16:00:00Z')
const WEEK_W39_START_UTC8 = Date.parse('2026-09-20T16:00:00Z')
// UTC 下的同一批时间戳：两条记录都落在 2026-W38（周起点 2026-09-14T00:00:00Z）
const WEEK_W38_START_UTC = Date.parse('2026-09-14T00:00:00Z')

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function makeRound(overrides = {}) {
  return {
    id: 'round-1',
    roundNumber: 1,
    startedAt: 0,
    endedAt: 200000,
    durationMs: 200000,
    startFloor: 1,
    targetFloor: 16,
    finalFloor: 16,
    // 与 startFloor=1 → finalFloor=16 的「成绩口径」一致（getFloorAchievementCount = 16）
    floorsCompleted: 16,
    ascentM: 48,
    steps: 490,
    confidence: 0.92,
    complete: true,
    completionReason: 'route_complete',
    floorSplits: [],
    events: [],
    interruptions: [],
    ...overrides,
  }
}

function makeWorkout(overrides = {}) {
  const startedAt = overrides.startedAt ?? WEEK_W38_START_UTC8
  const rounds = overrides.rounds ?? [makeRound()]
  return {
    id: 'w1',
    templateId: 'route-a',
    templateVersion: 1,
    routeSnapshot: {
      name: 'A',
      locationName: 'A楼',
      startFloor: 1,
      endFloor: 16,
      floorsPerRound: 16,
      ascentPerRoundM: 48,
    },
    goal: { type: 'open' },
    returnConfirmationMode: 'manual',
    status: 'completed',
    startedAt,
    endedAt: startedAt + 200000,
    updatedAt: startedAt + 200000,
    createdAt: startedAt,
    rounds,
    currentRoundNumber: rounds.length,
    totalRoundsCompleted: rounds.length,
    totalFloorsCompleted: 16 * rounds.length,
    totalAscentM: 48 * rounds.length,
    totalSteps: 490 * rounds.length,
    activeDurationMs: rounds.reduce((sum, round) => sum + round.durationMs, 0),
    returnDurationMs: 0,
    recoveryDurationMs: 0,
    totalElapsedMs: 200000,
    ...overrides,
  }
}

function makeAggregate(overrides = {}) {
  return {
    schemaVersion: 2,
    workouts: {
      writtenTotal: 105,
      trimmedTotal: 5,
      removedTotal: 0,
      detailCovered: 5,
      expectedRetained: 100,
      floors: 76,
      ascentM: 243,
      activeDurationMs: 900000,
      byDay: {
        '2026-09-14': { workouts: 2, floors: 30 },
        '2026-09-15': { workouts: 3, floors: 46 },
      },
      firstAtMs: Date.parse('2026-09-14T01:00:00Z'),
      lastAtMs: Date.parse('2026-09-15T02:00:00Z'),
      ...(overrides.workouts ?? {}),
    },
    sessions: {
      writtenTotal: 0,
      trimmedTotal: 0,
      removedTotal: 0,
      detailCovered: 0,
      expectedRetained: 0,
      floors: 0,
      ascentM: 0,
      activeDurationMs: 0,
      byDay: {},
      ...(overrides.sessions ?? {}),
    },
    skippedCorrupt: 0,
    corruptReasons: [],
    updatedAt: Date.parse('2026-09-15T02:00:00Z'),
    ...(overrides.doc ?? {}),
  }
}

// ===========================================================================
// 验收 1：跨周边界 + 时区由参数决定
// ===========================================================================

test('D09-1 跨周：周日 23:59 与周一 00:01 分属两桶，桶起点为本地周一 00:00（固定 offset）', () => {
  const { buildTrend } = load('progress-trends')
  const workouts = [
    makeWorkout({ id: 'sun', startedAt: SUN_2359_UTC8, endedAt: SUN_2359_UTC8 + 200000 }),
    makeWorkout({ id: 'mon', startedAt: MON_0001_UTC8, endedAt: MON_0001_UTC8 + 200000 }),
  ]
  const points = buildTrend(workouts, {
    bucket: 'week',
    fromMs: SUN_2359_UTC8,
    toMs: MON_0001_UTC8,
    timeZoneOffsetMinutes: TZ_UTC8,
  })
  assert.equal(points.length, 2, '跨周应正好两个桶')
  assert.deepEqual(
    points.map((point) => point.label),
    ['2026-W38', '2026-W39'],
  )
  assert.equal(points[0].bucketStart, WEEK_W38_START_UTC8)
  assert.equal(points[1].bucketStart, WEEK_W39_START_UTC8)
  assert.deepEqual(
    points.map((point) => point.workouts),
    [1, 1],
  )
  // 桶起点就是本地周一 00:00（用固定 offset 反推本地日历，不依赖运行机器时区）
  for (const point of points) {
    const local = new Date(point.bucketStart + TZ_UTC8 * MINUTE_MS)
    assert.equal(local.getUTCDay(), 1, '桶起点必须是周一')
    assert.equal(local.getUTCHours(), 0)
    assert.equal(local.getUTCMinutes(), 0)
    assert.equal(local.getUTCSeconds(), 0)
  }

  // 同一批时间戳在 UTC（offset=0）下同属一周：证明 offset 真的决定分桶，而不是机器时区
  const utcPoints = buildTrend(workouts, {
    bucket: 'week',
    fromMs: SUN_2359_UTC8,
    toMs: MON_0001_UTC8,
    timeZoneOffsetMinutes: 0,
  })
  assert.equal(utcPoints.length, 1, 'offset=0 时两条记录同在 2026-W38')
  assert.equal(utcPoints[0].label, '2026-W38')
  assert.equal(utcPoints[0].bucketStart, WEEK_W38_START_UTC)
  assert.equal(utcPoints[0].workouts, 2)

  // 不传 offset：与 D06 startOfLocalWeek 同一口径（机器本地时区），不在测试里假设具体时区
  const { startOfLocalWeek } = load('training-progress')
  const localPoints = buildTrend(workouts, {
    bucket: 'week',
    fromMs: SUN_2359_UTC8,
    toMs: MON_0001_UTC8,
  })
  assert.equal(localPoints[0].bucketStart, startOfLocalWeek(SUN_2359_UTC8))
})

test('D09-1b startOfLocalWeek 与 training-progress 是同一实现（单一来源）', () => {
  const trends = load('progress-trends')
  const trainingProgress = load('training-progress')
  assert.equal(trainingProgress.startOfLocalWeek, trends.startOfLocalWeek)
})

// ===========================================================================
// 验收 2：重复 sessionId 只计一次
// ===========================================================================

test('D09-2 重复 sessionId：只计一次，excluded.duplicate +1，且保留最后写入的一条', () => {
  const { buildTrend, auditTrend } = load('progress-trends')
  const base = WEEK_W38_START_UTC8
  const olderCopy = makeWorkout({
    id: 'dup',
    startedAt: base,
    rounds: [makeRound({ durationMs: 260000, endedAt: 260000 })],
  })
  const newerCopy = makeWorkout({
    id: 'dup',
    startedAt: base + 1000,
    updatedAt: base + 600000,
    endedAt: base + 600000,
    rounds: [makeRound({ durationMs: 180000, endedAt: 180000 })],
  })
  const options = {
    bucket: 'week',
    fromMs: base,
    toMs: base + 600000,
    timeZoneOffsetMinutes: 0,
  }

  const points = buildTrend([olderCopy, newerCopy], options)
  assert.equal(points[0].workouts, 1, '同 id 只计一次')
  assert.equal(points[0].floors, 15)
  assert.equal(points[0].excluded.duplicate, 1)
  assert.equal(points[0].bestRoundMs, 180000, '保留 updatedAt 更新的一条')

  // 与输入顺序无关
  const reversed = buildTrend([newerCopy, olderCopy], options)
  assert.deepEqual(reversed, points)

  const audit = auditTrend([olderCopy, newerCopy], options)
  assert.equal(audit.counted, 1)
  assert.equal(audit.excluded.duplicate, 1)
})

// ===========================================================================
// 验收 3：人工修正不计 PB / 不计入趋势默认口径
// ===========================================================================

test('D09-3 修正链非空：默认不计 PB、计入 excluded.corrected；allowCorrected 计入并标记', () => {
  const { applyRoundCorrection } = load('corrections')
  const { buildTrend, computeRoutePersonalBests, isEligibleTrendWorkout } = load(
    'progress-trends',
  )
  const base = WEEK_W38_START_UTC8
  const clean = makeWorkout({
    id: 'clean',
    startedAt: base,
    rounds: [makeRound({ durationMs: 200000 })],
  })
  const correctedRound = applyRoundCorrection(
    makeRound({ durationMs: 150000, endedAt: 150000 }),
    { finalFloor: 12 },
    { at: 1234, id: 'corr-1' },
  )
  assert.equal(correctedRound.corrections.length, 1, '修正链已写入')
  const corrected = makeWorkout({
    id: 'corrected',
    startedAt: base + 1000,
    updatedAt: base + 1000,
    endedAt: base + 150000,
    rounds: [correctedRound],
  })

  assert.equal(isEligibleTrendWorkout(corrected), false)

  const points = buildTrend([clean, corrected], {
    bucket: 'week',
    fromMs: base,
    toMs: base + 600000,
    timeZoneOffsetMinutes: 0,
  })
  assert.equal(points[0].workouts, 1, '修正过的训练不进趋势默认口径')
  assert.equal(points[0].excluded.corrected, 1)

  const pbs = computeRoutePersonalBests([clean, corrected])
  assert.equal(pbs.length, 1)
  assert.equal(pbs[0].templateId, 'route-a')
  assert.equal(pbs[0].bestRoundMs, 200000, '默认 PB 不采用被修正过的成绩')
  assert.equal(pbs[0].fromCorrected, false)

  const allowed = computeRoutePersonalBests([clean, corrected], { allowCorrected: true })
  assert.equal(allowed.length, 1)
  assert.equal(allowed[0].bestRoundMs, 150000)
  assert.equal(allowed[0].fromCorrected, true)
  // 成绩必须自洽：楼层数与被选中那次训练一致（修正后 1→12 楼 = 爬升 11 层（统一口径））
  assert.equal(allowed[0].bestWorkoutFloors, 11)
  assert.equal(allowed[0].bestWorkoutAscentM, correctedRound.ascentM)

  // 只有 userCorrectionCount（链为空）同样算修正：不得当 PB
  const countOnly = makeWorkout({
    id: 'count-only',
    startedAt: base,
    totalFloorsCompleted: 15,
    rounds: [makeRound({ durationMs: 100000, userCorrectionCount: 1 })],
  })
  assert.equal(isEligibleTrendWorkout(countOnly), false)
  const countOnlyPbs = computeRoutePersonalBests([clean, countOnly])
  assert.equal(countOnlyPbs[0].bestRoundMs, 200000)
})

// ===========================================================================
// 验收 4：删除 / 无效记录不参与统计且不抛异常
// ===========================================================================

test('D09-4 无效记录：结构残缺/未完成/不可信不参与统计，invalid 如实计数且不抛异常', () => {
  const { buildTrend, auditTrend } = load('progress-trends')
  const base = WEEK_W38_START_UTC8
  const valid = makeWorkout({ id: 'valid', startedAt: base })
  const invalidRecords = [
    makeWorkout({ id: 'planned', status: 'planned' }),
    makeWorkout({
      id: 'interrupted',
      rounds: [makeRound({ interruptions: [{ startMs: 1, endMs: 2 }] })],
    }),
    makeWorkout({ id: 'low-confidence', rounds: [makeRound({ confidence: 0.5 })] }),
    makeWorkout({
      id: 'no-complete-round',
      rounds: [makeRound({ complete: false, completionReason: 'manual_finish' })],
    }),
  ]
  const malformedRecords = [undefined, null, 'garbage', 42, {}, { id: '', rounds: [] }]
  const noTime = makeWorkout({
    id: 'no-time',
    startedAt: 0,
    endedAt: 0,
    updatedAt: 0,
    createdAt: 0,
  })

  const options = {
    bucket: 'week',
    fromMs: base,
    toMs: base + 600000,
    timeZoneOffsetMinutes: 0,
  }
  let points
  assert.doesNotThrow(() => {
    points = buildTrend([valid, ...invalidRecords, ...malformedRecords, noTime], options)
  })
  assert.equal(points[0].workouts, 1)
  assert.equal(points[0].excluded.invalid, invalidRecords.length)
  assert.equal(points[0].excluded.corrected, 0)

  const audit = auditTrend([valid, ...invalidRecords, ...malformedRecords, noTime], options)
  assert.equal(audit.unknownRecords, malformedRecords.length)
  assert.equal(audit.unbucketed, 1)
  assert.equal(audit.outsideRange, 0)

  // 被删除的训练（已不在列表里）：不产生任何计数，也不影响其他记录
  const withoutDeleted = buildTrend([valid], options)
  assert.deepEqual(withoutDeleted, buildTrend([valid], options))
  assert.equal(withoutDeleted[0].workouts, 1)
  assert.equal(
    withoutDeleted[0].excluded.invalid + withoutDeleted[0].excluded.corrected,
    0,
  )

  // 非数组输入不抛异常，且审计如实说明输入为空
  const emptyAudit = auditTrend(undefined, options)
  assert.equal(emptyAudit.inputCount, 0)
  assert.equal(emptyAudit.counted, 0)
})

// ===========================================================================
// 验收 4b：归档文案（页面不再有与事实不符的「将自动丢弃」）
// ===========================================================================

test('D09-4b 归档文案由 summarize() 的三字段决定，History.tsx 不再出现「自动丢弃」', () => {
  const { describeArchiveNotice } = load('progress-trends')

  assert.equal(
    describeArchiveNotice({
      trimmedTotal: 0,
      aggregatesIncludeTrimmed: true,
      retainedWorkoutCount: 100,
    }),
    undefined,
    '未发生归档时不显示提示',
  )
  assert.equal(describeArchiveNotice(undefined), undefined)
  assert.equal(describeArchiveNotice(null), undefined)

  const notice = describeArchiveNotice({
    trimmedTotal: 12,
    aggregatesIncludeTrimmed: true,
    retainedWorkoutCount: 88,
  })
  assert.ok(notice, '发生归档必须给出可展示文案')
  assert.match(notice.text, /归档/)
  assert.ok(notice.text.includes('12'), '归档条数来自 trimmedTotal')
  assert.ok(notice.text.includes('88'), '保留条数来自 retainedWorkoutCount')
  assert.equal(notice.trimmedTotal, 12)
  assert.equal(notice.retainedWorkoutCount, 88)
  assert.ok(!notice.text.includes('丢弃'), '归档不等于丢弃，文案不得写「丢弃」')

  const degraded = describeArchiveNotice({
    trimmedTotal: 5,
    aggregatesIncludeTrimmed: false,
    retainedWorkoutCount: 95,
  })
  assert.ok(degraded.text.includes('5') && degraded.text.includes('95'))
  assert.match(degraded.text, /尚未确认覆盖/, '聚合未覆盖全部归档记录时必须如实说明')

  const source = fs.readFileSync(path.join(repoRoot, 'src/pages/History.tsx'), 'utf8')
  // 注释里可以解释字段来源；可执行代码里不得出现（页面不得自行重算/拼文案）
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.ok(!source.includes('自动丢弃'), 'History.tsx 不得再出现「将自动丢弃」文案')
  assert.ok(!source.includes('已达上限'), 'History.tsx 不得再出现「已达上限」文案')
  assert.ok(code.includes('historyRepository.summarize()'), '归档数字必须来自 summarize()')
  assert.ok(code.includes('describeArchiveNotice('), '文案必须由 core 纯函数决定')
  assert.ok(!code.includes('trimmedTotal'), '页面不得直接取 trimmedTotal 自行拼文案')
  assert.ok(!code.includes('aggregatesIncludeTrimmed'), '页面不得自行判断聚合覆盖')
  assert.ok(!code.includes('retainedWorkoutCount'), '页面不得自行取保留条数')
})

// ===========================================================================
// 验收 4c：备份携带归档聚合
// ===========================================================================

test('D09-4c 旧备份无该字段时行为不变；干净聚合 JSON 往返无损；损坏不拒绝整包', () => {
  const {
    validateBackupPayload,
    readArchiveAggregate,
    BACKUP_ARCHIVE_AGGREGATE_VERSION,
  } = load('backup-payload')
  assert.equal(BACKUP_ARCHIVE_AGGREGATE_VERSION, 2)

  const legacyPayload = { version: 2, exportedAt: 1, routes: [], sessions: [], workouts: [] }
  const legacyChecked = validateBackupPayload(legacyPayload)
  assert.equal(legacyChecked.ok, true)
  assert.deepEqual(
    Object.keys(legacyChecked.payload).sort(),
    ['exportedAt', 'routes', 'sessions', 'version', 'workouts'],
    '旧备份校验后不得新增任何键',
  )
  assert.equal('archiveAggregate' in legacyChecked.payload, false)
  assert.equal('archiveAggregateProblems' in legacyChecked.payload, false)
  assert.equal(readArchiveAggregate(undefined).state, 'absent')

  // 干净聚合：导出 → JSON → 新设备校验，summarize() 需要的数字逐一保留
  const aggregate = makeAggregate()
  const exported = { ...legacyPayload, archiveAggregate: aggregate }
  const restored = validateBackupPayload(JSON.parse(JSON.stringify(exported)))
  assert.equal(restored.ok, true)
  assert.deepEqual(restored.payload.archiveAggregate, aggregate)
  const carriedWorkouts = restored.payload.archiveAggregate.workouts
  // 这些字段正是 summarize() 长期统计的输入（trimmed 记录的贡献 + 计数 + 按天分桶）
  for (const field of [
    'writtenTotal',
    'trimmedTotal',
    'removedTotal',
    'detailCovered',
    'expectedRetained',
    'floors',
    'ascentM',
    'activeDurationMs',
  ]) {
    assert.equal(
      carriedWorkouts[field],
      aggregate.workouts[field],
      `${field} 必须在备份往返后保持原值`,
    )
  }
  assert.deepEqual(carriedWorkouts.byDay, aggregate.workouts.byDay)
  assert.equal(carriedWorkouts.firstAtMs, aggregate.workouts.firstAtMs)
  assert.equal(carriedWorkouts.lastAtMs, aggregate.workouts.lastAtMs)
  assert.equal(restored.payload.archiveAggregate.workouts.floors, 76, '被裁剪记录的贡献仍在')
  assert.equal(restored.payload.archiveAggregate.workouts.trimmedTotal, 5)

  // 结构损坏：整包仍然 ok，只忽略聚合字段并留下原因
  const brokenChecked = validateBackupPayload({
    ...legacyPayload,
    archiveAggregate: { schemaVersion: 2, workouts: 'oops', sessions: {} },
  })
  assert.equal(brokenChecked.ok, true, '聚合字段损坏不得拒绝整包')
  assert.equal(brokenChecked.payload.archiveAggregate, undefined)
  assert.equal(brokenChecked.payload.archiveAggregateProblems.length, 1)
  assert.match(brokenChecked.payload.archiveAggregateProblems[0], /workouts\/sessions/)

  // schema 版本不符：忽略 + 原因，不拒绝整包
  const versionChecked = validateBackupPayload({
    ...legacyPayload,
    archiveAggregate: { ...makeAggregate(), schemaVersion: 3 },
  })
  assert.equal(versionChecked.ok, true)
  assert.equal(versionChecked.payload.archiveAggregate, undefined)
  assert.match(versionChecked.payload.archiveAggregateProblems[0], /schemaVersion/)

  // 局部损坏：非有限数字与坏天分桶被逐项纠正，原因可解释（不静默）
  const partialChecked = validateBackupPayload({
    ...legacyPayload,
    archiveAggregate: {
      ...makeAggregate(),
      workouts: {
        ...makeAggregate().workouts,
        floors: 'not-a-number',
        byDay: { '2026-09-14': 'oops', '2026-09-15': { workouts: 1, floors: 15 } },
      },
    },
  })
  assert.equal(partialChecked.ok, true)
  const partial = partialChecked.payload.archiveAggregate
  assert.equal(partial.workouts.floors, 0, '非有限数字按 0 处理')
  assert.deepEqual(partial.workouts.byDay, { '2026-09-15': { workouts: 1, floors: 15 } })
  assert.ok(
    partialChecked.payload.archiveAggregateProblems.some((item) => item.includes('floors')),
    '被纠正的字段必须留下原因',
  )
  assert.ok(
    partialChecked.payload.archiveAggregateProblems.some((item) => item.includes('byDay')),
    '被忽略的天分桶必须留下原因',
  )

  // 非对象字段（例如外部文件写成字符串）
  const stringChecked = validateBackupPayload({ ...legacyPayload, archiveAggregate: 'oops' })
  assert.equal(stringChecked.ok, true)
  assert.equal(stringChecked.payload.archiveAggregate, undefined)
  assert.match(stringChecked.payload.archiveAggregateProblems[0], /不是对象/)
})

// ===========================================================================
// 验收 5：空周/空月/空季仍然出现，标签连续不跳桶
// ===========================================================================

test('D09-5 空桶：空周/空月/空季仍出现（workouts=0），标签连续、月季起点正确', () => {
  const { buildTrend } = load('progress-trends')

  const w38 = makeWorkout({ id: 'w38', startedAt: Date.parse('2026-09-14T00:00:00Z') })
  const w40 = makeWorkout({ id: 'w40', startedAt: Date.parse('2026-09-28T00:00:00Z') })
  const weekPoints = buildTrend([w38, w40], {
    bucket: 'week',
    fromMs: Date.parse('2026-09-14T00:00:00Z'),
    toMs: Date.parse('2026-09-28T12:00:00Z'),
    timeZoneOffsetMinutes: 0,
  })
  assert.deepEqual(
    weekPoints.map((point) => point.label),
    ['2026-W38', '2026-W39', '2026-W40'],
  )
  assert.deepEqual(
    weekPoints.map((point) => point.workouts),
    [1, 0, 1],
  )
  assert.equal(weekPoints[1].floors, 0)
  assert.equal(weekPoints[1].bestRoundMs, undefined)
  assert.deepEqual(weekPoints[1].excluded, { corrected: 0, invalid: 0, duplicate: 0 })
  assert.equal(
    weekPoints[1].bucketStart - weekPoints[0].bucketStart,
    7 * 24 * 60 * 60 * 1000,
  )

  const jan = makeWorkout({ id: 'jan', startedAt: Date.parse('2026-01-10T00:00:00Z') })
  const mar = makeWorkout({ id: 'mar', startedAt: Date.parse('2026-03-10T00:00:00Z') })
  const monthPoints = buildTrend([jan, mar], {
    bucket: 'month',
    fromMs: Date.parse('2026-01-10T00:00:00Z'),
    toMs: Date.parse('2026-03-10T00:00:00Z'),
    timeZoneOffsetMinutes: 0,
  })
  assert.deepEqual(
    monthPoints.map((point) => point.label),
    ['2026-01', '2026-02', '2026-03'],
  )
  assert.deepEqual(
    monthPoints.map((point) => point.bucketStart),
    [Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1), Date.UTC(2026, 2, 1)],
  )
  assert.deepEqual(
    monthPoints.map((point) => point.workouts),
    [1, 0, 1],
  )

  const q1 = makeWorkout({ id: 'q1', startedAt: Date.parse('2026-02-10T00:00:00Z') })
  const q3 = makeWorkout({ id: 'q3', startedAt: Date.parse('2026-08-10T00:00:00Z') })
  const quarterPoints = buildTrend([q1, q3], {
    bucket: 'quarter',
    fromMs: Date.parse('2026-02-10T00:00:00Z'),
    toMs: Date.parse('2026-08-10T00:00:00Z'),
    timeZoneOffsetMinutes: 0,
  })
  assert.deepEqual(
    quarterPoints.map((point) => point.label),
    ['2026-Q1', '2026-Q2', '2026-Q3'],
  )
  assert.deepEqual(
    quarterPoints.map((point) => point.bucketStart),
    [Date.UTC(2026, 0, 1), Date.UTC(2026, 3, 1), Date.UTC(2026, 6, 1)],
  )

  // 反向窗口（fromMs > toMs）与非有限窗口：返回空数组，不抛异常
  assert.deepEqual(
    buildTrend([w38], {
      bucket: 'week',
      fromMs: 10,
      toMs: 1,
      timeZoneOffsetMinutes: 0,
    }),
    [],
  )
  assert.deepEqual(
    buildTrend([w38], {
      bucket: 'week',
      fromMs: Number.NaN,
      toMs: Number.NaN,
      timeZoneOffsetMinutes: 0,
    }),
    [],
  )
})

test('D09-5b recentTrendWindow：窗口端点由桶与 span 决定', () => {
  const { recentTrendWindow, buildTrend } = load('progress-trends')
  const now = Date.parse('2026-09-30T00:00:00Z')
  const weekWindow = recentTrendWindow('week', 3, now, 0)
  assert.equal(weekWindow.toMs, now)
  assert.equal(weekWindow.fromMs, Date.parse('2026-09-14T00:00:00Z'))
  const points = buildTrend([], { bucket: 'week', ...weekWindow, timeZoneOffsetMinutes: 0 })
  assert.deepEqual(
    points.map((point) => point.label),
    ['2026-W38', '2026-W39', '2026-W40'],
  )
  const monthWindow = recentTrendWindow('month', 3, now, TZ_UTC8)
  assert.equal(monthWindow.toMs, now)
  // UTC+8 的 2026-09-30 00:00 是本地 09-30 08:00，往前 2 个月 → 2026-07-01 00:00 (+08)
  assert.equal(monthWindow.fromMs, Date.parse('2026-06-30T16:00:00Z'))
})

// ===========================================================================
// 验收 6：周目标
// ===========================================================================

test('D09-6 周目标：三维度各自判定，未设目标为 undefined 而不是 0', () => {
  const { computeWeekGoal, startOfLocalWeek } = load('progress-trends')
  const now = Date.parse('2026-09-16T04:00:00Z')
  const weekStart = startOfLocalWeek(now)
  const workout = (id, offsetMs, rounds) =>
    makeWorkout({ id, startedAt: weekStart + offsetMs, rounds })
  const workouts = [
    workout('a', 3600000, [makeRound({ durationMs: 200000 })]),
    workout('b', 7200000, [makeRound({ durationMs: 210000, id: 'round-2' })]),
  ]

  const partial = computeWeekGoal(workouts, { targetWorkouts: 2 }, now)
  assert.equal(partial.weekStart, weekStart)
  assert.equal(partial.targetWorkouts, 2)
  assert.equal(partial.targetFloors, undefined, '未设目标必须是 undefined')
  assert.equal(partial.targetAscentM, undefined)
  assert.equal(partial.doneWorkouts, 2)
  assert.equal(partial.doneFloors, 30)
  assert.equal(partial.doneAscentM, 96)
  assert.equal(partial.achieved, true)

  const missed = computeWeekGoal(
    workouts,
    { targetWorkouts: 3, targetFloors: 30, targetAscentM: 100 },
    now,
  )
  assert.equal(missed.doneWorkouts, 2)
  assert.equal(missed.doneFloors, 30)
  assert.equal(missed.achieved, false, '任一已设置维度未达标 → achieved=false')
  assert.equal(missed.targetFloors, 30)
  assert.equal(missed.targetAscentM, 100)

  const met = computeWeekGoal(
    workouts,
    { targetWorkouts: 2, targetFloors: 30, targetAscentM: 96 },
    now,
  )
  assert.equal(met.achieved, true, '三维度全达成 → achieved=true')

  const none = computeWeekGoal(workouts, {}, now)
  assert.equal(none.targetWorkouts, undefined)
  assert.equal(none.targetFloors, undefined)
  assert.equal(none.targetAscentM, undefined)
  assert.equal(none.achieved, false, '没有目标不算达成')

  const zeroTarget = computeWeekGoal(workouts, { targetFloors: 0 }, now)
  assert.equal(zeroTarget.targetFloors, undefined, '0/非法目标视为未设置')

  // 只有本周的记录参与：上周与修正记录都不计入
  const lastWeek = makeWorkout({
    id: 'last-week',
    startedAt: weekStart - 24 * 60 * 60 * 1000,
  })
  const correctedRound = load('corrections').applyRoundCorrection(
    makeRound({ durationMs: 120000 }),
    { finalFloor: 12 },
    { at: 1, id: 'c-1' },
  )
  const correctedThisWeek = workout('corrected', 10800000, [correctedRound])
  const scoped = computeWeekGoal([...workouts, lastWeek, correctedThisWeek], { targetWorkouts: 3 }, now)
  assert.equal(scoped.doneWorkouts, 2, '上周与修正记录不计入本周目标')
  assert.equal(scoped.achieved, false)
})

// ===========================================================================
// 验收 7：旧记录口径与 D06 / 详情一致
// ===========================================================================

test('D09-7 旧记录（缺 corrections/interruptions/plan）不崩，口径与 D06 和详情一致', () => {
  const { buildTrend, isEligibleTrendWorkout } = load('progress-trends')
  const { deriveTrainingProgress, isPersonalBestEligible } = load('training-progress')
  const { calculateWorkoutSummary } = load('workout-summary')

  const startedAt = WEEK_W38_START_UTC8
  // 旧记录：无 corrections、无 interruptions、无 plan、无 completionSource
  const legacyRound = {
    id: 'legacy-round',
    roundNumber: 1,
    startedAt,
    endedAt: startedAt + 300000,
    durationMs: 300000,
    startFloor: 1,
    targetFloor: 16,
    finalFloor: 16,
    // 与 startFloor=1 → finalFloor=16 的「成绩口径」一致（getFloorAchievementCount = 16）
    floorsCompleted: 16,
    ascentM: 48,
    steps: 490,
    confidence: 0.9,
    complete: true,
    completionReason: 'route_complete',
  }
  const legacy = makeWorkout({
    id: 'legacy',
    startedAt,
    endedAt: startedAt + 300000,
    updatedAt: startedAt + 300000,
    rounds: [legacyRound],
  })
  assert.equal('corrections' in legacyRound, false)

  const now = startedAt + 1000
  const points = buildTrend([legacy], {
    bucket: 'week',
    fromMs: startedAt,
    toMs: startedAt + 600000,
    timeZoneOffsetMinutes: 0,
  })
  assert.equal(points[0].workouts, 1)
  assert.equal(points[0].excluded.invalid, 0)

  // 趋势与历史详情（calculateWorkoutSummary）同一楼层口径
  const summary = calculateWorkoutSummary([legacyRound], legacy.startedAt, legacy.endedAt)
  assert.equal(points[0].floors, summary.totalFloors)
  assert.equal(points[0].ascentM, summary.totalAscentM)
  assert.equal(points[0].activeDurationMs, summary.activeDurationMs)
  assert.equal(points[0].bestRoundMs, summary.bestRoundMs)

  // 趋势与 D06 周卡片同一「有效训练」口径
  assert.equal(isEligibleTrendWorkout(legacy), isPersonalBestEligible(legacy))
  const progress = deriveTrainingProgress([legacy], now)
  assert.equal(progress.validWorkouts, points[0].workouts)
  assert.equal(progress.floors, points[0].floors)
  assert.equal(progress.ascentM, points[0].ascentM)
  assert.equal(progress.weekStart, startOfLocalWeekOf(load('training-progress'), now))
  assert.ok(progress.personalBests['route-a'], '旧记录仍可产生路线 PB')

  // 自相矛盾的数据（floorsCompleted=13 但 finalFloor=16）：
  // 趋势取「历史详情口径」（getRoundAchievementCount / calculateWorkoutSummary），与详情逐字相同；
  // D06 周卡片保留它自己的 floorsCompleted 优先口径（旧版「14 段」记录会偏低），
  // 这里把两者差异显式钉住，避免以后被误当成回归。
  const contradictory = makeWorkout({
    id: 'contradictory',
    startedAt: startedAt + 1000,
    rounds: [
      {
        ...legacyRound,
        id: 'contradictory-round',
        finalFloor: 16,
        floorsCompleted: 13,
      },
    ],
  })
  const contradictoryPoints = buildTrend([contradictory], {
    bucket: 'week',
    fromMs: startedAt,
    toMs: startedAt + 600000,
    timeZoneOffsetMinutes: 0,
  })
  const contradictorySummary = calculateWorkoutSummary(
    contradictory.rounds,
    contradictory.startedAt,
    contradictory.endedAt,
  )
  assert.equal(contradictoryPoints[0].floors, contradictorySummary.totalFloors, '楼层数必须与历史详情相同')
  assert.equal(contradictoryPoints[0].floors, 15)
  const contradictoryProgress = deriveTrainingProgress([contradictory], startedAt + 1000)
  assert.equal(contradictoryProgress.validWorkouts, 1)
  // fusion-v1 起统一口径：周卡片与历史详情一致（都按爬升段数），不再保留旧的 floorsCompleted 优先差异。
  assert.equal(
    contradictoryProgress.floors,
    15,
    '周卡片与历史详情同一楼层口径',
  )

  // 明确不会因为缺字段抛异常
  const missingFields = { id: 'sparse', templateId: 'route-a', status: 'completed', startedAt }
  assert.doesNotThrow(() => buildTrend([missingFields], {
    bucket: 'week',
    fromMs: startedAt,
    toMs: startedAt + 600000,
    timeZoneOffsetMinutes: 0,
  }))

  // D06 既有语义回归（不得因为委托新实现而改变）
  const trustworthy = (id, duration, ok = true) => ({
    id,
    templateId: 'route',
    status: 'completed',
    startedAt: now,
    endedAt: now + duration,
    updatedAt: now + duration,
    rounds: [
      {
        ...makeRound({ durationMs: duration }),
        completionReason: 'route_complete',
        confidence: 0.92,
        interruptions: ok ? [] : [{ startMs: 1, endMs: 2 }],
        userCorrectionCount: 0,
      },
    ],
  })
  const regression = deriveTrainingProgress(
    [trustworthy('slow', 60000), trustworthy('best', 50000), trustworthy('bad', 40000, false)],
    now,
  )
  assert.equal(regression.validWorkouts, 2)
  assert.equal(regression.floors, 30)
  assert.equal(regression.personalBests.route.workoutId, 'best')
})

function startOfLocalWeekOf(trainingProgress, atMs) {
  return trainingProgress.startOfLocalWeek(atMs)
}

// ===========================================================================
// 验收 8：展示层无业务口径（静态检查页面只用 core 的纯函数结果）
// ===========================================================================

test('D09-8 History.tsx 只展示 core 计算好的桶与 PB，不重复计算', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'src/pages/History.tsx'), 'utf8')
  assert.ok(source.includes("from '../core/progress-trends'"))
  assert.ok(source.includes('buildTrend('), '趋势必须来自 core.buildTrend')
  assert.ok(source.includes('computeRoutePersonalBests('), 'PB 必须来自 core.computeRoutePersonalBests')
  assert.ok(source.includes('recentTrendWindow('), '窗口端点来自 core.recentTrendWindow')
  assert.ok(source.includes('describeArchiveNotice('), '归档文案来自 core.describeArchiveNotice')
  assert.ok(source.includes('point.label') && source.includes('point.workouts'))
  assert.ok(source.includes('point.excluded.corrected'))
  assert.ok(source.includes('best.bestRoundMs'))
  // 页面不得自己实现统计口径
  for (const forbidden of [
    'startOfLocalWeek',
    'isPersonalBestEligible',
    'isRoundLearnable',
    'calculateWorkoutSummary(',
  ]) {
    if (forbidden === 'calculateWorkoutSummary(') continue // 卡片摘要仍复用该纯函数（既有行为）
    assert.ok(!source.includes(forbidden), `页面不得自行实现口径：${forbidden}`)
  }
})

// ===========================================================================
// 不得静默丢数据：输入去向计数和 == 输入总数
// ===========================================================================

test('D09-audit 输入去向完整可解释：各计数之和等于输入条数', () => {
  const { auditTrend } = load('progress-trends')
  const { applyRoundCorrection } = load('corrections')
  const base = WEEK_W38_START_UTC8
  const correctedRound = applyRoundCorrection(
    makeRound({ durationMs: 150000 }),
    { finalFloor: 12 },
    { at: 1, id: 'c-1' },
  )
  const mixed = [
    makeWorkout({ id: 'valid-1', startedAt: base }),
    makeWorkout({ id: 'dup', startedAt: base, updatedAt: base }),
    makeWorkout({ id: 'dup', startedAt: base + 1, updatedAt: base + 100000 }),
    makeWorkout({ id: 'corrected', startedAt: base + 2, rounds: [correctedRound] }),
    makeWorkout({ id: 'planned', startedAt: base + 3, status: 'planned' }),
    makeWorkout({ id: 'outside', startedAt: base - 30 * 24 * 60 * 60 * 1000 }),
    makeWorkout({ id: 'no-time', startedAt: 0, endedAt: 0, updatedAt: 0, createdAt: 0 }),
    {},
    null,
  ]
  const audit = auditTrend(mixed, {
    bucket: 'week',
    fromMs: base,
    toMs: base + 600000,
    timeZoneOffsetMinutes: 0,
  })
  const accounted =
    audit.counted +
    audit.excluded.corrected +
    audit.excluded.invalid +
    audit.excluded.duplicate +
    audit.unknownRecords +
    audit.unbucketed +
    audit.outsideRange +
    audit.truncatedInWindow
  assert.equal(audit.inputCount, mixed.length)
  assert.equal(accounted, mixed.length, '每一条输入都必须落在某个计数里')
  assert.equal(audit.unknownRecords, 2)
  assert.equal(audit.unbucketed, 1)
  assert.equal(audit.outsideRange, 1)
  assert.equal(audit.excluded.duplicate, 1)
  assert.equal(audit.excluded.corrected, 1)
  assert.equal(audit.excluded.invalid, 1)
  assert.equal(audit.counted, 2, 'valid-1 与 dup 的幸存副本各计一次')
  assert.equal(audit.truncated, false)
  assert.equal(audit.truncatedInWindow, 0)

  // 逐桶计数之和必须等于审计给出的窗口内计数
  const sum = (pick) => audit.points.reduce((total, point) => total + pick(point), 0)
  assert.equal(sum((point) => point.workouts), audit.counted)
  assert.equal(sum((point) => point.excluded.corrected), audit.excluded.corrected)
  assert.equal(sum((point) => point.excluded.invalid), audit.excluded.invalid)
  assert.equal(sum((point) => point.excluded.duplicate), audit.excluded.duplicate)
})

// ===========================================================================
// 验收 4c 端到端：导出（带归档聚合）→ 新设备恢复 → summarize() 长期统计不丢失
// ===========================================================================

test('D09-4c-e2e 新设备恢复归档聚合后 summarize() 的长期统计不丢失（旧备份会少）', async () => {
  const { validateBackupPayload } = load('backup-payload')
  const repository = loadRepository()
  const {
    historyRepository,
    readHistoryRawKey,
    writeHistoryRawKey,
    HISTORY_AGG_KEY,
    HISTORY_WORKOUTS_KEY,
    __resetHistoryRepositoryForTests,
  } = repository
  const DAY_MS = 24 * 60 * 60 * 1000
  const firstAt = Date.parse('2026-01-01T02:00:00Z')

  const freshDevice = () => {
    storageStore.clear()
    __resetHistoryRepositoryForTests()
  }

  // 设备 A：写入 105 条（容量 100 → 5 条被裁剪进归档聚合）
  freshDevice()
  for (let index = 0; index < 105; index += 1) {
    const startedAt = firstAt + index * DAY_MS
    await historyRepository.saveWorkout(
      makeWorkout({
        id: `w-${index}`,
        startedAt,
        endedAt: startedAt + 200000,
        updatedAt: startedAt + 200000,
      }),
    )
  }
  const before = await historyRepository.summarize()
  assert.equal(before.workoutCount, 105)
  assert.equal(before.trimmedTotal, 5)
  assert.equal(before.retainedWorkoutCount, 100)
  assert.equal(before.aggregatesIncludeTrimmed, true)
  assert.equal(before.totalFloors, 105 * 16)
  assert.equal(before.totalAscentM, 105 * 48)
  assert.equal(before.totalActiveDurationMs, 105 * 200000)
  assert.equal(Object.keys(before.byDay).length, 105)

  // 导出：归档聚合必须进备份（D09 新增的可选字段），旧字段一个不动
  const aggregateRaw = await readHistoryRawKey(HISTORY_AGG_KEY)
  const workoutsRaw = await readHistoryRawKey(HISTORY_WORKOUTS_KEY)
  assert.ok(aggregateRaw, '聚合账本键必须存在')
  const exported = {
    version: 2,
    exportedAt: Date.parse('2026-06-01T00:00:00Z'),
    routes: [],
    sessions: [],
    workouts: JSON.parse(workoutsRaw),
    archiveAggregate: JSON.parse(aggregateRaw),
  }
  const checked = validateBackupPayload(JSON.parse(JSON.stringify(exported)))
  assert.equal(checked.ok, true)
  assert.equal(checked.payload.archiveAggregate.workouts.trimmedTotal, 5)
  assert.equal(checked.payload.archiveAggregate.workouts.floors, 5 * 16)

  // 设备 B（新设备）：只写入聚合键 + 保留明细（＝ importRawData 的写入内容）
  freshDevice()
  await writeHistoryRawKey(
    HISTORY_AGG_KEY,
    JSON.stringify(checked.payload.archiveAggregate),
  )
  await writeHistoryRawKey(HISTORY_WORKOUTS_KEY, JSON.stringify(checked.payload.workouts))
  const restored = await historyRepository.summarize()
  assert.equal(restored.workoutCount, before.workoutCount, '累计训练次数不丢')
  assert.equal(restored.totalFloors, before.totalFloors, '楼层不丢（含被归档的 5 条）')
  assert.equal(restored.totalAscentM, before.totalAscentM, '爬升不丢')
  assert.equal(restored.totalActiveDurationMs, before.totalActiveDurationMs, '净时长不丢')
  assert.deepEqual(restored.byDay, before.byDay, '按天分桶不丢')
  assert.equal(restored.trimmedTotal, 5)
  assert.equal(restored.retainedWorkoutCount, 100)
  assert.equal(restored.aggregatesIncludeTrimmed, true)

  // 反向对照：旧备份（没有该字段）恢复后退化为只看保留明细 —— 正是要修的丢失
  freshDevice()
  await writeHistoryRawKey(HISTORY_WORKOUTS_KEY, JSON.stringify(checked.payload.workouts))
  const legacyRestored = await historyRepository.summarize()
  assert.equal(legacyRestored.workoutCount, 100, '旧备份恢复只有保留明细')
  assert.equal(legacyRestored.trimmedTotal, 0)
  assert.equal(legacyRestored.totalFloors, 100 * 16)
  assert.equal(
    restored.totalFloors - legacyRestored.totalFloors,
    5 * 16,
    '差别正是被归档记录的贡献（携带聚合字段后才不丢）',
  )
})
