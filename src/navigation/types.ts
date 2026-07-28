import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack'
import { RouteLocation } from '../core/types'

// 路由参数定义。
// mode=formal|validation, from=route-edit|settings 等。
// LocationPicker 接受可选 routeId：有 routeId 表示为旧路线补充地点模式，确认后写回路线；无 routeId 表示新建路线，确认后跳转 Calibrate。
export type RouteParam =
  | { name: 'RouteEdit'; params?: undefined }
  | { name: 'LocationPicker'; params?: { routeId?: string } }
  | { name: 'Calibrate'; params: { seed: CalibrateSeed } }
  | { name: 'Review'; params?: { draft?: never } }
  | { name: 'Validate'; params?: { id?: string } }
  | { name: 'Climb'; params: { id: string; mode: 'formal' | 'validation' } }
  | { name: 'Result'; params: { id: string } }
  | { name: 'Privacy'; params?: { from?: string } }
  | { name: 'History'; params?: undefined }
  | { name: 'Settings'; params?: undefined }

// 标定种子：从 LocationPicker 传给 Calibrate，再封装为 RouteSeed 进入 draft。
// carryMode 可选（默认 pocket），Calibrate 页内可选择修改。
export interface CalibrateSeed {
  name: string
  carryMode?: 'pocket' | 'waist'
  location: RouteLocation
}

export type RootStackParamList = {
  RouteEdit: undefined
  LocationPicker: { routeId?: string } | undefined
  Calibrate: { seed: CalibrateSeed }
  Review: undefined
  Validate: { id?: string }
  Climb: { id: string; mode: 'formal' | 'validation' }
  Result: { id: string }
  Privacy: { from?: string }
  History: undefined
  Settings: undefined
}

export type RootStackNavigation = NativeStackNavigationProp<RootStackParamList>
export type RootStackScreen<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>
