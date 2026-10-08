// D12 采集作业包：把「真人采集」这件事变成可执行、可预检、可复现的命令行流程。
//
// 为什么需要它：`replay-diagnostics.cjs` 只产出**报告**（内嵌 datasetManifest），
// 而门禁要求 `provenance.manifestPath` 指向一个**真实存在**的 manifest 文件，
// 且该文件内容必须与报告内嵌的 datasetManifest 逐字节一致（sha256 也要对得上）。
// 这条链路上原本没有任何工具支持，只能手工编辑 JSON —— 而手工编辑正是门禁最不信任的东西。
//
// 用法：
//   node scripts/dataset-kit.cjs init --out <数据集目录>
//   node scripts/dataset-kit.cjs check <数据集目录>            # 解析 samples/*.json 做覆盖率预检
//   node scripts/dataset-kit.cjs check --manifest <manifest.json>  # 只做覆盖率预检（已有 manifest）
//   node scripts/dataset-kit.cjs assemble <数据集目录> --report <replay 报告> --out <门禁报告> \
//        --owner <采集负责人> --reviewer <复核人> --method <复核方法> --review <review.csv>
//
// 退出码：0 = 达标/成功；1 = 未达标（逐条列出缺口）；2 = 用法/IO 错误。
//
// 边界（必须诚实）：
// - 本工具**不产生任何真实数据**，只校验与装配；合成数据永远不会被它判成可用证据。
// - 复核记录缺失时 `assemble` **拒绝**生成 provenance.verification，绝不编造 reviewer/reviewedAt。
// - `check` 只判覆盖率与身份元数据；准确率门槛由门禁（check-release-gates.cjs）判定。

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const gate = require('./check-release-gates.cjs')

const {
  THRESHOLDS,
  deriveFromManifest,
  sha256Hex,
  REQUIRED_NEGATIVE_KINDS,
  ACTIVITY_ALIASES,
  canonicalHash,
} = gate

// 负样本类别用**门禁的 canonical 口径**，而不是采集页里填的 activity 原文：
// 例如采集页写 walk_flat，门禁统计的是 flat_walk；两套口径漂移会导致「预检说达标、门禁说缺」。
const NEGATIVE_KINDS = REQUIRED_NEGATIVE_KINDS
/** activity 原文 → canonical 类别（用于 README 里给采集者看的对照）。 */
const NEGATIVE_ALIAS_HINT = Object.entries(ACTIVITY_ALIASES)
  .filter(([alias, kind]) => alias !== kind && NEGATIVE_KINDS.includes(kind))
  .map(([alias, kind]) => `${alias} → ${kind}`)
  .join('、')
const CARRY_MODES = ['pocket', 'waist']
const PARTICIPANT_RE = /^(?=.*[a-z])[a-z0-9_-]{1,32}$/i
const BRAND_RE = /^[a-z0-9-]{1,32}$/

function usage() {
  console.error(
    [
      '用法：',
      '  node scripts/dataset-kit.cjs init --out <数据集目录>',
      '  node scripts/dataset-kit.cjs check <数据集目录>',
      '  node scripts/dataset-kit.cjs check --manifest <manifest.json>',
      '  node scripts/dataset-kit.cjs assemble <数据集目录> --report <replay报告> --out <门禁报告> \\',
      '       --owner <采集负责人> --reviewer <复核人> --method <复核方法> [--review <review.csv>]',
    ].join('\n'),
  )
}

function parseArgs(argv) {
  const flags = {}
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        flags[key] = true
      } else {
        flags[key] = value
        index += 1
      }
    } else {
      positional.push(token)
    }
  }
  return { flags, positional }
}

// === init：脚手架 ===

