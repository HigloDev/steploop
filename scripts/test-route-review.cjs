// Real Review screen handlers + real storage/migration/learning, with only React/native
// rendering and AsyncStorage boundaries replaced. No device or network is used.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')

const repo = path.join(__dirname, '..')
const compiled = path.join(repo, 'node_modules/.cache/prd-route-review')
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'),
  '--ignoreConfig', '--ignoreDeprecations', '6.0', '--lib', 'es2022,dom',
  '--rootDir', 'src', '--outDir', compiled, '--module', 'commonjs',
  '--moduleResolution', 'node', '--target', 'es2020', '--esModuleInterop',
  '--skipLibCheck', '--resolveJsonModule', 'src/services/storage.ts',
  'src/services/draft.ts', 'src/core/analysis.ts', 'src/core/route-learning.ts',
], { cwd: repo, stdio: 'pipe' })

const ROUTES = 'palou.routes.v3'
const DRAFT = 'palou.draft.calibrate.v1'
const protectedEntries = {
  'palou.sessions.v1': JSON.stringify([{ id: 'old-session', templateId: 'route-existing', events: [{ t: 700, type: 'floor', floor: 2 }] }]),
  'palou.workouts.v1': JSON.stringify([{ id: 'old-workout', templateId: 'route-existing', rounds: [{ id: 'old-round', corrections: [{ id: 'old-correction', original: { finalFloor: 12 }, corrected: { finalFloor: 15 } }] }] }]),
  'palou.historyAgg.v1': JSON.stringify({ schemaVersion: 1, workouts: { writtenTotal: 123, floors: 714, byDay: { '2026-10-03': { floors: 28 } } }, sessions: { writtenTotal: 9 }, updatedAt: 1000 }),
  'palou.storageMeta.v1': JSON.stringify({ sessionsTrimmed: 1, workoutsTrimmed: 23 }),
  'palou.activeWorkout.v1': JSON.stringify({ workoutId: 'other-active-workout', phase: 'recovering', savedAt: 1100 }),
}
const clone = value => JSON.parse(JSON.stringify(value))

function createEnvironment() {
  const values = new Map(), calls = [], modules = new Map()
  let failingRouteWrites = 0
  const asyncStorage = {
    async getItem(key) { return values.get(key) ?? null },
    async setItem(key, value) {
      calls.push(['set', key])
      if (key === ROUTES && failingRouteWrites > 0) {
        failingRouteWrites--
        throw Error('injected disk full')
      }
      values.set(key, String(value))
    },
    async removeItem(key) { calls.push(['remove', key]); values.delete(key) },
    async getAllKeys() { return [...values.keys()] },
  }
  function load(relative) {
    const filename = path.resolve(compiled, relative)
    if (modules.has(filename)) return modules.get(filename).exports
    const module = { exports: {} }
    modules.set(filename, module)
    const localRequire = name => {
      if (name === '@react-native-async-storage/async-storage') return asyncStorage
      if (name === 'react-native') return {
        Platform: { OS: 'android' },
        NativeModules: { AndroidTrainingSensors: { preparationDeviceKey: async () => 'review-test-device' } },
      }
      if (name.startsWith('.')) {
        const resolved = path.resolve(path.dirname(filename), name)
        return load(path.relative(compiled, path.extname(resolved) ? resolved : `${resolved}.js`))
      }
      throw Error(`Unexpected platform import: ${name}`)
    }
    new Function('require', 'module', 'exports', '__filename', '__dirname', fs.readFileSync(filename, 'utf8'))(
      localRequire, module, module.exports, filename, path.dirname(filename),
    )
    return module.exports
  }
  return { values, calls, load, failNextRouteWrite: () => { failingRouteWrites++ } }
}

