const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Executes the real page, hooks, effects and event handlers; only platform boundaries are mocked.
function mountPicker({ routeId, saveError, gps } = {}) {
  const slots = [], timers = new Map(), alerts = [], calls = [], saved = [], updated = []
  let cursor = 0, effects = [], dirty = false, tree, now = 0, nextTimer = 1, unmounted = false
  const navigation = { replace: (...args) => calls.push(args), navigate: (...args) => calls.push(args), goBack: () => calls.push(['back']) }
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; dirty = true }] },
    useRef(initial) { const i = cursor++; if (!slots[i]) slots[i] = { value: { current: initial } }; return slots[i].value },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) {
      const cleanup = slots[i]?.cleanup; slots[i] = { deps, cleanup }; effects.push(() => { cleanup?.(); slots[i].cleanup = fn() })
    } },
  }
  const theme = new Proxy({ paper: '#fff', green: '#3560e4', onPrimary: '#fff', ink: '#17243a', mutedStrong: '#526078', line: '#ddd', card: '#fff', cardSoft: '#eee', fontSmall: 14, fontSubtitle: 15, fontBase: 15, pagePaddingH: 20, tapMin: 48, radiusMd: 14, radiusSm: 10 }, { get: (target, key) => target[key] ?? 0 })
  const keyboardListeners = new Map()
  const webview = { injectJavaScript: source => webview.injections.push(source), stopLoading: () => { webview.stopped++ }, injections: [], stopped: 0 }
  const mocks = {
    react,
    'react-native': { ActivityIndicator: 'ActivityIndicator', Alert: { alert: (...args) => alerts.push(args) },
      Keyboard: { dismiss() {}, addListener(name, callback) { keyboardListeners.set(name, callback); return { remove: () => keyboardListeners.delete(name) } } },
      KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'android', Version: 36 }, Pressable: 'Pressable', ScrollView: 'ScrollView',
      StyleSheet: { create: value => value, hairlineWidth: 1, absoluteFill: {} }, Text: 'Text', TextInput: 'TextInput', View: 'View' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) },
    'react-native-webview': { WebView: 'WebView' }, '@expo/vector-icons': { Ionicons: 'Ionicons' },
    '../components/Header': { Header: 'Header' }, '../components/ui': { Button: 'Button' }, '../theme': { useTheme: () => theme },
    '../core/math': { uid: () => 'new-route' },
    '../services/location': { getCurrentLocation: gps || (async () => ({ latitude: 27.5, longitude: 118.1 })), locationPermissionErrorMessage: error => String(error) },
    '../services/storage': { saveRoute: async route => { if (saveError?.()) throw Error('disk full'); saved.push(route) }, updateRouteLocation: async (id, location) => { updated.push([id, location]); return true } },
    '../services/amap': { AMAP_JS_KEY: 'public-test-key', AMAP_SECURITY_CODE: 'test-security-code' },
  }
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/pages/LocationPicker.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  const setTimeout = (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, at: now + ms }); return id }
  vm.runInNewContext(source, { module, exports: module.exports, require: name => { if (!(name in mocks)) throw Error(`Unexpected import ${name}`); return mocks[name] },
    setTimeout, clearTimeout: id => timers.delete(id), console, Date, JSON, Number }, { filename: 'LocationPicker.js' })
  function nodes() { const result = []; function visit(node) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(visit); result.push(node); visit(node.props?.children) } visit(tree); return result }
  function render() { if (unmounted) return; for (let i = 0; i < 20; i++) { dirty = false; cursor = 0; tree = module.exports.default({ navigation, route: { params: routeId ? { routeId } : undefined } });
      for (const node of nodes()) if (node.type === 'WebView' && node.props.ref) node.props.ref.current = webview
      const pending = effects; effects = []; pending.forEach(effect => effect()); if (!dirty) return
    } throw Error('Render did not settle') }
  render()
  const find = predicate => nodes().find(predicate)
  const button = pattern => find(node => node.type === 'Button' && pattern.test(node.props.title))
  const input = () => find(node => node.type === 'TextInput')
  const currentWeb = () => find(node => node.type === 'WebView')
  const generation = () => Number(currentWeb()?.props.source.html.match(/__mapGeneration\s*=\s*(\d+)/)?.[1] ?? 0)
  const message = data => { currentWeb().props.onMessage({ nativeEvent: { data: JSON.stringify({ generation: generation(), ...data }) } }); render() }
  const edit = text => { input().props.onChangeText(text); render() }
  const search = () => { const node = button(/搜索地点/); if (node) node.props.onPress(); else find(node => node.props?.accessibilityLabel === '搜索地点').props.onPress(); render() }
  const advance = ms => { const target = now + ms; while (true) { const due = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; timers.delete(due[0]); now = due[1].at; due[1].fn(); render() } now = target }
  const confirm = async () => { await button(/确认|保存地点|保存中/).props.onPress(); render() }
  const activeSearch = () => { const injection = webview.injections.filter(value => value.includes('_searchAddress(')).at(-1); return injection ? JSON.parse(`[${injection.match(/_searchAddress\((.*?)\);/s)[1]}]`) : undefined }
  const ready = () => message({ type: 'map_ready' })
  return { render, find, nodes, button, input, currentWeb, generation, message, edit, search, advance, confirm, activeSearch, ready,
    alerts, calls, saved, updated, webview, timers, keyboardListeners,
    unmount() { unmounted = true; slots.forEach(slot => slot?.cleanup?.()) },
  }
}

