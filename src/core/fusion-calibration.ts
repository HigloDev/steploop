import {
  CAL_FLOOR_MAX_M,
  CAL_FLOOR_MIN_M,
  CAL_LOBBY_MAX_M,
  CAL_MISSED_TAP_RATIO,
} from './sensor-params'
import { floorAfter } from './floors'
import { BuildingFloorProfile, BuildingTemplate, newTemplateId } from './building-template'

/** 标定轮中的一个楼层边界（起点或用户点击“到了一层/到顶了”的时刻）。 */
export interface CalibrationBoundary {
  t: number
  /** 到该时刻为止的累计步数。 */
  steps: number
  /** 到该时刻为止的累计整拐数。 */
  turns: number
  /** 该时刻 ±1s 平滑高度中位数（相对本轮基线，米）；无气压或停更时 undefined。 */
  heightM?: number
}

export interface CalibrationInput {
  startFloor: number
  /** boundaries[0] 是起点，其余每个对应一次“到了一层”（最后一个即顶层）。 */
  boundaries: CalibrationBoundary[]
  barometer: boolean
  name?: string
  now?: number
}

export interface CalibrationResult {
  template: BuildingTemplate
  /** 自动拆分的层数（漏点修复）。 */
  splitFloors: number
  warnings: string[]
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * 用标定轮的点击生成楼栋模板。
 * - 每层：时长、步数、拐弯数、该层气压高度差（不假设固定 3m，大堂层允许更高）；
 * - 层高 < 1.8m 或 > 6m（大堂 > 9m）给出“可能点早/点晚”提示，但不阻塞；
 * - 某层高度 ≈ 中位层高的 2 倍且步数也接近 2 倍 → 视为漏点一层，自动拆分并标记“估算”；
 * - 最后一层的边界就是“到顶了”的点击时刻，顶层停留不计入最后一层。
 */
export function buildTemplateFromCalibration(input: CalibrationInput): CalibrationResult {
  const now = input.now ?? Date.now()
  const marks = [...input.boundaries].sort((a, b) => a.t - b.t)
  const raw: BuildingFloorProfile[] = []
  for (let index = 1; index < marks.length; index += 1) {
    const from = marks[index - 1]
    const to = marks[index]
    const heightM = from.heightM !== undefined && to.heightM !== undefined
      ? Number((to.heightM - from.heightM).toFixed(2)) : undefined
    raw.push({
      floorFrom: 0, floorTo: 0,
      heightM,
      steps: Math.max(0, to.steps - from.steps),
      turns: Math.max(0, to.turns - from.turns),
      durationMs: Math.max(0, to.t - from.t),
      ...(heightM === undefined ? { estimated: true } : {}),
    })
  }
  const warnings: string[] = []
  const nonLobbyHeights = raw.slice(1).map(floor => floor.heightM).filter((h): h is number => h !== undefined && h > 0)
  const medianHeight = median(nonLobbyHeights)
  const medianSteps = median(raw.slice(1).map(floor => floor.steps).filter(step => step > 0))
  const floors: BuildingFloorProfile[] = []
  let splitFloors = 0
  raw.forEach((floor, index) => {
    const lobby = index === 0
    const canSplit = !lobby && medianHeight !== undefined && nonLobbyHeights.length >= 3 && floor.heightM !== undefined
    const ratio = canSplit ? floor.heightM! / medianHeight! : 1
    const stepRatio = medianSteps ? floor.steps / medianSteps : ratio
    if (canSplit && ratio >= CAL_MISSED_TAP_RATIO && stepRatio >= CAL_MISSED_TAP_RATIO * 0.8) {
      const parts = Math.max(2, Math.round(ratio))
      splitFloors += parts - 1
      warnings.push(`第 ${floors.length + 1} 段约 ${floor.heightM!.toFixed(1)} 米，像是漏点了一层，已自动拆成 ${parts} 层（估算）。`)
      for (let part = 0; part < parts; part += 1) {
        floors.push({
          floorFrom: 0, floorTo: 0,
          heightM: Number((floor.heightM! / parts).toFixed(2)),
          steps: Math.round(floor.steps / parts),
          turns: Math.round(floor.turns / parts),
          durationMs: Math.round(floor.durationMs / parts),
          estimated: true,
          warning: '漏点拆分',
        })
      }
      return
    }
    const next = { ...floor }
    if (floor.heightM !== undefined) {
      const max = lobby ? CAL_LOBBY_MAX_M : CAL_FLOOR_MAX_M
      if (floor.heightM < CAL_FLOOR_MIN_M) {
        next.warning = `这一层只有 ${floor.heightM.toFixed(1)} 米，可能点早了`
        warnings.push(`第 ${floors.length + 1} 层只有 ${floor.heightM.toFixed(1)} 米，可能点早或点晚了。`)
      } else if (floor.heightM > max) {
        next.warning = `这一层有 ${floor.heightM.toFixed(1)} 米，可能点晚了`
        warnings.push(`第 ${floors.length + 1} 层有 ${floor.heightM.toFixed(1)} 米，可能点早或点晚了。`)
      }
    }
    floors.push(next)
  })
  floors.forEach((floor, index) => {
    floor.floorFrom = floorAfter(input.startFloor, index)
    floor.floorTo = floorAfter(input.startFloor, index + 1)
  })
  const template: BuildingTemplate = {
    schemaVersion: 1,
    id: newTemplateId(),
    name: input.name?.trim() || '新楼栋',
    startFloor: input.startFloor,
    floors,
    barometer: input.barometer && floors.some(floor => floor.heightM !== undefined),
    createdAt: now,
    updatedAt: now,
    version: 1,
  }
  return { template, splitFloors, warnings }
}
