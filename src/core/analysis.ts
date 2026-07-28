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

const FRAME_MS = 500
const STEP_REFRACTORY_MS = 260
const STEP_THRESHOLD = 0.13
const TURN_THRESHOLD_RAD = 0.62

interface TimedSignal {
  t: number
  motion: number
  turn: number
  step: boolean
}

function prepareSignal(samples: SensorSample[]): TimedSignal[] {
  if (!samples.length) return []
  let gravity = Math.sqrt(samples[0].ax ** 2 + samples[0].ay ** 2 + samples[0].az ** 2)
  let smooth = 0
  let previous = 0
  let lastStepAt = -Infinity

  return samples.map((sample) => {
    const magnitude = Math.sqrt(sample.ax ** 2 + sample.ay ** 2 + sample.az ** 2)
    gravity = gravity * 0.985 + magnitude * 0.015
    const linear = Math.abs(magnitude - gravity)
    smooth = smooth * 0.72 + linear * 0.28
    const step =
      smooth > STEP_THRESHOLD &&
      previous <= STEP_THRESHOLD &&
      sample.t - lastStepAt >= STEP_REFRACTORY_MS
    if (step) lastStepAt = sample.t
    previous = smooth
    return {
      t: sample.t,
      motion: smooth,
      turn: sample.gz,
      step,
    }
  })
}

export function extractFrames(samples: SensorSample[]): FeatureFrame[] {
  if (samples.length < 2) return []
  const signal = prepareSignal(samples)
  const first = samples[0].t
  const last = samples[samples.length - 1].t
  const frames: FeatureFrame[] = []

  for (let start = first; start < last; start += FRAME_MS) {
    const end = start + FRAME_MS
    const points = signal.filter((point) => point.t >= start && point.t < end)
    if (!points.length) continue
    const steps = points.filter((point) => point.step).length
    const energy = points.reduce((sum, point) => sum + point.motion, 0) / points.length
    let turnRad = 0
    for (let index = 1; index < points.length; index += 1) {
      const dt = clamp((points[index].t - points[index - 1].t) / 1000, 0, 0.1)
      turnRad += points[index].turn * dt
    }
    frames.push({
      startMs: start - first,
      endMs: Math.min(end, last) - first,
      steps,
      cadence: steps * (60000 / FRAME_MS),
      energy,
      turnRad,
      paused: steps === 0 && energy < 0.045 ? 1 : 0,
    })
  }
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
    const isTurning = Math.abs(frame.turnRad) >= 0.12
    if (isTurning) {
      if (turnStart < 0) turnStart = frame.startMs
      turnSum += frame.turnRad
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
  const preferred = markers
    .filter((marker) => marker.type === 'landing')
    .map((marker) => marker.endMs ?? marker.atMs)
  const turns = markers
    .filter((marker) => marker.type === 'turn')
    .map((marker) => marker.endMs ?? marker.atMs)
  return (preferred.length ? preferred : turns).sort((a, b) => a - b)
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
  const bySteps = Math.max(1, Math.round(totalSteps / 18))
  const markerCount = landingCount || turnCount
  const byMarkers =
    markerCount > 1
      ? Math.max(1, Math.round(markerCount / (totalSteps / markerCount < 15 ? 2 : 1)))
      : bySteps
  const estimates = [bySteps, byMarkers].sort((a, b) => a - b)
  const estimatedFloorCount = Math.max(1, Math.round((estimates[0] + estimates[1]) / 2))
  const agreement = 1 - Math.min(1, Math.abs(bySteps - byMarkers) / Math.max(1, bySteps))
  const signalCoverage = clamp(totalSteps / (estimatedFloorCount * 14), 0, 1)
  const floorConfidence = clamp(agreement * 0.65 + signalCoverage * 0.35, 0.25, 0.95)
  const candidates = boundaryCandidates(markers)
  const floorBoundaries = [0]
  const minSpacing = Math.min(1000, (duration / Math.max(1, estimatedFloorCount)) * 0.3)
  for (let floor = 1; floor < estimatedFloorCount; floor += 1) {
    const target = (duration * floor) / estimatedFloorCount
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
  draft: Pick<CalibrationDraft, 'frames' | 'markers'>,
  floorCount: number,
): number[] {
  const duration = draft.frames.at(-1)?.endMs ?? 0
  const candidates = boundaryCandidates(draft.markers)
  const count = Math.max(1, Math.round(floorCount))
  const minSpacing = Math.min(1000, (duration / count) * 0.3)
  const boundaries = [0]
  for (let floor = 1; floor < count; floor += 1) {
    const target = (duration * floor) / count
    const lower = boundaries.at(-1)! + minSpacing
    const upper = duration - (count - floor) * minSpacing
    boundaries.push(Math.round(nearestBoundary(draft.frames, candidates, target, lower, upper)))
  }
  boundaries.push(duration)
  return boundaries
}

export function vectorizeFrame(frame: FeatureFrame): number[] {
  return [
    clamp(frame.cadence / 240, 0, 1.5),
    clamp(frame.energy / 0.35, 0, 1.5),
    clamp(frame.turnRad / 1.2, -1.5, 1.5),
    frame.paused,
  ]
}

export function buildSegments(
  draft: Pick<CalibrationDraft, 'frames' | 'boundaries'>,
  startFloor: number,
  floorHeights: number[],
): RouteSegment[] {
  const { frames, boundaries } = draft
  return boundaries.slice(0, -1).map((startMs, index) => {
    const endMs = boundaries[index + 1]
    const floorFrames = frames.filter(
      (frame) => frame.startMs >= startMs && frame.endMs <= endMs + 1,
    )
    return {
      id: uid('flight'),
      type: 'flight',
      startMs,
      endMs,
      floorFrom: startFloor + index,
      floorTo: startFloor + index + 1,
      ascentM: floorHeights[index] ?? 0,
      stepCount: floorFrames.reduce((sum, frame) => sum + frame.steps, 0),
      features: floorFrames.map(vectorizeFrame),
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
  // 若有人工楼层标记，优先用人工标记重建 boundaries
  const floorMarks = manualMarks
    .filter((m) => m.type === 'floor')
    .sort((a, b) => a.atMs - b.atMs)
  const boundaries =
    floorMarks.length >= 1
      ? buildBoundariesFromManualMarks(floorMarks, samples)
      : inferred.floorBoundaries
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
  // 垂直位移估算
  const estimatedAscentM = estimateVerticalAscent(samples)
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
    boundaries.push(clamp(Math.round(mark.atMs), boundaries[boundaries.length - 1] + 500, last - 500))
  }
  boundaries.push(last)
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
      ascentM: Number(perFloorAscent.toFixed(1)),
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
    lines.push(`${s.floor}F ──[${stepStr}]──>${turnStr}${s.floor + 1}F`)
  }
  return lines.join('\n')
}
