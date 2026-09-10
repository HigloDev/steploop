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
      { id: 's1', type: 'flight', startMs: 0, endMs: 4000, floorFrom: 1, floorTo: 2, ascentM: 3, stepCount: 16, features: [[2, 8, 0, 0]] },
      { id: 's2', type: 'flight', startMs: 4000, endMs: 8000, floorFrom: 2, floorTo: 3, ascentM: 3, stepCount: 16, features: [[2, 8, 0, 0]] },
    ],
    markers: [],
    createdAt: 0,
    updatedAt: 0,
    version: 1,
    status: 'verified',
  }
}

function samples(durationMs, { climb }) {
  const out = []
  const pressure0 = 1000
  for (let t = 0; t <= durationMs; t += 20) {
    const phase = Math.floor(t / 400)
    const walking = climb && phase % 2 === 0
    const stepPulse = walking ? Math.sin((t / 250) * Math.PI * 2) * 3.5 : 0
    const floorProgress = climb ? Math.min(2, t / 4000) : 0
    out.push({
      t,
      ax: stepPulse * 0.2,
      ay: stepPulse * 0.1,
      az: 1 + stepPulse * 0.15,
      gx: 0,
      gy: 0,
      gz: walking ? 0.02 : 0,
      alpha: 0,
      beta: 0,
      gamma: 0,
      pressure: pressure0 - floorProgress * 1.2,
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
  durationMs: 12_000,
  activity: 'climb_up',
  carryMode: 'pocket',
  routeTemplate: template(),
  truth: { startFloor: 1, endFloor: 3, completedFloors: 2 },
  samples: samples(12_000, { climb: true }),
  annotations: [
    { type: 'floor', atMs: 4200, floor: 2 },
    { type: 'floor', atMs: 8200, floor: 3 },
  ],
  gaps: [],
  capture: {
    platform: 'android',
    systemVersion: 'synthetic',
    sampleIntervalTargetMs: 20,
    barometerAvailable: true,
    deviceCohortId: 'synthetic-android',
  },
  algorithmVersion: 'trusted-v2.0.0',
  parameterVersion: 'evidence-1',
  datasetId: 'synthetic-pipeline-check',
  routeModelVersion: 3,
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
    algorithmVersion: 'trusted-v2.0.0',
    parameterVersion: 'evidence-1',
    datasetId: 'synthetic-pipeline-check',
    routeModelVersion: 3,
  }),
)

const files = [writeBundle('climb-01.json', climb), ...negatives.map((b, i) => writeBundle(`neg-${i + 1}.json`, b))]
console.log(JSON.stringify({ outDir, files }, null, 2))
