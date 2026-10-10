import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Haptics from 'expo-haptics'
import { Platform, Vibration } from 'react-native'
import { SavedWorkoutSetup } from '../core/workout-setup'
import { TrackingMode } from '../core/types'
import { VoiceSpeaker, normalizeVoiceSpeaker } from '../core/voice-speaker'

const PREFS_KEY = 'palou.prefs.v1'

export interface Preferences {
  /** 震动反馈：识别推进、转向事件、结束时触发。默认开启。 */
  hapticFeedback: boolean
  /** 声音反馈：仅在结束时短促提示，避免爬楼过程中打扰他人。默认关闭。 */
  soundFeedback: boolean
  /** 训练保存成功后的盖楼结算音效，与语音播报独立。 */
  completionSound: boolean
  /** 开始标定/正式爬楼前提示确认携带方式。默认开启。 */
  carryReminder: boolean
  /** 上次使用的携带方式，用于在设置/确认时回显。 */
  lastCarryMode?: 'pocket' | 'waist'
  bodyWeightKg: number
  /**
   * D11 选项 C：是否已看过「训练中锁屏/切后台不会记录」的一次性说明。
   * 默认 false → 首次进入训练页时提示一次；用户关掉后不再打扰。
   */
  backgroundPauseHintSeen?: boolean
  lastTrainingRouteId?: string
  lastWorkoutSetup?: SavedWorkoutSetup
  trackingMode?: TrackingMode
  voiceEnabled?: boolean
  voiceSpeaker?: VoiceSpeaker
  voiceVolume?: number
  voiceMode?: 'concise' | 'standard' | 'coach'
  voiceRate?: number
  voiceBluetoothOnly?: boolean
  voiceNightQuiet?: boolean
  voiceDuckMusic?: boolean
  voiceEncouragement?: boolean
  voiceCalories?: boolean
  voiceSteps?: boolean
  voiceFloors?: boolean
}

const DEFAULTS: Preferences = {
  hapticFeedback: true,
  soundFeedback: false,
  completionSound: true,
  carryReminder: true,
  bodyWeightKg: 65,
  trackingMode: 'automatic',
  voiceEnabled: true,
  voiceSpeaker: 'serena',
  voiceVolume: 0.85,
  voiceMode: 'standard',
  voiceRate: 1,
  voiceBluetoothOnly: false,
  voiceNightQuiet: false,
  voiceDuckMusic: true,
  voiceEncouragement: true,
  voiceCalories: true,
  voiceSteps: true,
  voiceFloors: true,
}

let cached: Preferences | undefined
let lastWriteFailed = false

export function didPreferencesWriteFail(): boolean {
  return lastWriteFailed
}

async function readPrefs(): Promise<Preferences> {
  if (cached) return cached
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULTS }
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object') return { ...DEFAULTS }
    cached = { ...DEFAULTS, ...(value as Partial<Preferences>), voiceSpeaker: normalizeVoiceSpeaker(value.voiceSpeaker) }
    return cached
  } catch {
    return { ...DEFAULTS }
  }
}

export async function getPreferences(): Promise<Preferences> {
  return readPrefs()
}

export async function savePreferences(next: Partial<Preferences>): Promise<Preferences> {
  const merged = { ...(await readPrefs()), ...next }
  merged.voiceSpeaker = normalizeVoiceSpeaker(merged.voiceSpeaker)
  cached = merged
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(merged))
    lastWriteFailed = false
  } catch (err) {
    lastWriteFailed = true
    console.warn('[preferences] write failed', err)
  }
  return merged
}

const HAPTIC_MAP: Record<'light' | 'medium' | 'heavy', Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
}

/** 触发一次震动反馈；如已关闭则不执行。 */
export async function triggerHaptic(style: 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'error' = 'light'): Promise<void> {
  const prefs = await readPrefs()
  if (!prefs.hapticFeedback) return
  try {
    if (Platform.OS === 'android') {
      await Haptics.performAndroidHapticsAsync(style === 'selection' ? Haptics.AndroidHaptics.Segment_Tick
        : style === 'error' ? Haptics.AndroidHaptics.Reject
        : style === 'success' || style === 'heavy' ? Haptics.AndroidHaptics.Confirm
        : style === 'medium' ? Haptics.AndroidHaptics.Context_Click : Haptics.AndroidHaptics.Virtual_Key)
    } else if (Platform.OS === 'ios') {
      if (style === 'selection') await Haptics.selectionAsync()
      else if (style === 'success' || style === 'error') await Haptics.notificationAsync(style === 'success'
        ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error)
      else await Haptics.impactAsync(HAPTIC_MAP[style])
    }
  } catch {
    // 部分真机不支持震动，忽略错误。
  }
}

export type HapticPattern =
  | 'floor'
  | 'round_complete'
  | 'goal_complete'
  | 'recognition_warning'

/** 训练状态使用固定触感语言，UI 不自行拼装震动节奏。 */
export async function triggerHapticPattern(pattern: HapticPattern): Promise<void> {
  const prefs = await readPrefs()
  if (!prefs.hapticFeedback) return
  try {
    // 里程碑在口袋里也需要能辨认；使用系统振动服务，不依赖屏幕控件的触感开关。
    if (Platform.OS === 'android') {
      Vibration.vibrate(pattern === 'floor' ? [0, 65, 80, 65]
        : pattern === 'round_complete' ? [0, 100, 90, 140]
        : pattern === 'goal_complete' ? [0, 70, 70, 70, 90, 160] : [0, 120])
    } else if (Platform.OS === 'ios') {
      await Haptics.notificationAsync(pattern === 'recognition_warning'
        ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success)
    }
  } catch {
    // 触感反馈不阻塞训练状态机。
  }
}

/** 旧调用兼容；新的结算页直接管理真实音效与播放生命周期。 */
export async function triggerSound(result: 'success' | 'fail'): Promise<void> {
  const prefs = await readPrefs()
  if (!prefs.soundFeedback) return
  try {
    if (result === 'success') await (await import('./completion-sound')).playCompletionSound()
  } catch {
    // 忽略：声音反馈是次要体验，不应阻塞主流程。
  }
}