function referenceRoute(overrides = {}) {
  return {
    id: 'route-existing', name: 'Stored route', startFloor: 1, endFloor: 3,
    carryMode: 'pocket', floorHeightM: 3, totalAscentM: 6,
    device: { platform: 'android', model: 'Known test device', system: '35' },
    location: { name: 'Stored local location', address: 'Synthetic fixture', latitude: 30, longitude: 118, accuracy: 10, source: 'map', confirmedAt: 500 },
    segments: [0, 1].map(index => ({ id: `old-flight-${index}`, type: 'flight',
      startMs: index * 18000, endMs: (index + 1) * 18000,
      floorFrom: index + 1, floorTo: index + 2, ascentM: 3, stepCount: 20,
      features: [[0.4, 0.5, 0.3, 0]],
    })),
    markers: [{ id: 'old-marker', type: 'turn', atMs: 9000, confidence: 0.9 }],
    createdAt: 100, updatedAt: 1000, verifiedAt: 900, version: 7, status: 'verified',
    ...overrides,
  }
}

function trainingWorkout(route) {
  const rounds = Array.from({ length: 5 }, (_, index) => ({
    id: `trusted-unit-round-${index}`, roundNumber: index + 1, templateVersion: route.version,
    startedAt: 2000 + index * 40000, endedAt: 38000 + index * 40000,
    startFloor: 1, targetFloor: 3, finalFloor: 3, floorCounting: 'transitions',
    durationMs: 36000, activeDurationMs: 36000, floorsCompleted: 2, ascentM: 6,
    steps: 40, confidence: 0.98, complete: true, completionReason: 'route_complete',
    completionSource: 'automatic', trustworthy: true, userCorrectionCount: 0,
    floorSplits: [], interruptions: [], events: [{ t: 9000, type: 'turn', confidence: 0.9 }, { t: 27000, type: 'turn', confidence: 0.9 }],
  }))
  return { id: 'trusted-unit-workout', templateId: route.id, templateVersion: route.version,
    status: 'completed', startedAt: 2000, endedAt: 198000, rounds,
    floorCounting: 'transitions', totalFloorsCompleted: 10, totalAscentM: 30,
    totalSteps: 200, activeDurationMs: 180000, personalBestEligible: true,
  }
}

function learnedRoute(environment, provenance = true) {
  const base = referenceRoute({ ...(provenance ? { learningProvenance: 'training_rounds' } : {}),
    motionReference: { version: 1, carryMode: 'pocket', allBoundariesMarked: true, checkedRuns: 5, checkedDays: ['2026-10-07','2026-10-08'], floorAnchors: [{floor:2,atMs:10000},{floor:3,atMs:20000}] },
    featureSpace: 'heading', deviceCapabilities: { barometerAvailable: true, effectiveSamplingHz: 50 },
  })
  const workout = trainingWorkout(base)
  const route = environment.load('core/route-model.js').updateRouteModelFromWorkouts(base, [workout], 199000)
  assert.equal(route.learning.sampleCount, 5, 'the fixture must come from the real model updater')
  assert.equal(route.learning.state, 'verified')
  return { route, workout }
}

function calibrationDraft(routeId, location) {
  return {
    seed: { ...(routeId ? { routeId } : {}), name: 'Reviewed manual reference', carryMode: 'pocket', location },
    samples: [], frames: [
      { startMs: 0, endMs: 18000, steps: 18, cadence: 60, energy: 0.2, turnRad: 0.3, headingTurnRad: 0.25, paused: 0 },
      { startMs: 18000, endMs: 36000, steps: 22, cadence: 66, energy: 0.25, turnRad: 0.4, headingTurnRad: 0.35, paused: 0 },
    ],
    boundaries: [0, 18000, 36000], startedAt: 300000, endedAt: 336000,
    inferred: { estimatedFloorCount: 2, estimatedStepCount: 40, estimatedAscentM: 6.4,
      defaultRiserM: 0.16, floorBoundaries: [0, 18000, 36000], turnCount: 1, landingCount: 0,
      confidence: { floors: 0.9, height: 0.8, overall: 0.85 } },
    markers: [{ id: 'manual-reference-marker', type: 'manual_floor', atMs: 18000, confidence: 1 }],
    gaps: [], manualMarks: [{ id: 'manual-floor', type: 'floor', atMs: 18000, floor: 2 }],
    boundarySource: 'manual', ascentSource: 'step', estimatedAscentM: 6.4,
  }
}

