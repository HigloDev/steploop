export const DEFAULT_BODY_WEIGHT_KG = 65
/** @deprecated 旧版纯时长口径（8 MET × 时长）。保留常量只为兼容读取。 */
export const STAIR_CLIMBING_MET = 8

/** 人体做功效率（上楼梯约 20%）。 */
export const MUSCLE_EFFICIENCY = 0.2
/** 爬楼时水平移动/姿态维持的代谢当量（不含垂直做功部分）。 */
export const HORIZONTAL_MET = 3
/** 轮间休息（站立、坐电梯）的代谢当量。 */
export const REST_MET = 1.3
const KCAL_PER_JOULE = 1 / 4184
const G = 9.81

export interface ClimbCalorieInput {
  /** 累计爬升高度（米）。 */
  ascentM: number
  /** 有步伐的活动时间（毫秒）：只含爬楼，不含休息、电梯。 */
  activeMs: number
  /** 轮间休息/下行时间（毫秒），按站立代谢计入少量消耗。 */
  restMs?: number
  bodyWeightKg?: number
}

function safeWeight(bodyWeightKg?: number): number {
  return Number.isFinite(bodyWeightKg) && (bodyWeightKg as number) > 20 && (bodyWeightKg as number) < 300
    ? (bodyWeightKg as number) : DEFAULT_BODY_WEIGHT_KG
}

/**
 * 爬楼热量（千卡，相对静息的净消耗）：
 *   垂直机械功 / 效率：体重 × g × 爬升高度 ÷ 0.2 ÷ 4184
 * + 水平部分：(3 MET − 1) × 体重 × 活动小时
 * + 休息部分：(1.3 MET − 1) × 体重 × 休息小时
 *
 * 主项由爬升高度决定，所以同样爬 14 层，爬得慢不会比爬得快“消耗更多”；
 * 旧版只按时长 × 8 MET 计算，慢爬反而热量更高。
 */
export function estimateClimbCalories(input: ClimbCalorieInput): number {
  const weight = safeWeight(input.bodyWeightKg)
  const ascent = Math.max(0, Number.isFinite(input.ascentM) ? input.ascentM : 0)
  const activeH = Math.max(0, Number.isFinite(input.activeMs) ? input.activeMs : 0) / 3_600_000
  const restH = Math.max(0, Number.isFinite(input.restMs) ? input.restMs! : 0) / 3_600_000
  const vertical = (weight * G * ascent / MUSCLE_EFFICIENCY) * KCAL_PER_JOULE
  const horizontal = (HORIZONTAL_MET - 1) * weight * activeH
  // 休息消耗上限为活动时长的 2 倍，避免长时间挂着不结束训练时热量虚高。
  const rest = (REST_MET - 1) * weight * Math.min(restH, activeH * 2)
  return vertical + horizontal + rest
}

/**
 * @deprecated 只有活动时长、没有爬升高度的旧调用：按每分钟约 4 层（≈12m）推算爬升后套用新公式。
 * 新代码请使用 estimateClimbCalories。
 */
export function calculateStairCalories(
  activeDurationMs: number,
  bodyWeightKg = DEFAULT_BODY_WEIGHT_KG,
): number {
  const activeMs = Math.max(0, Number.isFinite(activeDurationMs) ? activeDurationMs : 0)
  return estimateClimbCalories({ ascentM: (activeMs / 60000) * 12, activeMs, bodyWeightKg })
}

export function formatCalories(kilocalories: number): string {
  return Math.max(0, Math.round(kilocalories)).toString()
}
