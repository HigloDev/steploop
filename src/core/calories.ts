export const DEFAULT_BODY_WEIGHT_KG = 65
export const STAIR_CLIMBING_MET = 8

/**
 * 通用 MET 估算：千卡 = MET × 体重（千克）× 有效运动时长（小时）。
 * 爬楼阶段按 8 MET 计算，返回、电梯和休息时间不计入。
 */
export function calculateStairCalories(
  activeDurationMs: number,
  bodyWeightKg = DEFAULT_BODY_WEIGHT_KG,
): number {
  const safeDurationMs = Math.max(0, activeDurationMs)
  const safeWeightKg =
    Number.isFinite(bodyWeightKg) && bodyWeightKg > 0
      ? bodyWeightKg
      : DEFAULT_BODY_WEIGHT_KG

  return STAIR_CLIMBING_MET * safeWeightKg * (safeDurationMs / 3_600_000)
}

export function formatCalories(kilocalories: number): string {
  return Math.max(0, Math.round(kilocalories)).toString()
}
