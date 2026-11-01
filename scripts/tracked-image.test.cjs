const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function harness(dev = true) {
  const events = [], effects = [], timers = new Map()
  const react = {
    createElement: (type, props) => ({ type, props }),
    useState: initial => [typeof initial === 'function' ? initial() : initial],
    useContext: context => context.kind === 'tab' ? 100 : context.kind === 'navigation' ? { isFocused: () => false } : { key: 'home-test-key' },
    useLayoutEffect: effect => effects.push(effect),
  }
  react.default = react
  const context = { exports: {}, __DEV__: dev, performance: { now: () => 50 }, console: { info: (_, json) => events.push(JSON.parse(json)) },
    setInterval: fn => { const id = timers.size + 1; timers.set(id, fn); return id }, clearInterval: id => timers.delete(id),
    require: name => name === 'react' ? react : name === '@react-navigation/bottom-tabs' ? { BottomTabBarHeightContext: { kind: 'tab' } }
      : name === '@react-navigation/native' ? { NavigationContext: { kind: 'navigation' }, NavigationRouteContext: { kind: 'route' } }
      : { Image: 'Image', ImageBackground: 'ImageBackground', Dimensions: { get: () => ({ width: 400, height: 890 }) } } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/tracked-image.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, context)
  return { ...context.exports, events, effects, timers }
}

test('native callbacks survive tracking and an early onLoad never regresses on effect mount', () => {
  const h = harness(), calls = []
  const element = h.TrackedImage({ identity: 'brand/classic/light', source: 1,
    onLoad: e => calls.push(e), onError: e => calls.push(e), onLoadStart: () => calls.push('start') })
  const image = element.type(element.props)
  image.props.onLoadStart()
  image.props.onLoad('loaded-event')
  const cleanup = h.effects[0]()
  assert.equal(h.events.at(-1).status, 'loaded')
  cleanup()
  const again = h.effects[0]()
  assert.equal(h.events.at(-1).status, 'mount')
  assert.equal(h.events.at(-1).loadStatus, 'loaded')
  image.props.onError({ nativeEvent: { error: 'decode failed' } })
  assert.equal(h.events.at(-1).status, 'failed')
  assert.equal(calls.length, 3)
  again()
  assert.equal(h.events.at(-1).status, 'unmount')
})

test('changing source remounts native image and simultaneous same-role instances have distinct IDs', () => {
  const h = harness()
  const first = h.TrackedImage({ identity: 'brand/classic/light', source: 1 })
  const next = h.TrackedImage({ identity: 'brand/classic/light', source: 2 })
  assert.notEqual(first.props.key, next.props.key)
  first.type(first.props)
  first.type(first.props)
  h.effects.forEach(effect => effect())
  const mounts = h.events.filter(event => event.status === 'mount')
  assert.notEqual(mounts[0].instanceId, mounts[1].instanceId)
})

test('release emits no QA telemetry and preserves background image callback', () => {
  const h = harness(false)
  let loaded = false
  const element = h.TrackedImageBackground({ identity: 'share/editorial', source: 1, onLoad: () => { loaded = true } })
  const image = element.type(element.props)
  const cleanup = h.effects[0]()
  image.props.onLoad({})
  cleanup()
  assert.equal(loaded, true)
  assert.equal(h.events.length, 0)
})

test('pending image gets fresh native viewport coordinates after scrolling, and stops polling on load', () => {
  const h = harness()
  const element = h.TrackedImage({ identity: 'detail/list', source: 1 })
  const image = element.type(element.props)
  let y = 950
  image.props.ref({ measureInWindow: fn => fn(20, y, 40, 40) })
  const cleanup = h.effects[0]()
  assert.equal(h.events.at(-1).rect.y, 950)
  assert.equal(h.events.at(-1).viewport.height, 790)
  assert.equal(h.events.at(-1).bottomTabBarHeight, 100)
  assert.equal(h.events.at(-1).navigationFocused, false)
  assert.equal(h.events.at(-1).routeKey, 'home-test-key')
  y = 200
  h.timers.forEach(fn => fn())
  assert.equal(h.events.at(-1).rect.y, 200)
  image.props.onLoad({})
  assert.equal(h.timers.size, 0)
  cleanup()
})
