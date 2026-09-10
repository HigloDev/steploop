# palou-app 多轮爬楼训练重构计划

> 范围:P0 + P1 + P2 全部覆盖
> 决策:Climb.tsx 退役,新建 ClimbWorkout.tsx;WorkoutSetup 独立页面
> 导航流程:`RouteEdit → WorkoutSetup → ClimbWorkout → WorkoutResult`

---

## 一、总结

将核心业务对象从"单次爬楼记录 ClimbSession"升级为"一次训练 ClimbWorkout 包含多轮 WorkoutRound"。建立独立的多轮状态机、按阶段管理传感器生命周期、每轮使用全新识别器实例。新增训练目标设置、轮间返回起点界面、轮间恢复界面、多轮成绩汇总、训练海报、活动训练检查点。保留旧 ClimbSession 数据,在历史页以联合类型展示。

---

## 二、当前状态分析

### 2.1 现有架构

- **数据模型**:[src/core/types.ts](file:///c:\Users\zxn\Documents\palou-app\src\core\types.ts) 中 `ClimbSession` 是单轮扁平结构,无训练/轮次层级
- **识别器**:[src/core/recognizer.ts](file:///c:\Users\zxn\Documents\palou-app\src\core\recognizer.ts) `RouteRecognizer` 类无 `reset` 方法,`finish()` 直接产出 `ClimbSession`
- **传感器**:[src/services/sensor.ts](file:///c:\Users\zxn\Documents\palou-app\src\services\sensor.ts) `SensorRecorder` 一次性启动所有传感器,无阶段化启停
- **页面**:[src/pages/Climb.tsx](file:///c:\Users\zxn\Documents\palou-app\src\pages\Climb.tsx) 404 行,三件套(SensorRecorder + LiveFeaturePump + RouteRecognizer)内联在组件 `useRef` 中,完成即 `navigation.replace('Result')` 结束整次记录
- **代码重复**:[src/pages/Validate.tsx](file:///c:\Users\zxn\Documents\palou-app\src\pages\Validate.tsx) 与 Climb.tsx 装配逻辑高度重复
- **存储**:[src/services/storage.ts](file:///c:\Users\zxn\Documents\palou-app\src\services\storage.ts) 键名 `palou.routes.v2` / `palou.sessions.v1` / `palou.prefs.v1`,约定 `palou.<资源>.v<版本号>`
- **状态管理**:无全局库,`useState + useRef + AsyncStorage`
- **成绩页**:[src/pages/Result.tsx](file:///c:\Users\zxn\Documents\palou-app\src\pages\Result.tsx) 单轮指标 + 单层用时表
- **历史页**:[src/pages/History.tsx](file:///c:\Users\zxn\Documents\palou-app\src\pages\History.tsx) 以 `ClimbSession` 为一级对象
- **海报**:`sharePosterCreatedAt` 字段是 stub,无任何读写
- **预览页**:ClimbPreview 不存在

### 2.2 关键约束(来自 project_memory)

- 传感器必须在组件卸载时清理
- 步态阈值 3.0 m/s²、陀螺仪转向阈值 1.5 rad/s、滑动窗口 2/3 确认
- 重力基线用前 1 秒数据校准
- 地图使用高德(本次重构不涉及地图)

---

## 三、提议变更

按 P0 → P1 → P2 分阶段实施。每个阶段内部按依赖顺序:类型 → 纯函数 → 服务 → Hook → 页面 → 导航注册。

### P0:数据结构 + 状态机 + 单轮修复 + 每轮独立识别器

#### P0-1 扩展类型定义

**文件**:[src/core/types.ts](file:///c:\Users\zxn\Documents\palou-app\src\core\types.ts)

**新增类型**(追加到文件末尾,不修改现有 `ClimbSession`):

```typescript
export type RoundCompletionReason =
  | 'route_complete'
  | 'manual_finish'
  | 'interrupted'
  | 'cancelled'

export type WorkoutStatus = 'planned' | 'active' | 'completed' | 'cancelled'

export type WorkoutGoalType = 'open' | 'rounds' | 'floors' | 'ascent' | 'duration'

export type WorkoutGoal =
  | { type: 'open' }
  | { type: 'rounds'; targetRounds: number }
  | { type: 'floors'; targetFloors: number }
  | { type: 'ascent'; targetAscentM: number }
  | { type: 'duration'; targetActiveDurationMs: number }

export type ReturnConfirmationMode = 'manual' | 'assisted'

export type CountdownDuration = 0 | 3 | 5 | 10

export interface WorkoutRound {
  id: string
  roundNumber: number
  startedAt: number
  endedAt: number
  durationMs: number
  startFloor: number
  targetFloor: number
  finalFloor: number
  floorsCompleted: number
  ascentM: number
  steps: number
  confidence: number
  complete: boolean
  completionReason: RoundCompletionReason
  floorSplits: Array<{
    floorFrom: number
    floorTo: number
    reachedAtMs: number
    splitDurationMs: number
    steps?: number
    confidence?: number
  }>
  events: RecognitionEvent[]
  interruptions: Array<{ startMs: number; endMs: number }>
  averageFloorMs?: number
  bestFloorSplitMs?: number
  returnedToStartAt?: number
  returnDurationMs?: number
  recoveryDurationMs?: number
}

export interface ClimbWorkout {
  id: string
  templateId: string
  templateVersion: number
  routeSnapshot: {
    name: string
    locationName: string
    startFloor: number
    endFloor: number
    floorsPerRound: number
    ascentPerRoundM: number
  }
  goal: WorkoutGoal
  returnConfirmationMode: ReturnConfirmationMode
  countdownSeconds: CountdownDuration
  status: WorkoutStatus
  startedAt: number
  endedAt?: number
  rounds: WorkoutRound[]
  currentRoundNumber: number
  totalRoundsCompleted: number
  totalFloorsCompleted: number
  totalAscentM: number
  totalSteps: number
  activeDurationMs: number
  returnDurationMs: number
  recoveryDurationMs: number
  totalElapsedMs: number
  bestRoundMs?: number
  averageRoundMs?: number
  latestRoundMs?: number
  createdAt: number
  updatedAt: number
}

export interface WorkoutSummary {
  totalRounds: number
  completeRounds: number
  totalFloors: number
  totalAscentM: number
  totalSteps: number
  activeDurationMs: number
  returnDurationMs: number
  recoveryDurationMs: number
  totalElapsedMs: number
  bestRoundMs?: number
  worstRoundMs?: number
  averageRoundMs?: number
  latestRoundMs?: number
  firstHalfAvgMs?: number
  secondHalfAvgMs?: number
  secondHalfDeclinePct?: number   // 后半程衰减百分比
  coefficientOfVariation?: number // 变异系数
}

export interface ActiveWorkoutCheckpoint {
  workoutId: string
  phase: WorkoutPhase
  currentRoundNumber: number
  savedAt: number
  completedRounds: WorkoutRound[]
}

export type HistoryItem =
  | { type: 'legacy_session'; session: ClimbSession }
  | { type: 'workout'; workout: ClimbWorkout }
```

**新增 `WorkoutPhase` 类型**(放 workout-machine.ts,见 P0-3)。

**决策**:保留旧 `ClimbSession` 完全不动,新增类型平行存在。`WorkoutSummary` 中文键名(后半程衰减百分比、变异系数)按需求文档表述保留,实际实现时改为英文键 `secondHalfDeclinePct` / `coefficientOfVariation`,文档中明确映射。

---

#### P0-2 训练汇总纯函数

**新建**:`src/core/workout-summary.ts`

```typescript
export function calculateWorkoutSummary(
  rounds: WorkoutRound[],
  startedAt: number,
  endedAt?: number,
): WorkoutSummary

export function buildWorkoutFromSession(session: ClimbSession): ClimbWorkout
// 展示层映射:旧单轮 → 单轮 Workout,不写回存储
```

**职责**:
- 从 `rounds` 派生所有汇总字段(总轮数、完整轮数、累计楼层/爬升/步数、净爬楼时间、返回总时间、恢复总时间、训练总历时、最快/最慢/平均/最近一轮、前后半程差异、变异系数)
- `activeDurationMs = Σ round.durationMs`(仅完整轮 + 未完成轮的实际爬楼部分)
- `totalElapsedMs = (endedAt ?? Date.now()) - startedAt`
- `returnDurationMs = Σ round.returnDurationMs`
- `recoveryDurationMs = Σ round.recoveryDurationMs`
- 前后半程:按完成轮次中点切分,计算各自平均用时
- 变异系数 = 标准差 / 平均值

---

#### P0-3 多轮状态机

**新建**:`src/core/workout-machine.ts`

```typescript
export type WorkoutPhase =
  | 'setup'
  | 'round_ready'
  | 'countdown'
  | 'ascending'
  | 'round_complete'
  | 'returning'
  | 'start_confirmation'
  | 'recovering'
  | 'workout_complete'

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
  | { type: 'NEAR_START' }              // 气压辅助检测接近起点
  | { type: 'CONFIRM_RETURNED' }
  | { type: 'BEGIN_RECOVERY' }
  | { type: 'START_NEXT_ROUND' }
  | { type: 'FINISH_WORKOUT' }
  | { type: 'GOAL_REACHED' }

export function workoutReducer(
  state: WorkoutMachineState,
  action: WorkoutAction,
): WorkoutMachineState

export function canFinishWorkout(phase: WorkoutPhase): boolean
export function isSensorHeavyPhase(phase: WorkoutPhase): boolean
// ascending → true;returning/recovering → false
```

**状态流转**:
```
setup →(START_WORKOUT)→ round_ready
round_ready →(START_COUNTDOWN)→ countdown
countdown →(COUNTDOWN_TICK 0)→ ascending
ascending →(ROUND_COMPLETE)→ round_complete
round_complete →(BEGIN_RETURNING, 2s 后或手动)→ returning
returning →(NEAR_START if assisted)→ start_confirmation
start_confirmation →(CONFIRM_RETURNED)→ recovering
returning →(CONFIRM_RETURNED if manual)→ recovering
recovering →(START_NEXT_ROUND)→ countdown
任意非 setup →(FINISH_WORKOUT)→ workout_complete
```

**纯函数**:reducer 不含副作用,副作用在 Hook 层处理。

---

#### P0-4 训练存储服务

**新建**:`src/services/workout-storage.ts`

存储键(不修改旧键):
- `palou.workouts.v1` — `ClimbWorkout[]`,上限 100 条
- `palou.activeWorkout.v1` — `ActiveWorkoutCheckpoint | null`

```typescript
export async function listWorkouts(): Promise<ClimbWorkout[]>
export async function getWorkout(id: string): Promise<ClimbWorkout | undefined>
export async function saveWorkout(workout: ClimbWorkout): Promise<void>
export async function deleteWorkout(id: string): Promise<void>

export async function loadActiveCheckpoint(): Promise<ActiveWorkoutCheckpoint | null>
export async function saveActiveCheckpoint(cp: ActiveWorkoutCheckpoint | null): Promise<void>
export async function clearActiveCheckpoint(): Promise<void>
```

**修改**:[src/services/storage.ts](file:///c:\Users\zxn\Documents\palou-app\src\services\storage.ts) `BackupPayload` 扩展为可选包含 `workouts?: ClimbWorkout[]`,`exportRawData` / `importRawData` 同步导出导入 workouts。版本号保持 1,向后兼容(无 workouts 字段时返回空数组)。

---

#### P0-5 抽取单轮识别 Hook

**新建**:`src/hooks/useClimbRoundSession.ts`

把 [Climb.tsx](file:///c:\Users\zxn\Documents\palou-app\src\pages\Climb.tsx) 第 80-212 行的三件套装配逻辑抽取为可复用 Hook。

```typescript
export interface UseClimbRoundSessionOptions {
  template: RouteTemplate
  onFloorChanged?: (floor: number, atMs: number) => void
  onComplete?: (session: ClimbSession) => void
  onGap?: (gap: { startMs: number; endMs: number }) => void
}

export interface UseClimbRoundSessionResult {
  snapshot: RecognitionSnapshot
  elapsedMs: number
  startedAt: number | undefined
  start: () => Promise<void>
  finish: (completionReason: RoundCompletionReason) => ClimbSession | null
  cleanup: () => void
}

export function useClimbRoundSession(
  options: UseClimbRoundSessionOptions,
): UseClimbRoundSessionResult
```

**关键实现**:
- `useRef` 持有 `SensorRecorder` + `LiveFeaturePump` + `RouteRecognizer`(每轮 new,不跨轮复用)
- `start()` 调用 `recorder.start()`,含 `ensurePrivacyAuthorized` + 2s 超时
- `finish()` 调用 `recognizer.finish()`,但**不在此处 saveSession**,把 `ClimbSession` 交给上层 Hook 决定持久化
- `cleanup()` 在组件卸载或轮次结束时清理 timer 与 recorder.stop()
- `onComplete` 在 `snapshot.status === 'complete'` 时触发,触发 heavy 震动 + success 声音

**复用**:[Validate.tsx](file:///c:\Users\zxn\Documents\palou-app\src\pages\Validate.tsx) 同步改造为使用此 Hook,消除重复代码。Validate 仍保持单轮模式,`finish` 后调 `saveSession` 并升级 `route.status`。

---

#### P0-6 多轮训练主 Hook

**新建**:`src/hooks/useClimbWorkout.ts`

```typescript
export interface UseClimbWorkoutOptions {
  template: RouteTemplate
  goal: WorkoutGoal
  returnConfirmationMode: ReturnConfirmationMode
  countdownSeconds: CountdownDuration
}

export interface UseClimbWorkoutResult {
  workout: ClimbWorkout | null
  phase: WorkoutPhase
  currentRoundNumber: number
  countdownRemaining: number
  // 当前轮数据(ascending 阶段)
  roundSnapshot: RecognitionSnapshot
  roundElapsedMs: number
  // 汇总
  summary: WorkoutSummary | null
  // 气压辅助
  relativeHeightM: number | null
  barometerAvailable: boolean
  // 动作
  startWorkout: () => void
  startCountdown: () => void
  beginReturning: () => void
  confirmReturnedToStart: () => void
  startNextRound: () => void
  finishWorkout: (options?: { saveIncompleteRound?: boolean }) => Promise<ClimbWorkout | null>
  abortCurrentRound: () => void
  // 检查点
  checkpointSavedAt: number | null
}
```

**职责**:
- 持有 `WorkoutMachineState`,通过 `workoutReducer` 派发动作
- `phase === 'ascending'` 时调用 `useClimbRoundSession`,完成时:
  - 把 `ClimbSession` 转换为 `WorkoutRound`(`startedAt`/`endedAt`/`durationMs`/`steps`/`ascentM`/`floorSplits` 等字段映射,`completionReason = 'route_complete'` 或 `'manual_finish'`)
  - 推入 `workout.rounds`,`currentRoundNumber += 1`
  - 调 `saveActiveCheckpoint` 持久化已完成轮次
  - **不**导航到 Result,而是切到 `round_complete` phase
- `phase === 'returning'` / `'recovering'` 时,**关闭** `useClimbRoundSession`(传感器停),仅保留可选低频气压计订阅用于 `relativeHeightM`
- `phase === 'countdown'` 时执行 3-2-1 倒计时(用 `setInterval`),到 0 后 `BEGIN_ASCENDING`,再次启动 `useClimbRoundSession`
- `finishWorkout`:把 `workout.status = 'completed'`,`endedAt = Date.now()`,调 `saveWorkout` + `clearActiveCheckpoint`
- 目标检测:每次轮次完成后调 `checkGoalReached`,达标时派发 `GOAL_REACHED`(提示但不强制结束)
- 气压辅助:`returning` 阶段若 `relativeHeightM` 接近 0(阈值 ±2m),派发 `NEAR_START` 进入 `start_confirmation`

**关键约束**:
- 每轮 `useClimbRoundSession` 必须是全新实例,通过 `key={currentRoundNumber}` 强制重挂子组件或 Hook 内部 `useRef` 重置实现
- 不恢复被中断的半轮 DTW 特征缓冲

---

#### P0-7 修复单轮时间与传感器问题

**修改**:[src/core/recognizer.ts](file:///c:\Users\zxn\Documents\palou-app\src\core\recognizer.ts)

- `finish()` 中 `durationMs` 当前用 `endedAt - startedAt`,但中断期间未扣除。新增 `interruptedMs = Σ(endMs - startMs)`,`durationMs = Math.max(0, endedAt - startedAt - interruptedMs)`(净用时)
- `averageFloorMs` 用净时长计算
- `bestFloorSplitMs` 保持单层用时最小值

**修改**:[src/services/sensor.ts](file:///c:\Users\zxn\Documents\palou-app\src\services\sensor.ts)

- 新增可选 `lowPowerMode?: boolean` 选项。`lowPowerMode=true` 时仅订阅 `Barometer`(5Hz),不订阅加速度/陀螺仪/DeviceMotion。用于 `returning` 阶段辅助判断返回起点
- `stop()` 行为不变

**修改**:[src/core/types.ts](file:///c:\Users\zxn\Documents\palou-app\src\core\types.ts) `SensorRecorderOptions`:

```typescript
export interface SensorRecorderOptions {
  retainSamples?: boolean
  lowPowerMode?: boolean   // 新增
  onSample?: (sample: SensorSample) => void
  onStatus?: (status: SensorStatus) => void
  onGap?: (gap: { startMs: number; endMs: number }) => void
  onBarometer?: (status: BarometerStatus) => void
}
```

---

### P1:多轮 UI 全套 + 历史记录 + 检查点

#### P1-1 训练目标设置页

**新建**:`src/pages/WorkoutSetup.tsx`

- 路由参数:`{ id: string }`(templateId)
- 加载 `getRoute(id)`,校验 `route.location` 与 `route.status === 'verified'`(复用 Climb.tsx 现有校验逻辑,弹窗跳 LocationPicker / Validate)
- 三段设置:
  1. **训练模式**:`open` / `rounds` / `floors` / `ascent` / `duration`,选中 `rounds` 时显示目标轮数输入(默认 5),`floors` 显示目标层数(默认 75),`ascent` 显示目标米数(默认 240),`duration` 显示目标分钟数(默认 30)
  2. **轮间模式**:`manual`(默认) / `assisted`,带说明文案
  3. **自动倒计时**:`关闭 / 3秒 / 5秒 / 10秒`(默认 3 秒)
- 底部"开始训练"按钮 → `navigation.replace('ClimbWorkout', { id, goal, returnMode, countdown })`

**导航参数扩展**:见 P1-6。

---

#### P1-2 多轮训练容器页面

**新建**:`src/pages/ClimbWorkout.tsx`

单一容器页面,内部按 `phase` 切换子视图,**不跨页导航**。

```typescript
export default function ClimbWorkoutScreen({ navigation, route }: RootStackScreen<'ClimbWorkout'>) {
  const { template, goal, returnMode, countdown } = route.params
  const workout = useClimbWorkout({ template, goal, returnConfirmationMode: returnMode, countdownSeconds: countdown })

  switch (workout.phase) {
    case 'setup': return <SetupView ... />
    case 'round_ready': return <RoundReadyView ... />
    case 'countdown': return <CountdownView ... />
    case 'ascending': return <AscendingView ... />
    case 'round_complete': return <RoundCompleteView ... />
    case 'returning': return <ReturningView ... />
    case 'start_confirmation': return <StartConfirmationView ... />
    case 'recovering': return <RecoveringView ... />
    case 'workout_complete': return <WorkoutCompleteView ... />
  }
}
```

**各子视图职责**(先用内联组件,后续可拆分):

- **SetupView**:理论上 setup 阶段已在 WorkoutSetup 页完成,此处仅兜底显示"准备中"
- **RoundReadyView**:显示"第 N 轮准备 / 1F → 16F",按钮"开始第 N 轮"→ `startCountdown()`
- **CountdownView**:大号 3-2-1 倒计时,每秒 tick,完成后自动进 ascending
- **AscendingView**:复用 Climb.tsx 的楼层流光图 + 楼层 chip 网格,但顶部增加 `WorkoutHeader`(见 P1-3)显示训练维度。底部三行:本轮数据 / 累计数据 / 结束按钮
- **RoundCompleteView**:轮次完成动画(见 P1-4) + 本轮成绩 + 与上一轮对比 + 按钮"开始返回1F" / "结束训练"
- **ReturningView**:返回起点视觉(见 P1-5)
- **StartConfirmationView**:"检测到已接近1F / 请确认当前位置",按钮"我已到达1F" / "还没有"
- **RecoveringView**:恢复控制台(见 P1-5)
- **WorkoutCompleteView**:最终汇总,按钮"查看成绩"→ `navigation.replace('WorkoutResult', { id })`

**关键约束**:
- 整个训练由一个容器页面管理,不每轮导航
- `useEffect` cleanup 在卸载时调 `workout.cleanup()`,确保传感器清理
- `AppState` 监听(见 P1-7):后台时保存检查点

---

#### P1-3 训练维度顶部条组件

**新建**:`src/components/WorkoutHeader.tsx`

布局:
```
┌────────────────────────────────┐
│ 第3轮              训练 18:42 │
│ 目标5轮            净爬 13:26 │
└────────────────────────────────┘
```

Props:`{ currentRound, goal, totalElapsedMs, activeDurationMs }`

自由训练(`goal.type === 'open'`)时第二行左侧显示"自由训练"。

---

#### P1-4 轮次完成动画 + 轮次轨道

**新建**:`src/components/RoundCompleteAnimation.tsx`

动画序列(用 `Animated` API):
1. 当前楼段流光到达终点楼层
2. 终点节点点亮
3. 显示"第 N 轮完成"
4. 楼层图缓慢收缩为本轮摘要卡
5. 出现本轮成绩 + 轮次对比

文案规则:
- 第 1 轮:"首轮成绩已记录"
- 第 N 轮(N>1):"比第 N-1 轮快/慢 X 秒" / "目前第 K 快"

**新建**:`src/components/RoundTrack.tsx`

轮次轨道(●●◉○○):
- 实心绿色:已完成轮次
- 发光圆环:当前轮
- 空心节点:计划轮次
- 自由训练:只显示"已完成 X 轮 · 当前第 Y 轮"
- 超过 8 轮:改为"第 Y 轮 / 已完成 X 轮"文字

Props:`{ completed, current, target? }`(target 为 `open` 时 undefined)

---

#### P1-5 返回起点 + 恢复界面

**新建**:`src/components/ReturningView.tsx`

- 复用 `BuildingSketch`,但转换为返回模式:已完成上楼路径低亮绿色,电梯轿厢图标沿右侧竖直缓慢下移,色彩切换为蓝青色
- 不显示楼层匹配百分比,不播放上楼流光
- 主文案:"返回1F中 / 本阶段不计入爬楼成绩"
- 气压可用时显示"相对起点高度 +X.Xm"(不显示绝对楼层)
- 接近起点时显示"已接近起点高度 / 请确认是否到达1F"
- 气压不可用时显示"请到达1F后手动确认"
- 主按钮"我已回到1F" → `confirmReturnedToStart()`
- 次按钮"结束训练"

**新建**:`src/components/RecoveringView.tsx`

恢复控制台:
```
准备第4轮

休息时间 01:12

上一轮   04:28
最快轮   04:22
平均轮   04:31
累计爬升 144m
```
- 小型趋势条:每轮用时横条
- 主按钮"开始第4轮" → `startNextRound()`(若启用倒计时则进 countdown)
- 次按钮"结束训练"

---

#### P1-6 导航类型与 App.tsx 注册

**修改**:[src/navigation/types.ts](file:///c:\Users\zxn\Documents\palou-app\src\navigation\types.ts)

```typescript
export type RootStackParamList = {
  RouteEdit: undefined
  LocationPicker: { routeId?: string } | undefined
  Calibrate: { seed: CalibrateSeed }
  Review: undefined
  Validate: { id?: string }
  // 旧路由保留但不再从 RouteEdit 进入
  Climb: { id: string; mode: 'formal' | 'validation' }   // 保留供 Result "再爬一次" 兼容,但实际重定向到 WorkoutSetup
  Result: { id: string }                                   // legacy 单轮详情
  // 新路由
  WorkoutSetup: { id: string }
  ClimbWorkout: {
    id: string
    goal: WorkoutGoal
    returnMode: ReturnConfirmationMode
    countdown: CountdownDuration
  }
  WorkoutResult: { id: string }
  Privacy: { from?: string }
  History: undefined
  Settings: undefined
}
```

**修改**:[App.tsx](file:///c:\Users\zxn\Documents\palou-app\App.tsx)

- 删除 `import ClimbScreen` 与 `<Stack.Screen name="Climb">` 注册
- 新增 `import WorkoutSetupScreen` / `ClimbWorkoutScreen` / `WorkoutResultScreen` 并注册
- 启动时检测 `loadActiveCheckpoint()`:若存在,弹 Alert"发现未结束的爬楼训练 / 已完成 N 轮 / 当前处于 X 阶段 / 继续训练 / 结束并保存"。继续则 `navigation.navigate('ClimbWorkout', ...)`(需从 checkpoint 反推参数),结束则 `saveWorkout` + `clearActiveCheckpoint`

**修改**:[src/pages/RouteEdit.tsx](file:///c:\Users\zxn\Documents\palou-app\src\pages\RouteEdit.tsx)

点击已验证路线:`navigation.navigate('WorkoutSetup', { id: route.id })`(原来是 `Climb`)。

**修改**:[src/pages/Result.tsx](file:///c:\Users\zxn\Documents\palou-app\src\pages\Result.tsx) "再爬一次"按钮:

- 旧 `ClimbSession` 记录:跳 `WorkoutSetup`(默认 `open` 模式)
- 新 `ClimbWorkout` 记录:跳 `WorkoutSetup` 并预填上次的 goal

---

#### P1-7 活动训练检查点 + AppState 监听

**修改**:`src/hooks/useClimbWorkout.ts`

- 订阅 `AppState.addEventListener('change', ...)`
- `background` / `inactive` 时:若 `phase` 非 `setup` 且非 `workout_complete`,调 `saveActiveCheckpoint({ workoutId, phase, currentRoundNumber, savedAt: Date.now(), completedRounds: workout.rounds })`
- `active` 时:不自动恢复(避免假恢复),由 App.tsx 启动时弹窗处理
- `ascending` 阶段被杀:当前未完成轮标记 `completionReason: 'interrupted'`,不写入 `rounds`,checkpoint 中只保留已完成轮次

**修改**:[App.tsx](file:///c:\Users\zxn\Documents\palou-app\App.tsx) 启动检查点(见 P1-6)。

---

#### P1-8 多轮结果页

**新建**:`src/pages/WorkoutResult.tsx`

主视觉:
```
完成5轮

75层
240m
净爬楼 23:18
```

次级数据:
```
总历时      38:42
总步数      2433
最快一轮    04:24
平均一轮    04:39
平均每层    18.6秒
```

轮次排名:
```
1. 第3轮  04:24
2. 第2轮  04:28
...
```

- 加载 `getWorkout(id)` → `calculateWorkoutSummary`
- 表现文案基于确定性规则:
  - 后半程平均比前半程慢 >8% → "后半程速度有所下降"
  - 变异系数 <5% → "本次轮次表现较稳定"
  - 最后一轮为最快轮 → "末轮仍保持较强输出"
- 按钮:"返回首页" / "再练一次"(跳 WorkoutSetup)
- 兼容旧 `ClimbSession`:若 `getWorkout` 未找到,尝试 `getSession(id)`,映射为单轮 Workout 展示

---

#### P1-9 历史记录改造

**修改**:[src/pages/History.tsx](file:///c:\Users\zxn\Documents\palou-app\src\pages\History.tsx)

- `listHistoryItems()`:并行 `listWorkouts()` + `listSessions()`,按时间合并排序,返回 `HistoryItem[]`
- 卡片视图:
  - `type === 'workout'`:显示"5轮 · 75层 · 240m / 净爬楼 23:18 / 总历时 38:42 / 最快一轮 4:21"
  - `type === 'legacy_session'`:显示"单轮记录 / 1F → 16F / 用时 / 爬升 / 步数"
- 点击跳转:
  - workout → `WorkoutResult`
  - legacy_session → `Result`
- 汇总卡:完成训练次数 + 累计爬升(仅统计 completed workout + complete session)
- 筛选保留 `all` / `complete` / `interrupted`

---

### P2:气压辅助 + 趋势图 + 训练目标 + 海报 + 预览页

#### P2-1 气压辅助判断返回起点

**修改**:`src/hooks/useClimbWorkout.ts`

- `returning` 阶段启动 `SensorRecorder({ lowPowerMode: true })`
- 记录本轮起点气压基线(从上一轮 ascending 开始时的气压)
- `relativeHeightM = (当前气压 - 起点基线) / 气压高度公式`
- `|relativeHeightM| < 2` 时派发 `NEAR_START`
- 仅辅助,不自动开始下一轮

---

#### P2-2 轮次趋势图

**新建**:`src/components/RoundTrendChart.tsx`

- 纯 SVG 实现(React Native 内置 SVG 支持,无新增依赖)
- 三组:单轮用时趋势 / 单轮步数趋势 / 单轮平均楼层用时
- 横条或折线,标最快轮
- 用于 `WorkoutResult` 和 `RecoveringView`

---

#### P2-3 训练目标完成逻辑

**修改**:`src/hooks/useClimbWorkout.ts`

- `rounds`:完成目标轮数 → 提示"目标已完成:N 轮",提供"完成训练 / 继续第 N+1 轮"。继续后目标保留,实际轮数可超目标
- `floors`:累计楼层达标 → 提示"目标已达到,可完成本轮后结束",**不在楼梯中途自动停止**
- `ascent`:同上
- `duration`:`activeDurationMs` 达标 → 提示,让用户完成当前楼段或轮

新增 `checkGoalReached(summary, goal): { reached: boolean; message: string }`。

---

#### P2-4 训练海报

**新增依赖**:`react-native-view-shot`(需 `npx expo install react-native-view-shot`)

**新建**:`src/components/WorkoutPoster.tsx`

```
水电大楼爬楼训练

5轮
75层
240米

净爬楼 23:18
最快一轮 04:24
累计2433步
```

- 含轮次趋势迷你图(复用 RoundTrendChart 简化版)
- 不只显示最后一轮

**修改**:`src/pages/WorkoutResult.tsx`

- 新增"生成海报"按钮
- 用 `react-native-view-shot` captureRef → `expo-sharing` 分享 / 保存到相册
- 保存后写 `workout.sharePosterCreatedAt = Date.now()` → `saveWorkout`

---

#### P2-5 开发预览页

**新建**:`src/pages/ClimbPreview.tsx`

- 仅 `__DEV__` 下可访问(从 Settings 开发者入口或 RouteEdit `__DEV__` 菜单)
- 模拟数据状态机演练,无需真实传感器
- 场景按钮:
  - 第1轮上楼
  - 第1轮完成
  - 乘电梯返回
  - 接近1F
  - 第2轮准备
  - 第2轮上楼
  - 第3轮完成
  - 完成目标5轮
  - 自由训练第12轮
  - 中途结束未完成轮
- 模拟数据:路线 1F→16F / 目标 5 轮 / 当前第 3 轮 / 已完成 2 轮 / 累计 30 层 / 累计爬升 96m

**修改**:[src/navigation/types.ts](file:///c:\Users\zxn\Documents\palou-app\src\navigation\types.ts) 新增 `ClimbPreview: undefined` 路由。

**修改**:[App.tsx](file:///c:\Users\zxn\Documents\palou-app\App.tsx) `__DEV__` 下注册。

**修改**:[src/pages/Settings.tsx](file:///c:\Users\zxn\Documents\palou-app\src\pages\Settings.tsx) `__DEV__` 下新增"开发预览"入口。

---

## 四、假设与决策

### 4.1 关键决策

1. **Climb.tsx 退役**:删除文件,删除 App.tsx 注册,导航类型保留 `Climb` 路由声明但不再使用(供 Result.tsx "再爬一次"兼容性重定向)。Validate.tsx 改用 `useClimbRoundSession` hook。
2. **旧 ClimbSession 保留**:不修改 `palou.sessions.v1` 存储结构与 `ClimbSession` 类型。新增 `palou.workouts.v1` 与 `palou.activeWorkout.v1`。
3. **每轮新识别器**:`useClimbRoundSession` 内部 `useRef` 在 `start()` 时 new 全新 `RouteRecognizer` / `LiveFeaturePump` / `SensorRecorder`,不实现 reset。
4. **WorkoutSetup 独立页面**:用户已确认。
5. **状态机纯函数**:`workoutReducer` 无副作用,副作用在 `useClimbWorkout`。
6. **容器页面不跨页导航**:`ClimbWorkout.tsx` 内部按 phase 切换子视图,避免导航栈膨胀。
7. **检查点不恢复半轮特征**:ascending 被杀后当前轮标记 interrupted,从下一轮重新开始。
8. **目标不在楼梯中途停止**:floors/ascent/duration 达标仅提示,让用户完成当前楼段或轮。
9. **海报依赖**:`react-native-view-shot` 是 P2 唯一新增依赖。
10. **趋势图无新依赖**:纯 SVG/View 实现。

### 4.2 假设

- expo SDK 57(AGENTS.md 指定)支持 `react-native-view-shot`
- `AsyncStorage` 存储上限 100 条 workout 与现有 100 条 session 并存足够
- 用户设备气压计可用性不影响主流程(已有降级策略)
- `WorkoutGoal` 等复杂路由参数可通过 NativeStack 序列化传递(都是基本类型/小对象)

### 4.3 风险与缓解

- **风险**:多轮状态下 `useClimbRoundSession` 重挂载时机不对,导致传感器泄漏。**缓解**:`useEffect` cleanup 严格 `recorder.stop()`,并在 `useClimbWorkout` 中通过 `phase === 'ascending'` 条件挂载子组件强制重挂。
- **风险**:检查点恢复后状态不一致。**缓解**:不恢复半轮,只恢复已完成轮次与 phase,从 `round_ready` 重新开始。
- **风险**:旧 backup 文件无 workouts 字段。**缓解**:`importRawData` 容错,缺失视为空数组。

---

## 五、验证步骤

### 5.1 类型与构建

```bash
npx tsc --noEmit
```
0 错误。

### 5.2 P0 验证

- 单元测试(可选,若时间允许):
  - `calculateWorkoutSummary` 给定 3 轮数据,汇总字段正确
  - `workoutReducer` 各 action 转换正确
  - `RouteRecognizer.finish` 净用时扣除中断
- 手动验证:
  - 完成 1 轮后不跳 Result,进入 round_complete
  - 点击"开始返回1F"进 returning,传感器停止
  - 点击"我已回到1F"进 recovering
  - 点击"开始下一轮"进 countdown → ascending,新一轮步数从 0 开始
  - 第 2 轮不继承第 1 轮的 observed frames / totalSteps / segmentIndex

### 5.3 P1 验证

- 顶部训练维度条显示当前轮 + 累计数据
- 返回起点界面不显示"正在前往16F"
- 恢复界面显示上一轮成绩与累计爬升
- 完成训练后 WorkoutResult 显示整次训练汇总 + 轮次排名
- History 显示 Workout 卡片,旧 session 显示"单轮记录"
- App 杀死后重启弹"发现未结束的训练"弹窗

### 5.4 P2 验证

- 气压辅助:`returning` 阶段接近起点时进入 start_confirmation
- 趋势图:WorkoutResult 显示轮次用时趋势
- 目标:目标 3 轮,完成第 3 轮后提示"目标已完成",可选继续加练
- 海报:WorkoutResult 生成海报可分享
- ClimbPreview:各场景按钮切换正常

### 5.5 多轮验收清单(对照需求文档第二十三节)

数据模型、状态流程、页面、指标、稳定性各项逐条核对(见需求文档清单)。

---

## 六、实施顺序

严格按 P0 → P1 → P2,每个 P 内部按依赖顺序:

**P0**(必须先完成,否则后续无意义):
1. P0-1 类型扩展
2. P0-2 workout-summary.ts
3. P0-3 workout-machine.ts
4. P0-4 workout-storage.ts
5. P0-7 recognizer/sensor/types 修复(可与 P0-1 并行)
6. P0-5 useClimbRoundSession hook
7. P0-6 useClimbWorkout hook

**P1**:
1. P1-6 导航类型 + App.tsx + RouteEdit 改造
2. P1-1 WorkoutSetup 页
3. P1-3 WorkoutHeader 组件
4. P1-4 RoundCompleteAnimation + RoundTrack 组件
5. P1-5 ReturningView + RecoveringView 组件
6. P1-2 ClimbWorkout 容器页(组装上述)
7. P1-7 AppState 检查点
8. P1-8 WorkoutResult 页
9. P1-9 History 改造
10. Validate.tsx 改用 hook
11. 删除 Climb.tsx

**P2**:
1. P2-1 气压辅助
2. P2-3 目标完成逻辑
3. P2-2 RoundTrendChart 组件
4. P2-4 海报(含依赖安装)
5. P2-5 ClimbPreview 页

---

## 七、文件清单总览

### 新建文件(17 个)

| 文件 | 阶段 | 用途 |
|---|---|---|
| src/core/workout-summary.ts | P0 | 汇总纯函数 |
| src/core/workout-machine.ts | P0 | 状态机 reducer |
| src/services/workout-storage.ts | P0 | 训练持久化 |
| src/hooks/useClimbRoundSession.ts | P0 | 单轮识别 hook |
| src/hooks/useClimbWorkout.ts | P0 | 多轮训练 hook |
| src/pages/WorkoutSetup.tsx | P1 | 训练目标设置 |
| src/pages/ClimbWorkout.tsx | P1 | 多轮容器页 |
| src/pages/WorkoutResult.tsx | P1 | 多轮成绩页 |
| src/pages/ClimbPreview.tsx | P2 | 开发预览 |
| src/components/WorkoutHeader.tsx | P1 | 顶部训练维度 |
| src/components/RoundTrack.tsx | P1 | 轮次轨道 |
| src/components/RoundCompleteAnimation.tsx | P1 | 轮次完成动画 |
| src/components/ReturningView.tsx | P1 | 返回起点视觉 |
| src/components/RecoveringView.tsx | P1 | 恢复控制台 |
| src/components/RoundTrendChart.tsx | P2 | 轮次趋势 SVG |
| src/components/WorkoutPoster.tsx | P2 | 训练海报 |
| .trae/documents/multi-round-workout-refactor.md | — | 本计划 |

### 修改文件(8 个)

| 文件 | 阶段 | 变更 |
|---|---|---|
| src/core/types.ts | P0 | 追加 Workout 系列类型 + SensorRecorderOptions.lowPowerMode |
| src/core/recognizer.ts | P0 | finish 净用时扣除中断 |
| src/services/sensor.ts | P0 | lowPowerMode 选项 |
| src/services/storage.ts | P0 | BackupPayload 加 workouts |
| src/navigation/types.ts | P1/P2 | 新路由 + ClimbPreview |
| App.tsx | P1/P2 | 注册新路由 + 启动检查点 + 删除 Climb |
| src/pages/RouteEdit.tsx | P1 | 跳 WorkoutSetup |
| src/pages/Validate.tsx | P1 | 改用 useClimbRoundSession |
| src/pages/Result.tsx | P1 | "再爬一次"重定向 |
| src/pages/History.tsx | P1 | HistoryItem 联合类型 |
| src/pages/Settings.tsx | P2 | __DEV__ 预览入口 |
| src/services/backup.ts | P0 | 导出导入 workouts |

### 删除文件(1 个)

| 文件 | 阶段 |
|---|---|
| src/pages/Climb.tsx | P1 末尾 |

### 新增依赖(1 个,仅 P2)

- `react-native-view-shot`(海报截图)
