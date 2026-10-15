'use strict'
// fusion-v1 核心算法合成测试：标定轮 + 自动轮 + 电梯切轮 + 各类异常。
// 每个场景断言每轮层数与切轮行为。数据由 scripts/fusion-synth.cjs 生成（确定性随机种子）。
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const core = name => require(path.join(__dirname, '../node_modules/.cache/steploop-core', `${name}.js`))
const engineModule = core('fusion-engine')
const { synthesize, runEngine } = require('./fusion-synth.cjs')
const { buildingFromLegacyRoute, ascentForFloors } = core('building-template')
const { buildTemplateFromCalibration } = core('fusion-calibration')
const { fusionRoundToWorkoutRound, buildFusionWorkout, correctRoundFloors, workoutCalories } = core('fusion-workout')
const { estimateClimbCalories } = core('calories')
const { getRoundAchievementCount, getFloorTransitionCount, floorAfter } = core('floors')
const { calculateWorkoutSummary } = core('workout-summary')
const { PressureTrend } = core('pressure-trend')
const { AdaptiveStepDetector } = core('step-detector')
const { BaroAltimeter } = core('baro-altimeter')

const CAL = (extra = {}) => ({ type: 'climb', floors: 14, floorHeight: 3, speedMps: 0.25, tap: true, tapTop: true, ...extra })
const DOWN = (deltaM = -42) => [{ type: 'rest', durMs: 8000 }, { type: 'elevator', deltaM }, { type: 'stand', durMs: 6000 }, { type: 'walk', durMs: 5000 }]

/** 先用一轮标定得到模板，再单独跑自动轮场景（模板复用，等同“选用已保存的楼栋”）。 */
let cachedTemplate
function calibratedTemplate() {
  if (cachedTemplate) return cachedTemplate
  const data = synthesize([{ type: 'stand', durMs: 5000 }, CAL(), ...DOWN()], { seed: 11 })
  const { engine } = runEngine(engineModule, data)
  engine.finish(data.end)
  cachedTemplate = engine.getTemplate()
  return cachedTemplate
}

function autoRun(script, options = {}, engineOptions = {}) {
  const data = synthesize([{ type: 'stand', durMs: 6000 }, { type: 'walk', durMs: 4000 }, ...script], options)
  const template = engineOptions.template ?? calibratedTemplate()
  const result = runEngine(engineModule, data, { template, ...engineOptions })
  const rounds = result.engine.finish(data.end)
  return { ...result, rounds, data }
}

test('场景1 标定轮：1→15 楼每层点一次，到顶坐电梯 → 生成 14 层模板并自动切到下一轮', () => {
  const data = synthesize([{ type: 'stand', durMs: 5000 }, CAL(), ...DOWN(), { type: 'stand', durMs: 4000 }], { seed: 1 })
  const { engine, phases } = runEngine(engineModule, data)
  assert.equal(engine.getPhase(), 'waiting', '电梯到楼下后进入“准备下一轮”')
  assert.ok(phases.some(p => p.phase === 'descending'), '电梯下行被识别')
  const template = engine.getTemplate()
  assert.equal(template.floors.length, 14)
  for (const floor of template.floors) assert.ok(Math.abs(floor.heightM - 3) < 0.35, `层高 ${floor.heightM}`)
  assert.ok(template.floors.every(floor => floor.steps >= 15 && floor.steps <= 20))
  const [round] = engine.getRounds()
  assert.equal(round.kind, 'calibration')
  assert.equal(round.floors, 14)
  assert.equal(round.finalFloor, 15)
  assert.equal(round.estimated, false)
  assert.equal(round.endReason, 'elevator_down')
  // 顶层停留 8s 不计入本轮用时：用时 = 起点到“到顶了”
  const climbMs = 14 * 3 / 0.25 * 1000
  assert.ok(round.durationMs < climbMs + 5000 + 1500, `用时 ${round.durationMs}`)
})

for (const speed of [0.06, 0.1, 0.15, 0.35]) {
  test(`场景2 自动轮：垂直速度 ${speed} m/s 计满 14 层且不标估算`, () => {
    const { rounds } = autoRun([{ type: 'climb', floors: 14, floorHeight: 3, speedMps: speed }, ...DOWN()], { seed: 20 + speed * 100 })
    assert.equal(rounds.length, 1)
    assert.equal(rounds[0].floors, 14)
    assert.equal(rounds[0].endReason, 'elevator_down')
    assert.equal(rounds[0].estimated, false)
  })
}