test('map readiness timeout stops the spinner and offers retry without fabricating location', async () => {
  const page = mountPicker(); page.advance(15000)
  assert.equal(page.nodes().filter(node => node.type === 'ActivityIndicator').length, 0)
  assert.ok(page.button(/重新加载地图/)); await page.confirm(); assert.equal(page.saved.length, 0)
})
test('search before map readiness sends no JavaScript request and keeps the draft', () => {
  const page = mountPicker(); page.edit('我的楼梯'); page.search()
  assert.equal(page.webview.injections.filter(value => value.includes('_searchAddress(')).length, 0)
  assert.equal(page.input().props.value, '我的楼梯')
})
test('WebView error is actionable, stops loading, and preserves input on retry', () => {
  const page = mountPicker(); page.edit('武夷山楼梯'); page.currentWeb().props.onError({ nativeEvent: { description: 'offline' } }); page.render()
  assert.equal(page.nodes().filter(node => node.type === 'ActivityIndicator').length, 0)
  page.button(/重新加载地图/).props.onPress(); page.render(); assert.equal(page.input().props.value, '武夷山楼梯')
})
test('retry isolates the old ready callback and timer from the new WebView generation', () => {
  const page = mountPicker(); const old = page.currentWeb().props.onMessage, oldGeneration = page.generation()
  page.advance(15000); page.button(/重新加载地图/).props.onPress(); page.render()
  old({ nativeEvent: { data: JSON.stringify({ generation: oldGeneration, type: 'map_ready' }) } }); page.render()
  assert.equal(page.find(node => node.type === 'Button' && /搜索地点/.test(node.props.title)).props.disabled, true)
  page.ready(); page.advance(15000); assert.equal(page.button(/重新加载地图/), undefined)
})
test('new-route failure offers QuickStart without creating or recording a location', () => {
  const page = mountPicker(); page.advance(15000); page.button(/快速开练/).props.onPress()
  assert.deepEqual(page.calls, [['QuickStart']]); assert.equal(page.saved.length, 0); assert.equal(page.updated.length, 0)
})
test('supplement failure returns to the existing route without changing its location', () => {
  const page = mountPicker({ routeId: 'existing-route' }); page.advance(15000); page.button(/返回原路线/).props.onPress()
  assert.deepEqual(JSON.parse(JSON.stringify(page.calls)), [['RouteProfile', { id: 'existing-route' }]]); assert.equal(page.updated.length, 0)
})
test('search result atomically uses its returned valid coordinates, not the default map center', async () => {
  const page = mountPicker(); page.ready(); page.edit('真实地点'); page.search(); const [, requestId, draftRevision] = page.activeSearch()
  page.message({ type: 'search_done', requestId, draftRevision, selectionId: 1, lat: 31.12345, lng: 117.65432, address: '已匹配地址' })
  await page.confirm(); assert.equal(page.saved.length, 1); assert.equal(page.saved[0].location.latitude, 31.12345); assert.equal(page.saved[0].location.longitude, 117.65432)
})
test('invalid or absent matched coordinates never save a route', async () => {
  for (const coords of [{ lat: 999, lng: 117 }, { lat: null, lng: 117 }, { lat: 31, lng: Infinity }, {}]) {
    const page = mountPicker(); page.ready(); page.edit('地点'); page.search(); const [, requestId, draftRevision] = page.activeSearch()
    page.message({ type: 'search_done', requestId, draftRevision, selectionId: 1, address: '地址', ...coords }); await page.confirm(); assert.equal(page.saved.length, 0)
  }
})
test('editing invalidates an outstanding search and its callback cannot overwrite the new draft', async () => {
  const page = mountPicker(); page.ready(); page.edit('旧地点'); page.search(); const [, requestId, draftRevision] = page.activeSearch()
  page.edit('新地点'); page.message({ type: 'search_done', requestId, draftRevision, selectionId: 1, lat: 31, lng: 117, address: '旧结果' })
  assert.equal(page.input().props.value, '新地点'); await page.confirm(); assert.equal(page.saved.length, 0)
})
test('a stale reverse-geocode result cannot pair an old address with the current center', async () => {
  const page = mountPicker(); page.ready()
  page.message({ type: 'center', draftRevision: 0, selectionId: 1, lat: 31, lng: 117 })
  page.message({ type: 'reverse_start', draftRevision: 0, selectionId: 1, lat: 31, lng: 117 })
  page.message({ type: 'center', draftRevision: 0, selectionId: 2, lat: 32, lng: 118 })
  page.message({ type: 'reverse_done', draftRevision: 0, selectionId: 1, lat: 31, lng: 117, address: '旧地址' })
  await page.confirm(); assert.equal(page.saved.length, 0); assert.equal(page.input().props.value, '')
})
test('map movement invalidates a matched address until the same center is resolved', async () => {
  const page = mountPicker(); page.ready()
  page.message({ type: 'center', draftRevision: 0, selectionId: 1, lat: 31, lng: 117 })
  page.message({ type: 'reverse_done', draftRevision: 0, selectionId: 1, lat: 31, lng: 117, address: '真实地址' })
  page.message({ type: 'center', draftRevision: 0, selectionId: 2, lat: 32, lng: 118 }); await page.confirm(); assert.equal(page.saved.length, 0)
})
test('search timeout restores controls and keeps the draft', () => {
  const page = mountPicker(); page.ready(); page.edit('保留地址'); page.search(); page.advance(12000)
  assert.equal(page.input().props.value, '保留地址'); assert.equal(page.button(/搜索地点/).props.loading, false)
})
test('failed save preserves a matched draft and allows a successful retry', async () => {
  let fail = true; const page = mountPicker({ saveError: () => fail }); page.ready()
  page.message({ type: 'center', draftRevision: 0, selectionId: 1, lat: 31, lng: 117 })
  page.message({ type: 'reverse_done', draftRevision: 0, selectionId: 1, lat: 31, lng: 117, address: '真实地址' })
  await page.confirm(); assert.equal(page.saved.length, 0); assert.equal(page.input().props.value, '真实地址')
  fail = false; await page.confirm(); assert.equal(page.saved.length, 1)
})
test('Android keyboard avoidance is active with a scrollable input sheet and reachable action footer', () => {
  const page = mountPicker(); const avoid = page.find(node => node.type === 'KeyboardAvoidingView')
  assert.ok(['height', 'padding', 'position'].includes(avoid.props.behavior))
  assert.ok(page.find(node => node.type === 'ScrollView' && node.props.keyboardShouldPersistTaps === 'handled'))
  assert.ok(page.button(/搜索地点/)); assert.ok(page.button(/^取消$/))
  page.keyboardListeners.get('keyboardDidShow')?.({ endCoordinates: { height: 300 } }); page.render(); assert.ok(page.button(/^取消$/))
})

