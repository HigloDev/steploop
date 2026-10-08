import { extractFrames } from './analysis'
import { FreeRecognizer } from './free-recognizer'
import { RouteRecognizer } from './recognizer'
import {
  CarryMode,
  RecognitionEvent,
  RouteTemplate,
  SensorSample,
} from './types'

export const DIAGNOSTIC_BUNDLE_VERSION = 2 as const
export const DIAGNOSTIC_ALGORITHM_VERSION = 'motion-v3'
export const DIAGNOSTIC_PARAMETER_VERSION = 'motion-trend-1'

export type DiagnosticSampleQuality = 'valid' | 'degraded' | 'invalid'

export interface DiagnosticSamplingStats {
  targetIntervalMs: number
  actualHz: number
  jitterMs: number
  droppedRatio: number
  longestGapMs: number
}

export interface DiagnosticBarometerStats {
  sampleCount: number
  driftHpa: number
  baselineStdDevHpa: number
}

export type DiagnosticActivity =
  | 'climb_up'
  | 'walk_flat'
  | 'elevator_up'
  | 'elevator_down'
  | 'stairs_down'
  | 'escalator'
  | 'stationary'

export interface DiagnosticAnnotation {
  type: 'floor' | 'turn' | 'pause' | 'resume'
  atMs: number
  floor?: number
}

export interface DiagnosticGap {
  startMs: number
  endMs: number
}

/**
 * 可重复回放的本地诊断包。路线模板会在导出前移除 location，原始样本时间
 * 统一改为相对采集开始的毫秒数，避免把真实地点和设备时间写入文件。
 */
export interface DiagnosticBundle {
  version: typeof DIAGNOSTIC_BUNDLE_VERSION
  id: string
  createdAt: number
  durationMs: number
  activity: DiagnosticActivity
  carryMode: CarryMode
  routeTemplate: RouteTemplate
  truth: {
    startFloor: number
    endFloor: number
    completedFloors: number
  }
  samples: SensorSample[]
  annotations: DiagnosticAnnotation[]
  gaps: DiagnosticGap[]
  capture: {
    platform: string
    systemVersion: string
    sampleIntervalTargetMs: number
    barometerAvailable: boolean
    deviceCohortId: string
    /**
     * 采集者化名代码（例如 `p01`）。
     * 禁止写入姓名/手机号/邮箱等身份信息：只允许 ^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$。
     * 旧版诊断包没有该字段（旧包解析后为 undefined）。
     */
    participantId?: string
    /** 设备品牌（小写，例如 `xiaomi`）。用于按品牌分组，旧包为 undefined。 */
    deviceBrand?: string
  }
  algorithmVersion: string
  parameterVersion: string
  datasetId: string
  routeModelVersion: number
  sampleQuality: DiagnosticSampleQuality
  samplingStats: DiagnosticSamplingStats
  barometerStats: DiagnosticBarometerStats
  invalidReasons: string[]
}

export interface DiagnosticReplayResult {
  bundleId: string
  activity: DiagnosticActivity
  carryMode: CarryMode
  platform: string
  deviceCohortId: string
  /**
   * 采集者化名。旧包/未填写时为空字符串——门禁必须把它当作“缺失”而 fail closed，
   * 绝不在这里编造一个可用的假身份。
   */
  participantId: string
  /** 设备品牌。旧包/未填写时为空字符串（同上，不编造）。 */
  deviceBrand: string
  sampleQuality: DiagnosticSampleQuality
  routeStructure: string
  expectedFloors: number
  recognizedFloors: number
  finalFloorError: number
  exactFinalFloor: boolean
  falsePositive: boolean
  floorEventPrecision: number
  floorEventRecall: number
  medianFloorLatencyMs: number | null
  p95FloorLatencyMs: number | null
  sampleCount: number
  durationMs: number
  barometerAvailable: boolean
  recognitionEvents: RecognitionEvent[]
}

