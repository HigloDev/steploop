// 离线回放真机诊断包并输出机器可读指标。
// 用法：npm run diagnostics:replay -- path/to/a.json path/to/b.json

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const compiledRoot = path.join(
  __dirname,
  '..',
  'node_modules',
  '.cache',
  'steploop-core',
)
const {
  aggregateDiagnosticResults,
  compareDiagnosticReports,
  parseDiagnosticBundle,
  replayDiagnosticBundle,
} = require(path.join(compiledRoot, 'diagnostics.js'))

const args = process.argv.slice(2)
let baselinePath
let outputPath
const inputs = []
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--baseline') {
    baselinePath = args[index + 1]
    index += 1
  } else if (args[index] === '--out') {
    outputPath = args[index + 1]
    index += 1
  } else {
    inputs.push(args[index])
  }
}

const expandedInputs = inputs.flatMap((input) => {
  const resolved = path.resolve(input)
  if (!fs.existsSync(resolved)) return [resolved]
  const stat = fs.statSync(resolved)
  if (!stat.isDirectory()) return [resolved]
  return fs
    .readdirSync(resolved)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    // 跳过汇总报告本身，避免把上次 --out 结果再当诊断样本解析
    .filter((name) => !/^(.*-)?report\.json$/i.test(name))
    .map((name) => path.join(resolved, name))
})
if (!inputs.length) {
  console.error(
    '请提供诊断 JSON：npm run diagnostics:replay -- [--baseline report.json] sample.json',
  )
  process.exitCode = 2
  return
}

const results = []
let failed = false

const manifest = []
for (const input of expandedInputs) {
  const resolved = path.resolve(input)
  try {
    const bytes = fs.readFileSync(resolved)
    const json = bytes.toString('utf8')
    const bundle = parseDiagnosticBundle(JSON.parse(json))
    const result = replayDiagnosticBundle(bundle)
    results.push(result)
    // 数据集清单：D01 门禁要求逐条记录采集元数据与算法版本，用于覆盖率推导、
    // 混版本检测和分母核对（scripts/check-release-gates.cjs）。
    // participantId / deviceBrand 来自 capture（src/core/diagnostics.ts）；
    // 旧包缺失时写成空串，门禁按「缺失或为空」fail closed —— 这里绝不编造身份。
    manifest.push({
      bundleId: bundle.id,
      file: path.basename(resolved),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
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
    failed = true
    console.error(
      `${resolved}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

if (results.length) {
  const report = aggregateDiagnosticResults(results)
  let comparison
  if (baselinePath) {
    try {
      const baseline = JSON.parse(
        fs.readFileSync(path.resolve(baselinePath), 'utf8'),
      )
      comparison = compareDiagnosticReports(baseline, report)
      if (!comparison.passed) failed = true
    } catch (error) {
      failed = true
      console.error(
        `基线报告读取失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
  const output = JSON.stringify(
    // datasetManifest 必须是对象（D01 报告契约 v2：{ manifestVersion, files }）：
    // 写成裸数组会让门禁在「类型错误」这一步就短路，逐条元数据校验（participantId/
    // deviceBrand/sha256/覆盖率推导）全部失效，真实数据集永远得不到有效判定。
    {
      ...report,
      datasetManifest: { manifestVersion: 1, files: manifest },
      comparison,
    },
    null,
    2,
  )
  if (outputPath) fs.writeFileSync(path.resolve(outputPath), output)
  console.log(output)
}

if (failed) process.exitCode = 1
