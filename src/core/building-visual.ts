/** 记录图标按实际训练累计层数分档；这是图形简化，精确层数仍由记录正文显示。 */
export const BUILDING_LEVELS = [5, 15, 30, 60, 100, 200] as const

export function buildingVisualLevel(floors: number): number {
  const count = Number.isFinite(floors) ? Math.max(0, Math.floor(floors)) : 0
  const index = BUILDING_LEVELS.findIndex(limit => count <= limit)
  return index < 0 ? BUILDING_LEVELS.length : index
}
