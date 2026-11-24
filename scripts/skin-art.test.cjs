const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
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

const catalog = load('src/skin-catalog.ts', () => { throw Error('Unexpected import') })
const artwork = load('src/skin-assets.ts', name => {
  assert.ok(name.endsWith('.webp'), `Theme asset must be lightweight WebP: ${name}`)
  const asset = path.resolve(root, 'src', name)
  assert.ok(fs.existsSync(asset), `Missing asset: ${asset}`)
  return asset
})

function assertWebp(filePath, maxBytes) {
  assert.ok(fs.existsSync(filePath), `Missing WebP file: ${filePath}`)
  const bytes = fs.readFileSync(filePath)
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF', `Invalid RIFF header: ${filePath}`)
  assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP', `Invalid WEBP signature: ${filePath}`)
  if (maxBytes) {
    assert.ok(bytes.length <= maxBytes, `${path.basename(filePath)} is ${bytes.length} bytes (> ${maxBytes})`)
  }
  return bytes.length
}

test('all 6 glass themes resolve to compact light/dark WebP backdrops and stairwells', () => {
  let totalBytes = 0
  for (const skin of catalog.SKIN_CATALOG) {
    for (const mode of ['light', 'dark']) {
      const backdrop = artwork.getThemeBackdrop(skin.id, mode)
      const stairwell = artwork.getThemeStairwell(skin.id, mode)
      totalBytes += assertWebp(backdrop, 80 * 1024)
      totalBytes += assertWebp(stairwell, 80 * 1024)
    }
  }
  assert.ok(totalBytes < 600 * 1024, `All 6 theme static assets should stay compact (<600KB), got ${totalBytes}`)
})

test('completion animations exist for all 16 tiers and stay within compressed size budget', () => {
  const dir = path.join(root, 'assets/skins/glacier-glass/completion')
  let totalBytes = 0
  for (const mode of ['light', 'dark']) {
    for (let floors = 3; floors <= 10; floors++) {
      totalBytes += assertWebp(path.join(dir, `${mode}-${floors}.webp`), 1.25 * 1024 * 1024)
      totalBytes += assertWebp(path.join(dir, `${mode}-${floors}-still.webp`), 80 * 1024)
    }
  }
  assert.ok(totalBytes <= 16 * 1024 * 1024, `Completion WebP budget exceeded: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)
})

test('share editorial backgrounds are compact light/dark WebP assets', () => {
  assertWebp(path.join(root, 'assets/share/staircase-editorial-light.webp'), 500 * 1024)
  assertWebp(path.join(root, 'assets/share/staircase-editorial-dark.webp'), 500 * 1024)
})

test('the app and posters use one brand mark in every skin and keep load callbacks', () => {
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
  const mod = load('src/components/brand-mark.tsx', name => {
    if (name === './tracked-image') return { TrackedImage: 'Image' }
    if (name === 'react') return react
    if (name === 'react-native') return { Image: 'Image', View: 'View' }
    if (name === '../theme') return { useTheme: () => theme, getThemeSkinId: value => value.id }
    if (name.endsWith('.png')) return path.resolve(root, 'src/components', name)
    throw Error('Unexpected module ' + name)
  })
  const render = fn => { cursor = 0; return fn() }
  let ready = 0, errors = 0
  const mark = render(() => mod.BrandMark({ onLoad: () => ready++, onError: () => errors++ }))
  assert.ok(mark.props.source.endsWith(path.join('assets', 'brand', 'steploop', 'mark.png')))
  assert.ok(fs.existsSync(mark.props.source))
  assert.equal(mark.props.style[0].tintColor, '#A23760')
  mark.props.onLoad()
  assert.equal(ready, 1)
  mark.props.onError({ nativeEvent: { error: 'Decode failed' } })
  assert.equal(errors, 1)
  theme.id = 'glacier-glass'
  theme.brandText = '#245CD8'
  const next = render(() => mod.BrandMark({ onLoad: () => ready++, onError: () => errors++ }))
  assert.equal(next.props.source, mark.props.source)
  assert.equal(next.props.style[0].tintColor, '#245CD8')
})
