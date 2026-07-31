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
  getFloorAchievementCount,
  getFloorTransitionCount,
} from '../core/floors'
import {
  INITIAL_WORKOUT_STATE,
  WorkoutAction,
  WorkoutMachineState,
  workoutReducer,
} from '../core/workout-machine'
import {
  ActiveWorkoutCheckpoint,
  BarometerStatus,
  ClimbSession,
  ClimbMode,
  ClimbWorkout,
  ReturnConfirmationMode,
  RouteTemplate,
  WorkoutGoal,
  WorkoutPhase,
  WorkoutRound,
  WorkoutSummary,
} from '../core/types'
import {
  clearActiveCheckpoint,
  createWorkout,
  loadActiveCheckpoint,
  saveActiveCheckpoint,
  saveWorkout,
} from '../services/workout-storage'
import { getRoute, saveRoute } from '../services/storage'
import { SensorRecorder } from '../services/sensor'
import {
  emptySensorVisualization,
  SensorMotionInterpreter,
  SensorVisualizationState,
} from '../core/sensor-visualization'
import { hasKnownRouteEnd } from '../core/route-state'

// 气压转高度系数：近海平面 1 hPa ≈ 8.3 m。
// 用线性近似已足够判断"是否回到起点"，无需引入完整气压公式。
const METERS_PER_HPA = 8.3
// 判定"接近起点"的高度阈值（米）。气压有 ±1 hPa 噪声，3m 对应约 0.36 hPa。
const NEAR_START_THRESHOLD_M = 3
// 接近起点持续多久后自动触发 start_confirmation（毫秒）
const NEAR_START_HOLD_MS = 2000
// 采集多少个气压样本后建立基线（约 1 秒，BAROMETER_INTERVAL_MS=200）
const BASELINE_SAMPLE_COUNT = 5

export interface UseClimbWorkoutOptions {
  template: RouteTemplate
  goal: WorkoutGoal
  returnConfirmationMode: ReturnConfirmationMode
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

  // === 动作 ===
  // 开始训练：setup → round_ready
  startWorkout: () => void
  // 开始本轮爬升：round_ready → ascending
  beginAscending: () => void
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

  // === 首边建模板 ===
  // 是否为首次开张模式（template.segments 为空）
  firstRoundCalibration: boolean
  // 模板是否已生成（第一轮结束后 true）
  templateGenerated: boolean
}

function buildRouteSnapshot(template: RouteTemplate): ClimbWorkout['routeSnapshot'] {
  const knownEnd = hasKnownRouteEnd(template)
  return {
    name: template.name,
    locationName: template.location?.name ?? template.name,
    startFloor: template.startFloor,
    endFloor: knownEnd ? template.endFloor : template.startFloor,
    floorsPerRound: knownEnd
      ? getFloorAchievementCount(template.startFloor, template.endFloor)
      : 0,
    ascentPerRoundM: knownEnd ? template.totalAscentM : 0,
  }
}

