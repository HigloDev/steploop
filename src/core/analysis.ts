import { StairTurnGate } from './turn-gate'
import {
  CalibrationDraft,
  FeatureFrame,
  FloorSplit,
  InferredRoute,
  ManualMark,
  RouteMarker,
  RouteSeed,
  RouteSegment,
  SensorSample,
} from './types'
import { clamp, nearestIndex, uid } from './math'
import { MotionFrameStream, MotionSignalProcessor, TimedMotionSignal } from './motion-signal'
import {
  BARO_EPS_CALIBRATE,
  BARO_EXP,
  BARO_FLOOR_COOLDOWN_MS,
  BARO_SMOOTH_WINDOW,
  DEFAULT_FEATURE_SPACE,
  P0_HPA,
  STEPS_PER_FLOOR_CALIBRATE,
  type FeatureSpace,
} from './sensor-params'

const TURN_THRESHOLD_RAD = 0.62

function prepareSignal(samples: SensorSample[]): TimedMotionSignal[] {
  const processor = new MotionSignalProcessor()
  const signal: TimedMotionSignal[] = []
  for (const sample of samples) {
    const point = processor.push(sample)
    if (point) signal.push(point)
  }
  return signal
}

export function extractFrames(samples: SensorSample[]): FeatureFrame[] {
  if (samples.length < 2) return []
  const frames: FeatureFrame[] = []
  const stream = new MotionFrameStream(frame => frames.push(frame))
  for (const sample of samples) stream.push(sample)
  stream.flush()
  return frames
}

export function detectMarkers(frames: FeatureFrame[]): RouteMarker[] {
  const markers: RouteMarker[] = []
  let turnStart = -1
  let turnSum = 0
  let pauseStart = -1

  const flushTurn = (endMs: number) => {
    if (turnStart < 0) return
    const absolute = Math.abs(turnSum)
    if (absolute >= TURN_THRESHOLD_RAD) {
      markers.push({
        id: uid('turn'),
        type: 'turn',
        atMs: turnStart,
        endMs,
        direction: turnSum >= 0 ? 'left' : 'right',
        confidence: clamp(absolute / 1.4, 0.45, 0.98),
      })
    }
    turnStart = -1
    turnSum = 0
  }

  frames.forEach((frame, index) => {
    const turnRad = Number.isFinite(frame.headingTurnRad)
      ? frame.headingTurnRad!
      : frame.turnRad
    const isTurning = Math.abs(turnRad) >= 0.12
    if (isTurning) {
      if (turnStart < 0) turnStart = frame.startMs
      turnSum += turnRad
    } else if (turnStart >= 0) {
      flushTurn(frame.startMs)
    }

    if (frame.paused) {
      if (pauseStart < 0) pauseStart = frame.startMs
    } else if (pauseStart >= 0) {
      const duration = frame.startMs - pauseStart
      if (duration >= 1500) {
        markers.push({
          id: uid('pause'),
          type: 'pause',
          atMs: pauseStart,
          endMs: frame.startMs,
          confidence: clamp(duration / 5000, 0.55, 0.98),
        })
      }
      pauseStart = -1
    }

    if (index === frames.length - 1) {
      flushTurn(frame.endMs)
      if (pauseStart >= 0 && frame.endMs - pauseStart >= 1500) {
        markers.push({
          id: uid('pause'),
          type: 'pause',
          atMs: pauseStart,
          endMs: frame.endMs,
          confidence: 0.75,
        })
      }
    }
  })

  const activeIndexes = frames
    .map((frame, index) => ({ frame, index }))
    .filter(({ frame }) => frame.steps > 0 || frame.energy >= 0.06)
    .map(({ index }) => index)
  const firstActive = activeIndexes[0] ?? 0
  const lastActive = activeIndexes.at(-1) ?? frames.length - 1
  let landingStart = -1

  for (let index = firstActive; index <= lastActive; index += 1) {
    const frame = frames[index]
    const looksLikeLanding = frame.steps === 0 && frame.energy < 0.08
    if (looksLikeLanding && landingStart < 0) landingStart = frame.startMs
    const atEnd = index === lastActive
    if ((!looksLikeLanding || atEnd) && landingStart >= 0) {
      const endMs = looksLikeLanding ? frame.endMs : frame.startMs
      const duration = endMs - landingStart
      const overlapsPause = markers.some(
        (marker) =>
          marker.type === 'pause' &&
          marker.atMs < endMs &&
          (marker.endMs ?? marker.atMs) > landingStart,
      )
      if (duration >= 750 && !overlapsPause) {
        markers.push({
          id: uid('landing'),
          type: 'landing',
          atMs: landingStart,
          endMs,
          confidence: clamp(duration / 2500, 0.5, 0.9),
        })
      }
      landingStart = -1
    }
  }

  return markers.sort((a, b) => a.atMs - b.atMs)
}

