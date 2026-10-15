const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

// Exercise the actual screen/component handlers without a native device. Native
// long-press timing remains Pressability's responsibility; animations are mocked
// both as immediate (system Reduce Motion) and deferred visual feedback.
function runtime() {
  const slots = []
  let cursor = 0, effects = []
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const react = {
    Fragment: 'Fragment',
    forwardRef: render => props => render(props, props.ref),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next }]
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial } },
    useMemo: factory => factory(),
    useCallback: callback => callback,
    useEffect(callback, deps) {
      const index = cursor++
      if (!slots[index] || !same(slots[index].deps, deps)) {
        const previous = slots[index]
        slots[index] = { deps, cleanup: previous?.cleanup }
        effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = callback() })
      }
    },
  }
  return { react, render: fn => {
    cursor = 0
    const value = fn(), pending = effects
    effects = []
    pending.forEach(effect => effect())
    return value
  }, unmount: () => slots.forEach(slot => slot?.cleanup?.()) }
}

function load(file, mocks) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', source)(name => {
    if (!(name in mocks)) throw Error('Unexpected import: ' + name)
    return mocks[name]
  }, loaded, loaded.exports)
  return loaded.exports
}

const native = {
  Pressable: 'Pressable', Text: 'Text', View: 'View', ScrollView: 'ScrollView', FlatList: 'FlatList', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: value => value, hairlineWidth: 1 },
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
}
const icons = { Feather: 'Feather', Ionicons: 'Ionicons', MaterialCommunityIcons: 'MaterialCommunityIcons' }

for (const failed of [false, true]) test(failed
  ? 'home blocks a new workout after cleanup persistence fails and allows a safe retry'
  : 'home waits for an unmounted workout checkpoint before offering a new workout', async () => {
  const hooks = runtime()
  let focus, release, stored = null, reads = 0
  const cleanup = new Promise(resolve => { release = resolve })
  let writeFailed = failed
  const alerts = [], navigations = []
  const { default: Screen } = load('src/pages/Home.tsx', {
    react: hooks.react,
    'react-native': { ...native, TextInput: 'TextInput', Alert: { alert: (...args) => alerts.push(args) } },
    '@react-navigation/native': { useFocusEffect: callback => { focus = callback } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@expo/vector-icons': icons,
    '../hooks/useFusionWorkout': { waitForFusionCleanup: async () => {
      await cleanup
      if (writeFailed) throw Error('上次训练尚未保存成功')
    } },
    '../components/brand-mark': { BrandMark: 'BrandMark' },
    '../components/BuildingThumb': { BuildingThumb: 'BuildingThumb' },
    '../components/ascent-references': { AscentReferences: 'AscentReferences' },
    '../components/flow-sheet': { FlowSheet: 'FlowSheet' },
    '../core/building-template': {},
    '../core/floors': { normalizeFloorNumber: value => value },
    '../core/landmarks': { describeAscent: () => '' },
    '../core/weekly-achievement': { buildWeeklyAchievement: () => ({ ascentM: 0, floors: 0, workouts: 0, streak: 0 }) },
    '../services/preferences': { triggerHaptic: async () => {} },
    '../core/math': { formatDuration: () => '01:00' },
    '../core/workout-summary': {},
    '../services/building-storage': {
      listBuildings: async () => [],
      loadFusionCheckpoint: async () => { reads++; return stored },
    },
    '../services/workout-storage': { listWorkouts: async () => [], loadActiveCheckpoint: async () => null },
    '../theme': { useTheme: () => ({}) },
  })
  const navigation = { navigate: (...args) => navigations.push(args) }
  const render = () => hooks.render(() => Screen({ navigation }))
  const start = tree => find(tree, node => node.props.accessibilityLabel?.startsWith('开始爬楼'))
  render(); focus()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads, 0, 'do not read stale storage while the previous cleanup is pending')
  assert.equal(start(render()).props.disabled, true)
  start(render()).props.onPress()
  assert.deepEqual(navigations, [])
  stored = { workoutId: 'interrupted', startedAt: 1, savedAt: 60001, rounds: [{ id: 'round-1' }] }
  release()
  await new Promise(resolve => setImmediate(resolve))
  if (failed) {
    const blocked = render()
    assert.equal(reads, 0)
    assert.equal(start(blocked).props.disabled, true)
    start(blocked).props.onPress()
    assert.deepEqual(navigations, [])
    assert.ok(find(blocked, node => node.props.children?.includes('上次训练尚未保存成功')))
    writeFailed = false
    focus()
    await new Promise(resolve => setImmediate(resolve))
  }
  const screen = render()
  assert.equal(reads, 1)
  assert.ok(find(screen, node => node.props.children?.includes('有一次训练没有结束')))
  start(screen).props.onPress()
  assert.equal(alerts[0][0], '还有一次训练没有结束')
  assert.deepEqual(navigations, [])
  alerts[0][2].find(action => action.text === '继续上次').onPress()
  assert.deepEqual(navigations, [['ClimbWorkout', { resume: true }]])
})

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined
  if (predicate(tree)) return tree
  for (const child of (tree.props?.children ?? []).flat(Infinity)) {
    const match = find(child, predicate)
    if (match) return match
  }
}