test('map failure is terminal for that generation even if a delayed ready signal arrives', () => {
  const page = mountPicker(); page.currentWeb().props.onHttpError({ nativeEvent: { statusCode: 503 } }); page.render()
  page.ready(); assert.ok(page.button(/重新加载地图/)); assert.equal(page.button(/搜索地点/).props.disabled, true)
})
test('an input edit cancels a pending GPS result instead of moving the new draft', async () => {
  let resolve; const page = mountPicker({ gps: () => new Promise(done => { resolve = done }) }); page.ready()
  const locate = page.find(node => node.props?.accessibilityLabel === '定位到当前位置')
  const pending = locate.props.onPress(); page.render(); page.edit('新的地址')
  resolve({ latitude: 27.5, longitude: 118.1 }); await pending; page.render()
  assert.equal(page.webview.injections.filter(value => value.includes('_setCenterFromGps(')).length, 0)
  assert.equal(page.input().props.value, '新的地址')
})
test('unmount clears timers and a completed GPS request cannot touch the old WebView', async () => {
  let resolve; const page = mountPicker({ gps: () => new Promise(done => { resolve = done }) }); page.ready()
  const pending = page.find(node => node.props?.accessibilityLabel === '定位到当前位置').props.onPress(); page.unmount()
  resolve({ latitude: 27.5, longitude: 118.1 }); await pending
  assert.equal(page.timers.size, 0); assert.equal(page.webview.injections.filter(value => value.includes('_setCenterFromGps(')).length, 0)
})
test('retry readiness and initial reverse-geocoding cannot overwrite the preserved text draft', () => {
  const page = mountPicker(); page.edit('保留我的输入'); page.advance(15000); page.button(/重新加载地图/).props.onPress(); page.render(); page.ready()
  page.message({ type: 'center', selectionId: 1, draftRevision: 1, lat: 31, lng: 117 })
  page.message({ type: 'reverse_done', selectionId: 1, draftRevision: 1, lat: 31, lng: 117, address: '默认地图地点' })
  assert.equal(page.input().props.value, '保留我的输入')
})
test('movement start invalidates a match before the next center message', async () => {
  const page = mountPicker(); page.ready(); page.message({ type: 'center', selectionId: 1, draftRevision: 0, lat: 31, lng: 117 })
  page.message({ type: 'reverse_done', selectionId: 1, draftRevision: 0, lat: 31, lng: 117, address: '原地址' })
  page.message({ type: 'selection_invalidated', selectionId: 2, draftRevision: 0 })
  page.message({ type: 'reverse_done', selectionId: 1, draftRevision: 0, lat: 31, lng: 117, address: '迟到旧地址' })
  await page.confirm(); assert.equal(page.saved.length, 0)
})

