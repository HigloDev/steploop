import AsyncStorage from '@react-native-async-storage/async-storage'
import { NativeModules, Platform } from 'react-native'
import { uid } from '../core/math'
import { RouteTemplate } from '../core/types'

const KEY = 'palou.preparation-device.v1'
let pending: Promise<string> | undefined
export function preparationDeviceKey(): Promise<string> {
  if (!pending) pending = (async () => {
    if (Platform.OS === 'android') {
      const readKey = NativeModules.AndroidTrainingSensors?.preparationDeviceKey
      if (!readKey) throw new Error('请使用新版安装包，才能保存这部手机的路线检查结果。')
      const key = await readKey()
      if (typeof key !== 'string' || !key.trim()) throw new Error('没有读到本机的路线检查记录，请重试。')
      return key
    }
    const existing = await AsyncStorage.getItem(KEY)
    if (existing) return existing
    const key = uid('local-device')
    await AsyncStorage.setItem(KEY, key)
    return key
  })().catch(error => { pending = undefined; throw error })
  return pending
}

/** Portable backups also cannot transfer local acceptance to another installation. */
export function scopePreparationToDevice(route: RouteTemplate, deviceKey: string): RouteTemplate {
  if (!route.preparation || route.preparation.deviceKey === deviceKey) return route
  return { ...route, status: 'needs_validation', preparation: { ...route.preparation,
    deviceKey, localChecksRequired: true,
    runs: route.preparation.runs.map(run => ({ ...run, passed: run.step.startsWith('teach') && run.passed })) } }
}