function holdHarness({ immediate = false, holdMs = 1200 } = {}) {
  const hooks = runtime()
  let confirmations = 0, haptics = 0
  const visuals = []
  const { HoldToConfirm } = load('src/components/workout-ui.tsx', {
    react: hooks.react, 'react-native': native,
    'react-native-reanimated': {
      default: { View: 'Animated.View', Text: 'Animated.Text' }, Easing: { linear: value => value },
      useSharedValue: initial => { let value = initial; return { get: () => value, set: next => { value = next } } },
      useAnimatedStyle: factory => factory(), cancelAnimation: () => {},
      withTiming: (value, _config, callback) => { if (immediate) callback?.(true); else visuals.push(() => callback?.(true)); return value },
    },
    'react-native-worklets': { scheduleOnRN: fn => fn() },
    '../services/preferences': { triggerHaptic: async () => { haptics++ } },
    '../theme': { useWorkoutPalette: () => ({}) }, './ui': { useReduceMotion: () => immediate },
  })
  const button = hooks.render(() => HoldToConfirm({ label: '长按放弃本次', holdMs, onConfirm: () => confirmations++ }))
  return { button: button.props, finishVisuals: () => visuals.forEach(fn => fn()), get confirmations() { return confirmations }, get haptics() { return haptics } }
}

test('Reduce Motion cannot turn a destructive long press into a tap', () => {
  const h = holdHarness({ immediate: true })
  h.button.onPressIn()
  assert.equal(h.confirmations, 0, 'press-in must not confirm even if every animation completes immediately')
  h.button.onPressOut()
  assert.equal(h.confirmations, 0, 'releasing a short tap must cancel')
  assert.equal(h.button.delayLongPress, 1200)
  h.button.onPressIn()
  h.button.onLongPress()
  h.button.onPressOut()
  assert.equal(h.confirmations, 1)
  assert.equal(h.haptics, 1)
})

test('visual completion after cancellation cannot authorize an action', () => {
  const h = holdHarness()
  h.button.onPressIn()
  h.button.onPressOut()
  h.finishVisuals()
  assert.equal(h.confirmations, 0)
})

test('custom hold duration is passed to native timing and only activate is accepted from a screen reader', () => {
  const h = holdHarness({ holdMs: 2400 })
  assert.equal(h.button.delayLongPress, 2400)
  h.button.onAccessibilityAction({ nativeEvent: { actionName: 'escape' } })
  assert.equal(h.confirmations, 0)
  h.button.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } })
  assert.equal(h.confirmations, 1)
})

function onboardingHarness(fromSettings = false) {
  const hooks = runtime()
  const navigations = []
  let marks = 0, resolve
  const saved = new Promise(done => { resolve = done })
  const { default: Screen } = load('src/pages/Onboarding.tsx', {
    react: hooks.react, 'react-native': native,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@react-navigation/native': { useNavigation: () => ({ goBack: () => navigations.push('back'), replace: route => navigations.push(route) }) },
    '@expo/vector-icons': icons, '../components/ui': { Button: 'Button' },
    '../components/brand-mark': { BrandMark: 'BrandMark' }, '../theme': { useTheme: () => ({}) },
    '../services/onboarding': { markOnboardingSeen: async () => { marks++; await saved } },
  })
  const render = () => hooks.render(() => Screen({ route: { params: fromSettings ? { from: 'settings' } : {} } }))
  return { render, unmount: hooks.unmount, navigations, resolve, get marks() { return marks } }
}
const primary = tree => find(tree, node => node.type === 'Button')
const skip = tree => find(tree, node => node.type === 'Pressable' && node.props.children.some(child => child?.props?.children?.includes('跳过')))

test('batched next/back taps never move onboarding outside its steps', () => {
  const h = onboardingHarness()
  const next = primary(h.render()).props.onPress
  next(); next(); next(); next()
  let screen = h.render()
  assert.equal(primary(screen).props.title, '开始使用')
  const back = find(screen, node => node.props.accessibilityLabel === '上一步').props.onPress
  back(); back(); back(); back()
  screen = h.render()
  assert.equal(primary(screen).props.title, '下一步')
  assert.equal(find(screen, node => node.props.accessibilityLabel === '上一步'), undefined)
})

