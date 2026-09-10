// Android 运行时权限与首次启动隐私协议。
//
// 与微信小程序 __usePrivacyCheck__ 不同，Android 上：
// - 首次启动时弹出应用自建的隐私协议页（pages/privacy），用户同意后才进入主流程
// - 涉及位置/传感器/身体活动等敏感权限时，调用 PermissionsAndroid.request 弹原生授权
// - 隐私协议状态用 AsyncStorage 持久化，可在设置页重新查看
//
// 本模块只管应用自建协议；具体到位置/传感器权限的请求由 services/location.ts
// 和 services/sensor.ts 在调用对应原生 API 前自行处理。

import AsyncStorage from '@react-native-async-storage/async-storage'

const PRIVACY_KEY = 'palou.privacy.agreed.v1'

export class PrivacyAuthorizeError extends Error {
  readonly stage: 'getPrivacySetting' | 'requirePrivacyAuthorize' | 'dismissed'
  readonly detail: string

  constructor(stage: PrivacyAuthorizeError['stage'], detail: string) {
    super(`privacy ${stage}: ${detail}`)
    this.name = 'PrivacyAuthorizeError'
    this.stage = stage
    this.detail = detail
  }
}

export function privacyAuthorizeErrorMessage(error: unknown): string {
  if (!(error instanceof PrivacyAuthorizeError)) return '隐私授权失败，请稍后重试。'
  switch (error.stage) {
    case 'dismissed':
      return '未同意隐私协议，无法使用定位与传感器功能。可在系统设置或重新进入应用时再次确认。'
    case 'requirePrivacyAuthorize':
      return `隐私授权失败：${error.detail}。请重启应用后重试。`
    case 'getPrivacySetting':
      return `读取隐私授权状态失败：${error.detail}`
  }
}

export async function isPrivacyAgreed(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(PRIVACY_KEY)
    if (!raw) return false
    const record = JSON.parse(raw)
    return Boolean(record && typeof record.agreedAt === 'number')
  } catch {
    return false
  }
}

export async function agreePrivacy(): Promise<void> {
  try {
    await AsyncStorage.setItem(
      PRIVACY_KEY,
      JSON.stringify({ agreedAt: Date.now(), version: 1 }),
    )
  } catch (err) {
    throw new PrivacyAuthorizeError(
      'requirePrivacyAuthorize',
      err instanceof Error ? err.message : String(err),
    )
  }
}

/**
 * 确保用户已同意应用自建隐私协议。
 * 与微信版本等价的入口签名，方便 sensor/location 调用方无感切换。
 */
export async function ensurePrivacyAuthorized(): Promise<void> {
  const agreed = await isPrivacyAgreed()
  if (!agreed) {
    throw new PrivacyAuthorizeError('dismissed', 'user has not agreed privacy policy yet')
  }
}
