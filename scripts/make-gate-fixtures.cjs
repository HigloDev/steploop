// D01 门禁夹具生成器：产出**纯合成**报告/manifest 对，用于验证
// scripts/check-release-gates.cjs 的校验逻辑（正/负向路径）。
//
// 用法：
//   node scripts/make-gate-fixtures.cjs [--out /tmp/d01-gate-fixtures]
//
// 约定：
// - 输出目录默认取系统临时目录（os.tmpdir()）下的 d01-gate-fixtures，绝不写入仓库。
// - 报告写到 <out>/<case>.json；manifest 写到 <out>/<case>.manifest.json。
// - 夹具里的哈希是真实计算的（manifest 字节 hash + 报告内 datasetManifest 内容 hash），
//   因此可以验证 hash 不符路径；但数据本身是合成的，`complete-real` 只是**校验逻辑**
//   的正向夹具，不构成任何真实采集/发布证据（见 D01_GATE_REPORT.md）。
// - 覆盖率/分组数据由 manifest 推导，属于独立实现（不复用门禁脚本的内部函数），
//   以便交叉验证门禁的推导逻辑；canonicalHash 口径与门禁脚本一致（键排序紧凑 JSON）。

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

// 与 src/core/diagnostics.ts:11-13、src/core/route-model.ts:10-11 一致的冗余声明；
// 仅用于生成夹具，门禁脚本会自行从编译产物/冗余声明校验。
const SOURCE_CONSTANTS = Object.freeze({
  algorithm: 'trusted-v2.1.0',
  diagnosticAlgorithm: 'trusted-v2.0.0',
  bundle: 2,
  routeModel: 3,
  parameter: 'evidence-1',
})

const ROUTE_STRUCTURES = ['standard', 'switchback', 'long_landing']
const CARRY_MODES = ['pocket', 'waist']
const BAROMETER_STATES = ['available', 'unavailable']
const NEGATIVE_KINDS = [
  'stationary',
  'descend',
  'flat_walk',
  'elevator_up',
  'elevator_down',
  'escalator',
]
// 报告类别键 → 诊断包真实 activity（src/core/diagnostics.ts:31-38）
const NEGATIVE_ACTIVITY = Object.freeze({
  stationary: 'stationary',
  descend: 'stairs_down',
  flat_walk: 'walk_flat',
  elevator_up: 'elevator_up',
  elevator_down: 'elevator_down',
  escalator: 'escalator',
})

const isObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

/** 与门禁脚本相同的“内容 hash”口径：键排序紧凑 JSON。 */
function canonicalHash(value) {
  return sha256Hex(Buffer.from(stableStringify(value), 'utf8'))
}

const pad = (value) => String(value).padStart(2, '0')

/** 独立实现：从 manifest 条目推导覆盖率与分母（与门禁脚本实现互为交叉验证）。 */
function deriveCoverage(files) {
  const routes = new Set()
  const devices = new Set()
  const brands = new Set()
  const participants = new Set()
  const carryModes = new Set()
  const barometer = new Set()
  const climbSamplesPerRoute = {}
  const negativeSamplesByKind = {}
  let eligibleBundles = 0
  let climbBundles = 0
  let negativeBundles = 0

  for (const entry of files) {
    routes.add(entry.routeId)
    devices.add(entry.deviceCohortId)
    brands.add(entry.deviceBrand)
    participants.add(entry.participantId)
    carryModes.add(entry.carryMode)
    barometer.add(entry.barometerAvailable ? 'available' : 'unavailable')
    if (entry.sampleQuality === 'invalid') continue
    eligibleBundles += 1
    if (entry.activity === 'climb_up') {
      climbBundles += 1
      climbSamplesPerRoute[entry.routeId] =
        (climbSamplesPerRoute[entry.routeId] ?? 0) + 1
    } else {
      negativeBundles += 1
      const kind =
        Object.keys(NEGATIVE_ACTIVITY).find(
          (key) => NEGATIVE_ACTIVITY[key] === entry.activity,
        ) ?? entry.activity
      negativeSamplesByKind[kind] = (negativeSamplesByKind[kind] ?? 0) + 1
    }
  }

  return {
    routes: [...routes].sort(),
    devices: [...devices].sort(),
    brands: [...brands].sort(),
    participants: [...participants].sort(),
    carryModes: [...carryModes].sort(),
    barometer: [...barometer].sort(),
    climbSamplesPerRoute,
    negativeSamplesByKind,
    eligibleBundles,
    climbBundles,
    negativeBundles,
  }
}

