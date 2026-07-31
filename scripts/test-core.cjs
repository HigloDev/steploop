// 核心纯函数单元测试（node:test，零依赖）。
// 依赖 src/core 编译产物，默认从 node_modules/.cache/steploop-core 加载。
// 运行：npm run test

const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const compiledRoot =
  process.argv[2] ||
  path.join(__dirname, '..', 'node_modules', '.cache', 'steploop-core')

function load(module) {
  return require(path.join(compiledRoot, `${module}.js`))
}

// === floors：楼层口径 ===
test('floors: 1层到15层为14段真实爬升、15层成绩', () => {
  const { getFloorTransitionCount, getFloorAchievementCount } = load('floors')
  assert.equal(getFloorTransitionCount(1, 15), 14)
  assert.equal(getFloorAchievementCount(1, 15), 15)
  assert.equal(getFloorTransitionCount(5, 5), 0)
  assert.equal(getFloorAchievementCount(5, 5), 0)
})

// === workout-machine：状态流转 ===
test('workout-machine: 完整状态流转', () => {
  const { workoutReducer, INITIAL_WORKOUT_STATE } = load('workout-machine')
  let s = INITIAL_WORKOUT_STATE
  assert.equal(s.phase, 'setup')

  s = workoutReducer(s, { type: 'START_WORKOUT' })
  assert.equal(s.phase, 'round_ready')
  assert.equal(s.currentRoundNumber, 1)

  s = workoutReducer(s, { type: 'BEGIN_ASCENDING' })
  assert.equal(s.phase, 'ascending')

  s = workoutReducer(s, { type: 'ROUND_COMPLETE' })
  assert.equal(s.phase, 'round_complete')

  s = workoutReducer(s, { type: 'BEGIN_RETURNING' })
  assert.equal(s.phase, 'returning')
  assert.ok(s.returningSince)

  s = workoutReducer(s, { type: 'NEAR_START' })
  assert.equal(s.phase, 'start_confirmation')

  s = workoutReducer(s, { type: 'CONFIRM_RETURNED' })
  assert.equal(s.phase, 'recovering')
  assert.ok(s.recoveringSince)

  s = workoutReducer(s, { type: 'START_NEXT_ROUND' })
  assert.equal(s.phase, 'round_ready')
  assert.equal(s.currentRoundNumber, 2)

  s = workoutReducer(s, { type: 'FINISH_WORKOUT' })
  assert.equal(s.phase, 'workout_complete')
})

test('workout-machine: 非法流转被拒绝', () => {
  const { workoutReducer, INITIAL_WORKOUT_STATE } = load('workout-machine')
  let s = INITIAL_WORKOUT_STATE
  s = workoutReducer(s, { type: 'ROUND_COMPLETE' })
  assert.equal(s.phase, 'setup', 'setup 阶段不能 ROUND_COMPLETE')
  s = workoutReducer(s, { type: 'BEGIN_RETURNING' })
  assert.equal(s.phase, 'setup', 'setup 阶段不能 BEGIN_RETURNING')

  s = { ...s, phase: 'round_ready', currentRoundNumber: 1 }
  s = workoutReducer(s, { type: 'BEGIN_RETURNING' })
  assert.equal(s.phase, 'round_ready', 'round_ready 不能直接返回')
  s = workoutReducer(s, { type: 'ROUND_COMPLETE' })
  assert.equal(s.phase, 'round_ready', 'round_ready 不能 ROUND_COMPLETE')
  s = workoutReducer(s, { type: 'START_NEXT_ROUND' })
  assert.equal(s.phase, 'round_ready', 'round_ready 不能 START_NEXT_ROUND')
})

test('workout-machine: FINISH_WORKOUT 覆盖所有进行中阶段', () => {
  const { workoutReducer } = load('workout-machine')
  for (const phase of ['round_ready', 'ascending', 'round_complete', 'returning', 'start_confirmation', 'recovering']) {
    const s = workoutReducer({ phase, currentRoundNumber: 1 }, { type: 'FINISH_WORKOUT' })
    assert.equal(s.phase, 'workout_complete', `${phase} 应可结束`)
  }
  const done = workoutReducer(
    { phase: 'workout_complete', currentRoundNumber: 3 },
    { type: 'FINISH_WORKOUT' },
  )
  assert.equal(done.phase, 'workout_complete', '已完成训练不重复结束')
})

