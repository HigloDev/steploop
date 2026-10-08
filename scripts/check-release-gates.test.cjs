// D01 门禁自测：逐条覆盖 D01_CONTRACT.md §验收 的 11 个案例 + 覆盖率矩阵/版本/分母边界。
//
// 运行（零依赖，直接跑）：
//   node scripts/check-release-gates.test.cjs
//
// 夹具全部生成在系统临时目录，测试结束即删除，不新增仓库内数据文件。
// 每条断言都真实 spawn scripts/check-release-gates.cjs 并检查退出码与 stderr 文案，
// 不使用 skip/todo/exclude：任何一个案例被删掉都会直接少一条测试。

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const gate = require('./check-release-gates.cjs')
const fixtures = require('./make-gate-fixtures.cjs')

const gatePath = path.join(__dirname, 'check-release-gates.cjs')
const fixturesPath = path.join(__dirname, 'make-gate-fixtures.cjs')
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd01-gate-fixtures-'))
const cases = fixtures.writeFixtures(outDir)
const casesByName = new Map(cases.map((item) => [item.name, item]))

function runGate(reportPath) {
  return spawnSync(process.execPath, [gatePath, reportPath], {
    encoding: 'utf8',
  })
}

function runGateWithEnv(reportPath, env) {
  return spawnSync(process.execPath, [gatePath, reportPath], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

/** 造一个只含 src/core 两个常量文件的临时源码根（不改仓库 src/）。 */
function makeTemporarySourceRoot(targetDir, { diagnosticAlgorithm } = {}) {
  const coreDir = path.join(targetDir, 'src', 'core')
  fs.mkdirSync(coreDir, { recursive: true })
  const repo = path.join(__dirname, '..')
  for (const name of ['diagnostics.ts', 'route-model.ts']) {
    fs.copyFileSync(
      path.join(repo, 'src', 'core', name),
      path.join(coreDir, name),
    )
  }
  if (diagnosticAlgorithm) {
    const file = path.join(coreDir, 'diagnostics.ts')
    const text = fs.readFileSync(file, 'utf8')
    const patched = text.replace(
      /(export\s+const\s+DIAGNOSTIC_ALGORITHM_VERSION\s*=\s*')[^']*(')/,
      `$1${diagnosticAlgorithm}$2`,
    )
    assert.notEqual(patched, text, '未能在临时源码副本里替换常量')
    fs.writeFileSync(file, patched, 'utf8')
  }
  return targetDir
}

function describeResult(result) {
  return `exit=${result.status}\n--- stdout ---\n${result.stdout}--- stderr ---\n${result.stderr}`
}

test.after(() => {
  fs.rmSync(outDir, { recursive: true, force: true })
})

// === 案例表自检：夹具生成器必须真的产出全部案例 ===
test('夹具生成：覆盖 11 个验收案例与边界，且无同名冲突', () => {
  assert.ok(cases.length >= 11, `夹具数量 ${cases.length} < 11`)
  assert.equal(new Set(cases.map((item) => item.name)).size, cases.length)
  for (const item of cases) {
    assert.ok(fs.existsSync(item.reportPath), `缺少报告：${item.reportPath}`)
    assert.ok([0, 1].includes(item.expectExit))
  }
  for (const required of [
    'complete-real',
    'perfect-summary-only',
    'synthetic-complete',
    'cohorts-device-empty',
    'negative-elevator-down-19',
    'routes-9',
    'device-rate-090',
    'manifest-hash-mismatch',
    'algorithm-version-mismatch',
    'mixed-algorithm-versions',
    'eligible-bundles-zero',
  ]) {
    assert.ok(casesByName.has(required), `缺少验收案例：${required}`)
  }
})

// === 逐案例：退出码 + stderr 文案 ===
for (const item of cases) {
  test(`gate: ${item.name} → 退出码 ${item.expectExit}`, () => {
    const result = runGate(item.reportPath)
    assert.equal(result.status, item.expectExit, describeResult(result))
    for (const needle of item.stderrIncludes) {
      assert.ok(
        result.stderr.includes(needle),
        `stderr 未包含 ${JSON.stringify(needle)}\n${describeResult(result)}`,
      )
    }
    for (const needle of item.stdoutIncludes) {
      assert.ok(
        result.stdout.includes(needle),
        `stdout 未包含 ${JSON.stringify(needle)}\n${describeResult(result)}`,
      )
    }
    if (item.expectExit === 1) {
      // 失败时必须逐条列出，不能只给一句“未通过”
      assert.ok(
        /可信训练版发布门禁未通过（\d+ 项）：/.test(result.stderr),
        describeResult(result),
      )
    }
  })
}

// === 验收 1 的核心主张：旧实现确实会放过人工 JSON（行为已改变） ===
test('回归对照：基线 f60b50a 的旧 gate 对 perfect-summary-only 通过（退出码 0）', () => {
  // Keep the exact historical implementation as a fixture so source ZIPs and
  // shallow clones exercise the regression without requiring private Git history.
  const oldSource = fs.readFileSync(path.join(__dirname, 'fixtures', 'release-gate-f60b50a.cjs'), 'utf8')
  const oldPath = path.join(outDir, 'old-check-release-gates.cjs')
  fs.writeFileSync(oldPath, oldSource, 'utf8')
  const target = casesByName.get('perfect-summary-only').reportPath
  const result = spawnSync(process.execPath, [oldPath, target], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, describeResult(result))
  assert.ok(result.stdout.includes('门禁通过'), describeResult(result))
  // 同一个输入在新实现下必须失败（退出码 1）
  const hardened = runGate(target)
  assert.equal(hardened.status, 1, describeResult(hardened))
})

// === 源码常量与编译产物一致性 ===
test('算法版本常量：编译产物 + 源码文本 + 冗余声明三方一致', () => {
  const loaded = gate.loadSourceConstants()
  assert.deepEqual(loaded.failures, [])
  assert.deepEqual(loaded.constants, fixtures.SOURCE_CONSTANTS)
  assert.deepEqual(loaded.constants, {
    algorithm: 'motion-v3',
    diagnosticAlgorithm: 'motion-v3',
    bundle: 2,
    routeModel: 3,
    parameter: 'motion-trend-1',
  })
  assert.ok(
    loaded.notes.some((note) => note.includes('编译产物')),
    JSON.stringify(loaded.notes),
  )
  assert.ok(
    loaded.notes.some((note) => note.includes('源码文本')),
    JSON.stringify(loaded.notes),
  )
})

// === D01-FIX1：常量来源 fail-closed（禁止用脚本内冗余声明单独放行） ===

test('常量来源：编译产物缺失、源码可用 → 仍可通过（源码解析路径生效，真实 spawn）', () => {
  const missingRoot = path.join(outDir, 'no-such-compiled-root')
  const result = runGateWithEnv(
    casesByName.get('complete-real').reportPath,
    { [gate.COMPILED_ROOT_ENV]: missingRoot },
  )
  assert.equal(result.status, 0, describeResult(result))
  assert.ok(result.stdout.includes('RELEASE_READY'), describeResult(result))
  assert.ok(
    result.stderr.includes('编译产物不可用'),
    describeResult(result),
  )
  assert.ok(
    result.stderr.includes('源码文本'),
    describeResult(result),
  )
})

test('常量来源：编译产物与源码都不可用 → 必须失败（真实 spawn）', () => {
  const emptyCompiled = path.join(outDir, 'empty-compiled')
  const emptySource = path.join(outDir, 'empty-source')
  fs.mkdirSync(emptyCompiled, { recursive: true })
  fs.mkdirSync(emptySource, { recursive: true })
  const result = runGateWithEnv(
    casesByName.get('complete-real').reportPath,
    {
      [gate.COMPILED_ROOT_ENV]: emptyCompiled,
      [gate.SOURCE_ROOT_ENV]: emptySource,
    },
  )
  assert.equal(result.status, 1, describeResult(result))
  assert.ok(
    result.stderr.includes('算法版本常量来源不可用'),
    describeResult(result),
  )
  assert.ok(result.stderr.includes('源码文本'), describeResult(result))
  assert.ok(!result.stdout.includes('RELEASE_READY'), describeResult(result))
})

test('常量来源：源码文本被改到与编译产物不一致 → 必须失败（真实 spawn，仅用临时副本）', () => {
  const tampered = makeTemporarySourceRoot(path.join(outDir, 'tampered-source'), {
    diagnosticAlgorithm: 'trusted-v9.9.9',
  })
  const realSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'core', 'diagnostics.ts'),
    'utf8',
  )
  const tamperedText = fs.readFileSync(
    path.join(tampered, 'src', 'core', 'diagnostics.ts'),
    'utf8',
  )
  assert.notEqual(tamperedText, realSource, '临时副本必须与仓库源码不同')
  const result = runGateWithEnv(
    casesByName.get('complete-real').reportPath,
    { [gate.SOURCE_ROOT_ENV]: tampered },
  )
  assert.equal(result.status, 1, describeResult(result))
  assert.ok(
    result.stderr.includes('算法版本常量来源冲突'),
    describeResult(result),
  )
  assert.ok(
    result.stderr.includes('trusted-v9.9.9'),
    describeResult(result),
  )
  // 仓库源码未被本次测试修改
  assert.equal(
    fs.readFileSync(
      path.join(__dirname, '..', 'src', 'core', 'diagnostics.ts'),
      'utf8',
    ),
    realSource,
  )
})

test('常量来源 d：源码常量改名（临时副本）+ 编译产物可用 → 必须失败（决策 2）', () => {
  const renamed = makeTemporarySourceRoot(path.join(outDir, 'renamed-source'))
  const file = path.join(renamed, 'src', 'core', 'diagnostics.ts')
  const text = fs
    .readFileSync(file, 'utf8')
    .replace('DIAGNOSTIC_BUNDLE_VERSION =', 'DIAGNOSTIC_BUNDLE_VERSION_X =')
  fs.writeFileSync(file, text, 'utf8')
  const repoSourceHash = gate.sha256Hex(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'diagnostics.ts')),
  )
  const result = runGateWithEnv(
    casesByName.get('complete-real').reportPath,
    { [gate.SOURCE_ROOT_ENV]: renamed },
  )
  // 编译产物可用也不能放行：源码文本是唯一必需的核对来源
  assert.equal(result.status, 1, describeResult(result))
  assert.ok(result.stderr.includes('源码文本'), describeResult(result))
  assert.ok(
    result.stderr.includes('DIAGNOSTIC_BUNDLE_VERSION'),
    describeResult(result),
  )
  assert.ok(
    result.stderr.includes(
      '算法版本常量来源不可用：源码文本中找不到 DIAGNOSTIC_BUNDLE_VERSION（src/core/diagnostics.ts）',
    ),
    describeResult(result),
  )
  assert.ok(!result.stdout.includes('RELEASE_READY'), describeResult(result))
  // 仓库 src 未被本次测试修改
  assert.equal(
    gate.sha256Hex(
      fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'diagnostics.ts')),
    ),
    repoSourceHash,
  )
})

