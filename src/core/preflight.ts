// 开练前检查（preflight）：把「能不能开始训练」这件事从页面里的散落条件
// 收敛成一个纯函数，便于测试与复用。
//
// 设计原则（对齐交接不变量）：
// 1. 地点是可选的：拒绝定位 / 飞行模式 / 没有建筑起点，都必须能开练，
//    只是不记录地点、不进入地图统计 —— 用 warning 表达，不用 blocker。
// 2. 没有既有模板不是阻塞：第一轮就是建模板的（free/标定），用 info 表达。
// 3. 无气压计不是阻塞：算法用保守折扣降级，用 warning 表达。
// 4. 真正的阻塞只有「用户没同意隐私条款」这类硬约束（blocker）。
// 5. 绝不因为缺少某个可选输入就伪造数据；缺失就是缺失，如实说明影响。

import { CarryMode } from './types'

export type PreflightSeverity = 'blocker' | 'warning' | 'info'

export type PreflightCode =
  | 'privacy_not_agreed'
  | 'missing_location'
  | 'no_route_template'
  | 'barometer_unavailable'
  | 'carry_mode_recommendation'

export interface PreflightIssue {
  code: PreflightCode
  severity: PreflightSeverity
  title: string
  detail: string
}

export interface PreflightInput {
  /** 是否已同意隐私条款（未同意时无法启动传感器）。 */
  privacyAgreed: boolean
  /** 本次训练是否绑定一条已存在的路线。 */
  hasRoute: boolean
  /** 该路线是否已经有可用模板（segments 非空）。 */
  routeHasSegments: boolean
  /** 该路线是否有建筑起点位置。 */
  routeHasLocation: boolean
  /** 气压计可用性；'unknown' 表示尚未探测。 */
  barometerAvailable: boolean | 'unknown'
  carryMode: CarryMode
}

export interface PreflightResult {
  canStart: boolean
  issues: PreflightIssue[]
  blockers: PreflightIssue[]
  warnings: PreflightIssue[]
}

/**
 * 评估开练前置条件。
 * 纯函数：不读全局状态、不产生副作用、不编造缺失值。
 */
export function evaluateWorkoutPreflight(
  input: PreflightInput,
): PreflightResult {
  const issues: PreflightIssue[] = []

  if (!input.privacyAgreed) {
    issues.push({
      code: 'privacy_not_agreed',
      severity: 'blocker',
      title: '需要先同意隐私条款',
      detail: '训练需要采集加速度/陀螺仪数据，请先阅读并同意隐私条款。',
    })
  }

  if (input.hasRoute && !input.routeHasLocation) {
    issues.push({
      code: 'missing_location',
      severity: 'warning',
      title: '本次不记录地点',
      detail:
        '这条路线还没有建筑起点位置。训练与成绩照常保存，但不会记录地点，也不会进入地图相关统计。',
    })
  }

  if (!input.hasRoute || !input.routeHasSegments) {
    issues.push({
      code: 'no_route_template',
      severity: 'info',
      title: input.hasRoute ? '第一轮用于建立路线模板' : '未选择路线：边爬边建模板',
      detail:
        '第一轮会以自由采集方式记录完整样本，结束后据此生成路线模板；之后的轮次按模板识别。',
    })
  }

  if (input.barometerAvailable === false) {
    issues.push({
      code: 'barometer_unavailable',
      severity: 'warning',
      title: '设备没有气压计',
      detail:
        '楼层边界将主要依据动作特征判断，可信度按保守折扣计算；结论仍可用，但会更频繁地请你确认楼层。',
    })
  }

  if (input.carryMode === 'waist') {
    issues.push({
      code: 'carry_mode_recommendation',
      severity: 'info',
      title: '腰包携带需要更紧的固定',
      detail:
        '腰包若晃动明显会降低动作特征质量；请确保手机贴合身体。口袋携带通常最稳定。',
    })
  }

  const blockers = issues.filter((issue) => issue.severity === 'blocker')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  return { canStart: blockers.length === 0, issues, blockers, warnings }
}

/** 把 preflight 结果压成一句话，供按钮上方或无障碍提示使用。 */
export function summarizePreflight(result: PreflightResult): string {
  if (result.blockers.length > 0) {
    return result.blockers.map((issue) => issue.title).join('；')
  }
  if (result.warnings.length > 0) {
    return result.warnings.map((issue) => issue.title).join('；')
  }
  return '可以开始训练'
}