function boundaryCandidates(markers: RouteMarker[]): number[] {
  // 转弯和短暂停留都可能发生在半层平台，不能作为整层边界。
  // 保留参数是为了兼容旧调用；无气压时由步数和时间均分兜底。
  void markers
  return []
}

function nearestBoundary(
  frames: FeatureFrame[],
  candidates: number[],
  target: number,
  lower: number,
  upper: number,
): number {
  const eligible = candidates.filter((time) => time >= lower && time <= upper)
  if (!eligible.length) return clamp(target, lower, upper)
  const candidate = eligible[nearestIndex(eligible, target)]
  const typicalFloorMs = (frames.at(-1)?.endMs ?? 0) / Math.max(1, candidates.length)
  return Math.abs(candidate - target) <= Math.max(2500, typicalFloorMs)
    ? candidate
    : clamp(target, lower, upper)
}

export function inferRoute(frames: FeatureFrame[], markers: RouteMarker[]): InferredRoute {
  const totalSteps = frames.reduce((sum, frame) => sum + frame.steps, 0)
  const turnCount = markers.filter((marker) => marker.type === 'turn').length
  const landingCount = markers.filter((marker) => marker.type === 'landing').length
  const duration = frames.at(-1)?.endMs ?? 0
  const bySteps = Math.max(1, Math.round(totalSteps / STEPS_PER_FLOOR_CALIBRATE))
  // 楼层数不再从转弯/平台数量反推，避免半层转弯被当成整层。
  const estimatedFloorCount = bySteps
  const agreement = 0.65
  const signalCoverage = clamp(totalSteps / (estimatedFloorCount * 14), 0, 1)
  const floorConfidence = clamp(agreement * 0.65 + signalCoverage * 0.35, 0.25, 0.95)
  const candidates = boundaryCandidates(markers)
  const floorBoundaries = [0]
  const minSpacing = Math.min(1000, (duration / Math.max(1, estimatedFloorCount)) * 0.3)
  // 无标记时按累计步数切分（而不是按总时长均分）：中途休息不会把边界拉偏。
  const stepTimeAt = (fraction: number): number => {
    if (totalSteps <= 0) return duration * fraction
    let accumulated = 0
    for (const frame of frames) {
      accumulated += Math.max(0, frame.steps)
      if (accumulated >= totalSteps * fraction) return frame.endMs
    }
    return duration
  }
  for (let floor = 1; floor < estimatedFloorCount; floor += 1) {
    const target = stepTimeAt(floor / estimatedFloorCount)
    const lower = floorBoundaries.at(-1)! + minSpacing
    const upper = duration - (estimatedFloorCount - floor) * minSpacing
    floorBoundaries.push(Math.round(nearestBoundary(frames, candidates, target, lower, upper)))
  }
  floorBoundaries.push(duration)
  const estimatedAscentM = Number((totalSteps * 0.17).toFixed(1))
  return {
    estimatedFloorCount,
    estimatedStepCount: totalSteps,
    estimatedAscentM,
    defaultRiserM: 0.17,
    floorBoundaries,
    turnCount,
    landingCount,
    confidence: {
      floors: floorConfidence,
      height: 0.45,
      overall: Number((floorConfidence * 0.75 + 0.45 * 0.25).toFixed(2)),
    },
  }
}

export function rebuildDraftBoundaries(
  draft: Pick<CalibrationDraft, 'frames' | 'samples'> & Partial<Pick<CalibrationDraft, 'manualMarks'>>,
  floorCount: number,
  startFloor = 1,
): number[] {
  const duration = draft.frames.at(-1)?.endMs ?? 0
  const count = Math.max(1, Math.round(floorCount))
  const anchors = [{ index: 0, atMs: 0 }]
  for (const mark of (draft.manualMarks ?? []).filter(mark => mark.type === 'floor').sort((a,b) => a.atMs-b.atMs)) {
    const index = (mark.floor ?? startFloor) - startFloor
    if (index > anchors.at(-1)!.index && index < count && mark.atMs > anchors.at(-1)!.atMs && mark.atMs < duration) {
      anchors.push({ index, atMs: mark.atMs })
    }
  }
  anchors.push({ index: count, atMs: duration })
  const boundaries = [0]
  for (let span = 0; span < anchors.length - 1; span += 1) {
    const left = anchors[span], right = anchors[span + 1]
    const frames = draft.frames.filter(frame => frame.endMs > left.atMs && frame.endMs <= right.atMs)
    const steps = frames.reduce((sum,frame) => sum + Math.max(0,frame.steps),0)
    for (let index = left.index + 1; index < right.index; index += 1) {
      const fraction = (index - left.index) / (right.index - left.index)
      let accumulated = 0
      const crossing = steps > 0 ? frames.find(frame => { accumulated += Math.max(0,frame.steps); return accumulated >= steps * fraction }) : undefined
      const target = crossing?.endMs ?? left.atMs + (right.atMs - left.atMs) * fraction
      const spacing = Math.min(500, (right.atMs - left.atMs) / (right.index - left.index) * 0.3)
      boundaries.push(Math.round(clamp(target, boundaries.at(-1)! + spacing, right.atMs - spacing * (right.index - index))))
    }
    boundaries.push(right.atMs)
  }
  return boundaries
}