test('常量来源 e：源码与编译产物都可用且一致 → 退出码 0（回归，note 列出来源）', () => {
  const result = runGateWithEnv(
    casesByName.get('complete-real').reportPath,
    {
      [gate.COMPILED_ROOT_ENV]: gate.DEFAULT_COMPILED_ROOT,
      [gate.SOURCE_ROOT_ENV]: path.join(__dirname, '..'),
    },
  )
  assert.equal(result.status, 0, describeResult(result))
  assert.ok(result.stdout.includes('RELEASE_READY'), describeResult(result))
  // note 必须点名来源，防止后续退化成只有手抄表
  assert.ok(result.stderr.includes('源码文本'), describeResult(result))
  assert.ok(result.stderr.includes('编译产物'), describeResult(result))
  assert.ok(result.stderr.includes('冗余声明'), describeResult(result))
})

test('常量来源：两来源都不可用时，门禁核心也不得回退冗余声明', () => {
  const loaded = gate.loadSourceConstants({
    compiledRoot: path.join(outDir, 'no-such-compiled-root-2'),
    sourceRoot: path.join(outDir, 'no-such-source-root-2'),
  })
  assert.equal(loaded.constants, null)
  assert.equal(loaded.failures.length, 1)
  assert.ok(
    loaded.failures[0].includes('算法版本常量来源不可用'),
    loaded.failures[0],
  )
  assert.ok(loaded.failures[0].includes('源码文本'), loaded.failures[0])
  // checkReport 在拿不到已核对常量时必须直接失败，而不是用脚本内常量表兜底
  const checked = gate.checkReport(
    JSON.parse(
      fs.readFileSync(casesByName.get('complete-real').reportPath, 'utf8'),
    ),
    {},
  )
  assert.equal(checked.passed, false)
  assert.ok(
    checked.failures.some((failure) =>
      failure.includes('算法版本常量来源不可用'),
    ),
    JSON.stringify(checked.failures),
  )
})

