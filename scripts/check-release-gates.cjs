#!/usr/bin/env node
// 可信训练版发布门禁（报告契约 v2，fail-closed）。
//
// 用法：node scripts/check-release-gates.cjs <report.json>
//      可选环境变量 D01_GATE_DATASET_ROOT=<数据集目录>（默认取 manifestPath 所在目录）
// 退出码：0 = 通过（RELEASE_READY）；1 = 门禁失败（逐条列出）；2 = 用法/IO/JSON 错误。
//
// 与旧实现（HEAD f60b50a，46 行）的差别：
// - 旧实现只比数值门槛，`eligibleBundles>=1` 加完美指标、没有 cohorts/manifest/来源
//   声明的人工 JSON 也能通过（CORE_AUDIT F01 已证）。现在缺少任一必需元数据即失败。
// - 不再用 `cohort.bundles < 5 continue` 跳过小分组；所有分组都要过分组门槛。
// - 分母为 0 一律失败，禁止把「没有负样本」默认成满分。
//
// 契约要点（见 docs/dsh-handoff/tasks/D01_CONTRACT.md）：
// - 顶层必需：reportVersion=2、generatedAt、provenance、gateEligibility、
//   algorithmVersions、coverage、datasetManifest、cohorts、7 个数值指标、3 个分母。
// - provenance.kind 只有 'real' 允许 RELEASE_READY；'synthetic' 一律拒绝并有固定理由文案。
// - provenance.manifestSha256 必须等于 manifest 文件实际字节 hash；
//   provenance.datasetManifestSha256 必须等于报告内 datasetManifest 的内容 hash；
//   报告内 datasetManifest 必须与 manifestPath 指向的文件内容一致。
// - F15：datasetManifest.files 里声明的每个 file 必须**真的存在**，且 sha256 与磁盘字节一致；
//   数据集目录 = D01_GATE_DATASET_ROOT（显式指定）或 provenance.manifestPath 所在目录。
//   只校验报告里的 hash 字符串等于让「数据集可复现」变成一句空话。
// - coverage 既查报告声明值，也查从 datasetManifest.files 推导出的值，两者必须一致，
//   避免只写漂亮数字的手工 JSON 通过。
// - 数值门槛保持既有值（0.98 / 0.96 / 0.96 / 0.01 / 2000 / 4000），不下调。
//
// 算法版本常量以源码为准：src/core/diagnostics.ts:11-13、src/core/route-model.ts:10-11。
// 解析来源与规则（D01-FIX1 决策 2/3/4/5）：
// - 源码文本（src 的 .ts 正则解析）是**唯一必需**的核对来源：5 个常量任一解析不到 → 失败；
// - 编译产物 node_modules/.cache/steploop-core 是可选来源：缺失只提示、不失败（全新 clone 可跑）；
// - 可用来源必须两两一致，且都与脚本内冗余声明一致，任一不一致 → 失败；
// - 冗余声明永不单独作为放行依据。

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

// 冗余声明的源码常量（编译产物读取失败时的回退）。修改 src 常量时必须同步这里。
const DECLARED_SOURCE_CONSTANTS = Object.freeze({
  algorithm: 'trusted-v2.1.0', // src/core/route-model.ts:11
  diagnosticAlgorithm: 'trusted-v2.0.0', // src/core/diagnostics.ts:12
  bundle: 2, // src/core/diagnostics.ts:11
  routeModel: 3, // src/core/route-model.ts:10
  parameter: 'evidence-1', // src/core/diagnostics.ts:13
})

// 数值门槛：与旧实现完全一致，只增不减。
const THRESHOLDS = Object.freeze({
  minimumEligibleBundles: 1,
  minimumClimbBundles: 1,
  minimumNegativeBundles: 1,
  exactFinalFloorRate: 0.98,
  floorEventPrecision: 0.96,
  floorEventRecall: 0.96,
  maximumNegativeFalsePositiveRate: 0.01,
  maximumMedianFloorLatencyMs: 2000,
  maximumP95FloorLatencyMs: 4000,
  cohortExactFinalFloorRate: 0.96,
  cohortFloorEventPrecision: 0.96,
  cohortFloorEventRecall: 0.96,
  maximumCohortFalsePositiveRate: 0.02,
  maximumCohortP95FloorLatencyMs: 4000,
  coverageRoutes: 10,
  coverageDevices: 5,
  coverageBrands: 3,
  coverageParticipants: 5,
  climbSamplesPerRoute: 10,
  negativeSamplesPerKind: 20,
})

const REQUIRED_COHORT_MAPS = Object.freeze([
  'deviceCohort',
  'carryMode',
  'barometer',
  'activity',
  'platform',
  'routeStructure',
])

// 负样本类别口径（报告 coverage.negativeSamplesByKind 的键，见合同 §必须实现的报告契约 v2）。
const REQUIRED_NEGATIVE_KINDS = Object.freeze([
  'stationary',
  'descend',
  'flat_walk',
  'elevator_up',
  'elevator_down',
  'escalator',
])

// 诊断包的 activity（src/core/diagnostics.ts:31-38）→ 报告负样本类别。
const ACTIVITY_ALIASES = Object.freeze({
  stationary: 'stationary',
  stairs_down: 'descend',
  descend: 'descend',
  walk_flat: 'flat_walk',
  flat_walk: 'flat_walk',
  elevator_up: 'elevator_up',
  elevator_down: 'elevator_down',
  escalator: 'escalator',
})

// replayDiagnosticBundle 只会产出这三种路线结构（src/core/diagnostics.ts:473-481）。
const KNOWN_ROUTE_STRUCTURES = Object.freeze([
  'standard',
  'switchback',
  'long_landing',
])

// datasetManifest 条目里的逐 bundle 版本字段 → 源码常量键 / 中文说明。
const VERSION_KEY_TO_CONSTANT = Object.freeze({
  algorithmVersion: 'algorithm',
  parameterVersion: 'parameter',
  bundleVersion: 'bundle',
  routeModelVersion: 'routeModel',
})
const VERSION_KEY_LABELS = Object.freeze({
  algorithmVersion: '算法版本',
  parameterVersion: '参数版本',
  bundleVersion: '诊断包版本',
  routeModelVersion: '路线模型版本',
})

const SAMPLE_QUALITIES = Object.freeze(['valid', 'degraded', 'invalid'])
const CARRY_MODES = Object.freeze(['pocket', 'waist'])
const BAROMETER_STATES = Object.freeze(['available', 'unavailable'])
const RELEASE_READY = 'RELEASE_READY'

const isObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isNonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0
const isSha256 = (value) =>
  typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
const isIsoTimestamp = (value) =>
  isNonEmptyString(value) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(
    value,
  ) &&
  !Number.isNaN(Date.parse(value))
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const fmt = (value) =>
  value === undefined ? 'undefined' : JSON.stringify(value) ?? String(value)
const sortedKeys = (value) => Object.keys(value).sort()
/** 把多行运行时错误（如 require 栈）压成一行，保证门禁输出可逐行解析。 */
const oneLine = (text) => String(text).replace(/\s*\n\s*/g, ' ').trim()

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (isObject(value)) {
    return `{${sortedKeys(value)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

/** 内容 hash 口径：对象键排序后的紧凑 JSON。数组/嵌套对象同样递归排序。 */
function canonicalHash(value) {
  return sha256Hex(Buffer.from(stableStringify(value), 'utf8'))
}

// 算法版本常量以源码为准：src/core/diagnostics.ts:11-13、src/core/route-model.ts:10-11。
// 解析优先级：① node_modules/.cache/steploop-core 编译产物 → ② 直接解析 src 的 .ts 源码文本。
// 脚本内的 DECLARED_SOURCE_CONSTANTS **只用于与上面两个来源三方交叉核对**，
// 绝不单独作为放行依据：两个来源都读不到时门禁必须失败（fail closed），
// 任一来源之间（或与冗余声明）不一致时同样失败。

const DEFAULT_COMPILED_ROOT = path.join(
  __dirname,
  '..',
  'node_modules',
  '.cache',
  'steploop-core',
)
const DEFAULT_SOURCE_ROOT = path.join(__dirname, '..')
const COMPILED_ROOT_ENV = 'D01_GATE_COMPILED_ROOT'
const SOURCE_ROOT_ENV = 'D01_GATE_SOURCE_ROOT'

// 常量 → 声明位置 / 类型 / 解析来源说明（用于失败文案与源码正则）。
const SOURCE_CONSTANT_SPECS = Object.freeze({
  bundle: {
    file: 'src/core/diagnostics.ts',
    name: 'DIAGNOSTIC_BUNDLE_VERSION',
    type: 'number',
    line: 'src/core/diagnostics.ts:11',
  },
  diagnosticAlgorithm: {
    file: 'src/core/diagnostics.ts',
    name: 'DIAGNOSTIC_ALGORITHM_VERSION',
    type: 'string',
    line: 'src/core/diagnostics.ts:12',
  },
  parameter: {
    file: 'src/core/diagnostics.ts',
    name: 'DIAGNOSTIC_PARAMETER_VERSION',
    type: 'string',
    line: 'src/core/diagnostics.ts:13',
  },
  routeModel: {
    file: 'src/core/route-model.ts',
    name: 'ROUTE_MODEL_VERSION',
    type: 'number',
    line: 'src/core/route-model.ts:10',
  },
  algorithm: {
    file: 'src/core/route-model.ts',
    name: 'ROUTE_ALGORITHM_VERSION',
    type: 'string',
    line: 'src/core/route-model.ts:11',
  },
})

const SOURCE_KEYS = Object.freeze(sortedKeys(DECLARED_SOURCE_CONSTANTS))

function describeConstant(key, value) {
  return `${key}=${fmt(value)}（${SOURCE_CONSTANT_SPECS[key].line}）`
}

function resolveRootOption(value, envName, fallback) {
  const raw = isNonEmptyString(value)
    ? value
    : isNonEmptyString(process.env[envName])
      ? process.env[envName]
      : fallback
  return path.resolve(raw)
}

/** ① 编译产物：从 node_modules/.cache/steploop-core 读取常量。 */
function readCompiledConstants(compiledRoot) {
  try {
    const diagnostics = require(path.join(compiledRoot, 'diagnostics.js'))
    const routeModel = require(path.join(compiledRoot, 'route-model.js'))
    const constants = {
      algorithm: routeModel.ROUTE_ALGORITHM_VERSION,
      diagnosticAlgorithm: diagnostics.DIAGNOSTIC_ALGORITHM_VERSION,
      bundle: diagnostics.DIAGNOSTIC_BUNDLE_VERSION,
      routeModel: routeModel.ROUTE_MODEL_VERSION,
      parameter: diagnostics.DIAGNOSTIC_PARAMETER_VERSION,
    }
    for (const key of SOURCE_KEYS) {
      const spec = SOURCE_CONSTANT_SPECS[key]
      const valid =
        spec.type === 'number'
          ? Number.isFinite(constants[key])
          : isNonEmptyString(constants[key])
      if (!valid) {
        return {
          constants: null,
          error: `${compiledRoot} 导出的 ${spec.name} 类型非法：${fmt(constants[key])}`,
        }
      }
    }
    return { constants, error: null }
  } catch (error) {
    return {
      constants: null,
      error: `${compiledRoot} 不可读（${
        error instanceof Error ? error.message : String(error)
      }）`,
    }
  }
}

/**
 * ② 源码文本：用正则直接从 src 的 .ts 读取常量声明（只读，不修改源码）。
 * 源码文本是**唯一必需**的核对来源（决策 2）：5 个常量必须全部解析出来，
 * 任何一个被改名/删除/文件不可读，调用方都必须判失败。
 */
function readSourceConstants(sourceRoot) {
  const constants = {}
  const missing = []
  for (const key of SOURCE_KEYS) {
    const spec = SOURCE_CONSTANT_SPECS[key]
    const filePath = path.join(sourceRoot, spec.file)
    let text
    try {
      text = fs.readFileSync(filePath, 'utf8')
    } catch (error) {
      return {
        constants: null,
        missing,
        invalid: null,
        unreadable: {
          path: filePath,
          name: spec.name,
          file: spec.file,
          reason: oneLine(error instanceof Error ? error.message : String(error)),
        },
      }
    }
    const pattern = new RegExp(
      `export\\s+const\\s+${spec.name}\\s*(?::[^=]*)?=\\s*(?:'([^']*)'|"([^"]*)"|(-?\\d+(?:\\.\\d+)?))`,
    )
    const match = pattern.exec(text)
    if (!match) {
      missing.push({ name: spec.name, file: spec.file })
      continue
    }
    constants[key] =
      match[3] !== undefined
        ? Number(match[3])
        : (match[1] ?? match[2] ?? '').trim()
  }
  if (missing.length) {
    return { constants: null, missing, invalid: null, unreadable: null }
  }
  for (const key of SOURCE_KEYS) {
    const spec = SOURCE_CONSTANT_SPECS[key]
    const value = constants[key]
    const valid =
      spec.type === 'number' ? Number.isFinite(value) : isNonEmptyString(value)
    if (!valid) {
      return {
        constants: null,
        missing: [],
        invalid: { name: spec.name, file: spec.file, value },
        unreadable: null,
      }
    }
  }
  return { constants, missing: [], invalid: null, unreadable: null, sourceRoot }
}