for (const fromSettings of [false, true]) {
  test('onboarding completion is single-flight when ' + (fromSettings ? 'reviewing from settings' : 'opening for the first time'), async () => {
    const h = onboardingHarness(fromSettings)
    const first = h.render()
    const next = primary(first).props.onPress
    next(); next()
    const last = h.render()
    primary(last).props.onPress()
    skip(last).props.onPress()
    primary(last).props.onPress()
    assert.equal(h.marks, 1)
    assert.equal(primary(h.render()).props.loading, true)
    assert.equal(skip(h.render()).props.disabled, true)
    h.resolve()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(h.navigations, [fromSettings ? 'back' : 'Main'])
  })
}

test('reviewing privacy from settings offers a return action instead of a misleading new consent flow', () => {
  const hooks = runtime()
  let backs = 0
  const { default: Screen } = load('src/pages/Privacy.tsx', {
    react: hooks.react, 'react-native': { ...native, Platform: { OS: 'android' }, BackHandler: {}, Alert: {}, Linking: {} },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@react-navigation/native': { useNavigation: () => ({ canGoBack: () => true, goBack: () => backs++ }) },
    '../components/Header': { Header: 'Header' }, '../components/ui': { Button: 'Button' },
    '../components/flow-sheet': { FlowSheet: 'FlowSheet' }, '../theme': { useTheme: () => ({}) },
    '../services/privacy': {}, '../services/onboarding': {},
    '../services/history-repository': { HISTORY_SESSION_LIMIT: 100, HISTORY_WORKOUT_LIMIT: 100 },
  })
  const tree = hooks.render(() => Screen({ route: { params: { from: 'settings' } } }))
  assert.equal(find(tree, node => node.props.title === '同意并开始'), undefined)
  find(tree, node => node.props.title === '返回设置').props.onPress()
  assert.equal(backs, 1)
})


test('finishing onboarding after leaving the screen cannot navigate a second time', async () => {
  const h = onboardingHarness(true)
  skip(h.render()).props.onPress()
  h.unmount()
  h.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.marks, 1)
  assert.deepEqual(h.navigations, [])
})

test('editing an old workout preserves its training date and chronological position', async () => {
  const hooks = runtime()
  const oldAt = new Date(2026, 9, 1, 9).getTime()
  const recentAt = new Date(2026, 9, 10, 9).getTime()
  const correctedAt = new Date(2026, 9, 15, 9).getTime()
  const base = { status: 'completed', rounds: [], routeSnapshot: { name: '楼栋', startFloor: 1, endFloor: 10 } }
  const items = [{ ...base, id: 'old-corrected', startedAt: oldAt, endedAt: oldAt + 60000, updatedAt: correctedAt },
    { ...base, id: 'recent', startedAt: recentAt, endedAt: recentAt + 60000, updatedAt: recentAt }]
  const { default: Screen } = load('src/pages/History.tsx', {
    react: hooks.react, 'react-native': native, '@expo/vector-icons': icons,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '../components/disclosure': { Disclosure: 'Disclosure' }, '../components/Header': { Header: 'Header' },
    '../components/BuildingThumb': { BuildingThumb: 'BuildingThumb' }, '../components/flow-sheet': { FlowSheet: 'FlowSheet' },
    '../components/ui': { Button: 'Button', Card: 'Card', EmptyState: 'EmptyState', Notice: 'Notice', Pill: 'Pill' },
    '../theme': { useTheme: () => ({}) }, '../services/building-storage': { loadFusionCheckpoint: async () => null },
    '../services/storage': { listSessions: async () => [] },
    '../services/workout-storage': { listWorkouts: async () => items, loadActiveCheckpoint: async () => null },
    '../services/history-repository': { historyRepository: { summarize: async () => ({}) } },
    '../services/checkpoint-completion': {},
    '../core/workout-summary': { calculateWorkoutSummary: () => ({ completeRounds: 1, totalFloors: 9, totalAscentM: 27, totalSteps: 180, totalElapsedMs: 60000, activeDurationMs: 60000 }) },
    '../core/floors': { getFloorTransitionCount: (start, end) => end - start },
    '../core/math': { formatDuration: () => '01:00' },
    '../core/training-progress': { deriveTrainingProgress: () => ({ validWorkouts: 1, floors: 9, ascentM: 27, consecutiveWeeks: 1 }) },
    '../core/progress-trends': { describeArchiveNotice: () => undefined, computeRoutePersonalBests: () => [], recentTrendWindow: () => ({}), buildTrend: () => [] },
  })
  const navigation = { addListener: () => () => {} }
  const render = () => hooks.render(() => Screen({ navigation }))
  render()
  await new Promise(resolve => setImmediate(resolve))
  const list = find(render(), node => node.type === 'FlatList')
  assert.deepEqual(list.props.data.map(card => card.id), ['recent', 'old-corrected'])
  assert.equal(list.props.data[1].sortAt, oldAt)
  const card = list.props.renderItem({ item: list.props.data[1], index: 1 })
  assert.ok(find(card, node => node.props.accessibilityLabel?.includes('2026.10.01')))
})