test('常量来源：交叉核对逻辑（纯函数，含来源缺失/声明漂移路径）', () => {
  const declared = { ...fixtures.SOURCE_CONSTANTS }
  const agree = gate.crossCheckConstants({
    compiled: declared,
    source: declared,
    declared,
    compiledRoot: 'c',
    sourceRoot: 's',
  })
  assert.deepEqual(agree.failures, [])
  assert.deepEqual(agree.constants, declared)

  const sourceOnly = gate.crossCheckConstants({
    compiled: null,
    compiledReason: 'no cache',
    source: declared,
    declared,
    compiledRoot: 'c',
    sourceRoot: 's',
  })
  assert.deepEqual(sourceOnly.failures, [])
  // 编译产物缺失不判失败，但 note 必须列出实际来源与缺失原因（决策 5）
  assert.ok(sourceOnly.notes[0].includes('源码文本'), sourceOnly.notes[0])
  assert.ok(sourceOnly.notes[0].includes('冗余声明'), sourceOnly.notes[0])
  assert.ok(sourceOnly.notes[0].includes('编译产物不可用'), sourceOnly.notes[0])

  const bothPresent = gate.crossCheckConstants({
    compiled: declared,
    source: declared,
    declared,
    compiledRoot: 'c',
    sourceRoot: 's',
  })
  assert.ok(bothPresent.notes[0].includes('源码文本'), bothPresent.notes[0])
  assert.ok(bothPresent.notes[0].includes('编译产物'), bothPresent.notes[0])

  const sourceVsCompiled = gate.crossCheckConstants({
    compiled: { ...declared, bundle: 1 },
    source: declared,
    declared,
    compiledRoot: 'c',
    sourceRoot: 's',
  })
  // 两条独立证据：来源间冲突 + 冗余声明与编译产物冲突
  assert.equal(sourceVsCompiled.failures.length, 2)
  assert.ok(sourceVsCompiled.failures[0].includes('算法版本常量来源冲突'))
  assert.ok(sourceVsCompiled.failures[1].includes('算法版本常量冲突'))

  const declaredDrift = gate.crossCheckConstants({
    compiled: declared,
    source: declared,
    declared: { ...declared, parameter: 'evidence-9' },
    compiledRoot: 'c',
    sourceRoot: 's',
  })
  assert.equal(declaredDrift.failures.length, 2)
  for (const failure of declaredDrift.failures) {
    assert.ok(failure.includes('算法版本常量冲突'), failure)
  }

  // 决策 2：源码文本缺失时，即使编译产物可用也必须失败
  const issue = '算法版本常量来源不可用：源码文本中找不到 X（src/core/x.ts）'
  const sourceMissingWithCompiled = gate.crossCheckConstants({
    compiled: declared,
    source: null,
    sourceIssue: issue,
    declared,
    compiledRoot: 'c',
    sourceRoot: 's',
  })
  assert.equal(sourceMissingWithCompiled.failures.length, 1)
  assert.equal(sourceMissingWithCompiled.failures[0], issue)

  const nothing = gate.crossCheckConstants({
    compiled: null,
    source: null,
    sourceIssue: issue,
    declared,
    compiledRoot: 'c',
    sourceRoot: 's',
  })
  assert.equal(nothing.constants, null)
  assert.equal(nothing.failures.length, 1)
  assert.equal(nothing.failures[0], issue)

  // 没有具体 issue 时也要有兜底失败文案（不得静默）
  const noIssue = gate.crossCheckConstants({
    compiled: null,
    source: null,
    sourceIssue: null,
    declared,
    compiledRoot: 'c',
    sourceRoot: 's',
  })
  assert.equal(noIssue.failures.length, 1)
  assert.ok(noIssue.failures[0].includes('算法版本常量来源不可用'))
  assert.ok(noIssue.failures[0].includes('源码文本'))
})

