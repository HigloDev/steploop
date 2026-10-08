import AsyncStorage from '@react-native-async-storage/async-storage'

const ONBOARDING_KEY = 'palou.onboarding.v1'

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(ONBOARDING_KEY)
    if (!raw) return false
    const record = JSON.parse(raw)
    return Boolean(record && typeof record.seenAt === 'number')
  } catch {
    return false
  }
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(
      ONBOARDING_KEY,
      JSON.stringify({ seenAt: Date.now(), version: 1 }),
    )
  } catch {
    // 存储失败时下次启动仍会展示引导。
  }
}
