// Deterministic physical trace. Pressure is emitted separately from motion.
// No recognizer thresholds or internal state are used to choose the expected result.
const START = 1_000_000
const DT = 200
function pressureAt(height, elapsed = 0, driftHpaPer10min = 0) {
  return 1013.25 * (1 - height / 44330) ** (1 / 0.190263) + driftHpaPer10min * elapsed / 600000
}
function generateRound(options = {}) {
  const { startAt = START, floors = 14, speed = 0.2, floorHeight = 3, calibration = false,
    drift = 0, noBarometer = false, staleFromHeight = Infinity, staleMs = 20000,
    restAfter = -1, restMs = 40000, descent = 'elevator', missedClick = -1,
    extraClickUndo = false, elevatorUp = false, topPauseMs = 6000 } = options
  let t = startAt, height = 0, stepCarry = 0, staleAt
  const events = []
  const reachedAt = []
  function frame(nextHeight, walking, turn = 0) {
    const before = height
    height = nextHeight; t += DT
    const delta = Math.abs(height - before)
    stepCarry += walking ? delta / (floorHeight / 18) : 0
    const steps = Math.floor(stepCarry + 1e-8)
    stepCarry -= steps
    if (staleAt === undefined && height >= staleFromHeight) staleAt = t
    if (!noBarometer && !(staleAt !== undefined && t >= staleAt && t < staleAt + staleMs)) {
      events.push({ type: 'pressure', t, pressure: pressureAt(height, t - START, drift) })
    }
    events.push({ type: 'frame', t, frame: { startMs: t - DT, endMs: t, steps,
      cadence: steps * 300, energy: walking ? 0.2 : 0, paused: walking ? 0 : 1,
      turnRad: turn, headingTurnRad: turn } })
  }
  function pause(ms) { for (let elapsed = 0; elapsed < ms; elapsed += DT) frame(height, false) }
  pause(6000)
  const ascentAt = t
  for (let f = 1; f <= floors; f++) {
    const target = f * floorHeight
    let halfTurn = false, topTurn = false
    while (height < target - 1e-8) {
      const next = Math.min(target, height + (elevatorUp ? 2 : speed) * DT / 1000)
      let turn = 0
      if (!halfTurn && next >= target - floorHeight / 2) { halfTurn = true; turn = 1.6 }
      if (!topTurn && next >= target - 0.15) { topTurn = true; turn = 1.6 }
      frame(next, !elevatorUp, elevatorUp ? 0 : turn)
    }
    reachedAt.push(t)
    if (calibration && f !== missedClick) {
      events.push({ type: 'click', t })
      if (extraClickUndo && f === 4) {
        events.push({ type: 'click', t }, { type: 'undo', t })
      }
    }
    if (f === restAfter) pause(restMs)
  }
  pause(topPauseMs)
  const descentAt = t
  if (descent !== 'none') {
    const downSpeed = descent === 'stairs' ? 0.3 : 2
    while (height > 1e-8) frame(Math.max(0, height - downSpeed * DT / 1000), descent === 'stairs')
  }
  const returnedAt = t
  pause(8000)
  return { events, ascentAt, reachedAt, descentAt, returnedAt, endedAt: t, staleAt,
    expectedFloors: elevatorUp ? 0 : floors }
}

function replay(engine, trace, observe = () => {}) {
  for (const event of trace.events) {
    if (event.type === 'pressure') engine.pushPressure(event.pressure, event.t)
    if (event.type === 'frame') engine.pushFrame(event.frame)
    if (event.type === 'click') engine.markFloor(event.t)
    if (event.type === 'undo') engine.undoMark()
    observe(engine.snapshot(), event)
  }
}
module.exports = { generateRound, replay, pressureAt, START, DT }
if (require.main === module) {
  const fs = require('node:fs')
  const output = process.argv[2] || 'synthetic-baro.json'
  fs.writeFileSync(output, JSON.stringify(generateRound({ calibration: true }), null, 2))
  console.log(output)
}