async function mountReview({ environment = createEnvironment(), previous, workouts, draft } = {}) {
  const other = referenceRoute({ id: 'unrelated-route', name: 'Unrelated preserved route' })
  environment.values.set(ROUTES, JSON.stringify(previous ? [previous, other] : [other]))
  for (const [key, value] of Object.entries(protectedEntries)) environment.values.set(key, value)
  if (workouts) environment.values.set('palou.workouts.v1', JSON.stringify(workouts))
  const protectedSnapshot = new Map([...environment.values].filter(([key]) => key !== ROUTES))
  const draftService = environment.load('services/draft.js')
  draft = draft ?? calibrationDraft(previous?.id, previous?.location)
  draftService.setActiveDraft(draft)
  const storage = environment.load('services/storage.js')
  const alerts = [], navigationCalls = [], slots = []
  let cursor = 0, effects = [], dirty = false, tree
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const react = {
    Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, next => {
        const value = typeof next === 'function' ? next(slots[index].value) : next
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true }
      }]
    },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }) },
    useMemo(factory, deps) {
      const index = cursor++
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: factory(), deps }
      return slots[index].value
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps) },
    useEffect(callback, deps) {
      const index = cursor++
      if (!slots[index] || !same(slots[index].deps, deps)) {
        const cleanup = slots[index]?.cleanup
        slots[index] = { deps, cleanup }
        effects.push(() => { cleanup?.(); slots[index].cleanup = callback() })
      }
    },
  }
  const mocks = {
    react,
    'react-native': { Alert: { alert: (...args) => alerts.push(args) }, Platform: { OS: 'android', Version: 36 },
      KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', ScrollView: 'ScrollView',
      Text: 'Text', View: 'View', StyleSheet: { create: value => value, hairlineWidth: 1 } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }) },
    '../components/disclosure': { Disclosure: 'Disclosure' }, '../components/Header': { Header: 'Header' },
    '../components/BuildingSketch': { BuildingSketch: 'BuildingSketch', buildPlaybackFloors: () => [] },
    '../components/ui': { Button: 'Button', Card: 'Card', Field: 'Field', Metric: 'Metric', Pill: 'Pill' },
    '../theme': { useTheme: () => ({}) }, '../services/draft': draftService, '../services/storage': storage,
    '../core/route-motion': environment.load('core/route-motion.js'),
    '../core/analysis': environment.load('core/analysis.js'), '../core/math': environment.load('core/math.js'),
  }
  const source = ts.transpileModule(fs.readFileSync(path.join(repo, 'src/pages/Review.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', source)(name => {
    if (!(name in mocks)) throw Error(`Unexpected Review import: ${name}`)
    return mocks[name]
  }, module, module.exports)
  const navigation = { replace: (...args) => navigationCalls.push(args) }
  function render() {
    for (let attempt = 0; attempt < 25; attempt++) {
      dirty = false; cursor = 0; tree = module.exports.default({ navigation })
      const pending = effects; effects = []; pending.forEach(effect => effect())
      if (!dirty) return
    }
    throw Error('Review render did not settle')
  }
  function nodes() {
    const found = []
    function visit(node) {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(visit); return }
      found.push(node); visit(node.props?.children)
    }
    visit(tree); return found
  }
  const settle = async () => { render(); await new Promise(resolve => setImmediate(resolve)); render() }
  await settle()
  await settle()
  function assertProtected() {
    for (const [key, value] of protectedSnapshot) assert.equal(environment.values.get(key), value, `${key} must remain byte-for-byte unchanged`)
    assert.deepEqual(JSON.parse(environment.values.get(ROUTES)).find(route => route.id === other.id), other)
    assert.equal(environment.calls.some(([, key]) => protectedSnapshot.has(key)), false, 'saveRoute must not write records, archive, or another checkpoint')
  }
  return { environment, storage, draft, draftService, alerts, navigationCalls, nodes, settle, assertProtected,
    async save() {
      const button = nodes().find(node => node.type === 'Button' && node.props.title === '保存为路线模板')
      assert.ok(button, 'invoke the real save button handler')
      await button.props.onPress(); await settle()
    },
    async editStart(value) {
      nodes().find(node => node.type === 'Field' && node.props.label === '起始楼层').props.onChangeText(String(value))
      await settle()
    },
    async savedRoute() {
      const id = navigationCalls.find(([screen]) => screen === 'Validate')?.[1].id
      return (await storage.listRoutes()).find(route => route.id === id)
    },
  }
}

