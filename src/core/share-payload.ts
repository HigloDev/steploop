// D10：分享文本 / 海报元数据的纯函数构造与隐私过滤。
//
// 隐私红线（合同 D10 验收 1）：
//   - 绝不输出精确地点：RouteLocation 的任何字段（name/address/latitude/longitude/
//     accuracy/source/confirmedAt）都不进分享内容，`locationName` 同样剔除；
//   - 绝不输出 participantId / deviceBrand 以及设备指纹的其它字段；
//   - 绝不输出绝对时间戳与时分秒：日期最多精确到 YYYY-MM-DD；
//   - 每一类被剔除的字段都会记录在 `redacted` 里，UI 据此说明「已隐藏 N 项」。
//
// 说明：
//   - 路线名称（`routeSnapshot.name`）不是地点字段，仅在 `includeRouteName` 显式开启时输出；
//   - 本次训练时长（`activeDurationMs`）是「时长」，不是墙上时钟时间，按 `X小时Y分Z秒`
//     输出，不含冒号形式，避免与日期时间混淆；
//   - 本模块只 `import type`，编译后没有任何运行时依赖（node:test 可直接加载源码）。
//
// 分享结果三态（合同 D10 验收 2）：只有 'success' 才算「已分享」；
// 'cancelled'（用户取消 / 面板未回报）与 'failed' 都不得写成成功。

import type { ClimbWorkout } from './types'

export interface SharePayloadInput {
  workout: ClimbWorkout
  mode: 'summary' | 'poster'
  includeRouteName?: boolean
  includeDate?: boolean // 只允许「日期」级别（YYYY-MM-DD），不允许时分秒
}

export interface SharePayload {
  title: string
  body: string
  /** 被隐私策略剔除掉的字段名，用于 UI 说明「已隐藏 3 项」。 */
  redacted: string[]
}

/** 分享 / 保存的三态结果。 */
export type ShareOutcome = 'success' | 'cancelled' | 'failed'

/** 系统分享面板的回报语义。 */
export type ShareSheetResult = 'resolved' | 'dismissed' | 'error'

/** 身份与设备字段：一律不出现在分享内容里。 */
const IDENTITY_FIELDS = [
  'participantId',
  'participantName',
  'deviceBrand',
  'deviceModel',
  'deviceId',
] as const

/**
 * 只有明确成功才算「已分享」：取消与失败一律为 false。
 * 这是 D10 验收 2 的唯一判据，UI 不得绕过它显示「分享成功」。
 */
export function isShareableResult(
  status: 'success' | 'cancelled' | 'failed',
): boolean {
  return status === 'success'
}

/**
 * 分享面板返回值 → 分享结果。
 *
 * `expo-sharing` / `react-native` 的分享面板都**不回报**用户是否真的把内容发出去了
 * （Android 的 chooser 返回时恒为 `sharedAction`，iOS 也只有 dismiss 回调），
 * 所以「面板返回」不能当作成功 —— 否则用户取消也会被记成已分享。
 * 因此除了明确的异常（failed），其余一律按「未确认的取消」处理。
 */
export function shareOutcomeFromSheetResult(
  result: ShareSheetResult,
): 'success' | 'cancelled' | 'failed' {
  if (result === 'error') return 'failed'
  return 'cancelled'
}

/** 分享用日期：只保留日期级别，永远不含时分秒。 */
export function formatShareDate(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 分享用时长：用「分/秒」单位而不是冒号，避免被误读成墙上时钟时间。 */
export function formatShareDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}小时`)
  if (hours > 0 || minutes > 0) parts.push(`${minutes}分`)
  parts.push(`${seconds}秒`)
  return parts.join('')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * 收集被隐私策略剔除的字段名。
 * 以「输入里真实存在、但分享内容里一定不出现」为准，字段不存在时不记账。
 */
function collectRedacted(workout: ClimbWorkout, includeDate: boolean): string[] {
  const redacted = new Set<string>()
  const raw = workout as unknown as Record<string, unknown>
  const routeSnapshot = asRecord(raw.routeSnapshot)

  // 1) 精确地点：RouteLocation 的任何字段都不进分享内容。
  if (routeSnapshot) {
    if (isNonEmptyString(routeSnapshot.locationName)) {
      redacted.add('routeSnapshot.locationName')
    }
    const location = asRecord(routeSnapshot.location)
    if (location) {
      for (const key of Object.keys(location)) {
        redacted.add(`routeSnapshot.location.${key}`)
      }
    }
  }
  if (isNonEmptyString(raw.locationName)) redacted.add('locationName')
  const topLevelLocation = asRecord(raw.location)
  if (topLevelLocation) {
    for (const key of Object.keys(topLevelLocation)) {
      redacted.add(`location.${key}`)
    }
  }

  // 2) 身份与设备品牌：participantId / deviceBrand 等一律剔除。
  for (const field of IDENTITY_FIELDS) {
    if (raw[field] !== undefined) redacted.add(field)
    if (routeSnapshot && routeSnapshot[field] !== undefined) {
      redacted.add(`routeSnapshot.${field}`)
    }
  }
  const device = asRecord(raw.device)
  if (device) {
    for (const key of Object.keys(device)) {
      redacted.add(`device.${key}`)
    }
  }

  // 3) 时间：只允许日期级别；时分秒与结束时间戳永不分享。
  if (typeof raw.startedAt === 'number') {
    redacted.add(includeDate ? 'startedAt.时分秒' : 'startedAt')
  }
  if (typeof raw.endedAt === 'number') {
    redacted.add('endedAt')
  }

  return [...redacted]
}

/**
 * 构造分享文本 / 海报元数据。
 * 输出只包含：日期（可选）、路线名称（可选）、楼层 / 爬升 / 时长 / 步数 / 轮数。
 */
export function buildSharePayload(input: SharePayloadInput): SharePayload {
  const {
    workout,
    mode,
    includeRouteName = false,
    includeDate = false,
  } = input
  const redacted = collectRedacted(workout, includeDate)
  // 旧/脏记录缺 routeSnapshot.name 时按「没有路线名」处理，不抛异常（includeRouteName 默认关）。
  const routeName =
    includeRouteName && typeof workout.routeSnapshot?.name === 'string'
      ? workout.routeSnapshot.name.trim()
      : ''
  const lines: string[] = []

  if (includeDate) lines.push(formatShareDate(workout.startedAt))
  if (routeName) lines.push(`路线：${routeName}`)

  if (mode === 'poster') {
    lines.push(`${workout.totalFloorsCompleted} 层`)
    lines.push(`累计爬升 ${workout.totalAscentM.toFixed(1)} 米`)
    lines.push(`净爬楼时间 ${formatShareDuration(workout.activeDurationMs)}`)
  } else {
    lines.push(`爬升楼层：${workout.totalFloorsCompleted}层`)
    lines.push(`累计爬升：${workout.totalAscentM.toFixed(1)}米`)
    lines.push(`净爬楼时间：${formatShareDuration(workout.activeDurationMs)}`)
    lines.push(`累计步数：${workout.totalSteps}步`)
    lines.push(`完成轮数：${workout.totalRoundsCompleted}轮`)
  }

  return {
    title: mode === 'poster' ? '循阶 · 爬楼成果海报' : '我的爬楼训练',
    body: lines.join('\n'),
    redacted,
  }
}
