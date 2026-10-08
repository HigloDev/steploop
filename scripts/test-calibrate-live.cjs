// Actual Calibrate handlers/timers and real offline analysis, with React/native sensor
// boundaries injected. Synthetic normalized-g input is never presented as device proof.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..')
const pageFile = process.env.PALOU_CALIBRATE_SOURCE
  ? path.resolve(repo, process.env.PALOU_CALIBRATE_SOURCE)
  : path.join(repo, 'src/pages/Calibrate.tsx')
const gravity = 9.80665
const coreModules = new Map()
function core(name) {
  const filename = path.join(repo, 'src/core', `${name}.ts`)
  if (coreModules.has(filename)) return coreModules.get(filename).exports
  const module = { exports: {} }; coreModules.set(filename, module)
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  new Function('require', 'module', 'exports', code)(dependency => {
    assert.ok(dependency.startsWith('.'), `Unexpected core dependency: ${dependency}`)
    return core(path.relative(path.join(repo, 'src/core'), path.resolve(path.dirname(filename), dependency)).replaceAll('\\', '/'))
  }, module, module.exports)
  return module.exports
}
const analysis = core('analysis')

async function mount(seedOverrides = {}) {
  const slots = [], intervals = new Map(), recorders = [], navigationCalls = [], drafts = []
  let cursor = 0, effects = [], dirty = false, tree, now = 1791120000000, nextTimer = 1
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
    useRef(initial) { const i = cursor++; if (!slots[i]) slots[i] = { value: { current: initial } }; return slots[i].value },
    useEffect(callback, deps) {
      const i = cursor++
      if (!slots[i] || !same(slots[i].deps, deps)) {
        const cleanup = slots[i]?.cleanup; slots[i] = { deps, cleanup }
        effects.push(() => { cleanup?.(); slots[i].cleanup = callback() })
      }
    },
  }
  class Recorder {
    constructor(options) { this.options = options; this.samples = []; recorders.push(this) }
    async start() { this.startedAt = now; this.options.onStatus({ signal: 'good' }) }
    getStartedAt() { return this.startedAt }
    async stop() { return this.samples }
  }
  const animation = () => ({ start() {} })
  const mocks = {
    react,
    'react-native': {
      Alert: { alert() {} }, Animated: { View: 'Animated.View', Value: class { interpolate() { return 0 } }, loop: animation, sequence: animation, timing: animation },
      KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'android' }, Pressable: 'Pressable', ScrollView: 'ScrollView',
      Text: 'Text', TextInput: 'TextInput', View: 'View', StyleSheet: { create: value => value, hairlineWidth: 1 },
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 24 }) },
    '../components/disclosure': { Disclosure: 'Disclosure' }, '../components/Header': { Header: 'Header' },
    '../components/BuildingSketch': { BuildingSketch: 'BuildingSketch', buildRealtimeFloors: () => [] },
    '../components/ui': { Button: 'Button', Card: 'Card', Metric: 'Metric', Pill: 'Pill' }, '../theme': { useTheme: () => ({}) },
    '../services/sensor': { SensorRecorder: Recorder, sensorStartErrorMessage: error => error.message },
    '../services/draft': { async loadPersistedDraft() { return null }, saveCalibrateProgress() {}, clearActiveDraft() {}, setActiveDraft: draft => drafts.push(draft) },
    '../services/preferences': { triggerHaptic() {} },
  }
  const code = ts.transpileModule(fs.readFileSync(pageFile, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'setInterval', 'clearInterval', 'Date', code)(dependency => {
    if (dependency in mocks) return mocks[dependency]
    if (dependency.startsWith('../core/')) return core(dependency.slice('../core/'.length))
    throw Error(`Unexpected page dependency: ${dependency}`)
  }, module, module.exports, (callback, period) => { const id = nextTimer++; intervals.set(id, { callback, period }); return id },
  id => intervals.delete(id), { now: () => now })
  function render() {
    for (let attempt = 0; attempt < 20; attempt++) {
      dirty = false; cursor = 0
      tree = module.exports.default({ navigation: { replace: (...args) => navigationCalls.push(args), navigate() {} }, route: { params: { seed: { name: 'Synthetic calibration', carryMode: 'pocket', location: { name: 'Synthetic location', address: 'Synthetic only', latitude: 0, longitude: 0, source: 'map', confirmedAt: 1 }, ...seedOverrides } } } })
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
  const text = value => Array.isArray(value) ? value.map(text).join('') : typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  function metric(pattern) {
    const value = nodes().filter(node => node.type === 'Text').map(node => text(node.props.children)).find(value => pattern.test(value))
    assert.ok(value, `Rendered metric missing: ${pattern}`); return Number(value.match(pattern)[1])
  }
  async function press(title) {
    const button = nodes().find(node => node.type === 'Button' && node.props.title === title)
    assert.ok(button, `Actual button missing: ${title}`); await button.props.onPress(); render()
  }
  function tick() { [...intervals.values()].sort((a, b) => a.period - b.period).forEach(timer => timer.callback()); render() }
  function feed(durationMs, value = () => ({})) {
    const recorder = recorders.at(-1), start = now
    for (let elapsed = 0; elapsed < durationMs; elapsed += 20) {
      now = start + elapsed
      const sample = { t: now, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0, alpha: 0, beta: 0, gamma: 0, ...value(elapsed) }
      recorder.samples.push(sample); recorder.options.onSample(sample)
      if (sample.pressure !== undefined) recorder.options.onBarometer({ available: true, running: true, pressure: sample.pressure, lastSampleAt: now })
    }
    now = start + durationMs; tick()
  }
  render(); await Promise.resolve(); render()
  return { press, feed, tick, drafts, recorders, intervals, navigationCalls,
    texts: () => nodes().filter(node => node.type === 'Text').map(node => text(node.props.children)),
    async markNextFloor() {
      const button = nodes().find(node => node.type === 'Pressable' && /^确认到达 \d+ 层$/.test(node.props.accessibilityLabel ?? ''))
      assert.ok(button); await button.props.onPress(); render()
    },
    steps: () => metric(/^(\d+) 步$/), ascent: () => metric(/^爬升 (-?[\d.]+) 米$/),
    barometer(pressure) { recorders.at(-1).options.onBarometer({ available: true, running: true, pressure, lastSampleAt: now }); render() },
  }
}

test('normalized-g stationary input causes no live false steps before or after baseline calibration', async () => {
  const page = await mount(); await page.press('开始采集')
  page.feed(1600, () => ({ ax: 0.6, az: 0.8 }))
  assert.equal(page.steps(), 0)
  assert.equal(page.ascent(), 0)
  assert.equal(analysis.countSteps(page.recorders[0].samples), 0)
})

test('live step detection responds to normalized-g walking pulses and stop preserves original samples for real analysis', async () => {
  const page = await mount(); await page.press('开始采集')
  page.feed(1500, () => ({ pressure: 1013.25 }))
  const pulseCount = 10
  page.feed(pulseCount * 900, elapsed => ({ az: elapsed % 900 < 150 ? 14.7 / gravity : 1, pressure: 1013.25 - 3 * elapsed / (pulseCount * 900) / 8.3 }))
  const liveSteps = page.steps(), liveAscent = page.ascent(), original = page.recorders[0].samples.map(sample => ({ ...sample }))
  assert.ok(liveSteps >= pulseCount * 0.75 && liveSteps <= pulseCount * 1.25, `Live pulse estimate: ${liveSteps}`)
  const offlineSteps = analysis.countSteps(original)
  assert.ok(offlineSteps >= pulseCount * 0.75 && offlineSteps <= pulseCount * 1.25, `Offline pulse estimate: ${offlineSteps}`)
  await page.press('停止并分析')
  assert.deepEqual(page.drafts[0].samples, original, 'UI conversion must not change raw g samples')
  assert.equal(page.drafts[0].samples, page.recorders[0].samples)
  assert.ok(Math.abs(liveAscent - page.drafts[0].estimatedAscentM) <= 0.2, 'Live latest pressure and offline pressure estimate should agree within smoothing/rounding')
  assert.deepEqual(page.navigationCalls, [['Review']])
})

test('the original recording timer reads updated barometer height after subsequent rerenders', async () => {
  const page = await mount(); await page.press('开始采集')
  const timer = [...page.intervals.values()].find(timer => timer.period === 500)
  page.barometer(1013.25); page.tick(); assert.equal(page.ascent(), 0)
  for (const height of [1.5, 3, 6]) {
    const pressure = 1013.25 - height / 8.3
    page.barometer(pressure); page.tick()
    const expected = Number((analysis.pressureToAltitude(pressure) - analysis.pressureToAltitude(1013.25)).toFixed(1))
    assert.equal(page.ascent(), expected)
    assert.equal([...page.intervals.values()].find(item => item.period === 500), timer, 'Updating displayed height must not restart the recording timer')
  }
})

test('a new recording clears the previous pressure height and retains the existing no-barometer step fallback', async () => {
  const page = await mount(); await page.press('开始采集')
  page.barometer(1013.25); page.barometer(1013.25 - 6 / 8.3); page.tick()
  assert.ok(page.ascent() > 5)
  await page.press('停止并分析') // Too few samples restores ready, allowing a normal new recording.
  await page.press('开始采集')
  page.barometer(1013.25); page.tick(); assert.equal(page.ascent(), 0)
  await page.press('停止并分析'); await page.press('开始采集')
  page.feed(1500)
  page.feed(4500, elapsed => ({ az: elapsed % 900 < 150 ? 14.7 / gravity : 1 }))
  assert.ok(page.steps() > 0)
  assert.equal(page.ascent(), Number((page.steps() * 0.17).toFixed(1)))
})

test('recording a route shows pressure direction while the floor changes only from a human floor mark', async () => {
  const page = await mount(); await page.press('开始采集')
  page.feed(10000, elapsed => ({ pressure: 1013.25 - elapsed / 1000 * 0.06 }))
  assert.equal(page.steps(), 0)
  assert.ok(page.texts().includes('上升'))
  assert.ok(page.texts().includes('当前楼层 1层 · 已标记 0 个新楼层'))
  assert.ok(!page.texts().includes('气压楼层'))
  await page.markNextFloor()
  assert.ok(page.texts().includes('当前楼层 2层 · 已标记 1 个新楼层'))
  page.feed(3000)
  assert.ok(page.texts().includes('还看不清'), 'Old pressure direction must expire when no new values arrive')
})

test('rerecording without a location preserves an existing non-first-floor start and saves its actual floor mark', async () => {
  const page = await mount({ routeId: 'existing-route', location: undefined, startFloor: 3 })
  assert.ok(page.texts().includes('未记录地点，也可以记录路线'))
  await page.press('开始采集')
  assert.ok(page.texts().includes('当前楼层 3层 · 已标记 0 个新楼层'))
  page.feed(2000)
  await page.markNextFloor()
  page.feed(1000)
  await page.press('停止并分析')
  assert.equal(page.drafts[0].seed.routeId, 'existing-route')
  assert.equal(page.drafts[0].seed.location, undefined)
  assert.equal(page.drafts[0].manualMarks[0].floor, 4)
})
