import { NavigatorScreenParams } from '@react-navigation/native'
import {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack'
import {
  BottomTabNavigationProp,
  BottomTabScreenProps,
} from '@react-navigation/bottom-tabs'
import { CompositeNavigationProp, CompositeScreenProps } from '@react-navigation/native'

export type MainTabParamList = {
  Train: undefined
  History: undefined
  Profile: undefined
}

export interface ClimbWorkoutParams {
  /** 选用已保存的楼栋模板（跳过标定）。 */
  templateId?: string
  /** 新楼标定的起始楼层（默认 1，跳过 0）。 */
  startFloor?: number
  /** 重新标定：结算时覆盖这个模板。 */
  recalibrateTemplateId?: string
  /** 从未结束训练的检查点恢复。 */
  resume?: boolean
}

// fusion-v1：流程精简为 首页 → 训练 → 结算（+ 记录、设置）。
// 已删除：Routes/LocationPicker/Calibrate/Review/Validate/RouteProfile/AddRoute/Familiarize/WorkoutSetup/ClimbPreview/QuickStart。
export type RootStackParamList = {
  Privacy: { from?: string } | undefined
  Onboarding: { from?: string } | undefined
  Main: NavigatorScreenParams<MainTabParamList> | undefined
  ClimbWorkout: ClimbWorkoutParams | undefined
  /** 结算页；fresh=true 表示刚结束的训练。 */
  WorkoutResult: { id: string; fresh?: boolean }
  ShareStudio: { id: string }
  WeeklyShare: undefined
  /** 旧版单轮会话记录（只读）。 */
  Result: { id: string; roundId?: string }
  DiagnosticCapture: undefined
}

export type RootStackNavigation = NativeStackNavigationProp<RootStackParamList>
export type RootStackScreen<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>

export type MainTabNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList>,
  RootStackNavigation
>

export type MainTabScreen<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  RootStackScreen<keyof RootStackParamList>
>

export type MainTabAnyScreen = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList>,
  RootStackScreen<keyof RootStackParamList>
>
