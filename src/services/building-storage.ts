/**
 * 楼栋模板存储（fusion-v1）。
 * - 新模板保存在独立的键里，不改写旧路线数据；
 * - 旧路线（RouteTemplate）只读转换后一起展示，用户“重新标定”后才会生成新模板；
 * - 训练中的检查点也放这里：已完成轮次 + 模板，App 被杀后可恢复（当前轮从楼下重新开始）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  BuildingLastResult,
  BuildingTemplate,
  buildingFromLegacyRoute,
  normalizeBuildingTemplate,
} from '../core/building-template'
import type { FusionRoundResult } from '../core/fusion-engine'
import { listRoutes } from './storage'

const BUILDINGS_KEY = 'steploop.buildings.v1'
const ACTIVE_FUSION_KEY = 'steploop.fusionActive.v1'
const HIDDEN_LEGACY_KEY = 'steploop.hiddenLegacyRoutes.v1'

let cache: BuildingTemplate[] | undefined

async function readOwn(): Promise<BuildingTemplate[]> {
  if (cache) return cache
  try {
    const raw = await AsyncStorage.getItem(BUILDINGS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    cache = Array.isArray(parsed)
      ? parsed.map(normalizeBuildingTemplate).filter((item): item is BuildingTemplate => !!item)
      : []
  } catch (error) {
    console.warn('[building-storage] 读取楼栋模板失败', error)
    throw new Error('楼栋模板暂时无法读取，请重试。')
  }
  return cache
}

async function writeOwn(items: BuildingTemplate[]): Promise<void> {
  try {
    await AsyncStorage.setItem(BUILDINGS_KEY, JSON.stringify(items))
    cache = items
  } catch (error) {
    throw new Error(`楼栋模板保存失败，可能存储空间不足：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function hiddenLegacy(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(HIDDEN_LEGACY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** 全部楼栋：新模板在前（按最近使用），其后是旧路线转换的只读模板。 */
export async function listBuildings(): Promise<BuildingTemplate[]> {
  const own = await readOwn()
  const hidden = new Set(await hiddenLegacy())
  let legacy: BuildingTemplate[] = []
  try {
    const routes = await listRoutes()
    const replaced = new Set(own.map(item => item.legacyRouteId).filter(Boolean))
    legacy = routes
      .filter(route => !replaced.has(route.id) && !hidden.has(route.id))
      .map(route => { try { return buildingFromLegacyRoute(route) } catch { return undefined } })
      .filter((item): item is BuildingTemplate => !!item && item.floors.length > 0)
  } catch (error) {
    console.warn('[building-storage] 旧路线读取失败，已跳过', error)
  }
  const sortKey = (item: BuildingTemplate) => item.lastResult?.at ?? item.updatedAt
  return [...[...own].sort((a, b) => sortKey(b) - sortKey(a)), ...legacy]
}

export async function getBuilding(id: string): Promise<BuildingTemplate | undefined> {
  return (await listBuildings()).find(item => item.id === id)
}

/** 保存或覆盖（同 id）。旧路线模板保存时生成新 id，并记住来源，之后不再重复展示旧路线。 */
export async function saveBuilding(template: BuildingTemplate): Promise<BuildingTemplate> {
  const own = await readOwn()
  const next: BuildingTemplate = { ...template, updatedAt: Date.now() }
  const index = own.findIndex(item => item.id === next.id)
  const items = index >= 0 ? own.map(item => (item.id === next.id ? next : item)) : [next, ...own]
  await writeOwn(items)
  return next
}

export async function renameBuilding(id: string, name: string): Promise<void> {
  const trimmed = name.trim().slice(0, 24)
  if (!trimmed) return
  const own = await readOwn()
  if (own.some(item => item.id === id)) {
    await writeOwn(own.map(item => (item.id === id ? { ...item, name: trimmed, updatedAt: Date.now() } : item)))
    return
  }
  const legacy = (await listBuildings()).find(item => item.id === id)
  if (legacy) await saveBuilding({ ...legacy, id: `building_${legacy.legacyRouteId ?? id}`, name: trimmed })
}

