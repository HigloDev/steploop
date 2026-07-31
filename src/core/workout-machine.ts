import { WorkoutPhase } from './types'

export interface WorkoutMachineState {
  phase: WorkoutPhase
  currentRoundNumber: number
  returningSince?: number
  recoveringSince?: number
}

export type WorkoutAction =
  | { type: 'START_WORKOUT' }
  | { type: 'BEGIN_ROUND_READY' }
  | { type: 'BEGIN_ASCENDING' }
  | { type: 'ROUND_COMPLETE' }
  | { type: 'BEGIN_RETURNING' }
  | { type: 'NEAR_START' } // 气压辅助检测接近起点
  | { type: 'CONFIRM_RETURNED' }
  | { type: 'BEGIN_RECOVERY' }
  | { type: 'START_NEXT_ROUND' }
  | { type: 'FINISH_WORKOUT' }

export const INITIAL_WORKOUT_STATE: WorkoutMachineState = {
  phase: 'setup',
  currentRoundNumber: 0,
}

/**
 * 多轮训练状态机。纯函数，无副作用。
 * 副作用（传感器启停、持久化、导航）由 useClimbWorkout hook 处理。
 *
 * 状态流转：
 *   setup → round_ready → ascending → round_complete
 *         → returning → start_confirmation → recovering → round_ready（下一轮）
 *   任意非 setup 状态 → workout_complete（用户主动结束）
 *
 * 说明：countdown 阶段已移除（见 types.ts 中 WorkoutPhase 的注释），
 * round_ready 后直接 BEGIN_ASCENDING。
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

    case 'BEGIN_ASCENDING':
      // 从 round_ready 直接进入 ascending（倒计时已移除）
      if (state.phase !== 'round_ready') return state
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
      }

    default:
      return state
  }
}
