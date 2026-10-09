import { DEFAULT_FLOOR_HEIGHT_M, DEFAULT_STEPS_PER_FLOOR } from './sensor-params'
import type { RouteLocation, RouteTemplate } from './types'
import { uid } from './math'
import { floorAfter, getFloorTransitionCount } from './floors'

/**
 * 楼栋模板中的一层（从 floorFrom 爬到 floorTo 的一段）。
 * heightM 来自标定轮该层的气压高度差；没有气压计时为 undefined（展示时按默认层高估算）。
 */
export interface BuildingFloorProfile {
  floorFrom: number
  floorTo: number
  heightM?: number
  steps: number
  turns: number
  durationMs: number
  /** 该层数据是推算出来的（漏点拆分、无气压等）。 */
  estimated?: boolean
  /** 标定检查给出的提示，例如“这一层可能点早或点晚了”。 */
  warning?: string
}

export interface BuildingLastResult {
  workoutId: string
  at: number
  rounds: number
  floors: number
  ascentM: number
  bestRoundMs?: number
}

/** 楼栋模板 = 一次标定轮的结果，可命名、保存、下次直接选用。 */
export interface BuildingTemplate {
  schemaVersion: 1
  id: string
  name: string
  startFloor: number
  floors: BuildingFloorProfile[]
  /** 标定时设备是否有可用气压计。 */
  barometer: boolean
  createdAt: number
  updatedAt: number
  /** 每次重新标定 +1。 */
  version: number
  location?: RouteLocation
  lastResult?: BuildingLastResult
  /** 由旧路线转换而来（只读兼容）。 */
  legacyRouteId?: string
  /** 旧路线缺少逐层数据，下次使用前建议重新标定。 */
  needsCalibration?: boolean
}

export function topFloor(template: Pick<BuildingTemplate, 'startFloor' | 'floors'>): number {
  return floorAfter(template.startFloor, template.floors.length)
}

export function floorCount(template: Pick<BuildingTemplate, 'floors'>): number {
  return template.floors.length
}