const README_TEMPLATE = `# D12 真实数据集（采集作业目录）

本目录由 \`node scripts/dataset-kit.cjs init --out <目录>\` 生成。
**这里放的是真实采集数据；合成/模拟数据不得放进 \`samples/\`。**

## 目录结构

\`\`\`
samples/            每个诊断包一个 JSON（应用内「诊断采集」导出）
manifest.json       dataset-kit assemble 生成（门禁的 provenance.manifestPath 指向它）
report.json         replay-diagnostics 生成的指标报告
gate-report.json    dataset-kit assemble 生成的**门禁就绪**报告
collection-plan.csv 采集计划（5 人 × 10 路线 × 2 携带方式，勾掉已完成的格子）
review.csv          双人复核记录（assemble 依赖它，缺了会拒绝生成）
\`\`\`

## 采集门槛（门禁 fail closed，缺一项都不算数）

| 项目 | 门槛 |
|---|---|
| 采集者（化名 p01…p05） | ≥ ${THRESHOLDS.coverageParticipants} 人，且**每人都要出现在数据里** |
| 路线 | ≥ ${THRESHOLDS.coverageRoutes} 条真实路线 |
| 携带方式 | pocket 与 waist 两种都要有 |
| 设备组 | ≥ ${THRESHOLDS.coverageDevices} 个；品牌 ≥ ${THRESHOLDS.coverageBrands} 个 |
| 气压计 | 有/无两种机型都要覆盖 |
| 正样本 | 每条路线 ≥ ${THRESHOLDS.climbSamplesPerRoute} 条上爬 |
| 负样本 | 每类（${NEGATIVE_KINDS.join(' / ')}）≥ ${THRESHOLDS.negativeSamplesPerKind} 条 |

负样本类别按**门禁口径**统计（canonical）。采集页里可填的写法对照：${NEGATIVE_ALIAS_HINT}。

## 标准流程

1. 每台设备上：应用 → 诊断采集 → 填化名（如 \`p01\`）与设备品牌 → 选路线 → 采集 → 导出 JSON；
2. 把导出的 JSON 放进本目录的 \`samples/\`；
3. \`node scripts/dataset-kit.cjs check <本目录>\` —— 预检覆盖率，**先在本地补齐缺口，别浪费门禁**；
4. \`npm run diagnostics:replay -- --out report.json samples/\` —— 生成指标报告；
5. 双人复核后填 \`review.csv\`；
6. \`node scripts/dataset-kit.cjs assemble <本目录> --report report.json --out gate-report.json \\
   --owner <负责人> --reviewer <复核人> --method <方法>\` —— 生成门禁就绪报告；
7. \`npm run diagnostics:gate gate-report.json\` —— 真实准确率判定。

## 纪律

- 化名与真实身份的对应表**不得**放进本仓库，由采集组织者在仓库之外保管；
- 不得为了凑门槛重复提交同一个包（bundleId/文件重复会被门禁拒绝）；
- 手动标注错误必须在复核阶段发现并剔除，不要指望门禁替你发现标注错误。
`

const PLAN_HEADER = 'participantId,deviceBrand,deviceCohortId,routeId,carryMode,barometer,status,note\n'
const REVIEW_HEADER = 'bundleFile,reviewer1,reviewer2,verdict,notes\n'

function commandInit(flags) {
  const outDir = flags.out
  if (!outDir || outDir === true) {
    console.error('init 需要 --out <数据集目录>')
    return 2
  }
  const resolved = path.resolve(outDir)
  const samples = path.join(resolved, 'samples')
  fs.mkdirSync(samples, { recursive: true })

  fs.writeFileSync(path.join(resolved, 'README.md'), README_TEMPLATE, 'utf8')

  const rows = [PLAN_HEADER]
  for (let participant = 1; participant <= THRESHOLDS.coverageParticipants; participant += 1) {
    const id = `p0${participant}`
    for (let route = 1; route <= THRESHOLDS.coverageRoutes; route += 1) {
      const routeId = `route-${String(route).padStart(2, '0')}`
      for (const carryMode of CARRY_MODES) {
        rows.push(`${id},,device-01,${routeId},${carryMode},,待采集,\n`)
      }
    }
  }
  fs.writeFileSync(path.join(resolved, 'collection-plan.csv'), rows.join(''), 'utf8')
  fs.writeFileSync(path.join(resolved, 'review.csv'), REVIEW_HEADER, 'utf8')
  fs.writeFileSync(
    path.join(samples, '.gitkeep'),
    '真实诊断包放这里；本目录不得提交到公开仓库。\n',
    'utf8',
  )

  console.log(`已创建采集作业目录：${resolved}`)
  console.log(`- samples/               放诊断包 JSON`)
  console.log(`- collection-plan.csv    采集计划（${rows.length - 1} 格）`)
  console.log(`- review.csv             双人复核记录（assemble 依赖）`)
  console.log(`- README.md              门槛与标准流程`)
  console.log('下一步：采集 → samples/ → dataset-kit check')
  return 0
}