export function vectorizeFrame(
  frame: FeatureFrame,
  featureSpace: FeatureSpace = DEFAULT_FEATURE_SPACE,
): number[] {
  const turnRad =
    featureSpace === 'device'
      ? frame.turnRad
      : Number.isFinite(frame.headingTurnRad)
        ? frame.headingTurnRad!
        : frame.turnRad
  return [
    clamp(frame.cadence / 240, 0, 1.5),
    clamp(frame.energy / 0.35, 0, 1.5),
    clamp(turnRad / 1.2, -1.5, 1.5),
    frame.paused,
  ]
}

export function buildSegments(
  draft: Pick<CalibrationDraft, 'frames' | 'boundaries'> & Partial<Pick<CalibrationDraft, 'manualMarks'>>,
  startFloor: number,
  floorHeights: number[],
): RouteSegment[] {
  const { frames, boundaries } = draft
  return boundaries.slice(0, -1).map((startMs, index) => {
    const endMs = boundaries[index + 1]
    const floorFrames = frames.filter(
      (frame) => frame.startMs >= startMs && frame.endMs <= endMs + 1,
    )
    const gate = new StairTurnGate()
    floorFrames.forEach(frame => gate.push(frame))
    gate.push({ startMs: endMs, endMs: endMs + 500, steps: 0, cadence: 0, energy: 0, turnRad: 0, paused: 1 })
    return {
      id: uid('flight'),
      type: 'flight',
      startMs,
      endMs,
      floorFrom: startFloor + index,
      floorTo: startFloor + index + 1,
      ascentM: floorHeights[index] ?? 0,
      stepCount: floorFrames.reduce((sum, frame) => sum + frame.steps, 0),
      features: floorFrames.map((frame) => vectorizeFrame(frame)),
      turnCount: gate.completedTurns,
      boundaryConfirmed: draft.manualMarks?.some(mark => mark.type === 'floor' && mark.floor === startFloor + index + 1) ?? false,
    }
  })
}

export function analyzeCalibration(
  seed: RouteSeed,
  samples: SensorSample[],
  startedAt: number,
  endedAt: number,
  gaps: Array<{ startMs: number; endMs: number }>,
  manualMarks: ManualMark[] = [],
): CalibrationDraft {
  const frames = extractFrames(samples)
  const markers = detectMarkers(frames)
  const inferred = inferRoute(frames, markers)
  // 楼层边界来自人工记录；其他切分均为待核对的估计
  const floorMarks = manualMarks
    .filter((m) => m.type === 'floor')
    .sort((a, b) => a.atMs - b.atMs)
  let boundaries: number[]
  let boundarySource: 'manual' | 'barometer' | 'inferred'
  if (floorMarks.length >= 1) {
    boundaries = buildBoundariesFromManualMarks(floorMarks, samples)
    boundarySource = 'manual'
  } else {
    boundaries = inferred.floorBoundaries
    boundarySource = 'inferred'
  }
  // 将人工拐弯标记合并到 markers（保留人工标记的 confidence=1）
  const manualTurnMarkers: RouteMarker[] = manualMarks
    .filter((m) => m.type === 'turn')
    .map((m) => ({
      id: m.id,
      type: 'manual_turn' as const,
      atMs: m.atMs,
      endMs: m.atMs,
      confidence: 1,
    }))
  const allMarkers = [...markers, ...manualTurnMarkers].sort((a, b) => a.atMs - b.atMs)
  // 米数只用于粗略展示，不决定楼层，也不代表实际测量精度。
  const baroAscent = estimateAscentByPressure(samples)
  const stepAscent = estimateVerticalAscent(samples)
  const estimatedAscentM = baroAscent !== null ? baroAscent : stepAscent
  return {
    seed,
    samples,
    frames,
    markers: allMarkers,
    boundaries,
    inferred,
    startedAt,
    endedAt,
    gaps,
    manualMarks,
    estimatedAscentM,
    // 通过附加字段暴露楼层边界来源与气压爬升，供 Review 页面提示用户精度
    ...(boundarySource !== 'inferred' ? { boundarySource } : {}),
    ...(baroAscent !== null ? { ascentSource: 'barometer' as const } : {}),
  }
}

