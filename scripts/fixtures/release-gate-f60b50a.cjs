const fs = require('node:fs')
const path = require('node:path')

const reportPath = process.argv[2]
if (!reportPath) {
  console.error('用法：node scripts/check-release-gates.cjs report.json')
  process.exit(2)
}

const report = JSON.parse(fs.readFileSync(path.resolve(reportPath), 'utf8'))
const failures = []
const requireAtLeast = (name, value, minimum) => {
  if (!Number.isFinite(value) || value < minimum) {
    failures.push(`${name}: ${value} < ${minimum}`)
  }
}
const requireAtMost = (name, value, maximum) => {
  if (!Number.isFinite(value) || value > maximum) {
    failures.push(`${name}: ${value} > ${maximum}`)
  }
}

requireAtLeast('eligibleBundles', report.eligibleBundles, 1)
requireAtLeast('exactFinalFloorRate', report.exactFinalFloorRate, 0.98)
requireAtLeast('floorEventPrecision', report.floorEventPrecision, 0.96)
requireAtLeast('floorEventRecall', report.floorEventRecall, 0.96)
requireAtMost(
  'negativeFalsePositiveRate',
  report.negativeFalsePositiveRate,
  0.01,
)
requireAtMost('medianFloorLatencyMs', report.medianFloorLatencyMs, 2000)
requireAtMost('p95FloorLatencyMs', report.p95FloorLatencyMs, 4000)

for (const [name, cohort] of Object.entries(report.cohorts?.deviceCohort ?? {})) {
  if (cohort.bundles < 5) continue
  requireAtLeast(`deviceCohort.${name}.exactFinalFloorRate`, cohort.exactFinalFloorRate, 0.96)
  requireAtMost(`deviceCohort.${name}.falsePositiveRate`, cohort.falsePositiveRate, 0.02)
}

if (failures.length) {
  console.error('可信训练版发布门禁未通过：')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}
console.log('可信训练版算法发布门禁通过')