test('场景3 中途在第 7 层平台休息 40s：不推进、不清空，最终 14 层', () => {
  const { rounds } = autoRun([
    { type: 'climb', floors: 6, floorHeight: 3, speedMps: 0.2 }, { type: 'rest', durMs: 40000 },
    { type: 'climb', floors: 8, floorHeight: 3, speedMps: 0.2 }, ...DOWN(),
  ], { seed: 3 })
  assert.equal(rounds.length, 1)
  assert.equal(rounds[0].floors, 14)
  assert.ok(rounds[0].activeMs < rounds[0].durationMs - 30000, '休息不计入活动时间')
})

test('场景4 爬到 10 楼就坐电梯：本轮按实际最高层记 9 层', () => {
  const { rounds } = autoRun([{ type: 'climb', floors: 9, floorHeight: 3, speedMps: 0.25 }, ...DOWN(-27)], { seed: 4 })
  assert.equal(rounds.length, 1)
  assert.equal(rounds[0].floors, 9)
  assert.equal(rounds[0].finalFloor, 10)
})

test('场景5 气压整体漂移 +0.5 hPa/10min：每轮在楼下归零，两轮都是 14 层', () => {
  const { rounds } = autoRun([
    { type: 'climb', floors: 14, floorHeight: 3, speedMps: 0.25 }, ...DOWN(),
    { type: 'climb', floors: 14, floorHeight: 3, speedMps: 0.25 }, ...DOWN(),
  ], { seed: 5, driftHpaPerMin: 0.05 })
  assert.deepEqual(rounds.map(r => r.floors), [14, 14])
  // 慢爬 0.1 m/s 时漂移累计约 3 米：靠回到楼下的闭合修正 + 步数交叉核对找回最后一层（标估算）
  const slow = autoRun([{ type: 'climb', floors: 14, floorHeight: 3, speedMps: 0.1 }, ...DOWN()], { seed: 5, driftHpaPerMin: 0.05 })
  assert.equal(slow.rounds[0].floors, 14)
  assert.equal(slow.rounds[0].estimated, true)
  // 下行到了地下一层（不是漂移）：步数核对不通过，不做闭合修正
  const basement = autoRun([{ type: 'climb', floors: 14, floorHeight: 3, speedMps: 0.25 }, ...DOWN(-45)], { seed: 21 })
  assert.equal(basement.rounds[0].floors, 14)
})

test('场景6 气压计在第 5 层停更 20s 后恢复：不崩溃、不重复计层，仍为 14 层', () => {
  // 自动轮从 ~10s 开始，每层 12s；第 5 层约在 10 + 48 = 58s
  const { rounds, engine } = autoRun([{ type: 'climb', floors: 14, floorHeight: 3, speedMps: 0.25 }, ...DOWN()],
    { seed: 6, staleWindows: [[58000, 78000]] })
  assert.equal(rounds.length, 1)
  assert.equal(rounds[0].floors, 14)
  assert.equal(engine.getPhase(), 'finished')
})

test('场景7 无气压计：标定轮只记步数和拐弯，自动轮按步数 + 拐弯计层并标估算', () => {
  const data = synthesize([
    { type: 'stand', durMs: 4000 }, CAL(), { type: 'rest', durMs: 5000 },
    { type: 'stand', durMs: 30000 },
    { type: 'climb', floors: 14, floorHeight: 3, speedMps: 0.25 }, { type: 'stand', durMs: 25000 },
  ], { seed: 7, noBaro: true })
  const engine = new engineModule.FusionWorkoutEngine({ startedAt: data.start })
  let lastTick = data.start
  let nextRoundCalled = false
  const calEnd = data.start + 4000 + 14 * 12000 + 1000
  for (const sample of data.samples) {
    for (const tap of data.taps) if (tap.t <= sample.t && !tap.done) {
      tap.done = true
      if (tap.kind === 'floor') engine.markFloor(tap.t); else engine.markTop(tap.t)
    }
    // 无气压无法识别电梯：用户在楼下点“开始下一轮”
    if (!nextRoundCalled && sample.t > calEnd + 20000) { engine.nextRound(sample.t); nextRoundCalled = true }
    engine.pushSample(sample)
    if (sample.t - lastTick >= 500) { engine.tick(sample.t); lastTick = sample.t }
  }
  const rounds = engine.finish(data.end)
  const template = engine.getTemplate()
  assert.equal(template.barometer, false)
  assert.equal(template.floors.length, 14)
  assert.ok(template.floors.every(floor => floor.heightM === undefined))
  assert.equal(rounds.length, 2)
  assert.equal(rounds[0].floors, 14)
  assert.ok(Math.abs(rounds[1].floors - 14) <= 1, `无气压退化计层 ${rounds[1].floors}`)
  assert.equal(rounds[1].estimated, true, '无气压的自动轮必须标估算')
  assert.equal(rounds[1].endReason, 'idle')
})