function assertRetainedModel(saved, previous) {
  for (const key of ['learningProvenance', 'learning', 'modelVersion', 'algorithmVersion', 'featureSpace', 'deviceCapabilities', 'verifiedAt', 'device']) {
    // Compare the actual persisted baseline: JSON legitimately omits undefined fields.
    assert.deepEqual(saved[key], previous[key] === undefined ? undefined : clone(previous[key]), `recalibration must preserve ${key}`)
  }
  assert.equal(saved.createdAt, previous.createdAt)
  assert.equal(saved.version, previous.version + 1)
  assert.equal(saved.status, 'needs_validation')
}

test('new manual calibration saves its reference but creates zero trusted learning samples', async () => {
  const page = await mountReview()
  await page.editStart(4); await page.save()
  const route = await page.savedRoute()
  assert.equal(route.learningProvenance, 'training_rounds')
  assert.equal(route.learning.sampleCount, 0)
  assert.equal(route.learning.state, 'unlearned')
  assert.equal(page.environment.load('core/route-learning.js').summarizeRouteLearning(route, []).validCount, 0)
  assert.equal(route.startFloor, 4); assert.equal(route.endFloor, 6)
  assert.equal(route.totalAscentM, 6.4); assert.deepEqual(route.markers, page.draft.markers)
  assert.equal(page.draftService.getActiveDraft(), undefined)
  assert.equal(page.environment.values.has(DRAFT), false)
  page.assertProtected()
})

test('first calibration of an existing empty location draft cannot become a legacy learning sample', async () => {
  const environment = createEnvironment()
  const previous = environment.load('core/route-model.js').migrateRouteToV3(referenceRoute({
    segments: [], markers: [], status: 'draft', endFloor: 1, floorHeightM: 0, totalAscentM: 0,
  }))
  assert.equal(previous.learning.sampleCount, 0)
  assert.equal(previous.learningProvenance, undefined)
  const page = await mountReview({ environment, previous })
  await page.save()
  const saved = await page.savedRoute()
  assert.equal(saved.learningProvenance, 'training_rounds')
  assert.equal(saved.learning.sampleCount, 0)
  assert.equal(environment.load('core/route-learning.js').summarizeRouteLearning(saved, []).validCount, 0)
  page.assertProtected()
})

test('recalibrating an unlearned training route preserves its zero-sample model and provenance', async () => {
  const environment = createEnvironment()
  const previous = environment.load('core/route-model.js').migrateRouteToV3(referenceRoute({ learningProvenance: 'training_rounds' }))
  const page = await mountReview({ environment, previous })
  await page.save()
  const saved = await page.savedRoute()
  assertRetainedModel(saved, previous)
  assert.equal(saved.learning.sampleCount, 0)
  assert.equal(environment.load('core/route-learning.js').summarizeRouteLearning(saved, []).validCount, 0)
  assert.equal(saved.totalAscentM, 6.4); assert.notDeepEqual(saved.segments, previous.segments)
  page.assertProtected()
})

test('real model updater output and its five recorded rounds survive manual recalibration unchanged', async () => {
  const environment = createEnvironment(), { route: previous, workout } = learnedRoute(environment)
  const page = await mountReview({ environment, previous, workouts: [workout] })
  await page.editStart(2); await page.save()
  const saved = await page.savedRoute()
  assertRetainedModel(saved, previous)
  assert.equal(saved.startFloor, 2); assert.equal(saved.endFloor, 4)
  const storedWorkouts = JSON.parse(environment.values.get('palou.workouts.v1'))
  const summary = environment.load('core/route-learning.js').summarizeRouteLearning(saved, storedWorkouts)
  assert.equal(summary.validCount, 0, 'a changed reference needs new independent checks')
  assert.equal(summary.samples.some(sample => sample.workoutId.startsWith('legacy-')), false)
  assert.equal(environment.load('core/route-model.js').migrateRouteToV3(saved).learning.sampleCount, 5)
  page.assertProtected()
})

