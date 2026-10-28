const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')

function load(file, requireModule) {
  const context = { exports: {}, require: requireModule }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, context)
  return context.exports
}
const artwork = load('src/skin-assets.ts', name => {
  assert.ok(name.endsWith('.png'), name)
  const asset = path.resolve(root, 'src', name)
  assert.ok(fs.existsSync(asset), asset)
  return asset
})

function harness(file) {
  const values = [], theme = { id: 'k-on', brandText: '#A23760', pagePaddingH: 20 }
  let cursor = 0
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: initial => {
      const index = cursor++
      if (!(index in values)) values[index] = initial
      return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value }]
    },
  }
  react.default = react
  const module = load(file, name => {
    if (name === 'react') return react
    if (name === 'react-native') return { Image: 'Image', View: 'View', useWindowDimensions: () => ({ width: 320, fontScale: 1.3 }) }
    if (name === '../theme') return { useTheme: () => theme, getThemeSkinId: value => value.id,
      skinGeometry: { sceneWidth: 156, sceneHeight: 112, gap: 12, smallWidth: 80, smallHeight: 64 } }
    if (name === '../skin-assets') return artwork
    if (name.endsWith('.png')) return path.resolve(root, 'src/components', name)
    throw Error('Unexpected module ' + name)
  })
  return { module, theme, render: fn => { cursor = 0; return fn() } }
}

test('all shipped artwork roles resolve to the exact documented local PNGs', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/skins/assets.json'), 'utf8'))
  for (const skin of manifest.skins) {
    const set = artwork.getSkinArtwork(skin.id)
    if (skin.graphicsStatus === 'original' || skin.graphicsStatus === 'awaiting-user-asset-method') {
      assert.equal(set, undefined, 'Pending graphics must not pretend to have a completed asset set')
      continue
    }
    assert.deepEqual(Object.keys(set).sort(), ['achievement', 'mark', 'scene'])
    assert.equal(skin.assets.length, 3)
    for (const item of skin.assets) {
      assert.equal(set[item.role], path.join(root, item.path))
      const bytes = fs.readFileSync(set[item.role])
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG')
      assert.equal(bytes[25], 6, 'Artwork must contain its transparent RGBA background')
      assert.equal(bytes.readUInt32BE(16), item.width)
      assert.equal(bytes.readUInt32BE(20), item.height)
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), item.sha256)
    }
  }
})

test('preview artwork follows its supplied skin even while another skin is selected', () => {
  const h = harness('src/components/skin-art.tsx')
  const node = h.render(() => h.module.SkinArt({ kind: 'mark', theme: { id: 'woodland' } }))
  assert.equal(node.props.children[0].props.source, artwork.getSkinArtwork('woodland').mark)
  assert.equal(node.props.pointerEvents, 'none')
  assert.equal(node.props.importantForAccessibility, 'no-hide-descendants')
})

test('each graphic skin wires all four page headers to their documented PNG hashes', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/skins/assets.json'), 'utf8'))
  assert.deepEqual(manifest.headerPages, ['home', 'coach', 'history', 'settings'])
  for (const skin of manifest.skins) {
    if (skin.id === 'classic') {
      for (const page of manifest.headerPages) assert.equal(artwork.getSkinHeaderArtwork(skin.id, page), undefined)
      continue
    }
    assert.equal(skin.headers.length, 4, skin.id)
    for (const item of skin.headers) {
      const resolved = artwork.getSkinHeaderArtwork(skin.id, item.page)
      assert.equal(resolved, path.join(root, item.path), skin.id + '/' + item.page)
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex'), item.sha256)
      const override = (skin.headerOverrides ?? []).find(asset => asset.page === item.page && asset.mode === 'dark')
      const dark = artwork.getSkinHeaderArtwork(skin.id, item.page, 'dark')
      assert.equal(dark, override ? path.join(root, override.path) : resolved, 'Dark composition or explicit shared-art fallback')
      if (override) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(dark)).digest('hex'), override.sha256)
    }
  }
})

test('a failed decorative image disappears and does not break a later skin selection', () => {
  const h = harness('src/components/skin-art.tsx')
  let errors = 0
  const render = () => h.render(() => h.module.SkinArt({ onError: () => errors++ }))
  render().props.children[0].props.onError({ nativeEvent: { error: 'Decode failed' } })
  assert.equal(render(), null)
  assert.equal(errors, 1)
  h.theme.id = 'woodland'
  assert.equal(render().props.children[0].props.source, artwork.getSkinArtwork('woodland').scene)
})

test('a failed graphic logo falls back before notifying poster readiness or failure', () => {
  const h = harness('src/components/brand-mark.tsx')
  let ready = 0, errors = 0
  const render = () => h.render(() => h.module.BrandMark({ onLoad: () => ready++, onError: () => errors++ }))
  const graphic = render()
  assert.equal(graphic.props.source, artwork.getSkinArtwork('k-on').mark)
  assert.equal(graphic.props.style[0].tintColor, undefined)
  graphic.props.onError({ nativeEvent: { error: 'Decode failed' } })
  assert.equal(ready, 0)
  assert.equal(errors, 0)
  const fallback = render()
  assert.ok(fallback.props.source.endsWith(path.join('assets', 'brand', 'mark-audit.png')))
  fallback.props.onLoad()
  assert.equal(ready, 1)
  fallback.props.onError({ nativeEvent: { error: 'Fallback failed' } })
  assert.equal(errors, 1)
  h.theme.id = 'classic'
  assert.equal(render().props.source, fallback.props.source)
})