test('场景8 电梯上行（无步数）：不计层、不开始新一轮', () => {
  const { rounds } = autoRun([{ type: 'elevator', deltaM: 30, speedMps: 1.5 }, { type: 'stand', durMs: 8000 }], { seed: 8 })
  assert.equal(rounds.length, 0)
})

test('场景9 走楼梯下楼代替电梯：识别为本轮结束（stairs_down）', () => {
  const { rounds, engine } = autoRun([
    { type: 'climb', floors: 14, floorHeight: 3, speedMps: 0.25 }, { type: 'rest', durMs: 5000 },
    { type: 'stairs_down', floors: 14 }, { type: 'stand', durMs: 6000 },
  ], { seed: 9 })
  assert.equal(rounds.length, 1)
  assert.equal(rounds[0].floors, 14)
  assert.equal(rounds[0].endReason, 'stairs_down')
  assert.notEqual(engine.getPhase(), 'climbing')
})

test('场景10a 标定轮漏点一层：自动拆分成两层并标估算', () => {
  const data = synthesize([{ type: 'stand', durMs: 5000 }, CAL({ skipTapAt: [6] }), ...DOWN()], { seed: 10 })
  const { engine } = runEngine(engineModule, data)
  engine.finish(data.end)
  const template = engine.getTemplate()
  assert.equal(template.floors.length, 14)
  assert.equal(template.floors.filter(floor => floor.estimated).length, 2)
  const [round] = engine.getRounds()
  assert.equal(round.floors, 14)
  assert.equal(round.estimated, true)
  assert.ok(engine.getCalibrationWarnings().some(text => text.includes('漏点')))
})

test('场景10b 标定轮多点一层再撤销：仍为 14 层', () => {
  const data = synthesize([{ type: 'stand', durMs: 5000 }, CAL({ extraTapAt: [4] }), ...DOWN()], { seed: 12 })
  const { engine } = runEngine(engineModule, data)
  engine.finish(data.end)
  assert.equal(engine.getTemplate().floors.length, 14)
  assert.equal(engine.getRounds()[0].floors, 14)
})

test('场景11 地下室出发 -2 → 10：楼层跳过 0，记 11 层', () => {
  assert.equal(getFloorTransitionCount(-2, 10), 11)
  assert.equal(getFloorTransitionCount(-1, 1), 1)
  assert.equal(floorAfter(-2, 11), 10)
  const data = synthesize([{ type: 'stand', durMs: 5000 }, CAL({ floors: 11 }), ...DOWN(-33),
    { type: 'climb', floors: 11, floorHeight: 3, speedMps: 0.25 }, ...DOWN(-33)], { seed: 13 })
  const { engine } = runEngine(engineModule, data, { startFloor: -2 })
  const rounds = engine.finish(data.end)
  assert.equal(engine.getTemplate().floors.at(-1).floorTo, 10)
  assert.deepEqual(rounds.map(r => r.floors), [11, 11])
  assert.deepEqual(rounds.map(r => r.finalFloor), [10, 10])
})

test('场景12 大堂层更高（5.5m）：标定不拆分、不误报，自动轮仍为 14 层', () => {
  const heights = [5.5, ...Array(13).fill(3)]
  const data = synthesize([{ type: 'stand', durMs: 5000 }, CAL({ floorHeights: heights }), ...DOWN(-44.5),
    { type: 'climb', floors: 14, floorHeights: heights, speedMps: 0.2 }, ...DOWN(-44.5)], { seed: 14 })
  const { engine } = runEngine(engineModule, data)
  const rounds = engine.finish(data.end)
  const template = engine.getTemplate()
  assert.equal(template.floors.length, 14)
  assert.ok(Math.abs(template.floors[0].heightM - 5.5) < 0.4, `大堂 ${template.floors[0].heightM}`)
  assert.equal(template.floors[0].warning, undefined)
  assert.deepEqual(rounds.map(r => r.floors), [14, 14])
  assert.ok(Math.abs(rounds[1].ascentM - 44.5) < 1.5)
})

