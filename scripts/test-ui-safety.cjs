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
    memo: render => render,
    forwardRef: render => props => render(props, props.ref),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next }]
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial } },
    useMemo(factory, deps) {
      const index = cursor++
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: factory() }
      return slots[index].value
    },
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

// These dependencies paint RN views. The harness still executes the real
// route, form, persistence, and accessibility handlers below.
const visualMocks = {
  '../components/motion-pressable': { MotionPressable: 'Pressable' },
  'expo-blur': { BlurTargetView: 'BlurTargetView', BlurView: 'BlurView' },
  '../components/glass-material': {
    GlassBackdrop: 'GlassBackdrop',
    useGlassDockInset: () => 0,
    getGlassSurfaceStyle: () => ({}),
  },
  '../components/motion-ring-graphics': {
    MotionRingLogoOrb: 'MotionRingLogoOrb',
    MotionBrandBadge: 'MotionBrandBadge',
    MotionHeroSurfaceArt: 'MotionHeroSurfaceArt',
    MotionRingArc: 'MotionRingArc',
    MotionCardAccent: 'MotionCardAccent',
    MotionCompletionHalo: 'MotionCompletionHalo',
    MotionPosterBackdrop: 'MotionPosterBackdrop',
  },
  '../components/tracked-image': { TrackedImage: 'TrackedImage' },
  '../components/ui-icon': { UIIcon: 'UIIcon', resolveUIIconName: name => name },
  '../skin-assets': { getThemeBackdrop: () => 1, getThemeStairwell: () => 1 },
  'react-native-svg': {
    default: 'Svg',
    Circle: 'Circle',
    ClipPath: 'ClipPath',
    Defs: 'Defs',
    G: 'G',
    Path: 'Path',
    Rect: 'Rect',
    Line: 'Line',
    LinearGradient: 'LinearGradient',
    RadialGradient: 'RadialGradient',
    Stop: 'Stop',
  },
}

function load(file, mocks) {
  const imports = { ...visualMocks, ...mocks }
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', source)(name => {
    if (!(name in imports)) throw Error('Unexpected import: ' + name)
    return imports[name]
  }, loaded, loaded.exports)
  return loaded.exports
}

const native = {
  Platform: { OS: 'android', Version: 35 },
  Pressable: 'Pressable', Text: 'Text', View: 'View', ScrollView: 'ScrollView', FlatList: 'FlatList', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: value => value, hairlineWidth: 1 },
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
}
const icons = { Feather: 'Feather', Ionicons: 'Ionicons', MaterialCommunityIcons: 'MaterialCommunityIcons' }
const skinCatalog = load('src/skin-catalog.ts', {})
const themeTokens = load('src/theme.ts', {
  'react-native': { useColorScheme: () => 'light' },
  react: {
    createContext: value => ({ value }),
    useContext: context => context.value,
  },
  './skin-catalog': skinCatalog,
  './appearance': { useAppearance: () => ({ skinId: 'glacier-glass', mode: 'system' }) },
})

