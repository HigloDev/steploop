'use strict'
// fusion-v1 合成传感器数据生成器：按脚本生成加速度/陀螺仪样本、气压事件（带自身时间戳）与用户点击。
// 坐标假设：手机平放，重力沿 z 轴（az≈1g），绕竖直方向转弯即 gz。

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function altToPressure(altM) {
  return 1013.25 * Math.pow(1 - altM / 44330, 1 / 0.190263)
}

/**
 * script: [{ type: 'stand'|'rest'|'walk'|'climb'|'elevator'|'stairs_down', ... }]
 * options: { start, hz, seed, baroHz, driftHpaPerMin, staleWindows:[[from,to]], noBaro, doorSpikes:[[at,durMs,hPa]] }
 */
function synthesize(script, options = {}) {
  const rand = mulberry32(options.seed ?? 7)
  const hz = options.hz ?? 25
  const dt = 1000 / hz
  const start = options.start ?? 1_700_000_000_000
  const baroDt = 1000 / (options.baroHz ?? 5)
  const samples = []
  const taps = []          // { t, kind: 'floor'|'top' }
  const marks = []         // 真实事件时间（断言用）：{ t, kind, ... }
  let t = start
  let height = 0
  let heading = 0
  const stepTimes = []
  // 生成时间轴上的高度/步/转向函数
  const timeline = []    // { t0, t1, h0, h1, steps: [t], turns: [{t0,t1,rad}] }
  for (const seg of script) {
    if (seg.type === 'stand' || seg.type === 'rest') {
      timeline.push({ t0: t, t1: t + seg.durMs, h0: height, h1: height, steps: [], turns: [] })
      t += seg.durMs
    } else if (seg.type === 'walk') {
      const interval = seg.stepIntervalMs ?? 550
      const steps = []
      for (let s = t + interval / 2; s < t + seg.durMs; s += interval) steps.push(s)
      timeline.push({ t0: t, t1: t + seg.durMs, h0: height, h1: height, steps, turns: [] })
      t += seg.durMs
    } else if (seg.type === 'climb') {
      const floors = seg.floors
      const heights = Array.isArray(seg.floorHeights) ? seg.floorHeights : Array(floors).fill(seg.floorHeight ?? 3)
      const speed = seg.speedMps ?? 0.25
      for (let f = 0; f < floors; f += 1) {
        const h = heights[f]
        const stepsPerFloor = Math.round((seg.stepsPerFloor ?? 18) * h / 3)
        const durMs = (h / speed) * 1000
        const steps = []
        const turns = []
        // 两跑楼梯：中间平台和楼层平台各转 180°
        const turnRad = seg.turnRad ?? Math.PI
        for (let s = 0; s < stepsPerFloor; s += 1) steps.push(t + (s + 0.5) * durMs / stepsPerFloor)
        if (seg.turns !== 0) {
          turns.push({ t0: t + durMs * 0.45, t1: t + durMs * 0.45 + 1600, rad: turnRad })
          turns.push({ t0: t + durMs * 0.95, t1: t + durMs * 0.95 + 1600, rad: turnRad })
        }
        timeline.push({ t0: t, t1: t + durMs, h0: height, h1: height + h, steps, turns })
        t += durMs
        height += h
        marks.push({ t, kind: 'floor_reached', height })
        if (seg.tap) {
          const skip = seg.skipTapAt && seg.skipTapAt.includes(f + 1)
          if (!skip) taps.push({ t: t + (seg.tapDelayMs ?? 300), kind: f === floors - 1 && seg.tapTop ? 'top' : 'floor' })
          if (seg.extraTapAt && seg.extraTapAt.includes(f + 1)) {
            taps.push({ t: t + 1500, kind: 'floor' })
            taps.push({ t: t + 2500, kind: 'undo' })
          }
        }
      }
    } else if (seg.type === 'elevator') {
      const speed = Math.abs(seg.speedMps ?? 1.5)
      const delta = seg.deltaM
      const durMs = Math.abs(delta) / speed * 1000 + 3000
      // 加减速 1.5s
      timeline.push({ t0: t, t1: t + durMs, h0: height, h1: height + delta, steps: [], turns: [], ease: true })
      t += durMs
      height += delta
      marks.push({ t, kind: 'elevator_end', height })
    } else if (seg.type === 'stairs_down') {
      const floors = seg.floors
      const h = seg.floorHeight ?? 3
      const speed = seg.speedMps ?? 0.45
      for (let f = 0; f < floors; f += 1) {
        const durMs = h / speed * 1000
        const steps = []
        for (let s = 0; s < 18; s += 1) steps.push(t + (s + 0.5) * durMs / 18)
        timeline.push({ t0: t, t1: t + durMs, h0: height, h1: height - h, steps,
          turns: [{ t0: t + durMs * 0.45, t1: t + durMs * 0.45 + 1500, rad: -Math.PI }, { t0: t + durMs * 0.95, t1: t + durMs * 0.95 + 1500, rad: -Math.PI }] })
        t += durMs
        height -= h
      }
    }
  }
  const end = t
  const heightAt = (time) => {
    for (const seg of timeline) {
      if (time >= seg.t0 && time <= seg.t1) {
        let f = (time - seg.t0) / Math.max(1, seg.t1 - seg.t0)
        if (seg.ease) f = f * f * (3 - 2 * f)
        return seg.h0 + (seg.h1 - seg.h0) * f
      }
    }
    return timeline.at(-1)?.h1 ?? 0
  }
  const allSteps = timeline.flatMap(seg => seg.steps)
  const allTurns = timeline.flatMap(seg => seg.turns)
  let stepIndex = 0
  const baseAlt = options.baseAltM ?? 20
  const stale = options.staleWindows ?? []
  const spikes = options.doorSpikes ?? []
  let nextBaro = start
  let lastPressure, lastPressureT
  for (let time = start; time <= end; time += dt) {
    while (stepIndex < allSteps.length && allSteps[stepIndex] < time - 300) stepIndex += 1
    let bump = 0
    for (let i = stepIndex; i < allSteps.length && allSteps[i] <= time + 300; i += 1) {
      const d = time - allSteps[i]
      if (d >= 0 && d <= 250) bump += (options.stepAmpG ?? 0.38) * Math.sin(Math.PI * d / 250)
    }
    let gz = 0
    for (const turn of allTurns) if (time >= turn.t0 && time <= turn.t1) gz += turn.rad / ((turn.t1 - turn.t0) / 1000)
    const noise = () => (rand() - 0.5) * 0.02
    // 电梯振动：轻微噪声
    const sample = { t: Math.round(time), ax: noise(), ay: noise(), az: 1 + bump + noise(), gx: 0, gy: 0, gz: gz + noise(),
      alpha: 0, beta: 0, gamma: 0 }
    if (!options.noBaro) {
      if (time >= nextBaro) {
        nextBaro += baroDt
        const inStale = stale.some(([a, b]) => time - start >= a && time - start < b)
        if (!inStale) {
          const minutes = (time - start) / 60000
          let p = altToPressure(baseAlt + heightAt(time)) + (options.driftHpaPerMin ?? 0) * minutes + (rand() - 0.5) * 0.02
          for (const [at, dur, hPa] of spikes) if (time - start >= at && time - start < at + dur) p += hPa
          lastPressure = p
          lastPressureT = Math.round(time)
        }
      }
      // 原生口径：最近一次气压附在样本上，同时带气压事件自身时间戳
      if (lastPressure !== undefined) { sample.pressure = lastPressure; sample.pressureT = lastPressureT }
    }
    samples.push(sample)
  }
  return { samples, taps, marks, start, end }
}

/** 把样本和点击按时间送入引擎。 */
function runEngine(core, data, engineOptions = {}) {
  const engine = new core.FusionWorkoutEngine({ startedAt: data.start, ...engineOptions })
  const taps = [...data.taps].sort((a, b) => a.t - b.t)
  let tapIndex = 0
  let lastTick = data.start
  const phases = []
  for (const sample of data.samples) {
    while (tapIndex < taps.length && taps[tapIndex].t <= sample.t) {
      const tap = taps[tapIndex++]
      if (tap.kind === 'floor') engine.markFloor(tap.t)
      else if (tap.kind === 'top') engine.markTop(tap.t)
      else if (tap.kind === 'undo') engine.undoMark()
    }
    engine.pushSample(sample)
    if (sample.t - lastTick >= 500) { engine.tick(sample.t); lastTick = sample.t }
    const phase = engine.getPhase()
    if (!phases.length || phases.at(-1).phase !== phase) phases.push({ phase, t: sample.t })
  }
  return { engine, phases }
}

module.exports = { synthesize, runEngine, altToPressure }
