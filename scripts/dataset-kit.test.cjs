// D12 采集作业包（dataset-kit）的自动化验收。
//
// 这些用例证明的是「流程工具链可用」，**不是**算法准确率证据：
// 夹具全部是合成数据，真实数据集必须由真人采集（见 docs/dsh-handoff/D12_COLLECTION_KIT.md）。
//
// 用法：node --test scripts/dataset-kit.test.cjs

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

const kitPath = path.join(__dirname, 'dataset-kit.cjs')
const gatePath = path.join(__dirname, 'check-release-gates.cjs')
const fixtures = require('./make-gate-fixtures.cjs')
const gate = require('./check-release-gates.cjs')

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd12-kit-'))

function runKit(args, options = {}) {
  return spawnSync(process.execPath, [kitPath, ...args], {
    encoding: 'utf8',
    ...options,
  })
}

function runGate(reportPath) {
  return spawnSync(process.execPath, [gatePath, reportPath], { encoding: 'utf8' })
}

/** 构造一份「覆盖率刚好达标」的合成 manifest（不含真实数据）。 */
function buildAdequateManifest() {
  const files = []
  let index = 0
  const participants = ['p01', 'p02', 'p03', 'p04', 'p05']
  const brands = ['xiaomi', 'samsung', 'oneplus']
  const routes = Array.from(
    { length: gate.THRESHOLDS.coverageRoutes },
    (_, r) => `route-${String(r + 1).padStart(2, '0')}`,
  )
  const push = (routeId, activity) => {
    const n = index
    index += 1
    files.push({
      file: `bundle-${String(n).padStart(3, '0')}.json`,
      bundleId: `bundle-${String(n).padStart(3, '0')}`,
      sha256: 'a'.repeat(64),
      sampleQuality: 'valid',
      activity,
      carryMode: n % 2 ? 'pocket' : 'waist',
      barometerAvailable: n % 3 !== 0,
      routeStructure: 'standard',
      deviceCohortId: `device-0${(n % gate.THRESHOLDS.coverageDevices) + 1}`,
      deviceBrand: brands[n % brands.length],
      participantId: participants[n % participants.length],
      platform: 'android',
      routeId,
      bundleVersion: 2,
      algorithmVersion: 'trusted-v2.1.0',
      parameterVersion: 'evidence-1',
      routeModelVersion: 3,
    })
  }
  for (const route of routes) {
    for (let i = 0; i < gate.THRESHOLDS.climbSamplesPerRoute; i += 1) {
      push(route, 'climb_up')
    }
  }
  for (const kind of gate.REQUIRED_NEGATIVE_KINDS) {
    for (let i = 0; i < gate.THRESHOLDS.negativeSamplesPerKind; i += 1) {
      push(routes[0], kind)
    }
  }
  return { manifestVersion: 1, files }
}

test('dataset-kit init：创建 samples/、采集计划与复核模板', () => {
  const target = path.join(outDir, 'init-case')
  const result = runKit(['init', '--out', target])
  assert.equal(result.status, 0, result.stderr)
  assert.ok(fs.existsSync(path.join(target, 'samples')))
  assert.ok(fs.existsSync(path.join(target, 'README.md')))
  assert.ok(fs.existsSync(path.join(target, 'collection-plan.csv')))
  assert.ok(fs.existsSync(path.join(target, 'review.csv')))
  const plan = fs.readFileSync(path.join(target, 'collection-plan.csv'), 'utf8')
  // 5 人 × 10 路线 × 2 携带方式 = 100 格
  assert.equal(plan.trim().split('\n').length - 1, 100)
  // README 必须把门槛写清楚（采集者不看代码，只看这份说明）
  const readme = fs.readFileSync(path.join(target, 'README.md'), 'utf8')
  assert.match(readme, /≥ 5 人/)
  assert.match(readme, /≥ 10 条真实路线/)
  assert.match(readme, /pocket/)
  assert.match(readme, /合成\/模拟数据不得放进/)
})

test('dataset-kit check：空数据集 → 退出码 1 并提示先采集', () => {
  const target = path.join(outDir, 'empty-case')
  runKit(['init', '--out', target])
  const result = runKit(['check', target])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /没有任何样本/)
})

test('dataset-kit check --manifest：覆盖率刚好达标 → 退出码 0', () => {
  const manifestPath = path.join(outDir, 'adequate.manifest.json')
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(buildAdequateManifest(), null, 2),
    'utf8',
  )
  const result = runKit(['check', '--manifest', manifestPath])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /覆盖率门槛全部达标/)
  assert.match(result.stdout, /✅ 采集者数：5 \/ 5/)
})

