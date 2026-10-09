// 多轮训练编排 Hook：状态机 + 单轮识别协调 + 检查点持久化 + 目标检测。
//
// 职责边界：
// - 管理 WorkoutPhase 状态流转（setup → round_ready → ascending
//   → round_complete → returning → start_confirmation → recovering → 下一轮）
// - 在 ascending 阶段调用 useClimbRoundSession 创建本轮识别三件套
// - 轮次结束后固化 WorkoutRound 并写入 workout.rounds
// - 每次状态变化持久化 ActiveWorkoutCheckpoint
// - 训练结束时 saveWorkout 并清理 checkpoint
// - 派生训练汇总（calculateWorkoutSummary）
// - 检测目标达成（checkGoalReached）
//
// 不负责：
// - UI 视觉表现（由 ClimbWorkout.tsx 渲染）
// - 路线模板加载（由调用方传入 template）
// - 历史记录列表（由 History 页直接读 storage）

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, AppStateStatus } from 'react-native'
import { useClimbRoundSession } from './useClimbRoundSession'
import {
  calculateWorkoutSummary,
  checkGoalReached,
  buildInterruptedRound,
  roundFromSession,
} from '../core/workout-summary'
import {
  analyzeCalibration,
  buildSegments,
  rebuildDraftBoundaries,
} from '../core/analysis'
import {
  getFloorTransitionCount,
} from '../core/floors'
import { applyRoundCorrection } from '../core/corrections'
import { resolveTrackingMode, trainingPhasePrompt, TrainingAutomation, TrainingAutomationObservation } from '../core/training-automation'
import {
  createWorkoutEvidenceJournal,
  recordWorkoutEvidenceEvent,
  WorkoutEvidenceJournal,
} from '../services/workout-evidence'
import { isBackgroundTrainingSupported, startBackgroundTraining, stopBackgroundTraining } from '../services/background-training'
import {
  INITIAL_WORKOUT_STATE,
  WorkoutAction,
  WorkoutMachineState,
  withPlanCursor,
  workoutReducer,
} from '../core/workout-machine'
import {
  advancePlanProgress,
  buildPlanFeedback,
  canSkipPhase,
  completedRoundCount,
  finishPlanProgress,
  initialPlanProgress,
  nextPlanPhase,
  type PlanFeedback,
  type PlanPhaseOutcome,
} from '../core/workout-plan'
import {
  ActiveWorkoutCheckpoint,
  BarometerStatus,
  ClimbSession,
  ClimbMode,
  ClimbWorkout,
  PlanProgress,
  ReturnConfirmationMode,
  RouteTemplate,
  TrackingMode,
  RecognitionSnapshot,
  SensorSample,
  WorkoutGoal,
  WorkoutPhase,
  WorkoutPlan,
  WorkoutPlanPhase,
  WorkoutRound,
  WorkoutSummary,
} from '../core/types'
import {
  clearActiveCheckpoint,
  createWorkout,
  loadActiveCheckpoint,
  saveActiveCheckpoint,
  saveWorkout,
  listWorkouts,
} from '../services/workout-storage'
import { getRoute, saveRoute } from '../services/storage'
import { SensorRecorder } from '../services/sensor'
import {
  emptySensorVisualization,
  SensorMotionInterpreter,
  SensorVisualizationState,
} from '../core/sensor-visualization'
import { hasKnownRouteEnd } from '../core/route-state'
import { isLearningEligibleRound, updateRouteModelFromWorkouts } from '../core/route-model'

// 气压转高度系数：近海平面 1 hPa ≈ 8.3 m。
// 用线性近似已足够判断"是否回到起点"，无需引入完整气压公式。
const METERS_PER_HPA = 8.3
// 采集多少个气压样本后建立基线（约 1 秒，BAROMETER_INTERVAL_MS=200）
const BASELINE_SAMPLE_COUNT = 5

export interface UseClimbWorkoutOptions {
  template: RouteTemplate
  goal: WorkoutGoal
  returnConfirmationMode: ReturnConfirmationMode
  trackingMode?: TrackingMode
  bodyWeightKg?: number
  /** Final feedback drains while the FGS still grants background audio focus. */
  beforeBackgroundStop?: (savedWorkout: ClimbWorkout) => Promise<void>
  /**
   * D07b：可选训练计划（热身/上爬/返回/恢复的阶段序列）。
   * 不传 = 旧行为：状态机照常按目标数字驱动，不产生计划进度与热身计时。
   */
  plan?: WorkoutPlan
}

export interface WorkoutTimerState {
  // 训练总历时
  totalElapsedMs: number
  // 当前阶段已用时（ascending 本轮用时、returning 返回用时、recovering 休息用时）
  phaseElapsedMs: number
}

export interface UseClimbWorkoutResult {
  // 状态机
  phase: WorkoutPhase
  currentRoundNumber: number
  // 训练对象（每次轮次变化都会更新）
  workout: ClimbWorkout | null
  // 派生汇总
  summary: WorkoutSummary | null
  // 目标达成提示（空字符串表示未达成或无目标）
  goalMessage: string
  // 计时
  timer: WorkoutTimerState
  // 单轮会话（仅 ascending 阶段有意义，其他阶段为 idle 状态）
  roundSession: ReturnType<typeof useClimbRoundSession>
  // 当前轮已固化的 WorkoutRound（round_complete 后才有值）
  currentRound: WorkoutRound | null
  // 上一轮 WorkoutRound（用于轮间对比）
  previousRound: WorkoutRound | null
  // 当前实际使用的路线。首次采集生成模板后会立即更新，避免页面继续使用旧占位数据。
  activeTemplate: RouteTemplate

  // === 气压辅助（returning 阶段） ===
  // 返回阶段气压计是否可用
  returnBarometerAvailable: boolean
  // 相对起点高度（米）。正值=高于起点，0=回到起点。undefined=无气压计或未建立基线
  relativeHeightM: number | undefined
  // 是否已接近起点（assisted 模式下用于自动触发 start_confirmation）
  nearStart: boolean
  // 返回阶段的波形与动作判断（下楼、转弯、乘电梯）
  returnVisualization: SensorVisualizationState
  trackingMode: TrackingMode
  setTrackingMode: (mode: TrackingMode) => void
  setAutomaticTransitionsPaused: (paused: boolean) => void
  automationStatus: string
  elevatorDescending: boolean
  evidenceSaveError: string
  backgroundServiceStopError: string

  // === 动作 ===
  // 开始训练：setup → round_ready
  startWorkout: () => void
  // 开始本轮爬升：round_ready → ascending
  beginAscending: () => void
  finishRound: (options?: { confirmedEndFloor?: number; excludeFromLearning?: boolean }) => Promise<boolean>
  // 用户主动结束训练（任意非 setup 阶段）
  finishWorkout: (options?: {
    // ascending 阶段是否保存未完成轮
    saveIncompleteRound?: boolean
    // 新路线首次采集结束时，由用户确认实际到达楼层
    confirmedEndFloor?: number
    // 异常轮次照常保存训练记录，但不用于生成或修正路线
    excludeFromLearning?: boolean
  }) => Promise<ClimbWorkout | null>
  // 首次采集到达真实终点：只结束本轮并进入返回阶段，不结束整次训练。
  completeLearningRound: (confirmedEndFloor: number) => Promise<boolean>
  // 识别到终点但未达到自动完成门槛时，由用户确认本轮完成并进入返程。
  confirmCurrentRoundComplete: () => Promise<boolean>
  // 丢弃当前未完成轮并结束训练
  discardCurrentRoundAndFinish: () => Promise<ClimbWorkout | null>
  // 用户点击"我已回到1F"：returning/start_confirmation → recovering
  confirmReturnedToStart: () => void
  // 用户点击"开始下一轮"：recovering → round_ready（再经 ascending → 下一轮爬升）
  startNextRound: () => void
  // 用户在 returning 阶段手动确认接近起点（触发 start_confirmation）
  manualNearStart: () => void
  // 用户在 start_confirmation 点击"还没有"：回到 returning
  notYetAtStart: () => void
  // 继续加练（目标达成后不结束）
  continueExtraRound: () => void
  // round_complete 阶段手动开始返回（也可等 2s 自动触发）
  beginReturning: () => void
  // 恢复检查点训练（应用重启后调用）
  resumeFromCheckpoint: (
    checkpoint: ActiveWorkoutCheckpoint,
    template: RouteTemplate,
  ) => void

  // === 恢复点持久化（D03）===
  // 恢复点保存失败时的用户可读原因；空字符串表示当前无错误。
  // 恢复点是「应用被杀后还能继续训练」的唯一依据，写失败必须让用户看见。
  checkpointSaveError: string
  // === 后台缺段告知（D11 预备）===
  // 从后台回到前台且离开时间较长时的可读说明；空字符串表示无提示。
  // Android 在后台会暂停传感器回调，这段时间没有样本，必须如实告知用户。
  backgroundGapWarning: string
  // 用户已读提示后清空
  dismissBackgroundGapWarning: () => void

  // === 首边建模板 ===
  // 是否为首次开张模式（template.segments 为空）
  firstRoundCalibration: boolean
  // 模板是否已生成（第一轮结束后 true）
  templateGenerated: boolean

  // === D07b：计划（阶段序列）===
  // 本次训练使用的计划；无计划（旧目标）时为 null。
  plan: WorkoutPlan | null
  // 当前应执行的计划阶段（热身/上爬/返回/恢复）；计划走完为 null。
  planPhase: WorkoutPlanPhase | null
  // 计划游标（含已完成/已跳过阶段）；无计划为 null。
  planProgress: PlanProgress | null
  // 当前计划轮次（1-based）与剩余轮数（'unknown' = 由目标决定）。
  planRoundNumber: number
  planRemainingRounds: number | 'unknown'
  // 当前阶段是否可跳过（热身/恢复可跳过；上爬/返回不可跳过）。
  canSkipCurrentPlanPhase: boolean
  // 跳过当前可选阶段。返回是否真的跳过了（不可跳过时返回 false 且不改任何状态）。
  skipCurrentPlanPhase: () => boolean
  // 完成反馈（来自 buildPlanFeedback，页面只负责展示，不再另写判定）。
  planFeedback: PlanFeedback | null
  // 热身净时长（毫秒）；不计入 activeDurationMs。
  warmupDurationMs: number
  // 计划走完后的「自由加练」：状态机照常进入下一轮，但计划里已没有对应阶段。
  extraRounds: boolean
}

