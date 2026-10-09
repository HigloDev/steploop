// 生成合成诊断夹具，仅用于验证回放/门禁链路，不能当作真实准确率证据。
// 用法：node scripts/make-synthetic-diagnostics.cjs <outDir>
const fs = require('node:fs')
const path = require('node:path')

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', '.diagnostics-synthetic'))
fs.mkdirSync(outDir, { recursive: true })

function template() {
  return {
    id: 'route-synthetic',
    name: '诊断路线',
    startFloor: 1,
    endFloor: 3,
    carryMode: 'pocket',
    floorHeightM: 3,
    totalAscentM: 6,
    device: { platform: 'android', model: 'redacted', system: 'test' },
    segments: [
      {
        id: 's1',
        type: 'flight',
        startMs: 0,
        endMs: 3000,
        floorFrom: 1,
        floorTo: 2,
        ascentM: 3,
        stepCount: 16,
        features: Array.from({ length: 6 }, () => [0.8, 0.85, 0, 0]),
      },
      {
        id: 's2',
        type: 'flight',
        startMs: 5100,
        endMs: 8100,
        floorFrom: 2,
        floorTo: 3,
        ascentM: 3,
        stepCount: 16,
        features: Array.from({ length: 6 }, () => [0.8, 0.85, 0, 0]),
      },
    ],
    markers: [],
    createdAt: 0,
    updatedAt: 0,
    version: 1,
    status: 'verified',
  }
}

// 每层：飞行 3.0s + 平台两整拐（各 0.55s，间隔 1.0s，避免被 turn-gate 合并）
const FLOOR_MS = 5100
const TURN_MS = 550
const TURN_GAP_MS = 1000
const TURN_RATE = (Math.PI / 2) / (TURN_MS / 1000)

function climbPhase(t) {
  const inFloor = t % FLOOR_MS
  const floorIndex = Math.floor(t / FLOOR_MS)
  const flightEnd = FLOOR_MS - (2 * TURN_MS + TURN_GAP_MS)
  if (inFloor < flightEnd) return { kind: 'flight', floorIndex }
  const turnT = inFloor - flightEnd
  const firstTurnEnd = TURN_MS
  const secondTurnStart = TURN_MS + TURN_GAP_MS
  if (turnT < firstTurnEnd) return { kind: 'turn', floorIndex, turn: 1 }
  if (turnT < secondTurnStart) return { kind: 'landing', floorIndex }
  if (turnT < secondTurnStart + TURN_MS) return { kind: 'turn', floorIndex, turn: 2 }
  return { kind: 'landing', floorIndex }
}

function samples(durationMs, { climb }) {
  const out = []
  const pressure0 = 1000
  // 气压：每完成一层下降约 3m/8.3 ≈ 0.361 hPa
  const hpaPerFloor = 3 / 8.3
  for (let t = 0; t <= durationMs; t += 20) {
    let ax = 0
    let ay = 0
    let az = 1
    let gx = 0
    let gy = 0
    let gz = 0
    let floorsDone = 0
    if (climb) {
      const phase = climbPhase(t)
      floorsDone = Math.min(2, phase.floorIndex + (phase.kind === 'landing' && phase.floorIndex >= 1 ? 1 : 0))
      // 更接近真实的竖直加速度台阶，便于 extractFrames 检出步数
      if (phase.kind === 'flight') {
        // 离散步频脉冲：每 280ms 一个短峰，便于上升沿触发 STEP_THRESHOLD
        const stepPhase = (t % 280) / 280
        const pulse = stepPhase < 0.3 ? Math.sin((stepPhase / 0.3) * Math.PI) : 0
        ax = pulse * 0.2
        ay = pulse * 0.1
        az = 1 + pulse * 0.9
      } else if (phase.kind === 'turn') {
        gz = TURN_RATE
      }
      // 高度：飞行段线性爬升，平台段保持
      if (phase.kind === 'flight') {
        const flightEnd = FLOOR_MS - (2 * TURN_MS + TURN_GAP_MS)
        const local = Math.min(1, (t % FLOOR_MS) / flightEnd)
        floorsDone = phase.floorIndex + local
      }
    }
    out.push({
      t,
      ax,
      ay,
      az,
      gx,
      gy,
      gz,
      alpha: 0,
      beta: 0,
      gamma: 0,
      pressure: pressure0 - floorsDone * hpaPerFloor,
    })
  }
  return out
}

function writeBundle(name, payload) {
  const file = path.join(outDir, name)
  fs.writeFileSync(file, JSON.stringify(payload, null, 2))
  return file
}

const climb = {
  version: 2,
  id: 'synthetic-climb-01',
  createdAt: 1_700_000_000_000,
  durationMs: 14_000,
  activity: 'climb_up',
  carryMode: 'pocket',
  routeTemplate: template(),
  truth: { startFloor: 1, endFloor: 3, completedFloors: 2 },
  samples: samples(14_000, { climb: true }),
  annotations: [
    { type: 'floor', atMs: 5100, floor: 2 },
    { type: 'floor', atMs: 10200, floor: 3 },
  ],
  gaps: [],
  capture: {
    platform: 'android',
    systemVersion: 'synthetic',
    sampleIntervalTargetMs: 20,
    barometerAvailable: true,
    deviceCohortId: 'synthetic-android',
  },
  algorithmVersion: 'trusted-v2.1.0',
  parameterVersion: 'evidence-1',
  datasetId: 'synthetic-pipeline-check',
  routeModelVersion: 3,
  featureSpace: 'heading',
}

const negatives = ['stationary', 'walk_flat', 'elevator_down', 'stairs_down'].map(
  (activity, index) => ({
    version: 2,
    id: `synthetic-neg-${activity}`,
    createdAt: 1_700_000_000_000 + index,
    durationMs: 6_000,
    activity,
    carryMode: 'pocket',
    routeTemplate: template(),
    truth: { startFloor: 1, endFloor: 1, completedFloors: 0 },
    samples: samples(6_000, { climb: false }),
    annotations: [],
    gaps: [],
    capture: {
      platform: 'android',
      systemVersion: 'synthetic',
      sampleIntervalTargetMs: 20,
      barometerAvailable: true,
      deviceCohortId: 'synthetic-android',
    },
    algorithmVersion: 'trusted-v2.1.0',
    parameterVersion: 'evidence-1',
    datasetId: 'synthetic-pipeline-check',
    routeModelVersion: 3,
  }),
)

const files = [writeBundle('climb-01.json', climb), ...negatives.map((b, i) => writeBundle(`neg-${i + 1}.json`, b))]
console.log(JSON.stringify({ outDir, files }, null, 2))
