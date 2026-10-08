// Actual Home/Setup handlers and effects; only native UI, navigation and preferences
// persistence boundaries are injected. PALOU_MODE_ENTRY_SOURCE_ROOT selects frozen pages.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..')
const sourceRoot = process.env.PALOU_MODE_ENTRY_SOURCE_ROOT
  ? path.resolve(repo, process.env.PALOU_MODE_ENTRY_SOURCE_ROOT)
  : path.join(repo, 'src/pages')
const clone = value => JSON.parse(JSON.stringify(value))
const routeTemplate = {
  id: 'mode-entry-route', name: 'Mode entry test route', version: 3, carryMode: 'pocket',
  startFloor: 1, endFloor: 3, floorHeightM: 3, totalAscentM: 6, status: 'needs_validation',
  learningProvenance: 'training_rounds', createdAt: 1, updatedAt: 2,
  device: { platform: 'android', model: 'synthetic', system: '36' }, markers: [],
  segments: [1, 2].map(f => ({ id: 's'+f, type: 'flight', floorFrom: f, floorTo: f+1, startMs: 0, endMs: 18000, ascentM: 3, stepCount: 20, boundaryConfirmed: true, features: [[0.5, 0.5, 0, 0]] })),
  preparation: { version: 1, deviceKey: 'synthetic-local', elevator: 'absent', referenceRevision: 1, runs: ['teach_first','teach_again','check_floors','check_end','walk','rest'].map(step => ({step, passed: true})) },
}
const savedSetup = {
  routeId: routeTemplate.id, routeVersion: routeTemplate.version, carryMode: routeTemplate.carryMode,
  goal: { type: 'rounds', targetRounds: 7 }, planEnabled: true, planWarmup: false,
  planRecovery: true, trackingMode: 'automatic',
}

function environment({ globalMode = 'automatic', deferSaves = false } = {}) {
  const prefs = { lastTrainingRouteId: routeTemplate.id, lastWorkoutSetup: clone(savedSetup), trackingMode: globalMode }
  const writes = [], coreModules = new Map()
  function core(name) {
    const filename = path.join(repo, 'src/core', `${name}.ts`)
    if (coreModules.has(filename)) return coreModules.get(filename).exports
    const module = { exports: {} }; coreModules.set(filename, module)
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText
    new Function('require', 'module', 'exports', source)(name => {
      if (!name.startsWith('.')) throw Error(`Unexpected core dependency ${name}`)
      return core(path.relative(path.join(repo, 'src/core'), path.resolve(path.dirname(filename), name)).replaceAll('\\', '/'))
    }, module, module.exports)
    return module.exports
  }
  return { prefs, writes, core,
    preferences: {
      async getPreferences() { return clone(prefs) },
      async savePreferences(patch) {
        writes.push(clone(patch))
        // Pending persistence reproduces an immediate Home mode-change -> Adjust race.
        if (deferSaves) await new Promise(() => {})
        Object.assign(prefs, clone(patch)); return clone(prefs)
      },
    },
  }
}