function buildManifest(options) {
  const {
    routes = 10,
    devices = 5,
    brands = 3,
    participants = 5,
    carryModes = CARRY_MODES,
    barometerStates = BAROMETER_STATES,
    climbPerRoute = 10,
    climbOverrides = {},
    negativeKinds = NEGATIVE_KINDS,
    negativesPerKind = 20,
    negativeOverrides = {},
    sampleQuality = 'valid',
  } = options

  const routeIds = Array.from({ length: routes }, (_, index) => `route-${pad(index + 1)}`)
  const files = []
  let cursor = 0

  const push = (routeId, routeIndex, activity) => {
    const index = cursor
    cursor += 1
    files.push({
      file: `bundle-${pad(index)}.json`,
      bundleId: `bundle-${pad(index)}`,
      sha256: sha256Hex(Buffer.from(`bundle-${pad(index)}`)),
      bundleVersion: SOURCE_CONSTANTS.bundle,
      algorithmVersion: SOURCE_CONSTANTS.algorithm,
      parameterVersion: SOURCE_CONSTANTS.parameter,
      routeModelVersion: SOURCE_CONSTANTS.routeModel,
      sampleQuality,
      activity,
      carryMode: carryModes[index % carryModes.length],
      barometerAvailable:
        barometerStates[index % barometerStates.length] === 'available',
      routeStructure: ROUTE_STRUCTURES[routeIndex % ROUTE_STRUCTURES.length],
      deviceCohortId: `device-${pad((index % devices) + 1)}`,
      deviceBrand: `brand-${pad((index % brands) + 1)}`,
      participantId: `participant-${pad((index % participants) + 1)}`,
      platform: 'android',
      routeId,
    })
  }

  routeIds.forEach((routeId, routeIndex) => {
    const count = climbOverrides[routeId] ?? climbPerRoute
    for (let n = 0; n < count; n += 1) push(routeId, routeIndex, 'climb_up')
  })

  let negativeCursor = 0
  for (const kind of negativeKinds) {
    const activity = NEGATIVE_ACTIVITY[kind]
    if (!activity) throw new Error(`未知负样本类别：${kind}`)
    const count = negativeOverrides[kind] ?? negativesPerKind
    for (let n = 0; n < count; n += 1) {
      const routeIndex = negativeCursor % routeIds.length
      negativeCursor += 1
      push(routeIds[routeIndex], routeIndex, activity)
    }
  }

  return { manifestVersion: 1, files }
}

function buildCohorts(files, overrides = {}) {
  const dimensions = {
    activity: (entry) => entry.activity,
    carryMode: (entry) => entry.carryMode,
    barometer: (entry) => (entry.barometerAvailable ? 'available' : 'unavailable'),
    platform: (entry) => entry.platform,
    deviceCohort: (entry) => entry.deviceCohortId,
    routeStructure: (entry) => entry.routeStructure,
  }
  const cohorts = {}
  for (const [name, keyOf] of Object.entries(dimensions)) {
    const groups = {}
    for (const entry of files) {
      const key = keyOf(entry)
      if (!key) continue
      if (!groups[key]) {
        groups[key] = {
          bundles: 0,
          exactFinalFloorRate: 1,
          floorEventPrecision: 0.99,
          floorEventRecall: 0.99,
          falsePositiveRate: 0,
          p95FloorLatencyMs: 2400,
        }
      }
      groups[key].bundles += 1
    }
    cohorts[name] = groups
  }
  for (const [target, patch] of Object.entries(overrides)) {
    const [dimension, group] = target.split('.')
    if (!cohorts[dimension]?.[group]) {
      throw new Error(`cohort override 目标不存在：${target}`)
    }
    Object.assign(cohorts[dimension][group], patch)
  }
  return cohorts
}

