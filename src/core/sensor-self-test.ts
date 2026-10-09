export type RequiredTrainingSensor = 'barometer' | 'accelerometer' | 'gyroscope'
export interface SensorCheckEvidence { available: boolean; timestamps: number[]; validValues: boolean }
export function assessTrainingSensors(evidence: Record<RequiredTrainingSensor, SensorCheckEvidence>): { canStart: boolean; problems: string[] } {
  const labels = { barometer: '气压计', accelerometer: '加速度计', gyroscope: '陀螺仪' }
  const problems = (Object.keys(labels) as RequiredTrainingSensor[]).flatMap(key => {
    const e = evidence[key]
    if (!e.available) return [`设备没有可用的${labels[key]}，无法开始锻炼。`]
    if (!e.validValues || e.timestamps.length < 2 || !e.timestamps.some((t, i) => i > 0 && t > e.timestamps[i - 1])) {
      return [`${labels[key]}未返回连续有效的新数据，请检查权限后重试。`]
    }
    return []
  })
  return { canStart: problems.length === 0, problems }
}
