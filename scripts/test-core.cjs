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

test('recognizer: 高度领先时保留步数和整拐并追回漏掉的楼层', () => {
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
  assert.equal(rec.snapshot().currentFloor, 4, '高度到位后应逐层追回，不能锁死')
  assert.equal(rec.snapshot().status, 'complete')
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

test('route model v3: 五次一致可信训练可验证路线', () => {
  const { migrateRouteToV3, updateRouteModelFromWorkouts } = load('route-model')
  const route = migrateRouteToV3(makeCalorieTestTemplate())
  const rounds = Array.from({ length: 5 }, (_, index) => ({
    ...makeRound(index + 1, 30000 + index * 200),
    floorsCompleted: 2,
    ascentM: 6,
    steps: 64 + index,
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