export interface DiagnosticAggregateReport {
  datasetId: string
  bundles: number
  eligibleBundles: number
  invalidBundles: number
  climbBundles: number
  negativeBundles: number
  exactFinalFloorRate: number
  floorEventPrecision: number
  floorEventRecall: number
  negativeFalsePositiveRate: number
  medianFloorLatencyMs: number | null
  p95FloorLatencyMs: number | null
  cohorts: {
    activity: Record<string, DiagnosticCohortSummary>
    carryMode: Record<string, DiagnosticCohortSummary>
    platform: Record<string, DiagnosticCohortSummary>
    barometer: Record<string, DiagnosticCohortSummary>
    deviceCohort: Record<string, DiagnosticCohortSummary>
    routeStructure: Record<string, DiagnosticCohortSummary>
    quality: Record<string, DiagnosticCohortSummary>
  }
  results: DiagnosticReplayResult[]
}

export interface DiagnosticCohortSummary {
  bundles: number
  exactFinalFloorRate: number
  floorEventPrecision: number
  floorEventRecall: number
  falsePositiveRate: number
  p95FloorLatencyMs: number | null
}

export interface DiagnosticRegression {
  metric:
    | 'exactFinalFloorRate'
    | 'floorEventPrecision'
    | 'floorEventRecall'
    | 'negativeFalsePositiveRate'
    | 'p95FloorLatencyMs'
  baseline: number
  current: number
  delta: number
}

export interface DiagnosticComparison {
  passed: boolean
  datasetCompatible: boolean
  regressions: DiagnosticRegression[]
}

const FLOOR_EVENT_TOLERANCE_MS = 4_000
const MINIMUM_VALID_DURATION_MS = 3_000
const MAXIMUM_VALID_GAP_MS = 1_000
const MAXIMUM_DEGRADED_DROPPED_RATIO = 0.15

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function percentile(values: number[], ratio: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  )
  return sorted[index]
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    values.length
  return Math.sqrt(variance)
}