test('场景13 开门压力跳变噪声：瞬时 ±0.15hPa 不推进楼层、不误判起爬', () => {
  const spikes = [[3000, 1500, 0.15], [30000, 2000, -0.12], [70000, 1800, 0.15], [120000, 2000, -0.15]]
  const { rounds } = autoRun([{ type: 'climb', floors: 14, floorHeight: 3, speedMps: 0.25 }, ...DOWN()],
    { seed: 15, doorSpikes: spikes })
  assert.equal(rounds.length, 1)
  assert.equal(rounds[0].floors, 14)
  // 只在楼下站着时出现跳变：不应开始新一轮
  const idle = autoRun([{ type: 'stand', durMs: 30000 }], { seed: 16, doorSpikes: [[8000, 2000, -0.15], [20000, 2000, -0.15]] })
  assert.equal(idle.rounds.length, 0)
})

test('场景14 传感器短暂中断 3s：只记录中断，不让整轮降级', () => {
  const data = synthesize([{ type: 'stand', durMs: 6000 }, { type: 'walk', durMs: 4000 },
    { type: 'climb', floors: 14, floorHeight: 3, speedMps: 0.25 }, ...DOWN()], { seed: 17 })
  const gapFrom = data.start + 60000
  data.samples = data.samples.filter(sample => sample.t < gapFrom || sample.t > gapFrom + 3000)
  const { engine } = runEngine(engineModule, data, { template: calibratedTemplate() })
  const rounds = engine.finish(data.end)
  assert.equal(rounds[0].floors, 14)
  assert.equal(rounds[0].interruptions.length, 1)
  assert.equal(rounds[0].estimated, false)
})

test('多轮：标定 + 两个自动轮连续切轮，总层数 42', () => {
  const data = synthesize([{ type: 'stand', durMs: 5000 }, CAL(), ...DOWN(),
    { type: 'climb', floors: 14, floorHeight: 3, speedMps: 0.3 }, ...DOWN(),
    { type: 'climb', floors: 14, floorHeight: 3, speedMps: 0.2 }, ...DOWN()], { seed: 18 })
  const { engine } = runEngine(engineModule, data)
  const rounds = engine.finish(data.end)
  assert.deepEqual(rounds.map(r => r.kind), ['calibration', 'auto', 'auto'])
  assert.deepEqual(rounds.map(r => r.floors), [14, 14, 14])
  const snapshot = engine.snapshot(data.end)
  assert.equal(snapshot.totalFloors, 42)
})

test('气压时间戳：重复的“旧值 + 新时间戳”不会被当作新的气压事件；停更 > 2s 标 stale', () => {
  const baro = new BaroAltimeter()
  for (let t = 0; t <= 5000; t += 200) baro.push(t, 1000 - t * 0.00002)
  assert.equal(baro.isStale(5000), false)
  assert.equal(baro.isStale(7200), true)
  assert.equal(baro.push(4000, 999), undefined, '时间戳不递增的事件被丢弃')
  const engine = new engineModule.FusionWorkoutEngine({ startedAt: 0, template: calibratedTemplate() })
  for (let t = 0; t <= 2000; t += 20) engine.pushSample({ t, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0, alpha: 0, beta: 0, gamma: 0, pressure: 1000, pressureT: 0 })
  // 2s 后仍是 pressureT=0 的同一事件 → stale
  for (let t = 2020; t <= 5000; t += 20) engine.pushSample({ t, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0, alpha: 0, beta: 0, gamma: 0, pressure: 1000, pressureT: 0 })
  assert.equal(engine.snapshot(5000).baro, 'stale')
})

test('慢速爬楼：旧 PressureTrend 不再把 0.06 m/s 判为 level', () => {
  const trend = new PressureTrend()
  let snapshot
  for (let t = 0; t <= 20000; t += 200) snapshot = trend.push(1000 - (0.06 * t / 1000) / 8.3, t)
  assert.equal(snapshot.direction, 'up')
})