test('源码常量解析：正则确实从 src 的 .ts 读出五个常量；改名/缺失可被识别', () => {
  const parsed = gate.readSourceConstants(path.join(__dirname, '..'))
  assert.deepEqual(parsed.missing, [])
  assert.equal(parsed.invalid, null)
  assert.equal(parsed.unreadable, null)
  assert.deepEqual(parsed.constants, fixtures.SOURCE_CONSTANTS)

  const compiled = gate.readCompiledConstants(gate.DEFAULT_COMPILED_ROOT)
  assert.equal(compiled.error, null, compiled.error)
  assert.deepEqual(compiled.constants, fixtures.SOURCE_CONSTANTS)

  const renamedRoot = makeTemporarySourceRoot(path.join(outDir, 'parse-renamed'))
  const renamedFile = path.join(renamedRoot, 'src', 'core', 'diagnostics.ts')
  fs.writeFileSync(
    renamedFile,
    fs
      .readFileSync(renamedFile, 'utf8')
      .replace('DIAGNOSTIC_BUNDLE_VERSION =', 'DIAGNOSTIC_BUNDLE_VERSION_X ='),
    'utf8',
  )
  const renamed = gate.readSourceConstants(renamedRoot)
  assert.equal(renamed.constants, null)
  assert.deepEqual(renamed.missing, [
    { name: 'DIAGNOSTIC_BUNDLE_VERSION', file: 'src/core/diagnostics.ts' },
  ])
  assert.ok(
    gate
      .describeSourceIssue(renamed, renamedRoot)
      .includes(
        '源码文本中找不到 DIAGNOSTIC_BUNDLE_VERSION（src/core/diagnostics.ts）',
      ),
    gate.describeSourceIssue(renamed, renamedRoot),
  )

  const emptyRoot = path.join(outDir, 'parse-empty')
  fs.mkdirSync(emptyRoot, { recursive: true })
  const empty = gate.readSourceConstants(emptyRoot)
  assert.equal(empty.constants, null)
  assert.ok(empty.unreadable !== null)
  assert.ok(
    gate.describeSourceIssue(empty, emptyRoot).includes('源码文本不可读'),
    gate.describeSourceIssue(empty, emptyRoot),
  )
})