function buildReport(manifest, options = {}) {
  const derived = deriveCoverage(manifest.files)
  const manifestHash = options.manifestFileHash ?? canonicalHash(manifest)
  return {
    reportVersion: 2,
    generatedAt: '2026-09-17T00:00:00.000Z',
    provenance: {
      kind: options.kind ?? 'real',
      manifestPath: options.manifestPath ?? 'case.manifest.json',
      manifestSha256: manifestHash,
      datasetManifestSha256: canonicalHash(manifest),
      collectorOwner: 'D01 合成夹具（非真实采集，禁止作为发布证据）',
      verification:
        options.verification === undefined
          ? {
              reviewer: '合成夹具占位核验人',
              reviewedAt: '2026-09-17T00:00:00.000Z',
              method: '双人抽样复核（合成夹具占位，不构成真实核验）',
            }
          : options.verification,
    },
    gateEligibility: 'RELEASE_READY',
    algorithmVersions: { ...SOURCE_CONSTANTS },
    coverage: {
      routes: derived.routes.length,
      devices: derived.devices.length,
      brands: derived.brands.length,
      participants: derived.participants.length,
      carryModes: derived.carryModes,
      barometer: derived.barometer,
      climbSamplesPerRoute: derived.climbSamplesPerRoute,
      negativeSamplesByKind: derived.negativeSamplesByKind,
    },
    datasetManifest: manifest,
    bundles: manifest.files.length,
    eligibleBundles: derived.eligibleBundles,
    climbBundles: derived.climbBundles,
    negativeBundles: derived.negativeBundles,
    exactFinalFloorRate: 0.99,
    floorEventPrecision: 0.98,
    floorEventRecall: 0.98,
    negativeFalsePositiveRate: 0,
    medianFloorLatencyMs: 1200,
    p95FloorLatencyMs: 2400,
    cohorts: buildCohorts(manifest.files, options.cohortOverrides),
  }
}

/** 旧实现探测用的人工 JSON：只有 eligibleBundles=1 + 完美指标，没有任何元数据。 */
const PERFECT_SUMMARY_ONLY = Object.freeze({
  eligibleBundles: 1,
  exactFinalFloorRate: 1,
  floorEventPrecision: 1,
  floorEventRecall: 1,
  negativeFalsePositiveRate: 0,
  medianFloorLatencyMs: 300,
  p95FloorLatencyMs: 600,
})