/** 把源码解析问题转成失败文案（必须点出常量名与文件，决策 2）。 */
function describeSourceIssue(sourceRead, sourceRoot) {
  if (sourceRead.unreadable) {
    return `算法版本常量来源不可用：源码文本不可读 ${
      sourceRead.unreadable.path
    }（${sourceRead.unreadable.reason}），无法解析 ${
      sourceRead.unreadable.name
    }（${sourceRead.unreadable.file}）`
  }
  if (sourceRead.missing?.length) {
    return `算法版本常量来源不可用：${sourceRead.missing
      .map((item) => `源码文本中找不到 ${item.name}（${item.file}）`)
      .join('；')}`
  }
  if (sourceRead.invalid) {
    return `算法版本常量来源不可用：源码文本中 ${
      sourceRead.invalid.name
    }（${sourceRead.invalid.file}）取值非法：${fmt(sourceRead.invalid.value)}`
  }
  return `算法版本常量来源不可用：源码文本不可解析（${sourceRoot}）`
}

/**
 * ③ 交叉核对：
 * - 源码文本必须可解析（决策 2），否则失败；
 * - 可用来源（源码文本；若编译产物存在则也算一个）两两一致，且都与冗余声明一致（决策 3）；
 * - 冗余声明永不单独放行（决策 4）；
 * - 编译产物缺失不是失败，但 note 必须列出实际来源（决策 5）。
 */
function crossCheckConstants({
  compiled,
  compiledReason,
  source,
  sourceIssue,
  declared,
  compiledRoot,
  sourceRoot,
}) {
  const failures = []
  const notes = []
  const available = []
  if (source) available.push(['源码文本', source, sourceRoot])
  if (compiled) available.push(['编译产物', compiled, compiledRoot])

  if (!source) {
    failures.push(
      sourceIssue ??
        `算法版本常量来源不可用：源码文本不可解析（${sourceRoot}），无法核对算法版本`,
    )
  }

  for (let left = 0; left < available.length; left += 1) {
    for (let right = left + 1; right < available.length; right += 1) {
      for (const key of SOURCE_KEYS) {
        if (available[left][1][key] !== available[right][1][key]) {
          failures.push(
            `算法版本常量来源冲突：${available[left][0]} ${describeConstant(
              key,
              available[left][1][key],
            )}，${available[right][0]} ${describeConstant(
              key,
              available[right][1][key],
            )}`,
          )
        }
      }
    }
  }

  for (const [label, table, root] of available) {
    for (const key of SOURCE_KEYS) {
      if (table[key] !== declared[key]) {
        failures.push(
          `算法版本常量冲突：${label}（${root}）${describeConstant(
            key,
            table[key],
          )}，脚本冗余声明 ${fmt(declared[key])}`,
        )
      }
    }
  }

  // 通过时优先采用编译产物（其次源码文本），作为报告版本一致性比对的期望值。
  const constants = source || compiled ? { ...(compiled ?? source) } : null
  if (!failures.length) {
    const parts = []
    if (source) parts.push(`源码文本（${path.join(sourceRoot, 'src', 'core')}/*.ts）`)
    if (compiled) parts.push(`编译产物（${compiledRoot}）`)
    notes.push(
      compiled
        ? `算法版本常量来源：${parts.join(' + ')} + 冗余声明；各来源与冗余声明一致`
        : `算法版本常量来源：${parts.join(' + ')} + 冗余声明；编译产物不可用（${oneLine(
            compiledReason ?? '未知原因',
          )}）`,
    )
  }
  return { constants, notes, failures }
}

/**
 * 解析并核对算法版本常量。返回 { constants, notes, failures }：
 * constants 为 null 或 failures 非空时，门禁必须失败。
 */
function loadSourceConstants(options = {}) {
  const compiledRoot = resolveRootOption(
    options.compiledRoot,
    COMPILED_ROOT_ENV,
    DEFAULT_COMPILED_ROOT,
  )
  const sourceRoot = resolveRootOption(
    options.sourceRoot,
    SOURCE_ROOT_ENV,
    DEFAULT_SOURCE_ROOT,
  )
  const compiledRead = readCompiledConstants(compiledRoot)
  const sourceRead = readSourceConstants(sourceRoot)
  const sourceIssue = sourceRead.constants
    ? null
    : describeSourceIssue(sourceRead, sourceRoot)
  const checked = crossCheckConstants({
    compiled: compiledRead.constants,
    compiledReason: compiledRead.error,
    source: sourceRead.constants,
    sourceIssue,
    declared: DECLARED_SOURCE_CONSTANTS,
    compiledRoot,
    sourceRoot,
  })
  return {
    constants: checked.constants,
    notes: checked.notes,
    failures: checked.failures,
    compiledRoot,
    sourceRoot,
  }
}

/** 把长文本截断，避免把整个数据集清单打进日志。 */
function truncate(text, max) {
  if (typeof text !== 'string' || text.length <= max) return text
  return `${text.slice(0, max)}…（共 ${text.length} 字符已截断）`
}

