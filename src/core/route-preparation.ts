import { buildSegments } from './analysis'
import { createMotionReference } from './route-motion'
import { PressureTrend } from './pressure-trend'
import { FeatureFrame, ManualMark, RouteSegment, RouteTemplate } from './types'

export type PreparationStep = 'teach_first' | 'teach_again' | 'check_floors' | 'check_end' | 'elevator_down' | 'elevator_up' | 'walk' | 'rest'
export const PREPARATION_STEPS: PreparationStep[] = ['teach_first', 'teach_again', 'check_floors', 'check_end', 'elevator_down', 'elevator_up', 'walk', 'rest']
export const PREPARATION_LABELS: Record<PreparationStep, string> = {
  teach_first: '逐层走一遍', teach_again: '再熟悉一遍', check_floors: '看看每层对不对', check_end: '正常爬一遍',
  elevator_down: '坐电梯下楼', elevator_up: '坐电梯上楼', walk: '在平地走一会儿', rest: '站着休息一会儿',
}
export interface PreparationRun {
  id: string
  step: PreparationStep
  endedAt: number
  durationMs: number
  marks: ManualMark[]
  frames: FeatureFrame[]
  pressures: Array<{ atMs: number; pressure: number }>
  actualEndFloor: number
  estimatedEndFloor: number
  maxEstimatedFloor: number
  interrupted: boolean
  passed: boolean
  message: string
  segments?: RouteSegment[]
}
export interface RoutePreparation {
  version: 1
  /** Attempts are preserved separately from the successful step sequence. */
  runs: PreparationRun[]
  elevator: 'present' | 'absent'
  imported?: boolean
  localChecksRequired?: boolean
  deviceKey: string
  referenceRevision: number
}

export function nextPreparationStep(route: RouteTemplate): PreparationStep | undefined {
  const prep = route.preparation
  if (!prep) return 'teach_first'
  const steps = PREPARATION_STEPS.filter(step => prep.elevator !== 'absent' || !step.startsWith('elevator'))
  return steps.find(step => !prep.runs.some(run => run.step === step && run.passed))
}

export function isRoutePrepared(route: RouteTemplate): boolean {
  return Boolean(route.preparation && !route.preparation.localChecksRequired &&
    route.segments.length === route.endFloor - route.startFloor && route.segments.every(s => s.boundaryConfirmed) &&
    !nextPreparationStep(route))
}

export function preparationLabel(route: RouteTemplate): string {
  if (isRoutePrepared(route)) return '可以开始锻炼'
  if (!route.preparation) return '先熟悉路线'
  return `下一步：${PREPARATION_LABELS[nextPreparationStep(route) ?? 'check_floors']}`
}