test('choice controls fit measured labels at larger font sizes and reflow when the actual space runs out', () => {
  const hooks = runtime()
  let fontScale = 1.25
  const changes = []
  const { NativeChoice } = load('src/components/native-choice.tsx', {
    react: hooks.react,
    'react-native': { ...native, Platform: { OS: 'android' }, useWindowDimensions: () => ({ width: 400, height: 890, fontScale }) },
    '@expo/ui/community/segmented-control': { default: 'SegmentedControl' },
    '../theme': themeTokens,
    '../services/preferences': { triggerHaptic: async () => {} },
  })
  const options = ['精简', '标准', '教练', '关闭'].map(value => ({ value, label: value }))
  const render = () => hooks.render(() => NativeChoice({ options, value: '标准', onChange: value => changes.push(value) }))
  const all = (tree, predicate) => !tree || typeof tree !== 'object' ? []
    : [...(predicate(tree) ? [tree] : []), ...(tree.props?.children ?? []).flat(Infinity).flatMap(child => all(child, predicate))]
  const rows = tree => all(tree, node => node.props.style?.flexDirection === 'row')
  const measure = width => all(render(), node => typeof node.props.onTextLayout === 'function')
    .forEach(node => node.props.onTextLayout({ nativeEvent: { lines: [{ width }] } }))
  render().props.onLayout({ nativeEvent: { layout: { width: 326 } } })
  measure(38)
  assert.equal(rows(render()).length, 1, 'four short labels fit at 1.25 scale without forced two-row layout')
  let radios = all(render(), node => node.props.accessibilityRole === 'radio')
  assert.equal(radios.length, 4)
  assert.equal(radios.filter(node => node.props.accessibilityState.checked).length, 1)
  assert.ok(radios.every(node => node.props.style({ pressed: false }).minHeight >= 48))
  fontScale = 2
  measure(95)
  assert.equal(rows(render()).length, 2, 'larger measured labels use balanced rows')
  render().props.onLayout({ nativeEvent: { layout: { width: 180 } } })
  assert.equal(rows(render()).length, 4, 'a narrow container can grow vertically instead of clipping labels')
  radios = all(render(), node => node.props.accessibilityRole === 'radio')
  radios.find(node => node.props.accessibilityLabel === '教练').props.onPress()
  assert.deepEqual(changes, ['教练'], 'layout measurements never change the selected preference')
})

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
    '../components/brand-wordmark': { BrandWordmark: 'BrandWordmark' },
    '../components/BuildingThumb': { BuildingThumb: 'BuildingThumb' },
    '../components/ascent-references': { AscentReferences: 'AscentReferences' },
    '../components/flow-sheet': { FlowSheet: 'FlowSheet' },
    '../components/sport-ui': { SportButton: 'SportButton', SectionHeading: 'SectionHeading', StatPair: 'StatPair' },
    '../components/training-visuals': { WeekBars: 'WeekBars' },
    '../core/building-template': {},
    '../core/floors': { normalizeFloorNumber: value => value },
    '../core/landmarks': { describeAscent: () => '' },
    '../core/weekly-achievement': { buildWeeklyAchievement: () => ({ ascentM: 0, floors: 0, workouts: 0, streak: 0, days: [] }) },
    '../services/preferences': { triggerHaptic: async () => {} },
    '../core/math': { formatDuration: () => '01:00' },
    '../core/workout-summary': {},
    '../services/building-storage': {
      listBuildings: async () => [],
      loadFusionCheckpoint: async () => { reads++; return stored },
    },
    '../services/workout-storage': { listWorkouts: async () => [], loadActiveCheckpoint: async () => null },
    '../theme': themeTokens,
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
    const retryBtn = find(blocked, node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === '重新读取')
    assert.ok(retryBtn, 'loadError state must render a visible retry button')
    writeFailed = false
    retryBtn.props.onPress()
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
    'react-native-svg': {
      default: 'Svg',
      Circle: 'Circle',
      Defs: 'Defs',
      Line: 'Line',
      LinearGradient: 'LinearGradient',
      RadialGradient: 'RadialGradient',
      Stop: 'Stop',
    },
    '../core/floors': {},
    'react-native-reanimated': {
      default: { View: 'Animated.View', Text: 'Animated.Text' }, Easing: { linear: value => value },
      useSharedValue: initial => { let value = initial; return { get: () => value, set: next => { value = next } } },
      useAnimatedStyle: factory => factory(), cancelAnimation: () => {},
      withTiming: (value, _config, callback) => { if (immediate) callback?.(true); else visuals.push(() => callback?.(true)); return value },
    },
    'react-native-worklets': { scheduleOnRN: fn => fn() },
    '../services/preferences': { triggerHaptic: async () => { haptics++ } },
    '../theme': themeTokens, './ui': { useReduceMotion: () => immediate },
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
    '@expo/vector-icons': icons, '../components/ui': { Button: 'Button', useReduceMotion: () => false },
    '../components/brand-mark': { BrandMark: 'BrandMark' }, '../theme': { ...themeTokens, useTheme: () => themeTokens.getTheme('motion-ring', 'light') },
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
    '../components/flow-sheet': { FlowSheet: 'FlowSheet' }, '../theme': { ...themeTokens, useTheme: () => themeTokens.getTheme('glacier-glass', 'light') },
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
  let focusHistory
  const oldAt = new Date(2026, 9, 1, 9).getTime()
  const recentAt = new Date(2026, 9, 10, 9).getTime()
  const correctedAt = new Date(2026, 9, 15, 9).getTime()
  const base = { status: 'completed', rounds: [], routeSnapshot: { name: '楼栋', startFloor: 1, endFloor: 10 } }
  const items = [{ ...base, id: 'old-corrected', startedAt: oldAt, endedAt: oldAt + 60000, updatedAt: correctedAt },
    { ...base, id: 'recent', startedAt: recentAt, endedAt: recentAt + 60000, updatedAt: recentAt }]
  const { default: Screen } = load('src/pages/History.tsx', {
    react: hooks.react, 'react-native': native, '@expo/vector-icons': icons,
    '@react-navigation/native': { useFocusEffect: callback => {
      focusHistory = callback
      hooks.react.useEffect(callback, [])
    } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '../components/disclosure': { Disclosure: 'Disclosure' }, '../components/Header': { Header: 'Header' },
    '../components/BuildingThumb': { BuildingThumb: 'BuildingThumb' }, '../components/flow-sheet': { FlowSheet: 'FlowSheet' },
    '../components/sport-ui': { StatPair: 'StatPair' },
    '../components/training-visuals': { TrendChart: 'TrendChart' },
    '../components/ui': { Button: 'Button', Card: 'Card', EmptyState: 'EmptyState', Notice: 'Notice', Pill: 'Pill' },
    '../theme': themeTokens, '../services/building-storage': { loadFusionCheckpoint: async () => null },
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
  const rowEl = list.props.renderItem({ item: list.props.data[1], index: 1 })
  const card = typeof rowEl.type === 'function' ? rowEl.type(rowEl.props) : rowEl
  assert.ok(find(card, node => node.props.accessibilityLabel?.includes('2026.10.01')))
  assert.ok(find(card, node => node.props.accessibilityRole === 'header' && String(node.props.children?.join?.('') ?? node.props.children).includes('10月1日')), 'History row must display visible date group header')
  assert.ok(find(card, node => node.type === 'Text' && String(node.props.children?.join?.('') ?? node.props.children).includes('09:00')), 'History card must display workout clock time')

  focusHistory()
  const duringRefresh = find(render(), node => node.type === 'FlatList')
  assert.deepEqual(duringRefresh.props.data.map(card => card.id), ['recent', 'old-corrected'])
  assert.equal(duringRefresh.props.refreshing, false)
  await new Promise(resolve => setImmediate(resolve))
})

async function weeklyHarness() {
  const hooks = runtime()
  let dark = false, skin = 'glacier-glass', resolvePermission, mountedKey, captures = 0, saves = 0
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
    '../theme': { ...themeTokens, useTheme: () => themeTokens.getTheme(skin, dark ? 'dark' : 'light') },
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
  return { render, WeeklyPoster, week, resolvePermission, switchTheme: () => { dark = !dark }, switchSkin: value => { skin = value },
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

test('changing skins within the same mode invalidates a pending poster export', async () => {
  const h = await weeklyHarness()
  const before = find(h.render(), node => node.type === h.WeeklyPoster)
  find(h.render(), node => node.props.title === '保存海报').props.onPress()
  h.switchSkin('woodland')
  const after = find(h.render(), node => node.type === h.WeeklyPoster)
  assert.notEqual(before.props.key, after.props.key)
  h.resolvePermission({ granted: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.captures, 0)
  assert.equal(h.saves, 0)
})

async function shareStudioHarness() {
  const hooks = runtime()
  const workout = { id: 'lab', startedAt: 1, endedAt: 2, rounds: [] }
  let mode = 'light', mountedKey, resolvePermission, captures = 0, saves = 0
  const alerts = []
  const permission = new Promise(resolve => { resolvePermission = resolve })
  const { default: Screen, SharePoster } = load('src/pages/ShareStudio.tsx', {
    react: hooks.react, 'react-native': { ...native, Alert: { alert: (...args) => alerts.push(args) } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'react-native-view-shot': { captureRef: async () => { captures++; return 'file://poster.png' } },
    'expo-clipboard': {}, 'expo-sharing': {},
    'expo-media-library/legacy': { requestPermissionsAsync: () => permission, saveToLibraryAsync: async () => { saves++ } },
    '../components/disclosure': { Disclosure: 'Disclosure' }, '../components/Header': { Header: 'Header' },
    '../components/brand-mark': { BrandMark: 'BrandMark' }, '../components/ui': { Button: 'Button' },
    '../core/segmented-calories': {}, '../core/math': {}, '../core/fusion-workout': { workoutCalories: () => 0 },
    '../core/share-payload': { buildSharePayload: () => ({ redacted: [] }), isShareableResult: value => value === 'success' },
    '../core/workout-summary': { calculateWorkoutSummary: () => ({}) },
    '../core/training-progress': { deriveTrainingProgress: () => ({}) },
    '../services/workout-storage': { getWorkout: async () => workout, listWorkouts: async () => [], saveWorkout: async () => {} },
    '../theme': { ...themeTokens, useTheme: () => themeTokens.getTheme('night-run', mode) },
    '../../assets/share/staircase-editorial-light.webp': 1,
    '../../assets/share/staircase-editorial-dark.webp': 2,
  })
  const render = () => {
    const screen = hooks.render(() => Screen({ navigation: {}, route: { params: { id: workout.id } } }))
    const poster = find(screen, node => node.type === SharePoster)
    if (poster && mountedKey !== poster.props.key) {
      mountedKey = poster.props.key
      poster.props.ref.current = { key: mountedKey }
    }
    return screen
  }
  render()
  await new Promise(resolve => setImmediate(resolve))
  return { render, SharePoster, alerts, resolvePermission, switchMode: () => { mode = 'dark' },
    get captures() { return captures }, get saves() { return saves } }
}

test('editorial export waits for both images and retries failed assets on a fresh preview', async () => {
  const h = await shareStudioHarness()
  const screen = h.render()
  const getPoster = () => find(h.render(), node => node.type === h.SharePoster)
  const exportButton = () => find(h.render(), node => node.props.title === '保存图片')
  find(screen, node => node.props.template === 'editorial' && node.props.onPress).props.onPress()
  const first = getPoster()
  first.props.onImageStatus('mark', true)
  assert.equal(exportButton().props.disabled, true)
  first.props.onImageStatus('background', false)
  assert.equal(exportButton().props.disabled, true)
  find(h.render(), node => node.props.title === '重新加载海报').props.onPress()
  const retried = getPoster()
  assert.notEqual(retried.props.key, first.props.key)
  first.props.onImageStatus('background', true)
  retried.props.onImageStatus('mark', true)
  assert.equal(exportButton().props.disabled, true)
  retried.props.onImageStatus('background', true)
  assert.equal(exportButton().props.disabled, false)
})

test('a save pending permission locks ratio edits and rejects a preview replaced by system appearance', async () => {
  const h = await shareStudioHarness()
  const initial = h.render()
  find(initial, node => node.type === h.SharePoster).props.onImageStatus('mark', true)
  find(h.render(), node => node.props.accessibilityRole === 'tab' && node.props.children[0]?.props.children[0] === '尺寸').props.onPress()
  const ready = h.render()
  const ratio = find(ready, node => node.props.accessibilityLabel === '1:1 方形图片')
  const save = find(ready, node => node.props.title === '保存图片').props.onPress()
  ratio.props.onPress()
  assert.equal(find(h.render(), node => node.type === h.SharePoster).props.ratio, '4:5')
  h.switchMode()
  h.render()
  h.resolvePermission({ status: 'granted' })
  await save
  assert.equal(h.captures, 0)
  assert.equal(h.saves, 0)
  assert.match(h.alerts[0][1], /海报样式已变化/)
})

function locationPickerHarness(t, { configured = false, initialLocation } = {}) {
  const hooks = runtime()
  const navigations = []
  const maps = load('src/services/building-map-html.ts', {})
  const { default: Screen } = load('src/pages/LocationPicker.tsx', {
    react: hooks.react,
    'react-native': {
      ...native,
      Keyboard: { dismiss() {}, addListener: () => ({ remove() {} }) },
      KeyboardAvoidingView: 'KeyboardAvoidingView',
      NativeModules: {},
      TextInput: 'TextInput',
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    'expo-location': {
      Accuracy: { Balanced: 3 },
      requestForegroundPermissionsAsync: async () => ({ granted: true }),
      getCurrentPositionAsync: async () => ({ coords: { latitude: 27.75, longitude: 118.02, accuracy: 12 } }),
    },
    'react-native-webview': { WebView: 'WebView' },
    '../components/Header': { Header: 'Header' },
    '../components/sport-ui': { SportButton: 'SportButton' },
    '../services/building-map-html': { ...maps, hasBuildingMap: configured },
    '../theme': themeTokens,
  })
  const render = () => hooks.render(() => Screen({
    navigation: { popTo: (...args) => navigations.push(args) },
    route: { params: { initialLocation } },
  }))
  const ui = predicate => find(render(), predicate)
  t.after(hooks.unmount)
  return { maps, navigations, ui, webView: () => ui(node => node.type === 'WebView'),
    button: title => ui(node => node.type === 'SportButton' && node.props.title === title) }
}

test('without a map key the picker opens the official preview and only a valid location enables confirmation', async t => {
  const picker = locationPickerHarness(t)
  const view = picker.webView()
  assert.equal(new URL(view.props.source.uri).pathname, '/ssr/embed/view')
  assert.equal(view.props.onMessage, undefined)
  assert.equal(picker.button('使用此地点').props.disabled, true)

  const keyword = '北京 天安门&key=ignored'
  picker.ui(node => node.type === 'TextInput').props.onChangeText(keyword)
  picker.button('搜索').props.onPress()
  const previewUrl = new URL(picker.webView().props.source.uri)
  assert.equal(previewUrl.pathname, '/ssr/embed/search')
  assert.equal(previewUrl.searchParams.get('keyword'), keyword)
  assert.equal(previewUrl.searchParams.has('key'), false)
  assert.equal(picker.button('使用此地点').props.disabled, true)

  picker.ui(node => node.props.accessibilityLabel === '选择当前位置').props.onPress()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(picker.button('使用此地点').props.disabled, false)
  picker.button('使用此地点').props.onPress()
  const [name, { params }] = picker.navigations[0]
  assert.equal(name, 'Main')
  assert.deepEqual({ ...params.pickedBuildingLocation, confirmedAt: 0 }, {
    name: '当前位置', address: '', latitude: 27.75, longitude: 118.02,
    source: 'gps', accuracy: 12, confirmedAt: 0,
  })
})

test('primary map failure preserves the existing point and ignores messages from the failed WebView', t => {
  const initialLocation = {
    name: '旧楼栋', address: '已保存地点', latitude: 28, longitude: 118,
    source: 'map', accuracy: 4, confirmedAt: 12,
  }
  const picker = locationPickerHarness(t, { configured: true, initialLocation })
  const old = picker.webView()
  assert.ok(old.props.source.html)
  old.props.onError()
  const preview = picker.webView()
  assert.ok(picker.maps.isBuildingMapPreviewUrl(preview.props.source.uri))
  assert.equal(preview.props.onShouldStartLoadWithRequest({ url: 'https://www.amap.com.invalid/ssr/embed/view' }), false)
  old.props.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'point', latitude: 1, longitude: 1 }) } })
  picker.button('使用此地点').props.onPress()
  const result = picker.navigations[0][1].params.pickedBuildingLocation
  assert.deepEqual({ ...result, confirmedAt: 12 }, initialLocation)
  picker.button('重试地图选点').props.onPress()
  assert.ok(picker.webView().props.source.html)
})
