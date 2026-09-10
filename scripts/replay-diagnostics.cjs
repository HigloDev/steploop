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
    results.push(replayDiagnosticBundle(bundle))
    manifest.push({
      bundleId: bundle.id,
      file: path.basename(resolved),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      sampleQuality: bundle.sampleQuality,
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
    { ...report, datasetManifest: manifest, comparison },
    null,
    2,
  )
  if (outputPath) fs.writeFileSync(path.resolve(outputPath), output)
  console.log(output)
}

if (failed) process.exitCode = 1