/** 从 datasetManifest.files 推导覆盖率与分母，用于和报告声明值交叉核对。 */
function deriveFromManifest(files) {
  const routes = new Set()
  const devices = new Set()
  const brands = new Set()
  const participants = new Set()
  const carryModes = new Set()
  const barometer = new Set()
  const climbSamplesPerRoute = {}
  const negativeSamplesByKind = {}
  const unknownActivities = new Set()
  const unknownStructures = new Set()
  let eligibleBundles = 0
  let climbBundles = 0
  let negativeBundles = 0

  for (const entry of files) {
    if (!isObject(entry)) continue
    const routeKey = isNonEmptyString(entry.routeId)
      ? entry.routeId
      : entry.routeStructure
    if (isNonEmptyString(routeKey)) routes.add(routeKey)
    if (isNonEmptyString(entry.deviceCohortId)) devices.add(entry.deviceCohortId)
    if (isNonEmptyString(entry.deviceBrand)) brands.add(entry.deviceBrand)
    if (isNonEmptyString(entry.participantId))
      participants.add(entry.participantId)
    if (isNonEmptyString(entry.carryMode)) carryModes.add(entry.carryMode)
    if (typeof entry.barometerAvailable === 'boolean') {
      barometer.add(entry.barometerAvailable ? 'available' : 'unavailable')
    }
    if (
      isNonEmptyString(entry.routeStructure) &&
      !KNOWN_ROUTE_STRUCTURES.includes(entry.routeStructure)
    ) {
      unknownStructures.add(entry.routeStructure)
    }
    if (entry.sampleQuality === 'invalid') continue
    eligibleBundles += 1
    if (entry.activity === 'climb_up') {
      climbBundles += 1
      if (isNonEmptyString(routeKey)) {
        climbSamplesPerRoute[routeKey] = (climbSamplesPerRoute[routeKey] ?? 0) + 1
      }
    } else if (isNonEmptyString(entry.activity)) {
      const kind = ACTIVITY_ALIASES[entry.activity]
      if (!kind) {
        unknownActivities.add(entry.activity)
      } else {
        negativeBundles += 1
        negativeSamplesByKind[kind] = (negativeSamplesByKind[kind] ?? 0) + 1
      }
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
    unknownActivities: [...unknownActivities].sort(),
    unknownStructures: [...unknownStructures].sort(),
    eligibleBundles,
    climbBundles,
    negativeBundles,
  }
}

function resolveManifestPath(manifestPath, baseDir) {
  const candidates = [
    path.resolve(manifestPath),
    path.resolve(baseDir, manifestPath),
    path.resolve(process.cwd(), manifestPath),
  ]
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate
      }
    } catch {
      // 忽略不可读候选，继续尝试下一个
    }
  }
  return null
}

/**
 * 门禁核心：不抛异常，返回 { passed, failures, notes, summary }。
 * report 为已解析的报告对象；baseDir 为报告文件所在目录（解析相对 manifestPath）。
 */
