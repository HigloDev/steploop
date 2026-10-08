import { Linking, NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native'
import type { SensorSample } from '../core/types'

/** Native capture runs independently of the bridge. Samples retain native time during replay. */
export interface BackgroundTrainingSample extends SensorSample {
  seq: number
  sessionId: string
  /** Android counter since boot, optional; it is not itself the workout step count. */
  steps?: number
}

export interface BackgroundTrainingStatus {
  supported: boolean
  running: boolean
  sessionId: string
  latestSequence: number
  earliestSequence: number
  acknowledgedSequence: number
  droppedSamples: number
  barometerAvailable: boolean
  stepsAvailable: boolean
  activityPermissionGranted: boolean
  notificationsAllowed: boolean
  /** Android power allowlist only; it is not proof of continuous sampling on a vendor build. */
  batteryOptimizationIgnored: boolean
  lastError: string | null
}

export interface BackgroundTrainingSettingsResult {
  opened: boolean
  destination: 'request_ignore' | 'application_details' | 'battery_settings' | 'unavailable'
}

export interface BackgroundTrainingReplay {
  sessionId: string
  samples: BackgroundTrainingSample[]
  latestSequence: number
  earliestSequence: number
  acknowledgedSequence: number
  droppedSamples: number
}

interface TrainingNativeModule {
  start(options: { sessionId: string; intervalMs: number; barometerIntervalMs: number }): Promise<BackgroundTrainingStatus>
  stop(): Promise<BackgroundTrainingStatus>
  status(): Promise<BackgroundTrainingStatus>
  requestIgnoreBatteryOptimizations?(): Promise<BackgroundTrainingSettingsResult>
  openBatteryOptimizationSettings?(): Promise<BackgroundTrainingSettingsResult>
  drain(afterSequence: number, limit: number): Promise<BackgroundTrainingReplay>
  acknowledge(sequence: number): Promise<void>
  addListener(name: string): void
  removeListeners(count: number): void
}

const native: TrainingNativeModule | undefined = Platform.OS === 'android' ? NativeModules?.AndroidTrainingSensors : undefined
const unsupported: BackgroundTrainingStatus = {
  supported: false, running: false, sessionId: '', latestSequence: 0, earliestSequence: 1,
  acknowledgedSequence: 0, droppedSamples: 0, barometerAvailable: false, stepsAvailable: false,
  activityPermissionGranted: false, notificationsAllowed: false, batteryOptimizationIgnored: false, lastError: 'native_training_unavailable',
}
let emitter: NativeEventEmitter | undefined

export function isBackgroundTrainingSupported(): boolean { return !!native }

export async function getBackgroundTrainingStatus(): Promise<BackgroundTrainingStatus> {
  return native ? normalizeStatus(await native.status()) : { ...unsupported }
}

function normalizeStatus(status: BackgroundTrainingStatus): BackgroundTrainingStatus {
  return { ...unsupported, ...status, batteryOptimizationIgnored: status.batteryOptimizationIgnored === true }
}

/** This opens a system UI; refresh status after returning to learn the user's decision. */
export async function requestIgnoreBatteryOptimizations(): Promise<BackgroundTrainingSettingsResult> {
  if (native?.requestIgnoreBatteryOptimizations) return native.requestIgnoreBatteryOptimizations()
  return openApplicationSettingsFallback()
}

export async function openBatteryOptimizationSettings(): Promise<BackgroundTrainingSettingsResult> {
  if (native?.openBatteryOptimizationSettings) return native.openBatteryOptimizationSettings()
  return openApplicationSettingsFallback()
}

async function openApplicationSettingsFallback(): Promise<BackgroundTrainingSettingsResult> {
  if (Platform.OS === 'android' && Linking?.openSettings) {
    try {
      await Linking.openSettings()
      return { opened: true, destination: 'application_details' }
    } catch { /* The device may not expose an application settings activity. */ }
  }
  return { opened: false, destination: 'unavailable' }
}

export async function startBackgroundTraining(sessionId: string): Promise<BackgroundTrainingStatus> {
  if (!native) throw new Error('此版本未包含 Android 后台训练服务，请保持应用在前台记录。')
  if (!sessionId.trim()) throw new Error('后台训练需要有效训练编号。')
  if (Number(Platform.Version) >= 29) {
    const permission = PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION
    const granted = await PermissionsAndroid.check(permission) ||
      await PermissionsAndroid.request(permission) === PermissionsAndroid.RESULTS.GRANTED
    if (!granted) throw new Error('后台训练需要身体活动权限。你仍可在前台使用手动记录。')
  }
  if (Number(Platform.Version) >= 33) {
    const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
    if (!await PermissionsAndroid.check(permission)) await PermissionsAndroid.request(permission)
    // Android still permits a user-started FGS when the notification drawer permission is denied.
  }
  return normalizeStatus(await native.start({ sessionId, intervalMs: 20, barometerIntervalMs: 200 }))
}

export async function stopBackgroundTraining(): Promise<BackgroundTrainingStatus> {
  return native ? normalizeStatus(await native.stop()) : { ...unsupported }
}

export function subscribeBackgroundSamples(listener: (sample: BackgroundTrainingSample) => void): { remove(): void } {
  if (!native) return { remove() {} }
  emitter ??= new NativeEventEmitter(native as never)
  return emitter.addListener('palouTrainingSensor', listener)
}

export async function drainBackgroundSamples(afterSequence = 0, limit = 1000): Promise<BackgroundTrainingReplay> {
  if (!native) return { sessionId: '', samples: [], latestSequence: 0, earliestSequence: 1, acknowledgedSequence: 0, droppedSamples: 0 }
  return native.drain(Math.max(0, Math.floor(afterSequence)), Math.min(2000, Math.max(1, Math.floor(limit))))
}

export async function acknowledgeBackgroundSamples(sequence: number): Promise<void> {
  if (native && Number.isFinite(sequence)) await native.acknowledge(Math.max(0, Math.floor(sequence)))
}
