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
import {
  ReturnConfirmationMode,
  RouteLocation,
  WorkoutGoal,
  WorkoutPlan,
  TrackingMode,
} from '../core/types'

export type RouteParam =
  | { name: 'RouteEdit'; params?: undefined }
  | { name: 'LocationPicker'; params?: { routeId?: string } }
  | { name: 'Calibrate'; params: { seed: CalibrateSeed } }
  | { name: 'Review'; params?: { draft?: never } }
  | { name: 'Validate'; params?: { id?: string } }
  | { name: 'RouteProfile'; params: { id: string } }
  | { name: 'WorkoutSetup'; params: { id: string; trackingMode?: TrackingMode } }
  | {
      name: 'ClimbWorkout'
      params: {
        id: string
        goal: WorkoutGoal
        returnConfirmationMode: ReturnConfirmationMode
        trackingMode?: TrackingMode
      }
    }
  | { name: 'WorkoutResult'; params: { id: string } }
  | { name: 'ShareStudio'; params: { id: string } }
  | { name: 'Result'; params: { id: string } }
  | { name: 'Privacy'; params?: { from?: string } }
  | { name: 'History'; params?: undefined }
  | { name: 'Settings'; params?: undefined }
  | { name: 'DiagnosticCapture'; params?: undefined }
  | { name: 'ClimbPreview'; params?: undefined }
  | { name: 'QuickStart'; params?: undefined }

export interface CalibrateSeed {
  routeId?: string
  name: string
  carryMode?: 'pocket' | 'waist'
  location: RouteLocation
}

export type MainTabParamList = {
  Train: undefined
  History: undefined
  Profile: undefined
}

export type RootStackParamList = {
  Privacy: { from?: string } | undefined
  Onboarding: { from?: string } | undefined
  Main: NavigatorScreenParams<MainTabParamList> | undefined
  Routes: undefined
  LocationPicker: { routeId?: string } | undefined
  Calibrate: { seed: CalibrateSeed }
  Review: undefined
  Validate: { id?: string }
  RouteProfile: { id: string }
  WorkoutSetup: { id: string; trackingMode?: TrackingMode }
  ClimbWorkout: {
    id: string
    goal: WorkoutGoal
    returnConfirmationMode: ReturnConfirmationMode
    plan?: WorkoutPlan
    trackingMode?: TrackingMode
  }
  WorkoutResult: { id: string }
  ShareStudio: { id: string }
  Result: { id: string }
  DiagnosticCapture: undefined
  ClimbPreview: undefined
  /** D05：无地点/无既有模板的快速开练入口 */
  QuickStart: undefined
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