/** 中位层高（米）：有气压数据时取中位数，否则默认 3m。 */
export function medianFloorHeightM(template: Pick<BuildingTemplate, 'floors'>): number {
  const heights = template.floors.map(floor => floor.heightM).filter((h): h is number => Number.isFinite(h) && (h as number) > 0)
  if (!heights.length) return DEFAULT_FLOOR_HEIGHT_M
  const sorted = [...heights].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

export function medianStepsPerFloor(template: Pick<BuildingTemplate, 'floors'>): number {
  const steps = template.floors.map(floor => floor.steps).filter(step => step > 0).sort((a, b) => a - b)
  return steps.length ? steps[Math.floor(steps.length / 2)] : DEFAULT_STEPS_PER_FLOOR
}

/** 第 index 层（0 起）的层高；超过模板顶层后按中位层高外推。 */
export function floorHeightAt(template: Pick<BuildingTemplate, 'floors'>, index: number): number {
  const floor = template.floors[index]
  if (floor && Number.isFinite(floor.heightM) && floor.heightM! > 0) return floor.heightM!
  return medianFloorHeightM(template)
}

export function floorStepsAt(template: Pick<BuildingTemplate, 'floors'>, index: number): number {
  const floor = template.floors[index]
  return floor && floor.steps > 0 ? floor.steps : medianStepsPerFloor(template)
}

export function floorTurnsAt(template: Pick<BuildingTemplate, 'floors'>, index: number): number | undefined {
  const floor = template.floors[index]
  return floor ? floor.turns : undefined
}

/** 爬升 floors 层对应的高度（米），按模板逐层累加，超出部分按中位层高。 */
export function ascentForFloors(template: Pick<BuildingTemplate, 'floors'> | undefined, floors: number): number {
  const count = Math.max(0, Math.round(floors))
  if (!template) return Number((count * DEFAULT_FLOOR_HEIGHT_M).toFixed(1))
  let total = 0
  for (let index = 0; index < count; index += 1) total += floorHeightAt(template, index)
  return Number(total.toFixed(1))
}

/** 第 index 层顶部的累计高度 H_k（从起点算起）。 */
export function cumulativeHeightAt(template: Pick<BuildingTemplate, 'floors'>, index: number): number {
  let total = 0
  for (let i = 0; i <= index; i += 1) total += floorHeightAt(template, i)
  return total
}

export function templateTotalAscentM(template: Pick<BuildingTemplate, 'floors'>): number {
  return ascentForFloors(template, template.floors.length)
}

/**
 * 旧路线 → 楼栋模板（只读兼容）。
 * 有逐层 ascentM/stepCount 就用；没有就按总高度均分并标记需要重新标定。
 */
export function buildingFromLegacyRoute(route: RouteTemplate): BuildingTemplate {
  const count = getFloorTransitionCount(route.startFloor, route.endFloor)
  const segments = route.segments ?? []
  const fallbackHeight = count > 0 && route.totalAscentM > 0 ? route.totalAscentM / count : undefined
  const floors: BuildingFloorProfile[] = []
  for (let index = 0; index < count; index += 1) {
    const segment = segments[index]
    const heightM = segment && segment.ascentM > 0 ? segment.ascentM : fallbackHeight
    floors.push({
      floorFrom: floorAfter(route.startFloor, index),
      floorTo: floorAfter(route.startFloor, index + 1),
      heightM: heightM !== undefined ? Number(heightM.toFixed(2)) : undefined,
      steps: segment?.stepCount ?? 0,
      turns: segment?.turnCount ?? 0,
      durationMs: segment ? Math.max(0, segment.endMs - segment.startMs) : 0,
      estimated: !segment || !(segment.ascentM > 0),
    })
  }
  const complete = floors.length > 0 && floors.every(floor => floor.steps > 0)
  return {
    schemaVersion: 1,
    id: `legacy_${route.id}`,
    name: route.name || route.location?.name || '旧路线',
    startFloor: route.startFloor,
    floors,
    barometer: route.deviceCapabilities?.barometerAvailable === true || floors.some(floor => !floor.estimated),
    createdAt: route.createdAt,
    updatedAt: route.updatedAt,
    version: route.version ?? 1,
    location: route.location,
    legacyRouteId: route.id,
    needsCalibration: !complete,
  }
}

export function newTemplateId(): string {
  return uid('building')
}

/** 规范化（读取存储时容错）：缺字段的模板不让 UI 崩溃。 */
export function normalizeBuildingTemplate(value: unknown): BuildingTemplate | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<BuildingTemplate>
  if (typeof raw.id !== 'string' || !Array.isArray(raw.floors)) return undefined
  const startFloor = Number.isFinite(raw.startFloor) ? Math.round(raw.startFloor as number) : 1
  const floors = raw.floors
    .filter((floor): floor is BuildingFloorProfile => !!floor && typeof floor === 'object')
    .map((floor, index) => ({
      floorFrom: floorAfter(startFloor, index),
      floorTo: floorAfter(startFloor, index + 1),
      heightM: Number.isFinite(floor.heightM) ? floor.heightM : undefined,
      steps: Number.isFinite(floor.steps) ? Math.max(0, Math.round(floor.steps)) : 0,
      turns: Number.isFinite(floor.turns) ? Math.max(0, Math.round(floor.turns)) : 0,
      durationMs: Number.isFinite(floor.durationMs) ? Math.max(0, floor.durationMs) : 0,
      ...(floor.estimated ? { estimated: true } : {}),
      ...(floor.warning ? { warning: String(floor.warning) } : {}),
    }))
  return {
    schemaVersion: 1,
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '未命名楼栋',
    startFloor,
    floors,
    barometer: raw.barometer === true,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt! : Date.now(),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt! : Date.now(),
    version: Number.isFinite(raw.version) ? raw.version! : 1,
    ...(raw.location ? { location: raw.location } : {}),
    ...(raw.lastResult ? { lastResult: raw.lastResult } : {}),
    ...(raw.legacyRouteId ? { legacyRouteId: raw.legacyRouteId } : {}),
    ...(raw.needsCalibration ? { needsCalibration: true } : {}),
  }
}
