import AsyncStorage from '@react-native-async-storage/async-storage'
import { ClimbSession, ClimbWorkout, RouteTemplate } from '../core/types'
import { normalizeSession } from '../core/session'
import { migrateRouteToV3 } from '../core/route-model'

const ROUTES_KEY = 'palou.routes.v3'
const V2_ROUTES_KEY = 'palou.routes.v2'
const LEGACY_ROUTES_KEY = 'palou.routes.v1'
const SESSIONS_KEY = 'palou.sessions.v1'
const WORKOUTS_KEY = 'palou.workouts.v1'

async function readArray<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key)
    if (!raw) return []
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export async function listRoutes(): Promise<RouteTemplate[]> {
  let routes = await readArray<RouteTemplate>(ROUTES_KEY)
  if (!routes.length) {
    const v2 = await readArray<RouteTemplate>(V2_ROUTES_KEY)
    const legacy = v2.length
      ? v2
      : await readArray<RouteTemplate>(LEGACY_ROUTES_KEY)
    if (legacy.length) {
      // 先完整转换，全部成功后再一次写入 V3。失败时继续读取旧数据，绝不清空。
      routes = legacy.map((route) => migrateRouteToV3(route))
      try {
        await AsyncStorage.setItem(ROUTES_KEY, JSON.stringify(routes))
        // V3 写入成功后再清理旧键，避免备份/排障误读未迁移数据
        if (v2.length) await AsyncStorage.removeItem(V2_ROUTES_KEY)
        await AsyncStorage.removeItem(LEGACY_ROUTES_KEY)
      } catch (error) {
        console.warn('[storage] route v3 migration write failed', error)
        // Keep the legacy data readable even when storage is temporarily full.
      }
    }
  }
  return routes.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export async function getRoute(id: string): Promise<RouteTemplate | undefined> {
  return (await listRoutes()).find((route) => route.id === id)
}

/** 安全写入：存储满或异常时抛出统一 Error，调用方可捕获并提示用户。 */
async function safeWrite(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    throw new Error(
      `本地存储写入失败，可能空间不足：${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

export async function saveRoute(route: RouteTemplate): Promise<void> {
  const normalized = migrateRouteToV3(route)
  const routes = await listRoutes()
  const index = routes.findIndex((item) => item.id === normalized.id)
  if (index >= 0) routes[index] = normalized
  else routes.unshift(normalized)
  await safeWrite(ROUTES_KEY, routes)
}

export async function deleteRoute(id: string): Promise<void> {
  await deleteRoutes([id])
}

export async function deleteRoutes(ids: string[]): Promise<void> {
  const idSet = new Set(ids)
  if (!idSet.size) return
  const remainingRoutes = (await listRoutes()).filter(
    (route) => !idSet.has(route.id),
  )
  await safeWrite(ROUTES_KEY, remainingRoutes)
  if (!remainingRoutes.length) {
    await AsyncStorage.removeItem(LEGACY_ROUTES_KEY)
    await AsyncStorage.removeItem(V2_ROUTES_KEY)
  }
}

export async function updateRouteLocation(
  id: string,
  location: RouteTemplate['location'],
): Promise<boolean> {
  const route = await getRoute(id)
  if (!route || !location) return false
  route.location = location
  route.name = location.name
  route.updatedAt = Date.now()
  await saveRoute(route)
  return true
}

export async function saveSession(session: ClimbSession): Promise<void> {
  const sessions = await readArray<ClimbSession>(SESSIONS_KEY)
  const index = sessions.findIndex((item) => item.id === session.id)
  if (index >= 0) sessions.splice(index, 1)
  sessions.unshift(session)
  await safeWrite(SESSIONS_KEY, sessions.slice(0, 100))
}

export async function getSession(id: string): Promise<ClimbSession | undefined> {
  const session = (await readArray<ClimbSession>(SESSIONS_KEY)).find((item) => item.id === id)
  return session ? normalizeSession(session, await getRoute(session.templateId)) : undefined
}

export async function listSessions(limit?: number): Promise<ClimbSession[]> {
  const sessions = await readArray<ClimbSession>(SESSIONS_KEY)
  const normalized: ClimbSession[] = []
  for (const session of sessions) {
    try {
      normalized.push(normalizeSession(session, await getRoute(session.templateId)))
    } catch (err) {
      // 跳过损坏的单条会话，避免一条坏数据让整个 history 页崩溃
      console.warn('[steploop] skip corrupted session', session?.id, err)
    }
  }
  return typeof limit === 'number' && limit >= 0 ? normalized.slice(0, limit) : normalized
}

export async function deleteSession(id: string): Promise<void> {
  await safeWrite(
    SESSIONS_KEY,
    (await readArray<ClimbSession>(SESSIONS_KEY)).filter((item) => item.id !== id),
  )
}

export interface BackupPayload {
  version: 1 | 2
  exportedAt: number
  routes: RouteTemplate[]
  sessions: ClimbSession[]
  // 新增多轮训练记录，旧备份可能缺失，导入时按可选处理
  workouts?: ClimbWorkout[]
}

/** 导出当前设备的路线与会话数据；路线走 listRoutes 以保证已迁移且不丢旧键数据。 */
export async function exportRawData(): Promise<BackupPayload> {
  return {
    version: 2,
    exportedAt: Date.now(),
    routes: await listRoutes(),
    sessions: await readArray<ClimbSession>(SESSIONS_KEY),
    workouts: await readArray<ClimbWorkout>(WORKOUTS_KEY),
  }
}

/** 校验并导入备份文件；返回写入的路线、会话与训练数量。 */
export async function importRawData(payload: BackupPayload): Promise<{
  routesCount: number
  sessionsCount: number
  workoutsCount: number
}> {
  if (!payload || typeof payload !== 'object') {
    throw new Error('备份内容格式无效')
  }
  if (payload.version !== 1 && payload.version !== 2) {
    throw new Error(`不支持的备份版本：${payload.version}`)
  }
  if (!Array.isArray(payload.routes) || !Array.isArray(payload.sessions)) {
    throw new Error('备份内容缺少 routes 或 sessions 字段')
  }
  // 直接覆盖本地存储；导入前调用方应已弹窗确认。
  const migratedRoutes = payload.routes.map((route) => migrateRouteToV3(route))
  await safeWrite(ROUTES_KEY, migratedRoutes)
  await safeWrite(SESSIONS_KEY, payload.sessions)
  // workouts 可选（旧备份无此字段）
  const workouts = Array.isArray(payload.workouts) ? payload.workouts : []
  await safeWrite(WORKOUTS_KEY, workouts)
  return {
    routesCount: migratedRoutes.length,
    sessionsCount: payload.sessions.length,
    workoutsCount: workouts.length,
  }
}
