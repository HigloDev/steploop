const path = require('path')

const compiledRoot =
  process.argv[2] ||
  path.join(__dirname, '..', 'node_modules', '.cache', 'steploop-core')

const floors = require(path.join(compiledRoot, 'floors.js'))
const { RouteRecognizer } = require(path.join(compiledRoot, 'recognizer.js'))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(floors.getFloorTransitionCount(1, 15) === 14, '真实高度必须是14段')
assert(floors.getFloorAchievementCount(1, 15) === 15, '成绩必须显示15层')

const segment = (number) => ({
  id: `segment-${number}`,
  type: 'flight',
  startMs: (number - 1) * 1000,
  endMs: number * 1000,
  floorFrom: number,
  floorTo: number + 1,
  ascentM: 3,
  stepCount: 8,
  features: [[0.2, 0.2, 0, 0]],
})
const template = {
  id: 'route',
  name: '测试路线',
  startFloor: 1,
  endFloor: 3,
  carryMode: 'pocket',
  floorHeightM: 3,
  totalAscentM: 6,
  device: { platform: 'android', model: 'test', system: 'test' },
  segments: [segment(1), segment(2)],
  markers: [],
  createdAt: 0,
  updatedAt: 0,
  version: 1,
  status: 'verified',
}
const recognizer = new RouteRecognizer(template, Date.now())
for (let index = 0; index < 5; index += 1) recognizer.pushBarometer(1000)

// 单帧拐弯帧：steps 可配，默认 8 步（对齐 segment.stepCount）
const turnFrame = (startMs, endMs, turnRad, steps = 8) => ({
  startMs,
  endMs,
  steps,
  cadence: 120,
  energy: 0.1,
  turnRad,
  paused: 0,
})

// 第 1 个整拐（半层）：只有 1 个拐 + 气压高度不够，不能推进整层
recognizer.pushFrame(turnFrame(0, 1000, 1.2))
for (let index = 0; index < 10; index += 1) recognizer.pushBarometer(999.82)
assert(recognizer.snapshot().currentFloor === 1, '半层转弯不能推进整层')

// 第 2 个整拐（方向反转会结算第 1 拐）+ 气压确认整层高度 → 推进到 2 层
recognizer.pushFrame(turnFrame(1000, 2000, -1.2, 0))
recognizer.pushFrame(turnFrame(2000, 3000, 0, 0))
for (let index = 0; index < 20; index += 1) recognizer.pushBarometer(999.66)
assert(recognizer.snapshot().currentFloor === 2, '完整一层（两个整拐+高度确认）后必须推进')

// 第 3/4 个整拐 + 第二层高度确认 → 推进到 3 层并完成
recognizer.pushFrame(turnFrame(3000, 4000, 1.2))
recognizer.pushFrame(turnFrame(4000, 5000, -1.2, 0))
recognizer.pushFrame(turnFrame(5000, 6000, 0, 0))
for (let index = 0; index < 20; index += 1) recognizer.pushBarometer(999.3)
assert(recognizer.snapshot().currentFloor === 3, '第二层不能卡死')
assert(recognizer.snapshot().status === 'complete', '到达终点后必须完成')

console.log('楼层模型检查通过：15层口径、半层拦截、气压脱困均正常')