function fixtureCases() {
  return [
    // === 正向：结构完整 + real + 覆盖率/指标达标 → 退出码 0 ===
    { name: 'complete-real', expectExit: 0, stdoutIncludes: ['RELEASE_READY'] },

    // === 验收 1：现状（旧实现）会通过的人工 JSON → 必须失败并逐条列出缺失 ===
    {
      name: 'perfect-summary-only',
      expectExit: 1,
      stderrIncludes: [
        'reportVersion: 必须为 2',
        'provenance: 缺失',
        'gateEligibility: 必须为 RELEASE_READY',
        'algorithmVersions: 缺失',
        'coverage: 缺失',
        'datasetManifest: 缺失',
        'cohorts: 缺失',
      ],
      rawReport: PERFECT_SUMMARY_ONLY,
    },

    // === 验收 2：synthetic 不得产出 RELEASE_READY ===
    {
      name: 'synthetic-complete',
      expectExit: 1,
      stderrIncludes: ['provenance.kind=synthetic：合成数据不得产出 RELEASE_READY'],
      options: { kind: 'synthetic', verification: null },
    },
    {
      name: 'unknown-provenance-kind',
      expectExit: 1,
      stderrIncludes: ['provenance.kind: 必须为 "real"'],
      options: { kind: 'fixture' },
    },
    {
      name: 'verification-missing',
      expectExit: 1,
      stderrIncludes: ['provenance.verification: real 来源必须提供核验记录'],
      mutateReport: (report) => {
        delete report.provenance.verification
      },
    },

    // === 验收 3：必需 cohort 分组缺失/为空 ===
    {
      name: 'cohorts-device-empty',
      expectExit: 1,
      stderrIncludes: ['cohorts.deviceCohort: 为空'],
      mutateReport: (report) => {
        report.cohorts.deviceCohort = {}
      },
    },
    {
      name: 'cohorts-missing',
      expectExit: 1,
      stderrIncludes: ['cohorts: 缺失'],
      mutateReport: (report) => {
        delete report.cohorts
      },
    },
    {
      name: 'cohort-bundles-zero',
      expectExit: 1,
      stderrIncludes: ['cohorts.deviceCohort.device-02.bundles: 0 < 1'],
      mutateReport: (report) => {
        report.cohorts.deviceCohort['device-02'].bundles = 0
      },
    },
    {
      name: 'cohort-p95-field-missing',
      expectExit: 1,
      stderrIncludes: ['cohorts.activity.climb_up.p95FloorLatencyMs: 字段缺失'],
      mutateReport: (report) => {
        delete report.cohorts.activity.climb_up.p95FloorLatencyMs
      },
    },

    // === 验收 4：负样本类别样本不足 ===
    {
      name: 'negative-elevator-down-19',
      expectExit: 1,
      stderrIncludes: ['coverage.negativeSamplesByKind.elevator_down: 19 < 20'],
      options: { negativeOverrides: { elevator_down: 19 } },
    },
    {
      name: 'negative-kind-absent',
      expectExit: 1,
      stderrIncludes: ['coverage.negativeSamplesByKind.escalator'],
      options: {
        negativeKinds: NEGATIVE_KINDS.filter((kind) => kind !== 'escalator'),
      },
    },

    // === 验收 5：路线数不足 ===
    {
      name: 'routes-9',
      expectExit: 1,
      stderrIncludes: ['coverage.routes: 9 < 10'],
      options: { routes: 9 },
    },
    {
      name: 'climb-samples-route-9',
      expectExit: 1,
      stderrIncludes: ['coverage.climbSamplesPerRoute.route-04: 9 < 10'],
      options: { climbOverrides: { 'route-04': 9 } },
    },
    {
      name: 'devices-4',
      expectExit: 1,
      stderrIncludes: ['coverage.devices: 4 < 5'],
      options: { devices: 4 },
    },
    {
      name: 'brands-2',
      expectExit: 1,
      stderrIncludes: ['coverage.brands: 2 < 3'],
      options: { brands: 2 },
    },
    {
      name: 'participants-4',
      expectExit: 1,
      stderrIncludes: ['coverage.participants: 4 < 5'],
      options: { participants: 4 },
    },
    {
      name: 'carry-mode-pocket-missing',
      expectExit: 1,
      stderrIncludes: ['coverage.carryModes: 缺少 pocket'],
      options: { carryModes: ['waist'] },
    },
    {
      name: 'carry-mode-waist-missing',
      expectExit: 1,
      stderrIncludes: ['coverage.carryModes: 缺少 waist'],
      options: { carryModes: ['pocket'] },
    },
    {
      name: 'barometer-available-missing',
      expectExit: 1,
      stderrIncludes: ['coverage.barometer: 缺少 available'],
      options: { barometerStates: ['unavailable'] },
    },
    {
      name: 'barometer-unavailable-missing',
      expectExit: 1,
      stderrIncludes: ['coverage.barometer: 缺少 unavailable'],
      options: { barometerStates: ['available'] },
    },
    {
      name: 'coverage-routes-inflated',
      expectExit: 1,
      stderrIncludes: [
        'coverage.routes: 与 datasetManifest 推导不一致（声明 12，推导 10）',
      ],
      mutateReport: (report) => {
        report.coverage.routes = 12
      },
    },
    {
      name: 'negative-samples-inflated',
      expectExit: 1,
      stderrIncludes: [
        'coverage.negativeSamplesByKind.elevator_up: 与 datasetManifest 推导不一致（声明 25，推导 20）',
      ],
      mutateReport: (report) => {
        report.coverage.negativeSamplesByKind.elevator_up = 25
      },
    },

    // === 验收 6：分组指标退化（设备组 0.90 < 0.96） ===
    {
      name: 'device-rate-090',
      expectExit: 1,
      stderrIncludes: [
        'cohorts.deviceCohort.device-03.exactFinalFloorRate: 0.9 < 0.96',
      ],
      options: {
        cohortOverrides: { 'deviceCohort.device-03': { exactFinalFloorRate: 0.9 } },
      },
    },
    {
      // 旧实现用 `cohort.bundles < 5 continue` 跳过小分组；这里证明跳过已被移除。
      name: 'device-rate-050-small-group',
      expectExit: 1,
      stderrIncludes: [
        'cohorts.deviceCohort.device-04.exactFinalFloorRate: 0.5 < 0.96',
      ],
      options: {
        cohortOverrides: {
          'deviceCohort.device-04': { bundles: 2, exactFinalFloorRate: 0.5 },
        },
      },
    },
    {
      name: 'exact-final-floor-rate-below',
      expectExit: 1,
      stderrIncludes: ['exactFinalFloorRate: 0.97 < 0.98'],
      mutateReport: (report) => {
        report.exactFinalFloorRate = 0.97
      },
    },
    {
      name: 'precision-below',
      expectExit: 1,
      stderrIncludes: ['floorEventPrecision: 0.95 < 0.96'],
      mutateReport: (report) => {
        report.floorEventPrecision = 0.95
      },
    },
    {
      name: 'recall-below',
      expectExit: 1,
      stderrIncludes: ['floorEventRecall: 0.95 < 0.96'],
      mutateReport: (report) => {
        report.floorEventRecall = 0.95
      },
    },
    {
      name: 'false-positive-rate-above',
      expectExit: 1,
      stderrIncludes: ['negativeFalsePositiveRate: 0.02 > 0.01'],
      mutateReport: (report) => {
        report.negativeFalsePositiveRate = 0.02
      },
    },
    {
      name: 'median-latency-above',
      expectExit: 1,
      stderrIncludes: ['medianFloorLatencyMs: 2500 > 2000'],
      mutateReport: (report) => {
        report.medianFloorLatencyMs = 2500
      },
    },
    {
      name: 'p95-latency-above',
      expectExit: 1,
      stderrIncludes: ['p95FloorLatencyMs: 4500 > 4000'],
      mutateReport: (report) => {
        report.p95FloorLatencyMs = 4500
      },
    },
    {
      name: 'p95-latency-null',
      expectExit: 1,
      stderrIncludes: ['p95FloorLatencyMs: null 不是有限数字（要求 <= 4000）'],
      mutateReport: (report) => {
        report.p95FloorLatencyMs = null
      },
    },

    // === 验收 7：hash 不符 ===
    {
      name: 'manifest-hash-mismatch',
      expectExit: 1,
      stderrIncludes: ['provenance.manifestSha256: 与 manifest 文件实际 hash 不符'],
      mutateReport: (report) => {
        report.provenance.manifestSha256 = 'a'.repeat(64)
      },
    },
    {
      name: 'dataset-manifest-hash-mismatch',
      expectExit: 1,
      stderrIncludes: [
        'provenance.datasetManifestSha256: 与报告内 datasetManifest 内容 hash 不符',
      ],
      mutateReport: (report) => {
        report.provenance.datasetManifestSha256 = 'b'.repeat(64)
      },
    },
    {
      name: 'manifest-file-missing',
      expectExit: 1,
      stderrIncludes: ['provenance.manifestPath: 文件不存在'],
      options: { manifestPath: 'does-not-exist.manifest.json' },
      skipManifestFile: true,
    },
    {
      name: 'manifest-content-tampered',
      expectExit: 1,
      stderrIncludes: [
        'report.datasetManifest: 与 provenance.manifestPath 指向的文件内容不一致',
      ],
      mutateReport: (report) => {
        report.datasetManifest.files.push(report.datasetManifest.files[0])
      },
    },

    // === 验收 8/9：算法版本不一致与混版本 ===
    {
      name: 'algorithm-version-mismatch',
      expectExit: 1,
      stderrIncludes: ['algorithmVersions.algorithm: 与源码常量不符'],
      mutateReport: (report) => {
        report.algorithmVersions.algorithm = 'trusted-v9.9.9'
      },
    },
    {
      name: 'bundle-version-mismatch',
      expectExit: 1,
      stderrIncludes: ['algorithmVersions.bundle: 与源码常量不符'],
      mutateReport: (report) => {
        report.algorithmVersions.bundle = 1
      },
    },
    {
      name: 'mixed-algorithm-versions',
      expectExit: 1,
      stderrIncludes: ['混用多个 algorithmVersion', '混用算法版本'],
      mutateManifest: (manifest) => {
        manifest.files.forEach((entry, index) => {
          if (index % 2 === 0) entry.algorithmVersion = 'trusted-v1.0.0'
        })
      },
    },
    {
      name: 'mixed-parameter-versions',
      expectExit: 1,
      stderrIncludes: ['混用多个 parameterVersion'],
      mutateManifest: (manifest) => {
        manifest.files[0].parameterVersion = 'evidence-0'
      },
    },
    {
      name: 'uniform-wrong-algorithm-version',
      expectExit: 1,
      stderrIncludes: [
        'datasetManifest.files[*].algorithmVersion: "trusted-v1.0.0" ≠ 源码 "trusted-v2.1.0"',
      ],
      mutateManifest: (manifest) => {
        manifest.files.forEach((entry) => {
          entry.algorithmVersion = 'trusted-v1.0.0'
        })
      },
    },
    {
      name: 'manifest-version-field-missing',
      expectExit: 1,
      stderrIncludes: ['datasetManifest.files[0].bundleVersion: 缺失或不是有限数字'],
      mutateManifest: (manifest) => {
        delete manifest.files[0].bundleVersion
      },
    },
    {
      name: 'manifest-entry-field-missing',
      expectExit: 1,
      stderrIncludes: ['datasetManifest.files[3].participantId: 缺失或为空'],
      mutateManifest: (manifest) => {
        manifest.files[3].participantId = ''
      },
    },
    {
      name: 'manifest-unknown-activity',
      expectExit: 1,
      stderrIncludes: ['datasetManifest.files[0].activity: 未知取值'],
      mutateManifest: (manifest) => {
        manifest.files[0].activity = 'teleport'
      },
    },
    {
      name: 'manifest-duplicate-bundle',
      expectExit: 1,
      stderrIncludes: ['bundleId 重复'],
      mutateManifest: (manifest) => {
        manifest.files[1].bundleId = manifest.files[0].bundleId
      },
    },
    {
      name: 'manifest-bad-sha256',
      expectExit: 1,
      stderrIncludes: ['datasetManifest.files[2].sha256: 不是 64 位 hex'],
      mutateManifest: (manifest) => {
        manifest.files[2].sha256 = 'not-a-hash'
      },
    },
    {
      // F15：声明了 sha256 却找不到文件 —— 必须拦下，不能只信报告里的字符串。
      name: 'bundle-file-missing',
      expectExit: 1,
      stderrIncludes: ['.file: 文件不存在'],
      deleteFile: 'bundle-00.json',
    },
    {
      // F15：文件在，但内容被改过 —— 逐字节校验必须发现。
      name: 'bundle-file-tampered',
      expectExit: 1,
      stderrIncludes: ['.sha256: 与文件实际内容不符'],
      corruptFile: 'bundle-01.json',
    },
    {
      name: 'manifest-version-not-1',
      expectExit: 1,
      stderrIncludes: ['datasetManifest.manifestVersion: 必须为 1'],
      mutateManifest: (manifest) => {
        manifest.manifestVersion = 2
      },
    },
    {
      name: 'report-version-1',
      expectExit: 1,
      stderrIncludes: ['reportVersion: 必须为 2'],
      mutateReport: (report) => {
        report.reportVersion = 1
      },
    },
    {
      name: 'gate-eligibility-blocked',
      expectExit: 1,
      stderrIncludes: ['gateEligibility: 必须为 RELEASE_READY'],
      mutateReport: (report) => {
        report.gateEligibility = 'BLOCKED'
      },
    },
    {
      name: 'generated-at-missing',
      expectExit: 1,
      stderrIncludes: ['generatedAt: 缺失或不是 ISO-8601'],
      mutateReport: (report) => {
        delete report.generatedAt
      },
    },
    {
      name: 'collector-owner-missing',
      expectExit: 1,
      stderrIncludes: ['provenance.collectorOwner: 缺失或为空'],
      mutateReport: (report) => {
        report.provenance.collectorOwner = ''
      },
    },

    // === 验收 11：分母为 0 不得默认满分 ===
    {
      name: 'eligible-bundles-zero',
      expectExit: 1,
      stderrIncludes: ['eligibleBundles: 0 < 1'],
      options: { sampleQuality: 'invalid' },
      mutateReport: (report) => {
        // 分母为 0 时指标仍写成满分，验证门禁不会被完美数值骗过。
        report.exactFinalFloorRate = 1
        report.floorEventPrecision = 1
        report.floorEventRecall = 1
        report.negativeFalsePositiveRate = 0
      },
    },
    {
      name: 'climb-bundles-zero',
      expectExit: 1,
      stderrIncludes: ['climbBundles: 0 < 1'],
      options: { climbPerRoute: 0 },
      mutateReport: (report) => {
        report.exactFinalFloorRate = 1
        report.floorEventPrecision = 1
        report.floorEventRecall = 1
      },
    },
    {
      name: 'negative-bundles-zero',
      expectExit: 1,
      stderrIncludes: ['negativeBundles: 0 < 1'],
      options: { negativeKinds: [] },
      mutateReport: (report) => {
        report.negativeFalsePositiveRate = 0
      },
    },
  ]
}

