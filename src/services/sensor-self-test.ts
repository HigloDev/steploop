import { Accelerometer, Barometer, Gyroscope } from 'expo-sensors'
import { assessTrainingSensors, RequiredTrainingSensor, SensorCheckEvidence } from '../core/sensor-self-test'
import { BARO_V1 } from '../core/sensor-params'

/** Checks actual events as well as hardware availability; subscriptions always released. */
export async function runTrainingSensorSelfTest() {
  const sensors = { barometer: Barometer, accelerometer: Accelerometer, gyroscope: Gyroscope }
  const evidence = {} as Record<RequiredTrainingSensor, SensorCheckEvidence>
  await Promise.all((Object.keys(sensors) as RequiredTrainingSensor[]).map(async key => {
    const sensor = sensors[key]
    const e: SensorCheckEvidence = { available: false, timestamps: [], validValues: true }
    evidence[key] = e
    try {
      e.available = await sensor.isAvailableAsync()
      if (!e.available) return
      sensor.setUpdateInterval(BARO_V1.selfTestIntervalMs)
      const subscription = sensor.addListener((value: { timestamp: number; pressure?: number; x?: number; y?: number; z?: number }) => {
        if (!Number.isFinite(value.timestamp)) { e.validValues = false; return }
        const valid = key === 'barometer' ? Number.isFinite(value.pressure) && value.pressure! > 0 :
          [value.x, value.y, value.z].every(Number.isFinite)
        e.validValues &&= valid
        e.timestamps.push(value.timestamp)
      })
      try { await new Promise<void>(resolve => setTimeout(resolve, BARO_V1.selfTestMs)) }
      finally { subscription.remove() }
    } catch { e.validValues = false }
  }))
  return assessTrainingSensors(evidence)
}