// === workout-summary：汇总派生 ===
function makeRound(roundNumber, durationMs, complete = true) {
  return {
    id: `round-${roundNumber}`,
    roundNumber,
    startedAt: 0,
    endedAt: durationMs,
    durationMs,
    startFloor: 1,
    targetFloor: 16,
    finalFloor: 16,
    floorsCompleted: 15,
    ascentM: 48,
    steps: 490,
    confidence: 0.92,
    complete,
    completionReason: complete ? 'route_complete' : 'manual_finish',
    floorSplits: [],
    events: [],
    interruptions: [],
  }
}

test('workout-summary: 汇总字段正确派生', () => {
  const { calculateWorkoutSummary } = load('workout-summary')
  const summary = calculateWorkoutSummary(
    [makeRound(1, 275000), makeRound(2, 268000), makeRound(3, 264000)],
    1_000_000,
    1_000_000 + 900_000,
  )
  assert.equal(summary.totalRounds, 3)
  assert.equal(summary.completeRounds, 3)
  assert.equal(summary.totalFloors, 48)
  assert.equal(summary.totalAscentM, 144)
  assert.equal(summary.totalSteps, 1470)
  assert.equal(summary.activeDurationMs, 807000)
  assert.equal(summary.bestRoundMs, 264000)
  assert.equal(summary.worstRoundMs, 275000)
  assert.equal(summary.averageRoundMs, 269000)
  assert.equal(summary.latestRoundMs, 264000)
  assert.equal(summary.totalElapsedMs, 900000)
  // 前后半程按原始轮序切分：先 275s 轮，后 268s/264s 两轮
  assert.equal(summary.firstHalfAvgMs, 275000)
  assert.equal(summary.secondHalfAvgMs, 266000)
  assert.equal(summary.secondHalfDeclinePct, -3)
  assert.ok(typeof summary.coefficientOfVariation === 'number')
})

test('workout-summary: 未完成轮不参与最快/最慢统计', () => {
  const { calculateWorkoutSummary } = load('workout-summary')
  const summary = calculateWorkoutSummary(
    [makeRound(1, 275000), makeRound(2, 268000, false), makeRound(3, 264000)],
    0,
  )
  assert.equal(summary.completeRounds, 2)
  assert.equal(summary.bestRoundMs, 264000)
  assert.equal(summary.worstRoundMs, 275000)
  assert.equal(summary.averageRoundMs, 269500)
})

test('workout-summary: 目标检测', () => {
  const { checkGoalReached } = load('workout-summary')
  const summary = { completeRounds: 3, totalFloors: 45, totalAscentM: 144, activeDurationMs: 900000 }
  assert.ok(checkGoalReached(summary, { type: 'open' }).reached === false)
  assert.equal(checkGoalReached(summary, { type: 'rounds', targetRounds: 3 }).reached, true)
  assert.equal(checkGoalReached(summary, { type: 'rounds', targetRounds: 5 }).reached, false)
  assert.equal(checkGoalReached(summary, { type: 'floors', targetFloors: 45 }).reached, true)
  assert.equal(checkGoalReached(summary, { type: 'ascent', targetAscentM: 144 }).reached, true)
  assert.equal(
    checkGoalReached(summary, { type: 'duration', targetActiveDurationMs: 900000 }).reached,
    true,
  )
})

test('workout-summary: 中断轮构造不污染汇总', () => {
  const { buildInterruptedRound } = load('workout-summary')
  const template = {
    id: 'r', name: 't', startFloor: 1, endFloor: 16, floorHeightM: 3, totalAscentM: 45,
    carryMode: 'pocket', device: { platform: 'a', model: 'm', system: 's' },
    segments: [], markers: [], createdAt: 0, updatedAt: 0, version: 1, status: 'verified',
  }
  const round = buildInterruptedRound(
    { currentRoundNumber: 2, savedAt: 5000, currentRoundStartedAt: 1000 },
    template,
  )
  assert.equal(round.roundNumber, 2)
  assert.equal(round.completionReason, 'interrupted')
  assert.equal(round.complete, false)
  assert.equal(round.durationMs, 0)
  assert.equal(round.steps, 0)
  assert.equal(round.ascentM, 0)
  assert.equal(round.floorsCompleted, 0)
  assert.equal(round.startedAt, 1000)
  assert.equal(round.endedAt, 5000)
  // 旧检查点无 currentRoundStartedAt 时用 savedAt 兜底
  const legacy = buildInterruptedRound(
    { currentRoundNumber: 1, savedAt: 9000 },
    template,
  )
  assert.equal(legacy.startedAt, 9000)
})

