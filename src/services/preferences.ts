import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Haptics from 'expo-haptics'
import { Platform } from 'react-native'

const PREFS_KEY = 'palou.prefs.v1'

export interface Preferences {
  /** 震动反馈：识别推进、转向事件、结束时触发。默认开启。 */
  hapticFeedback: boolean
  /** 声音反馈：仅在结束时短促提示，避免爬楼过程中打扰他人。默认关闭。 */
  soundFeedback: boolean
  /** 开始标定/正式爬楼前提示确认携带方式。默认开启。 */
  carryReminder: boolean
  /** 上次使用的携带方式，用于在设置/确认时回显。 */
  lastCarryMode?: 'pocket' | 'waist'
  bodyWeightKg: number
}

const DEFAULTS: Preferences = {
  hapticFeedback: true,
  soundFeedback: false,
  carryReminder: true,
  bodyWeightKg: 65,
}

let cached: Preferences | undefined

async function readPrefs(): Promise<Preferences> {
  if (cached) return cached
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULTS }
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object') return { ...DEFAULTS }
    cached = { ...DEFAULTS, ...(value as Partial<Preferences>) }
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
  cached = merged
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(merged))
  } catch {
    // 存储失败时静默忽略，下次仍读取旧值。
  }
  return merged
}

const HAPTIC_MAP: Record<'light' | 'medium' | 'heavy', Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
}

/** 触发一次震动反馈；如已关闭则不执行。 */
export async function triggerHaptic(style: 'light' | 'medium' | 'heavy' = 'light'): Promise<void> {
  const prefs = await readPrefs()
  if (!prefs.hapticFeedback) return
  try {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      await Haptics.impactAsync(HAPTIC_MAP[style])
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
    const impact = (style: Haptics.ImpactFeedbackStyle) =>
      Haptics.impactAsync(style)
    if (pattern === 'floor') {
      await impact(Haptics.ImpactFeedbackStyle.Light)
      return
    }
    if (pattern === 'recognition_warning') {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      return
    }
    await impact(
      pattern === 'goal_complete'
        ? Haptics.ImpactFeedbackStyle.Heavy
        : Haptics.ImpactFeedbackStyle.Medium,
    )
    await new Promise((resolve) => setTimeout(resolve, 140))
    await impact(
      pattern === 'goal_complete'
        ? Haptics.ImpactFeedbackStyle.Heavy
        : Haptics.ImpactFeedbackStyle.Medium,
    )
  } catch {
    // 触感反馈不阻塞训练状态机。
  }
}

/**
 * 触发一次声音反馈：用震动通知 style=Heavy 模拟"结束提示"。
 * RN 没有等价于 wx.showToast 内置音效，统一用震动替代。
 */
export async function triggerSound(result: 'success' | 'fail'): Promise<void> {
  const prefs = await readPrefs()
  if (!prefs.soundFeedback) return
  try {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      await Haptics.notificationAsync(
        result === 'success'
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Error,
      )
    }
  } catch {
    // 忽略：声音反馈是次要体验，不应阻塞主流程。
  }
}