export async function deleteBuilding(id: string): Promise<void> {
  const own = await readOwn()
  const target = own.find(item => item.id === id)
  if (target) {
    await writeOwn(own.filter(item => item.id !== id))
    return
  }
  // 旧路线：只在新界面隐藏，不删除旧数据（备份/导出仍保留）。
  const legacy = (await listBuildings()).find(item => item.id === id)
  if (legacy?.legacyRouteId) {
    const hidden = await hiddenLegacy()
    await AsyncStorage.setItem(HIDDEN_LEGACY_KEY, JSON.stringify([...new Set([...hidden, legacy.legacyRouteId])]))
  }
}

export async function recordBuildingResult(id: string, result: BuildingLastResult): Promise<void> {
  const own = await readOwn()
  if (!own.some(item => item.id === id)) return
  await writeOwn(own.map(item => (item.id === id ? { ...item, lastResult: result } : item)))
}

// ===================== 训练检查点 =====================

export interface FusionCheckpoint {
  schemaVersion: 1
  workoutId: string
  startedAt: number
  savedAt: number
  /** 已结束但保存尚未完成；恢复时重试保存，不重新启动采样。 */
  endedAt?: number
  startFloor: number
  template?: BuildingTemplate
  /** 本次训练是否是新标定（结算时可保存为新模板）。 */
  calibrated: boolean
  /** 重新标定时要覆盖的模板 id。 */
  replaceTemplateId?: string
  rounds: FusionRoundResult[]
}

export async function saveFusionCheckpoint(checkpoint: FusionCheckpoint | null): Promise<void> {
  try {
    if (checkpoint) await AsyncStorage.setItem(ACTIVE_FUSION_KEY, JSON.stringify(checkpoint))
    else await AsyncStorage.removeItem(ACTIVE_FUSION_KEY)
  } catch (error) {
    console.warn('[building-storage] 训练检查点写入失败', error)
    throw new Error('训练恢复点保存失败，请检查手机存储空间后重试。')
  }
}

export async function loadFusionCheckpoint(): Promise<FusionCheckpoint | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_FUSION_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as FusionCheckpoint
    if (!value || value.schemaVersion !== 1 || typeof value.workoutId !== 'string' || !Array.isArray(value.rounds)) return null
    const template = value.template ? normalizeBuildingTemplate(value.template) : undefined
    return { ...value, template }
  } catch {
    throw new Error('训练恢复点暂时无法读取，请重试后再开始训练。')
  }
}

/** 测试用。 */
export function __resetBuildingStorageForTests(): void {
  cache = undefined
}

// ===================== 待保存的标定结果 =====================
// 标定轮生成的模板先作为“草稿”挂在本次训练上，结算页由用户命名后再正式保存。

const PENDING_TEMPLATE_KEY = 'steploop.pendingTemplate.v1'

export interface PendingTemplate {
  workoutId: string
  template: BuildingTemplate
  warnings: string[]
  replaceTemplateId?: string
}

export async function savePendingTemplate(pending: PendingTemplate): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_TEMPLATE_KEY, JSON.stringify(pending))
  } catch (error) {
    console.warn('[building-storage] 标定草稿写入失败', error)
    throw new Error('楼栋标定结果保存失败，请检查手机存储空间后重试。')
  }
}

export async function loadPendingTemplate(workoutId: string): Promise<PendingTemplate | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_TEMPLATE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as PendingTemplate
    if (!value || value.workoutId !== workoutId) return null
    const template = normalizeBuildingTemplate(value.template)
    return template ? { ...value, template, warnings: Array.isArray(value.warnings) ? value.warnings : [] } : null
  } catch {
    return null
  }
}

export async function clearPendingTemplate(): Promise<void> {
  try { await AsyncStorage.removeItem(PENDING_TEMPLATE_KEY) } catch { /* 草稿丢失不影响成绩 */ }
}