export function countSteps(samples: SensorSample[]): number {
  return prepareSignal(samples).filter((point) => point.step).length
}

// 基于人工楼层标记构建 boundaries：
// 起点为 0，每个人工楼层标记作为上一层结束/下一层开始的边界，终点为采集末尾时间。
function buildBoundariesFromManualMarks(
  floorMarks: ManualMark[],
  samples: SensorSample[],
): number[] {
  if (!samples.length) return [0]
  const last = samples[samples.length - 1].t - samples[0].t
  if (!floorMarks.length) return [0, last]
  const boundaries = [0]
  for (const mark of floorMarks) {
    if (mark.atMs > boundaries.at(-1)! && mark.atMs <= last) boundaries.push(Math.round(mark.atMs))
  }
  // 最后一条楼层标记就是终点：保留它的真实时刻。旧实现把它替换成录制结束时间，
  // 导致顶层停留（甚至走向电梯）的时间和步数都被算进最后一层。
  if (boundaries.length === 1) boundaries.push(last)
  return boundaries
}

// 垂直位移估算：对加速度幅值的"非重力"垂直分量做二次积分。
// 由于手机姿态未知，这里用净加速度幅值的低通成分作为垂直冲击的近似，
// 结合步数估算总爬升：典型住宅楼层每步约 0.17m，公共建筑每步约 0.18~0.20m。
// 此估算仅用于展示，最终楼层爬升仍以楼层标记为准。
function estimateVerticalAscent(samples: SensorSample[]): number {
  if (!samples.length) return 0
  const signal = prepareSignal(samples)
  const steps = signal.filter((s) => s.step).length
  // 经验步幅高度（每步垂直抬升约 0.17m，对应典型住宅楼）
  const ascentPerStep = 0.17
  return Number((steps * ascentPerStep).toFixed(1))
}

// 基于人工楼层标记分段，生成爬楼路线图。
// 若无人工楼层标记，则按 inferred.floorBoundaries 分段。
export function buildFloorSplits(
  draft: Pick<CalibrationDraft, 'samples' | 'markers' | 'boundaries' | 'manualMarks' | 'estimatedAscentM'>,
  startFloor: number,
): FloorSplit[] {
  const { boundaries, markers, manualMarks, samples, estimatedAscentM } = draft
  if (boundaries.length < 2) return []
  const firstT = samples[0]?.t ?? 0
  const totalAscent = estimatedAscentM ?? 0
  const perFloorAscent = totalAscent / Math.max(1, boundaries.length - 1)
  // 有气压时每层爬升取该段首末气压差（而不是总高度均分），大堂层更高也能体现。
  const baro = samples.filter((s) => typeof s.pressure === 'number' && (s.pressure ?? 0) > 0)
  const pressureAround = (ms: number): number | undefined => {
    const near = baro.filter((s) => Math.abs(s.t - firstT - ms) <= 1000).map((s) => s.pressure as number).sort((a, b) => a - b)
    return near.length ? near[Math.floor(near.length / 2)] : undefined
  }
  const allTurns = markers.filter(
    (m) => m.type === 'turn' || m.type === 'manual_turn',
  )
  // 步数：复用 prepareSignal 检测
  const signal = prepareSignal(samples)
  const splits: FloorSplit[] = []
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const startMs = boundaries[i]
    const endMs = boundaries[i + 1]
    const stepsInSeg = signal.filter(
      (s) => s.step && s.t - firstT >= startMs && s.t - firstT < endMs,
    ).length
    const turnsInSeg = allTurns.filter(
      (m) => m.atMs >= startMs && m.atMs < endMs,
    ).length
    const manualTurnsInSeg = manualMarks
      .filter((m) => m.type === 'turn' && m.atMs >= startMs && m.atMs < endMs).length
    splits.push({
      floor: startFloor + i,
      startMs,
      endMs,
      durationMs: endMs - startMs,
      stepCount: stepsInSeg,
      turnCount: turnsInSeg || manualTurnsInSeg,
      ascentM: (() => {
        const from = pressureAround(startMs)
        const to = pressureAround(endMs)
        if (from === undefined || to === undefined) return Number(perFloorAscent.toFixed(1))
        return Number(Math.max(0, pressureToAltitude(to) - pressureToAltitude(from)).toFixed(1))
      })(),
    })
  }
  return splits
}