// === check：覆盖率预检 ===

function listSampleFiles(dir) {
  if (!fs.existsSync(dir)) return null
  return fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .filter((name) => !/^(.*-)?report\.json$/i.test(name))
    .map((name) => path.join(dir, name))
    .sort()
}

/** 从诊断包 JSON 构造 manifest 条目：字段与 replay-diagnostics.cjs 完全一致。 */
function manifestEntriesFromSamples(dir) {
  const files = listSampleFiles(dir)
  if (files === null) return { error: `目录不存在：${path.resolve(dir)}` }
  const compiledRoot = path.join(
    __dirname,
    '..',
    'node_modules',
    '.cache',
    'steploop-core',
  )
  let parseDiagnosticBundle
  let replayDiagnosticBundle
  try {
    const core = require(path.join(compiledRoot, 'diagnostics.js'))
    parseDiagnosticBundle = core.parseDiagnosticBundle
    replayDiagnosticBundle = core.replayDiagnosticBundle
  } catch (error) {
    return {
      error:
        `无法加载核心诊断模块（${compiledRoot}）：请先 npm run build:core。` +
        `${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const entries = []
  const problems = []
  const seenIds = new Map()
  for (const file of files) {
    const bytes = fs.readFileSync(file)
    try {
      const bundle = parseDiagnosticBundle(JSON.parse(bytes.toString('utf8')))
      const result = replayDiagnosticBundle(bundle)
      if (seenIds.has(bundle.id)) {
        problems.push(`bundleId 重复：${bundle.id}（${path.basename(file)} 与 ${seenIds.get(bundle.id)}）`)
      } else {
        seenIds.set(bundle.id, path.basename(file))
      }
      entries.push({
        bundleId: bundle.id,
        file: path.relative(dir, file).split(path.sep).join('/'),
        sha256: sha256Hex(bytes),
        sampleQuality: bundle.sampleQuality,
        routeId: bundle.routeTemplate.id,
        activity: result.activity,
        carryMode: result.carryMode,
        platform: result.platform,
        deviceCohortId: result.deviceCohortId,
        participantId: result.participantId,
        deviceBrand: result.deviceBrand,
        routeStructure: result.routeStructure,
        barometerAvailable: result.barometerAvailable,
        bundleVersion: bundle.version,
        algorithmVersion: bundle.algorithmVersion,
        parameterVersion: bundle.parameterVersion,
        routeModelVersion: bundle.routeModelVersion,
      })
    } catch (error) {
      problems.push(
        `${path.basename(file)}: 解析失败（${error instanceof Error ? error.message : String(error)}）`,
      )
    }
  }
  return { entries, problems }
}

/** 覆盖率判定：与门禁同源（THRESHOLDS + deriveFromManifest），避免两套口径漂移。 */
function evaluateCoverage(entries) {
  const derived = deriveFromManifest(entries)
  const gaps = []
  const atLeast = (label, actual, required) => {
    if (actual < required) gaps.push(`${label}：${actual} < 门槛 ${required}`)
    return actual >= required
  }

  // 注意：deriveFromManifest 返回的是**数组**（与门禁 coverage 字段同形），不是 Set。
  atLeast('路线数', derived.routes.length, THRESHOLDS.coverageRoutes)
  atLeast('设备组数', derived.devices.length, THRESHOLDS.coverageDevices)
  atLeast('品牌数', derived.brands.length, THRESHOLDS.coverageBrands)
  atLeast('采集者数', derived.participants.length, THRESHOLDS.coverageParticipants)

  for (const mode of CARRY_MODES) {
    if (!derived.carryModes.includes(mode)) gaps.push(`携带方式：缺少 ${mode}`)
  }
  if (!derived.barometer.includes('available')) {
    gaps.push('气压计：缺少「有气压计」机型')
  }
  if (!derived.barometer.includes('unavailable')) {
    gaps.push('气压计：缺少「无气压计」机型')
  }

  for (const [routeId, count] of Object.entries(derived.climbSamplesPerRoute)) {
    if (count < THRESHOLDS.climbSamplesPerRoute) {
      gaps.push(
        `正样本：路线 ${routeId} 只有 ${count} 条上爬 < 门槛 ${THRESHOLDS.climbSamplesPerRoute}`,
      )
    }
  }
  if (Object.keys(derived.climbSamplesPerRoute).length === 0) {
    gaps.push('正样本：一条上爬样本都没有')
  }
  for (const kind of NEGATIVE_KINDS) {
    const count = derived.negativeSamplesByKind[kind] ?? 0
    if (count < THRESHOLDS.negativeSamplesPerKind) {
      gaps.push(
        `负样本：${kind} 只有 ${count} 条 < 门槛 ${THRESHOLDS.negativeSamplesPerKind}`,
      )
    }
  }

  // 身份元数据：门禁对真实数据集是 fail closed，这里提前把问题指到具体文件。
  const identityProblems = []
  entries.forEach((entry, index) => {
    const at = `files[${index}] ${entry.file}`
    if (!entry.participantId) {
      identityProblems.push(`${at}: 缺 participantId（采集页的「采集者化名」）`)
    } else if (!PARTICIPANT_RE.test(entry.participantId)) {
      identityProblems.push(`${at}: participantId 不合法（${entry.participantId}）`)
    }
    if (!entry.deviceBrand) {
      identityProblems.push(`${at}: 缺 deviceBrand（采集页的「设备品牌」）`)
    } else if (!BRAND_RE.test(entry.deviceBrand)) {
      identityProblems.push(`${at}: deviceBrand 不合法（${entry.deviceBrand}）`)
    }
    if (!entry.deviceCohortId) {
      identityProblems.push(`${at}: 缺 deviceCohortId`)
    }
  })

  return { derived, gaps, identityProblems }
}

function printCoverage(derived) {
  const rows = [
    ['路线数', derived.routes.length, THRESHOLDS.coverageRoutes],
    ['设备组数', derived.devices.length, THRESHOLDS.coverageDevices],
    ['品牌数', derived.brands.length, THRESHOLDS.coverageBrands],
    ['采集者数', derived.participants.length, THRESHOLDS.coverageParticipants],
  ]
  for (const [label, actual, required] of rows) {
    const mark = actual >= required ? '✅' : '⛔'
    console.log(`${mark} ${label}：${actual} / ${required}`)
  }
  console.log(
    `  携带方式：${derived.carryModes.join('、') || '（无）'}（需要 pocket + waist）`,
  )
  console.log(
    `  气压计覆盖：${derived.barometer.join('、') || '（无）'}（需要 available + unavailable）`,
  )
  const climbRoutes = Object.entries(derived.climbSamplesPerRoute)
  console.log(`  正样本路线数：${climbRoutes.length}`)
  for (const [kind, count] of Object.entries(derived.negativeSamplesByKind)) {
    console.log(
      `  负样本 ${kind}：${count} / ${THRESHOLDS.negativeSamplesPerKind}`,
    )
  }
}

function commandCheck(flags, positional) {
  let entries
  let problems = []
  let source

  if (flags.manifest) {
    if (flags.manifest === true) {
      console.error('check --manifest 需要一个 manifest 文件路径')
      return 2
    }
    const manifestPath = path.resolve(flags.manifest)
    if (!fs.existsSync(manifestPath)) {
      console.error(`manifest 不存在：${manifestPath}`)
      return 2
    }
    let parsed
    try {
      parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      console.error(`manifest 不是合法 JSON：${error instanceof Error ? error.message : error}`)
      return 2
    }
    const files = Array.isArray(parsed) ? parsed : parsed.files
    if (!Array.isArray(files)) {
      console.error('manifest 缺少 files 数组')
      return 2
    }
    entries = files
    source = `manifest ${manifestPath}`
  } else {
    const dir = positional[0]
    if (!dir) {
      usage()
      return 2
    }
    const scanned = manifestEntriesFromSamples(path.resolve(dir))
    if (scanned.error) {
      console.error(scanned.error)
      return 2
    }
    entries = scanned.entries
    problems = scanned.problems
    source = `${path.resolve(dir)}/samples`
  }

  console.log(`[dataset-kit] 预检来源：${source}`)
  console.log(`[dataset-kit] 样本条目：${entries.length}`)
  if (!entries.length) {
    console.error('⛔ 没有任何样本；先按 README.md 采集并放入 samples/')
    return 1
  }

  const { derived, gaps, identityProblems } = evaluateCoverage(entries)
  printCoverage(derived)

  const blockers = [...problems, ...identityProblems, ...gaps]
  if (blockers.length) {
    console.error(`\n⛔ 覆盖率预检未通过（${blockers.length} 项）：`)
    for (const item of blockers.slice(0, 40)) console.error(`- ${item}`)
    if (blockers.length > 40) {
      console.error(`- …（其余 ${blockers.length - 40} 项省略）`)
    }
    console.error(
      '\n提示：补齐缺口后再跑门禁。合成/模拟数据不得放进 samples/（门禁会拒绝 synthetic）。',
    )
    return 1
  }

  console.log('\n✅ 覆盖率门槛全部达标。下一步：')
  console.log('  1) npm run diagnostics:replay -- --out report.json samples/')
  console.log('  2) 双人复核后填 review.csv')
  console.log(
    '  3) node scripts/dataset-kit.cjs assemble <目录> --report report.json --out gate-report.json \\',
  )
  console.log('       --owner <负责人> --reviewer <复核人> --method <复核方法>')
  console.log('  4) npm run diagnostics:gate gate-report.json')
  return 0
}

// === assemble：装配门禁就绪报告（绝不编造复核记录）===

function readReviewRecords(reviewPath) {
  if (!reviewPath || !fs.existsSync(reviewPath)) return { records: [], error: null }
  const text = fs.readFileSync(reviewPath, 'utf8')
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length <= 1) return { records: [], error: null }
  const header = lines[0].split(',')
  const index = {
    bundleFile: header.indexOf('bundleFile'),
    reviewer1: header.indexOf('reviewer1'),
    reviewer2: header.indexOf('reviewer2'),
    verdict: header.indexOf('verdict'),
  }
  if (index.bundleFile < 0 || index.reviewer1 < 0 || index.reviewer2 < 0) {
    return { records: [], error: 'review.csv 表头缺少 bundleFile/reviewer1/reviewer2' }
  }
  const records = lines.slice(1).map((line) => {
    const cells = line.split(',')
    return {
      bundleFile: (cells[index.bundleFile] ?? '').trim(),
      reviewer1: (cells[index.reviewer1] ?? '').trim(),
      reviewer2: (cells[index.reviewer2] ?? '').trim(),
      verdict: (cells[index.verdict] ?? '').trim(),
    }
  })
  return { records, error: null }
}

function commandAssemble(flags, positional) {
  const dir = positional[0]
  if (!dir) {
    usage()
    return 2
  }
  const resolvedDir = path.resolve(dir)
  const required = ['report', 'out', 'owner', 'reviewer', 'method']
  for (const key of required) {
    if (!flags[key] || flags[key] === true) {
      console.error(`assemble 需要 --${key}`)
      return 2
    }
  }

  const reportPath = path.resolve(flags.report)
  if (!fs.existsSync(reportPath)) {
    console.error(`报告不存在：${reportPath}`)
    return 2
  }
  let report
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  } catch (error) {
    console.error(`报告不是合法 JSON：${error instanceof Error ? error.message : error}`)
    return 2
  }
  const manifestFiles = report?.datasetManifest?.files
  if (!Array.isArray(manifestFiles) || !manifestFiles.length) {
    console.error(
      '报告里没有 datasetManifest.files；请先用 npm run diagnostics:replay 生成报告。',
    )
    return 2
  }

  // 复核记录：这是「真实数据集」的必要条件，缺了就拒绝装配（不编造 reviewer/reviewedAt）。
  const reviewPath = flags.review
    ? path.resolve(flags.review)
    : path.join(resolvedDir, 'review.csv')
  const { records, error: reviewError } = readReviewRecords(reviewPath)
  if (reviewError) {
    console.error(`review 记录无法解析：${reviewError}`)
    return 2
  }
  const reviewedFiles = new Set(
    records
      .filter((r) => r.reviewer1 && r.reviewer2 && r.reviewer1 !== r.reviewer2)
      .map((r) => r.bundleFile),
  )
  const missingReview = manifestFiles
    .map((entry) => entry.file)
    .filter((file) => !reviewedFiles.has(file))
  if (missingReview.length) {
    console.error(
      `⛔ 复核记录不完整：${missingReview.length}/${manifestFiles.length} 个包没有「两位不同复核人」的记录。`,
    )
    console.error(`   复核文件：${reviewPath}`)
    for (const file of missingReview.slice(0, 10)) console.error(`- 待复核：${file}`)
    if (missingReview.length > 10) {
      console.error(`- …（其余 ${missingReview.length - 10} 个省略）`)
    }
    console.error(
      '   说明：provenance.verification 不允许编造。补完 review.csv（每位包两行不同复核人）后重跑。',
    )
    return 1
  }

  // 写 manifest 文件：内容必须与报告内嵌 datasetManifest 逐字段一致，否则门禁会判「不一致」。
  const manifestPath = path.join(resolvedDir, 'manifest.json')
  const manifestBytes = Buffer.from(
    `${JSON.stringify({ manifestVersion: 1, files: manifestFiles }, null, 2)}\n`,
    'utf8',
  )
  fs.writeFileSync(manifestPath, manifestBytes)
  const manifestSha256 = sha256Hex(manifestBytes)
  // 必须用门禁的 canonicalHash（stableStringify），不能用 JSON.stringify：
  // 键顺序/空白不同会让 hash 对不上，门禁会判「与报告内 datasetManifest 内容 hash 不符」。
  const datasetManifestSha256 = canonicalHash({ manifestVersion: 1, files: manifestFiles })

  const assembled = {
    ...report,
    provenance: {
      ...(report.provenance && typeof report.provenance === 'object'
        ? report.provenance
        : {}),
      kind: 'real',
      manifestPath: path.basename(manifestPath),
      manifestSha256,
      datasetManifestSha256,
      collectorOwner: flags.owner,
      verification: {
        reviewer: flags.reviewer,
        reviewedAt: new Date().toISOString(),
        method: flags.method,
      },
    },
    datasetManifest: { manifestVersion: 1, files: manifestFiles },
  }

  const outPath = path.resolve(flags.out)
  fs.writeFileSync(outPath, `${JSON.stringify(assembled, null, 2)}\n`, 'utf8')

  console.log(`已写入 manifest：${manifestPath}（${manifestFiles.length} 条）`)
  console.log(`已写入门禁就绪报告：${outPath}`)
  console.log(`- 复核记录：${reviewedFiles.size} 个包（两位不同复核人）`)
  console.log(`- manifestSha256：${manifestSha256}`)
  console.log(`- datasetManifestSha256：${datasetManifestSha256}`)
  console.log('下一步：npm run diagnostics:gate ' + path.relative(process.cwd(), outPath))
  console.log(
    '注意：assemble 只保证「报告形状 + 文件实体 + 复核记录」齐备，准确率是否达标由门禁判定。',
  )
  return 0
}

function main(argv) {
  const { flags, positional } = parseArgs(argv)
  const command = positional.shift()
  if (command === 'init') return commandInit(flags)
  if (command === 'check') return commandCheck(flags, positional)
  if (command === 'assemble') return commandAssemble(flags, positional)
  usage()
  return 2
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2))
}

module.exports = {
  main,
  manifestEntriesFromSamples,
  evaluateCoverage,
  readReviewRecords,
  NEGATIVE_KINDS,
  CARRY_MODES,
}