// === canonicalHash 口径：门禁与夹具生成器独立实现必须一致 ===
test('内容 hash 口径：门禁与夹具生成器实现一致', () => {
  const sample = {
    manifestVersion: 1,
    files: [{ b: 2, a: [1, { z: 'x', y: null }] }],
  }
  assert.equal(gate.canonicalHash(sample), fixtures.canonicalHash(sample))
  assert.equal(
    gate.canonicalHash(sample),
    gate.sha256Hex(Buffer.from(gate.stableStringify(sample), 'utf8')),
  )
})

// === 推导逻辑交叉验证：门禁与夹具的覆盖率推导结论一致 ===
test('覆盖率推导：门禁与夹具生成器对同一 manifest 得到相同结论', () => {
  const manifest = fixtures.buildManifest({})
  const derived = gate.deriveFromManifest(manifest.files)
  const expected = fixtures.deriveCoverage(manifest.files)
  assert.equal(derived.eligibleBundles, expected.eligibleBundles)
  assert.equal(derived.climbBundles, expected.climbBundles)
  assert.equal(derived.negativeBundles, expected.negativeBundles)
  assert.deepEqual(derived.routes, expected.routes)
  assert.deepEqual(derived.devices, expected.devices)
  assert.deepEqual(derived.brands, expected.brands)
  assert.deepEqual(derived.participants, expected.participants)
  assert.deepEqual(derived.carryModes, expected.carryModes)
  assert.deepEqual(derived.barometer, expected.barometer)
  assert.deepEqual(derived.climbSamplesPerRoute, expected.climbSamplesPerRoute)
  assert.deepEqual(derived.negativeSamplesByKind, expected.negativeSamplesByKind)
})