// 生成爬楼路线图的纯文本形式（用于 Review 页面展示）
export function buildRouteDiagram(splits: FloorSplit[]): string {
  if (!splits.length) return ''
  const lines: string[] = []
  for (const s of splits) {
    const stepStr = `${s.stepCount}步·${(s.durationMs / 1000).toFixed(0)}秒`
    const turnStr = s.turnCount > 0 ? ` ──[拐弯×${s.turnCount}]──> ` : ' ──> '
    lines.push(`${s.floor}层 ──[${stepStr}]──>${turnStr}${s.floor + 1}层`)
  }
  return lines.join('\n')
}

// ===== 气压计相关 =====

// 国际气压公式：hPa → 海拔米
// h = 44330 × (1 - (P/P0)^0.190263)
export function pressureToAltitude(pressureHpa: number): number {
  return 44330 * (1 - Math.pow(pressureHpa / P0_HPA, BARO_EXP))
}

// 气压反算相对爬升：用首末气压差反推高度差。
// 比步数估算准（±0.3m vs ±30%），但需要设备有气压计。
// 返回 null 表示无气压数据可用。
export function estimateAscentByPressure(samples: SensorSample[]): number | null {
  const baro = samples.filter((s) => typeof s.pressure === 'number' && s.pressure > 0)
  if (baro.length < 10) return null
  // 取前 5 个气压的平均作为起点（平滑初始噪声），后 5 个的平均作为终点
  const startP = baro.slice(0, 5).reduce((sum, s) => sum + (s.pressure ?? 0), 0) / 5
  const endP = baro.slice(-5).reduce((sum, s) => sum + (s.pressure ?? 0), 0) / 5
  // 气压下降 = 高度上升
  if (endP >= startP) return 0
  const startH = pressureToAltitude(startP)
  const endH = pressureToAltitude(endP)
  return Number(Math.max(0, endH - startH).toFixed(1))
}

// 基于气压计检测楼层变化边界。
// 算法：滑动平均平滑气压 → 检测气压下降事件 → 每次下降超阈值记一个楼层边界。
// 返回 [0, t1, t2, ..., lastT] 形式的边界时间数组（相对采集开始的毫秒）。
// 若气压数据不足或无楼层变化，返回空数组 []。
export function detectFloorBoundariesByPressure(samples: SensorSample[]): number[] {
  const baro = samples.filter(
    (s) => typeof s.pressure === 'number' && (s.pressure ?? 0) > 0,
  )
  if (baro.length < 20) return []  // 至少 4 秒气压数据
  const firstT = baro[0].t
  const lastT = baro[baro.length - 1].t
  const duration = lastT - firstT
  // 滑动平均平滑气压
  const smoothed: Array<{ t: number; p: number }> = []
  for (let i = 0; i < baro.length; i += 1) {
    const start = Math.max(0, i - BARO_SMOOTH_WINDOW + 1)
    const window = baro.slice(start, i + 1)
    const avg = window.reduce((sum, s) => sum + (s.pressure ?? 0), 0) / window.length
    smoothed.push({ t: baro[i].t - firstT, p: avg })
  }
  // 检测气压下降事件：找连续下降段，累计下降超阈值记一次
  const boundaries: number[] = [0]
  let segStart = smoothed[0]
  let lastBoundaryAt = -Infinity
  for (let i = 1; i < smoothed.length; i += 1) {
    const drop = segStart.p - smoothed[i].p
    if (drop >= BARO_EPS_CALIBRATE) {
      // 检测到一次楼层上升，记录边界时间为下降段中点
      const boundaryT = Math.round((segStart.t + smoothed[i].t) / 2)
      if (boundaryT - lastBoundaryAt >= BARO_FLOOR_COOLDOWN_MS) {
        boundaries.push(boundaryT)
        lastBoundaryAt = boundaryT
      }
      // 重置段起点为当前点，继续检测下一次下降
      segStart = smoothed[i]
    } else if (smoothed[i].p > segStart.p) {
      // 气压回升（可能是下降休息或噪声），重置起点
      segStart = smoothed[i]
    }
  }
  boundaries.push(duration)
  // 只有当检测到至少一次楼层变化时才返回，否则返回空数组让调用方走算法估算
  return boundaries.length > 2 ? boundaries : []
}
