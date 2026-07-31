import { WorkoutPhase } from './types'

export interface WorkoutMachineState {
  phase: WorkoutPhase
  currentRoundNumber: number
  countdownRemaining?: number
  returningSince?: number
  recoveringSince?: number
}

export type WorkoutAction =
  | { type: 'START_WORKOUT' }
  | { type: 'BEGIN_ROUND_READY' }
  | { type: 'START_COUNTDOWN' }
  | { type: 'COUNTDOWN_TICK'; remaining: number }
  | { type: 'BEGIN_ASCENDING' }
  | { type: 'ROUND_COMPLETE' }
  | { type: 'BEGIN_RETURNING' }
  | { type: 'NEAR_START' } // 气压辅助检测接近起点
  | { type: 'CONFIRM_RETURNED' }
  | { type: 'BEGIN_RECOVERY' }
  | { type: 'START_NEXT_ROUND' }
  | { type: 'FINISH_WORKOUT' }
  | { type: 'GOAL_REACHED' }

export const INITIAL_WORKOUT_STATE: WorkoutMachineState = {
  phase: 'setup',
  currentRoundNumber: 0,
}

/**
 * 多轮训练状态机。纯函数，无副作用。
 * 副作用（传感器启停、持久化、导航）由 useClimbWorkout hook 处理。
 *
 * 状态流转：
 *   setup → round_ready → countdown → ascending → round_complete
 *         → returning → start_confirmation → recovering → countdown（下一轮）
 *   任意非 setup 状态 → workout_complete（用户主动结束）
 */
export function workoutReducer(
  state: WorkoutMachineState,
  action: WorkoutAction,
): WorkoutMachineState {
  switch (action.type) {
    case 'START_WORKOUT':
      if (state.phase !== 'setup') return state
      return {
        ...state,
        phase: 'round_ready',
        currentRoundNumber: 1,
      }

    case 'BEGIN_ROUND_READY':
      if (state.phase === 'setup' || state.phase === 'workout_complete') {
        return state
      }
      return { ...state, phase: 'round_ready' }

    case 'START_COUNTDOWN':
      if (state.phase !== 'round_ready') return state
      return { ...state, phase: 'countdown' }

    case 'COUNTDOWN_TICK':
      if (state.phase !== 'countdown') return state
      if (action.remaining > 0) {
        return { ...state, countdownRemaining: action.remaining }
      }
      return {
        ...state,
        phase: 'ascending',
        countdownRemaining: 0,
      }

    case 'BEGIN_ASCENDING':
      // 允许从 round_ready（countdownSeconds=0 跳过倒计时）或 countdown 转换
      if (state.phase !== 'round_ready' && state.phase !== 'countdown') return state
      return { ...state, phase: 'ascending' }

    case 'ROUND_COMPLETE':
      if (state.phase !== 'ascending') return state
      return { ...state, phase: 'round_complete' }

    case 'BEGIN_RETURNING':
      if (state.phase !== 'round_complete') return state
      return {
        ...state,
        phase: 'returning',
        returningSince: Date.now(),
      }

    case 'NEAR_START':
      if (state.phase !== 'returning') return state
      return { ...state, phase: 'start_confirmation' }

    case 'CONFIRM_RETURNED':
      if (state.phase !== 'returning' && state.phase !== 'start_confirmation') {
        return state
      }
      return {
        ...state,
        phase: 'recovering',
        recoveringSince: Date.now(),
        returningSince: undefined,
      }

    case 'BEGIN_RECOVERY':
      if (state.phase !== 'start_confirmation') return state
      return {
        ...state,
        phase: 'recovering',
        recoveringSince: Date.now(),
      }

    case 'START_NEXT_ROUND':
      if (state.phase !== 'recovering') return state
      return {
        ...state,
        phase: 'round_ready',
        currentRoundNumber: state.currentRoundNumber + 1,
        recoveringSince: undefined,
      }

    case 'FINISH_WORKOUT':
      if (state.phase === 'setup' || state.phase === 'workout_complete') {
        return state
      }
      return {
        ...state,
        phase: 'workout_complete',
        returningSince: undefined,
        recoveringSince: undefined,
        countdownRemaining: undefined,
      }

    case 'GOAL_REACHED':
      // 目标达成仅作提示，不强制改变 phase。用户可选择继续加练或完成训练。
      return state

    default:
      return state
  }
}

/**
 * 是否可在当前阶段结束训练。
 */
export function canFinishWorkout(phase: WorkoutPhase): boolean {
  return phase !== 'setup' && phase !== 'workout_complete'
}

/**
 * 是否为传感器高频阶段（需要加速度+陀螺仪+识别器）。
 */
export function isSensorHeavyPhase(phase: WorkoutPhase): boolean {
  return phase === 'ascending'
}

/**
 * 是否为气压低频阶段（仅保留气压计辅助判断高度）。
 */
export function isBarometerLightPhase(phase: WorkoutPhase): boolean {
  return phase === 'returning' || phase === 'start_confirmation'
}