test('dataset-kit check --manifest：缺采集者/负样本 → 逐条列出缺口', () => {
  const manifest = buildAdequateManifest()
  // 只留 2 位采集者，并删掉所有 escalator 负样本
  manifest.files = manifest.files
    .filter((entry) => !['p03', 'p04', 'p05'].includes(entry.participantId))
    .filter((entry) => entry.activity !== 'escalator')
  const manifestPath = path.join(outDir, 'deficient.manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  const result = runKit(['check', '--manifest', manifestPath])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /采集者数：2 < 门槛 5/)
  assert.match(result.stderr, /escalator 只有 0 条 < 门槛 20/)
})

test('dataset-kit check：负样本类别按门禁 canonical 口径统计', () => {
  const manifest = buildAdequateManifest()
  // 采集页里写 walk_flat，门禁统计的是 flat_walk：预检必须用同一口径
  for (const entry of manifest.files) {
    if (entry.activity === 'flat_walk') entry.activity = 'walk_flat'
  }
  const manifestPath = path.join(outDir, 'alias.manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  const result = runKit(['check', '--manifest', manifestPath])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /负样本 flat_walk：20 \/ 20/)
})

test('dataset-kit assemble：没有双人复核记录 → 拒绝生成 provenance.verification', () => {
  const target = path.join(outDir, 'assemble-noreview')
  runKit(['init', '--out', target])
  const manifest = buildAdequateManifest()
  const report = {
    reportVersion: 2,
    datasetManifest: manifest,
  }
  const reportPath = path.join(target, 'report.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')

  const result = runKit([
    'assemble',
    target,
    '--report',
    reportPath,
    '--out',
    path.join(target, 'gate-report.json'),
    '--owner',
    'owner-a',
    '--reviewer',
    'rev-a',
    '--method',
    '双人抽样复核',
  ])
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /复核记录不完整/)
  assert.match(result.stderr, /不允许编造/)
  assert.ok(
    !fs.existsSync(path.join(target, 'gate-report.json')),
    '复核缺失时不得写出任何门禁报告',
  )
})

test('dataset-kit 端到端：assemble 的报告能通过门禁（含文件实体校验）', () => {
  // 复用门禁夹具里的 complete-real：它有 220 个真实落盘的 bundle 文件与达标指标。
  // 注意：夹具是**合成**数据，只证明工具链可用，不构成发布证据。
  const fixtureRoot = path.join(outDir, 'fixtures')
  fs.mkdirSync(fixtureRoot, { recursive: true })
  const cases = fixtures.writeFixtures(fixtureRoot)
  const completeReal = cases.find((item) => item.name === 'complete-real')
  assert.ok(completeReal, '夹具里必须有 complete-real')

  const target = path.join(outDir, 'e2e')
  fs.mkdirSync(target, { recursive: true })
  const sourceDir = path.dirname(completeReal.reportPath)
  for (const name of fs.readdirSync(path.join(sourceDir, 'complete-real'))) {
    fs.copyFileSync(
      path.join(sourceDir, 'complete-real', name),
      path.join(target, name),
    )
  }

  // 先证明「没有复核记录就不放行」
  const withoutReview = runKit([
    'assemble',
    target,
    '--report',
    completeReal.reportPath,
    '--out',
    path.join(target, 'gate-report.json'),
    '--owner',
    'owner-a',
    '--reviewer',
    'rev-a',
    '--method',
    '双人抽样复核',
  ])
  assert.equal(withoutReview.status, 1)

  // 补上双人复核记录后再装配
  const report = JSON.parse(fs.readFileSync(completeReal.reportPath, 'utf8'))
  const rows = ['bundleFile,reviewer1,reviewer2,verdict,notes']
  for (const entry of report.datasetManifest.files) {
    rows.push(`${entry.file},rev-a,rev-b,accept,`)
  }
  fs.writeFileSync(path.join(target, 'review.csv'), `${rows.join('\n')}\n`, 'utf8')

  const assembled = runKit([
    'assemble',
    target,
    '--report',
    completeReal.reportPath,
    '--out',
    path.join(target, 'gate-report.json'),
    '--owner',
    'owner-a',
    '--reviewer',
    'rev-a',
    '--method',
    '双人抽样复核',
  ])
  assert.equal(assembled.status, 0, assembled.stderr)
  assert.match(assembled.stdout, /已写入 manifest/)
  assert.ok(fs.existsSync(path.join(target, 'manifest.json')))

  const gateResult = runGate(path.join(target, 'gate-report.json'))
  assert.equal(gateResult.status, 0, gateResult.stderr)
  assert.match(gateResult.stdout, /RELEASE_READY/)
  // 文件实体校验的结论走 notes → stderr（门禁的 notes 统一用 console.error 输出）
  assert.match(
    gateResult.stderr,
    /数据集文件实体校验：220\/220 条逐字节匹配/,
    gateResult.stderr,
  )
})

test('dataset-kit assemble：报告缺 datasetManifest → 退出码 2 并说明原因', () => {
  const target = path.join(outDir, 'assemble-nomanifest')
  fs.mkdirSync(target, { recursive: true })
  const reportPath = path.join(target, 'report.json')
  fs.writeFileSync(reportPath, JSON.stringify({ reportVersion: 2 }, null, 2), 'utf8')
  const result = runKit([
    'assemble',
    target,
    '--report',
    reportPath,
    '--out',
    path.join(target, 'gate-report.json'),
    '--owner',
    'owner-a',
    '--reviewer',
    'rev-a',
    '--method',
    '双人抽样复核',
  ])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /没有 datasetManifest\.files/)
})