function datasetFingerprint(ids: string[]): string {
  const text = [...ids].sort().join('|')
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `dataset-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function calculateDiagnosticQuality(
  samples: SensorSample[],
  targetIntervalMs: number,
  durationMs?: number,
): {
  sampleQuality: DiagnosticSampleQuality
  samplingStats: DiagnosticSamplingStats
  barometerStats: DiagnosticBarometerStats
  invalidReasons: string[]
} {
  const sorted = [...samples].sort((a, b) => a.t - b.t)
  const intervals = sorted
    .slice(1)
    .map((sample, index) => sample.t - sorted[index].t)
    .filter((value) => finite(value) && value >= 0)
  const observedDuration =
    durationMs ??
    (sorted.length > 1 ? sorted[sorted.length - 1].t - sorted[0].t : 0)
  const averageInterval = intervals.length
    ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length
    : 0
  const expectedSamples =
    targetIntervalMs > 0 ? Math.max(1, observedDuration / targetIntervalMs) : 0
  const droppedRatio = expectedSamples
    ? Math.max(0, Math.min(1, 1 - sorted.length / expectedSamples))
    : 1
  const longestGapMs = intervals.length ? Math.max(...intervals) : observedDuration
  const pressures = sorted
    .map((sample) => sample.pressure)
    .filter((value): value is number => finite(value) && value > 0)
  const baseline = pressures.slice(0, Math.min(10, pressures.length))
  const invalidReasons: string[] = []
  if (sorted.length < 2) invalidReasons.push('insufficient_samples')
  if (observedDuration < MINIMUM_VALID_DURATION_MS) {
    invalidReasons.push('duration_too_short')
  }
  if (longestGapMs > MAXIMUM_VALID_GAP_MS) {
    invalidReasons.push('sensor_gap_over_1s')
  }
  if (droppedRatio > MAXIMUM_DEGRADED_DROPPED_RATIO) {
    invalidReasons.push('excessive_sample_loss')
  }
  const sampleQuality: DiagnosticSampleQuality = invalidReasons.length
    ? 'invalid'
    : droppedRatio > 0.05 || longestGapMs > targetIntervalMs * 5
      ? 'degraded'
      : 'valid'

  return {
    sampleQuality,
    samplingStats: {
      targetIntervalMs,
      actualHz: averageInterval > 0 ? 1000 / averageInterval : 0,
      jitterMs: standardDeviation(intervals),
      droppedRatio,
      longestGapMs,
    },
    barometerStats: {
      sampleCount: pressures.length,
      driftHpa:
        pressures.length > 1 ? pressures[pressures.length - 1] - pressures[0] : 0,
      baselineStdDevHpa: standardDeviation(baseline),
    },
    invalidReasons,
  }
}

export function sanitizeDiagnosticRoute(route: RouteTemplate): RouteTemplate {
  const { location: _location, ...withoutLocation } = route
  return {
    ...withoutLocation,
    name: '诊断路线',
    device: {
      platform: route.device.platform || 'unknown',
      model: 'redacted',
      system: route.device.system || 'unknown',
    },
  }
}

export function normalizeDiagnosticSamples(
  samples: SensorSample[],
  startedAt: number,
): SensorSample[] {
  return samples.map((sample) => ({
    ...sample,
    t: Math.max(0, sample.t - startedAt),
  }))
}

/**
 * 导出前最后一道脱敏：去掉绝对采集日历时间，并再次剥离路线地点与机型。
 * 操作系统版本与传感器相对时间戳保留，用于复现识别结果。
 */
export function sanitizeDiagnosticBundleForExport(
  bundle: DiagnosticBundle,
): DiagnosticBundle {
  return {
    ...bundle,
    createdAt: 0,
    routeTemplate: sanitizeDiagnosticRoute(bundle.routeTemplate),
    samples: bundle.samples.map((sample) => ({ ...sample })),
  }
}

/**
 * 化名代码规则：不含任何身份信息，只允许字母数字下划线连字符，且必须至少含一个字母。
 * 「必须含字母」是为了挡住纯数字串（手机号/工号/身份证片段最容易写进这个字段）。
 */
export const PARTICIPANT_ID_PATTERN = /^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/
/** 设备品牌规则：小写字母数字连字符，例如 xiaomi / samsung / oneplus。 */
export const DEVICE_BRAND_PATTERN = /^[a-z0-9][a-z0-9-]{0,23}$/

export function isValidParticipantId(value: string): boolean {
  return PARTICIPANT_ID_PATTERN.test(value)
}

export function isValidDeviceBrand(value: string): boolean {
  return DEVICE_BRAND_PATTERN.test(value)
}

export function parseDiagnosticBundle(value: unknown): DiagnosticBundle {
  if (!value || typeof value !== 'object') {
    throw new Error('诊断文件不是有效对象')
  }
  const rawVersion = (value as { version?: number }).version
  const bundle = value as Partial<DiagnosticBundle>
  if (rawVersion !== 1 && rawVersion !== DIAGNOSTIC_BUNDLE_VERSION) {
    throw new Error(`不支持的诊断文件版本：${String(rawVersion)}`)
  }
  if (!bundle.routeTemplate || !Array.isArray(bundle.routeTemplate.segments)) {
    throw new Error('诊断文件缺少路线模板')
  }
  if (!Array.isArray(bundle.samples) || bundle.samples.length < 2) {
    throw new Error('诊断文件缺少有效传感器样本')
  }
  if (
    !bundle.truth ||
    !finite(bundle.truth.startFloor) ||
    !finite(bundle.truth.endFloor) ||
    !finite(bundle.truth.completedFloors)
  ) {
    throw new Error('诊断文件缺少真实楼层标注')
  }
  const targetIntervalMs =
    bundle.samplingStats?.targetIntervalMs ??
    bundle.capture?.sampleIntervalTargetMs ??
    20
  const calculated = calculateDiagnosticQuality(
    bundle.samples,
    targetIntervalMs,
    bundle.durationMs,
  )
  const normalized: DiagnosticBundle = {
    ...(bundle as Omit<DiagnosticBundle, 'version'>),
    version: DIAGNOSTIC_BUNDLE_VERSION,
    algorithmVersion:
      bundle.algorithmVersion ?? 'legacy-v1',
    parameterVersion: bundle.parameterVersion ?? 'legacy-v1',
    datasetId: bundle.datasetId ?? 'unassigned',
    routeModelVersion:
      bundle.routeModelVersion ?? bundle.routeTemplate.version ?? 1,
    sampleQuality: bundle.sampleQuality ?? calculated.sampleQuality,
    samplingStats: bundle.samplingStats ?? calculated.samplingStats,
    barometerStats: bundle.barometerStats ?? calculated.barometerStats,
    invalidReasons: bundle.invalidReasons ?? calculated.invalidReasons,
    capture: {
      ...bundle.capture,
      platform: bundle.capture?.platform ?? 'unknown',
      systemVersion: bundle.capture?.systemVersion ?? 'unknown',
      sampleIntervalTargetMs: targetIntervalMs,
      barometerAvailable: Boolean(bundle.capture?.barometerAvailable),
      deviceCohortId: bundle.capture?.deviceCohortId ?? 'legacy-unknown',
    },
  }
  // 身份字段：『没写』是允许的（旧包），『写了但不合法』必须报错——
  // 否则一个含姓名/手机号的诊断包会被静默接受并进入数据集。
  const rawParticipantId = bundle.capture?.participantId
  if (rawParticipantId !== undefined) {
    if (
      typeof rawParticipantId !== 'string' ||
      !isValidParticipantId(rawParticipantId)
    ) {
      throw new Error(
        '诊断文件 capture.participantId 不合法：只允许化名代码（字母数字/下划线/连字符，≤32 字符），不得包含姓名、手机号或邮箱',
      )
    }
    normalized.capture.participantId = rawParticipantId
  }
  const rawDeviceBrand = bundle.capture?.deviceBrand
  if (rawDeviceBrand !== undefined) {
    if (
      typeof rawDeviceBrand !== 'string' ||
      !isValidDeviceBrand(rawDeviceBrand)
    ) {
      throw new Error(
        '诊断文件 capture.deviceBrand 不合法：只允许小写字母数字与连字符（例如 xiaomi、samsung、oneplus）',
      )
    }
    normalized.capture.deviceBrand = rawDeviceBrand
  }
  if (
    normalized.sampleQuality === 'invalid' &&
    !normalized.invalidReasons.length
  ) {
    normalized.invalidReasons = ['marked_invalid_by_tester']
  }
  return normalized
}

function replaySensorTimeline(
  bundle: DiagnosticBundle,
): ReturnType<RouteRecognizer['finish']> {
  const template = bundle.routeTemplate
  const recognizer = template.segments.length
    ? new RouteRecognizer(template, 0)
    : new FreeRecognizer(template, 0)
  const frames = extractFrames(bundle.samples)
  const timeline: Array<
    | { type: 'frame'; atMs: number; frame: (typeof frames)[number] }
    | { type: 'barometer'; atMs: number; pressure: number }
  > = frames.map((frame) => ({
    type: 'frame',
    atMs: frame.endMs,
    frame,
  }))

  let lastBarometerAt = -Infinity
  let lastPressure: number | undefined
  bundle.samples.forEach((sample) => {
    if (!finite(sample.pressure) || sample.pressure <= 0) return
    // SensorRecorder 会把最近一次 5Hz 气压值附在 50Hz 加速度样本上。
    // 回放时去重，避免相同气压值被重复平滑几十次。
    if (
      sample.pressure === lastPressure &&
      sample.t - lastBarometerAt < 180
    ) {
      return
    }
    if (sample.t - lastBarometerAt < 180) return
    lastPressure = sample.pressure
    lastBarometerAt = sample.t
    timeline.push({
      type: 'barometer',
      atMs: sample.t,
      pressure: sample.pressure,
    })
  })

  timeline
    .sort((a, b) => a.atMs - b.atMs || (a.type === 'frame' ? -1 : 1))
    .forEach((item) => {
      if (item.type === 'frame') recognizer.pushFrame(item.frame)
      else recognizer.pushBarometer(item.pressure, item.atMs)
    })

  return recognizer.finish(bundle.durationMs)
}

function matchFloorEvents(
  expected: DiagnosticAnnotation[],
  recognized: RecognitionEvent[],
): { matches: number; latencies: number[] } {
  const candidates = recognized.filter(
    (event): event is RecognitionEvent & { floor: number } =>
      event.type === 'floor' && finite(event.floor),
  )
  const used = new Set<number>()
  const latencies: number[] = []

  expected.forEach((annotation) => {
    if (!finite(annotation.floor)) return
    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY
    candidates.forEach((event, index) => {
      if (used.has(index) || event.floor !== annotation.floor) return
      const distance = Math.abs(event.t - annotation.atMs)
      if (distance <= FLOOR_EVENT_TOLERANCE_MS && distance < bestDistance) {
        bestDistance = distance
        bestIndex = index
      }
    })
    if (bestIndex >= 0) {
      used.add(bestIndex)
      latencies.push(candidates[bestIndex].t - annotation.atMs)
    }
  })

  return { matches: used.size, latencies }
}

export function replayDiagnosticBundle(
  input: DiagnosticBundle | unknown,
): DiagnosticReplayResult {
  const bundle = parseDiagnosticBundle(input)
  const session = replaySensorTimeline(bundle)
  const expectedEvents = bundle.annotations.filter(
    (annotation) => annotation.type === 'floor',
  )
  const recognizedEvents = session.events.filter(
    (event) => event.type === 'floor',
  )
  const matched = matchFloorEvents(expectedEvents, recognizedEvents)
  const expectedFloors = Math.max(0, bundle.truth.completedFloors)
  const recognizedFloors = Math.max(0, session.floorsCompleted)
  const negative = bundle.activity !== 'climb_up'

  return {
    bundleId: bundle.id,
    activity: bundle.activity,
    carryMode: bundle.carryMode,
    platform: bundle.capture.platform,
    deviceCohortId: bundle.capture.deviceCohortId,
    participantId: bundle.capture.participantId ?? '',
    deviceBrand: bundle.capture.deviceBrand ?? '',
    sampleQuality: bundle.sampleQuality,
    routeStructure:
      bundle.routeTemplate.markers.filter((marker) => marker.type === 'turn')
        .length > bundle.truth.completedFloors
        ? 'switchback'
        : bundle.routeTemplate.markers.some(
              (marker) => marker.type === 'landing' && marker.endMs !== undefined,
            )
          ? 'long_landing'
          : 'standard',
    expectedFloors,
    recognizedFloors,
    finalFloorError: recognizedFloors - expectedFloors,
    exactFinalFloor: recognizedFloors === expectedFloors,
    falsePositive: negative && recognizedFloors > 0,
    floorEventPrecision: recognizedEvents.length
      ? matched.matches / recognizedEvents.length
      : expectedEvents.length
        ? 0
        : 1,
    floorEventRecall: expectedEvents.length
      ? matched.matches / expectedEvents.length
      : recognizedEvents.length
        ? 0
        : 1,
    medianFloorLatencyMs: percentile(matched.latencies, 0.5),
    p95FloorLatencyMs: percentile(matched.latencies, 0.95),
    sampleCount: bundle.samples.length,
    durationMs: bundle.durationMs,
    barometerAvailable: bundle.capture.barometerAvailable,
    recognitionEvents: session.events,
  }
}

export function aggregateDiagnosticResults(
  results: DiagnosticReplayResult[],
): DiagnosticAggregateReport {
  const eligible = results.filter((result) => result.sampleQuality !== 'invalid')
  const climb = eligible.filter((result) => result.activity === 'climb_up')
  const negative = eligible.filter((result) => result.activity !== 'climb_up')
  const latency = eligible.flatMap((result) =>
    result.medianFloorLatencyMs === null ? [] : [result.medianFloorLatencyMs],
  )
  const average = (values: number[]) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0

  const summarizeCohort = (
    items: DiagnosticReplayResult[],
  ): DiagnosticCohortSummary => ({
    bundles: items.length,
    exactFinalFloorRate: average(
      items.map((result) => (result.exactFinalFloor ? 1 : 0)),
    ),
    floorEventPrecision: average(
      items.map((result) => result.floorEventPrecision),
    ),
    floorEventRecall: average(items.map((result) => result.floorEventRecall)),
    falsePositiveRate: average(
      items.map((result) => (result.falsePositive ? 1 : 0)),
    ),
    p95FloorLatencyMs: percentile(
      items.flatMap((result) =>
        result.p95FloorLatencyMs === null ? [] : [result.p95FloorLatencyMs],
      ),
      0.95,
    ),
  })
  const groupBy = (
    key: (result: DiagnosticReplayResult) => string,
  ): Record<string, DiagnosticCohortSummary> => {
    const groups = new Map<string, DiagnosticReplayResult[]>()
    eligible.forEach((result) => {
      const name = key(result)
      groups.set(name, [...(groups.get(name) ?? []), result])
    })
    return Object.fromEntries(
      [...groups.entries()].map(([name, items]) => [name, summarizeCohort(items)]),
    )
  }

  return {
    datasetId: datasetFingerprint(results.map((result) => result.bundleId)),
    bundles: results.length,
    eligibleBundles: eligible.length,
    invalidBundles: results.length - eligible.length,
    climbBundles: climb.length,
    negativeBundles: negative.length,
    exactFinalFloorRate: average(
      climb.map((result) => (result.exactFinalFloor ? 1 : 0)),
    ),
    floorEventPrecision: average(
      climb.map((result) => result.floorEventPrecision),
    ),
    floorEventRecall: average(
      climb.map((result) => result.floorEventRecall),
    ),
    negativeFalsePositiveRate: average(
      negative.map((result) => (result.falsePositive ? 1 : 0)),
    ),
    medianFloorLatencyMs: percentile(latency, 0.5),
    p95FloorLatencyMs: percentile(
      eligible.flatMap((result) =>
        result.p95FloorLatencyMs === null ? [] : [result.p95FloorLatencyMs],
      ),
      0.95,
    ),
    cohorts: {
      activity: groupBy((result) => result.activity),
      carryMode: groupBy((result) => result.carryMode),
      platform: groupBy((result) => result.platform),
      barometer: groupBy((result) =>
        result.barometerAvailable ? 'available' : 'unavailable',
      ),
      deviceCohort: groupBy((result) => result.deviceCohortId),
      routeStructure: groupBy((result) => result.routeStructure),
      quality: groupBy((result) => result.sampleQuality),
    },
    results,
  }
}

/**
 * 比较同一数据集上的两个报告。准确率允许 0.5 个百分点的统计抖动，
 * Precision/Recall 允许 1 个百分点，P95 延迟允许增加 500ms。
 */
export function compareDiagnosticReports(
  baseline: DiagnosticAggregateReport,
  current: DiagnosticAggregateReport,
): DiagnosticComparison {
  const regressions: DiagnosticRegression[] = []
  const baselineIds = Array.isArray(baseline.results)
    ? baseline.results.map((result) => result.bundleId).sort()
    : []
  const currentIds = Array.isArray(current.results)
    ? current.results.map((result) => result.bundleId).sort()
    : []
  const datasetCompatible =
    !baselineIds.length ||
    (baselineIds.length === currentIds.length &&
      baselineIds.every((id, index) => id === currentIds[index]))
  const checkHigherIsBetter = (
    metric:
      | 'exactFinalFloorRate'
      | 'floorEventPrecision'
      | 'floorEventRecall',
    tolerance: number,
  ) => {
    const previous = baseline[metric]
    const next = current[metric]
    if (next < previous - tolerance) {
      regressions.push({
        metric,
        baseline: previous,
        current: next,
        delta: next - previous,
      })
    }
  }
  checkHigherIsBetter('exactFinalFloorRate', 0.005)
  checkHigherIsBetter('floorEventPrecision', 0.01)
  checkHigherIsBetter('floorEventRecall', 0.01)

  if (
    current.negativeFalsePositiveRate >
    baseline.negativeFalsePositiveRate + 0.005
  ) {
    regressions.push({
      metric: 'negativeFalsePositiveRate',
      baseline: baseline.negativeFalsePositiveRate,
      current: current.negativeFalsePositiveRate,
      delta:
        current.negativeFalsePositiveRate -
        baseline.negativeFalsePositiveRate,
    })
  }

  if (
    baseline.p95FloorLatencyMs !== null &&
    current.p95FloorLatencyMs !== null &&
    current.p95FloorLatencyMs > baseline.p95FloorLatencyMs + 500
  ) {
    regressions.push({
      metric: 'p95FloorLatencyMs',
      baseline: baseline.p95FloorLatencyMs,
      current: current.p95FloorLatencyMs,
      delta: current.p95FloorLatencyMs - baseline.p95FloorLatencyMs,
    })
  }

  return {
    passed: datasetCompatible && regressions.length === 0,
    datasetCompatible,
    regressions,
  }
}