// === 正向夹具确实达标（防止夹具被悄悄弱化） ===
test('正向夹具：complete-real 满足全部覆盖门槛与分母', () => {
  const report = JSON.parse(
    fs.readFileSync(casesByName.get('complete-real').reportPath, 'utf8'),
  )
  const derived = gate.deriveFromManifest(report.datasetManifest.files)
  assert.ok(derived.routes.length >= gate.THRESHOLDS.coverageRoutes)
  assert.ok(derived.devices.length >= gate.THRESHOLDS.coverageDevices)
  assert.ok(derived.brands.length >= gate.THRESHOLDS.coverageBrands)
  assert.ok(derived.participants.length >= gate.THRESHOLDS.coverageParticipants)
  assert.deepEqual(derived.carryModes, ['pocket', 'waist'])
  assert.deepEqual(derived.barometer, ['available', 'unavailable'])
  for (const routeId of derived.routes) {
    assert.ok(
      derived.climbSamplesPerRoute[routeId] >=
        gate.THRESHOLDS.climbSamplesPerRoute,
      `${routeId} 正样本不足`,
    )
  }
  for (const kind of gate.REQUIRED_NEGATIVE_KINDS) {
    assert.ok(
      derived.negativeSamplesByKind[kind] >=
        gate.THRESHOLDS.negativeSamplesPerKind,
      `${kind} 负样本不足`,
    )
  }
  assert.ok(derived.eligibleBundles >= 1)
  assert.ok(derived.climbBundles >= 1)
  assert.ok(derived.negativeBundles >= 1)
  assert.equal(report.provenance.kind, 'real')
  assert.ok(
    report.provenance.verification &&
      report.provenance.verification.reviewer &&
      report.provenance.verification.method,
  )
})

// === 数值门槛不得被下调（防止后续“顺手放宽”） ===
test('数值门槛：保持基线值，未下调', () => {
  assert.equal(gate.THRESHOLDS.exactFinalFloorRate, 0.98)
  assert.equal(gate.THRESHOLDS.floorEventPrecision, 0.96)
  assert.equal(gate.THRESHOLDS.floorEventRecall, 0.96)
  assert.equal(gate.THRESHOLDS.maximumNegativeFalsePositiveRate, 0.01)
  assert.equal(gate.THRESHOLDS.maximumMedianFloorLatencyMs, 2000)
  assert.equal(gate.THRESHOLDS.maximumP95FloorLatencyMs, 4000)
  assert.equal(gate.THRESHOLDS.cohortExactFinalFloorRate, 0.96)
  assert.equal(gate.THRESHOLDS.maximumCohortFalsePositiveRate, 0.02)
  assert.equal(gate.THRESHOLDS.coverageRoutes, 10)
  assert.equal(gate.THRESHOLDS.coverageDevices, 5)
  assert.equal(gate.THRESHOLDS.coverageBrands, 3)
  assert.equal(gate.THRESHOLDS.coverageParticipants, 5)
  assert.equal(gate.THRESHOLDS.climbSamplesPerRoute, 10)
  assert.equal(gate.THRESHOLDS.negativeSamplesPerKind, 20)
})

// === CLI 用法/IO 错误：退出码 2 ===
test('CLI：无参数 → 退出码 2 + 用法提示', () => {
  const result = spawnSync(process.execPath, [gatePath], { encoding: 'utf8' })
  assert.equal(result.status, 2, describeResult(result))
  assert.ok(result.stderr.includes('用法'), describeResult(result))
})

test('CLI：报告文件不存在 → 退出码 2', () => {
  const result = runGate(path.join(outDir, 'no-such-report.json'))
  assert.equal(result.status, 2, describeResult(result))
  assert.ok(result.stderr.includes('报告读取失败'), describeResult(result))
})

