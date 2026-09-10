// 定位权限与获取位置的工具服务。
//
// Android 流程：
// 0. ensurePrivacyAuthorized：先确认用户已同意应用自建隐私协议
// 1. PermissionsAndroid.request 请求 ACCESS_FINE_LOCATION
// 2. 已授权 -> expo-location getCurrentPositionAsync 获取位置
//
// 与微信小程序版同名导出保持兼容，但函数都改为 Promise 风格（AsyncStorage 影响）。

import * as Location from 'expo-location'
import { NativeModules, Platform } from 'react-native'
import {
  PrivacyAuthorizeError,
  ensurePrivacyAuthorized,
  isPrivacyAgreed,
  privacyAuthorizeErrorMessage,
} from './privacy'

export interface LocationResult {
  latitude: number
  longitude: number
  accuracy: number
  altitude: number | null
}

interface AndroidSystemLocationModule {
  getCurrentLocation(timeoutMs: number): Promise<LocationResult>
}

const androidSystemLocation = NativeModules.AndroidSystemLocation as
  | AndroidSystemLocationModule
  | undefined

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

  if (Platform.OS === 'android' && androidSystemLocation) {
    try {
      return await androidSystemLocation.getCurrentLocation(
        Math.max(options.expireMs ?? 10000, 5000),
      )
    } catch {
      // 少数设备的系统 LocationManager 也可能暂时无结果，再尝试 Expo 定位。
    }
  }

  try {
    const timeoutMs = Math.max(options.expireMs ?? 10000, 5000)

    // getCurrentPositionAsync 本身没有“等待多久就停止”的参数。
    // 之前把 timeInterval 当成超时使用，室内 GPS 信号弱时会一直等，看起来像按钮失效。
    // 地图选点同时请求卫星定位和网络辅助定位：卫星先到就用卫星，
    // 室内只有网络位置时也能先把地图带到用户附近。
    const currentPositions = [
      Location.getCurrentPositionAsync({
        accuracy:
          (options.highAccuracy ?? true) ? Location.Accuracy.High : Location.Accuracy.Balanced,
        mayShowUserSettingsDialog: true,
      }),
    ]
    if (options.highAccuracy ?? true) {
      currentPositions.push(
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          mayShowUserSettingsDialog: true,
        }),
      )
    }
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('location timeout')), timeoutMs)
    })

    let result: Location.LocationObject
    try {
      result = await Promise.race([Promise.any(currentPositions), timeout])
    } catch (currentError) {
      // GPS 暂时拿不到时，使用十分钟内、误差不超过 500 米的系统最近位置。
      // 先把地图带到用户附近，用户仍可拖动地图把大头针对准入口。
      const lastKnown = await Location.getLastKnownPositionAsync({
        maxAge: 600000,
        requiredAccuracy: 500,
      })
      if (!lastKnown) throw currentError
      result = lastKnown
    }

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

/**
 * 首页距离排序使用的静默定位入口。
 * 只有用户已同意隐私协议且系统定位权限已授予时才读取位置，绝不在首页弹权限框。
 */
export async function getCurrentLocationIfAuthorized(
  options: { highAccuracy?: boolean; expireMs?: number } = {},
): Promise<LocationResult | null> {
  if (!(await isPrivacyAgreed())) return null
  if (Platform.OS === 'android' || Platform.OS === 'ios') {
    const permission = await Location.getForegroundPermissionsAsync()
    if (permission.status !== 'granted') return null
  }
  return getCurrentLocation(options)
}