test('计步：自适应阈值 + 迟滞，同一步的抖动不重复计', () => {
  const detector = new AdaptiveStepDetector()
  let steps = 0
  for (let t = 0; t < 10000; t += 20) {
    const phase = t % 600
    // 每 600ms 一步，峰值附近叠加小抖动
    const value = phase < 250 ? 0.3 * Math.sin(Math.PI * phase / 250) + (phase > 100 && phase < 150 ? (t % 40 ? 0.03 : -0.03) : 0) : 0.01
    if (detector.push(t, value)) steps += 1
  }
  assert.ok(Math.abs(steps - 17) <= 1, `steps=${steps}`)
  // 静置噪声不计步
  const still = new AdaptiveStepDetector()
  let noise = 0
  for (let t = 0; t < 10000; t += 20) if (still.push(t, 0.02 + (t % 60 ? 0.01 : 0))) noise += 1
  assert.equal(noise, 0)
})

test('热量：按爬升机械功 + 活动 MET；同样 14 层，爬得慢不会更高', () => {
  const fast = estimateClimbCalories({ ascentM: 42, activeMs: 120000, bodyWeightKg: 70 })
  const slow = estimateClimbCalories({ ascentM: 42, activeMs: 420000, bodyWeightKg: 70 })
  assert.ok(fast > 30 && fast < 60, `fast=${fast}`)
  assert.ok(slow - fast < 25, '慢爬只多出水平代谢部分')
  assert.ok(estimateClimbCalories({ ascentM: 42, activeMs: 120000, bodyWeightKg: 90 }) > fast)
  assert.equal(estimateClimbCalories({ ascentM: 0, activeMs: 0, bodyWeightKg: 70 }), 0)
})

test('结算页修改层数：爬升按模板逐层层高重算，原值进入修正链', () => {
  const template = buildTemplateFromCalibration({ startFloor: 1, barometer: true, boundaries: [
    { t: 0, steps: 0, turns: 0, heightM: 0 }, { t: 10000, steps: 18, turns: 2, heightM: 5 },
    { t: 20000, steps: 36, turns: 4, heightM: 8 }, { t: 30000, steps: 54, turns: 6, heightM: 11 },
  ] }).template
  const fusionRound = { id: 'r1', roundNumber: 1, kind: 'auto', startedAt: 0, topAt: 30000, endedAt: 40000, startFloor: 1, finalFloor: 3,
    floors: 2, ascentM: 8, steps: 36, activeMs: 25000, durationMs: 30000, estimated: true, confidence: 0.5, floorRecords: [],
    endReason: 'elevator_down', interruptions: [], baroCoverage: 1, notes: [] }
  const workout = buildFusionWorkout({ id: 'w', startedAt: 0, endedAt: 60000, status: 'completed', template, rounds: [fusionRoundToWorkoutRound(fusionRound)] })
  assert.equal(workout.totalFloorsCompleted, 2)
  const corrected = correctRoundFloors(workout, 'r1', 3, template)
  assert.equal(corrected.rounds[0].floorsCompleted, 3)
  assert.equal(corrected.rounds[0].finalFloor, 4)
  assert.equal(corrected.rounds[0].ascentM, 11, '5 + 3 + 3 = 11 米（大堂层更高）')
  assert.equal(corrected.totalFloorsCompleted, 3)
  assert.equal(corrected.totalAscentM, 11)
  assert.equal(corrected.rounds[0].corrections.length, 1)
  assert.equal(corrected.rounds[0].corrections[0].before.floorsCompleted, 2)
  assert.equal(corrected.rounds[0].estimated, false)
  // 从 0 层修正（旧实现 0 层时爬升不更新）
  const zero = correctRoundFloors(buildFusionWorkout({ id: 'w2', startedAt: 0, endedAt: 1, status: 'completed', template,
    rounds: [fusionRoundToWorkoutRound({ ...fusionRound, floors: 0, finalFloor: 1, ascentM: 0 })] }), 'r1', 2, template)
  assert.equal(zero.rounds[0].ascentM, 8)
  assert.ok(workoutCalories(corrected) > 0)
  const historical = { ...workout, buildingId: 'deleted-building', templateId: 'deleted-building', templateVersion: 7,
    routeSnapshot: { ...workout.routeSnapshot, name: '已删除的测试楼栋', locationName: '测试位置' }, customMetadata: 'retain' }
  const withoutTemplate = correctRoundFloors(historical, 'r1', 4, undefined, 90000)
  assert.equal(withoutTemplate.totalFloorsCompleted, 4)
  assert.equal(withoutTemplate.buildingId, 'deleted-building')
  assert.equal(withoutTemplate.templateId, 'deleted-building')
  assert.equal(withoutTemplate.templateVersion, 7)
  assert.deepEqual(withoutTemplate.routeSnapshot, historical.routeSnapshot)
  assert.equal(withoutTemplate.customMetadata, 'retain')
  assert.equal(withoutTemplate.updatedAt, 90000)
})