test('CLI：报告不是合法 JSON → 退出码 2', () => {
  const broken = path.join(outDir, 'broken.json')
  fs.writeFileSync(broken, '{ not json', 'utf8')
  const result = runGate(broken)
  assert.equal(result.status, 2, describeResult(result))
})

// === 手工夹具生成 CLI（契约里的命令） ===
test('CLI：make-gate-fixtures --out <目录> 可独立生成夹具', () => {
  const target = path.join(outDir, 'cli-out')
  const result = spawnSync(
    process.execPath,
    [fixturesPath, '--out', target],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, describeResult(result))
  assert.ok(fs.existsSync(path.join(target, 'complete-real.json')))
  // F15 起，每个用例的 manifest 与数据集文件放在自己的子目录里（避免用例之间互相覆盖）。
  assert.ok(
    fs.existsSync(
      path.join(target, 'complete-real', 'manifest.json'),
    ),
  )
  // 数据集文件实体必须真的落盘，否则门禁的逐字节校验无从谈起。
  assert.ok(fs.existsSync(path.join(target, 'complete-real', 'bundle-00.json')))
  const gateResult = runGate(path.join(target, 'complete-real.json'))
  assert.equal(gateResult.status, 0, describeResult(gateResult))
  assert.ok(gateResult.stdout.includes('RELEASE_READY'), describeResult(gateResult))
})

// === 畸形输入：必须干净失败（退出码 1 + 逐条列出），不能抛异常栈 ===
test('畸形报告：一律退出码 1、逐条列出且无异常栈', () => {
  const shapes = [
    null,
    [],
    'str',
    42,
    {
      coverage: 5,
      cohorts: [],
      datasetManifest: { files: 'x', manifestVersion: '1' },
      provenance: 3,
      algorithmVersions: [],
      eligibleBundles: '1',
      generatedAt: 123,
    },
    {
      provenance: {
        kind: 'real',
        manifestPath: 5,
        manifestSha256: null,
        datasetManifestSha256: 42,
        collectorOwner: '',
        verification: 7,
      },
      datasetManifest: { manifestVersion: 1, files: [null, 5, { file: 'a' }] },
      coverage: {
        routes: '10',
        devices: null,
        carryModes: 'pocket',
        barometer: {},
        climbSamplesPerRoute: [],
        negativeSamplesByKind: [],
      },
      cohorts: {
        deviceCohort: { g: null },
        carryMode: [],
        barometer: 5,
        activity: {},
        platform: {},
        routeStructure: {},
      },
    },
  ]
  shapes.forEach((shape, index) => {
    const malformed = path.join(outDir, `malformed-${index}.json`)
    fs.writeFileSync(malformed, JSON.stringify(shape), 'utf8')
    const result = runGate(malformed)
    assert.equal(result.status, 1, describeResult(result))
    assert.ok(
      !/(TypeError|ReferenceError|SyntaxError|Node\.js v\d)/.test(result.stderr),
      describeResult(result),
    )
    assert.ok(
      /可信训练版发布门禁未通过（\d+ 项）：/.test(result.stderr),
      describeResult(result),
    )
  })
})

// === 真实回放链路的结构缺口：replay 补字段前的 manifest 形态无法满足 gate（fail-closed 证据） ===
test('真实链路缺口：manifest 缺采集元数据时 gate 必须失败', () => {
  const reportPath = casesByName.get('complete-real').reportPath
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  // 只保留 file/sha256/bundleId/sampleQuality 的最小 manifest 条目形态
  report.datasetManifest.files = report.datasetManifest.files.map((entry) => ({
    file: entry.file,
    bundleId: entry.bundleId,
    sha256: entry.sha256,
    sampleQuality: entry.sampleQuality,
  }))
  const stripped = path.join(outDir, 'replay-shaped-report.json')
  fs.writeFileSync(stripped, JSON.stringify(report, null, 2), 'utf8')
  const result = runGate(stripped)
  assert.equal(result.status, 1, describeResult(result))
  assert.ok(
    result.stderr.includes('datasetManifest.files[0].deviceBrand: 缺失或为空'),
    describeResult(result),
  )
  assert.ok(
    result.stderr.includes('datasetManifest.files[0].participantId: 缺失或为空'),
    describeResult(result),
  )
})