function writeFixtures(outDir) {
  const resolved = path.resolve(outDir)
  fs.mkdirSync(resolved, { recursive: true })
  const written = []

  for (const definition of fixtureCases()) {
    const options = definition.options ?? {}
    const reportPath = path.join(resolved, `${definition.name}.json`)
    let report

    if (definition.rawReport) {
      report = JSON.parse(JSON.stringify(definition.rawReport))
    } else {
      const manifest = buildManifest(options)
      if (definition.mutateManifest) definition.mutateManifest(manifest)
      // F15：每个用例用**自己的子目录**放 manifest 与数据集文件。
      // 若所有用例共用一个目录，后生成的用例会把前一个用例故意删掉/改坏的文件重新写回来，
      // 破坏性用例就永远测不出效果（这正是本轮踩到的坑）。
      const caseDir = path.join(resolved, definition.name)
      fs.mkdirSync(caseDir, { recursive: true })
      const manifestPath = path.join(caseDir, 'manifest.json')
      let manifestFileHash = canonicalHash(manifest)
      if (!definition.skipManifestFile) {
        const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
        fs.writeFileSync(manifestPath, bytes)
        manifestFileHash = sha256Hex(bytes)
      }
      // 把 manifest 声明的数据集文件真的写到磁盘上，内容与声明的 sha256 一致。
      // 门禁会逐字节校验文件实体；夹具必须能被校验通过（除非用例故意破坏）。
      materializeDatasetFiles(caseDir, manifest, definition)
      report = buildReport(manifest, {
        ...options,
        manifestPath:
          options.manifestPath ??
          path.join(definition.name, 'manifest.json'),
        manifestFileHash,
      })
      if (definition.mutateReport) definition.mutateReport(report)
    }

    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    written.push({
      name: definition.name,
      reportPath,
      expectExit: definition.expectExit,
      stderrIncludes: definition.stderrIncludes ?? [],
      stdoutIncludes: definition.stdoutIncludes ?? [],
    })
  }

  return written
}