async function weeklyHarness() {
  const hooks = runtime()
  let dark = false, resolvePermission, mountedKey, captures = 0, saves = 0
  const permission = new Promise(resolve => { resolvePermission = resolve })
  const week = { workouts: 1, weekStart: 1, floors: 12, ascentM: 36, steps: 240, calories: 20, days: [] }
  const { default: Screen, WeeklyPoster } = load('src/pages/WeeklyShare.tsx', {
    react: hooks.react, 'react-native': native, '@expo/vector-icons': icons,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'react-native-view-shot': { captureRef: async () => { captures++; return 'file://poster.png' } },
    'expo-clipboard': {}, 'expo-media-library/legacy': { requestPermissionsAsync: () => permission, saveToLibraryAsync: async () => { saves++ } },
    'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async () => {} },
    '../components/Header': { Header: 'Header' }, '../components/brand-mark': { BrandMark: 'BrandMark' },
    '../components/ui': { Button: 'Button' }, '../components/native-choice': { NativeChoice: 'NativeChoice' },
    '../components/achievement-building': { AchievementBuilding: 'AchievementBuilding' },
    '../core/landmarks': { ascentReference: () => ({ remainingM: 0 }), describeAscent: () => '相当高度' },
    '../core/weekly-achievement': { buildWeeklyAchievement: () => week, weeklyDateRange: () => '本周', weeklyShareText: () => '本周成果' },
    '../services/workout-storage': { listWorkouts: async () => [] }, '../services/preferences': { triggerHaptic: async () => {} },
    '../theme': { useTheme: () => ({ isDark: dark }), visual: { poster: {} } },
  })
  const render = () => {
    const tree = hooks.render(() => Screen({ navigation: {} }))
    const poster = find(tree, node => node.type === WeeklyPoster)
    if (poster && mountedKey !== poster.props.key) {
      mountedKey = poster.props.key
      poster.props.ref.current = { key: mountedKey }
    }
    return tree
  }
  render()
  await new Promise(resolve => setImmediate(resolve))
  let screen = render()
  find(screen, node => node.type === WeeklyPoster).props.onReady()
  screen = render()
  return { render, WeeklyPoster, week, resolvePermission, switchTheme: () => { dark = !dark },
    get captures() { return captures }, get saves() { return saves } }
}

test('poster export locks template changes until permission and capture finish', async () => {
  const h = await weeklyHarness()
  let screen = h.render()
  const staleChoice = find(screen, node => node.type === 'NativeChoice')
  find(screen, node => node.props.title === '保存海报').props.onPress()
  staleChoice.props.onChange('height')
  screen = h.render()
  assert.equal(find(screen, node => node.type === 'NativeChoice').props.disabled, true)
  assert.equal(find(screen, node => node.type === 'NativeChoice').props.value, 'weekly')
  h.resolvePermission({ granted: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.captures, 1)
  assert.equal(h.saves, 1)
})

test('a poster remounted during the native permission prompt is not captured as the old selection', async () => {
  const h = await weeklyHarness()
  find(h.render(), node => node.props.title === '保存海报').props.onPress()
  h.switchTheme()
  h.render()
  h.resolvePermission({ granted: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.captures, 0)
  assert.equal(h.saves, 0)
  assert.ok(find(h.render(), node => node.props.children?.some(child => typeof child === 'string' && child.includes('海报样式已变化'))))
})

test('poster image failure has an explicit retry and export resumes only after the retried image is ready', async () => {
  const h = await weeklyHarness()
  let screen = h.render()
  const poster = find(screen, node => node.type === h.WeeklyPoster)
  const renderedPoster = h.WeeklyPoster(poster.props)
  const brand = find(renderedPoster, node => node.type === 'BrandMark')
  brand.props.onError()
  screen = h.render()
  assert.equal(find(screen, node => node.props.title === '保存海报').props.disabled, true)
  find(screen, node => node.props.title === '重新加载海报').props.onPress()
  screen = h.render()
  const retried = find(screen, node => node.type === h.WeeklyPoster)
  assert.notEqual(retried.props.key, poster.props.key)
  assert.equal(find(screen, node => node.props.title === '保存海报').props.disabled, true)
  retried.props.onReady()
  screen = h.render()
  assert.equal(find(screen, node => node.props.title === '保存海报').props.disabled, false)
})