async function mountPage(pageName, env, params = {}) {
  const slots = [], alerts = [], navigationCalls = []
  let cursor = 0, effects = [], dirty = false, tree
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const react = {
    Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, next => {
        const value = typeof next === 'function' ? next(slots[i].value) : next
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true }
      }]
    },
    useMemo(factory, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: factory(), deps }; return slots[i].value },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps) },
    useEffect(callback, deps) {
      const i = cursor++
      if (!slots[i] || !same(slots[i].deps, deps)) {
        const cleanup = slots[i]?.cleanup; slots[i] = { deps, cleanup }
        effects.push(() => { cleanup?.(); slots[i].cleanup = callback() })
      }
    },
  }
  const navigation = {
    navigate: (...args) => navigationCalls.push(args), replace: (...args) => navigationCalls.push(args),
    goBack: () => navigationCalls.push(['back']), addListener: () => () => {},
  }
  const mocks = {
    react,
    'react-native': { ActivityIndicator: 'ActivityIndicator', Alert: { alert: (...args) => alerts.push(args) },
      Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: value => value, hairlineWidth: 1 } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }) },
    '@expo/vector-icons': { Feather: 'Feather', MaterialCommunityIcons: 'MaterialCommunityIcons' },
    '../components/Header': { Header: 'Header' }, '../components/ui': { Button: 'Button', Notice: 'Notice' },
    '../components/brand-mark': { BrandMark: 'BrandMark' },
    '../components/disclosure': { Disclosure: 'Disclosure' }, '../components/native-choice': { NativeChoice: 'NativeChoice' },
    '../components/tracking-mode-selector': { TrackingModeSelector: 'TrackingModeSelector' }, '../theme': { useTheme: () => ({}) },
    '../services/preferences': env.preferences,
    '../services/storage': { async getRoute() { return clone(routeTemplate) }, async listRoutes() { return [clone(routeTemplate)] } },
    '../services/workout-storage': { async loadActiveCheckpoint() { return null }, async listWorkouts() { return [] } },
    '../services/privacy': { async isPrivacyAgreed() { return true } },
    '../services/workout-entry': { async confirmBackgroundRecording() { return true } },
    '../services/checkpoint-completion': { async discardCheckpointAsAbandoned() {}, async saveCheckpointAsCompleted() {} },
  }
  const source = ts.transpileModule(fs.readFileSync(path.join(sourceRoot, `${pageName}.tsx`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', source)(name => {
    if (name in mocks) return mocks[name]
    if (name.startsWith('../core/')) return env.core(name.slice('../core/'.length))
    throw Error(`Unexpected page dependency ${name}`)
  }, module, module.exports)
  function render() {
    for (let attempt = 0; attempt < 20; attempt++) {
      dirty = false; cursor = 0; tree = module.exports.default({ navigation, route: { params: { id: routeTemplate.id, ...params } } })
      const pending = effects; effects = []; pending.forEach(effect => effect())
      if (!dirty) return
    }
    throw Error('Page render did not settle')
  }
  function nodes() {
    const found = []
    const visit = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(visit); found.push(node); visit(node.props?.children) }
    visit(tree); return found
  }
  const settle = async () => { render(); await new Promise(resolve => setImmediate(resolve)); render() }
  for (let i = 0; i < 3; i++) await settle()
  const selector = () => nodes().find(node => node.type === 'TrackingModeSelector')
  return { nodes, navigationCalls, alerts, settle, selector,
    selectMode(mode) { selector().props.onChange(mode); render() },
    adjust() { const adjust = nodes().find(node => node.type === 'Pressable' && /^训练目标：/.test(node.props.accessibilityLabel)); assert.ok(adjust); adjust.props.onPress(); render() },
    async start() {
      const button = nodes().find(node => node.type === 'Button' && /开始/.test(node.props.title))
      assert.ok(button); await button.props.onPress(); await settle()
    },
  }
}

test('Home keeps mode controls in Setup and carries the saved choice into Adjust', async () => {
  const env = environment({ globalMode: 'full_auto', deferSaves: true })
  const home = await mountPage('TrainHome', env)
  assert.equal(home.selector(), undefined, 'Home has no duplicate mode selector'); home.adjust()
  const [screen, params] = home.navigationCalls.at(-1)
  assert.equal(screen, 'WorkoutSetup'); assert.equal(params.trackingMode, 'full_auto')
  assert.equal(env.prefs.trackingMode, 'full_auto')
  const setup = await mountPage('WorkoutSetup', environment(), params)
  assert.equal(setup.selector().props.value, 'full_auto', 'explicit entry must beat both old global and saved setup')
})

test('Setup without an explicit entry uses global manual ahead of the saved automatic setup', async () => {
  const env = environment({ globalMode: 'manual' }), setup = await mountPage('WorkoutSetup', env)
  assert.equal(setup.selector().props.value, 'manual')
  assert.deepEqual(env.prefs.lastWorkoutSetup.goal, savedSetup.goal)
})

test('changing Setup mode synchronizes global preferences and preserves the restored goal and plan', async () => {
  const env = environment(), setup = await mountPage('WorkoutSetup', env)
  setup.selectMode('full_auto'); await setup.settle()
  assert.equal(env.prefs.trackingMode, 'full_auto')
  assert.equal(env.prefs.lastWorkoutSetup.trackingMode, 'full_auto')
  assert.deepEqual(env.prefs.lastWorkoutSetup.goal, savedSetup.goal)
  assert.equal(env.prefs.lastWorkoutSetup.planEnabled, true)
  assert.equal(env.prefs.lastWorkoutSetup.planWarmup, false)
  assert.equal(env.prefs.lastWorkoutSetup.planRecovery, true)
})

test('Setup saves and starts with the same selected mode, goal and plan', async () => {
  for (const mode of ['manual', 'full_auto']) {
    const env = environment(), setup = await mountPage('WorkoutSetup', env)
    setup.selectMode(mode); await setup.settle(); await setup.start()
    const [screen, params] = setup.navigationCalls.at(-1)
    assert.equal(screen, 'ClimbWorkout'); assert.equal(params.trackingMode, mode)
    assert.equal(env.prefs.trackingMode, mode); assert.equal(env.prefs.lastWorkoutSetup.trackingMode, mode)
    assert.deepEqual(params.goal, savedSetup.goal); assert.deepEqual(env.prefs.lastWorkoutSetup.goal, params.goal)
    assert.ok(params.plan); assert.equal(setup.alerts.length, 0)
  }
})