export function useClimbWorkout(
  options: UseClimbWorkoutOptions,
): UseClimbWorkoutResult {
  const { template, goal, returnConfirmationMode } = options

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
  // 本轮开始时间戳（ascending 阶段），应用被杀中断时用于构造 interrupted 轮
  const currentRoundStartedAtRef = useRef<number | undefined>(undefined)

  // === 气压基线（ascending 阶段采集，returning 阶段使用） ===
  // 本轮起点气压基线（hPa）。每轮 ascending 开始时重新采集。
  const baselinePressureRef = useRef<number | undefined>(undefined)
  // 采集基线用的临时样本数组
  const baselineSamplesRef = useRef<number[]>([])
  // returning 阶段的低功耗 SensorRecorder（仅订阅气压计）
  const returnRecorderRef = useRef<SensorRecorder | undefined>(undefined)
  const returnVisualizationRef = useRef(
    new SensorMotionInterpreter('returning'),
  )
  const returnVisualizationRenderAtRef = useRef(0)
  const returnAbsoluteHeightRef = useRef<number | undefined>(undefined)
  // "接近起点"持续时间计时器（assisted 模式下用于防误触发）
  const nearStartSinceRef = useRef<number | undefined>(undefined)
  // assisted 模式引用，避免闭包过期
  const returnConfirmationModeRef = useRef<ReturnConfirmationMode>(
    returnConfirmationMode,
  )
  returnConfirmationModeRef.current = returnConfirmationMode

  // === 状态机派发 ===
  const dispatch = useCallback((action: WorkoutAction) => {
    setMachine((prev) => workoutReducer(prev, action))
  }, [])

  // === 检查点持久化 ===
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
        templateId: w.templateId,
        goal: w.goal,
        returnConfirmationMode: w.returnConfirmationMode,
        startedAt: w.startedAt,
        currentRoundStartedAt:
          phase === 'ascending'
            ? currentRoundStartedAtRef.current
            : undefined,
      }
      await saveActiveCheckpoint(checkpoint)
    },
    [],
  )

  // === 首边建模板：第一轮 free 模式结束后，用采集的样本生成路线模板 ===
  // 用 ref 保存最新值，避免 handleRoundComplete 依赖数组膨胀
  const templateRef = useRef(template)
  templateRef.current = template
  const firstRoundCalibrationRef = useRef(firstRoundCalibration)
  firstRoundCalibrationRef.current = firstRoundCalibration

  const generateTemplateFromSession = useCallback(
    async (session: ClimbSession, confirmedEndFloor?: number) => {
      const t = templateRef.current
      // 必须有 location 和 samples 才能生成模板
      if (!t.location || !session.samples || session.samples.length < 50) return
      const endFloor = Math.max(
        t.startFloor + 1,
        confirmedEndFloor ?? session.finalFloor ?? t.endFloor,
      )
      // 模板按真实高度段切：1F→15F 是 14 段；运动成绩另按 15 层统计。
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
      const confirmedSession =
        confirmedEndFloor && confirmedEndFloor > session.startFloor
          ? {
              ...session,
              finalFloor: confirmedEndFloor,
              floorsCompleted: getFloorAchievementCount(
                session.startFloor,
                confirmedEndFloor,
              ),
              complete: session.interruptions.length === 0,
              routeSnapshot: session.routeSnapshot
                ? {
                    ...session.routeSnapshot,
                    endFloor: confirmedEndFloor,
                  }
                : session.routeSnapshot,
            }
          : session
      const round = roundFromSession(confirmedSession, roundNumber, reason)
      // 更新 workout
      const updatedWorkout: ClimbWorkout = {
        ...w,
        routeSnapshot:
          confirmedEndFloor && confirmedEndFloor > session.startFloor
            ? {
                ...w.routeSnapshot,
                endFloor: confirmedEndFloor,
                floorsPerRound: getFloorAchievementCount(
                  session.startFloor,
                  confirmedEndFloor,
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
      // 状态机：ascending → round_complete
      dispatch({ type: 'ROUND_COMPLETE' })
    },
    [dispatch, generateTemplateFromSession],
  )

  // === 单轮会话 ===
  const roundSession = useClimbRoundSession({
    template: effectiveTemplate,
    mode: roundMode,
    autoComplete: roundMode !== 'free',
    onComplete: (session) => {
      // 自动到达终点：固化为 WorkoutRound
      handleRoundComplete(session, 'route_complete')
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

  // === 派生数据 ===
  const summary = useMemo<WorkoutSummary | null>(() => {
    if (!workout) return null
    return calculateWorkoutSummary(
      workout.rounds,
      workout.startedAt,
      workout.endedAt,
    )
  }, [workout])

  const previousRound = useMemo<WorkoutRound | null>(() => {
    if (!workout || workout.rounds.length === 0) return null
    // 上一轮 = 当前轮次编号 - 1 对应的轮次
    const prevNumber = machine.currentRoundNumber - 1
    return workout.rounds.find((r) => r.roundNumber === prevNumber) ?? null
  }, [workout, machine.currentRoundNumber])

  // === 计时器 ===
  useEffect(() => {
    if (!workout) return
    // 主计时器：每 500ms 更新总历时和阶段用时
    timerIntervalRef.current = setInterval(() => {
      const now = Date.now()
      const w = workoutRef.current
      if (!w) return
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

    // 维护本轮开始时间（必须放在 persistCheckpoint 之前：
    // 持久化会把 ascending 阶段的本轮开始时间写入检查点，供中断恢复使用）
    if (phase === 'ascending' && currentRoundStartedAtRef.current === undefined) {
      currentRoundStartedAtRef.current = Date.now()
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
      nearStartSinceRef.current = undefined
      roundSessionRef.current.start().catch((err) => {
        console.warn('[useClimbWorkout] round start failed', err)
      })
    }

    // returning 阶段：启动低功耗气压计，用于辅助判断是否回到起点
    if (phase === 'returning') {
      setNearStart(false)
      nearStartSinceRef.current = undefined
      returnVisualizationRef.current.reset()
      returnVisualizationRenderAtRef.current = 0
      returnAbsoluteHeightRef.current = undefined
      setReturnVisualization(emptySensorVisualization())

      // 返回阶段继续采集加速度、陀螺仪和气压。只有把“有没有脚步”和
      // “高度是否平稳下降”结合起来，才能区分走楼梯与乘电梯。
      const recorder = new SensorRecorder({
        retainSamples: false,
        onSample: (sample) => {
          const next = returnVisualizationRef.current.push(sample)
          if (
            sample.t - returnVisualizationRenderAtRef.current >= 100
          ) {
            returnVisualizationRenderAtRef.current = sample.t
            setReturnVisualization({
              ...next,
              relativeHeightM:
                returnAbsoluteHeightRef.current ?? next.relativeHeightM,
            })
          }
        },
        onBarometer: (status: BarometerStatus) => {
          setReturnBarometerAvailable(status.available)
          if (
            status.available &&
            status.pressure > 0 &&
            baselinePressureRef.current !== undefined
          ) {
            const baseline = baselinePressureRef.current
            const deltaHp = baseline - status.pressure
            const heightM = deltaHp * METERS_PER_HPA
            returnAbsoluteHeightRef.current = heightM
            setRelativeHeightM(heightM)
            // 判定是否接近起点
            const isNear = Math.abs(heightM) < NEAR_START_THRESHOLD_M
            if (isNear && !nearStartSinceRef.current) {
              nearStartSinceRef.current = Date.now()
            } else if (!isNear) {
              nearStartSinceRef.current = undefined
            }
            setNearStart(isNear)
          }
        },
      })
      returnRecorderRef.current = recorder
      recorder.start().catch((err) => {
        console.warn('[useClimbWorkout] return sensor start failed', err)
      })
    }

    // 离开 returning 阶段（进入 start_confirmation 或其他）：停止低功耗 recorder
    // 注意：这里通过 cleanup 函数在 phase 变化时执行
    if (phase !== 'returning' && returnRecorderRef.current) {
      returnRecorderRef.current.stop().catch(() => undefined)
      returnRecorderRef.current = undefined
    }

    // round_complete 阶段：2 秒后自动进入 returning（除非用户先操作）
    if (phase === 'round_complete') {
      const autoReturnTimer = setTimeout(() => {
        dispatch({ type: 'BEGIN_RETURNING' })
      }, 2000)
      return () => clearTimeout(autoReturnTimer)
    }

    // workout_complete 阶段：清理
    if (phase === 'workout_complete') {
      roundSessionRef.current.cleanup()
      // 清理返回阶段 recorder（兜底）
      if (returnRecorderRef.current) {
        returnRecorderRef.current.stop().catch(() => undefined)
        returnRecorderRef.current = undefined
      }
    }
  }, [machine.phase, machine.currentRoundNumber, dispatch, persistCheckpoint])

  // === 动作实现 ===
  const startWorkout = useCallback(() => {
    const w = createWorkout({
      templateId: template.id,
      templateVersion: template.version,
      routeSnapshot: buildRouteSnapshot(template),
      goal,
      returnConfirmationMode,
    })
    setWorkout(w)
    workoutRef.current = w
    dispatch({ type: 'START_WORKOUT' })
  }, [template, goal, returnConfirmationMode, dispatch])

  const beginAscending = useCallback(() => {
    dispatch({ type: 'BEGIN_ASCENDING' })
  }, [dispatch])

  const finishWorkout = useCallback(
    async (finishOptions?: {
      saveIncompleteRound?: boolean
      confirmedEndFloor?: number
      excludeFromLearning?: boolean
    }): Promise<ClimbWorkout | null> => {
      const w = workoutRef.current
      if (!w) return null
      const phase = phaseRef.current

      // ascending 阶段：可选保存未完成轮
      if (
        phase === 'ascending' &&
        finishOptions?.saveIncompleteRound !== false
      ) {
        const session = roundSessionRef.current.finish()
        if (session) {
          await handleRoundComplete(
            session,
            'manual_finish',
            finishOptions?.confirmedEndFloor,
            finishOptions?.excludeFromLearning,
          )
        }
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
      }
      setWorkout(completedWorkout)
      workoutRef.current = completedWorkout

      await saveWorkout(completedWorkout)
      await clearActiveCheckpoint()

      dispatch({ type: 'FINISH_WORKOUT' })
      return completedWorkout
    },
    [handleRoundComplete, dispatch],
  )

  const completeLearningRound = useCallback(
    async (confirmedEndFloor: number): Promise<boolean> => {
      if (
        phaseRef.current !== 'ascending' ||
        !Number.isFinite(confirmedEndFloor)
      ) {
        return false
      }
      const session = roundSessionRef.current.finish()
      if (!session || confirmedEndFloor <= session.startFloor) return false
      await handleRoundComplete(
        session,
        'route_complete',
        confirmedEndFloor,
        false,
      )
      return true
    },
    [handleRoundComplete],
  )

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
    }
    setWorkout(completedWorkout)
    workoutRef.current = completedWorkout

    await saveWorkout(completedWorkout)
    await clearActiveCheckpoint()

    dispatch({ type: 'FINISH_WORKOUT' })
    return completedWorkout
  }, [dispatch])

  const confirmReturnedToStart = useCallback(() => {
    const w = workoutRef.current
    if (!w) return

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

    dispatch({ type: 'CONFIRM_RETURNED' })
  }, [dispatch])

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

    dispatch({ type: 'START_NEXT_ROUND' })
  }, [machine.recoveringSince, dispatch])

  const manualNearStart = useCallback(() => {
    dispatch({ type: 'NEAR_START' })
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
    dispatch({ type: 'BEGIN_RETURNING' })
  }, [dispatch])

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

      // 同步 effectiveTemplate（恢复时 template 可能已升级为 verified）
      setEffectiveTemplate(template)
      setTemplateGenerated(hasKnownRouteEnd(template))

      // 恢复到对应阶段
      // 不恢复 ascending 阶段（无法恢复半轮 DTW 缓冲）
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
      }
      setMachine({
        phase: resumePhase,
        currentRoundNumber: resumeRoundNumber,
        returningSince:
          resumePhase === 'returning' ? Date.now() : undefined,
        recoveringSince:
          resumePhase === 'recovering' ? Date.now() : undefined,
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

  // === 气压辅助：接近起点持续 NEAR_START_HOLD_MS 后自动触发 start_confirmation ===
  // 仅在 assisted 模式 + returning 阶段生效。气压不可用或无基线时不触发。
  useEffect(() => {
    if (!nearStart) return
    if (phaseRef.current !== 'returning') return
    if (returnConfirmationModeRef.current !== 'assisted') return
    if (nearStartSinceRef.current === undefined) return

    const timer = setTimeout(() => {
      // 再次检查：仍在 returning 阶段且仍接近起点
      if (
        phaseRef.current === 'returning' &&
        returnConfirmationModeRef.current === 'assisted' &&
        nearStartSinceRef.current !== undefined
      ) {
        dispatch({ type: 'NEAR_START' })
      }
    }, NEAR_START_HOLD_MS)

    return () => clearTimeout(timer)
  }, [nearStart, dispatch])

  // === 清理 ===
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }
      // 清理返回阶段低功耗 recorder
      if (returnRecorderRef.current) {
        returnRecorderRef.current.stop().catch(() => undefined)
        returnRecorderRef.current = undefined
      }
    }
  }, [])

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
          persistCheckpoint(phase, currentRoundNumberRef.current).catch(
            (err) => {
              console.warn('[useClimbWorkout] background checkpoint failed', err)
            },
          )
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
    startWorkout,
    beginAscending,
    finishWorkout,
    completeLearningRound,
    discardCurrentRoundAndFinish,
    confirmReturnedToStart,
    startNextRound,
    manualNearStart,
    notYetAtStart,
    continueExtraRound,
    beginReturning,
    resumeFromCheckpoint,
    firstRoundCalibration,
    templateGenerated,
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