// === turn-gate：整拐合并 ===
test('turn-gate: 半圈不结算，方向反转结算上一拐', () => {
  const { StairTurnGate } = load('turn-gate')
  const gate = new StairTurnGate()
  gate.push({ startMs: 0, endMs: 500, steps: 4, cadence: 120, energy: 0.1, turnRad: 0.6, paused: 0 })
  assert.equal(gate.completedTurns, 0, '0.6rad 未达阈值')
  gate.push({ startMs: 500, endMs: 1000, steps: 4, cadence: 120, energy: 0.1, turnRad: 0.6, paused: 0 })
  assert.equal(gate.completedTurns, 0, '累计 1.2rad 仍未结算（无结束信号）')
  gate.push({ startMs: 1000, endMs: 1500, steps: 4, cadence: 120, energy: 0.1, turnRad: -1.2, paused: 0 })
  assert.equal(gate.completedTurns, 1, '方向反转应结算前一整拐')
  gate.push({ startMs: 1500, endMs: 2000, steps: 0, cadence: 0, energy: 0.05, turnRad: 0, paused: 1 })
  assert.equal(gate.completedTurns, 2, '结束帧应结算第二个整拐')
  gate.reset()
  assert.equal(gate.completedTurns, 0, 'reset 后归零')
})

// === analysis：帧提取与气压边界 ===
test('analysis: extractFrames 产生 500ms 帧并检测步数', () => {
  const { extractFrames } = load('analysis')
  // 站立基线 az=1（重力）；每 600ms 一次 60ms 的 1.6g 纵向冲击模拟一步，
  // 间隔大于步态冷却 260ms，保证每步独立检出
  const samples = []
  const now = 10_000
  const STEP_T = [100, 700, 1300, 1900]
  for (let t = 0; t < 2200; t += 20) {
    const inBurst = STEP_T.some((st) => t >= st && t < st + 60)
    samples.push({
      t: now + t,
      ax: 0,
      ay: 0,
      az: inBurst ? 1.6 : 1,
      gx: 0,
      gy: 0,
      gz: 0,
      alpha: 0,
      beta: 0,
      gamma: 0,
    })
  }
  const frames = extractFrames(samples)
  assert.ok(frames.length >= 4, `应有至少 4 帧，实际 ${frames.length}`)
  const totalSteps = frames.reduce((sum, f) => sum + f.steps, 0)
  assert.equal(totalSteps, 4, '4 次冲击应检出 4 步')
  assert.ok(frames.every((f) => f.endMs > f.startMs), '帧时间递增')
})

test('analysis: 气压楼层边界检测', () => {
  const { detectFloorBoundariesByPressure } = load('analysis')
  // 模拟连续 5Hz 气压，每 2 秒降 0.36hPa（约一层楼）
  const samples = []
  for (let i = 0; i < 40; i += 1) {
    const floor = Math.floor(i / 10)
    samples.push({ t: i * 200, pressure: 1000 - floor * 0.36 })
  }
  const boundaries = detectFloorBoundariesByPressure(samples)
  assert.ok(boundaries.length >= 3, `应检出至少 2 次楼层变化，实际 ${boundaries.length}`)
  // 气压不足时返回空
  const few = detectFloorBoundariesByPressure(samples.slice(0, 5))
  assert.deepEqual(few, [], '气压样本不足应返回空数组')
})

test('analysis: 气压反算爬升', () => {
  const { estimateAscentByPressure } = load('analysis')
  const samples = []
  for (let i = 0; i < 30; i += 1) {
    samples.push({ t: i * 200, pressure: 1000 - (i / 30) * 0.36 })
  }
  const ascent = estimateAscentByPressure(samples)
  assert.ok(ascent !== null && ascent > 0, '应反算出正向爬升')
  const noBaro = estimateAscentByPressure([{ t: 0, ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0 }])
  assert.equal(noBaro, null, '无气压数据返回 null')
})
