// 定位权限与获取位置的工具服务。
//
// Android 流程：
// 0. ensurePrivacyAuthorized：先确认用户已同意应用自建隐私协议
// 1. PermissionsAndroid.request 请求 ACCESS_FINE_LOCATION
// 2. 已授权 -> expo-location getCurrentPositionAsync 获取位置
//
// 与微信小程序版同名导出保持兼容，但函数都改为 Promise 风格（AsyncStorage 影响）。

import * as Location from 'expo-location'
import { Platform } from 'react-native'
import {
  PrivacyAuthorizeError,
  ensurePrivacyAuthorized,
  privacyAuthorizeErrorMessage,
} from './privacy'

export interface LocationResult {
  latitude: number
  longitude: number
  accuracy: number
  altitude: number | null
}

export class LocationPermissionError extends Error {
  readonly stage: 'privacy' | 'getSetting' | 'authorize' | 'openSetting' | 'getLocation'
  readonly detail: string

  constructor(stage: LocationPermissionError['stage'], detail: string) {
    super(`${stage}: ${detail}`)
    this.name = 'LocationPermissionError'
    this.stage = stage
    this.detail = detail
  }
}

export function locationPermissionErrorMessage(error: unknown): string {
  if (error instanceof PrivacyAuthorizeError) {
    return privacyAuthorizeErrorMessage(error)
  }
  if (!(error instanceof LocationPermissionError)) {
    return '定位失败，请稍后重试。'
  }
  switch (error.stage) {
    case 'privacy':
      return privacyAuthorizeErrorMessage(
        new PrivacyAuthorizeError('requirePrivacyAuthorize', error.detail),
      )
    case 'authorize':
    case 'openSetting':
      return '未授予定位权限。请在系统设置 → 应用 → 爬楼 → 权限中开启「位置信息」后重试。'
    case 'getSetting':
      return `读取权限状态失败：${error.detail}`
    case 'getLocation':
      return '已授权但定位失败。请检查手机 GPS 是否开启、是否处于良好信号环境后重试。'
  }
}

/** 确保已获取定位权限；未授权则按需引导用户。 */
export async function ensureLocationPermission(): Promise<void> {
  try {
    await ensurePrivacyAuthorized()
  } catch (error) {
    if (error instanceof PrivacyAuthorizeError) {
      throw new LocationPermissionError('privacy', error.detail)
    }
    throw new LocationPermissionError('privacy', String(error))
  }

  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    // Web/其他平台无定位权限概念，直接放行
    return
  }

  const { status, canAskAgain } = await Location.getForegroundPermissionsAsync()
  if (status === 'granted') return

  if (!canAskAgain) {
    // 曾被拒绝且勾选"不再询问"，引导用户进系统设置
    throw new LocationPermissionError('openSetting', 'user denied permanently')
  }

  const request = await Location.requestForegroundPermissionsAsync()
  if (request.status !== 'granted') {
    throw new LocationPermissionError('authorize', 'user denied')
  }
}

/** chooseLocation 等地图类 API 的权限前置检查。 */
export async function ensureLocationPermissionSilent(): Promise<void> {
  return ensureLocationPermission()
}

/** 获取当前位置；授权未就绪时自动按流程引导。 */
export async function getCurrentLocation(
  options: { highAccuracy?: boolean; expireMs?: number } = {},
): Promise<LocationResult> {
  await ensureLocationPermission()

  try {
    const result = await Location.getCurrentPositionAsync({
      accuracy: options.highAccuracy ?? true ? Location.Accuracy.High : Location.Accuracy.Balanced,
      mayShowUserSettingsDialog: true,
      timeInterval: options.expireMs ?? 5000,
    })
    return {
      latitude: result.coords.latitude,
      longitude: result.coords.longitude,
      accuracy: result.coords.accuracy ?? 0,
      altitude: result.coords.altitude,
    }
  } catch (error) {
    throw new LocationPermissionError(
      'getLocation',
      error instanceof Error ? error.message : String(error),
    )
  }
}
