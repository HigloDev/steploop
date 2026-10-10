const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const out = path.join(root, 'node_modules/.cache/height-references')
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--ignoreConfig', '--ignoreDeprecations', '6.0',
  '--lib', 'es2022', '--outDir', out, '--module', 'commonjs', '--moduleResolution', 'node',
  '--target', 'es2022', '--skipLibCheck', 'src/core/landmarks.ts', 'src/core/building-visual.ts'], { cwd: root })
const { LANDMARKS, ascentReference, referenceProgress, describeAscent } = require(path.join(out, 'landmarks.js'))
const { buildingVisualLevel } = require(path.join(out, 'building-visual.js'))

test('at least thirty distinct references, strictly ordered, reaching the exact Everest snow elevation', () => {
  assert.ok(LANDMARKS.length >= 30)
  assert.equal(new Set(LANDMARKS.map(item => item.id)).size, LANDMARKS.length)
  assert.equal(new Set(LANDMARKS.map(item => item.name)).size, LANDMARKS.length)
  LANDMARKS.forEach((item, i) => {
    assert.ok(Number.isFinite(item.heightM) && item.heightM > 0)
    assert.ok(!i || item.heightM > LANDMARKS[i - 1].heightM)
    assert.ok(item.note)
  })
  assert.equal(LANDMARKS.at(-1).id, 'everest')
  assert.equal(LANDMARKS.at(-1).heightM, 8848.86)
})

test('each physical reference is reachable by the automatic Home selector', () => {
  LANDMARKS.forEach(item => assert.equal(ascentReference(item.heightM).passed.id, item.id))
})

test('low ascent selects a nearby reference and a positive next target', () => {
  const result = ascentReference(12)
  assert.equal(result.passed.id, 'palace-wall')
  assert.equal(result.next.id, 'yueyang')
  assert.equal(Math.ceil(result.remainingM), 8)
  assert.equal(describeAscent(0), '还没开始爬')
  assert.match(describeAscent(1), /足球球门/)
})

test('fractional heights are compared before display rounding', () => {
  assert.equal(ascentReference(70.99).passed.id, 'wild-goose')
  assert.equal(ascentReference(70.99).next.id, 'leshan')
  assert.equal(ascentReference(71).passed.id, 'leshan')
  assert.equal(ascentReference(631.999).next.id, 'shanghai')
  assert.equal(ascentReference(632).passed.id, 'shanghai')
})

test('Everest boundary and heights above Everest remain valid', () => {
  assert.equal(ascentReference(8848.85).next.id, 'everest')
  assert.equal(ascentReference(8848.86).next, undefined)
  assert.equal(ascentReference(18000).passed.id, 'everest')
  assert.equal(ascentReference(18000).remainingM, 0)
  assert.match(describeAscent(8848.86), /^高度相当于珠穆朗玛峰$/)
  assert.equal(describeAscent(18000), '≈ 2.0 座珠穆朗玛峰')
})

test('progress never announces an unreached reference as reached or 100 percent', () => {
  assert.equal(referenceProgress(99.999, 100), '99%')
  assert.equal(referenceProgress(0.0001, 100), '<1%')
  assert.equal(referenceProgress(0, 100), '0%')
  assert.equal(referenceProgress(100, 100), '已达到')
})

test('invalid or negative ascent cannot produce a false achievement', () => {
  for (const value of [-1, NaN, Infinity, -Infinity]) {
    assert.equal(describeAscent(value), '还没开始爬')
    assert.equal(ascentReference(value).passed, undefined)
  }
})

test('record icons have seven visible tiers, with both sides of every boundary covered', () => {
  for (const [count, expected] of [[0, 0], [5, 0], [6, 1], [15, 1], [16, 2], [30, 2], [31, 3], [60, 3],
    [61, 4], [100, 4], [101, 5], [200, 5], [201, 6], [10000, 6]]) {
    assert.equal(buildingVisualLevel(count), expected, `${count} floors`)
  }
  assert.equal(new Set([2, 10, 30, 60, 100, 200, 300].map(buildingVisualLevel)).size, 7)
})

test('icon tier is monotonic and safely bounded for all practical counts', () => {
  let previous = 0
  for (let floors = 0; floors <= 10000; floors++) {
    const level = buildingVisualLevel(floors)
    assert.ok(level >= previous && level <= 6)
    previous = level
  }
  for (const invalid of [NaN, Infinity, -1]) assert.equal(buildingVisualLevel(invalid), 0)
})