function checkReport(report, options = {}) {
  const failures = []
  const notes = [...(options.notes ?? [])]
  const fail = (message) => failures.push(message)
  const constants = options.constants
  const baseDir = options.baseDir ?? process.cwd()

  // 版本常量必须来自已核对的来源；这里绝不回退到脚本内冗余声明（fail closed）。
  if (!isObject(constants)) {
    return {
      passed: false,
      failures: [
        '算法版本常量来源不可用，无法验证版本一致性：未提供已核对的常量表（编译产物/源码文本均不可用）',
      ],
      notes,
      summary: null,
    }
  }

  const requireAtLeast = (name, value, minimum) => {
    if (!Number.isFinite(value)) {
      fail(`${name}: ${fmt(value)} 不是有限数字（要求 >= ${minimum}）`)
      return
    }
    if (value < minimum) fail(`${name}: ${value} < ${minimum}`)
  }
  const requireAtMost = (name, value, maximum) => {
    if (!Number.isFinite(value)) {
      fail(`${name}: ${fmt(value)} 不是有限数字（要求 <= ${maximum}）`)
      return
    }
    if (value > maximum) fail(`${name}: ${value} > ${maximum}`)
  }

  if (!isObject(report)) {
    return {
      passed: false,
      failures: ['报告根节点必须是 JSON 对象'],
      notes,
      summary: null,
    }
  }

  // F15：provenance.manifestPath 解析出的目录，用于稍后校验数据集文件实体。
  let manifestDir = null

  // === 顶层契约与来源声明 ===
  if (report.reportVersion !== 2) {
    fail(`reportVersion: 必须为 2（实际 ${fmt(report.reportVersion)}）`)
  }
  if (!isIsoTimestamp(report.generatedAt)) {
    fail(`generatedAt: 缺失或不是 ISO-8601 时间戳（实际 ${fmt(report.generatedAt)}）`)
  }
  if (report.gateEligibility !== RELEASE_READY) {
    fail(
      `gateEligibility: 必须为 ${RELEASE_READY}（实际 ${fmt(report.gateEligibility)}）`,
    )
  }

  let declaredManifestHash = null
  const provenance = report.provenance
  if (!isObject(provenance)) {
    if (!hasOwn(report, 'provenance')) {
      fail('provenance: 缺失（顶层必需字段）')
    } else {
      fail(`provenance: 类型错误（实际 ${fmt(provenance)}）`)
    }
  } else {
    const kind = provenance.kind
    if (kind === 'synthetic') {
      fail('provenance.kind=synthetic：合成数据不得产出 RELEASE_READY')
    } else if (kind !== 'real') {
      fail(`provenance.kind: 必须为 "real"（实际 ${fmt(kind)}）`)
    }

    if (!isNonEmptyString(provenance.manifestPath)) {
      fail(`provenance.manifestPath: 缺失或为空（实际 ${fmt(provenance.manifestPath)}）`)
    } else {
      const resolved = resolveManifestPath(provenance.manifestPath, baseDir)
      // F15：记录 manifest 所在目录，稍后据此校验数据集文件实体。
      if (resolved) manifestDir = path.dirname(resolved)
      if (!resolved) {
        fail(
          `provenance.manifestPath: 文件不存在（${fmt(provenance.manifestPath)}）`,
        )
      } else {
        let bytes = null
        try {
          bytes = fs.readFileSync(resolved)
        } catch (error) {
          fail(
            `provenance.manifestPath: 无法读取 ${resolved}（${
              error instanceof Error ? error.message : String(error)
            }）`,
          )
        }
        if (bytes) {
          const actual = sha256Hex(bytes)
          if (!isSha256(provenance.manifestSha256)) {
            fail('provenance.manifestSha256: 缺失或不是 64 位 hex')
          } else if (
            provenance.manifestSha256.toLowerCase() !== actual.toLowerCase()
          ) {
            fail(
              `provenance.manifestSha256: 与 manifest 文件实际 hash 不符（实际 ${actual}，报告 ${provenance.manifestSha256}）`,
            )
          }
          try {
            const fileManifest = JSON.parse(bytes.toString('utf8'))
            if (
              canonicalHash(fileManifest) !== canonicalHash(report.datasetManifest)
            ) {
              fail(
                'report.datasetManifest: 与 provenance.manifestPath 指向的文件内容不一致',
              )
            }
          } catch (error) {
            fail(
              `provenance.manifestPath: 文件不是合法 JSON（${
                error instanceof Error ? error.message : String(error)
              }）`,
            )
          }
        }
      }
    }

    declaredManifestHash = canonicalHash(report.datasetManifest)
    if (!isSha256(provenance.datasetManifestSha256)) {
      fail('provenance.datasetManifestSha256: 缺失或不是 64 位 hex')
    } else if (
      provenance.datasetManifestSha256.toLowerCase() !== declaredManifestHash
    ) {
      fail(
        `provenance.datasetManifestSha256: 与报告内 datasetManifest 内容 hash 不符（实际 ${declaredManifestHash}，报告 ${provenance.datasetManifestSha256}）`,
      )
    }

    if (!isNonEmptyString(provenance.collectorOwner)) {
      fail(
        `provenance.collectorOwner: 缺失或为空（实际 ${fmt(provenance.collectorOwner)}）`,
      )
    }

    if (provenance.kind === 'real') {
      const verification = provenance.verification
      if (!isObject(verification)) {
        fail(
          'provenance.verification: real 来源必须提供核验记录（reviewer/reviewedAt/method）',
        )
      } else {
        if (!isNonEmptyString(verification.reviewer)) {
          fail('provenance.verification.reviewer: 缺失或为空')
        }
        if (!isIsoTimestamp(verification.reviewedAt)) {
          fail(
            `provenance.verification.reviewedAt: 缺失或不是 ISO-8601（实际 ${fmt(
              verification.reviewedAt,
            )}）`,
          )
        }
        if (!isNonEmptyString(verification.method)) {
          fail('provenance.verification.method: 缺失或为空')
        }
      }
    }
  }

  // === 算法版本一致性 ===
  const versions = report.algorithmVersions
  if (!isObject(versions)) {
    if (!hasOwn(report, 'algorithmVersions')) {
      fail('algorithmVersions: 缺失（顶层必需字段）')
    } else {
      fail(`algorithmVersions: 类型错误（实际 ${fmt(versions)}）`)
    }
  } else {
    for (const key of ['algorithm', 'diagnosticAlgorithm', 'parameter']) {
      if (!isNonEmptyString(versions[key])) {
        fail(`algorithmVersions.${key}: 缺失或为空`)
      } else if (versions[key] !== constants[key]) {
        fail(
          `algorithmVersions.${key}: 与源码常量不符（源码 ${constants[key]}，报告 ${versions[key]}）`,
        )
      }
    }
    for (const key of ['bundle', 'routeModel']) {
      if (!Number.isFinite(versions[key])) {
        fail(`algorithmVersions.${key}: 缺失或不是有限数字`)
      } else if (versions[key] !== constants[key]) {
        fail(
          `algorithmVersions.${key}: 与源码常量不符（源码 ${constants[key]}，报告 ${versions[key]}）`,
        )
      }
    }
  }

  // === datasetManifest ===
  const manifest = report.datasetManifest
  let manifestFiles = null
  if (!isObject(manifest)) {
    if (!hasOwn(report, 'datasetManifest')) {
      fail('datasetManifest: 缺失（顶层必需字段）')
    } else {
      fail(
        // 只截断显示：把整个 manifest 数组打进日志既噪声大又可能泄露采集元数据
        `datasetManifest: 类型错误（期望对象 { manifestVersion, files }，实际 ${truncate(
          fmt(manifest),
          200,
        )}）`,
      )
    }
  } else {
    if (manifest.manifestVersion !== 1) {
      fail(
        `datasetManifest.manifestVersion: 必须为 1（实际 ${fmt(
          manifest.manifestVersion,
        )}）`,
      )
    }
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      fail('datasetManifest.files: 缺失、不是数组或为空')
    } else {
      manifestFiles = manifest.files
    }
  }

  // === 数据集文件实体校验（F15）===
  // 只校验 manifest 里声明的 sha256 而不校验磁盘上的真实字节，等于让
  // 「数据集可复现」变成一句空话：报告可以声称任何 hash。
  // 规则：声明了 file + sha256 的每一条，都必须能在数据集目录里找到并逐字节对上。
  // 数据集目录 = D01_GATE_DATASET_ROOT（显式指定）或 provenance.manifestPath 所在目录。
  if (manifestFiles && manifestDir) {
    const datasetRoot = process.env.D01_GATE_DATASET_ROOT
      ? path.resolve(process.env.D01_GATE_DATASET_ROOT)
      : manifestDir
    let verified = 0
    manifestFiles.forEach((entry, index) => {
      if (!isObject(entry)) return
      if (!isNonEmptyString(entry.file) || !isSha256(entry.sha256)) return
      const at = `datasetManifest.files[${index}]`
      const resolvedFile = path.isAbsolute(entry.file)
        ? entry.file
        : path.resolve(datasetRoot, entry.file)
      if (!fs.existsSync(resolvedFile)) {
        fail(`${at}.file: 文件不存在（${truncate(resolvedFile, 200)}）`)
        return
      }
      let actual = null
      try {
        actual = crypto
          .createHash('sha256')
          .update(fs.readFileSync(resolvedFile))
          .digest('hex')
      } catch (error) {
        fail(
          `${at}.file: 无法读取 ${truncate(resolvedFile, 200)}（${
            error instanceof Error ? error.message : String(error)
          }）`,
        )
        return
      }
      if (actual !== entry.sha256.toLowerCase()) {
        fail(
          `${at}.sha256: 与文件实际内容不符（实际 ${actual}，报告 ${entry.sha256}）`,
        )
        return
      }
      verified += 1
    })
    notes.push(
      `数据集文件实体校验：${verified}/${manifestFiles.length} 条逐字节匹配（数据集目录 ${datasetRoot}）`,
    )
  } else if (manifestFiles) {
    fail(
      'datasetManifest.files: 无法校验文件实体（缺少可解析的 provenance.manifestPath 目录；' +
        '可用 D01_GATE_DATASET_ROOT 显式指定数据集目录）',
    )
  }

  let derived = null
  if (manifestFiles) {
    const seenFiles = new Map()
    const seenBundles = new Map()
    const entryVersions = {
      algorithmVersion: new Set(),
      parameterVersion: new Set(),
      bundleVersion: new Set(),
      routeModelVersion: new Set(),
    }
    const entryVersionIndexes = {
      algorithmVersion: [],
      parameterVersion: [],
      bundleVersion: [],
      routeModelVersion: [],
    }
    manifestFiles.forEach((entry, index) => {
      const at = `datasetManifest.files[${index}]`
      if (!isObject(entry)) {
        fail(`${at}: 不是对象`)
        return
      }
      const stringFields = [
        'file',
        'sha256',
        'bundleId',
        'deviceCohortId',
        'carryMode',
        'activity',
        'routeStructure',
        'participantId',
        'deviceBrand',
        'algorithmVersion',
        'parameterVersion',
      ]
      for (const field of stringFields) {
        if (!isNonEmptyString(entry[field])) {
          fail(`${at}.${field}: 缺失或为空`)
        }
      }
      if (entry.routeId !== undefined && !isNonEmptyString(entry.routeId)) {
        fail(`${at}.routeId: 存在但为空（路线身份回退到 routeStructure）`)
      }
      if (isNonEmptyString(entry.sha256) && !isSha256(entry.sha256)) {
        fail(`${at}.sha256: 不是 64 位 hex`)
      }
      if (typeof entry.barometerAvailable !== 'boolean') {
        fail(`${at}.barometerAvailable: 缺失或不是布尔值`)
      }
      for (const field of ['bundleVersion', 'routeModelVersion']) {
        if (!Number.isFinite(entry[field])) {
          fail(`${at}.${field}: 缺失或不是有限数字`)
        }
      }
      if (
        entry.sampleQuality !== undefined &&
        !SAMPLE_QUALITIES.includes(entry.sampleQuality)
      ) {
        fail(
          `${at}.sampleQuality: 未知取值 ${fmt(entry.sampleQuality)}（仅 valid/degraded/invalid）`,
        )
      }
      if (isNonEmptyString(entry.carryMode) && !CARRY_MODES.includes(entry.carryMode)) {
        fail(`${at}.carryMode: 未知取值 ${fmt(entry.carryMode)}`)
      }
      if (
        isNonEmptyString(entry.activity) &&
        entry.activity !== 'climb_up' &&
        !ACTIVITY_ALIASES[entry.activity]
      ) {
        fail(`${at}.activity: 未知取值 ${fmt(entry.activity)}`)
      }
      if (
        isNonEmptyString(entry.routeStructure) &&
        !KNOWN_ROUTE_STRUCTURES.includes(entry.routeStructure)
      ) {
        fail(
          `${at}.routeStructure: 未知取值 ${fmt(
            entry.routeStructure,
          )}（仅 standard/switchback/long_landing）`,
        )
      }

      if (isNonEmptyString(entry.file)) {
        seenFiles.set(entry.file, (seenFiles.get(entry.file) ?? 0) + 1)
      }
      if (isNonEmptyString(entry.bundleId)) {
        seenBundles.set(entry.bundleId, (seenBundles.get(entry.bundleId) ?? 0) + 1)
      }

      // 每个 bundle 的版本字段都必须与源码常量一致；不一致说明混入了其它算法/参数版本。
      // 逐条信息在循环后汇总输出（避免同因重复上百行），但一个都不放过。
      for (const key of sortedKeys(entryVersions)) {
        if (entry[key] !== undefined) {
          entryVersions[key].add(entry[key])
          if (entry[key] !== constants[VERSION_KEY_TO_CONSTANT[key]]) {
            entryVersionIndexes[key].push(index)
          }
        }
      }
    })

    for (const [file, count] of seenFiles) {
      if (count > 1) fail(`datasetManifest.files: 文件名重复 ${fmt(file)}（${count} 次）`)
    }
    for (const [bundleId, count] of seenBundles) {
      if (count > 1) {
        fail(`datasetManifest.files: bundleId 重复 ${fmt(bundleId)}（${count} 次）`)
      }
    }
    for (const key of sortedKeys(entryVersions)) {
      const values = [...entryVersions[key]]
      const sourceValue = constants[VERSION_KEY_TO_CONSTANT[key]]
      if (values.length > 1) {
        const indexes = entryVersionIndexes[key]
        const shown = indexes
          .slice(0, 3)
          .map((index) => `files[${index}]`)
          .join('、')
        fail(
          `datasetManifest: 混用多个 ${key}（${values
            .map((value) => fmt(value))
            .join('、')}）：混用${
            VERSION_KEY_LABELS[key]
          }，禁止 RELEASE_READY（涉及 ${indexes.length} 条，例如 ${shown}）`,
        )
      } else if (values.length === 1 && values[0] !== sourceValue) {
        fail(
          `datasetManifest.files[*].${key}: ${fmt(values[0])} ≠ 源码 ${fmt(
            sourceValue,
          )}（全部条目与源码常量不符）`,
        )
      }
    }

    derived = deriveFromManifest(manifestFiles)
    for (const activity of derived.unknownActivities) {
      fail(`datasetManifest: 未知 activity ${fmt(activity)}`)
    }
  } else {
    notes.push(
      'datasetManifest 不可用：覆盖率推导未执行（manifest 缺失/为空本身已判失败）',
    )
  }

  // === coverage：声明值门槛 + 与 manifest 推导值一致性 ===
  const coverage = report.coverage
  let declaredClimbPerRoute = null
  let declaredNegativeByKind = null
  if (!isObject(coverage)) {
    if (!hasOwn(report, 'coverage')) {
      fail('coverage: 缺失（顶层必需字段）')
    } else {
      fail(`coverage: 类型错误（实际 ${fmt(coverage)}）`)
    }
  } else {
    requireAtLeast('coverage.routes', coverage.routes, THRESHOLDS.coverageRoutes)
    requireAtLeast('coverage.devices', coverage.devices, THRESHOLDS.coverageDevices)
    requireAtLeast('coverage.brands', coverage.brands, THRESHOLDS.coverageBrands)
    requireAtLeast(
      'coverage.participants',
      coverage.participants,
      THRESHOLDS.coverageParticipants,
    )

    if (!Array.isArray(coverage.carryModes)) {
      fail(`coverage.carryModes: 缺失或不是数组（实际 ${fmt(coverage.carryModes)}）`)
    } else {
      for (const mode of CARRY_MODES) {
        if (!coverage.carryModes.includes(mode)) {
          fail(`coverage.carryModes: 缺少 ${mode}`)
        }
      }
    }
    if (!Array.isArray(coverage.barometer)) {
      fail(`coverage.barometer: 缺失或不是数组（实际 ${fmt(coverage.barometer)}）`)
    } else {
      for (const state of BAROMETER_STATES) {
        if (!coverage.barometer.includes(state)) {
          fail(`coverage.barometer: 缺少 ${state}`)
        }
      }
    }

    if (!isObject(coverage.climbSamplesPerRoute)) {
      fail(
        `coverage.climbSamplesPerRoute: 缺失或不是对象（实际 ${fmt(
          coverage.climbSamplesPerRoute,
        )}）`,
      )
    } else {
      declaredClimbPerRoute = coverage.climbSamplesPerRoute
      const routeIds = sortedKeys(declaredClimbPerRoute)
      if (routeIds.length < THRESHOLDS.coverageRoutes) {
        fail(
          `coverage.climbSamplesPerRoute: 只有 ${routeIds.length} 条路线 < ${THRESHOLDS.coverageRoutes}`,
        )
      }
      for (const routeId of routeIds) {
        const value = declaredClimbPerRoute[routeId]
        if (!Number.isFinite(value) || value < THRESHOLDS.climbSamplesPerRoute) {
          fail(
            `coverage.climbSamplesPerRoute.${routeId}: ${fmt(value)} < ${THRESHOLDS.climbSamplesPerRoute}（每路线正样本不足）`,
          )
        }
      }
    }

    if (!isObject(coverage.negativeSamplesByKind)) {
      fail(
        `coverage.negativeSamplesByKind: 缺失或不是对象（实际 ${fmt(
          coverage.negativeSamplesByKind,
        )}）`,
      )
    } else {
      declaredNegativeByKind = coverage.negativeSamplesByKind
      for (const kind of REQUIRED_NEGATIVE_KINDS) {
        const value = declaredNegativeByKind[kind]
        if (!Number.isFinite(value) || value < THRESHOLDS.negativeSamplesPerKind) {
          fail(
            `coverage.negativeSamplesByKind.${kind}: ${fmt(value)} < ${THRESHOLDS.negativeSamplesPerKind}（负样本类别样本不足）`,
          )
        }
      }
    }
  }

  // === 分母与整体数值门槛（既有阈值，不下调） ===
  requireAtLeast(
    'eligibleBundles',
    report.eligibleBundles,
    THRESHOLDS.minimumEligibleBundles,
  )
  requireAtLeast('climbBundles', report.climbBundles, THRESHOLDS.minimumClimbBundles)
  requireAtLeast(
    'negativeBundles',
    report.negativeBundles,
    THRESHOLDS.minimumNegativeBundles,
  )
  requireAtLeast(
    'exactFinalFloorRate',
    report.exactFinalFloorRate,
    THRESHOLDS.exactFinalFloorRate,
  )
  requireAtLeast(
    'floorEventPrecision',
    report.floorEventPrecision,
    THRESHOLDS.floorEventPrecision,
  )
  requireAtLeast(
    'floorEventRecall',
    report.floorEventRecall,
    THRESHOLDS.floorEventRecall,
  )
  requireAtMost(
    'negativeFalsePositiveRate',
    report.negativeFalsePositiveRate,
    THRESHOLDS.maximumNegativeFalsePositiveRate,
  )
  requireAtMost(
    'medianFloorLatencyMs',
    report.medianFloorLatencyMs,
    THRESHOLDS.maximumMedianFloorLatencyMs,
  )
  requireAtMost(
    'p95FloorLatencyMs',
    report.p95FloorLatencyMs,
    THRESHOLDS.maximumP95FloorLatencyMs,
  )

  if (
    Number.isFinite(report.eligibleBundles) &&
    Number.isFinite(report.climbBundles) &&
    Number.isFinite(report.negativeBundles) &&
    report.eligibleBundles !== report.climbBundles + report.negativeBundles
  ) {
    fail(
      `分母不一致：eligibleBundles=${report.eligibleBundles} ≠ climbBundles+negativeBundles=${
        report.climbBundles + report.negativeBundles
      }`,
    )
  }
  if (
    report.bundles !== undefined &&
    (!Number.isFinite(report.bundles) || report.bundles < report.eligibleBundles)
  ) {
    fail(
      `bundles: ${fmt(report.bundles)} 不是 >= eligibleBundles=${fmt(
        report.eligibleBundles,
      )} 的有限数字`,
    )
  }

  // === cohorts：必需分组必须存在且非空，且所有分组都要过分组门槛 ===
  const cohorts = report.cohorts
  if (!isObject(cohorts)) {
    if (!hasOwn(report, 'cohorts')) {
      fail('cohorts: 缺失（顶层必需字段）')
    } else {
      fail(`cohorts: 类型错误（实际 ${fmt(cohorts)}）`)
    }
  } else {
    for (const name of REQUIRED_COHORT_MAPS) {
      const map = cohorts[name]
      if (!isObject(map)) {
        fail(`cohorts.${name}: 缺失或不是对象（必需分组）`)
      } else if (Object.keys(map).length === 0) {
        fail(`cohorts.${name}: 为空，缺少必需分组`)
      }
    }
    for (const name of REQUIRED_COHORT_MAPS) {
      const map = cohorts[name]
      if (!isObject(map)) continue
      for (const group of sortedKeys(map)) {
        const summary = map[group]
        const at = `cohorts.${name}.${group}`
        if (!isObject(summary)) {
          fail(`${at}: 不是对象`)
          continue
        }
        if (!Number.isFinite(summary.bundles) || summary.bundles < 1) {
          fail(`${at}.bundles: ${fmt(summary.bundles)} < 1（分组必须有样本）`)
        }
        requireAtLeast(
          `${at}.exactFinalFloorRate`,
          summary.exactFinalFloorRate,
          THRESHOLDS.cohortExactFinalFloorRate,
        )
        requireAtLeast(
          `${at}.floorEventPrecision`,
          summary.floorEventPrecision,
          THRESHOLDS.cohortFloorEventPrecision,
        )
        requireAtLeast(
          `${at}.floorEventRecall`,
          summary.floorEventRecall,
          THRESHOLDS.cohortFloorEventRecall,
        )
        requireAtMost(
          `${at}.falsePositiveRate`,
          summary.falsePositiveRate,
          THRESHOLDS.maximumCohortFalsePositiveRate,
        )
        if (!hasOwn(summary, 'p95FloorLatencyMs')) {
          fail(`${at}.p95FloorLatencyMs: 字段缺失`)
        } else if (summary.p95FloorLatencyMs !== null) {
          requireAtMost(
            `${at}.p95FloorLatencyMs`,
            summary.p95FloorLatencyMs,
            THRESHOLDS.maximumCohortP95FloorLatencyMs,
          )
        }
      }
    }
  }

  // === 声明覆盖率 vs manifest 推导覆盖率（防手工 JSON 只写漂亮数字） ===
  if (derived && declaredClimbPerRoute && declaredNegativeByKind) {
    const compareCount = (label, declared, actual) => {
      if (declared !== actual) {
        fail(`${label}: 与 datasetManifest 推导不一致（声明 ${fmt(declared)}，推导 ${fmt(actual)}）`)
      }
    }
    compareCount('coverage.routes', coverage.routes, derived.routes.length)
    compareCount('coverage.devices', coverage.devices, derived.devices.length)
    compareCount('coverage.brands', coverage.brands, derived.brands.length)
    compareCount(
      'coverage.participants',
      coverage.participants,
      derived.participants.length,
    )
    if (Array.isArray(coverage.carryModes)) {
      compareCount(
        'coverage.carryModes',
        [...coverage.carryModes].sort().join(','),
        derived.carryModes.join(','),
      )
    }
    if (Array.isArray(coverage.barometer)) {
      compareCount(
        'coverage.barometer',
        [...coverage.barometer].sort().join(','),
        derived.barometer.join(','),
      )
    }
    compareCount(
      'eligibleBundles',
      report.eligibleBundles,
      derived.eligibleBundles,
    )
    compareCount('climbBundles', report.climbBundles, derived.climbBundles)
    compareCount(
      'negativeBundles',
      report.negativeBundles,
      derived.negativeBundles,
    )

    for (const routeId of [
      ...new Set([
        ...sortedKeys(declaredClimbPerRoute),
        ...sortedKeys(derived.climbSamplesPerRoute),
      ]),
    ].sort()) {
      const declared = declaredClimbPerRoute[routeId]
      const actual = derived.climbSamplesPerRoute[routeId]
      if (declared !== actual) {
        fail(
          `coverage.climbSamplesPerRoute.${routeId}: 与 datasetManifest 推导不一致（声明 ${fmt(declared)}，推导 ${fmt(actual)}）`,
        )
      }
    }
    for (const kind of [
      ...new Set([
        ...sortedKeys(declaredNegativeByKind),
        ...sortedKeys(derived.negativeSamplesByKind),
      ]),
    ].sort()) {
      const declared = declaredNegativeByKind[kind]
      const actual = derived.negativeSamplesByKind[kind]
      if (declared !== actual) {
        fail(
          `coverage.negativeSamplesByKind.${kind}: 与 datasetManifest 推导不一致（声明 ${fmt(declared)}，推导 ${fmt(actual)}）`,
        )
      }
    }
    for (const structure of derived.unknownStructures) {
      // 单条 entry 已报过；这里只保留汇总，避免重复噪声
      if (!failures.some((message) => message.includes('routeStructure: 未知取值'))) {
        fail(`datasetManifest: 未知 routeStructure ${fmt(structure)}`)
      }
    }
  }

  const summary = {
    datasetManifestSha256: declaredManifestHash,
    eligibleBundles: report.eligibleBundles,
    climbBundles: report.climbBundles,
    negativeBundles: report.negativeBundles,
    routes: derived ? derived.routes.length : coverage?.routes,
    devices: derived ? derived.devices.length : coverage?.devices,
    brands: derived ? derived.brands.length : coverage?.brands,
    participants: derived ? derived.participants.length : coverage?.participants,
  }

  return { passed: failures.length === 0, failures, notes, summary }
}