function main(argv) {
  let outDir = path.join(os.tmpdir(), 'd01-gate-fixtures')
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') {
      outDir = argv[index + 1]
      index += 1
    }
  }
  if (!outDir) {
    console.error('用法：node scripts/make-gate-fixtures.cjs [--out <目录>]')
    return 2
  }
  const written = writeFixtures(outDir)
  console.log(`已生成 ${written.length} 个合成夹具：${path.resolve(outDir)}`)
  for (const item of written) {
    console.log(
      `- ${item.name}: 期望退出码 ${item.expectExit} → ${path.basename(
        item.reportPath,
      )}`,
    )
  }
  console.log('提示：夹具为纯合成数据，只证明门禁校验逻辑，不构成发布证据。')
  return 0
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2))
}

module.exports = {
  SOURCE_CONSTANTS,
  PERFECT_SUMMARY_ONLY,
  NEGATIVE_KINDS,
  canonicalHash,
  stableStringify,
  deriveCoverage,
  buildManifest,
  buildReport,
  writeFixtures,
  fixtureCases,
}

/**
 * F15：把 manifest.files 里声明的文件写到磁盘，内容与声明的 sha256 一致。
 * 生成器的 buildManifest 用 `bundle-NNN` 的字节计算 sha256，这里写同样的字节。
 * 用例可以通过 deleteFile / corruptFile 指定要破坏的文件名，用来验证门禁会拦下。
 */
function materializeDatasetFiles(dir, manifest, definition = {}) {
  const files = Array.isArray(manifest?.files) ? manifest.files : []
  for (const entry of files) {
    if (!entry || typeof entry.file !== 'string' || !entry.file) continue
    const target = path.join(dir, entry.file)
    if (definition.deleteFile === entry.file) {
      if (fs.existsSync(target)) fs.rmSync(target)
      continue
    }
    const content =
      definition.corruptFile === entry.file
        ? 'tampered-content\n'
        : `bundle-${entry.bundleId.replace(/^bundle-/, '')}`
    fs.writeFileSync(target, Buffer.from(content, 'utf8'))
  }
}
