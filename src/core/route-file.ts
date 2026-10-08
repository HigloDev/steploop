import { RouteTemplate } from './types'
import { PREPARATION_STEPS, PreparationRun } from './route-preparation'

export const MAX_ROUTE_FILE_BYTES = 8 * 1024 * 1024
const number = (v: unknown, min = -10000000000000, max = 10000000000000): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error('路线文件里的数字不完整。')
  return v
}
const text = (v: unknown, max = 200): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error('路线文件里的名称不完整。')
  return v
}
const array = (v: unknown, max: number): any[] => {
  if (!Array.isArray(v) || v.length > max) throw new Error('路线文件内容太多或不完整。')
  return v
}

/** Explicit allowlist: no workout, raw sample, local file path, or personal history fields. */
export function portableRoute(value: any): RouteTemplate {
  if (!value || typeof value !== 'object') throw new Error('这不是循阶路线文件。')
  const startFloor = number(value.startFloor, -20, 200), endFloor = number(value.endFloor, -20, 200)
  if (!Number.isInteger(startFloor) || !Number.isInteger(endFloor) || endFloor <= startFloor || endFloor - startFloor > 150) throw new Error('路线楼层范围不正确。')
  if (!['pocket', 'waist'].includes(value.carryMode)) throw new Error('缺少手机放置方式。')
  const segments = array(value.segments, 150).map((s, i) => {
    if (s.floorFrom !== startFloor + i || s.floorTo !== startFloor + i + 1 || s.type !== 'flight') throw new Error('路线有楼层缺失。')
    return { id: text(s.id), type: 'flight' as const, startMs: number(s.startMs, 0, 7200000), endMs: number(s.endMs, s.startMs + 1, 7200000),
      floorFrom: s.floorFrom, floorTo: s.floorTo, ascentM: number(s.ascentM, 0, 50), stepCount: number(s.stepCount, 0, 1000),
      turnCount: s.turnCount === undefined ? undefined : number(s.turnCount, 0, 100), boundaryConfirmed: s.boundaryConfirmed === true,
      features: array(s.features, 10000).map(v => { const row = array(v, 4); if (row.length !== 4) throw new Error('路线脚步记录不完整。'); return row.map(x => number(x, -10, 10)) }) }
  })
  if (segments.length !== endFloor - startFloor) throw new Error('请先逐层记好路线，再分享。')
  const route: RouteTemplate = { id: text(value.id), name: text(value.name), startFloor, endFloor, carryMode: value.carryMode,
    floorHeightM: number(value.floorHeightM, 0, 50), totalAscentM: number(value.totalAscentM, 0, 10000),
    device: { platform: text(value.device?.platform), model: text(value.device?.model), system: text(value.device?.system) },
    segments, markers: [], createdAt: number(value.createdAt, 0), updatedAt: number(value.updatedAt, 0), version: 1,
    status: 'needs_validation', featureSpace: value.featureSpace === 'heading' ? 'heading' : 'device', algorithmVersion: 'motion-v3' }
  if (value.location) {
    const l = value.location
    route.location = { name: text(l.name), address: text(l.address, 500), latitude: number(l.latitude, -90, 90), longitude: number(l.longitude, -180, 180),
      accuracy: number(l.accuracy, 0, 100000), source: l.source === 'gps' ? 'gps' : 'map', confirmedAt: number(l.confirmedAt, 0) }
  }
  if (value.preparation?.version === 1) {
    const runs: PreparationRun[] = array(value.preparation.runs, 100).map(r => {
      if (!PREPARATION_STEPS.includes(r.step)) throw new Error('路线记录来自其他版本，请更新 App 后再试。')
      return { id: text(r.id), step: r.step, endedAt: number(r.endedAt, 0), durationMs: number(r.durationMs, 0, 7200000),
        actualEndFloor: number(r.actualEndFloor, -20, 200), estimatedEndFloor: number(r.estimatedEndFloor, -20, 200), maxEstimatedFloor: number(r.maxEstimatedFloor, -20, 200),
        passed: r.passed === true, interrupted: r.interrupted === true, message: '来自分享的路线记录',
        marks: array(r.marks, 150).map(m => ({ id: text(m.id), type: 'floor' as const, atMs: number(m.atMs, 0, r.durationMs), floor: number(m.floor, -20, 200),
          estimatedFloor: m.estimatedFloor === undefined ? undefined : number(m.estimatedFloor, -20, 200) })),
        frames: array(r.frames, 15000).map(f => ({ startMs: number(f.startMs, 0, 7200000), endMs: number(f.endMs, f.startMs, 7200000),
          steps: number(f.steps, 0, 100), cadence: number(f.cadence, 0, 1000), energy: number(f.energy, 0, 100), turnRad: number(f.turnRad, -100, 100),
          headingTurnRad: f.headingTurnRad === undefined ? undefined : number(f.headingTurnRad, -100, 100), paused: number(f.paused, 0, 1) })),
        pressures: array(r.pressures, 40000).map(p => ({ atMs: number(p.atMs, 0, 7200000), pressure: number(p.pressure, 100, 1200) })) }
    })
    route.preparation = { version: 1, elevator: value.preparation.elevator === 'absent' ? 'absent' : 'present', runs,
      deviceKey: '', referenceRevision: 1, imported: true, localChecksRequired: true }
  }
  return route
}

export function encodeRouteFile(route: RouteTemplate): string {
  const value = portableRoute({ ...route, preparation: route.preparation ? { ...route.preparation,
    runs: route.preparation.runs.filter(run => run.passed) } : undefined })
  const content = JSON.stringify({ format: 'palou-route', version: 1, route: value })
  if (content.length * 3 > MAX_ROUTE_FILE_BYTES) throw new Error('路线文件太大，暂时无法分享。')
  return content
}

export function decodeRouteFile(content: string): RouteTemplate {
  if (content.length > MAX_ROUTE_FILE_BYTES) throw new Error('路线文件太大。')
  let file: any
  try { file = JSON.parse(content) } catch { throw new Error('文件没有读完整，请重新选择。') }
  if (file?.format !== 'palou-route' || file.version !== 1) throw new Error('请选择循阶路线文件。训练备份请到设置里恢复。')
  const route = portableRoute(file.route)
  if (route.preparation) route.preparation.runs = route.preparation.runs.map(run => ({ ...run, passed: run.step.startsWith('teach') && run.passed }))
  return route
}