/** Checks consume the frozen recognizer output, never corrected human answers. */
export function assessPreparationRun(route: RouteTemplate, input: Omit<PreparationRun, 'passed' | 'message' | 'segments'>): PreparationRun {
  const fail = (message: string): PreparationRun => ({ ...input, passed: false, message })
  if (input.interrupted || input.frames.length < 10 || input.durationMs < 5000) return fail('这一段没有记完整，请重新走这一段。')
  const teaching = input.step.startsWith('teach')
  const climb = teaching || input.step.startsWith('check')
  if (climb && input.actualEndFloor !== route.endFloor) return fail('还没有到路线终点，这一遍先保留，请从起点再走。')
  if (teaching || input.step === 'check_floors') {
    const floors = Array.from({ length: route.endFloor - route.startFloor }, (_, i) => route.startFloor + i + 1)
    if (input.marks.length !== floors.length || input.marks.some((mark, i) => mark.floor !== floors[i] ||
      mark.atMs <= (input.marks[i - 1]?.atMs ?? 0) || mark.atMs > input.durationMs)) return fail('有楼层漏记了，请每到一层看清楼号后点一下。')
  }
  if (teaching) {
    // Human times are authoritative. Assign each complete frame once, by its end time.
    const boundaries = [0, ...input.marks.map(mark => mark.atMs)]
    const segments = buildSegments({ frames: [], boundaries, manualMarks: input.marks }, route.startFloor, [])
    segments.forEach((segment, index) => {
      const frames = input.frames.filter(frame => frame.endMs > boundaries[index] && frame.endMs <= boundaries[index + 1])
      const built = buildSegments({ frames: frames.map(frame => ({ ...frame, startMs: Math.max(frame.startMs, boundaries[index]) })),
        boundaries: [boundaries[index], boundaries[index + 1]], manualMarks: [{ ...input.marks[index], floor: route.startFloor + 1 }] }, route.startFloor, [0])[0]
      Object.assign(segment, { features: built.features, stepCount: built.stepCount, turnCount: built.turnCount, ascentM: 0, boundaryConfirmed: true })
    })
    if (segments.some(segment => segment.stepCount < 8 || segment.features.length < 6)) return fail('有一层的脚步没有记清，请放稳手机后重新走这一遍。')
    if (input.step === 'teach_again' && segments.some((segment, i) => {
      const reference = route.segments[i]
      return !reference || Math.abs(segment.stepCount - reference.stepCount) > Math.max(8, reference.stepCount * 0.35)
    })) return fail('两遍有些楼层的脚步差得较多，请确认走的是同一段楼梯，再走这一遍。')
    return { ...input, segments, passed: true, message: '这一遍已记好。' }
  }
  if (climb && (input.estimatedEndFloor !== input.actualEndFloor ||
    input.step === 'check_floors' && input.marks.some(mark => mark.estimatedFloor !== mark.floor))) {
    const wrong = input.marks.filter(mark => mark.estimatedFloor !== mark.floor).map(mark => mark.floor)
    return fail(wrong.length ? `${wrong.join('、')} 楼没有认对。这次结果已保留，路线暂时还没准备好。` : '手机没有认对终点。这次结果已保留，路线暂时还没准备好。')
  }
  if (!climb) {
    const expectedEnd = input.step === 'elevator_down' ? route.startFloor : input.step === 'elevator_up' ? route.endFloor : route.startFloor
    if (input.actualEndFloor !== expectedEnd) return fail('到达楼层与这一步不一致，请核对后重试。')
    if (input.durationMs < 20000) return fail('请完整记录至少 20 秒，让手机记住这一段。')
    if (input.maxEstimatedFloor > route.startFloor) return fail('手机把这一段误算成了爬楼，路线暂时还没准备好。')
    if (input.step === 'walk' && input.frames.reduce((n, f) => n + f.steps, 0) < 12) return fail('走动太少，请在平地正常走至少 20 秒。')
    if (input.step === 'rest' && input.frames.reduce((n, f) => n + f.steps, 0) > 4) return fail('这段还在走动，请站稳休息后再记一次。')
    if (input.step.startsWith('elevator')) {
      const trend = new PressureTrend()
      let moved = false
      for (const p of input.pressures) {
        trend.push(p.pressure, p.atMs)
        const state = trend.snapshot(p.atMs)
        if (state.reliable && state.direction === (input.step === 'elevator_up' ? 'up' : 'down')) moved = true
      }
      if (!moved) return fail('这次没有看清电梯移动的方向，请坐完整一段再试。')
    }
  }
  return { ...input, passed: true, message: '这一步对上了。' }
}

export function appendPreparationRun(route: RouteTemplate, run: PreparationRun): RouteTemplate {
  if (!route.preparation || route.preparation.runs.some(old => old.id === run.id)) return route
  if (nextPreparationStep(route) !== run.step) throw new Error('路线已更新，请重新打开后继续。')
  // Full inputs live in immutable recording files. Keep the small route document shareable.
  const storedRun = { ...run, frames: run.step.startsWith('elevator') ? run.frames : [],
    pressures: run.step.startsWith('elevator') ? run.pressures : [] }
  const next = { ...route, updatedAt: run.endedAt, preparation: { ...route.preparation, runs: [...route.preparation.runs, storedRun] } }
  if (run.passed && run.step === 'teach_first' && run.segments) {
    next.segments = run.segments
    next.featureSpace = 'heading'
    next.algorithmVersion = 'motion-v3'
    next.motionReference = createMotionReference(route.carryMode, route.startFloor, route.endFloor, run.marks)
    next.totalAscentM = 0
    next.floorHeightM = 0
  }
  if (!nextPreparationStep(next)) next.preparation.localChecksRequired = false
  next.status = isRoutePrepared(next) ? 'verified' : 'needs_validation'
  return next
}