// The emitted HTML is executed as well: these tests exercise the actual AMap callback protocol,
// including asynchronous reverse-geocoding, rather than merely checking source strings.
function runMapHtml(html, { missingSdk = false, delayedPlugins = false } = {}) {
  const messages = [], reverse = [], searches = [], timers = new Map(), events = new Map()
  let now = 0, next = 1, pluginCallback, center = { lat: 27.7559, lng: 118.0253 }
  const setTimeout = (fn, ms) => { const id = next++; timers.set(id, { fn, at: now + ms }); return id }
  const clearTimeout = id => timers.delete(id)
  const map = { on: (name, fn) => events.set(name, fn), addControl() {}, getZoom: () => 16,
    getCenter: () => ({ getLat: () => center.lat, getLng: () => center.lng }),
    setZoomAndCenter(zoom, point) { events.get('movestart')?.(); center = { lat: point[1], lng: point[0] }; events.get('moveend')?.() } }
  const geocoder = { getAddress: (point, callback) => reverse.push({ point, callback }), getLocation: (query, callback) => searches.push({ query, callback }) }
  const context = { ReactNativeWebView: { postMessage: value => messages.push(JSON.parse(value)) },
    addEventListener() {}, setTimeout, clearTimeout, Math, JSON, Number, isFinite, Error }
  context.window = context
  if (!missingSdk) context.AMap = { Map: function () { return map }, Geocoder: function () { return geocoder }, ToolBar: function () {}, Scale: function () {},
    plugin: (names, callback) => { if (delayedPlugins) pluginCallback = callback; else callback() } }
  vm.createContext(context)
  for (const [, body] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (body.trim()) vm.runInContext(body, context)
  const advance = ms => { const target = now + ms; while (true) { const due = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; timers.delete(due[0]); now = due[1].at; due[1].fn() } now = target }
  return { context, messages, reverse, searches, events, map, advance, plugins: () => pluginCallback?.() }
}
test('actual HTML reports a missing map SDK instead of silently hanging', () => {
  const page = mountPicker(), runtime = runMapHtml(page.currentWeb().props.source.html, { missingSdk: true })
  assert.ok(runtime.messages.some(message => message.type === 'map_error' && message.generation === page.generation()))
})
test('actual HTML is not ready until both the rendered map and geocoder have completed', () => {
  const page = mountPicker(), runtime = runMapHtml(page.currentWeb().props.source.html, { delayedPlugins: true })
  runtime.events.get('complete')(); assert.equal(runtime.messages.some(message => message.type === 'map_ready'), false)
  runtime.plugins(); assert.equal(runtime.messages.filter(message => message.type === 'map_ready').length, 1)
})
test('actual HTML search success sends its coordinates and identifiers in the same message', () => {
  const page = mountPicker(), runtime = runMapHtml(page.currentWeb().props.source.html); runtime.events.get('complete')()
  runtime.context._searchAddress('地址', 7, 2)
  runtime.searches[0].callback('complete', { geocodes: [{ formattedAddress: '真实匹配地址', location: { lat: 31.25, lng: 117.75 } }] })
  const result = runtime.messages.find(message => message.type === 'search_done')
  assert.equal(result.lat, 31.25); assert.equal(result.lng, 117.75); assert.equal(result.requestId, 7); assert.equal(result.draftRevision, 2)
  assert.ok(Number.isInteger(result.selectionId)); assert.equal(result.generation, page.generation())
})
test('actual HTML invalidates a search callback after a new text revision', () => {
  const page = mountPicker(), runtime = runMapHtml(page.currentWeb().props.source.html); runtime.events.get('complete')()
  runtime.context._searchAddress('旧地址', 1, 1); runtime.context._invalidateSelection(2)
  runtime.searches[0].callback('complete', { geocodes: [{ formattedAddress: '旧结果', location: { lat: 31, lng: 117 } }] })
  assert.equal(runtime.messages.some(message => message.type === 'search_done'), false)
})
test('actual HTML old reverse callback neither posts an old address nor cancels the new timeout', () => {
  const page = mountPicker(), runtime = runMapHtml(page.currentWeb().props.source.html); runtime.events.get('complete')(); runtime.advance(400)
  runtime.map.setZoomAndCenter(17, [118, 32]); runtime.advance(400)
  runtime.reverse[0].callback('complete', { info: 'OK', regeocode: { formattedAddress: '旧地点' } })
  runtime.advance(10000)
  assert.equal(runtime.messages.some(message => message.type === 'reverse_done'), false)
  const failure = runtime.messages.find(message => message.type === 'reverse_error')
  assert.equal(failure.lat, 32); assert.equal(failure.lng, 118)
})