/** 门禁入口：解析并核对常量来源、校验报告，返回附带常量的结果。 */
function gateReport(report, options = {}) {
  const loaded = loadSourceConstants({
    compiledRoot: options.compiledRoot,
    sourceRoot: options.sourceRoot,
  })
  const notes = [...loaded.notes, ...(options.notes ?? [])]
  if (!loaded.constants || loaded.failures.length) {
    return {
      passed: false,
      failures: loaded.failures.length
        ? loaded.failures
        : ['算法版本常量来源不可用，无法验证版本一致性'],
      notes,
      summary: null,
      constants: loaded.constants ?? null,
    }
  }
  const result = checkReport(report, { ...options, notes, constants: loaded.constants })
  return { ...result, constants: loaded.constants }
}

function main(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    console.error('用法：node scripts/check-release-gates.cjs report.json')
    return 2
  }
  const reportPath = argv.find((argument) => !argument.startsWith('-'))
  const resolved = path.resolve(reportPath)
  let report
  try {
    report = JSON.parse(fs.readFileSync(resolved, 'utf8'))
  } catch (error) {
    console.error(
      `报告读取失败：${resolved}（${
        error instanceof Error ? error.message : String(error)
      }）`,
    )
    return 2
  }

  const result = gateReport(report, { baseDir: path.dirname(resolved) })
  for (const note of result.notes) console.error(`[gate] ${note}`)
  if (!result.passed) {
    console.error(`可信训练版发布门禁未通过（${result.failures.length} 项）：`)
    for (const failure of result.failures) console.error(`- ${failure}`)
    return 1
  }
  console.log(`可信训练版算法发布门禁通过：${RELEASE_READY}`)
  console.log(
    `[gate] manifest=${result.summary.datasetManifestSha256} eligibleBundles=${
      result.summary.eligibleBundles
    } climbBundles=${result.summary.climbBundles} negativeBundles=${
      result.summary.negativeBundles
    } routes=${result.summary.routes} devices=${result.summary.devices} brands=${
      result.summary.brands
    } participants=${result.summary.participants}`,
  )
  return 0
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2))
}

module.exports = {
  DECLARED_SOURCE_CONSTANTS,
  SOURCE_CONSTANT_SPECS,
  DEFAULT_COMPILED_ROOT,
  DEFAULT_SOURCE_ROOT,
  COMPILED_ROOT_ENV,
  SOURCE_ROOT_ENV,
  THRESHOLDS,
  REQUIRED_COHORT_MAPS,
  REQUIRED_NEGATIVE_KINDS,
  ACTIVITY_ALIASES,
  KNOWN_ROUTE_STRUCTURES,
  RELEASE_READY,
  canonicalHash,
  stableStringify,
  sha256Hex,
  deriveFromManifest,
  readCompiledConstants,
  readSourceConstants,
  describeSourceIssue,
  crossCheckConstants,
  loadSourceConstants,
  checkReport,
  gateReport,
}
