const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

// Exercise the real theme module with the platform's color-scheme hook stubbed.
let systemScheme = null
const context = {
  exports: {},
  require(name) {
    assert.equal(name, 'react-native')
    return { useColorScheme: () => systemScheme }
  },
}
const source = fs.readFileSync(path.join(__dirname, '../src/theme.ts'), 'utf8')
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, context)
const { useTheme, useWorkoutPalette, workoutPalettes, light, dark } = context.exports

function rgb(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i)
  return hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255)
}
function luminance(hex) {
  return rgb(hex).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, index) => sum + v * [0.2126, 0.7152, 0.0722][index], 0)
}
function contrast(fg, bg) {
  const values = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}
function readable(fg, bg, label, minimum = 4.5) {
  const value = contrast(fg, bg)
  assert.ok(value >= minimum, `${label}: ${value.toFixed(2)}:1 < ${minimum}:1`)
}
test('all theme consumers follow light, dark and unavailable system appearance on each render', () => {
  for (const scheme of ['light', 'dark', null, 'dark', 'light']) {
    systemScheme = scheme
    const expected = scheme === 'dark' ? 'dark' : 'light'
    assert.equal(useTheme(), expected === 'dark' ? dark : light)
    assert.equal(useWorkoutPalette(), workoutPalettes[expected])
    assert.equal(useWorkoutPalette().isDark, useTheme().isDark)
  }
})

for (const [mode, theme] of Object.entries({ light, dark })) {
  test(`${mode}: reading surfaces and semantic messages have sufficient text contrast`, () => {
    for (const surface of ['paper', 'card', 'cardSoft', 'surfaceSoft']) {
      for (const text of ['ink', 'inkSoft', 'muted', 'mutedStrong']) {
        readable(theme[text], theme[surface], `${mode} ${text} on ${surface}`)
      }
    }
    readable(theme.onBrand, theme.brand, `${mode} primary controls`)
    for (const name of ['amber', 'red', 'info']) {
      readable(theme[`${name}Ink`], theme[`${name}Soft`], `${mode} ${name} message`)
    }
  })
  test(`${mode}: all training text and held-button states remain readable`, () => {
    const p = workoutPalettes[mode]
    for (const surface of ['bg', 'surface', 'failureSurface']) {
      for (const text of ['ink', 'inkSoft', 'muted', 'brandInk', 'warn', 'danger', 'estimate']) {
        readable(p[text], p[surface], `${mode} workout ${text} on ${surface}`)
      }
    }
    for (const fill of ['brand', 'brandPressed']) {
      readable(p.onBrand, p[fill], `${mode} ${fill} button`)
    }
    readable(p.danger, p.dangerFill, `${mode} held discard button`)
    readable(p.good, p.surface, `${mode} status dot`, 3)
  })
}

test('light training surfaces are light and dark training surfaces are dark', () => {
  for (const surface of ['bg', 'surface', 'failureSurface']) {
    assert.ok(luminance(workoutPalettes.light[surface]) > 0.8, `light ${surface}`)
    assert.ok(luminance(workoutPalettes.dark[surface]) < 0.04, `dark ${surface}`)
  }
})