function buildRouteSnapshot(template: RouteTemplate): ClimbWorkout['routeSnapshot'] {
  const knownEnd = hasKnownRouteEnd(template)
  return {
    name: template.name,
    locationName: template.location?.name ?? template.name,
    startFloor: template.startFloor,
    endFloor: knownEnd ? template.endFloor : template.startFloor,
    floorsPerRound: knownEnd
      ? getFloorTransitionCount(template.startFloor, template.endFloor)
      : 0,
    ascentPerRoundM: knownEnd ? template.totalAscentM : 0,
  }
}

/** A user's confirmed accomplishment contributes to ordinary statistics regardless of model trust. */
function ordinaryWeeklyContribution(rounds: WorkoutRound[]): NonNullable<ClimbWorkout['weeklyContribution']> {
  const contributing = rounds.filter((round) => round.floorCounting === 'transitions' || round.trustworthy)
  return {
    workouts: contributing.some((round) => round.trustworthy || round.floorsCompleted > 0 || round.steps > 0 || round.durationMs > 0) ? 1 : 0,
    floors: contributing.reduce((sum, round) => sum + round.floorsCompleted, 0),
    ascentM: contributing.reduce((sum, round) => sum + round.ascentM, 0),
  }
}

export function useClimbWorkout(
  options: UseClimbWorkoutOptions,
): UseClimbWorkoutResult {
  const { template, goal, returnConfirmationMode, plan: planOption } = options
  const beforeBackgroundStopRef = useRef(options.beforeBackgroundStop)
  beforeBackgroundStopRef.current = options.beforeBackgroundStop

  const [machine, setMachine] = useState<WorkoutMachineState>(
    INITIAL_WORKOUT_STATE,
  )
  const [workout, setWorkout] = useState<ClimbWorkout | null>(null)
  const [currentRound, setCurrentRound] = useState<WorkoutRound | null>(null)
  const [timer, setTimer] = useState<WorkoutTimerState>({
    totalElapsedMs: 0,
    phaseElapsedMs: 0,
  })
  const [goalMessage, setGoalMessage] = useState('')
  const [trackingMode, setTrackingModeState] = useState<TrackingMode>(() => resolveTrackingMode(options.trackingMode, returnConfirmationMode))
  const trackingModeRef = useRef(trackingMode)
  trackingModeRef.current = trackingMode
  const automationRef = useRef(new TrainingAutomation(trackingMode, { floorHeightM: template.floorHeightM }))
  const [automationStatus, setAutomationStatus] = useState('准备记录训练')
  const [elevatorDescending, setElevatorDescending] = useState(false)
  const [evidenceSaveError, setEvidenceSaveError] = useState('')
  const [backgroundServiceStopError, setBackgroundServiceStopError] = useState('')
  const [automaticTransitionsPaused, setAutomaticTransitionsPausedState] = useState(false)
  const automaticTransitionsPausedRef = useRef(false)
  const automationActionsRef = useRef<{
    finish: (at?: number) => void
    returned: () => void
    next: (at: number) => void
  }>({ finish: () => undefined, returned: () => undefined, next: () => undefined })
  const roundObservationRef = useRef<RecognitionSnapshot | undefined>(undefined)
  const backgroundStartPromiseRef = useRef<Promise<void> | undefined>(undefined)
  const backgroundCaptureActiveRef = useRef(false)
  const pendingRoundSeedRef = useRef<{ startedAt: number; seedSamples: SensorSample[] } | undefined>(undefined)
  const returnSampleWindowRef = useRef<SensorSample[]>([])
  const completedSessionIdsRef = useRef(new Set<string>())
  const finishingWorkoutRef = useRef(false)

  // === 首边建模板（边爬边建模板）===
  // 当 template.segments 为空时，第一轮用 free 模式（仅气压计估楼层），
  // 结束后用采集的样本调用 analyzeCalibration 生成 segments，升级为 verified 路线。
  // templateGenerated 标记本轮训练中是否已生成模板（UI 用于显示提示）。
  const firstRoundCalibration = !hasKnownRouteEnd(template)
  const [effectiveTemplate, setEffectiveTemplate] = useState<RouteTemplate>(template)
  const [templateGenerated, setTemplateGenerated] = useState(false)
  // 同步外部 template prop 到 effectiveTemplate。
  // 必需：ClimbWorkout 页面加载路线是异步的，初始传入 DUMMY_TEMPLATE，
  // routeTpl 加载完成后会传入真实 template，必须同步否则 roundSession 用空模板。
  useEffect(() => {
    setEffectiveTemplate(template)
  }, [template])
  // 第一轮用 free 模式，生成模板后切换为 formal
  const roundMode: ClimbMode =
    firstRoundCalibration && !templateGenerated ? 'free' : 'formal'

  // === 气压辅助状态 ===
  // 返回阶段气压计是否可用（独立于 ascending 阶段的 roundSession.barometerAvailable）
  const [returnBarometerAvailable, setReturnBarometerAvailable] = useState(false)
  // 相对起点高度（米）
  const [relativeHeightM, setRelativeHeightM] = useState<number | undefined>(
    undefined,
  )
  // 是否已接近起点
  const [nearStart, setNearStart] = useState(false)
  const [returnVisualization, setReturnVisualization] =
    useState<SensorVisualizationState>(emptySensorVisualization)

  // 阶段起始时间戳，用于计算 phaseElapsedMs
  const phaseStartedAtRef = useRef<number>(0)
  // 主计时器
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  )
  // workout 引用，避免闭包过期
  const workoutRef = useRef<ClimbWorkout | null>(null)
  workoutRef.current = workout
  // 当前阶段引用
  const phaseRef = useRef<WorkoutPhase>('setup')
  phaseRef.current = machine.phase
  // 本轮结束时间戳（用于 returnDurationMs 计算）
  const roundEndedAtRef = useRef<number>(0)
  // 当前轮次编号引用，避免回调闭包过期
  const currentRoundNumberRef = useRef<number>(0)
  currentRoundNumberRef.current = machine.currentRoundNumber
  const machineRef = useRef(machine)
  machineRef.current = machine
  // 本轮开始时间戳（ascending 阶段），应用被杀中断时用于构造 interrupted 轮
  const currentRoundStartedAtRef = useRef<number | undefined>(undefined)

  // === D07b：计划状态 ===
  // 权威来源是 planProgress（显式记录已完成/已跳过阶段）；machine 里的
  // planId/planPhaseIndex 只是镜像，供 workout-machine 的计划桥接函数使用。
  const [activePlan, setActivePlan] = useState<WorkoutPlan | undefined>(planOption)
  const [planProgress, setPlanProgress] = useState<PlanProgress | undefined>(() =>
    planOption ? initialPlanProgress(planOption) : undefined,
  )
  const planRef = useRef<WorkoutPlan | undefined>(activePlan)
  planRef.current = activePlan
  const planProgressRef = useRef<PlanProgress | undefined>(planProgress)
  planProgressRef.current = planProgress
  // 路由参数里的计划（startWorkout 时启用；resumeFromCheckpoint 会用检查点里的计划覆盖）
  const planOptionRef = useRef<WorkoutPlan | undefined>(planOption)
  planOptionRef.current = planOption
  // 热身计时段：只在计划处于热身阶段时打开。
  // 热身净时长单独入账（WorkoutSummary.warmupDurationMs），绝不进 activeDurationMs。
  const warmupStartedAtRef = useRef<number | undefined>(undefined)
  const warmupAccumulatedRef = useRef(0)
  const [warmupDurationMs, setWarmupDurationMs] = useState(0)
  // 计划走完之后的自由加练（old behavior：想练几轮练几轮，只是不再有计划阶段提示）
  const [extraRounds, setExtraRounds] = useState(false)
  const extraRoundsRef = useRef(false)

  // === 气压基线（ascending 阶段采集，returning 阶段使用） ===
  // 本轮起点气压基线（hPa）。每轮 ascending 开始时重新采集。
  const baselinePressureRef = useRef<number | undefined>(undefined)
  // 采集基线用的临时样本数组
  const baselineSamplesRef = useRef<number[]>([])
  // 非上爬训练阶段的运动采集：所有模式均留存原始样本。
  const returnRecorderRef = useRef<SensorRecorder | undefined>(undefined)
  const returnEvidenceRef = useRef<WorkoutEvidenceJournal | undefined>(undefined)
  const returnCaptureOwnerRef = useRef<{ closing: boolean; closed: boolean } | undefined>(undefined)
  const returnGenerationRef = useRef(0)
  const returnStopPromiseRef = useRef<Promise<unknown> | undefined>(undefined)
  const latestMonitorPressureRef = useRef<number | undefined>(undefined)
  const returnVisualizationRef = useRef(
    new SensorMotionInterpreter('returning'),
  )
  const returnVisualizationRenderAtRef = useRef(0)
  const returnAbsoluteHeightRef = useRef<number | undefined>(undefined)

  // === 状态机派发 ===
  const dispatch = useCallback((action: WorkoutAction) => {
    const next = workoutReducer(machineRef.current, action)
    machineRef.current = next
    phaseRef.current = next.phase
    currentRoundNumberRef.current = next.currentRoundNumber
    setMachine(next)
  }, [])

  const processAutomationObservation = useCallback((observation: TrainingAutomationObservation) => {
    // Saving owns the workflow, while the current recorder keeps retaining samples
    // until persistence succeeds and its evidence journal is closed.
    if (finishingWorkoutRef.current || workoutRef.current?.status !== 'active') return
    if (automaticTransitionsPausedRef.current) {
      setAutomationStatus('自动衔接已暂停，请确认实际楼层；传感器仍在记录')
      return
    }
    automationRef.current.enterPhase(phaseRef.current)
    const update = automationRef.current.observe(observation)
    setAutomationStatus(update.status)
    setElevatorDescending(Boolean(update.elevatorDescending))
    if (trackingModeRef.current === 'automatic' && phaseRef.current === 'returning' &&
        update.status === '识别已接近起点，请确认返回') dispatch({ type: 'NEAR_START', at: observation.t })
    const action = update.action
    if (!action) return
    const w = workoutRef.current
    if (w) recordWorkoutEvidenceEvent({ workoutId: w.id, roundNumber: currentRoundNumberRef.current,
      phase: phaseRef.current, startedAt: action.at }, 'automation_action', action.at, action, setEvidenceSaveError)
    if (action.type === 'finish_round') automationActionsRef.current.finish(action.at)
    if (action.type === 'returned_to_start') automationActionsRef.current.returned()
    if (action.type === 'begin_next_round') automationActionsRef.current.next(action.climbStartedAt)
  }, [dispatch])

  const stopReturnMonitor = useCallback((): Promise<unknown> => {
    const owner = returnCaptureOwnerRef.current
    if (owner) owner.closing = true
    returnCaptureOwnerRef.current = undefined
    returnGenerationRef.current += 1
    const evidence = returnEvidenceRef.current
    returnEvidenceRef.current = undefined
    const recorder = returnRecorderRef.current
    returnRecorderRef.current = undefined
    const closeEvidence = () => {
      if (owner) owner.closed = true
      evidence?.close()
    }
    if (!recorder) {
      closeEvidence()
      return returnStopPromiseRef.current ?? Promise.resolve()
    }
    // stop() can emit an open terminal gap. Retain it in this owner journal before
    // closing, without allowing it to alter a newer phase's automation or prompt.
    const promise = recorder.stop().catch(() => undefined).finally(closeEvidence)
    returnStopPromiseRef.current = promise
    return promise
  }, [])

  const setTrackingMode = useCallback((mode: TrackingMode) => {
    trackingModeRef.current = mode
    setTrackingModeState(mode)
    automationRef.current.setMode(mode)
    const w = workoutRef.current
    if (w) {
      const updated = { ...w, trackingMode: mode, returnConfirmationMode: mode === 'manual' ? 'manual' as const : 'assisted' as const }
      workoutRef.current = updated
      setWorkout(updated)
      recordWorkoutEvidenceEvent({ workoutId: w.id, roundNumber: currentRoundNumberRef.current,
        phase: phaseRef.current, startedAt: Date.now() }, 'tracking_mode_changed', Date.now(), { mode }, setEvidenceSaveError)
    }
  }, [])

  const stopBackgroundCapture = useCallback(async () => {
    await backgroundStartPromiseRef.current
    if (!isBackgroundTrainingSupported()) return
    let failure = ''
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const status = await stopBackgroundTraining()
        if (status.running) throw new Error(status.lastError ?? '服务仍在运行')
        backgroundCaptureActiveRef.current = false
        setBackgroundServiceStopError('')
        return
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      }
    }
    const message = `训练已保存，但后台采集服务未停止：${failure}。请再次点击结束以重试，持续通知消失后才表示已停止。`
    setBackgroundServiceStopError(message)
    throw new Error(message)
  }, [])

  const finishFeedbackBeforeBackgroundStop = useCallback(async (savedWorkout: ClimbWorkout) => {
    const callback = beforeBackgroundStopRef.current
    if (!callback) return
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        callback(savedWorkout).catch(error => { console.warn('[useClimbWorkout] final feedback failed', error) }),
        new Promise<void>(resolve => { timeout = setTimeout(resolve, 15000) }),
      ])
    } finally { if (timeout) clearTimeout(timeout) }
  }, [])

  // === D07b：计划推进（纯函数来自 core/workout-plan，hook 只负责在正确的时机调用）===
  // 当前应执行的计划阶段（无计划/计划走完 → undefined）。
  const currentPlanPhase = useCallback((): WorkoutPlanPhase | undefined => {
    const p = planRef.current
    const progress = planProgressRef.current
    if (!p || !progress) return undefined
    return nextPlanPhase(p, progress)
  }, [])

  // 推进一个计划阶段（completed/skipped）。不可跳过阶段请求 skipped 时不改动任何状态。
  const advancePlan = useCallback((outcome: PlanPhaseOutcome = 'completed') => {
    const p = planRef.current
    const progress = planProgressRef.current
    if (!p || !progress) return
    const next = advancePlanProgress(p, progress, outcome)
    if (next === progress) return
    planProgressRef.current = next
    setPlanProgress(next)
  }, [])

  // 收尾：保留已完成阶段与轮次，剩余轮数置 0。中止时不清空已完成轮。
  const finishPlan = useCallback(() => {
    const p = planRef.current
    const progress = planProgressRef.current
    if (!p || !progress) return
    const next = finishPlanProgress(p, progress)
    planProgressRef.current = next
    setPlanProgress(next)
  }, [])

  // 热身计时段：进入热身时打开，离开热身（完成/跳过/结束训练）时结算。
  const closeWarmupSegment = useCallback(() => {
    const startedAt = warmupStartedAtRef.current
    if (startedAt === undefined) return
    warmupStartedAtRef.current = undefined
    warmupAccumulatedRef.current += Math.max(0, Date.now() - startedAt)
    setWarmupDurationMs(warmupAccumulatedRef.current)
  }, [])

  // 把计划游标镜像进状态机状态（D07 的 withPlanCursor）。
  // 相等时返回原对象，避免无意义的重复渲染。
  useEffect(() => {
    if (!activePlan || !planProgress) return
    setMachine((prev) => {
      const prevSkipped = prev.skippedPlanPhases ?? []
      const sameSkipped =
        prevSkipped.length === planProgress.skippedPhases.length &&
        prevSkipped.every((kind, i) => kind === planProgress.skippedPhases[i])
      if (
        prev.planId === activePlan.id &&
        prev.planPhaseIndex === planProgress.phaseIndex &&
        sameSkipped
      ) {
        return prev
      }
      return withPlanCursor(prev, activePlan.id, planProgress)
    })
  }, [activePlan, planProgress])

  // === 检查点持久化 ===
  // 恢复点写入失败必须暴露给用户：否则「应用被杀后可以继续」的承诺是假的。
  const [checkpointSaveError, setCheckpointSaveError] = useState('')
  // D11 预备：Android 上应用切到后台/锁屏后系统会暂停传感器回调，
  // 这段时间不会产生任何样本。必须让用户知道「刚过去的这段没有记录」，
  // 而不是等他爬完发现少了两层。这里只做诚实告知，不假装后台仍在采样。
  const [backgroundGapWarning, setBackgroundGapWarning] = useState('')
  const observedSensorGapRef = useRef(false)
  const backgroundedAtRef = useRef<number | undefined>(undefined)

  const persistCheckpoint = useCallback(
    async (phase: WorkoutPhase, currentRoundNumber: number) => {
      const w = workoutRef.current
      if (!w) return
      const checkpoint: ActiveWorkoutCheckpoint = {
        workoutId: w.id,
        phase,
        currentRoundNumber,
        savedAt: Date.now(),
        completedRounds: w.rounds,
        // D07b：只有带计划训练才写入这两个字段，旧形状（无计划）保持逐字段一致，
        // 旧检查点（没有这两个字段）也能照常读回。
        // F18：热身净时长与「自由加练」标记也随计划一起持久化，
        // 避免热身中途被杀后这段时长凭空消失。无计划训练不写这些字段（旧形状不变）。
        ...(planRef.current
          ? {
              plan: planRef.current,
              warmupDurationMs: warmupAccumulatedRef.current,
              extraRounds: extraRoundsRef.current,
            }
          : {}),
        ...(planProgressRef.current
          ? { planProgress: planProgressRef.current }
          : {}),
        templateId: w.templateId,
        goal: w.goal,
        returnConfirmationMode: w.returnConfirmationMode,
        trackingMode: trackingModeRef.current,
        floorCounting: w.floorCounting,
        bodyWeightKg: w.bodyWeightKg,
        startedAt: w.startedAt,
        currentRoundStartedAt:
          phase === 'ascending'
            ? currentRoundStartedAtRef.current
            : undefined,
      }
      try {
        await saveActiveCheckpoint(checkpoint)
        setCheckpointSaveError('')
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        console.error('[useClimbWorkout] 恢复点保存失败', error)
        setCheckpointSaveError(
          `恢复点保存失败：${detail}。应用被杀后本次训练将无法自动恢复，请尽快结束并保存。`,
        )
      }
    },
    [],
  )

  // Persist a user's policy choice independently of the sensor/phase lifecycle.
  // Saving and completed workouts cannot recreate a cleared recovery checkpoint.
  useEffect(() => {
    const w = workoutRef.current
    const phase = phaseRef.current
    if (!w || w.status !== 'active' || finishingWorkoutRef.current ||
        phase === 'setup' || phase === 'workout_complete') return
    void persistCheckpoint(phase, currentRoundNumberRef.current)
  }, [trackingMode, persistCheckpoint])

  // === 首边建模板：第一轮 free 模式结束后，用采集的样本生成路线模板 ===
  // 用 ref 保存最新值，避免 handleRoundComplete 依赖数组膨胀
  const templateRef = useRef(template)
  templateRef.current = template
  const firstRoundCalibrationRef = useRef(firstRoundCalibration)
  firstRoundCalibrationRef.current = firstRoundCalibration

  const generateTemplateFromSession = useCallback(
    async (session: ClimbSession, confirmedEndFloor?: number) => {
      const t = templateRef.current
      // 生成模板只要求「样本足够」：地点是可选的（自由训练/拒绝定位/飞行模式）。
      // 没有地点时模板照常可用于训练，只是不会进入地图统计。
      if (!session.samples || session.samples.length < 50) return
      const endFloor = confirmedEndFloor ?? session.finalFloor ?? t.endFloor
      if (!Number.isFinite(endFloor) || endFloor <= session.startFloor || session.floorsCompleted <= 0) return
      // 模板和本次运动均按真实高度差：1F→15F 是14层爬升。
      const floorCount = Math.max(
        1,
        getFloorTransitionCount(t.startFloor, endFloor),
      )
      const seed = {
        routeId: t.id,
        name: t.name,
        carryMode: t.carryMode,
        location: t.location,
      }
      const draft = analyzeCalibration(
        seed,
        session.samples,
        session.startedAt,
        session.endedAt,
        session.interruptions,
      )
      // 强制重建为用户设定的楼层数，避免气压估算与设定不一致
      draft.boundaries = rebuildDraftBoundaries(draft, floorCount)
      // 每层高度：优先用气压反算的总爬升均摊，否则用 template.floorHeightM
      const totalAscent =
        draft.estimatedAscentM && draft.estimatedAscentM > 0
          ? draft.estimatedAscentM
          : session.ascentM > 0
            ? session.ascentM
            : floorCount * 3
      const averageHeight = Number((totalAscent / floorCount).toFixed(1))
      const floorHeights = Array.from({ length: floorCount }, () => averageHeight)
      const segments = buildSegments(draft, t.startFloor, floorHeights)
      const updatedTemplate: RouteTemplate = {
        ...t,
        endFloor,
        floorHeightM: averageHeight,
        segments,
        learningProvenance: 'training_rounds',
        status: 'needs_validation',
        verifiedAt: undefined,
        totalAscentM: Number(
          segments.reduce((sum, s) => sum + s.ascentM, 0).toFixed(1),
        ),
        updatedAt: Date.now(),
        version: t.version + 1,
      }
      await saveRoute(updatedTemplate)
      setEffectiveTemplate(updatedTemplate)
      setTemplateGenerated(true)
    },
    [],
  )

  // === 轮次完成处理（必须在 useClimbRoundSession 之前定义） ===
  const handleRoundComplete = useCallback(
    async (
      session: ClimbSession,
      reason: WorkoutRound['completionReason'],
      confirmedEndFloor?: number,
      excludeFromLearning = false,
    ) => {
      const w = workoutRef.current
      if (!w) return
      const roundNumber = currentRoundNumberRef.current
      if (completedSessionIdsRef.current.has(session.id)) return
      completedSessionIdsRef.current.add(session.id)
      const confirmedFloor = confirmedEndFloor === undefined
        ? undefined : Math.max(session.startFloor, Math.round(confirmedEndFloor))
      const originalRound: WorkoutRound = {
        ...roundFromSession(session, roundNumber, reason),
        floorCounting: 'transitions',
        floorsCompleted: getFloorTransitionCount(session.startFloor, session.finalFloor),
        evidenceId: session.evidenceId,
      }
      let round = originalRound
      if (confirmedEndFloor !== undefined) {
        const transitions = getFloorTransitionCount(session.startFloor, confirmedFloor!)
        const originalTransitions = getFloorTransitionCount(session.startFloor, session.finalFloor)
        const perFloorM = originalTransitions > 0 && session.ascentM > 0
          ? session.ascentM / originalTransitions
          : effectiveTemplate.floorHeightM || 3
        round = applyRoundCorrection(originalRound, {
          finalFloor: confirmedFloor,
          floorsCompleted: transitions,
          ascentM: Number((transitions * perFloorM).toFixed(1)),
          complete: transitions > 0,
        }, { at: Date.now(), reason: '用户确认实际到达楼层', excludeFromLearning: true })
        round.completionSource = 'manual'
        round.trustworthy = false
      }
      if (excludeFromLearning) round.trustworthy = false
      round.averageFloorMs = round.floorsCompleted > 0 ? Math.round(round.durationMs / round.floorsCompleted) : undefined
      const confirmedSession: ClimbSession = {
        ...session, finalFloor: round.finalFloor, floorsCompleted: round.floorsCompleted,
        ascentM: round.ascentM, complete: round.complete,
      }
      recordWorkoutEvidenceEvent({ workoutId: w.id, roundNumber, phase: 'ascending', startedAt: session.startedAt },
        'round_saved', Date.now(), { original: { finalFloor: session.finalFloor, floorsCompleted: session.floorsCompleted,
          ascentM: session.ascentM, confidence: session.confidence }, confirmed: { finalFloor: round.finalFloor,
          floorsCompleted: round.floorsCompleted, ascentM: round.ascentM }, corrections: round.corrections,
          reason, evidenceId: round.evidenceId }, setEvidenceSaveError)
      // 更新 workout
      const updatedWorkout: ClimbWorkout = {
        ...w,
        currentRoundNumber: roundNumber,
        routeSnapshot:
          firstRoundCalibrationRef.current && roundNumber === 1 && confirmedFloor !== undefined && confirmedFloor > session.startFloor
            ? {
                ...w.routeSnapshot,
                endFloor: confirmedFloor,
                floorsPerRound: getFloorTransitionCount(
                  session.startFloor,
                  confirmedFloor,
                ),
                ascentPerRoundM: round.ascentM,
              }
            : w.routeSnapshot,
        rounds: [...w.rounds, round],
        totalRoundsCompleted:
          round.complete
            ? w.totalRoundsCompleted + 1
            : w.totalRoundsCompleted,
        totalFloorsCompleted: w.totalFloorsCompleted + round.floorsCompleted,
        totalAscentM: w.totalAscentM + round.ascentM,
        totalSteps: w.totalSteps + round.steps,
        activeDurationMs: w.activeDurationMs + round.durationMs,
        latestRoundMs: round.durationMs,
      }
      // 重新计算 best/average
      const completeDurations = updatedWorkout.rounds
        .filter((r) => r.complete)
        .map((r) => r.durationMs)
        .sort((a, b) => a - b)
      updatedWorkout.bestRoundMs = completeDurations[0]
      updatedWorkout.averageRoundMs = completeDurations.length
        ? Math.round(
            completeDurations.reduce((s, d) => s + d, 0) /
              completeDurations.length,
          )
        : undefined
      setWorkout(updatedWorkout)
      workoutRef.current = updatedWorkout
      setCurrentRound(round)
      roundEndedAtRef.current = session.endedAt
      // 首边建模板：第一轮 free 模式结束后，用采集的样本生成路线模板。
      // 必须 await：确保 effectiveTemplate 已更新为带 segments 的模板后再进入下一轮，
      // 否则第二轮 formal 模式会用空模板导致 RouteRecognizer 识别失败。
      if (
        firstRoundCalibrationRef.current &&
        roundNumber === 1 &&
        session.mode === 'free' &&
        !excludeFromLearning
      ) {
        try {
          await generateTemplateFromSession(
            confirmedSession,
            confirmedEndFloor,
          )
        } catch (err) {
          console.warn('[useClimbWorkout] generate template failed', err)
        }
      }
      // D07b：本轮上爬结束 → 计划游标推进到 返回/恢复/下一轮。
      // 只在当前计划阶段确实是 climb 时推进，避免影响无计划训练。
      if (currentPlanPhase()?.kind === 'climb') advancePlan('completed')
      // 状态机：ascending → round_complete
      dispatch({ type: 'ROUND_COMPLETE' })
    },
    [dispatch, generateTemplateFromSession, advancePlan, currentPlanPhase, effectiveTemplate.floorHeightM],
  )

  // === 单轮会话 ===
  const roundSession = useClimbRoundSession({
    template: effectiveTemplate,
    mode: roundMode,
    autoComplete: trackingMode === 'full_auto' && !automaticTransitionsPaused && roundMode !== 'free',
    keepRunningInBackground: isBackgroundTrainingSupported(),
    evidenceContext: workout ? { workoutId: workout.id, roundNumber: machine.currentRoundNumber,
      phase: 'ascending', startedAt: currentRoundStartedAtRef.current ?? Date.now() } : undefined,
    onEvidenceError: setEvidenceSaveError,
    onSnapshot: (snapshot) => { roundObservationRef.current = snapshot },
    onGap: (gap) => {
      automationRef.current.gap()
      observedSensorGapRef.current = true
      setAutomationStatus('传感器数据中断，请核对实际楼层；可手动结束')
      setBackgroundGapWarning(`传感器采集中断了 ${Math.max(1, Math.round((gap.endMs - gap.startMs) / 1000))} 秒。这段运动可能未完整识别，请在结束时确认实际楼层；原始文件已记录缺段。`)
    },
    onObservation: (sample, motion) => {
      const snapshot = roundObservationRef.current
      processAutomationObservation({ t: sample.t,
        relativeHeightM: sample.pressure !== undefined && baselinePressureRef.current !== undefined
          ? (baselinePressureRef.current - sample.pressure) * METERS_PER_HPA : undefined,
        barometerAvailable: sample.pressure !== undefined,
        steps: Math.max(snapshot?.steps ?? 0, motion.stepPulse),
        targetReached: snapshot?.status === 'complete', reliableTarget: snapshot?.canAutoComplete })
    },
    onComplete: (session) => {
      // 自动到达终点：固化为 WorkoutRound
      if (!automaticTransitionsPausedRef.current) handleRoundComplete(session, 'route_complete')
    },
    onBarometer: (status: BarometerStatus) => {
      // ascending 阶段：采集本轮起点气压基线
      // 仅在基线尚未建立时采集，取前 BASELINE_SAMPLE_COUNT 个样本的平均值
      if (
        status.available &&
        status.pressure > 0 &&
        baselinePressureRef.current === undefined
      ) {
        baselineSamplesRef.current.push(status.pressure)
        if (baselineSamplesRef.current.length >= BASELINE_SAMPLE_COUNT) {
          const samples = baselineSamplesRef.current
          const avg =
            samples.reduce((sum, p) => sum + p, 0) / samples.length
          baselinePressureRef.current = avg
        }
      }
    },
  })

  // roundSession 引用每次渲染都变化（因内部 snapshot/elapsedMs 状态更新），
  // 但 start/finish/cleanup 方法本身稳定（useCallback）。
  // 用 ref 保存最新值，避免放入 useEffect 依赖数组导致无限循环。
  const roundSessionRef = useRef(roundSession)
  roundSessionRef.current = roundSession

  const setAutomaticTransitionsPaused = useCallback((paused: boolean) => {
    automaticTransitionsPausedRef.current = paused
    setAutomaticTransitionsPausedState(paused)
    automationRef.current.gap()
    if (paused) roundSessionRef.current.cancelAutoComplete()
    // A cancelled endpoint countdown stays cancelled for this round. Fresh elevator
    // observations can still resume full-auto after the manual dialog is dismissed.
  }, [])

  useEffect(() => {
    // A phase change or dismissed floor dialog must not leave an old instruction on screen.
    // This only changes the prompt; movement actions still require real sensor observations.
    setAutomationStatus(trainingPhasePrompt(trackingMode, machine.phase, automaticTransitionsPaused))
  }, [machine.phase, trackingMode, automaticTransitionsPaused])

  // === 派生数据 ===
  const summary = useMemo<WorkoutSummary | null>(() => {
    if (!workout) return null
    return calculateWorkoutSummary(
      workout.rounds,
      workout.startedAt,
      workout.endedAt,
      // 只有带计划的训练才带热身口径：旧训练（无计划）汇总对象形状不变。
      activePlan ? { warmupDurationMs } : undefined,
    )
  }, [workout, activePlan, warmupDurationMs])

  // D07b：当前计划阶段与实际渲染无关的派生量。
  const planPhase = useMemo<WorkoutPlanPhase | null>(() => {
    if (!activePlan || !planProgress) return null
    return nextPlanPhase(activePlan, planProgress) ?? null
  }, [activePlan, planProgress])

  const canSkipCurrentPlanPhase = Boolean(
    activePlan && planPhase && canSkipPhase(activePlan, planPhase),
  )

  // 完成反馈：判定与文案全部来自 core 的 buildPlanFeedback，页面只展示 lines。
  const planFeedback = useMemo<PlanFeedback | null>(() => {
    if (!activePlan) return null
    const completedRounds = summary
      ? summary.completeRounds
      : planProgress
        ? completedRoundCount(planProgress)
        : 0
    return buildPlanFeedback(activePlan, {
      completedRounds,
      activeDurationMs: summary?.activeDurationMs ?? 0,
      totalFloors: summary?.totalFloors ?? 0,
      totalAscentM: summary?.totalAscentM,
    })
  }, [activePlan, planProgress, summary])

  const previousRound = useMemo<WorkoutRound | null>(() => {
    if (!workout || workout.rounds.length === 0) return null
    // 上一轮 = 当前轮次编号 - 1 对应的轮次
    const prevNumber = machine.currentRoundNumber - 1
    return workout.rounds.find((r) => r.roundNumber === prevNumber) ?? null
  }, [workout, machine.currentRoundNumber])

  // === 计时器 ===
  useEffect(() => {
    if (!workout || workout.status !== 'active') return
    // 主计时器：每 500ms 更新总历时和阶段用时
    timerIntervalRef.current = setInterval(() => {
      const now = Date.now()
      const w = workoutRef.current
      if (!w || w.status !== 'active') return
      const totalElapsedMs = Math.max(0, now - w.startedAt)
      const phaseElapsedMs = Math.max(0, now - phaseStartedAtRef.current)
      setTimer((prev) => ({
        ...prev,
        totalElapsedMs,
        phaseElapsedMs,
      }))
    }, 500)
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
        timerIntervalRef.current = undefined
      }
    }
  }, [workout])

  // === 阶段变化副作用 ===
  useEffect(() => {
    phaseStartedAtRef.current = Date.now()
    const phase = machine.phase
    const roundNumber = machine.currentRoundNumber
    automationRef.current.enterPhase(phase)

    // 维护本轮开始时间（必须放在 persistCheckpoint 之前：
    // 持久化会把 ascending 阶段的本轮开始时间写入检查点，供中断恢复使用）
    if (phase === 'ascending' && currentRoundStartedAtRef.current === undefined) {
      currentRoundStartedAtRef.current = pendingRoundSeedRef.current?.startedAt ?? Date.now()
    } else if (phase !== 'ascending') {
      currentRoundStartedAtRef.current = undefined
    }

    // 只持久化仍在进行中的训练。结束流程会先清除检查点，再派发
    // FINISH_WORKOUT；若这里把 workout_complete 再写回，会导致下次启动
    // 误报“发现未结束的爬楼训练”。
    if (
      workoutRef.current &&
      phase !== 'setup' &&
      phase !== 'workout_complete'
    ) {
      persistCheckpoint(phase, roundNumber).catch(() => undefined)
    }

    // ascending 阶段：启动单轮识别 + 重置气压基线（每轮重新采集）
    if (phase === 'ascending') {
      baselinePressureRef.current = undefined
      baselineSamplesRef.current = []
      setRelativeHeightM(undefined)
      setNearStart(false)
      setReturnBarometerAvailable(false)
      const seed = pendingRoundSeedRef.current
      pendingRoundSeedRef.current = undefined
      void (async () => {
        await stopReturnMonitor()
        await backgroundStartPromiseRef.current
        if (phaseRef.current !== 'ascending' || currentRoundNumberRef.current !== roundNumber ||
            finishingWorkoutRef.current || workoutRef.current?.status !== 'active') return
        try { await roundSessionRef.current.start(seed) }
        catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          setAutomationStatus(`传感器启动失败：${reason}。仍可按实际楼层结束本轮。`)
          console.warn('[useClimbWorkout] round start failed', err)
        }
      })()
    }

    // Raw retention is independent of automatic transitions. A manual workout also
    // records preparation, the result display, return and recovery. Only the engine's
    // current mode can decide whether fresh motion advances the training workflow.
    // Each monitor owner is stopped before the new phase/round subscribes.
    const monitorPhase = phase === 'returning' || phase === 'start_confirmation' ||
      phase === 'round_complete' || phase === 'recovering' || phase === 'round_ready'
    if (monitorPhase) {
      setNearStart(false)
      returnVisualizationRef.current = new SensorMotionInterpreter(
        phase === 'returning' || phase === 'start_confirmation' ? 'returning' : 'ascending')
      returnVisualizationRenderAtRef.current = 0
      returnAbsoluteHeightRef.current = undefined
      setReturnVisualization(emptySensorVisualization())
      returnSampleWindowRef.current = []
      const previousStop = stopReturnMonitor()
      const generation = ++returnGenerationRef.current
      void (async () => {
        await previousStop
        await backgroundStartPromiseRef.current
        if (generation !== returnGenerationRef.current || phaseRef.current !== phase) return
        const w = workoutRef.current
        if (!w || w.status !== 'active' || finishingWorkoutRef.current) return
        const startedAt = Date.now()
        const evidence = createWorkoutEvidenceJournal({ workoutId: w.id, roundNumber, phase, startedAt }, setEvidenceSaveError)
        returnEvidenceRef.current = evidence
        const owner = { closing: false, closed: false }
        returnCaptureOwnerRef.current = owner
        const recorder = new SensorRecorder({
          retainSamples: false,
          keepRunningInBackground: isBackgroundTrainingSupported(),
          onSample: (sample) => {
            if (generation !== returnGenerationRef.current) return
            evidence.pushSample(sample)
            returnSampleWindowRef.current.push(sample)
            if (returnSampleWindowRef.current.length > 400) {
              returnSampleWindowRef.current = returnSampleWindowRef.current.filter((point) => point.t >= sample.t - 6000)
            }
            returnVisualizationRef.current.push(sample)
            if (sample.t - returnVisualizationRenderAtRef.current >= 400) {
              returnVisualizationRenderAtRef.current = sample.t
              const next = returnVisualizationRef.current.snapshot(sample.t)
              const height = sample.pressure !== undefined && baselinePressureRef.current !== undefined
                ? (baselinePressureRef.current - sample.pressure) * METERS_PER_HPA : undefined
              setReturnVisualization({ ...next, relativeHeightM: height ?? next.relativeHeightM })
              processAutomationObservation({ t: sample.t, relativeHeightM: height,
                barometerAvailable: sample.pressure !== undefined, steps: next.stepPulse })
            }
          },
          onGap: (gap) => {
            if (owner.closed || (generation !== returnGenerationRef.current && !owner.closing)) return
            const origin = recorder.getStartedAt() || startedAt
            evidence.gap(origin + gap.startMs, origin + gap.endMs)
            if (owner.closing || generation !== returnGenerationRef.current) return
            automationRef.current.gap()
            observedSensorGapRef.current = true
            setBackgroundGapWarning(`返回期间传感器采集中断了 ${Math.max(1, Math.round((gap.endMs - gap.startMs) / 1000))} 秒，请手动核实是否已回到起点；原始文件已记录缺段。`)
          },
          onBarometer: (status: BarometerStatus) => {
            if (generation !== returnGenerationRef.current) return
            setReturnBarometerAvailable(status.available)
            if (status.available && status.pressure > 0) {
              latestMonitorPressureRef.current = status.pressure
              // Initial full-auto readiness can establish its own start baseline.
              if (baselinePressureRef.current === undefined && phase === 'round_ready') {
                baselineSamplesRef.current.push(status.pressure)
                if (baselineSamplesRef.current.length >= BASELINE_SAMPLE_COUNT) {
                  baselinePressureRef.current = baselineSamplesRef.current.reduce((sum, p) => sum + p, 0) / baselineSamplesRef.current.length
                }
              }
              if (baselinePressureRef.current !== undefined) {
                const heightM = (baselinePressureRef.current - status.pressure) * METERS_PER_HPA
                returnAbsoluteHeightRef.current = heightM
                setRelativeHeightM(heightM)
                setNearStart(Math.abs(heightM) <= Math.max(1.1, effectiveTemplate.floorHeightM * 0.36))
              }
            }
          },
        })
        returnRecorderRef.current = recorder
        try {
          await recorder.start()
          if (generation !== returnGenerationRef.current || owner.closing || phaseRef.current !== phase) {
            await recorder.stop()
          }
        }
        catch (err) {
          if (generation !== returnGenerationRef.current || owner.closing || phaseRef.current !== phase) return
          evidence.event('sensor_start_failed', Date.now(), { message: err instanceof Error ? err.message : String(err) })
          evidence.close()
          setAutomationStatus('返回监测不可用，请手动确认已到起点并开始下一轮')
          console.warn('[useClimbWorkout] return sensor start failed', err)
        }
      })()
    }

    // workout_complete 阶段：清理
    if (phase === 'workout_complete') {
      roundSessionRef.current.cleanup()
      void stopReturnMonitor()
    }
    return () => {
      void stopReturnMonitor()
    }
  }, [machine.phase, machine.currentRoundNumber, persistCheckpoint,
      stopReturnMonitor, processAutomationObservation])

  // Policy changes cancel/restart the automatic return countdown, without stopping
  // this phase's recorder, discarding motion evidence or resetting phaseElapsedMs.
  const waitingMonitorPolicy = automaticTransitionsPaused ? 0
    : trackingMode === 'full_auto' ? 2 : trackingMode === 'automatic' ? 1 : 0
  useEffect(() => {
    if (machine.phase !== 'round_complete' || waitingMonitorPolicy === 0) return
    const roundNumber = machine.currentRoundNumber
    const autoReturnTimer = setTimeout(() => {
      if (phaseRef.current === 'round_complete' && currentRoundNumberRef.current === roundNumber &&
          !finishingWorkoutRef.current && !automaticTransitionsPausedRef.current &&
          trackingModeRef.current === trackingMode && workoutRef.current?.status === 'active') {
        dispatch({ type: 'BEGIN_RETURNING', at: Date.now() })
      }
    }, waitingMonitorPolicy === 2 ? 300 : 2000)
    return () => clearTimeout(autoReturnTimer)
  }, [machine.phase, machine.currentRoundNumber, trackingMode, automaticTransitionsPaused, dispatch])

  // === 动作实现 ===
  const startWorkout = useCallback(() => {
    const w = createWorkout({
      templateId: template.id,
      templateVersion: template.version,
      routeSnapshot: buildRouteSnapshot(template),
      goal,
      returnConfirmationMode: trackingModeRef.current === 'manual' ? 'manual' : 'assisted',
      trackingMode: trackingModeRef.current,
      bodyWeightKg: options.bodyWeightKg,
    })
    w.floorCounting = 'transitions'
    setWorkout(w)
    workoutRef.current = w
    completedSessionIdsRef.current.clear()
    backgroundCaptureActiveRef.current = false
    if (isBackgroundTrainingSupported()) {
      backgroundStartPromiseRef.current = startBackgroundTraining(w.id).then((status) => {
        backgroundCaptureActiveRef.current = status.running
        if (!status.running) setBackgroundGapWarning('后台训练服务未启动，请保持应用在前台记录。')
      }).catch((error) => {
        backgroundCaptureActiveRef.current = false
        setBackgroundGapWarning(error instanceof Error ? error.message : String(error))
      })
    } else {
      backgroundStartPromiseRef.current = Promise.resolve()
    }

    // D07b：启用计划（来自路由参数的显式 plan）。无计划 = 旧行为。
    const startedPlan = planOptionRef.current
    if (startedPlan) {
      const progress = initialPlanProgress(startedPlan)
      planRef.current = startedPlan
      planProgressRef.current = progress
      setActivePlan(startedPlan)
      setPlanProgress(progress)
      warmupAccumulatedRef.current = 0
      setWarmupDurationMs(0)
      extraRoundsRef.current = false
      setExtraRounds(false)
      warmupStartedAtRef.current =
        nextPlanPhase(startedPlan, progress)?.kind === 'warmup'
          ? Date.now()
          : undefined
    } else {
      planRef.current = undefined
      planProgressRef.current = undefined
      setActivePlan(undefined)
      setPlanProgress(undefined)
      warmupStartedAtRef.current = undefined
      warmupAccumulatedRef.current = 0
      setWarmupDurationMs(0)
      extraRoundsRef.current = false
      setExtraRounds(false)
    }

    dispatch({ type: 'START_WORKOUT' })
  }, [template, goal, dispatch, options.bodyWeightKg])

  const beginAscending = useCallback(() => {
    if (backgroundCaptureActiveRef.current && !observedSensorGapRef.current) setBackgroundGapWarning('')
    // D07b：热身结束（用户点「开始上爬」）→ 结算热身净时长并推进到上爬阶段。
    // 没有热身时 currentPlanPhase() 已经是 climb，不会重复推进。
    if (currentPlanPhase()?.kind === 'warmup') {
      closeWarmupSegment()
      advancePlan('completed')
    }
    dispatch({ type: 'BEGIN_ASCENDING' })
  }, [dispatch, advancePlan, closeWarmupSegment, currentPlanPhase])

  const finishRound = useCallback(async (finishOptions?: {
    confirmedEndFloor?: number; excludeFromLearning?: boolean
  }): Promise<boolean> => {
    if (phaseRef.current !== 'ascending') return false
    if (finishOptions?.confirmedEndFloor !== undefined && !Number.isFinite(finishOptions.confirmedEndFloor)) return false
    roundSessionRef.current.cancelAutoComplete()
    let session = roundSessionRef.current.finish()
    if (!session) {
      // Sensor failure must not strand a user on a staircase. Preserve a degraded,
      // manually confirmed record even when no recognizer successfully started.
      const w = workoutRef.current
      if (!w) return false
      const startFloor = effectiveTemplate.startFloor
      const now = Date.now()
      session = { id: `${w.id}-manual-${currentRoundNumberRef.current}`, templateId: w.templateId,
        templateVersion: w.templateVersion, startedAt: currentRoundStartedAtRef.current ?? now,
        endedAt: now, startFloor, finalFloor: startFloor, floorsCompleted: 0, ascentM: 0,
        steps: 0, confidence: 0, complete: false, events: [], floorSplits: [],
        interruptions: [], durationMs: 0, mode: roundMode,
        routeSnapshot: { name: effectiveTemplate.name, locationName: effectiveTemplate.location?.name ?? effectiveTemplate.name,
          startFloor, endFloor: effectiveTemplate.endFloor, totalAscentM: effectiveTemplate.totalAscentM } }
    }
    await handleRoundComplete(session, 'manual_finish', finishOptions?.confirmedEndFloor ?? session.finalFloor,
      finishOptions?.excludeFromLearning)
    return true
  }, [handleRoundComplete, effectiveTemplate, roundMode])

  const finishWorkout = useCallback(
    async (finishOptions?: {
      saveIncompleteRound?: boolean
      confirmedEndFloor?: number
      excludeFromLearning?: boolean
    }): Promise<ClimbWorkout | null> => {
      const w = workoutRef.current
      if (!w) return null
      if (finishingWorkoutRef.current) return null
      finishingWorkoutRef.current = true
      try {
      const phase = phaseRef.current

      // ascending 阶段：可选保存未完成轮
      if (
        phase === 'ascending' &&
        finishOptions?.saveIncompleteRound !== false
      ) {
        await finishRound(finishOptions)
      }

      // 等待状态更新
      await new Promise((resolve) => setTimeout(resolve, 0))

      const finalWorkout = workoutRef.current
      if (!finalWorkout) return null

      // 计算最终汇总
      const finalSummary = calculateWorkoutSummary(
        finalWorkout.rounds,
        finalWorkout.startedAt,
        Date.now(),
      )
      const completedWorkout: ClimbWorkout = {
        ...finalWorkout,
        status: 'completed',
        endedAt: Date.now(),
        totalElapsedMs: finalSummary.totalElapsedMs,
        returnDurationMs: finalSummary.returnDurationMs,
        recoveryDurationMs: finalSummary.recoveryDurationMs,
        trustQuality: finalWorkout.rounds.every((round) => round.trustworthy)
          ? 'stable'
          : 'degraded',
        userCorrectionCount: finalWorkout.rounds.reduce(
          (sum, round) => sum + (round.userCorrectionCount ?? 0),
          0,
        ),
        personalBestEligible: finalWorkout.rounds.every(
          (round) => Boolean(round.trustworthy),
        ),
        completionSource: finalWorkout.rounds.every(
          (round) => round.completionSource === 'automatic',
        )
          ? 'automatic'
          : 'mixed',
        weeklyContribution: ordinaryWeeklyContribution(finalWorkout.rounds),
      }
      setWorkout(completedWorkout)
      workoutRef.current = completedWorkout

      await saveWorkout(completedWorkout)
      await stopReturnMonitor()
      roundSessionRef.current.cleanup()
      await finishFeedbackBeforeBackgroundStop(completedWorkout)
      await stopBackgroundCapture()
      try {
        const savedRoute = await getRoute(completedWorkout.templateId)
        if (savedRoute && completedWorkout.rounds.some(isLearningEligibleRound)) {
          const learnedRoute = updateRouteModelFromWorkouts(
            savedRoute,
            await listWorkouts(),
          )
          await saveRoute(learnedRoute)
          setEffectiveTemplate(learnedRoute)
        }
      } catch (error) {
        // 训练记录已安全保存。学习失败只延后模型更新，不能破坏完成流程。
        console.warn('[useClimbWorkout] safe route learning failed', error)
      }
      await clearActiveCheckpoint()
      setCheckpointSaveError('')

      // D07b：结束流程。若在热身中被结束，先把已用掉的热身时间照实入账；
      // finishPlan 只把剩余轮数置 0，保留已完成阶段（中止不得清空已完成轮）。
      closeWarmupSegment()
      finishPlan()

      dispatch({ type: 'FINISH_WORKOUT' })
      return completedWorkout
      } finally {
        finishingWorkoutRef.current = false
      }
    },
    [finishRound, dispatch, closeWarmupSegment, finishPlan, stopReturnMonitor, stopBackgroundCapture, finishFeedbackBeforeBackgroundStop],
  )

  const completeLearningRound = useCallback(
    async (confirmedEndFloor: number): Promise<boolean> => {
      if (
        phaseRef.current !== 'ascending' ||
        !Number.isFinite(confirmedEndFloor)
      ) {
        return false
      }
      return finishRound({ confirmedEndFloor })
    },
    [finishRound],
  )

  const confirmCurrentRoundComplete = useCallback(async (): Promise<boolean> => {
    return finishRound()
  }, [finishRound])

  const discardCurrentRoundAndFinish = useCallback(async (): Promise<ClimbWorkout | null> => {
    const w = workoutRef.current
    if (!w) return null
    const phase = phaseRef.current

    // ascending 阶段：丢弃当前轮（不保存）
    if (phase === 'ascending') {
      roundSessionRef.current.cleanup()
    }

    const finalSummary = calculateWorkoutSummary(
      w.rounds,
      w.startedAt,
      Date.now(),
    )
    const completedWorkout: ClimbWorkout = {
      ...w,
      status: 'completed',
      endedAt: Date.now(),
      totalElapsedMs: finalSummary.totalElapsedMs,
      trustQuality: 'degraded',
      personalBestEligible: false,
      completionSource: 'mixed',
      weeklyContribution: ordinaryWeeklyContribution(w.rounds),
    }
    setWorkout(completedWorkout)
    workoutRef.current = completedWorkout

    await saveWorkout(completedWorkout)
    await stopReturnMonitor()
    await finishFeedbackBeforeBackgroundStop(completedWorkout)
    await stopBackgroundCapture()
    await clearActiveCheckpoint()
    setCheckpointSaveError('')

    // D07b：丢弃当前轮并结束，同样保留计划里已完成的阶段与轮次。
    closeWarmupSegment()
    finishPlan()

    dispatch({ type: 'FINISH_WORKOUT' })
    return completedWorkout
  }, [dispatch, closeWarmupSegment, finishPlan, stopReturnMonitor, stopBackgroundCapture, finishFeedbackBeforeBackgroundStop])

  const confirmReturnedToStart = useCallback(() => {
    const w = workoutRef.current
    if (!w || (phaseRef.current !== 'returning' && phaseRef.current !== 'start_confirmation')) return
    recordWorkoutEvidenceEvent({ workoutId: w.id, roundNumber: currentRoundNumberRef.current,
      phase: phaseRef.current, startedAt: Date.now() }, 'returned_to_start', Date.now(),
      { source: trackingModeRef.current === 'full_auto' ? 'automatic_or_user' : 'user',
        pressure: latestMonitorPressureRef.current }, setEvidenceSaveError)
    // User confirmation also provides a fresh pressure reference after weather drift.
    if (latestMonitorPressureRef.current !== undefined) baselinePressureRef.current = latestMonitorPressureRef.current
    setRelativeHeightM(0)
    setElevatorDescending(false)

    // 记录本轮返回耗时
    if (roundEndedAtRef.current > 0) {
      const returnDurationMs = Math.max(0, Date.now() - roundEndedAtRef.current)
      const roundNumber = currentRoundNumberRef.current
      const updatedRounds = w.rounds.map((r) =>
        r.roundNumber === roundNumber
          ? {
              ...r,
              returnedToStartAt: Date.now(),
              returnDurationMs,
            }
          : r,
      )
      const updatedWorkout = { ...w, rounds: updatedRounds }
      setWorkout(updatedWorkout)
      workoutRef.current = updatedWorkout
    }

    // D07b：返回结束 → 计划游标推进到恢复（或下一轮上爬）。
    if (currentPlanPhase()?.kind === 'return') advancePlan('completed')

    dispatch({ type: 'CONFIRM_RETURNED', at: Date.now() })
  }, [dispatch, advancePlan, currentPlanPhase])

  const startNextRound = useCallback(() => {
    const w = workoutRef.current
    const phase = phaseRef.current
    if (!w || phase !== 'recovering') return

    // 记录上一轮的恢复耗时
    const recoveringSince = machine.recoveringSince
    if (recoveringSince && roundEndedAtRef.current > 0) {
      const recoveryDurationMs = Math.max(0, Date.now() - recoveringSince)
      const roundNumber = currentRoundNumberRef.current
      const updatedRounds = w.rounds.map((r) =>
        r.roundNumber === roundNumber
          ? { ...r, recoveryDurationMs }
          : r,
      )
      const updatedWorkout = { ...w, rounds: updatedRounds }
      setWorkout(updatedWorkout)
      workoutRef.current = updatedWorkout
    }

    // 清理当前轮引用
    setCurrentRound(null)
    const latest = workoutRef.current
    if (latest) {
      const updated = { ...latest, currentRoundNumber: currentRoundNumberRef.current + 1 }
      workoutRef.current = updated
      setWorkout(updated)
    }

    // D07b：轮间恢复结束 → 计划游标推进到下一轮上爬。
    // 计划已经走完时进入「自由加练」：不再有计划阶段，但状态机照常进入下一轮。
    if (currentPlanPhase()?.kind === 'recovery') advancePlan('completed')
    else if (planRef.current && !currentPlanPhase()) {
      extraRoundsRef.current = true
      setExtraRounds(true)
    }

    dispatch({ type: 'START_NEXT_ROUND' })
  }, [machine.recoveringSince, dispatch, advancePlan, currentPlanPhase])

  // D07b：跳过当前可选阶段（热身/恢复）。
  // - 跳过热身：只推进游标，仍停在 round_ready，由用户/自动流程进入上爬；
  // - 跳过恢复：推进游标后立即开始下一轮（等价于「不休息」）。
  // 不可跳过的阶段（上爬/返回）返回 false，且不改动任何状态。
  const skipCurrentPlanPhase = useCallback((): boolean => {
    const p = planRef.current
    const progress = planProgressRef.current
    const phase = currentPlanPhase()
    if (!p || !progress || !phase || !canSkipPhase(p, phase)) return false
    if (phase.kind === 'warmup') {
      // 热身被跳过：已用掉的那段时间照实计入热身净时长（不计入上爬）。
      closeWarmupSegment()
      advancePlan('skipped')
      return true
    }
    if (phase.kind === 'recovery') {
      advancePlan('skipped')
      // 游标已不在 recovery，startNextRound 不会重复推进。
      startNextRound()
      return true
    }
    return false
  }, [advancePlan, closeWarmupSegment, currentPlanPhase, startNextRound])

  const manualNearStart = useCallback(() => {
    dispatch({ type: 'NEAR_START', at: Date.now() })
  }, [dispatch])

  const notYetAtStart = useCallback(() => {
    // 从 start_confirmation 回到 returning（通过重新 BEGIN_RETURNING 不可行，
    // 因为 reducer 限制 BEGIN_RETURNING 只能从 round_complete 进入）
    // 这里采用：直接重置 phase 为 returning
    setMachine((prev) =>
      prev.phase === 'start_confirmation'
        ? {
            ...prev,
            phase: 'returning',
            returningSince: Date.now(),
          }
        : prev,
    )
  }, [])

  const continueExtraRound = useCallback(() => {
    // 目标达成后继续加练：清除目标消息，进入下一轮
    setGoalMessage('')
    startNextRound()
  }, [startNextRound])

  const beginReturning = useCallback(() => {
    dispatch({ type: 'BEGIN_RETURNING', at: Date.now() })
  }, [dispatch])

  automationActionsRef.current = {
    finish: (at) => {
      if (phaseRef.current !== 'ascending' || finishingWorkoutRef.current || automaticTransitionsPausedRef.current) return
      const session = roundSessionRef.current.finish(at)
      if (!session) return
      // Detecting a genuine elevator return ends the ascent even below a route target.
      void handleRoundComplete({ ...session, complete: session.finalFloor > session.startFloor }, 'route_complete')
    },
    returned: () => confirmReturnedToStart(),
    next: (at) => {
      if (finishingWorkoutRef.current || automaticTransitionsPausedRef.current) return
      const phase = phaseRef.current
      if (phase !== 'recovering' && phase !== 'round_ready') return
      pendingRoundSeedRef.current = { startedAt: at,
        seedSamples: returnSampleWindowRef.current.filter((sample) => sample.t >= at) }
      if (phase === 'recovering') startNextRound()
      beginAscending()
    },
  }

  const resumeFromCheckpoint = useCallback(
    (checkpoint: ActiveWorkoutCheckpoint, template: RouteTemplate) => {
      // 重建 workout 对象
      const w: ClimbWorkout = {
        id: checkpoint.workoutId,
        templateId: checkpoint.templateId,
        templateVersion: template.version,
        routeSnapshot: buildRouteSnapshot(template),
        goal: hasKnownRouteEnd(template)
          ? checkpoint.goal
          : { type: 'open' },
        returnConfirmationMode: checkpoint.returnConfirmationMode,
        trackingMode: resolveTrackingMode(checkpoint.trackingMode, checkpoint.returnConfirmationMode),
        floorCounting: checkpoint.floorCounting,
        bodyWeightKg: checkpoint.bodyWeightKg,
        status: 'active',
        startedAt: checkpoint.startedAt,
        rounds: checkpoint.completedRounds,
        currentRoundNumber: checkpoint.currentRoundNumber,
        totalRoundsCompleted: checkpoint.completedRounds.filter(
          (r) => r.complete,
        ).length,
        totalFloorsCompleted: checkpoint.completedRounds.reduce(
          (sum, r) => sum + r.floorsCompleted,
          0,
        ),
        totalAscentM: checkpoint.completedRounds.reduce(
          (sum, r) => sum + r.ascentM,
          0,
        ),
        totalSteps: checkpoint.completedRounds.reduce(
          (sum, r) => sum + r.steps,
          0,
        ),
        activeDurationMs: checkpoint.completedRounds.reduce(
          (sum, r) => sum + r.durationMs,
          0,
        ),
        returnDurationMs: checkpoint.completedRounds.reduce(
          (sum, r) => sum + (r.returnDurationMs ?? 0),
          0,
        ),
        recoveryDurationMs: checkpoint.completedRounds.reduce(
          (sum, r) => sum + (r.recoveryDurationMs ?? 0),
          0,
        ),
        totalElapsedMs: Math.max(0, Date.now() - checkpoint.startedAt),
        createdAt: checkpoint.startedAt,
        updatedAt: Date.now(),
      }
      setWorkout(w)
      workoutRef.current = w
      setTrackingModeState(w.trackingMode!)
      trackingModeRef.current = w.trackingMode!
      automationRef.current.setMode(w.trackingMode!)
      if (isBackgroundTrainingSupported()) {
        backgroundStartPromiseRef.current = startBackgroundTraining(w.id).then((status) => {
          backgroundCaptureActiveRef.current = status.running
        }).catch((error) => {
          backgroundCaptureActiveRef.current = false
          setBackgroundGapWarning(error instanceof Error ? error.message : String(error))
        })
      }

      // 同步 effectiveTemplate（恢复时 template 可能已升级为 verified）
      setEffectiveTemplate(template)
      setTemplateGenerated(hasKnownRouteEnd(template))

      // 恢复到对应阶段
      // 不恢复 ascending 阶段（无法恢复半轮 DTW 缓冲）
      // D07b：计划与计划游标从检查点恢复（旧检查点无这两个字段 → 保持 undefined，旧行为）。
      const restoredPlan = checkpoint.plan
      let restoredProgress = checkpoint.planProgress
      if (restoredPlan && !restoredProgress) {
        // 容错：有计划但没有游标时从头开始，而不是让整个恢复流程崩溃。
        restoredProgress = initialPlanProgress(restoredPlan)
      }

      let resumePhase: WorkoutPhase = checkpoint.phase
      let resumeRoundNumber = checkpoint.currentRoundNumber
      if (resumePhase === 'ascending' || resumePhase === 'countdown') {
        // 半轮被中断（countdown 为旧检查点遗留阶段）：
        // 1) 把中断的本轮记录为 completionReason='interrupted' 的轮次
        // 2) 从下一轮（roundNumber+1）的 round_ready 重新开始
        const interruptedRound = buildInterruptedRound(checkpoint, template)
        const updatedWorkout: ClimbWorkout = {
          ...w,
          rounds: [...w.rounds, interruptedRound],
        }
        setWorkout(updatedWorkout)
        workoutRef.current = updatedWorkout
        resumePhase = 'round_ready'
        resumeRoundNumber = checkpoint.currentRoundNumber + 1
        // 被中断的上爬阶段不可能再完成：标记为已完成，让计划轮次与状态机轮次
        // （currentRoundNumber+1）保持一致，避免恢复后计划提示停在旧轮次。
        if (
          restoredPlan &&
          restoredProgress &&
          nextPlanPhase(restoredPlan, restoredProgress)?.kind === 'climb'
        ) {
          restoredProgress = advancePlanProgress(restoredPlan, restoredProgress)
        }
      }

      if (restoredPlan && restoredProgress) {
        planRef.current = restoredPlan
        planProgressRef.current = restoredProgress
        setActivePlan(restoredPlan)
        setPlanProgress(restoredProgress)
        // F18：恢复已结算的热身净时长与「自由加练」标记（旧检查点为 0/false）。
        warmupAccumulatedRef.current = Math.max(
          0,
          checkpoint.warmupDurationMs ?? 0,
        )
        setWarmupDurationMs(warmupAccumulatedRef.current)
        extraRoundsRef.current = checkpoint.extraRounds === true
        setExtraRounds(extraRoundsRef.current)
        // 恢复到热身阶段（round_ready + 计划停在 warmup）时重新计时：
        // 热身时长无法写入检查点（types.ts 只读），杀进程后从头累计。
        warmupStartedAtRef.current =
          resumePhase === 'round_ready' &&
          nextPlanPhase(restoredPlan, restoredProgress)?.kind === 'warmup'
            ? Date.now()
            : undefined
      } else {
        // 旧检查点：不引入计划，也不改任何既有恢复行为。
        planRef.current = undefined
        planProgressRef.current = undefined
        setActivePlan(undefined)
        setPlanProgress(undefined)
        warmupStartedAtRef.current = undefined
      }

      setMachine({
        phase: resumePhase,
        currentRoundNumber: resumeRoundNumber,
        returningSince:
          resumePhase === 'returning' ? Date.now() : undefined,
        recoveringSince:
          resumePhase === 'recovering' ? Date.now() : undefined,
        ...(restoredPlan && restoredProgress
          ? {
              planId: restoredPlan.id,
              planPhaseIndex: restoredProgress.phaseIndex,
              skippedPlanPhases: [...restoredProgress.skippedPhases],
            }
          : {}),
      })
    },
    [],
  )

  // === 目标检测 ===
  useEffect(() => {
    if (!summary || !workout) return
    const result = checkGoalReached(summary, workout.goal)
    if (result.reached && result.message !== goalMessage) {
      setGoalMessage(result.message)
    }
  }, [summary, workout, goalMessage])

  const dismissBackgroundGapWarning = useCallback(() => {
    observedSensorGapRef.current = false
    setBackgroundGapWarning('')
  }, [])

  // === 清理 ===
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }
      void stopReturnMonitor()
    }
  }, [stopReturnMonitor])

  // === AppState 监听：应用进入后台时自动保存检查点 ===
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (
          nextState === 'background' ||
          nextState === 'inactive'
        ) {
          const w = workoutRef.current
          const phase = phaseRef.current
          // setup/workout_complete 阶段无需保存
          if (!w || phase === 'setup' || phase === 'workout_complete') {
            return
          }
          returnEvidenceRef.current?.flush()
          roundSessionRef.current.flushEvidence()
          // A successfully running native service owns continuous capture through lock-screen.
          if (!backgroundCaptureActiveRef.current && backgroundedAtRef.current === undefined) {
            backgroundedAtRef.current = Date.now()
          }
          // 失败原因由 persistCheckpoint 内部写入 checkpointSaveError 并展示给用户
          void persistCheckpoint(phase, currentRoundNumberRef.current)
          return
        }
        if (nextState === 'active' && backgroundedAtRef.current !== undefined) {
          const awayMs = Date.now() - backgroundedAtRef.current
          backgroundedAtRef.current = undefined
          // 只有明显的一段（>=3s）才提示，避免下拉通知栏/切输入法造成噪音
          if (awayMs >= 3000) {
            setBackgroundGapWarning(
              `刚刚离开应用约 ${Math.round(awayMs / 1000)} 秒：${isBackgroundTrainingSupported() ? '后台采集当时尚未启动或权限尚未确认，' : '当前版本没有连续后台采集，'}` +
                '请核对实际楼层；可以随时修正楼层并结束本轮。',
            )
          }
        }
      },
    )
    return () => {
      subscription.remove()
    }
  }, [persistCheckpoint])

  return {
    phase: machine.phase,
    currentRoundNumber: machine.currentRoundNumber,
    workout,
    summary,
    goalMessage,
    timer,
    roundSession,
    currentRound,
    previousRound,
    activeTemplate: effectiveTemplate,
    returnBarometerAvailable,
    relativeHeightM,
    nearStart,
    returnVisualization,
    trackingMode,
    setTrackingMode,
    setAutomaticTransitionsPaused,
    automationStatus,
    elevatorDescending,
    evidenceSaveError,
    backgroundServiceStopError,
    startWorkout,
    beginAscending,
    finishRound,
    finishWorkout,
    completeLearningRound,
    confirmCurrentRoundComplete,
    discardCurrentRoundAndFinish,
    confirmReturnedToStart,
    startNextRound,
    manualNearStart,
    notYetAtStart,
    continueExtraRound,
    beginReturning,
    resumeFromCheckpoint,
    checkpointSaveError,
    backgroundGapWarning,
    dismissBackgroundGapWarning,
    firstRoundCalibration,
    templateGenerated,
    // === D07b：计划 ===
    plan: activePlan ?? null,
    planPhase,
    planProgress: planProgress ?? null,
    planRoundNumber: planProgress?.roundNumber ?? 0,
    planRemainingRounds: planProgress?.remainingRounds ?? 'unknown',
    canSkipCurrentPlanPhase,
    skipCurrentPlanPhase,
    planFeedback,
    warmupDurationMs: activePlan ? warmupDurationMs : 0,
    extraRounds,
  }
}

/**
 * 应用启动时检查是否有未结束的训练检查点。
 * 返回检查点（若无返回 null）。
 */
export async function checkActiveWorkout(): Promise<ActiveWorkoutCheckpoint | null> {
  return loadActiveCheckpoint()
}

/**
 * 加载检查点对应的路线模板。
 */
export async function loadTemplateForCheckpoint(
  checkpoint: ActiveWorkoutCheckpoint,
): Promise<RouteTemplate | undefined> {
  return getRoute(checkpoint.templateId)
}
