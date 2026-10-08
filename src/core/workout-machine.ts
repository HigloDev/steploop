import {
  PlanPhaseKind,
  PlanProgress,
  WorkoutPhase,
  WorkoutPlan,
  WorkoutPlanPhase,
} from './types'
import {
  initialPlanProgress,
  nextPlanPhase,
  planPhaseKinds,
  planProgressAt,
} from './workout-plan'

export interface WorkoutMachineState {
  phase: WorkoutPhase
  currentRoundNumber: number
  returningSince?: number
  recoveringSince?: number
  /**
   * D07：计划阶段游标（可选，旧状态/旧检查点没有该字段）。
   * 既有 reducer 转换不读也不写这些字段，因此不会改变任何既有行为；
   * 计划阶段由 hook（D07b）通过 workout-plan 的纯函数推进后写回。
   */
  planId?: string
  planPhaseIndex?: number
  skippedPlanPhases?: PlanPhaseKind[]
}

export type WorkoutAction =
  | { type: 'START_WORKOUT' }
  | { type: 'BEGIN_ROUND_READY' }
  | { type: 'BEGIN_ASCENDING' }
  | { type: 'ROUND_COMPLETE' }
  // F12：这三个动作会写入时间戳，时间必须由调用方传入。
  // reducer 内不允许调用 Date.now()：否则同一份输入在不同时刻会产出不同状态，
  // 回放/合成复现（replay）与单元测试都无法做到确定性。
  | { type: 'BEGIN_RETURNING'; at: number }
  | { type: 'NEAR_START'; at: number } // 气压辅助检测接近起点
  | { type: 'CONFIRM_RETURNED'; at: number }
  | { type: 'BEGIN_RECOVERY'; at: number }
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
/**
 * F12：从动作里取时间戳。缺失或非有限数字一律抛错。
 * 刻意**不**回退到 Date.now()：静默回退会让 reducer 再次变成非纯函数，
 * 而且会把「调用方忘了传时间」这种 bug 藏起来。
 */
function requireActionTime(action: { type: string; at?: number }): number {
  const at = action.at
  if (typeof at !== 'number' || !Number.isFinite(at)) {
    throw new Error(
      `${action.type} 动作必须携带有限数字 at（时间戳由调用方提供，reducer 不读系统时间）`,
    )
  }
  return at
}

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
        returningSince: requireActionTime(action),
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
        recoveringSince: requireActionTime(action),
        returningSince: undefined,
      }

    case 'BEGIN_RECOVERY':
      if (state.phase !== 'start_confirmation') return state
      return {
        ...state,
        phase: 'recovering',
        recoveringSince: requireActionTime(action),
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

// === D07：计划阶段（阶段序列驱动）桥接 ===
//
// 本节只做纯函数桥接，**不新增/不改变任何 reducer 转换**，因此既有状态机行为与既有测试
// 完全不变。hook 侧的接线（把计划阶段喂给 reducer、推进游标）是 D07b，由总控完成。

/** 计划阶段 → 状态机阶段。热身与每轮开始前的准备共用 round_ready。 */
export const PLAN_PHASE_TO_MACHINE_PHASE: Record<PlanPhaseKind, WorkoutPhase> = {
  warmup: 'round_ready',
  climb: 'ascending',
  return: 'returning',
  recovery: 'recovering',
}

export function machinePhaseForPlanPhase(kind: PlanPhaseKind): WorkoutPhase {
  return PLAN_PHASE_TO_MACHINE_PHASE[kind]
}

/**
 * 状态机阶段反查可能的计划阶段：round_ready 同时是热身与每轮起点，
 * setup / round_complete / workout_complete 不属于任何计划阶段。
 */
export function planPhaseKindsForMachinePhase(phase: WorkoutPhase): PlanPhaseKind[] {
  switch (phase) {
    case 'round_ready':
    case 'countdown':
      return ['warmup', 'climb']
    case 'ascending':
      return ['climb']
    case 'returning':
    case 'start_confirmation':
      return ['return']
    case 'recovering':
      return ['recovery']
    default:
      return []
  }
}

/**
 * 由状态机状态推导计划进度。
 * planPhaseIndex 缺省按 0 处理；已完成阶段由序列前缀推导，已跳过的阶段种类带入 skippedPhases。
 */
export function planProgressForState(
  state: WorkoutMachineState,
  plan: WorkoutPlan,
): PlanProgress {
  return planProgressAt(plan, state.planPhaseIndex ?? 0, {
    skippedPhases: state.skippedPlanPhases ?? [],
  })
}

/** 当前应执行的计划阶段；固定轮数计划结束后返回 undefined。 */
export function nextPlanPhaseForState(
  state: WorkoutMachineState,
  plan: WorkoutPlan,
): WorkoutPlanPhase | undefined {
  return nextPlanPhase(plan, planProgressForState(state, plan))
}

/** 把计划游标写回状态机状态（纯函数，不改 phase/currentRoundNumber）。 */
export function withPlanCursor(
  state: WorkoutMachineState,
  planId: string,
  progress: PlanProgress,
): WorkoutMachineState {
  return {
    ...state,
    planId,
    planPhaseIndex: progress.phaseIndex,
    skippedPlanPhases: [...progress.skippedPhases],
  }
}

/**
 * 计划驱动开练：等价于 START_WORKOUT 之后初始化计划游标。
 * 直接复用既有 reducer，保证与旧路径完全一致。
 */
export function startWorkoutWithPlan(plan: WorkoutPlan): WorkoutMachineState {
  const started = workoutReducer(INITIAL_WORKOUT_STATE, { type: 'START_WORKOUT' })
  return withPlanCursor(started, plan.id, initialPlanProgress(plan))
}

/** 计划声明的阶段种类（供 D07b 展示「本计划包含哪些环节」）。 */
export function planPhaseKindsForPlan(plan: WorkoutPlan): PlanPhaseKind[] {
  return planPhaseKinds(plan)
}