test('a legacy route with an existing learned model keeps that model and never gains a new provenance flag', async () => {
  const environment = createEnvironment(), { route: previous, workout } = learnedRoute(environment, false)
  const page = await mountReview({ environment, previous, workouts: [workout] })
  await page.save()
  const saved = await page.savedRoute()
  assertRetainedModel(saved, previous)
  assert.equal(Object.hasOwn(saved, 'learningProvenance'), false)
  assert.equal(environment.load('core/route-learning.js').summarizeRouteLearning(saved, [workout]).validCount, 0)
  page.assertProtected()
})

test('an unmigrated legacy reference retains its compatibility baseline without converting into a new training route', async () => {
  const previous = referenceRoute(), page = await mountReview({ previous })
  const model = page.environment.load('core/route-model.js')
  assert.equal(model.migrateRouteToV3(previous).learning.sampleCount, 1)
  await page.save()
  const saved = await page.savedRoute()
  assert.equal(Object.hasOwn(saved, 'learningProvenance'), false)
  assert.equal(saved.learning.sampleCount, 1)
  assert.equal(saved.verifiedAt, previous.verifiedAt)
  assert.deepEqual(saved.device, previous.device)
  assert.equal(page.environment.load('core/route-learning.js').summarizeRouteLearning(saved, []).validCount, 0)
  page.assertProtected()
})

test('a route deleted after Review loaded cannot become a replacement new route or discard the draft', async () => {
  const previous = referenceRoute(), page = await mountReview({ previous })
  const retained = JSON.parse(page.environment.values.get(ROUTES)).filter(route => route.id !== previous.id)
  page.environment.values.set(ROUTES, JSON.stringify(retained))
  await page.save()
  assert.deepEqual(JSON.parse(page.environment.values.get(ROUTES)), retained)
  assert.equal(page.draftService.getActiveDraft(), page.draft)
  assert.equal(page.environment.values.has(DRAFT), true)
  assert.equal(page.navigationCalls.length, 0)
  assert.match(page.alerts.at(-1)[1], /原路线已不存在/)
  page.assertProtected()
})

test('disk failure preserves the old route and draft; retry saves once with the original learned model intact', async () => {
  const environment = createEnvironment(), { route: previous, workout } = learnedRoute(environment)
  const page = await mountReview({ environment, previous, workouts: [workout] })
  const before = environment.values.get(ROUTES)
  environment.failNextRouteWrite(); await page.save()
  assert.equal(environment.values.get(ROUTES), before)
  assert.equal(page.draftService.getActiveDraft(), page.draft)
  assert.equal(environment.values.has(DRAFT), true)
  assert.equal(page.navigationCalls.length, 0)
  assert.match(page.alerts.at(-1)[1], /injected disk full/)
  page.assertProtected()
  await page.save()
  assertRetainedModel(await page.savedRoute(), previous)
  assert.equal((await page.storage.listRoutes()).filter(route => route.id === previous.id).length, 1)
  assert.equal(page.navigationCalls.filter(([screen]) => screen === 'Validate').length, 1)
  assert.equal(page.draftService.getActiveDraft(), undefined)
  page.assertProtected()
})

test('straight stairs retain two human-marked floors even when the old turn estimate says one', async () => {
  const draft = calibrationDraft()
  draft.inferred.estimatedFloorCount = 1
  draft.inferred.turnCount = 0
  draft.frames = draft.frames.map(frame => ({ ...frame, turnRad: 0, headingTurnRad: 0 }))
  draft.markers = []
  draft.manualMarks = [
    { id: 'actual-2', type: 'floor', atMs: 18000, floor: 2 },
    { id: 'actual-3', type: 'floor', atMs: 36000, floor: 3 },
  ]
  const page = await mountReview({ draft })
  await page.save()
  const saved = await page.savedRoute()
  assert.equal(saved.startFloor, 1)
  assert.equal(saved.endFloor, 3)
  assert.equal(saved.segments.length, 2)
  assert.deepEqual(saved.segments.map(segment => segment.stepCount), [18, 22])
  assert.deepEqual(saved.segments.map(segment => segment.turnCount), [0, 0])
  assert.equal(saved.motionReference.allBoundariesMarked, true)
  assert.equal(saved.motionReference.checkedRuns, 0)
  assert.ok(saved.segments.every(segment => segment.ascentM > 0))
  page.assertProtected()
})