test('旧数据兼容：motion-v3 记录与旧路线可读，不崩溃', () => {
  const legacyRound = { id: 'old', roundNumber: 1, recognitionVersion: 'motion-v3', startedAt: 0, endedAt: 1000, durationMs: 200000,
    startFloor: 1, targetFloor: 15, finalFloor: 15, floorsCompleted: 15, ascentM: 45, steps: 300, confidence: 0.9, complete: true,
    completionReason: 'route_complete', floorSplits: [], events: [], interruptions: [] }
  assert.equal(getRoundAchievementCount(legacyRound), 14, '旧记录统一按爬升段数显示')
  assert.equal(getRoundAchievementCount({ ...legacyRound, floorConfirmation: 'pending' }), 0)
  assert.equal(getRoundAchievementCount({ startFloor: 1, finalFloor: 1, floorsCompleted: 6 }), 6, '缺少楼层号的更旧记录保留原层数')
  const summary = calculateWorkoutSummary([legacyRound], 0, 300000)
  assert.equal(summary.totalFloors, 14)
  assert.ok(workoutCalories({ rounds: [legacyRound], startedAt: 0, endedAt: 300000, totalElapsedMs: 300000 }) > 0)
  const legacyRoute = { id: 'route1', name: '老楼', startFloor: 1, endFloor: 6, carryMode: 'pocket', floorHeightM: 3, totalAscentM: 15,
    device: { platform: 'android', model: 'x', system: '14' }, markers: [], createdAt: 1, updatedAt: 2, version: 3, status: 'verified',
    segments: [1, 2, 3, 4, 5].map(i => ({ id: `s${i}`, type: 'flight', startMs: i * 1000, endMs: i * 1000 + 900, floorFrom: i, floorTo: i + 1,
      ascentM: 3, stepCount: 18, features: [], turnCount: 2 })) }
  const building = buildingFromLegacyRoute(legacyRoute)
  assert.equal(building.floors.length, 5)
  assert.equal(building.needsCalibration, false)
  assert.equal(ascentForFloors(building, 5), 15)
  const sparse = buildingFromLegacyRoute({ ...legacyRoute, segments: [] })
  assert.equal(sparse.floors.length, 5)
  assert.equal(sparse.needsCalibration, true)
  // 旧路线模板可直接用于自动轮（有逐层步数/层高）
  const { rounds } = autoRun([{ type: 'climb', floors: 5, floorHeight: 3, speedMps: 0.25 }, ...DOWN(-15)], { seed: 19 }, { template: building })
  assert.equal(rounds[0].floors, 5)
})

test('锁屏后台回放：墙钟已超前、样本按原生时间戳补送，仍正常计层与切轮', () => {
  const data = synthesize([{ type: 'stand', durMs: 6000 }, { type: 'walk', durMs: 4000 },
    { type: 'climb', floors: 14, floorHeight: 3, speedMps: 0.25 }, ...DOWN()], { seed: 22 })
  const engine = new engineModule.FusionWorkoutEngine({ startedAt: data.start, template: calibratedTemplate() })
  // 前 30s 正常送达，之后 JS 被挂起；恢复时墙钟已到训练结束之后，剩余样本一次性回放
  const cut = data.start + 30000
  for (const sample of data.samples) if (sample.t <= cut) engine.pushSample(sample)
  engine.tick(data.end + 60000)
  for (const sample of data.samples) if (sample.t > cut) engine.pushSample(sample)
  const rounds = engine.finish(data.end + 60000)
  assert.equal(rounds.length, 1)
  assert.equal(rounds[0].floors, 14)
  assert.equal(rounds[0].endReason, 'elevator_down')
})
