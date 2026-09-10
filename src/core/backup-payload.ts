import { ClimbSession, ClimbWorkout, RouteTemplate } from './types'

export interface BackupPayloadLike {
  version: 1 | 2
  exportedAt: number
  routes: RouteTemplate[]
  sessions: ClimbSession[]
  workouts?: ClimbWorkout[]
}

/**
 * 备份载荷校验（纯函数）。storage.importRawData 与设置页预览共用同一规则。
 */
export function validateBackupPayload(
  value: unknown,
): { ok: true; payload: BackupPayloadLike } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: '备份内容格式无效' }
  }
  const payload = value as Partial<BackupPayloadLike>
  if (payload.version !== 1 && payload.version !== 2) {
    return { ok: false, error: `不支持的备份版本：${String(payload.version)}` }
  }
  if (!Array.isArray(payload.routes) || !Array.isArray(payload.sessions)) {
    return { ok: false, error: '备份内容缺少 routes 或 sessions 字段' }
  }
  const workouts = Array.isArray(payload.workouts) ? payload.workouts : []
  return {
    ok: true,
    payload: {
      version: payload.version,
      exportedAt: typeof payload.exportedAt === 'number' ? payload.exportedAt : 0,
      routes: payload.routes,
      sessions: payload.sessions,
      workouts,
    },
  }
}
