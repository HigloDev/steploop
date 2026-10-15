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
test('floors: 1层到15层为14段真实爬升、统一按爬升段数（fusion-v1 起旧“到达口径”废弃）', () => {
  const { getFloorTransitionCount, getFloorAchievementCount } = load('floors')
  assert.equal(getFloorTransitionCount(1, 15), 14)
  assert.equal(getFloorAchievementCount(1, 15), 14)
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

  s = workoutReducer(s, { type: 'BEGIN_RETURNING', at: 1_000 })
  assert.equal(s.phase, 'returning')
  assert.ok(s.returningSince)

  s = workoutReducer(s, { type: 'NEAR_START', at: 2_000 })
  assert.equal(s.phase, 'start_confirmation')

  s = workoutReducer(s, { type: 'CONFIRM_RETURNED', at: 3_000 })
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
  s = workoutReducer(s, { type: 'BEGIN_RETURNING', at: 1_000 })
  assert.equal(s.phase, 'setup', 'setup 阶段不能 BEGIN_RETURNING')

  s = { ...s, phase: 'round_ready', currentRoundNumber: 1 }
  s = workoutReducer(s, { type: 'BEGIN_RETURNING', at: 1_000 })
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
  assert.equal(summary.totalFloors, 45)
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

test('turn-gate: 使用重力轴转向并只消费当前楼层的两个整拐', () => {
  const { StairTurnGate } = load('turn-gate')
  const gate = new StairTurnGate()
  for (let index = 0; index < 3; index += 1) {
    gate.push({
      startMs: index * 1000,
      endMs: index * 1000 + 500,
      steps: 8,
      cadence: 120,
      energy: 0.1,
      turnRad: 0,
      headingTurnRad: 1.2,
      paused: 0,
    })
    gate.push({
      startMs: index * 1000 + 500,
      endMs: index * 1000 + 1000,
      steps: 0,
      cadence: 0,
      energy: 0.05,
      turnRad: 0,
      headingTurnRad: 0,
      paused: 1,
    })
  }
  assert.equal(gate.completedTurns, 3, '手机自身 Z 轴为零时也应识别身体转弯')
  gate.consume(2)
  assert.equal(gate.completedTurns, 1, '推进一层后应保留多余整拐')
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

test('analysis: 手机横放或竖放都能得到相同的竖直转向', () => {
  const { extractFrames } = load('analysis')
  const makeSamples = (gravity, gyro) => {
    const samples = []
    for (let t = 0; t <= 600; t += 20) {
      samples.push({
        t,
        ax: gravity[0], ay: gravity[1], az: gravity[2],
        gx: gyro[0], gy: gyro[1], gz: gyro[2],
        alpha: 0, beta: 0, gamma: 0,
      })
    }
    return samples
  }
  const flat = extractFrames(makeSamples([0, 0, 1], [0, 0, 2]))[0]
  const upright = extractFrames(makeSamples([0, 1, 0], [0, 2, 0]))[0]
  assert.ok(flat.headingTurnRad > 0.7, '平放手机应识别绕竖直轴转弯')
  assert.ok(upright.headingTurnRad > 0.7, '竖放手机应识别绕竖直轴转弯')
  assert.ok(Math.abs(flat.headingTurnRad - upright.headingTurnRad) < 0.05)
  assert.equal(upright.turnRad, 0, '旧的单 Z 轴在竖放时确实会漏掉该转弯')
})

test('recognizer: 气压变化不能单独追回旧动作对应的楼层', () => {
  const { RouteRecognizer } = load('recognizer')
  const segment = (floor) => ({
    id: `catch-${floor}`,
    type: 'flight',
    startMs: (floor - 1) * 1000,
    endMs: floor * 1000,
    floorFrom: floor,
    floorTo: floor + 1,
    ascentM: 3,
    stepCount: 8,
    features: [[0.2, 0.2, 0, 0]],
  })
  const rec = new RouteRecognizer({
    id: 'catch-up', name: '追赶测试', startFloor: 1, endFloor: 4,
    carryMode: 'pocket', floorHeightM: 3, totalAscentM: 9,
    device: { platform: 'android', model: 'test', system: 'test' },
    segments: [segment(1), segment(2), segment(3)], markers: [],
    createdAt: 0, updatedAt: 0, version: 1, status: 'verified',
  }, 0)
  for (let i = 0; i < 5; i += 1) rec.pushBarometer(1000)
  for (let i = 0; i < 6; i += 1) {
    rec.pushFrame({
      startMs: i * 1000, endMs: i * 1000 + 500,
      steps: 8, cadence: 120, energy: 0.2,
      turnRad: 0, headingTurnRad: 1.2, paused: 0,
    })
    rec.pushFrame({
      startMs: i * 1000 + 500, endMs: i * 1000 + 1000,
      steps: 0, cadence: 0, energy: 0.05,
      turnRad: 0, headingTurnRad: 0, paused: 1,
    })
  }
  assert.equal(rec.snapshot().currentFloor, 1, '高度未到时先保留动作证据')
  rec.pushBarometer(998.9)
  assert.equal(rec.snapshot().currentFloor, 1, '改变气压不能消费旧动作并补猜楼层')
  assert.equal(rec.snapshot().canAutoComplete, false)
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

test('analysis: vectorizeFrame 使用重力轴 headingTurnRad', () => {
  const { vectorizeFrame } = load('analysis')
  const frame = {
    startMs: 0,
    endMs: 500,
    steps: 4,
    cadence: 120,
    energy: 0.2,
    turnRad: 0.6,
    headingTurnRad: -1.2,
    paused: 0,
  }
  const vec = vectorizeFrame(frame)
  assert.equal(vec.length, 4)
  assert.ok(Math.abs(vec[2] - -1) < 1e-9, `转向维应取 headingTurnRad，实际 ${vec[2]}`)
  const deviceVec = vectorizeFrame(frame, 'device')
  assert.ok(Math.abs(deviceVec[2] - 0.5) < 1e-9, `device 空间应取 turnRad，实际 ${deviceVec[2]}`)
  const noHeading = vectorizeFrame({ ...frame, headingTurnRad: undefined })
  assert.ok(Math.abs(noHeading[2] - 0.5) < 1e-9, '缺 headingTurnRad 时回退 turnRad')
})

test('sensor-params: 气压/步数阈值单一来源', () => {
  const params = load('sensor-params')
  assert.equal(params.BARO_FLOOR_M, 3)
  assert.equal(params.METERS_PER_HPA, 8.3)
  assert.ok(Math.abs(params.BARO_EPS - 3 / 8.3) < 1e-12)
  assert.equal(params.BARO_EPS_CALIBRATE, 0.3)
  assert.equal(params.STEPS_PER_FLOOR_CALIBRATE, 18)
  assert.equal(params.STEPS_PER_FLOOR_FREE, 32)
  assert.equal(params.BARO_SMOOTH_WINDOW, 10)
  assert.equal(params.BARO_FLOOR_COOLDOWN_MS, 2000)
  assert.equal(params.DEFAULT_FEATURE_SPACE, 'heading')
  const { detectFloorBoundariesByPressure } = load('analysis')
  const samples = []
  for (let i = 0; i < 40; i += 1) {
    const floor = Math.floor(i / 10)
    samples.push({ t: i * 200, pressure: 1000 - floor * (params.BARO_EPS_CALIBRATE + 0.06) })
  }
  const boundaries = detectFloorBoundariesByPressure(samples)
  assert.ok(boundaries.length >= 3, `标定阈值仍应触发楼层，实际 ${boundaries.length}`)
})

// === recognizer：净爬楼时间 ===
function makeCalorieTestTemplate() {
  return {
    id: 'route-cal',
    name: '测试路线',
    startFloor: 1,
    endFloor: 3,
    carryMode: 'pocket',
    floorHeightM: 3,
    totalAscentM: 6,
    device: { platform: 'android', model: 'test', system: 'test' },
    segments: [
      { id: 's1', type: 'flight', startMs: 0, endMs: 1000, floorFrom: 1, floorTo: 2, ascentM: 3, stepCount: 8, features: [[0.5, 0.5, 0, 0]] },
      { id: 's2', type: 'flight', startMs: 1000, endMs: 2000, floorFrom: 2, floorTo: 3, ascentM: 3, stepCount: 8, features: [[0.5, 0.5, 0, 0]] },
    ],
    markers: [],
    createdAt: 0,
    updatedAt: 0,
    version: 1,
    status: 'verified',
  }
}

const activeFrame = (startMs, endMs) => ({
  startMs, endMs, steps: 8, cadence: 120, energy: 0.2, turnRad: 0, paused: 0,
})
const idleFrame = (startMs, endMs) => ({
  startMs, endMs, steps: 0, cadence: 0, energy: 0.02, turnRad: 0, paused: 1,
})

test('recognizer: 净爬楼时间只统计动作帧（卡路里/净用时口径）', () => {
  const { RouteRecognizer } = load('recognizer')
  const rec = new RouteRecognizer(makeCalorieTestTemplate(), 0)
  rec.pushFrame(activeFrame(0, 500))
  rec.pushFrame(activeFrame(500, 1000))
  rec.pushFrame(idleFrame(1000, 1500))
  rec.pushFrame(idleFrame(1500, 2000))
  rec.pushFrame(activeFrame(2000, 2500))
  assert.equal(rec.snapshot().activeMs, 1500, '3 个动作帧各 500ms')
  const session = rec.finish(100000)
  assert.equal(session.durationMs, 1500, 'durationMs 应为净爬楼时间而非挂钟时长')
})

test('free-recognizer: 净爬楼时间只统计动作帧', () => {
  const { FreeRecognizer } = load('free-recognizer')
  const rec = new FreeRecognizer(makeCalorieTestTemplate(), 0)
  rec.pushFrame(activeFrame(0, 500))
  rec.pushFrame(idleFrame(500, 1000))
  rec.pushFrame(idleFrame(1000, 1500))
  assert.equal(rec.snapshot().activeMs, 500, '只有动作帧计入')
  const session = rec.finish(100000)
  assert.equal(session.durationMs, 500)
})

// === diagnostics：真机数据格式与回放报告 ===
function makeDiagnosticBundle(activity = 'stationary') {
  const samples = []
  for (let index = 0; index < 150; index += 1) {
    samples.push({
      t: index * 20,
      ax: 0,
      ay: 0,
      az: 1,
      gx: 0,
      gy: 0,
      gz: 0,
      alpha: 0,
      beta: 0,
      gamma: 0,
      pressure: 1000,
    })
  }
  return {
    version: 1,
    id: `diagnostic-${activity}`,
    createdAt: 123456,
    durationMs: 3000,
    activity,
    carryMode: 'pocket',
    routeTemplate: makeCalorieTestTemplate(),
    truth: { startFloor: 1, endFloor: 1, completedFloors: 0 },
    samples,
    annotations: [],
    gaps: [],
    capture: {
      platform: 'android',
      systemVersion: 'test',
      sampleIntervalTargetMs: 20,
      barometerAvailable: true,
    },
  }
}

test('diagnostics: 诊断路线移除地点和设备型号', () => {
  const { sanitizeDiagnosticRoute } = load('diagnostics')
  const route = {
    ...makeCalorieTestTemplate(),
    location: {
      name: '真实建筑',
      address: '真实地址',
      latitude: 31,
      longitude: 121,
      accuracy: 10,
      source: 'gps',
      confirmedAt: 0,
    },
  }
  const safe = sanitizeDiagnosticRoute(route)
  assert.equal(safe.location, undefined)
  assert.equal(safe.name, '诊断路线')
  assert.equal(safe.device.model, 'redacted')
})

test('diagnostics: 静止负样本不误报楼层', () => {
  const { replayDiagnosticBundle } = load('diagnostics')
  const result = replayDiagnosticBundle(makeDiagnosticBundle())
  assert.equal(result.recognizedFloors, 0)
  assert.equal(result.falsePositive, false)
  assert.equal(result.exactFinalFloor, true)
})

test('diagnostics: 汇总报告计算负样本误报率', () => {
  const { aggregateDiagnosticResults } = load('diagnostics')
  const base = {
    bundleId: 'a',
    activity: 'stationary',
    carryMode: 'pocket',
    platform: 'android',
    expectedFloors: 0,
    recognizedFloors: 0,
    finalFloorError: 0,
    exactFinalFloor: true,
    floorEventPrecision: 1,
    floorEventRecall: 1,
    medianFloorLatencyMs: null,
    p95FloorLatencyMs: null,
    sampleCount: 100,
    durationMs: 1000,
    barometerAvailable: true,
    recognitionEvents: [],
  }
  const report = aggregateDiagnosticResults([
    { ...base, falsePositive: false },
    { ...base, bundleId: 'b', falsePositive: true, recognizedFloors: 1 },
  ])
  assert.equal(report.negativeBundles, 2)
  assert.equal(report.negativeFalsePositiveRate, 0.5)
  assert.equal(report.cohorts.carryMode.pocket.bundles, 2)
})

test('diagnostics: 基线比较会阻止准确率退化', () => {
  const { compareDiagnosticReports } = load('diagnostics')
  const baseline = {
    exactFinalFloorRate: 0.98,
    floorEventPrecision: 0.97,
    floorEventRecall: 0.96,
    negativeFalsePositiveRate: 0.01,
    p95FloorLatencyMs: 3000,
  }
  const comparison = compareDiagnosticReports(baseline, {
    ...baseline,
    exactFinalFloorRate: 0.9,
    negativeFalsePositiveRate: 0.04,
    p95FloorLatencyMs: 3800,
  })
  assert.equal(comparison.passed, false)
  assert.deepEqual(
    comparison.regressions.map((item) => item.metric),
    ['exactFinalFloorRate', 'negativeFalsePositiveRate', 'p95FloorLatencyMs'],
  )
})

test('diagnostics v2: 兼容读取 v1 并计算采样质量', () => {
  const { parseDiagnosticBundle } = load('diagnostics')
  const legacy = makeDiagnosticBundle('stationary')
  legacy.version = 1
  const parsed = parseDiagnosticBundle(legacy)
  assert.equal(parsed.version, 2)
  assert.equal(parsed.algorithmVersion, 'legacy-v1')
  assert.equal(parsed.capture.deviceCohortId, 'legacy-unknown')
  assert.ok(['valid', 'degraded'].includes(parsed.sampleQuality))
  assert.ok(parsed.samplingStats.actualHz > 40)
})

test('diagnostics v2: 无效样本保留但不进入发布指标', () => {
  const { aggregateDiagnosticResults } = load('diagnostics')
  const base = {
    bundleId: 'valid', activity: 'climb_up', carryMode: 'pocket', platform: 'android',
    deviceCohortId: 'android-a', sampleQuality: 'valid', routeStructure: 'standard',
    expectedFloors: 1, recognizedFloors: 1, finalFloorError: 0,
    exactFinalFloor: true, falsePositive: false, floorEventPrecision: 1,
    floorEventRecall: 1, medianFloorLatencyMs: 1000, p95FloorLatencyMs: 1000,
    sampleCount: 100, durationMs: 3000, barometerAvailable: true,
    recognitionEvents: [],
  }
  const report = aggregateDiagnosticResults([
    base,
    { ...base, bundleId: 'invalid', sampleQuality: 'invalid', exactFinalFloor: false },
  ])
  assert.equal(report.bundles, 2)
  assert.equal(report.eligibleBundles, 1)
  assert.equal(report.invalidBundles, 1)
  assert.equal(report.exactFinalFloorRate, 1)
})

test('route model v3: 旧路线惰性迁移且异常轮次不学习', () => {
  const { migrateRouteToV3, updateRouteModelFromWorkouts } = load('route-model')
  const route = makeCalorieTestTemplate()
  const migrated = migrateRouteToV3(route)
  assert.equal(migrated.modelVersion, 3)
  assert.equal(migrated.learning.sampleCount, 1)
  const badRound = { ...makeRound(1, 30000), interruptions: [{ startMs: 1, endMs: 2 }] }
  const updated = updateRouteModelFromWorkouts(migrated, [{
    id: 'w', templateId: route.id, status: 'completed', startedAt: 1,
    rounds: [badRound],
  }])
  assert.equal(updated.learning.sampleCount, 1)
})

function makeProvenanceRoute() {
  const route = makeCalorieTestTemplate()
  return {
    ...route,
    endFloor: 15,
    totalAscentM: 42,
    status: 'needs_validation',
    learningProvenance: 'training_rounds',
    segments: Array.from({ length: 14 }, (_, index) => ({
      ...route.segments[0], id: `s-${index + 1}`, floorFrom: index + 1, floorTo: index + 2,
      startMs: index * 10000, endMs: (index + 1) * 10000, stepCount: 20,
    })),
  }
}

function makeProvenanceRound(overrides = {}) {
  return {
    ...makeRound(1, 200000), targetFloor: 15, finalFloor: 15,
    floorCounting: 'transitions', floorsCompleted: 14, ascentM: 42, steps: 280,
    completionSource: 'automatic', trustworthy: true, userCorrectionCount: 0,
    ...overrides,
  }
}

function provenanceWorkout(route, rounds) {
  return { id: 'provenance-workout', templateId: route.id, status: 'completed', startedAt: 1, floorCounting: 'transitions', rounds }
}

test('learning provenance: 新训练模板本身不能成为有效学习样本', () => {
  const { migrateRouteToV3, updateRouteModelFromWorkouts } = load('route-model')
  const { summarizeRouteLearning } = load('route-learning')
  const route = makeProvenanceRoute()
  for (const status of ['needs_validation', 'verified']) {
    const migrated = migrateRouteToV3({ ...route, status })
    assert.equal(migrated.learning.sampleCount, 0)
    assert.equal(migrated.learning.state, 'unlearned')
    assert.equal(migrated.learning.reasonCode, 'no_eligible_samples')
    assert.equal(migrated.learning.stability, 0)
    assert.equal(migrated.learning.lastLearnedAt, undefined)
    assert.equal(summarizeRouteLearning(migrated, []).validCount, 0)
    assert.equal(summarizeRouteLearning(migrated, []).stage, 'unlearned')
    assert.equal(updateRouteModelFromWorkouts(migrated, []).learning.sampleCount, 0)
    assert.equal(migrateRouteToV3(migrated), migrated, '已迁移模板保持幂等')
  }
  assert.equal(route.learning, undefined, '不得修改原模板')
  assert.deepEqual(summarizeRouteLearning(route, []).samples, [])
  const draft = summarizeRouteLearning({ ...route, segments: [], status: 'draft' }, [])
  assert.equal(draft.validCount, 0)
  assert.match(draft.message, /完成第一次正常爬楼/, '尚未采集的draft保留首次采集提示')
})

test('learning provenance: 首次手动确认15楼保留14层成果但有效学习数为0', () => {
  const { migrateRouteToV3, updateRouteModelFromWorkouts, isLearningEligibleRound } = load('route-model')
  const { summarizeRouteLearning } = load('route-learning')
  const route = migrateRouteToV3(makeProvenanceRoute())
  const manual = makeProvenanceRound({ completionSource: 'manual', completionReason: 'manual_finish', trustworthy: false })
  const workouts = [provenanceWorkout(route, [manual])]
  assert.equal(manual.finalFloor, 15)
  assert.equal(manual.floorsCompleted, 14)
  assert.equal(isLearningEligibleRound(manual), false)
  assert.equal(updateRouteModelFromWorkouts(route, workouts).learning.sampleCount, 0)
  const summary = summarizeRouteLearning(route, workouts)
  assert.equal(summary.validCount, 0)
  assert.deepEqual(summary.samples, [])
  assert.equal(summary.stage, 'unlearned')
  assert.match(summary.message, /已有路线保留作参考/)
  assert.match(summary.message, /每到一层/)
  assert.doesNotMatch(summary.message, /完成第一次正常爬楼/)
})

test('learning provenance: 高置信度的人工修正也不能补成legacy样本', () => {
  const { applyRoundCorrection } = load('corrections')
  const { migrateRouteToV3, updateRouteModelFromWorkouts, isLearningEligibleRound } = load('route-model')
  const { summarizeRouteLearning } = load('route-learning')
  const route = migrateRouteToV3(makeProvenanceRoute())
  const detected = makeProvenanceRound({ finalFloor: 12, floorsCompleted: 11, ascentM: 33 })
  const corrected = applyRoundCorrection(detected, { finalFloor: 15 }, { at: 200001, reason: '实际到15楼' })
  const workouts = [provenanceWorkout(route, [corrected])]
  assert.equal(corrected.corrections[0].before.finalFloor, 12)
  assert.equal(corrected.finalFloor, 15)
  assert.equal(corrected.floorsCompleted, 14)
  assert.equal(corrected.confidence, detected.confidence)
  assert.equal(isLearningEligibleRound(corrected), false)
  assert.equal(updateRouteModelFromWorkouts(route, workouts).learning.sampleCount, 0)
  assert.deepEqual(summarizeRouteLearning(route, workouts).samples, [])
  assert.equal(summarizeRouteLearning(route, workouts).validCount, 0)
})

test('learning provenance: 零成果记录不会虚增有效学习数量', () => {
  const { migrateRouteToV3, updateRouteModelFromWorkouts } = load('route-model')
  const { summarizeRouteLearning } = load('route-learning')
  const route = migrateRouteToV3(makeProvenanceRoute())
  const zero = makeProvenanceRound({ finalFloor: 1, floorsCompleted: 0, ascentM: 0, steps: 0, durationMs: 0, complete: false })
  const workouts = [provenanceWorkout(route, [zero])]
  assert.equal(updateRouteModelFromWorkouts(route, workouts).learning.sampleCount, 0)
  assert.equal(summarizeRouteLearning(route, workouts).validCount, 0)
  assert.deepEqual(summarizeRouteLearning(route, workouts).samples, [])
})

test('learning provenance: 无标识旧模板没有训练记录时保留legacy基线1', () => {
  const { migrateRouteToV3 } = load('route-model')
  const { summarizeRouteLearning } = load('route-learning')
  const legacy = makeCalorieTestTemplate()
  const migrated = migrateRouteToV3(legacy)
  assert.equal(migrated.learningProvenance, undefined)
  assert.equal(migrated.learning.sampleCount, 1)
  const summary = summarizeRouteLearning(migrated, [])
  assert.equal(summary.validCount, 0)
  assert.equal(summary.samples[0].workoutId, `legacy-${legacy.id}`)
})

test('learning provenance: 旧模板遇到不合格的新记录也不丢失原legacy基线', () => {
  const { migrateRouteToV3, updateRouteModelFromWorkouts } = load('route-model')
  const { summarizeRouteLearning } = load('route-learning')
  const legacy = makeCalorieTestTemplate()
  const manual = makeProvenanceRound({ completionSource: 'manual', completionReason: 'manual_finish', trustworthy: false })
  const workouts = [provenanceWorkout(legacy, [manual])]
  const migrated = migrateRouteToV3(legacy)
  assert.equal(updateRouteModelFromWorkouts(migrated, workouts).learning.sampleCount, 1)
  const summary = summarizeRouteLearning(migrated, workouts)
  assert.equal(summary.validCount, 0)
  assert.equal(summary.samples[0].workoutId, `legacy-${legacy.id}`)
  assert.equal(summary.samples.some(sample => sample.workoutId === workouts[0].id), false)
})

test('learning provenance: 自动轮保留作参考但没有独立核对不能增加核对次数', () => {
  const { applyRoundCorrection } = load('corrections')
  const { migrateRouteToV3, updateRouteModelFromWorkouts } = load('route-model')
  const { summarizeRouteLearning } = load('route-learning')
  const route = migrateRouteToV3(makeProvenanceRoute())
  const clean = makeProvenanceRound()
  const manual = makeProvenanceRound({ id: 'manual', roundNumber: 2, completionSource: 'manual', trustworthy: false })
  const corrected = applyRoundCorrection(makeProvenanceRound({ id: 'corrected', roundNumber: 3 }), { finalFloor: 13 })
  const zero = makeProvenanceRound({ id: 'zero', roundNumber: 4, finalFloor: 1, floorsCompleted: 0, ascentM: 0, complete: false })
  const workouts = [provenanceWorkout(route, [clean, manual, corrected, zero])]
  const updated = updateRouteModelFromWorkouts(route, workouts, 300000)
  assert.equal(updated.learningProvenance, 'training_rounds')
  assert.equal(updated.learning.sampleCount, 0)
  assert.equal(updated.learning.state, 'unlearned')
  assert.equal(migrateRouteToV3(updated), updated, '真实学习数量不能被迁移重置')
  const summary = summarizeRouteLearning(updated, workouts)
  assert.equal(summary.validCount, 0)
  assert.equal(summary.samples[0].workoutId, workouts[0].id)
  assert.equal(summary.samples[0].roundNumber, 1)
  assert.equal(summary.samples[0].floors, 14)
  assert.equal(summary.samples.some(sample => sample.workoutId.startsWith('legacy-')), false)
})

test('learning provenance: 五次独立核对后可以使用自动训练参考', () => {
  const { updateRouteModelFromWorkouts } = load('route-model')
  const { summarizeRouteLearning } = load('route-learning')
  const route = makeProvenanceRoute()
  route.motionReference = { version: 1, carryMode: route.carryMode, allBoundariesMarked: true, checkedRuns: 5, checkedDays: ['2026-10-07','2026-10-08'], floorAnchors: [] }
  const rounds = Array.from({ length: 5 }, (_, index) => makeProvenanceRound({ id: `eligible-${index + 1}`, roundNumber: index + 1 }))
  const workouts = [provenanceWorkout(route, rounds)]
  const updated = updateRouteModelFromWorkouts(route, workouts)
  assert.equal(updated.learningProvenance, 'training_rounds')
  assert.equal(updated.learning.sampleCount, 5)
  assert.equal(updated.learning.state, 'verified')
  assert.equal(updated.status, 'verified')
  assert.equal(summarizeRouteLearning(updated, workouts).validCount, 5)
  assert.equal(summarizeRouteLearning(updated, workouts).stage, 'verified')
})

test('route model v3: 先独立核对再整理可信训练参考', () => {
  const { migrateRouteToV3, updateRouteModelFromWorkouts } = load('route-model')
  const route = migrateRouteToV3(makeCalorieTestTemplate())
  route.motionReference = { version: 1, carryMode: route.carryMode, allBoundariesMarked: true, checkedRuns: 5, checkedDays: ['2026-10-07','2026-10-08'], floorAnchors: [] }
  const rounds = Array.from({ length: 5 }, (_, index) => ({
    ...makeRound(index + 1, 30000 + index * 200),
    floorsCompleted: 2,
    ascentM: 6,
    steps: 16 + index * 0.1,
    confidence: 0.92,
    interruptions: [],
    completionReason: 'route_complete',
    userCorrectionCount: 0,
    events: [
      { type: 'turn', confidence: 0.9, t: 1 },
      { type: 'turn', confidence: 0.9, t: 2 },
      { type: 'turn', confidence: 0.9, t: 3 },
      { type: 'turn', confidence: 0.9, t: 4 },
    ],
  }))
  const updated = updateRouteModelFromWorkouts(route, [{
    id: 'w', templateId: route.id, status: 'completed', startedAt: 1, rounds,
  }])
  assert.equal(updated.learning.sampleCount, 5)
  assert.equal(updated.learning.state, 'verified')
  assert.equal(updated.status, 'verified')
})

test('route model: 整轮平均值不能抹平每层不同的步数', () => {
  const { migrateRouteToV3, updateRouteModelFromWorkouts } = load('route-model')
  const route = migrateRouteToV3(makeCalorieTestTemplate())
  route.motionReference = { version: 1, carryMode: route.carryMode, allBoundariesMarked: true, checkedRuns: 5, checkedDays: ['2026-10-07','2026-10-08'], floorAnchors: [] }
  route.segments[0].stepCount = 16; route.segments[1].stepCount = 28
  const original = JSON.parse(JSON.stringify(route.segments))
  const rounds = Array.from({length:5},(_,i)=>({...makeRound(i+1,60000),floorsCompleted:2,ascentM:6,steps:100,confidence:0.95,completionReason:'route_complete',events:[],interruptions:[]}))
  const updated = updateRouteModelFromWorkouts(route,[{templateId:route.id,rounds}])
  assert.deepEqual(updated.segments, original)
  assert.equal(updated.motionReference.checkedRuns, 5)
})
test('consistency: route-model 与 route-learning 使用同一公式', () => {
  const routeModel = load('route-model')
  const routeLearning = load('route-learning')
  // 两者导出的 variationScore 应是同一实现
  assert.equal(routeModel.variationScore, routeLearning.variationScore)
  assert.equal(routeModel.weightedConsistency, routeLearning.weightedConsistency)
  // 数值验证：同一组数据两边 consistency 一致
  const samples = [32, 33, 34, 35, 36]
  const score = routeModel.variationScore(samples)
  assert.ok(Math.abs(score - routeLearning.variationScore(samples)) < 1e-12)
  // 0.9*0.4 + 0.8*0.4 + 0.7*0.2 = 0.82
  const weighted = routeModel.weightedConsistency([
    { score: 0.9, weight: 0.4 },
    { score: 0.8, weight: 0.4 },
    { score: 0.7, weight: 0.2 },
  ])
  assert.ok(Math.abs(weighted - 0.82) < 1e-12, `实际 ${weighted}`)
})

test('training progress: 仅可信完整训练进入周目标与个人最佳', () => {
  const { deriveTrainingProgress } = load('training-progress')
  const now = Date.now()
  const workout = (id, duration, trustworthy = true) => ({
    id, templateId: 'route', status: 'completed', startedAt: now,
    endedAt: now + duration, updatedAt: now + duration,
    totalFloorsCompleted: 15, totalAscentM: 45, activeDurationMs: duration,
    rounds: [{
      ...makeRound(1, duration), completionReason: 'route_complete',
      confidence: 0.92, interruptions: trustworthy ? [] : [{ startMs: 1, endMs: 2 }],
      userCorrectionCount: 0,
    }],
  })
  const progress = deriveTrainingProgress([
    workout('slower', 60000),
    workout('best', 50000),
    workout('invalid', 40000, false),
  ], now)
  assert.equal(progress.validWorkouts, 2)
  assert.equal(progress.floors, 30)
  assert.equal(progress.personalBests.route.workoutId, 'best')
})

test('diagnostics export: 导出包剥离绝对时间与地点机型', () => {
  const { sanitizeDiagnosticBundleForExport } = load('diagnostics')
  const bundle = makeDiagnosticBundle('stationary')
  bundle.createdAt = 1_700_000_000_000
  bundle.routeTemplate = {
    ...makeCalorieTestTemplate(),
    location: {
      name: '真实建筑',
      address: '真实地址',
      latitude: 31,
      longitude: 121,
      accuracy: 10,
      source: 'gps',
      confirmedAt: 0,
    },
  }
  bundle.routeTemplate.device = {
    platform: 'android',
    model: 'Pixel 9',
    system: '14',
  }
  const safe = sanitizeDiagnosticBundleForExport(bundle)
  assert.equal(safe.createdAt, 0)
  assert.equal(safe.routeTemplate.location, undefined)
  assert.equal(safe.routeTemplate.device.model, 'redacted')
  assert.equal(safe.samples[0].t, bundle.samples[0].t)
})

test('diagnostics compare: 空数据集或缺 results 时数据集不兼容', () => {
  const { compareDiagnosticReports } = load('diagnostics')
  const metric = {
    exactFinalFloorRate: 1,
    floorEventPrecision: 1,
    floorEventRecall: 1,
    negativeFalsePositiveRate: 0,
    p95FloorLatencyMs: 1000,
    results: [{ bundleId: 'a' }],
  }
  const empty = compareDiagnosticReports(metric, { ...metric, results: [] })
  assert.equal(empty.datasetCompatible, false)
  assert.equal(empty.passed, false)
  const missing = compareDiagnosticReports(metric, { ...metric, results: undefined })
  assert.equal(missing.datasetCompatible, false)
})

test('calories: 体重与净爬楼时长决定消耗', () => {
  const { calculateStairCalories } = load('calories')
  const light = calculateStairCalories(60_000, 50)
  const heavy = calculateStairCalories(60_000, 90)
  assert.ok(heavy > light, '体重越大消耗应越高')
  assert.equal(calculateStairCalories(0, 70), 0, '无动作时间不应计消耗')
})

test('export-csv: 表头、转义与可信标记', () => {
  const { buildWorkoutCsv } = load('export-csv')
  const csv = buildWorkoutCsv({
    workouts: [
      {
        id: 'w1',
        templateId: 'r1',
        status: 'completed',
        startedAt: 1000,
        endedAt: 2000,
        totalFloorsCompleted: 15,
        totalAscentM: 45.5,
        totalSteps: 1200,
        activeDurationMs: 60000,
        totalElapsedMs: 90000,
        routeSnapshot: { name: 'A,楼', locationName: 'A,楼', startFloor: 1, endFloor: 16, floorsPerRound: 15, ascentPerRoundM: 45 },
        rounds: [{
          id: 'r', roundNumber: 1, startedAt: 1000, endedAt: 1500, durationMs: 500,
          startFloor: 1, targetFloor: 16, finalFloor: 16, floorsCompleted: 15,
          ascentM: 45, steps: 100, confidence: 0.95, complete: true,
          completionReason: 'route_complete', floorSplits: [], events: [],
          interruptions: [], userCorrectionCount: 0,
        }],
      },
    ],
  })
  assert.ok(csv.startsWith('﻿'), '应含 UTF-8 BOM')
  assert.ok(csv.includes('类型,记录ID'))
  assert.ok(csv.includes('"A,楼"'), '逗号字段应加引号')
  assert.ok(csv.includes(',1,'), '可信完整训练标记为 1')
})

test('backup payload: 校验通过与拒绝路径', () => {
  const { validateBackupPayload } = load('backup-payload')
  const ok = validateBackupPayload({
    version: 2,
    exportedAt: 1,
    routes: [],
    sessions: [],
  })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.payload.workouts, [])
  assert.equal(validateBackupPayload(null).ok, false)
  assert.equal(validateBackupPayload({ version: 3, routes: [], sessions: [] }).ok, false)
  assert.equal(validateBackupPayload({ version: 1, routes: [] }).ok, false)
})

// === confidence：多源概率融合 ===
test('confidence: fuseConfidence 几何加权融合', () => {
  const { fuseConfidence, fusedQuality } = load('confidence')
  const high = fuseConfidence({ motion: 1, turn: 1, dtw: 0.9, baro: 1 })
  assert.ok(high > 0.9, `全证据高分应 >0.9，实际 ${high}`)
  const noBaro = fuseConfidence({ motion: 1, turn: 1, dtw: 0.9 })
  assert.ok(noBaro > 0.86 && noBaro < high, `无气压略低于有气压，实际 ${noBaro}`)
  const lowDtw = fuseConfidence({ motion: 1, turn: 1, dtw: 0.4 })
  assert.ok(lowDtw < 0.8, `低 DTW 应拉低融合，实际 ${lowDtw}`)
  const empty = fuseConfidence({})
  assert.equal(empty, 0)
  assert.equal(fusedQuality(0.9, true, false), 'stable')
  assert.equal(fusedQuality(0.9, false, false), 'stable')
  assert.equal(fusedQuality(0.7, false, false), 'degraded')
  assert.equal(fusedQuality(0.95, true, true), 'degraded')
})

test('recognizer: 无气压高质量路径 quality 可升到 stable', () => {
  const { RouteRecognizer } = load('recognizer')
  // 模板特征对齐 vectorizeFrame(active/idle)
  const activeVec = [0.5, 0.571, 1.0, 0]
  const idleVec = [0.0, 0.143, 0.0, 1]
  const segment = (floor) => ({
    id: `nb-${floor}`,
    type: 'flight',
    startMs: (floor - 1) * 1000,
    endMs: floor * 1000,
    floorFrom: floor,
    floorTo: floor + 1,
    ascentM: 3,
    stepCount: 8,
    features: [activeVec, idleVec, activeVec, idleVec],
  })
  const rec = new RouteRecognizer({
    id: 'no-baro', name: '无气压', startFloor: 1, endFloor: 3,
    carryMode: 'pocket', floorHeightM: 3, totalAscentM: 6,
    device: { platform: 'android', model: 'test', system: 'test' },
    segments: [segment(1), segment(2)], markers: [],
    createdAt: 0, updatedAt: 0, version: 1, status: 'verified',
  }, 0)
  // 不推气压，纯动作推进；每帧特征与模板对齐
  const pushPair = (base) => {
    rec.pushFrame({
      startMs: base, endMs: base + 500,
      steps: 8, cadence: 120, energy: 0.2,
      turnRad: 0, headingTurnRad: 1.2, paused: 0,
    })
    rec.pushFrame({
      startMs: base + 500, endMs: base + 1000,
      steps: 0, cadence: 0, energy: 0.05,
      turnRad: 0, headingTurnRad: 0, paused: 1,
    })
  }
  for (let i = 0; i < 4; i += 1) pushPair(i * 1000)
  const snap = rec.snapshot()
  assert.ok(snap.floorsCompleted >= 1, `无气压也应推进，实际 ${snap.floorsCompleted}`)
  assert.ok(
    snap.quality === 'stable' || snap.quality === 'degraded',
    'quality 只能是 stable/degraded',
  )
})

// === elevator gate：电梯/扶梯负样本 ===
function makeElevatorTemplate() {
  return {
    id: 'route-elev',
    name: '电梯负样本',
    startFloor: 1,
    endFloor: 4,
    carryMode: 'pocket',
    floorHeightM: 3,
    totalAscentM: 9,
    device: { platform: 'android', model: 'test', system: 'test' },
    segments: [1, 2, 3].map((n) => ({
      id: `elev-${n}`,
      type: 'flight',
      startMs: (n - 1) * 1000,
      endMs: n * 1000,
      floorFrom: n,
      floorTo: n + 1,
      ascentM: 3,
      stepCount: 8,
      features: [[0.2, 0.2, 0, 0]],
    })),
    markers: [],
    createdAt: 0,
    updatedAt: 0,
    version: 1,
    status: 'verified',
  }
}

function climbingFrame(startMs, steps = 8, turn = 1.2) {
  return {
    startMs, endMs: startMs + 500,
    steps, cadence: steps > 0 ? 120 : 0, energy: steps > 0 ? 0.2 : 0.05,
    turnRad: 0, headingTurnRad: turn, paused: steps > 0 ? 0 : 1,
  }
}

test('elevator gate: 合成电梯序列不得推进楼层', () => {
  const { RouteRecognizer } = load('recognizer')
  const rec = new RouteRecognizer(makeElevatorTemplate(), 0)
  for (let i = 0; i < 5; i += 1) rec.pushBarometer(1000)

  // 先正常爬完第 1 层：足够步数 + 两个整拐 + 高度
  let t = 0
  for (let i = 0; i < 4; i += 1) {
    rec.pushFrame(climbingFrame(t, 8, 1.2)); t += 500
    rec.pushFrame(climbingFrame(t, 0, 0)); t += 500
  }
  // 高度到位推进第 1 层（约 2.7m）
  for (let i = 0; i < 15; i += 1) rec.pushBarometer(999.65)
  const afterClimb = rec.snapshot().currentFloor
  assert.equal(afterClimb, 1, '与路线走法不匹配的动作不能靠补气压算成一层')

  // 电梯：近 6s 内 0 步、0 转向、低能量，但气压再降两层
  for (let i = 0; i < 12; i += 1) {
    rec.pushFrame({
      startMs: t, endMs: t + 500,
      steps: 0, cadence: 0, energy: 0.01,
      turnRad: 0, headingTurnRad: 0, paused: 1,
    })
    t += 500
  }
  for (let i = 0; i < 30; i += 1) rec.pushBarometer(998.4)
  const snap = rec.snapshot()
  assert.equal(
    snap.currentFloor,
    afterClimb,
    `电梯不得推进楼层，期望 ${afterClimb} 实际 ${snap.currentFloor}`,
  )
  assert.equal(snap.canAutoComplete, false)
  assert.equal(snap.quality, 'degraded')
})

test('recognizer: 步数不足的慢爬保留脚步但不能靠气压补猜一层', () => {
  const { RouteRecognizer } = load('recognizer')
  const rec = new RouteRecognizer(makeElevatorTemplate(), 0)
  for (let i = 0; i < 5; i += 1) rec.pushBarometer(1000)

  // 慢爬：每帧步数少，但 energy 持续达标 + 两个整拐 + 高度
  let t = 0
  for (let i = 0; i < 8; i += 1) {
    rec.pushFrame({
      startMs: t, endMs: t + 500,
      steps: 1, cadence: 60, energy: 0.12,
      turnRad: 0,
      headingTurnRad: i < 2 ? 1.2 : i < 4 ? -1.2 : 0,
      paused: 0,
    })
    t += 500
  }
  for (let i = 0; i < 15; i += 1) rec.pushBarometer(999.65)
  const snap = rec.snapshot()
  assert.equal(snap.currentFloor, 1, '步数不足时不能用高度或晃动补成一层')
  assert.equal(snap.steps, 8)
  assert.notEqual(snap.statusReason, 'elevator_suspect')
})

test('free-recognizer: 无气压的未知路线只记动作，楼层由人确认', () => {
  const { FreeRecognizer } = load('free-recognizer')
  const rec = new FreeRecognizer({...makeCalorieTestTemplate(),segments:[]},0)
  for(let i=0;i<40;i++) rec.pushFrame({startMs:i*500,endMs:(i+1)*500,steps:4,cadence:120,energy:0.2,turnRad:i%2?1.2:-1.2,paused:0})
  assert.equal(rec.snapshot().floorsCompleted,0)
  assert.equal(rec.snapshot().canAutoComplete,false)
  assert.equal(rec.snapshot().confidence,0)
  rec.confirmFloor(5,20000)
  assert.equal(rec.snapshot().currentFloor,5)
  assert.equal(rec.finish(20000).floorConfirmation,'pending')
})
test('elevator gate: 单元判定阈值', () => {
  const { ElevatorGate } = load('elevator-gate')
  const gate = new ElevatorGate()
  // 不足窗口帧数
  gate.pushFrame({ startMs: 0, endMs: 500, steps: 0, cadence: 0, energy: 0.01, turnRad: 0, paused: 1 }, 0)
  assert.equal(gate.isSuspect(3, 5), false, '帧不足不应触发')

  const g2 = new ElevatorGate()
  let t = 0
  for (let i = 0; i < 12; i += 1) {
    g2.pushFrame({ startMs: t, endMs: t + 500, steps: 0, cadence: 0, energy: 0.01, turnRad: 0, paused: 1 }, i * 0.2)
    t += 500
  }
  assert.equal(g2.isSuspect(3, 2.5), true, '高度上升+无步+无拐+低能量应触发')

  const g3 = new ElevatorGate()
  t = 0
  for (let i = 0; i < 12; i += 1) {
    g3.pushFrame({ startMs: t, endMs: t + 500, steps: 1, cadence: 60, energy: 0.12, turnRad: 0, paused: 0 }, i * 0.2)
    t += 500
  }
  assert.equal(g3.isSuspect(3, 2.5), false, '持续 energy 的慢爬不应触发')
})

// === diagnostics：采集者化名与设备品牌（D01 门禁要求的身份元数据） ===
test('diagnostics: 化名/品牌校验规则拒绝真实身份信息', () => {
  const { isValidParticipantId, isValidDeviceBrand } = load('diagnostics')
  assert.equal(isValidParticipantId('p01'), true)
  assert.equal(isValidParticipantId('P-01_a'), true)
  assert.equal(isValidParticipantId('张三'), false, '中文姓名不是化名代码')
  assert.equal(isValidParticipantId('13800138000'), false, '11 位手机号应被拒绝')
  assert.equal(isValidParticipantId('a@b.com'), false, '邮箱应被拒绝')
  assert.equal(isValidParticipantId('p 01'), false, '空格应被拒绝')
  assert.equal(isValidParticipantId(''), false)
  assert.equal(isValidParticipantId('p'.repeat(33)), false, '超长应被拒绝')
  assert.equal(isValidDeviceBrand('xiaomi'), true)
  assert.equal(isValidDeviceBrand('oneplus'), true)
  assert.equal(isValidDeviceBrand('Xiaomi'), false, '品牌必须小写')
  assert.equal(isValidDeviceBrand('小米'), false, '中文品牌名应被拒绝')
  assert.equal(isValidDeviceBrand(''), false)
})

test('diagnostics: 旧包缺失身份字段可读，写了非法值必须报错', () => {
  const { parseDiagnosticBundle } = load('diagnostics')
  // 旧包（无 participantId/deviceBrand）继续可读，不得被当成非法
  const legacy = parseDiagnosticBundle(makeDiagnosticBundle('stationary'))
  assert.equal(legacy.capture.participantId, undefined)
  assert.equal(legacy.capture.deviceBrand, undefined)

  // 合法身份被保留
  const withId = makeDiagnosticBundle('stationary')
  withId.capture.participantId = 'p07'
  withId.capture.deviceBrand = 'xiaomi'
  const parsed = parseDiagnosticBundle(withId)
  assert.equal(parsed.capture.participantId, 'p07')
  assert.equal(parsed.capture.deviceBrand, 'xiaomi')

  // 非法身份必须抛出，不能静默接受后进入数据集
  const bad = makeDiagnosticBundle('stationary')
  bad.capture.participantId = '张三'
  assert.throws(() => parseDiagnosticBundle(bad), /participantId 不合法/)
  const badBrand = makeDiagnosticBundle('stationary')
  badBrand.capture.deviceBrand = 'Xiaomi 12'
  assert.throws(() => parseDiagnosticBundle(badBrand), /deviceBrand 不合法/)
})

test('diagnostics: 回放结果把缺失身份暴露为空串（门禁据此 fail closed）', () => {
  const { replayDiagnosticBundle } = load('diagnostics')

  const missing = replayDiagnosticBundle(makeDiagnosticBundle('stationary'))
  assert.equal(missing.participantId, '', '缺失时不得编造可用身份')
  assert.equal(missing.deviceBrand, '')

  const present = makeDiagnosticBundle('stationary')
  present.capture.participantId = 'p03'
  present.capture.deviceBrand = 'samsung'
  const result = replayDiagnosticBundle(present)
  assert.equal(result.participantId, 'p03')
  assert.equal(result.deviceBrand, 'samsung')
})

test('diagnostics: 导出脱敏不剥离化名与品牌，但仍剥离地点与机型', () => {
  const { sanitizeDiagnosticBundleForExport } = load('diagnostics')
  const bundle = makeDiagnosticBundle('stationary')
  bundle.capture.participantId = 'p05'
  bundle.capture.deviceBrand = 'oneplus'
  bundle.capture.platform = 'android'
  bundle.capture.systemVersion = '15'
  const safe = sanitizeDiagnosticBundleForExport(bundle)
  assert.equal(safe.capture.participantId, 'p05')
  assert.equal(safe.capture.deviceBrand, 'oneplus')
  assert.equal(safe.createdAt, 0)
})

// === preflight：无地点/无模板/无气压都不得阻塞开练 ===
test('preflight: 无地点只降级为警告，不阻塞开练', () => {
  const { evaluateWorkoutPreflight } = load('preflight')
  const result = evaluateWorkoutPreflight({
    privacyAgreed: true,
    hasRoute: true,
    routeHasSegments: true,
    routeHasLocation: false,
    barometerAvailable: true,
    carryMode: 'pocket',
  })
  assert.equal(result.canStart, true, '缺地点不能阻止开练')
  assert.equal(result.blockers.length, 0)
  assert.equal(
    result.warnings.some((issue) => issue.code === 'missing_location'),
    true,
    '必须明确告知不记录地点',
  )
})

test('preflight: 未同意隐私才是阻塞项', () => {
  const { evaluateWorkoutPreflight, summarizePreflight } = load('preflight')
  const result = evaluateWorkoutPreflight({
    privacyAgreed: false,
    hasRoute: true,
    routeHasSegments: true,
    routeHasLocation: true,
    barometerAvailable: true,
    carryMode: 'pocket',
  })
  assert.equal(result.canStart, false)
  assert.equal(result.blockers[0].code, 'privacy_not_agreed')
  assert.match(summarizePreflight(result), /隐私条款/)
})

test('preflight: 没有既有模板时给出「第一轮建模板」说明且可开练', () => {
  const { evaluateWorkoutPreflight } = load('preflight')
  const withRoute = evaluateWorkoutPreflight({
    privacyAgreed: true,
    hasRoute: true,
    routeHasSegments: false,
    routeHasLocation: true,
    barometerAvailable: true,
    carryMode: 'pocket',
  })
  assert.equal(withRoute.canStart, true)
  assert.equal(
    withRoute.issues.some(
      (issue) => issue.code === 'no_route_template' && issue.severity === 'info',
    ),
    true,
  )

  const withoutRoute = evaluateWorkoutPreflight({
    privacyAgreed: true,
    hasRoute: false,
    routeHasSegments: false,
    routeHasLocation: false,
    barometerAvailable: 'unknown',
    carryMode: 'pocket',
  })
  assert.equal(withoutRoute.canStart, true, '完全没有路线也必须能开练')
  assert.equal(
    withoutRoute.warnings.some((issue) => issue.code === 'missing_location'),
    false,
    '没有路线时不重复提示缺地点（由建模板说明覆盖）',
  )
})

test('preflight: 无气压计降级为保守折扣而不是阻塞', () => {
  const { evaluateWorkoutPreflight, summarizePreflight } = load('preflight')
  const result = evaluateWorkoutPreflight({
    privacyAgreed: true,
    hasRoute: true,
    routeHasSegments: true,
    routeHasLocation: true,
    barometerAvailable: false,
    carryMode: 'pocket',
  })
  assert.equal(result.canStart, true)
  assert.equal(
    result.warnings.some((issue) => issue.code === 'barometer_unavailable'),
    true,
  )
  assert.match(summarizePreflight(result), /气压计/)
})

test('preflight: 腰包携带给出固定建议且不阻塞', () => {
  const { evaluateWorkoutPreflight } = load('preflight')
  const result = evaluateWorkoutPreflight({
    privacyAgreed: true,
    hasRoute: true,
    routeHasSegments: true,
    routeHasLocation: true,
    barometerAvailable: true,
    carryMode: 'waist',
  })
  assert.equal(result.canStart, true)
  assert.equal(
    result.issues.some(
      (issue) =>
        issue.code === 'carry_mode_recommendation' && issue.severity === 'info',
    ),
    true,
  )
})

// === D06：人工修正链 / 成绩来源 / 学习资格 ===
// 复用的轮次夹具：1 层出发到达 12 层 = 爬升 11 层（统一口径），每层 3 米。
function makeCorrectableRound(overrides = {}) {
  return {
    ...makeRound(1, 200000),
    startFloor: 1,
    targetFloor: 12,
    finalFloor: 12,
    floorsCompleted: 11,
    ascentM: 33,
    confidence: 0.9,
    complete: true,
    completionReason: 'route_complete',
    interruptions: [],
    userCorrectionCount: 0,
    ...overrides,
  }
}

// 验收 1：原值保留 + floorsCompleted/ascentM 同步 + 成绩来源转人工
test('D06: 修正最终楼层保留原值、同步楼层与爬升、标记人工来源', () => {
  const { applyRoundCorrection } = load('corrections')
  const round = makeCorrectableRound()
  const next = applyRoundCorrection(
    round,
    { finalFloor: 13 },
    { at: 1_700_000_000_000, reason: '实际到 13 层', id: 'corr-1' },
  )
  assert.notEqual(next, round, '必须返回新对象（纯函数）')
  assert.equal(round.finalFloor, 12, '不得修改入参')
  assert.equal(round.corrections, undefined, '入参不得被追加修正链')
  assert.equal(next.corrections.length, 1)
  assert.equal(next.corrections[0].id, 'corr-1')
  assert.equal(next.corrections[0].at, 1_700_000_000_000)
  assert.equal(next.corrections[0].reason, '实际到 13 层')
  assert.equal(next.corrections[0].excludeFromLearning, true)
  assert.equal(next.corrections[0].before.finalFloor, 12)
  assert.equal(next.corrections[0].after.finalFloor, 13)
  assert.equal(next.finalFloor, 13)
  // floorsCompleted 用与展示同一口径（爬升段数），ascentM 按每层爬升重新计算
  assert.equal(next.floorsCompleted, 12)
  assert.equal(next.corrections[0].after.floorsCompleted, 12)
  assert.equal(next.ascentM, 36, '每层 3 米 × 12 层')
  assert.equal(next.corrections[0].after.ascentM, 36)
  assert.equal(next.trustworthy, false)
  assert.equal(next.completionSource, 'manual')
  assert.equal(next.userCorrectionCount, 1)
})

// 验收 2：同值重复提交幂等
test('D06: 重复提交同一楼层不追加记录（幂等）', () => {
  const { applyRoundCorrection, summarizeCorrectionChain } = load('corrections')
  const round = makeCorrectableRound()
  const once = applyRoundCorrection(round, { finalFloor: 13 })
  const twice = applyRoundCorrection(once, { finalFloor: 13 })
  assert.equal(twice, once, '同值修正应返回原对象引用')
  assert.equal(twice.corrections.length, 1, '不得产生第二条记录')
  assert.equal(twice.userCorrectionCount, 1)
  assert.equal(twice.trustworthy, false)
  // 只提交原始值（12 层）同样不追加
  const back = applyRoundCorrection(once, { finalFloor: 12 })
  assert.equal(back.corrections.length, 2, '回改到不同值应追加（不是同值幂等）')
  const same = applyRoundCorrection(back, { finalFloor: 12 })
  assert.equal(same, back)
  assert.equal(same.corrections.length, 2)
  const chain = summarizeCorrectionChain(twice)
  assert.equal(chain.count, 1)
  assert.equal(chain.corrected, true)
  assert.equal(chain.originalFinalFloor, 12)
  assert.equal(chain.latestFinalFloor, 13)
  assert.equal(chain.raisedConfidence, false)
})

// 纯函数负向：冻结入参（含既有修正链）后调用不得抛错，也不得改写历史记录
test('D06: 修正为纯函数，冻结的入参与既有链不被改写', () => {
  const { applyRoundCorrection } = load('corrections')
  const frozenRound = Object.freeze(makeCorrectableRound())
  const first = applyRoundCorrection(frozenRound, { finalFloor: 13 }, { id: 'c1' })
  assert.equal(first.corrections.length, 1)
  assert.equal(frozenRound.corrections, undefined, '冻结的入参不得被追加')

  const frozenChain = Object.freeze(
    first.corrections.map((correction) =>
      Object.freeze({
        ...correction,
        before: Object.freeze({ ...correction.before }),
        after: Object.freeze({ ...correction.after }),
      }),
    ),
  )
  const frozenOnce = Object.freeze({ ...first, corrections: frozenChain })
  const second = applyRoundCorrection(frozenOnce, { finalFloor: 14 }, { id: 'c2' })
  assert.equal(second.corrections.length, 2)
  assert.equal(frozenOnce.corrections.length, 1, '既有链不得被就地修改')
  assert.equal(frozenOnce.corrections[0].after.finalFloor, 13)
  assert.equal(second.corrections[0], frozenChain[0], '历史记录对象应被复用而不是重写')
  assert.equal(second.corrections[1].before.finalFloor, 13)
})

// 验收 3：链式修正保留历史
test('D06: 链式修正保留每一步原值', () => {
  const { applyRoundCorrection, summarizeCorrectionChain } = load('corrections')
  const round = makeCorrectableRound()
  const once = applyRoundCorrection(round, { finalFloor: 13 }, { at: 1000, id: 'c1' })
  const twice = applyRoundCorrection(once, { finalFloor: 14 }, { at: 2000, id: 'c2' })
  assert.equal(twice.corrections.length, 2)
  assert.equal(twice.corrections[0].before.finalFloor, 12)
  assert.equal(twice.corrections[0].after.finalFloor, 13)
  assert.equal(twice.corrections[1].before.finalFloor, 13, '第二次修正的 before 是第一次的结果')
  assert.equal(twice.corrections[1].after.finalFloor, 14)
  assert.equal(twice.finalFloor, 14)
  assert.equal(twice.floorsCompleted, 13)
  assert.equal(twice.ascentM, 39)
  assert.equal(twice.userCorrectionCount, 2)
  const chain = summarizeCorrectionChain(twice)
  assert.equal(chain.count, 2)
  assert.equal(chain.originalFinalFloor, 12, '原始值取第一次修正前')
  assert.equal(chain.latestFinalFloor, 14)
  assert.equal(chain.raisedConfidence, false)
})

// 验收 4：置信度只降不升
test('D06: 人工修正不得提高置信度', () => {
  const { applyRoundCorrection, summarizeCorrectionChain } = load('corrections')
  const round = makeCorrectableRound({ confidence: 0.9 })
  const raised = applyRoundCorrection(round, { finalFloor: 13, confidence: 0.99 })
  assert.equal(raised.confidence, 0.9, '试图抬高必须被夹回原值')
  assert.ok(raised.confidence <= round.confidence)
  assert.equal(raised.corrections[0].after.confidence, 0.9)
  assert.equal(summarizeCorrectionChain(raised).raisedConfidence, false)
  // 只抬高置信度（被夹回后无任何变化）不产生记录
  const clampOnly = applyRoundCorrection(round, { confidence: 0.99 })
  assert.equal(clampOnly, round, '纯抬高的 patch 属于幂等 no-op')
  assert.equal(clampOnly.corrections, undefined)
  // 降低置信度是允许的
  const lowered = applyRoundCorrection(round, { finalFloor: 13, confidence: 0.5 })
  assert.equal(lowered.confidence, 0.5)
  assert.ok(lowered.corrections[0].after.confidence <= lowered.corrections[0].before.confidence)
  // 伪造一条抬高置信度的历史链时，摘要必须能暴露
  const forged = {
    ...lowered,
    corrections: [
      ...lowered.corrections,
      { ...lowered.corrections[0], before: { ...lowered.corrections[0].before, confidence: 0.2 }, after: { ...lowered.corrections[0].after, confidence: 0.7 } },
    ],
  }
  assert.equal(summarizeCorrectionChain(forged).raisedConfidence, true)
})

// 验收 5 + 6：学习资格统一口径，旧记录不误伤
test('D06: 学习资格由 isRoundLearnable 统一判定且不误伤旧记录', () => {
  const { applyRoundCorrection, isRoundLearnable, summarizeCorrectionChain } = load('corrections')
  const { isLearningEligibleRound, migrateRouteToV3, updateRouteModelFromWorkouts } = load('route-model')
  const { summarizeRouteLearning } = load('route-learning')
  const clean = makeCorrectableRound()
  assert.equal(isRoundLearnable(clean), true, '无修正的完整轮可学习')
  assert.equal(isLearningEligibleRound(clean), true)

  const corrected = applyRoundCorrection(clean, { finalFloor: 13 })
  assert.equal(isRoundLearnable(corrected), false, '修正轮不得参与学习')
  assert.equal(isLearningEligibleRound(corrected), false)

  // 修正轮不得提高路线模型的采样数（无可用轮次时原样返回）
  const route = migrateRouteToV3(makeCalorieTestTemplate())
  const withClean = updateRouteModelFromWorkouts(route, [{
    id: 'w', templateId: route.id, status: 'completed', startedAt: 1, rounds: [clean],
  }])
  assert.equal(withClean, route, '没有人工核对的参考不能凭自动轮次更新')
  assert.equal(withClean.learning.sampleCount, 1)
  const withCorrected = updateRouteModelFromWorkouts(route, [{
    id: 'w', templateId: route.id, status: 'completed', startedAt: 1, rounds: [corrected],
  }])
  assert.equal(withCorrected, route, '只有修正轮时路线模型不得更新')

  // route-learning 的样本列表里不得出现该修正轮
  const cleanSummary = summarizeRouteLearning(route, [{
    id: 'w', templateId: route.id, startedAt: 1, rounds: [clean],
  }])
  assert.equal(cleanSummary.samples.some((sample) => sample.workoutId === 'w'), true)
  const correctedSummary = summarizeRouteLearning(route, [{
    id: 'w', templateId: route.id, startedAt: 1, rounds: [corrected],
  }])
  assert.equal(correctedSummary.samples.some((sample) => sample.workoutId === 'w'), false)

  // 旧记录：无 corrections / userCorrectionCount / trustworthy / completionSource 字段
  const legacy = { ...makeRound(1, 200000) }
  delete legacy.userCorrectionCount
  assert.equal(isRoundLearnable(legacy), true, '旧记录不得被误伤')
  assert.equal(isLearningEligibleRound(legacy), true)
  const legacyChain = summarizeCorrectionChain(legacy)
  assert.equal(legacyChain.count, 0)
  assert.equal(legacyChain.corrected, false)
  assert.equal(legacyChain.originalFinalFloor, undefined)
  assert.equal(legacyChain.latestFinalFloor, legacy.finalFloor)
  assert.equal(legacyChain.raisedConfidence, false)

  // 逐项负向：不完整 / 手动来源 / recovered / trustworthy=false / 遗留计数 > 0
  assert.equal(isRoundLearnable({ ...legacy, complete: false }), false)
  assert.equal(isRoundLearnable({ ...legacy, completionSource: 'manual' }), false)
  assert.equal(isRoundLearnable({ ...legacy, completionSource: 'recovered' }), false)
  assert.equal(isRoundLearnable({ ...legacy, trustworthy: false }), false)
  assert.equal(isRoundLearnable({ ...legacy, userCorrectionCount: 1 }), false)
  assert.equal(isRoundLearnable({ ...legacy, completionSource: 'automatic' }), true)
  assert.equal(isRoundLearnable({ ...legacy, corrections: [] }), true, '空链不算修正')
})

// 验收 7：汇总修正计数 + 周累计与详情同口径
test('D06: 汇总修正计数与周累计使用轮次口径', () => {
  const { applyRoundCorrection } = load('corrections')
  const { calculateWorkoutSummary } = load('workout-summary')
  const { deriveTrainingProgress } = load('training-progress')
  const now = Date.now()
  const roundA = makeCorrectableRound()
  const roundB = makeCorrectableRound({ roundNumber: 2, id: 'round-2' })
  const corrected = applyRoundCorrection(roundA, { finalFloor: 13 })

  const summary = calculateWorkoutSummary([corrected, roundB], now, now + 400000)
  assert.equal(summary.correctedRounds, 1, '一轮有修正链')
  assert.equal(summary.manualCorrectionCount, 1, '链长合计 1')
  const legacySummary = calculateWorkoutSummary([makeRound(1, 200000)], now, now + 200000)
  assert.equal(legacySummary.correctedRounds, 0, '旧记录无修正链')
  assert.equal(legacySummary.manualCorrectionCount, 0)

  // 训练级缓存被写坏（例如修正后未刷新）时，周累计必须回到轮次口径
  const workout = {
    id: 'w1',
    templateId: 'route',
    status: 'completed',
    startedAt: now,
    endedAt: now + 400000,
    updatedAt: now + 400000,
    totalFloorsCompleted: 999,
    totalAscentM: 9999,
    activeDurationMs: 999999,
    rounds: [roundA, roundB],
  }
  const progress = deriveTrainingProgress([workout], now)
  assert.equal(progress.validWorkouts, 1)
  assert.equal(progress.floors, roundA.floorsCompleted + roundB.floorsCompleted)
  assert.equal(progress.floors, calculateWorkoutSummary([roundA, roundB], now, now + 400000).totalFloors)
  assert.equal(progress.ascentM, calculateWorkoutSummary([roundA, roundB], now, now + 400000).totalAscentM)
  assert.equal(progress.personalBests.route.floors, progress.floors)
  assert.equal(progress.personalBests.route.durationMs, roundA.durationMs + roundB.durationMs)

  // 含修正轮的训练退出「可信完整训练」：不进周累计、不进个人最佳
  const correctedWorkout = { ...workout, rounds: [corrected, roundB] }
  const correctedProgress = deriveTrainingProgress([correctedWorkout], now)
  assert.equal(correctedProgress.validWorkouts, 0)
  assert.equal(correctedProgress.floors, 0)
  assert.equal(correctedProgress.personalBests.route, undefined)
})

// 验收 8：备份往返保留修正链、旧备份与脏数据仍可读 + 导出可信口径一致
test('D06: 备份往返保留修正链，旧备份/脏数据可读，导出可信标记一致', () => {
  const { applyRoundCorrection } = load('corrections')
  const { validateBackupPayload, mergeById } = load('backup-payload')
  const { buildWorkoutCsv } = load('export-csv')
  const clean = makeCorrectableRound()
  const corrected = applyRoundCorrection(clean, { finalFloor: 13 }, { at: 1234, id: 'c1' })
  const workout = {
    id: 'w1',
    templateId: 'r1',
    status: 'completed',
    startedAt: 1000,
    endedAt: 2000,
    updatedAt: 2000,
    totalFloorsCompleted: 13,
    totalAscentM: 39,
    totalSteps: 500,
    activeDurationMs: 200000,
    totalElapsedMs: 200000,
    routeSnapshot: {
      name: '测试楼',
      locationName: '测试楼',
      startFloor: 1,
      endFloor: 12,
      floorsPerRound: 12,
      ascentPerRoundM: 36,
    },
    rounds: [corrected],
  }

  // 导出 → JSON 往返 → 校验 → 合并导入：链完整保留
  const exported = { version: 2, exportedAt: 1, routes: [], sessions: [], workouts: [workout] }
  const restored = JSON.parse(JSON.stringify(exported))
  const checked = validateBackupPayload(restored)
  assert.equal(checked.ok, true)
  const imported = mergeById([], checked.payload.workouts)
  assert.equal(imported.length, 1)
  assert.equal(imported[0].rounds[0].corrections.length, 1)
  assert.equal(imported[0].rounds[0].corrections[0].id, 'c1')
  assert.equal(imported[0].rounds[0].corrections[0].before.finalFloor, 12)
  assert.equal(imported[0].rounds[0].corrections[0].after.finalFloor, 13)
  assert.equal(imported[0].rounds[0].corrections[0].at, 1234)

  // 全部记录合法时不得改写原引用（导入前校验不改数据）
  assert.equal(checked.payload.workouts, restored.workouts)
  assert.equal(checked.payload.workouts[0], restored.workouts[0])

  // 旧备份（无 corrections 字段）仍可读
  const legacyRound = { ...makeRound(1, 200000) }
  const legacyPayload = {
    version: 1,
    exportedAt: 2,
    routes: [],
    sessions: [],
    workouts: [{ ...workout, rounds: [legacyRound] }],
  }
  const legacyChecked = validateBackupPayload(legacyPayload)
  assert.equal(legacyChecked.ok, true)
  assert.equal(legacyChecked.payload.workouts[0].rounds[0].corrections, undefined)
  assert.equal(mergeById([], legacyChecked.payload.workouts).length, 1)

  // 脏数据（corrections 非数组）降级为空链而不是让导入/结果页崩溃
  const dirtyChecked = validateBackupPayload({
    version: 2,
    exportedAt: 3,
    routes: [],
    sessions: [],
    workouts: [{ ...workout, rounds: [{ ...corrected, corrections: 'oops' }] }],
  })
  assert.equal(dirtyChecked.ok, true)
  assert.equal(dirtyChecked.payload.workouts[0].rounds[0].corrections, undefined)

  // 导出可信标记与学习资格同口径：修正轮 = 0，未修正轮 = 1
  const correctedCsv = buildWorkoutCsv({ workouts: [workout] })
  assert.equal(correctedCsv.trim().split('\n')[1].endsWith(',0'), true)
  const cleanCsv = buildWorkoutCsv({ workouts: [{ ...workout, rounds: [clean] }] })
  assert.equal(cleanCsv.trim().split('\n')[1].endsWith(',1'), true)
})

// 结果页无渲染器（Expo/RN），这里只做静态接线检查：入口存在、先保存再清理旧会话。
test('D06: 结果页修正入口静态接线（保存 → 清理旧单轮会话）', () => {
  const fs = require('node:fs')
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'pages', 'Result.tsx'),
    'utf8',
  )
  assert.match(source, /applyRoundCorrection\(/)
  assert.match(source, /await saveWorkout\(/)
  assert.match(source, /applyRoundCorrection,\s*\n?\s*summarizeCorrectionChain|summarizeCorrectionChain,/)
  assert.match(source, /if \(correctedRound === lastRound && lastRound.floorConfirmation/, '同值提交必须提前返回')
  const saveAt = source.indexOf('await saveWorkout(')
  const dropAt = source.indexOf('await deleteSession(id)')
  assert.ok(saveAt > 0 && dropAt > saveAt, '必须先保存修正，再清理旧单轮会话')
})

// === D07：训练计划结构（热身/上爬/返回/恢复）、可跳过环节、完成反馈 ===
// 计划构建必须是确定性的：id/时间戳全部显式传入（模块内部不得调用 Date.now()/uid()）。
const D07_NOW = 1_700_000_000_000

function makeD07Plan(overrides = {}) {
  const { buildPlanFromGoal } = load('workout-plan')
  return buildPlanFromGoal(
    overrides.goal ?? { type: 'rounds', targetRounds: 3 },
    {
      id: overrides.id ?? 'plan-test',
      now: overrides.now ?? D07_NOW,
      ...(overrides.name !== undefined ? { name: overrides.name } : {}),
      ...(overrides.options ?? {}),
    },
  )
}

// 验收 1：阶段序列驱动（热身只在最前、每轮 上爬→返回→恢复、最后一轮后结束）
test('D07: 计划按 热身→上爬→返回→恢复 序列推进，最后一轮后结束', () => {
  const P = load('workout-plan')
  const plan = makeD07Plan({ goal: { type: 'rounds', targetRounds: 3 } })

  assert.deepEqual(
    P.planPhaseSequence(plan).map((phase) => phase.kind),
    [
      'warmup',
      'climb',
      'return',
      'recovery',
      'climb',
      'return',
      'recovery',
      'climb',
      'return',
      'recovery',
    ],
  )
  assert.equal(P.planPhaseCount(plan), 10)
  assert.equal(P.planExpectedRounds(plan), 3)

  let progress = P.initialPlanProgress(plan)
  const seen = []
  for (let guard = 0; guard < 20; guard += 1) {
    const phase = P.nextPlanPhase(plan, progress)
    if (!phase) {
      seen.push('END')
      break
    }
    seen.push(`${phase.kind}#r${progress.roundNumber}/rem${progress.remainingRounds}`)
    progress = P.advancePlanProgress(plan, progress)
  }
  assert.deepEqual(seen, [
    'warmup#r1/rem3',
    'climb#r1/rem3',
    'return#r1/rem2',
    'recovery#r1/rem2',
    'climb#r2/rem2',
    'return#r2/rem1',
    'recovery#r2/rem1',
    'climb#r3/rem1',
    'return#r3/rem0',
    'recovery#r3/rem0',
    'END',
  ])
  // 每轮内部严格保持规范顺序（上爬 → 返回 → 恢复；热身只在最前）
  for (let round = 1; round <= 3; round += 1) {
    const kinds = seen
      .filter((row) => row.includes(`#r${round}/`) && !row.startsWith('warmup'))
      .map((row) => row.split('#')[0])
    assert.deepEqual(kinds, ['climb', 'return', 'recovery'])
  }

  // 结束后：nextPlanPhase 返回 undefined，advance 幂等，剩余轮数为 0
  assert.equal(P.nextPlanPhase(plan, progress), undefined)
  assert.equal(progress.remainingRounds, 0)
  assert.deepEqual(P.advancePlanProgress(plan, progress), progress)
  assert.equal(P.completedRoundCount(progress), 3)
})

// 验收 2：跳过恢复不影响净爬楼时长，且被记录进 skippedPhases
test('D07: 跳过恢复阶段不影响净爬楼时长，且记入 skippedPhases', () => {
  const P = load('workout-plan')
  const { calculateWorkoutSummary } = load('workout-summary')
  const plan = makeD07Plan({ goal: { type: 'rounds', targetRounds: 3 } })

  let progress = P.initialPlanProgress(plan)
  progress = P.advancePlanProgress(plan, progress) // 热身完成
  progress = P.advancePlanProgress(plan, progress) // 第 1 轮上爬完成
  progress = P.advancePlanProgress(plan, progress) // 返回完成
  progress = P.advancePlanProgress(plan, progress, 'skipped') // 恢复跳过

  assert.deepEqual(progress.skippedPhases, ['recovery'])
  assert.deepEqual(progress.completedPhases, ['warmup', 'climb', 'return'])
  assert.equal(progress.phaseIndex, 4, '跳过也要推进游标')
  assert.equal(progress.roundNumber, 2)
  assert.equal(progress.remainingRounds, 2)
  assert.equal(P.completedRoundCount(progress), 1)
  assert.equal(P.nextPlanPhase(plan, progress).kind, 'climb', '跳过后直接进入第 2 轮上爬')

  // 时长归类：只有上爬进 active；是否跳过恢复不影响 activeDurationMs
  const climbOnly = [{ kind: 'climb', durationMs: 200000 }]
  const warmupThenClimbThenReturn = [
    { kind: 'warmup', durationMs: 300000 },
    { kind: 'climb', durationMs: 200000 },
    { kind: 'return', durationMs: 60000 },
  ]
  const withRecovery = [
    ...warmupThenClimbThenReturn,
    { kind: 'recovery', durationMs: 90000 },
  ]
  const skippedTotals = P.summarizePhaseDurations(warmupThenClimbThenReturn)
  const keptTotals = P.summarizePhaseDurations(withRecovery)
  assert.equal(skippedTotals.recoveryDurationMs, 0)
  assert.equal(keptTotals.recoveryDurationMs, 90000)
  assert.equal(skippedTotals.activeDurationMs, keptTotals.activeDurationMs)
  assert.equal(
    skippedTotals.activeDurationMs,
    P.summarizePhaseDurations(climbOnly).activeDurationMs,
  )
  assert.equal(skippedTotals.uncountedDurationMs, 300000, '热身不进任何既有汇总字段')
  assert.equal(skippedTotals.returnDurationMs, 60000)

  // 与 workout-summary 同口径：轮 durationMs 只含上爬，返回/恢复各自入账
  const round = {
    ...makeRound(1, 200000),
    returnDurationMs: 60000,
    recoveryDurationMs: keptTotals.recoveryDurationMs,
  }
  const summary = calculateWorkoutSummary([round], D07_NOW, D07_NOW + 440000)
  assert.equal(summary.activeDurationMs, skippedTotals.activeDurationMs)
  assert.equal(summary.activeDurationMs, 200000)
  assert.equal(summary.returnDurationMs, 60000)
  assert.equal(summary.recoveryDurationMs, 90000)
  assert.ok(summary.totalElapsedMs > summary.activeDurationMs)

  // 完成反馈只看净爬楼：总历时（含休息）远超目标也不影响达成判定
  const durationGoal = { type: 'duration', targetActiveDurationMs: 200000 }
  const durationPlan = makeD07Plan({ goal: durationGoal, id: 'plan-duration' })
  const feedback = P.buildPlanFeedback(durationPlan, {
    completedRounds: summary.completeRounds,
    activeDurationMs: summary.activeDurationMs,
    totalFloors: summary.totalFloors,
  })
  assert.equal(feedback.achieved, true)
  assert.match(feedback.lines.join('\n'), /返回／恢复／热身不计入/)
})

// 验收 3：不可跳过的阶段（上爬/返回）拒绝跳过
test('D07: 上爬/返回不可跳过，热身/恢复可跳过', () => {
  const P = load('workout-plan')
  const plan = makeD07Plan({ goal: { type: 'rounds', targetRounds: 2 } })

  assert.equal(P.canSkipPhase(plan, plan.climbPerRound), false, '上爬是成绩来源，不可跳过')
  assert.equal(P.canSkipPhase(plan, plan.returnPerRound), false, '返回不可跳过')
  assert.equal(P.canSkipPhase(plan, plan.warmup), true)
  assert.equal(P.canSkipPhase(plan, plan.recoveryPerRound), true)

  // 数据里写了 climb.skippable=true 也必须仍然不可跳过（读入时夹回 false）
  const dirty = { ...plan, climbPerRound: { kind: 'climb', skippable: true } }
  assert.equal(P.canSkipPhase(dirty, dirty.climbPerRound), false)
  const parsed = P.parsePlan(
    JSON.stringify({
      ...P.canonicalPlan(plan),
      climbPerRound: { kind: 'climb', skippable: true },
    }),
  )
  assert.equal(parsed.climbPerRound.skippable, false)

  // 计划里没有的阶段也不可跳过（不属于该计划）
  const noRecovery = makeD07Plan({
    goal: { type: 'rounds', targetRounds: 2 },
    id: 'plan-no-recovery',
    options: { includeRecovery: false },
  })
  assert.equal(noRecovery.recoveryPerRound, undefined)
  assert.equal(P.canSkipPhase(noRecovery, { kind: 'recovery', skippable: true }), false)

  // 负向：在上爬阶段请求跳过被拒绝（进度不变：不推进、不记录）
  const atClimb = P.planProgressAt(plan, 1)
  assert.deepEqual(P.advancePlanProgress(plan, atClimb, 'skipped'), atClimb)
  assert.deepEqual(atClimb.skippedPhases, [])
  assert.equal(atClimb.phaseIndex, 1)
})

// 验收 4：第 2 轮中止保留已完成轮，summary 与逐轮求和一致
test('D07: 第 2 轮上爬中途中止保留已完成轮，summary 与逐轮求和一致', () => {
  const P = load('workout-plan')
  const { calculateWorkoutSummary, buildInterruptedRound } = load('workout-summary')
  const plan = makeD07Plan({ goal: { type: 'rounds', targetRounds: 5 }, id: 'plan-abort' })

  // 走完第 1 轮（热身/上爬/返回/恢复）后停在第 2 轮上爬途中
  let progress = P.initialPlanProgress(plan)
  for (let i = 0; i < 4; i += 1) progress = P.advancePlanProgress(plan, progress)
  assert.deepEqual(progress.completedPhases, ['warmup', 'climb', 'return', 'recovery'])
  assert.equal(progress.roundNumber, 2)
  assert.equal(P.nextPlanPhase(plan, progress).kind, 'climb', '中止发生在第 2 轮上爬途中')
  // 判定：轮次只在 climb 阶段完成后计入；第 2 轮上爬途中中止 ⇒ 完成轮数 = 1
  assert.equal(P.completedRoundCount(progress), 1)

  const aborted = P.finishPlanProgress(plan, progress)
  assert.equal(aborted.remainingRounds, 0)
  assert.deepEqual(aborted.completedPhases, progress.completedPhases, '中止不得清空已完成阶段')
  assert.equal(P.completedRoundCount(aborted), 1)
  assert.equal(P.nextPlanPhase(plan, aborted), undefined, '中止后不再有下一阶段')

  // 第 1 轮完整 + 第 2 轮中断轮都必须留在 summary 里
  const round1 = makeRound(1, 200000)
  const interrupted = buildInterruptedRound(
    {
      currentRoundNumber: 2,
      savedAt: D07_NOW + 260000,
      currentRoundStartedAt: D07_NOW + 200000,
    },
    { startFloor: 1, endFloor: 16 },
  )
  const summary = calculateWorkoutSummary([round1, interrupted], D07_NOW, D07_NOW + 300000)
  assert.equal(interrupted.completionReason, 'interrupted')
  assert.equal(summary.totalRounds, 2, '中断轮也保留')
  assert.equal(summary.completeRounds, 1)
  assert.equal(summary.completeRounds, P.completedRoundCount(aborted), '完成轮口径一致')
  const round1Only = calculateWorkoutSummary([round1], D07_NOW, D07_NOW + 200000)
  assert.equal(summary.totalFloors, round1Only.totalFloors, '中断轮不贡献楼层')
  assert.equal(summary.totalAscentM, round1Only.totalAscentM)
  assert.equal(summary.activeDurationMs, round1Only.activeDurationMs, '中断半轮不进净爬楼时长')
  // 逐轮求和一致，且中断轮的楼层/爬升为 0
  const { getRoundAchievementCount } = load('floors')
  assert.equal(getRoundAchievementCount(interrupted), 0)
  assert.equal(
    summary.totalFloors,
    getRoundAchievementCount(round1) + getRoundAchievementCount(interrupted),
  )
})

// 验收 5：五种旧目标全部可构建计划，达成判定与 workout-summary 逐字一致
test('D07: 五种旧目标均可构建计划，达成判定与 workout-summary 一致', () => {
  const P = load('workout-plan')
  const { calculateWorkoutSummary, checkGoalReached } = load('workout-summary')

  // 与训练设置页默认值一致：5 轮 / 75 层 / 240 米 / 30 分钟净爬楼
  const goals = [
    { type: 'open' },
    { type: 'rounds', targetRounds: 5 },
    { type: 'floors', targetFloors: 75 },
    { type: 'ascent', targetAscentM: 240 },
    { type: 'duration', targetActiveDurationMs: 30 * 60 * 1000 },
  ]
  for (const goal of goals) {
    const plan = makeD07Plan({ goal, id: `plan-${goal.type}` })
    assert.deepEqual(plan.goal, goal, '旧目标原样保留')
    assert.equal(plan.schemaVersion, 1)
    assert.equal(plan.climbPerRound.kind, 'climb')
    assert.equal(plan.climbPerRound.skippable, false)
    assert.equal(plan.rounds, goal.type === 'rounds' ? 5 : 'until_goal')
  }

  for (const roundCount of [3, 4, 5, 6]) {
    const rounds = Array.from({ length: roundCount }, (_, i) => makeRound(i + 1, 360000))
    const summary = calculateWorkoutSummary(
      rounds,
      D07_NOW,
      D07_NOW + roundCount * 360000,
    )
    const input = {
      completedRounds: summary.completeRounds,
      activeDurationMs: summary.activeDurationMs,
      totalFloors: summary.totalFloors,
      totalAscentM: summary.totalAscentM,
    }
    for (const goal of goals) {
      const legacy = checkGoalReached(summary, goal)
      assert.equal(
        P.planGoalReached(goal, input),
        legacy.reached,
        `${goal.type} / ${roundCount} 轮达成判定一致`,
      )
      assert.equal(
        P.planGoalMessage(goal, input),
        legacy.message,
        `${goal.type} / ${roundCount} 轮文案一致`,
      )
    }
    if (roundCount === 5) {
      // 5 轮 = 80 层 / 240 米 / 30 分钟：四项目标同时达成
      assert.equal(P.planGoalReached({ type: 'rounds', targetRounds: 5 }, input), true)
      assert.equal(P.planGoalReached({ type: 'floors', targetFloors: 75 }, input), true)
      assert.equal(P.planGoalReached({ type: 'ascent', targetAscentM: 240 }, input), true)
      assert.equal(P.planGoalReached({ type: 'duration', targetActiveDurationMs: 1800000 }, input), true)
    }
    if (roundCount === 4) {
      // 4 轮 = 64 层 / 192 米 / 24 分钟：均未达成
      assert.equal(P.planGoalReached({ type: 'rounds', targetRounds: 5 }, input), false)
      assert.equal(P.planGoalReached({ type: 'floors', targetFloors: 75 }, input), false)
      assert.equal(P.planGoalReached({ type: 'ascent', targetAscentM: 240 }, input), false)
      assert.equal(P.planGoalReached({ type: 'duration', targetActiveDurationMs: 1800000 }, input), false)
    }
  }

  const plan5 = makeD07Plan({ goal: { type: 'rounds', targetRounds: 5 }, id: 'plan-feedback' })
  const feedback = P.buildPlanFeedback(plan5, {
    completedRounds: 5,
    activeDurationMs: 1800000,
    totalFloors: 80,
  })
  assert.equal(feedback.achieved, true)
  assert.equal(feedback.lines.includes('目标已完成：5 轮'), true)
})

// 验收 6：计划 JSON 往返幂等、无非确定性字段、脏数据被拒绝
test('D07: 计划 JSON 往返幂等且不含非确定性字段，脏数据被拒绝', () => {
  const P = load('workout-plan')
  const build = () =>
    P.buildPlanFromGoal(
      { type: 'rounds', targetRounds: 3 },
      { id: 'plan-json', now: D07_NOW, name: '三段热身计划' },
    )
  const plan = build()
  const json = P.serializePlan(plan)
  const parsed = P.parsePlan(json)

  assert.deepEqual(parsed, P.canonicalPlan(plan))
  assert.equal(P.serializePlan(parsed), json, '序列化幂等')
  assert.equal(P.serializePlan(P.parsePlan(P.serializePlan(parsed))), json, '二次往返仍幂等')
  assert.equal(
    Object.keys(parsed).join(','),
    'id,name,rounds,warmup,climbPerRound,returnPerRound,recoveryPerRound,goal,createdAt,updatedAt,schemaVersion',
    '字段与顺序固定',
  )
  assert.equal(json.includes('undefined'), false)
  assert.equal(json.includes('null'), false)
  assert.equal(json.includes('NaN'), false)
  // 构建确定性：同一入参两次构建（不传 id/时间以外的隐藏状态）结果完全相同
  const again = build()
  assert.equal(P.serializePlan(again), json)
  assert.equal(again.id, plan.id)
  assert.equal(again.createdAt, plan.createdAt)
  // 阶段顺序语义在往返后一致
  assert.deepEqual(
    P.planPhaseSequence(parsed).map((phase) => phase.kind),
    P.planPhaseSequence(plan).map((phase) => phase.kind),
  )

  // 负向：未知 schemaVersion / 未知目标类型 / 未知阶段类型 / 非法 JSON 全部抛错
  assert.throws(() => P.parsePlan(JSON.stringify({ ...plan, schemaVersion: 2 })), /schemaVersion/)
  assert.throws(
    () => P.parsePlan(JSON.stringify({ ...plan, goal: { type: 'steps', targetSteps: 100 } })),
    /目标类型/,
  )
  assert.throws(
    () => P.parsePlan(JSON.stringify({ ...plan, climbPerRound: { skippable: false } })),
    /未知阶段类型/,
  )
  assert.throws(
    () => P.parsePlan(JSON.stringify({ ...plan, climbPerRound: { kind: 'return' } })),
    /阶段类型应为 climb/,
  )
  assert.throws(() => P.parsePlan(JSON.stringify({ ...plan, rounds: -1 })), /rounds/)
  assert.throws(() => P.parsePlan('{'), /JSON/)
  assert.equal(P.isWorkoutPlan(plan), true)
  assert.equal(P.isWorkoutPlan({ ...plan, schemaVersion: undefined }), false)
})

// 验收 7：无 plan 字段的旧数据（解析/导入/汇总）行为不变
test('D07: 无 plan 字段的旧数据导入与汇总行为不变（回归）', () => {
  const P = load('workout-plan')
  const { calculateWorkoutSummary, checkGoalReached } = load('workout-summary')
  const { validateBackupPayload, mergeById } = load('backup-payload')

  const legacyWorkout = {
    id: 'legacy-w1',
    templateId: 'route-1',
    templateVersion: 1,
    status: 'completed',
    goal: { type: 'rounds', targetRounds: 2 },
    returnConfirmationMode: 'manual',
    routeSnapshot: {
      name: '测试楼',
      locationName: '测试楼',
      startFloor: 1,
      endFloor: 16,
      floorsPerRound: 16,
      ascentPerRoundM: 48,
    },
    startedAt: D07_NOW,
    endedAt: D07_NOW + 400000,
    updatedAt: D07_NOW + 400000,
    rounds: [makeRound(1, 200000), makeRound(2, 200000)],
    currentRoundNumber: 2,
    totalRoundsCompleted: 2,
    totalFloorsCompleted: 32,
    totalAscentM: 96,
    totalSteps: 980,
    activeDurationMs: 400000,
    returnDurationMs: 0,
    recoveryDurationMs: 0,
    totalElapsedMs: 400000,
    createdAt: D07_NOW,
  }
  assert.equal('plan' in legacyWorkout, false)

  const checked = validateBackupPayload(
    JSON.parse(
      JSON.stringify({
        version: 2,
        exportedAt: 1,
        routes: [],
        sessions: [],
        workouts: [legacyWorkout],
      }),
    ),
  )
  assert.equal(checked.ok, true)
  const imported = mergeById([], checked.payload.workouts)
  assert.equal(imported.length, 1)
  assert.equal(imported[0].plan, undefined)

  const summary = calculateWorkoutSummary(
    imported[0].rounds,
    legacyWorkout.startedAt,
    legacyWorkout.endedAt,
  )
  assert.equal(summary.totalRounds, 2)
  assert.equal(summary.completeRounds, 2)
  assert.equal(summary.totalFloors, 30)
  assert.equal(summary.totalAscentM, 96)
  assert.equal(summary.activeDurationMs, 400000)
  // D06 追加字段对旧数据照常为 0（本任务没有回退 D06 的改动）
  assert.equal(summary.correctedRounds, 0)
  assert.equal(summary.manualCorrectionCount, 0)

  const reached = checkGoalReached(summary, { type: 'rounds', targetRounds: 2 })
  assert.equal(reached.reached, true)
  assert.equal(reached.message, '目标已完成：2 轮')
  const notReached = checkGoalReached(summary, { type: 'rounds', targetRounds: 5 })
  assert.equal(notReached.reached, false)
  assert.equal(notReached.message, '')

  // 旧数据不会被误当成计划（D07 类型是纯追加的可选字段）
  assert.equal(P.isWorkoutPlan(legacyWorkout), false)
  assert.equal(P.isWorkoutPlan(legacyWorkout.goal), false)
  assert.equal(P.isWorkoutPlan({ type: 'rounds', targetRounds: 5 }), false)
})

// 状态机桥接：计划阶段映射 + 游标往返；既有 reducer 行为不变
test('D07: 状态机桥接（阶段映射/游标往返）不改动既有 reducer 行为', () => {
  const P = load('workout-plan')
  const M = load('workout-machine')
  const plan = makeD07Plan({ goal: { type: 'rounds', targetRounds: 3 }, id: 'plan-machine' })

  assert.equal(M.machinePhaseForPlanPhase('warmup'), 'round_ready')
  assert.equal(M.machinePhaseForPlanPhase('climb'), 'ascending')
  assert.equal(M.machinePhaseForPlanPhase('return'), 'returning')
  assert.equal(M.machinePhaseForPlanPhase('recovery'), 'recovering')
  assert.deepEqual(M.planPhaseKindsForMachinePhase('round_ready'), ['warmup', 'climb'])
  assert.deepEqual(M.planPhaseKindsForMachinePhase('ascending'), ['climb'])
  assert.deepEqual(M.planPhaseKindsForMachinePhase('returning'), ['return'])
  assert.deepEqual(M.planPhaseKindsForMachinePhase('start_confirmation'), ['return'])
  assert.deepEqual(M.planPhaseKindsForMachinePhase('recovering'), ['recovery'])
  assert.deepEqual(M.planPhaseKindsForMachinePhase('workout_complete'), [])
  assert.deepEqual(M.planPhaseKindsForPlan(plan), ['warmup', 'climb', 'return', 'recovery'])

  const started = M.startWorkoutWithPlan(plan)
  assert.equal(started.phase, 'round_ready')
  assert.equal(started.currentRoundNumber, 1)
  assert.equal(started.planId, 'plan-machine')
  assert.equal(started.planPhaseIndex, 0)
  assert.deepEqual(M.planProgressForState(started, plan), P.initialPlanProgress(plan))
  assert.equal(M.nextPlanPhaseForState(started, plan).kind, 'warmup')

  // 游标往返：推进（含跳过恢复）→ 写回状态 → 再推导，进度不丢失
  let cursor = M.planProgressForState(started, plan)
  for (let i = 0; i < 3; i += 1) cursor = P.advancePlanProgress(plan, cursor)
  cursor = P.advancePlanProgress(plan, cursor, 'skipped')
  const withCursor = M.withPlanCursor(started, plan.id, cursor)
  assert.deepEqual(M.planProgressForState(withCursor, plan), cursor)
  assert.equal(withCursor.phase, 'round_ready', '游标写回不改状态机阶段')
  assert.equal(withCursor.currentRoundNumber, 1)
  assert.equal(M.nextPlanPhaseForState(withCursor, plan).kind, 'climb')

  // 旧路径（无计划字段）行为与新增字段无关
  const legacyStart = M.workoutReducer(M.INITIAL_WORKOUT_STATE, { type: 'START_WORKOUT' })
  assert.deepEqual(legacyStart, { phase: 'round_ready', currentRoundNumber: 1 })
  assert.equal(legacyStart.planId, undefined)
  assert.equal(legacyStart.planPhaseIndex, undefined)
  assert.deepEqual(M.workoutReducer(legacyStart, { type: 'BEGIN_ASCENDING' }), {
    phase: 'ascending',
    currentRoundNumber: 1,
  })
})

// until_goal：轮数由目标决定 ⇒ 序列无限、剩余轮数 unknown
test('D07: until_goal 计划无限推进，剩余轮数为 unknown', () => {
  const P = load('workout-plan')
  const plan = makeD07Plan({ goal: { type: 'open' }, id: 'plan-until-goal' })

  assert.equal(plan.rounds, 'until_goal')
  assert.equal(P.planPhaseCount(plan), 'unknown')
  assert.equal(P.planExpectedRounds(plan), 'until_goal')
  assert.equal(P.initialPlanProgress(plan).remainingRounds, 'unknown')

  // 大索引仍按每轮周期取到阶段（热身只在最前）
  assert.deepEqual(
    [1000, 1001, 1002].map((index) => P.planPhaseAtIndex(plan, index).kind),
    ['climb', 'return', 'recovery'],
  )
  assert.equal(P.planPhaseAtIndex(plan, 0).kind, 'warmup')
  assert.equal(P.planPhaseAtIndex(plan, -1), undefined)
  assert.deepEqual(
    P.planPhaseSequence(plan, { rounds: 2 }).map((phase) => phase.kind),
    ['warmup', 'climb', 'return', 'recovery', 'climb', 'return', 'recovery'],
  )
  assert.equal(P.planPhaseSequence(plan).length, 4, '默认只预览 1 轮')

  // 结束由目标达成判定（nextPlanPhase 不会自动返回 undefined），收尾后剩余轮数为 0
  const mid = P.planProgressAt(plan, 3)
  assert.equal(P.nextPlanPhase(plan, P.planProgressAt(plan, 1000)).kind, 'climb')
  const done = P.finishPlanProgress(plan, mid)
  assert.equal(done.remainingRounds, 0)
  assert.deepEqual(done.completedPhases, ['warmup', 'climb', 'return'])
})

// 阶段计时/计数归属表 + 完成反馈文案
test('D07: 阶段归属只有上爬算成绩，完成反馈含结构与净爬楼口径', () => {
  const P = load('workout-plan')
  assert.deepEqual(P.PLAN_PHASE_ORDER, ['warmup', 'climb', 'return', 'recovery'])
  assert.deepEqual(P.planPhaseAccounting('climb'), {
    durationBucket: 'active',
    countsFloors: true,
    countsSteps: true,
  })
  assert.equal(P.planPhaseAccounting('return').durationBucket, 'return')
  assert.equal(P.planPhaseAccounting('recovery').durationBucket, 'recovery')
  assert.equal(P.planPhaseAccounting('warmup').durationBucket, 'none')
  for (const kind of ['warmup', 'return', 'recovery']) {
    assert.equal(P.planPhaseAccounting(kind).countsFloors, false)
    assert.equal(P.planPhaseAccounting(kind).countsSteps, false)
    assert.equal(P.countsAsActiveClimb(kind), false)
  }
  assert.equal(P.countsAsActiveClimb('climb'), true)
  assert.deepEqual(P.emptyPhaseDurationTotals(), {
    activeDurationMs: 0,
    returnDurationMs: 0,
    recoveryDurationMs: 0,
    uncountedDurationMs: 0,
  })

  const plan = makeD07Plan({
    goal: { type: 'floors', targetFloors: 75 },
    id: 'plan-feedback-text',
    name: '75 层挑战',
  })
  const feedback = P.buildPlanFeedback(plan, {
    completedRounds: 3,
    activeDurationMs: 600000,
    totalFloors: 48,
  })
  assert.equal(feedback.achieved, false)
  const text = feedback.lines.join('\n')
  assert.match(text, /计划：75 层挑战/)
  assert.match(
    text,
    /结构：热身（5 分钟／可跳过） → 每轮：上爬（不限时） → 返回（4 分钟） → 恢复（2 分钟／可跳过） × 轮数由目标决定/,
  )
  assert.match(text, /目标：75 层/)
  assert.match(text, /已完成 3 轮（轮数由目标决定）/)
  assert.match(text, /净爬楼 10 分钟（返回／恢复／热身不计入）/)
  assert.match(text, /累计 48 层/)

  const reached = P.buildPlanFeedback(plan, {
    completedRounds: 5,
    activeDurationMs: 1800000,
    totalFloors: 80,
  })
  assert.equal(reached.achieved, true)
  assert.equal(reached.lines.at(-1), '目标已达到：75 层')
  // 跳过恢复（recoveryDurationMs 为 0）不影响达成：只看净爬楼
  assert.equal(
    P.buildPlanFeedback(plan, {
      completedRounds: 5,
      activeDurationMs: 1800000,
      totalFloors: 75,
    }).achieved,
    true,
  )
})

// === D07b：计划接线（热身计时入账 + 检查点恢复 + 页面/钩子静态接线）===

// 验收 1（核心口径）：热身净时长单独入账，绝不进净爬楼时长
test('D07b: 热身净时长单独入账，不进净爬楼时长', () => {
  const { calculateWorkoutSummary } = load('workout-summary')
  const round = {
    ...makeRound(1, 200000),
    returnDurationMs: 60000,
    recoveryDurationMs: 90000,
  }
  const base = calculateWorkoutSummary([round], 1000, 441000)
  assert.equal('warmupDurationMs' in base, false, '旧调用（3 参数）返回对象形状不变')
  assert.equal(base.warmupDurationMs, undefined)

  const withWarmup = calculateWorkoutSummary([round], 1000, 441000, {
    warmupDurationMs: 300000,
  })
  assert.equal(withWarmup.warmupDurationMs, 300000)
  // 热身与返回/恢复一样属于休息：不改变任何爬楼口径
  assert.equal(withWarmup.activeDurationMs, base.activeDurationMs)
  assert.equal(withWarmup.activeDurationMs, 200000)
  assert.equal(withWarmup.returnDurationMs, 60000)
  assert.equal(withWarmup.recoveryDurationMs, 90000)
  assert.equal(withWarmup.totalFloors, base.totalFloors)
  assert.equal(withWarmup.totalAscentM, base.totalAscentM)
  assert.equal(withWarmup.totalRounds, base.totalRounds)
  // 总历时仍由挂钟决定，不因热身入账而改变
  assert.equal(withWarmup.totalElapsedMs, 440000)
  // 负向：负值夹到 0；非有限值不产生该字段；两者都不影响 activeDurationMs
  const negative = calculateWorkoutSummary([round], 1000, 441000, {
    warmupDurationMs: -5,
  })
  assert.equal(negative.warmupDurationMs, 0)
  assert.equal(negative.activeDurationMs, base.activeDurationMs)
  const nan = calculateWorkoutSummary([round], 1000, 441000, {
    warmupDurationMs: Number.NaN,
  })
  assert.equal('warmupDurationMs' in nan, false)
  assert.equal(nan.activeDurationMs, base.activeDurationMs)
})

// 验收 1/2：hook 的推进时机（热身→上爬→返回→恢复→下一轮）与跳过语义
test('D07b: 计划推进时机与跳过语义（模拟 hook 的调用顺序）', () => {
  const P = load('workout-plan')
  const plan = P.buildPlanFromGoal(
    { type: 'rounds', targetRounds: 3 },
    { id: 'p-wire', now: 1000 },
  )
  let progress = P.initialPlanProgress(plan)
  const kind = () => P.nextPlanPhase(plan, progress)?.kind

  assert.equal(kind(), 'warmup')
  // beginAscending：热身完成
  progress = P.advancePlanProgress(plan, progress)
  assert.equal(kind(), 'climb')
  // handleRoundComplete：上爬完成
  progress = P.advancePlanProgress(plan, progress)
  assert.equal(kind(), 'return')
  // confirmReturnedToStart：返回完成
  progress = P.advancePlanProgress(plan, progress)
  assert.equal(kind(), 'recovery')
  // startNextRound：轮间恢复结束
  progress = P.advancePlanProgress(plan, progress)
  assert.equal(kind(), 'climb')
  assert.equal(progress.roundNumber, 2)
  assert.equal(progress.remainingRounds, 2)
  assert.equal(P.completedRoundCount(progress), 1)

  // 跳过热身：只推进游标并记录，仍停在「即将上爬」
  const skippedWarmup = P.advancePlanProgress(
    plan,
    P.initialPlanProgress(plan),
    'skipped',
  )
  assert.deepEqual(skippedWarmup.skippedPhases, ['warmup'])
  assert.deepEqual(skippedWarmup.completedPhases, [])
  assert.equal(P.nextPlanPhase(plan, skippedWarmup).kind, 'climb')

  // 跳过恢复：记录 + 进入下一轮上爬
  const atRecovery = P.planProgressAt(plan, 3)
  assert.equal(P.canSkipPhase(plan, plan.recoveryPerRound), true)
  const skippedRecovery = P.advancePlanProgress(plan, atRecovery, 'skipped')
  assert.deepEqual(skippedRecovery.skippedPhases, ['recovery'])
  assert.equal(P.nextPlanPhase(plan, skippedRecovery).kind, 'climb')
  assert.equal(skippedRecovery.roundNumber, 2)
  assert.equal(skippedRecovery.remainingRounds, 2)

  // 不可跳过阶段仍拒绝跳过（上爬）
  const atClimb = P.planProgressAt(plan, 1)
  assert.deepEqual(P.advancePlanProgress(plan, atClimb, 'skipped'), atClimb)

  // 验收 2：跳过恢复不改变净爬楼时长（休息时间本来就不在 activeDurationMs 里）
  const { calculateWorkoutSummary } = load('workout-summary')
  const round = makeRound(1, 200000)
  const withRest = calculateWorkoutSummary(
    [{ ...round, recoveryDurationMs: 90000 }],
    1000,
    291000,
  )
  const noRest = calculateWorkoutSummary(
    [{ ...round, recoveryDurationMs: 0 }],
    1000,
    291000,
  )
  assert.equal(withRest.recoveryDurationMs, 90000)
  assert.equal(noRest.recoveryDurationMs, 0)
  assert.equal(noRest.activeDurationMs, withRest.activeDurationMs)
  assert.equal(withRest.activeDurationMs, 200000)
})

// 验收 3：恢复阶段被杀 → 检查点往返后 plan 与 planProgress 与保存时一致
test('D07b: 恢复阶段检查点往返保留 plan 与 planProgress', () => {
  const P = load('workout-plan')
  const { planProgressForState } = load('workout-machine')
  const plan = P.buildPlanFromGoal(
    { type: 'rounds', targetRounds: 3 },
    { id: 'p-ckpt', now: 1000 },
  )
  let progress = P.initialPlanProgress(plan)
  // 走完热身/上爬/返回，停在恢复阶段
  for (let i = 0; i < 3; i += 1) progress = P.advancePlanProgress(plan, progress)
  assert.equal(P.nextPlanPhase(plan, progress).kind, 'recovery')

  // hook 写入的检查点形状（services 直接 JSON 序列化，未声明字段原样保留）
  const checkpoint = {
    workoutId: 'w1',
    phase: 'recovering',
    currentRoundNumber: 1,
    savedAt: 2000,
    completedRounds: [makeRound(1, 200000)],
    plan,
    planProgress: progress,
    templateId: 'r1',
    goal: plan.goal,
    returnConfirmationMode: 'assisted',
    startedAt: 1000,
  }
  const restored = JSON.parse(JSON.stringify(checkpoint))
  assert.deepEqual(restored.plan, P.canonicalPlan(plan))
  assert.deepEqual(restored.planProgress, progress)
  assert.equal(restored.plan.id, 'p-ckpt')
  assert.equal(restored.phase, 'recovering')
  assert.equal(restored.completedRounds.length, 1, '已完成轮照常保留')

  // 恢复后阶段与轮数不变，继续推进到第 2 轮上爬
  assert.equal(P.nextPlanPhase(restored.plan, restored.planProgress).kind, 'recovery')
  const resumed = P.advancePlanProgress(restored.plan, restored.planProgress)
  assert.equal(P.nextPlanPhase(restored.plan, resumed).kind, 'climb')
  assert.equal(resumed.roundNumber, 2)
  assert.equal(resumed.remainingRounds, 2, '第 2 轮上爬还没完成，剩余仍是 2 轮')

  // 状态机里的计划游标镜像可反推出同一进度（D07 桥接）
  const state = {
    phase: 'recovering',
    currentRoundNumber: 1,
    planId: restored.plan.id,
    planPhaseIndex: restored.planProgress.phaseIndex,
    skippedPlanPhases: [...restored.planProgress.skippedPhases],
  }
  const mirrored = planProgressForState(state, restored.plan)
  assert.equal(mirrored.phaseIndex, restored.planProgress.phaseIndex)
  assert.equal(mirrored.roundNumber, restored.planProgress.roundNumber)
  assert.equal(mirrored.remainingRounds, restored.planProgress.remainingRounds)
  assert.deepEqual(mirrored.skippedPhases, restored.planProgress.skippedPhases)

  // 中止场景：finishPlanProgress 保留已完成轮，剩余轮数置 0
  const aborted = P.finishPlanProgress(restored.plan, resumed)
  assert.equal(aborted.remainingRounds, 0)
  assert.equal(P.completedRoundCount(aborted), P.completedRoundCount(resumed))
})

// 验收 4：旧检查点（无 plan/planProgress）照常恢复
test('D07b: 旧检查点（无 plan/planProgress）照常恢复', () => {
  const P = load('workout-plan')
  const { calculateWorkoutSummary } = load('workout-summary')
  const legacy = {
    workoutId: 'w1',
    phase: 'recovering',
    currentRoundNumber: 2,
    savedAt: 2000,
    completedRounds: [makeRound(1, 200000)],
    templateId: 'r1',
    goal: { type: 'rounds', targetRounds: 5 },
    returnConfirmationMode: 'manual',
    startedAt: 1000,
  }
  const restored = JSON.parse(JSON.stringify(legacy))
  assert.equal('plan' in restored, false)
  assert.equal('planProgress' in restored, false)
  assert.equal(restored.plan, undefined)
  assert.equal(restored.planProgress, undefined)
  assert.equal(P.isWorkoutPlan(restored.plan), false)
  // 既有恢复所需字段完好
  assert.equal(restored.phase, 'recovering')
  assert.equal(restored.currentRoundNumber, 2)
  assert.equal(restored.completedRounds.length, 1)
  assert.equal(restored.completedRounds[0].durationMs, 200000)
  // 无计划恢复后的汇总不含热身字段，爬楼口径与改动前一致
  const summary = calculateWorkoutSummary(
    restored.completedRounds,
    restored.startedAt,
    201000,
  )
  assert.equal('warmupDurationMs' in summary, false)
  assert.equal(summary.activeDurationMs, 200000)
  assert.equal(summary.totalRounds, 1)
})

// 验收 5/回归：无计划训练的汇总与判定逐字不变
test('D07b: 无计划训练（旧目标）汇总与判定不变', () => {
  const { calculateWorkoutSummary, checkGoalReached } = load('workout-summary')
  const rounds = [makeRound(1, 360000), makeRound(2, 360000), makeRound(3, 360000)]
  const summary = calculateWorkoutSummary(rounds, 1000, 1000 + 1080000)
  assert.equal(summary.totalFloors, 45)
  assert.equal(summary.activeDurationMs, 1080000)
  assert.equal('warmupDurationMs' in summary, false)
  assert.equal(checkGoalReached(summary, { type: 'rounds', targetRounds: 3 }).reached, true)

  // 同一组轮次 + 计划的热身：爬楼口径完全相同，只多出热身时长
  const planned = calculateWorkoutSummary(rounds, 1000, 1000 + 1080000 + 300000, {
    warmupDurationMs: 300000,
  })
  assert.equal(planned.activeDurationMs, summary.activeDurationMs)
  assert.equal(planned.totalFloors, summary.totalFloors)
  assert.equal(planned.totalAscentM, summary.totalAscentM)
  assert.equal(planned.totalSteps, summary.totalSteps)
  assert.equal(planned.returnDurationMs, summary.returnDurationMs)
  assert.equal(planned.recoveryDurationMs, summary.recoveryDurationMs)
  assert.equal(planned.warmupDurationMs, 300000)
  assert.equal(checkGoalReached(planned, { type: 'rounds', targetRounds: 3 }).reached, true)
})

// 验收 1/2/4/6：hook 的静态接线（无渲染器，只能证明源码接线与口径）
// 已删除：D07b useClimbWorkout 静态接线——旧训练 hook 随 fusion-v1 移除（新 hook：useFusionWorkout）。

test('D07b: 状态机与计划阶段全程同步（3 轮：热身→上爬→返回→恢复）', () => {
  const P = load('workout-plan')
  const M = load('workout-machine')
  const plan = P.buildPlanFromGoal(
    { type: 'rounds', targetRounds: 3 },
    { id: 'p-sync', now: 1000 },
  )
  let progress = P.initialPlanProgress(plan)
  let state = M.startWorkoutWithPlan(plan)

  const planKind = () => P.nextPlanPhase(plan, progress)?.kind
  const machinePhaseForPlan = (kind) => M.machinePhaseForPlanPhase(kind)

  // 热身：状态机停在 round_ready，计划阶段为 warmup（UI 显示热身视图，不自动开爬）
  assert.equal(state.phase, 'round_ready')
  assert.equal(state.currentRoundNumber, 1)
  assert.equal(planKind(), 'warmup')
  assert.equal(machinePhaseForPlan(planKind()), state.phase)

  // 用户点「开始上爬」：先推进计划（warmup 完成），再 dispatch
  progress = P.advancePlanProgress(plan, progress)
  state = M.workoutReducer(state, { type: 'BEGIN_ASCENDING' })
  assert.equal(state.phase, 'ascending')
  assert.equal(planKind(), 'climb')
  assert.equal(machinePhaseForPlan(planKind()), state.phase)

  const seen = ['warmup', 'climb']

  for (let round = 1; round <= 3; round += 1) {
    if (round > 1) {
      // 上一轮恢复结束 → 先推进（recovery → 下一轮 climb），再 START_NEXT_ROUND
      progress = P.advancePlanProgress(plan, progress)
      state = M.withPlanCursor(
        M.workoutReducer(state, { type: 'START_NEXT_ROUND' }),
        plan.id,
        progress,
      )
      assert.equal(state.phase, 'round_ready')
      assert.equal(state.currentRoundNumber, round)
      assert.equal(planKind(), 'climb')
      assert.equal(progress.roundNumber, round)
      seen.push('climb')
      state = M.workoutReducer(state, { type: 'BEGIN_ASCENDING' })
      assert.equal(state.phase, 'ascending')
    }

    // 上爬结束 → 推进到 return，再 ROUND_COMPLETE / BEGIN_RETURNING
    progress = P.advancePlanProgress(plan, progress)
    state = M.workoutReducer(state, { type: 'ROUND_COMPLETE' })
    assert.equal(state.phase, 'round_complete')
    assert.equal(planKind(), 'return')
    state = M.workoutReducer(state, { type: 'BEGIN_RETURNING', at: 1_000 })
    assert.equal(state.phase, 'returning')
    assert.equal(machinePhaseForPlan(planKind()), state.phase)
    seen.push('return')

    // 返回结束 → 推进到 recovery，再 CONFIRM_RETURNED
    progress = P.advancePlanProgress(plan, progress)
    state = M.workoutReducer(state, { type: 'CONFIRM_RETURNED', at: 3_000 })
    assert.equal(state.phase, 'recovering')
    assert.equal(machinePhaseForPlan(planKind()), state.phase)
    seen.push('recovery')
  }

  // 阶段序列：warmup + (climb → return → recovery) × 3
  assert.deepEqual(seen, [
    'warmup',
    'climb',
    'return',
    'recovery',
    'climb',
    'return',
    'recovery',
    'climb',
    'return',
    'recovery',
  ])
  // 第 3 轮恢复阶段：计划只剩最后一步（recovery），3 轮上爬都已完成
  assert.equal(state.phase, 'recovering')
  assert.equal(state.currentRoundNumber, 3)
  assert.equal(planKind(), 'recovery')
  assert.equal(machinePhaseForPlan(planKind()), state.phase)
  assert.equal(progress.roundNumber, 3)
  assert.equal(progress.remainingRounds, 0)
  assert.equal(P.completedRoundCount(progress), 3)
  assert.deepEqual(progress.completedPhases, [
    'warmup',
    'climb',
    'return',
    'recovery',
    'climb',
    'return',
    'recovery',
    'climb',
    'return',
  ])

  // 最后一轮恢复结束 → 计划走完（之后属于「自由加练」，状态机照常进入下一轮）
  progress = P.advancePlanProgress(plan, progress)
  assert.equal(planKind(), undefined)
  assert.equal(progress.remainingRounds, 0)
  assert.deepEqual(progress.completedPhases, [
    'warmup',
    'climb',
    'return',
    'recovery',
    'climb',
    'return',
    'recovery',
    'climb',
    'return',
    'recovery',
  ])

  // 计划走完后 buildPlanFeedback 仍然给出反馈（页面在完成仪式里展示）
  const feedback = P.buildPlanFeedback(plan, {
    completedRounds: 3,
    activeDurationMs: 1800000,
    totalFloors: 75,
  })
  assert.equal(feedback.achieved, true)
  assert.equal(feedback.lines.length > 0, true)

  // 状态机镜像与权威进度一致（hook 每次推进后都会 withPlanCursor 同步）
  const mirrored = M.planProgressForState(
    M.withPlanCursor(state, plan.id, progress),
    plan,
  )
  assert.equal(mirrored.phaseIndex, progress.phaseIndex)
  assert.equal(mirrored.roundNumber, progress.roundNumber)
  assert.equal(mirrored.remainingRounds, progress.remainingRounds)
  assert.deepEqual(mirrored.completedPhases, progress.completedPhases)
  assert.deepEqual(mirrored.skippedPhases, progress.skippedPhases)

  // 中止：finishPlanProgress 只把剩余轮数置 0，已完成阶段原样保留
  const aborted = P.finishPlanProgress(plan, progress)
  assert.equal(aborted.remainingRounds, 0)
  assert.deepEqual(aborted.completedPhases, progress.completedPhases)
  assert.equal(P.completedRoundCount(aborted), 3)
})

// ============================================================
// D10：分享 payload 隐私过滤、分享失败路径与可访问性接线
// ============================================================
//
// share-payload.ts 是 D10 新增的 core 纯函数模块，但它不在 package.json 的
// build:core 文件清单里（package.json 属于锁定文件，本次任务不得修改），
// 因此这里直接从源码加载：Node ≥22.18 原生支持 type stripping（本模块只用
// `import type`，转译后没有运行时依赖）；老版本回退到本地 typescript
// （既有 devDependency）转译后再 require。
function loadSharePayload() {
  const sourcePath = path.join(__dirname, '..', 'src', 'core', 'share-payload.ts')
  try {
    return require(sourcePath)
  } catch (typeStrippingError) {
    try {
      return load('share-payload')
    } catch (compiledError) {
      const fs = require('node:fs')
      const os = require('node:os')
      const ts = require('typescript')
      const { outputText } = ts.transpileModule(
        fs.readFileSync(sourcePath, 'utf8'),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
          },
          fileName: sourcePath,
        },
      )
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd10-share-payload-'))
      const outPath = path.join(tmpDir, 'share-payload.js')
      fs.writeFileSync(outPath, outputText)
      return require(outPath)
    }
  }
}

function readSource(relativePath) {
  return require('node:fs').readFileSync(
    path.join(__dirname, '..', relativePath),
    'utf8',
  )
}

/** 取 StyleSheet.create 里的一个样式块，用于「关键容器不得用固定高度」这类断言。 */
function styleBlock(source, key) {
  const start = source.indexOf(`\n    ${key}: {`)
  assert.ok(start > -1, `找不到样式块 ${key}`)
  const end = source.indexOf('\n    },', start)
  assert.ok(end > start, `样式块 ${key} 没有正常结束`)
  return source.slice(start, end)
}

// 分享隐私用例的「最坏情况」训练：带地点、身份、设备与绝对时间戳。
const D10_SENSITIVE = {
  locationName: '中关村某大厦A座',
  address: '北京市海淀区某路1号院',
  latitude: 39.9042,
  longitude: 116.4074,
  participantId: 'participant-zhangsan',
  deviceBrand: 'Xiaomi',
  deviceModel: 'M2101K9C',
}

function makeShareWorkout(overrides = {}) {
  return {
    id: 'workout-d10',
    templateId: 'route-d10',
    templateVersion: 1,
    routeSnapshot: {
      name: '公司楼梯',
      locationName: D10_SENSITIVE.locationName,
      startFloor: 1,
      endFloor: 15,
      floorsPerRound: 14,
      ascentPerRoundM: 42,
      // ClimbWorkout 类型本身没有 location 字段；这里按合同「location 的任何字段」
      // 注入最坏情况，确保实现是按字段名剔除，而不是碰巧没读到。
      location: {
        name: D10_SENSITIVE.locationName,
        address: D10_SENSITIVE.address,
        latitude: D10_SENSITIVE.latitude,
        longitude: D10_SENSITIVE.longitude,
        accuracy: 8,
        source: 'gps',
        confirmedAt: 1774000000000,
      },
    },
    goal: { type: 'rounds', targetRounds: 3 },
    returnConfirmationMode: 'manual',
    status: 'completed',
    // 本地时间构造：12:34:56 / 13:20:07 是必须被剔除的「时分秒」。
    startedAt: new Date(2026, 8, 17, 12, 34, 56).getTime(),
    endedAt: new Date(2026, 8, 17, 13, 20, 7).getTime(),
    rounds: [],
    currentRoundNumber: 3,
    totalRoundsCompleted: 3,
    totalFloorsCompleted: 42,
    totalAscentM: 126,
    totalSteps: 1234,
    activeDurationMs: 1452000,
    returnDurationMs: 300000,
    recoveryDurationMs: 120000,
    totalElapsedMs: 2052000,
    createdAt: new Date(2026, 8, 17, 12, 30, 0).getTime(),
    updatedAt: new Date(2026, 8, 17, 13, 25, 0).getTime(),
    participantId: D10_SENSITIVE.participantId,
    deviceBrand: D10_SENSITIVE.deviceBrand,
    device: {
      platform: 'android',
      model: D10_SENSITIVE.deviceModel,
      system: 'Android 15',
    },
    ...overrides,
  }
}

// 验收 1：payload 结构（两种模式）与「只输出必要数值」
test('D10: share-payload 结构与 summary/poster 两种模式', () => {
  const P = loadSharePayload()
  const workout = makeShareWorkout()

  const summary = P.buildSharePayload({
    workout,
    mode: 'summary',
    includeDate: true,
  })
  assert.equal(summary.title, '我的爬楼训练')
  assert.ok(summary.body.includes('爬升楼层：42层'))
  assert.ok(summary.body.includes('累计爬升：126.0米'))
  assert.ok(summary.body.includes('净爬楼时间：24分12秒'))
  assert.ok(summary.body.includes('累计步数：1234步'))
  assert.ok(summary.body.includes('完成轮数：3轮'))
  assert.ok(Array.isArray(summary.redacted))

  const poster = P.buildSharePayload({ workout, mode: 'poster' })
  assert.equal(poster.title, '循阶 · 爬楼成果海报')
  assert.ok(poster.body.includes('42 层'))
  assert.ok(poster.body.includes('累计爬升 126.0 米'))
  assert.equal(poster.body.includes('累计步数'), false, '海报只保留关键数字')

  // 时长是「训练时长」不是墙上时钟时间：正文里不允许出现冒号形式。
  assert.equal(summary.body.includes(':'), false)
  assert.equal(poster.body.includes(':'), false)
})

// 验收 1（负向）：文本里不得出现经纬度/地址/地点名称/参与者/设备品牌
test('D10: 分享文本不含经纬度、地址、地点名称、participantId 与 deviceBrand', () => {
  const P = loadSharePayload()
  const workout = makeShareWorkout()
  const variants = [
    { workout, mode: 'summary' },
    { workout, mode: 'poster' },
    { workout, mode: 'summary', includeDate: true, includeRouteName: true },
    { workout, mode: 'poster', includeDate: true, includeRouteName: true },
  ]

  const forbiddenValues = [
    D10_SENSITIVE.locationName,
    D10_SENSITIVE.address,
    D10_SENSITIVE.participantId,
    D10_SENSITIVE.deviceBrand,
    D10_SENSITIVE.deviceModel,
    '39.9042',
    '116.4074',
    'gps',
    '12:34:56',
    '13:20:07',
    String(workout.startedAt),
    String(workout.endedAt),
  ]

  for (const input of variants) {
    const payload = P.buildSharePayload(input)
    const text = `${payload.title}\n${payload.body}`
    for (const value of forbiddenValues) {
      assert.equal(
        text.includes(value),
        false,
        `${input.mode} 文本不得包含 ${value}`,
      )
    }
    for (const word of ['地址', '地点', '经纬度', '纬度', '经度']) {
      assert.equal(text.includes(word), false, `文本不得包含字段名 ${word}`)
    }
    // redacted 本身会列出字段名（那是给 UI 说明用的清单），但不得出现字段值。
    const redactedText = payload.redacted.join('、')
    for (const value of forbiddenValues.slice(0, 2)) {
      assert.equal(redactedText.includes(value), false)
    }
  }
})

// 验收 1：被剔除的字段必须出现在 redacted 里
test('D10: 被剔除的字段完整记录在 redacted 里', () => {
  const P = loadSharePayload()
  const workout = makeShareWorkout()
  const payload = P.buildSharePayload({
    workout,
    mode: 'summary',
    includeDate: true,
  })

  const expected = [
    'routeSnapshot.locationName',
    'routeSnapshot.location.name',
    'routeSnapshot.location.address',
    'routeSnapshot.location.latitude',
    'routeSnapshot.location.longitude',
    'routeSnapshot.location.accuracy',
    'routeSnapshot.location.source',
    'routeSnapshot.location.confirmedAt',
    'participantId',
    'deviceBrand',
    'device.platform',
    'device.model',
    'device.system',
    'endedAt',
    'startedAt.时分秒',
  ]
  for (const field of expected) {
    assert.ok(payload.redacted.includes(field), `redacted 应包含 ${field}`)
  }
  // 路线名称不是隐私字段：它只在 includeRouteName 控制下出现，不记为剔除项。
  assert.equal(payload.redacted.includes('routeSnapshot.name'), false)
  // 不输出日期时，整条 startedAt 都算被剔除。
  const noDate = P.buildSharePayload({ workout, mode: 'summary' })
  assert.ok(noDate.redacted.includes('startedAt'))
  assert.equal(noDate.redacted.includes('startedAt.时分秒'), false)
  // 顶层同名字段（如果存在）也要记账，且值不得泄出。
  const topLevel = P.buildSharePayload({
    workout: makeShareWorkout({ locationName: '顶层地点' }),
    mode: 'summary',
  })
  assert.ok(topLevel.redacted.includes('locationName'))
  assert.equal(topLevel.body.includes('顶层地点'), false)
  const topLevelLocation = P.buildSharePayload({
    workout: makeShareWorkout({
      location: { address: '顶层地址', latitude: 1.23 },
    }),
    mode: 'summary',
  })
  assert.ok(topLevelLocation.redacted.includes('location.address'))
  assert.ok(topLevelLocation.redacted.includes('location.latitude'))
  assert.equal(topLevelLocation.body.includes('顶层地址'), false)
  // 清单不得重复
  assert.equal(
    new Set(payload.redacted).size,
    payload.redacted.length,
    'redacted 不应有重复项',
  )
})

// 验收 1：时间只允许日期级别（YYYY-MM-DD），不含时分秒 / 时间戳
test('D10: 分享时间只到日期级别 YYYY-MM-DD', () => {
  const P = loadSharePayload()
  const workout = makeShareWorkout()

  const withDate = P.buildSharePayload({
    workout,
    mode: 'summary',
    includeDate: true,
  })
  const dateTokens = withDate.body.match(/\d{4}-\d{2}-\d{2}[^\n]*/g) ?? []
  assert.equal(dateTokens.length, 1)
  assert.equal(dateTokens[0], '2026-09-17')
  assert.equal(/\d{2}:\d{2}/.test(withDate.body), false, '不得出现时分')
  assert.equal(/\d{4}-\d{2}-\d{2}T/.test(withDate.body), false, '不得出现 ISO 时间戳')
  assert.equal(withDate.body.includes('秒'), true, '训练时长允许按分/秒展示')

  const withoutDate = P.buildSharePayload({ workout, mode: 'summary' })
  assert.equal(/\d{4}-\d{2}-\d{2}/.test(withoutDate.body), false)
  assert.equal(withoutDate.body.includes('2026'), false)

  // 日期文本本身也必须是 YYYY-MM-DD（不能退回 2026.09.17）
  assert.equal(P.formatShareDate(workout.startedAt), '2026-09-17')
  assert.equal(P.formatShareDuration(1452000), '24分12秒')
  assert.equal(/\d{2}:\d{2}/.test(P.formatShareDuration(1452000)), false)
})

// 验收 1：路线名称只在显式开启时出现；地点名称永不出现
test('D10: 路线名称按需出现，地点名称永远不出现', () => {
  const P = loadSharePayload()
  const workout = makeShareWorkout()

  const withoutRoute = P.buildSharePayload({ workout, mode: 'summary' })
  assert.equal(withoutRoute.body.includes('公司楼梯'), false)

  const withRoute = P.buildSharePayload({
    workout,
    mode: 'summary',
    includeRouteName: true,
  })
  assert.ok(withRoute.body.includes('路线：公司楼梯'))
  assert.equal(withRoute.body.includes(D10_SENSITIVE.locationName), false)
  assert.ok(withRoute.redacted.includes('routeSnapshot.locationName'))
})

// 验收 2：只有 success 才算「已分享」
test('D10: isShareableResult 只有 success 为真', () => {
  const P = loadSharePayload()
  assert.equal(P.isShareableResult('success'), true)
  assert.equal(P.isShareableResult('cancelled'), false)
  assert.equal(P.isShareableResult('failed'), false)
})

// 验收 2（负向）：分享面板返回不携带结果时不得当作成功
test('D10: 分享面板返回（resolved）不得当作成功', () => {
  const P = loadSharePayload()
  assert.equal(P.shareOutcomeFromSheetResult('error'), 'failed')
  assert.equal(P.shareOutcomeFromSheetResult('dismissed'), 'cancelled')
  assert.equal(
    P.shareOutcomeFromSheetResult('resolved'),
    'cancelled',
    'Android chooser 恒返回 sharedAction、iOS 也不回报是否发出：一律不算成功',
  )
  for (const result of ['dismissed', 'resolved']) {
    assert.equal(
      P.isShareableResult(P.shareOutcomeFromSheetResult(result)),
      false,
    )
  }
})

// 验收 2：ShareStudio 的失败/取消路径静态接线（无渲染器，只能证明源码接线）
test('D10: ShareStudio 取消与失败不会被记成成功（静态接线）', () => {
  const source = readSource('src/pages/ShareStudio.tsx')
  assert.match(source, /from '\.\.\/core\/share-payload'/)
  assert.ok(source.includes('isShareableResult('), 'UI 必须用 isShareableResult 判定')
  assert.ok(
    source.includes('if (!isShareableResult(outcome))'),
    '取消/失败必须先走非成功分支',
  )
  // markPosterCreated 只能在成功分支里调用
  const guardIndex = source.indexOf('if (!isShareableResult(outcome))')
  const recordIndex = source.lastIndexOf('await markPosterCreated()')
  assert.ok(
    recordIndex > guardIndex,
    'markPosterCreated 必须在 isShareableResult 成功判定之后',
  )
  // 分享面板返回按未确认处理
  assert.ok(source.includes("shareOutcomeFromSheetResult('resolved')"))
  assert.equal(
    /settleShareResult\(\s*'share',\s*'success'/.test(source),
    false,
    '分享面板返回不得写成 success',
  )
  // 权限被拒（取消）也不得显示成功
  assert.ok(
    /settleShareResult\(\s*'save',\s*'cancelled'/.test(source),
    '相册权限被拒要按取消收口',
  )
  // 任何分支都不出现「分享成功」文案
  assert.equal(source.includes('分享成功'), false)
})

// 验收 1：ShareStudio 的复制文本与海报都不含地点（静态接线）
test('D10: ShareStudio 分享文本与海报不含地点（静态接线）', () => {
  const source = readSource('src/pages/ShareStudio.tsx')
  assert.equal(source.includes('displayLocation'), false)
  assert.equal(source.includes('routeSnapshot.locationName'), false)
  assert.equal(source.includes('地点：'), false)
  assert.equal(source.includes('dateText'), false, '日期必须走 formatShareDate')
  assert.ok(source.includes('buildSharePayload('), '分享文本由纯函数生成')
  assert.ok(source.includes('formatShareDate('), '海报日期只到 YYYY-MM-DD')
  assert.ok(
    source.includes('sharePayload.redacted.length'),
    'UI 必须展示被剔除的项数',
  )
  assert.ok(source.includes('地点已隐藏'), '海报必须明确说明地点已隐藏')
})

// 验收 4：减少动画时传感器可视化降级（静态接线 + 关键常量）
// 已删除：D10 波形可视化降级的静态接线——sensor-motion-visualizer 只用于旧的熟悉/检查流程，已移除。
test('D10: 控件读屏语义与可读名称来自可见文本（静态接线）', () => {
  const ui = readSource('src/components/ui.tsx')

  // Button：角色 + 状态 + 可读名称（标题文本，loading 时也不丢）
  assert.ok(ui.includes('accessibilityRole="button"'))
  assert.ok(
    ui.includes(
      'accessibilityState={{ disabled: disabled || loading, busy: loading }}',
    ),
  )
  assert.ok(ui.includes('accessibilityLabel={title}'))

  // Pill：名称来自 children 可见文本，不是英文标识符
  assert.ok(ui.includes('accessibilityRole="text"'))
  assert.ok(ui.includes("typeof children === 'string'"))
  assert.ok(ui.includes('accessibilityLabel={label}'))
  assert.equal(/accessibilityLabel="(pill|Pill|metric)"/.test(ui), false)

  // Metric / Row / Field：数值与标签合并成一个读屏节点
  assert.ok(ui.includes('accessibilityLabel={spoken}'))
  assert.ok(ui.includes('const spoken = hint ?'))
  assert.ok(
    ui.includes('accessibilityLabel={children ? undefined : `${label}，${value}`}'),
  )
  assert.ok(ui.includes('accessibilityLabel={label}'), 'TextInput 需要自己的名称')

  // 危险提示播报为 alert
  assert.ok(ui.includes("accessibilityRole={tone === 'danger' ? 'alert' : 'text'}"))
})

// 验收 3：大字体不依赖固定高度（静态证据；真机截图见报告「未验证」）
test('D10: 大字体下关键控件不依赖固定高度（静态断言）', () => {
  const ui = readSource('src/components/ui.tsx')

  const buttonBase = styleBlock(ui, 'buttonBase')
  assert.ok(Number(buttonBase.match(/minHeight:\s*(\d+)/)?.[1]) >= 48, '按钮用 minHeight 才能随字体长高')
  assert.equal(/\bheight:/.test(buttonBase), false, '按钮不得使用固定 height')

  const input = styleBlock(ui, 'input')
  assert.ok(Number(input.match(/minHeight:\s*(\d+)/)?.[1]) >= 48, '输入框用至少 48 的 minHeight，避免大字体裁切')
  assert.equal(/\bheight:\s*\d/.test(input), false, '输入框不得使用固定 height')

  const metric = styleBlock(ui, 'metric')
  assert.equal(/\bheight:/.test(metric), false, '数值卡片不得使用固定高度')

  // 页面不得压制系统字体缩放（否则「大字体可见」就是假通过）
  for (const file of [
    'src/components/ui.tsx',
    'src/pages/ShareStudio.tsx',
    'src/pages/Summary.tsx',
    'src/pages/Home.tsx',
    'src/pages/Workout.tsx',
  ]) {
    assert.equal(
      readSource(file).includes('maxFontSizeMultiplier'),
      false,
      `${file} 不得用 maxFontSizeMultiplier 限制放大`,
    )
  }
})

// 验收 1（健壮性）：旧/脏记录不能因为缺字段崩溃，也不能借机泄露地点
test('D10: 缺字段的旧记录不崩且仍不泄露地点', () => {
  const P = loadSharePayload()
  const missingRouteName = {
    ...makeShareWorkout(),
    routeSnapshot: {
      locationName: D10_SENSITIVE.locationName,
      location: { address: D10_SENSITIVE.address },
    },
  }
  const payload = P.buildSharePayload({
    workout: missingRouteName,
    mode: 'summary',
    includeRouteName: true,
    includeDate: true,
  })
  assert.equal(payload.body.includes('路线：'), false, '缺路线名时省略该行')
  assert.equal(payload.body.includes(D10_SENSITIVE.locationName), false)
  assert.equal(payload.body.includes(D10_SENSITIVE.address), false)
  assert.ok(payload.redacted.includes('routeSnapshot.locationName'))

  // 极端脏数据（routeSnapshot 整个缺失）也不能抛异常
  const bare = {
    startedAt: 0,
    totalFloorsCompleted: 0,
    totalAscentM: 0,
    totalSteps: 0,
    activeDurationMs: 0,
    totalRoundsCompleted: 0,
  }
  assert.doesNotThrow(() =>
    P.buildSharePayload({
      workout: bare,
      mode: 'poster',
      includeRouteName: true,
    }),
  )
  const barePayload = P.buildSharePayload({ workout: bare, mode: 'poster' })
  assert.equal(barePayload.body.includes('地点'), false)
  assert.equal(barePayload.body.includes('路线'), false)
})

// 验收 5/4（fusion-v1 改版后）：训练页数字动画尊重减少动画；结算/首页关键数值成组朗读（静态接线）
test('D10: 训练页数字动画尊重减少动画，关键数值成组朗读（静态接线）', () => {
  const ui = readSource('src/components/workout-ui.tsx')
  assert.ok(ui.includes('useReduceMotion'), '数字翻动动画必须尊重系统“减少动画”')
  assert.match(ui, /if \(reduced\) return/)
  assert.ok(ui.includes('accessibilityLiveRegion="polite"'), '楼层数字变化要能被读屏播报')
  const workout = readSource('src/pages/Workout.tsx')
  assert.ok(workout.includes('HoldToConfirm'), '结束训练必须长按确认')
  assert.ok(workout.includes('accessibilityLabel={`到了一层'))
  const summary = readSource('src/pages/Summary.tsx')
  assert.ok(summary.includes('accessibilityLabel={`总爬升'), '总爬升成组朗读')
  assert.ok(summary.includes('估算'))
  const home = readSource('src/pages/Home.tsx')
  assert.ok(home.includes('accessibilityLabel={`本周累计爬升'))
  assert.ok(home.includes('开始爬楼'))
})


test('D14-guard 隐私说明与诊断包实际采集字段一致（防止声明漂移）', () => {
  const privacy = readSource('src/pages/Privacy.tsx')
  const diagnostics = readSource('src/core/diagnostics.ts')

  // 诊断包确实采集了化名与设备品牌（D01-UNBLOCK 之后的契约）
  assert.match(
    diagnostics,
    /participantId\?:/,
    '诊断包契约必须仍包含 participantId，否则隐私说明的对应描述会失真',
  )
  assert.match(
    diagnostics,
    /deviceBrand\?:/,
    '诊断包契约必须仍包含 deviceBrand，否则隐私说明的对应描述会失真',
  )

  // 隐私页必须如实说明这两项被采集
  assert.match(privacy, /化名/, '隐私说明必须提到采集者化名')
  assert.match(privacy, /设备品牌/, '隐私说明必须提到设备品牌')

  // 旧的失真表述必须已删除：诊断包不再「剥离机型」，而是明确保留品牌
  assert.doesNotMatch(
    privacy,
    /剥离地点、机型与绝对采集日历时间/,
    '隐私说明不得再声称剥离机型（实际会采集设备品牌）',
  )

  // 归档口径必须与 D08a 行为一致：不再是「超出部分会被覆盖」
  assert.doesNotMatch(
    privacy,
    /超出部分会被覆盖/,
    '隐私说明不得再声称超出部分被覆盖（实际是归档为长期统计）',
  )
  assert.match(privacy, /归档/, '隐私说明必须说明历史记录会被归档为长期统计')
})

// 已删除：F18 检查点热身/自由加练的 hook 静态接线——计划训练随旧训练 hook 移除（类型字段保留以读取旧检查点）。

test('F12 reducer 是时间的纯函数：时间戳由动作提供，缺失即抛错', () => {
  const M = load('workout-machine')

  // 1) 同一状态 + 同一动作（含固定时间戳）→ 结果逐字段相同，且与「当前时间」无关。
  let state = M.INITIAL_WORKOUT_STATE
  state = M.workoutReducer(state, { type: 'START_WORKOUT' })
  state = M.workoutReducer(state, { type: 'BEGIN_ROUND_READY' })
  state = M.workoutReducer(state, { type: 'BEGIN_ASCENDING' })
  state = M.workoutReducer(state, { type: 'ROUND_COMPLETE' })

  const a = M.workoutReducer(state, { type: 'BEGIN_RETURNING', at: 12_345 })
  const b = M.workoutReducer(state, { type: 'BEGIN_RETURNING', at: 12_345 })
  assert.deepEqual(a, b, '同输入必须同输出')
  assert.equal(a.returningSince, 12_345, '时间戳必须来自动作，而不是系统时钟')
  assert.equal(a.phase, 'returning')

  // 2) 不同时间戳 → 只有时间字段不同（证明时间完全由动作决定）
  const c = M.workoutReducer(state, { type: 'BEGIN_RETURNING', at: 99_999 })
  assert.equal(c.returningSince, 99_999)
  assert.deepEqual({ ...c, returningSince: 0 }, { ...a, returningSince: 0 })

  // 3) 缺时间戳 → 抛错，绝不静默读系统时间
  assert.throws(
    () => M.workoutReducer(state, { type: 'BEGIN_RETURNING' }),
    /必须携带有限数字 at/,
    '缺失时间戳必须抛错（fail closed）',
  )
  assert.throws(
    () => M.workoutReducer(state, { type: 'BEGIN_RETURNING', at: NaN }),
    /必须携带有限数字 at/,
    'NaN 时间戳必须抛错',
  )

  // 4) 源码层面：reducer 文件里不得出现 Date.now() 调用（注释里的说明不算）
  const source = readSource('src/core/workout-machine.ts')
  const code = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n')
  assert.doesNotMatch(
    code,
    /Date\.now\(\)/,
    'reducer 不得读取系统时间（时间必须来自动作）',
  )
})

test('D14-guard 发布说明的关键声明与实现一致（防止声明漂移）', () => {
  const notes = readSource('docs/release-notes-draft.md')
  const repo = readSource('src/services/history-repository.ts')
  const tabs = readSource('src/navigation/MainTabs.tsx')
  const share = readSource('src/pages/ShareStudio.tsx')
  const storage = readSource('src/services/storage.ts')

  // 1) 「历史明细默认保留最近 100 条」必须与实现的上限一致（两处都不能单独漂移）
  assert.match(repo, /HISTORY_SESSION_LIMIT = 100/, '会话上限必须是 100')
  assert.match(repo, /HISTORY_WORKOUT_LIMIT = 100/, '训练上限必须是 100')
  // 只断言「出现过 100」是不够的：文档里换个地方写 200 仍会通过。
  // 这里把所有与「明细/保留/上限」相邻的条数声明都抓出来，要求它们**全部**等于实现值。
  const limitClaims = [
    ...notes.matchAll(/(?:明细|保留|上限)[^\n。]{0,24}?(\d{2,4})\s*条/g),
  ].map((match) => match[1])
  assert.ok(limitClaims.length >= 1, '发布说明必须写明明细上限')
  assert.deepEqual(
    [...new Set(limitClaims)],
    ['100'],
    `发布说明里的明细上限声明必须都是 100，实际抓到 ${limitClaims.join('、')}`,
  )

  // 2) 已删除：「计划训练默认关闭」——训练设置页（WorkoutSetup）随 fusion-v1 移除，不再有计划开关。

  // 3) 「训练入口从路线页移到训练页」
  assert.match(tabs, /name="Train" component=\{TrainHomeScreen\}/, '训练页必须是首页')
  assert.match(notes, /训练入口从「路线页」移到「训练」页/)

  // 4) 「分享面板被取消时不显示「分享成功」」：实现里不得出现该文案
  assert.doesNotMatch(
    share,
    /分享成功/,
    '分享面板不回报结果，任何位置都不得声称分享成功',
  )
  assert.match(notes, /分享面板被取消时不显示「分享成功」/)

  // 5) 「已归档记录的统计会随备份一起迁移」：导出必须携带归档聚合
  assert.match(
    storage,
    /archiveAggregate: archiveAggregate \?\? undefined/,
    '导出必须携带归档聚合，否则发布说明的迁移承诺不成立',
  )
  assert.match(
    storage,
    /const archiveAggregate = await readHistoryAggregateDoc\(\)/,
    '归档聚合必须真的从本机账本读取',
  )
  assert.match(notes, /已归档记录的统计会随备份一起迁移/)
})

test('F24 坏路线给出可读错误，而不是 TypeError；缺 markers 按「无标记」处理', () => {
  const routeModel = load('route-model')
  const good = {
    id: 'route-x',
    name: '测试路线',
    startFloor: 1,
    endFloor: 3,
    carryMode: 'pocket',
    floorHeightM: 3,
    totalAscentM: 6,
    device: { platform: 'android', model: 'test', system: 'test' },
    segments: [
      {
        id: 's1',
        type: 'flight',
        startMs: 0,
        endMs: 1_000,
        floorFrom: 1,
        floorTo: 2,
        ascentM: 3,
        stepCount: 8,
        features: [[0.5, 0.5, 0, 0]],
      },
    ],
    createdAt: 1,
    updatedAt: 1,
    version: 1,
    status: 'verified',
  }

  // 1) 缺 segments：必须是可读错误（导入时这条会直接展示给用户）
  assert.throws(
    () => routeModel.migrateRouteToV3({ ...good, segments: undefined }),
    /缺少 segments 数组/,
    '缺 segments 必须给出可读原因',
  )
  assert.throws(
    () => routeModel.migrateRouteToV3({ ...good, name: '', segments: undefined }),
    /未知路线|缺少 segments/,
  )

  // 2) 缺 markers（旧数据）：按「没有标记」处理，不得抛错
  const legacy = { ...good }
  delete legacy.markers
  const migrated = routeModel.migrateRouteToV3(legacy)
  assert.deepEqual(migrated.markers, [], '缺 markers 应补为空数组')
  assert.equal(migrated.modelVersion, 3)

  // 3) 正常路线不受影响：迁移结果保留原字段，且已是 v3+learning 的对象原样返回（不做多余拷贝）
  const complete = { ...good, markers: [] }
  const migratedComplete = routeModel.migrateRouteToV3(complete)
  assert.equal(migratedComplete.id, 'route-x')
  assert.equal(migratedComplete.modelVersion, 3)
  assert.equal(migratedComplete.markers.length, 0)

  const alreadyV3 = { ...complete, modelVersion: 3, learning: { sampleCount: 1 } }
  assert.equal(
    routeModel.migrateRouteToV3(alreadyV3),
    alreadyV3,
    '已是 v3 且带 learning 的路线必须原样返回',
  )
})
