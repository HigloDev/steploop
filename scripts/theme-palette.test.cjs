const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

// Exercise the real theme module with the platform's color-scheme hook stubbed.
let systemScheme = null
let selection = { skinId: 'classic', mode: 'system' }
const catalogContext = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/skin-catalog.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, catalogContext)
const catalog = catalogContext.exports
const context = {
  exports: {},
  require(name) {
    if (name === 'react-native') return { useColorScheme: () => systemScheme }
    if (name === './appearance') return { useAppearance: () => selection }
    if (name === './skin-catalog') return catalog
    throw new Error('Unexpected module: ' + name)
  },
}
const source = fs.readFileSync(path.join(__dirname, '../src/theme.ts'), 'utf8')
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, context)
const { useTheme, useWorkoutPalette, workoutPalettes, light, dark } = context.exports
const { getTheme, getWorkoutPalette, getPosterPalette, getThemeKey } = context.exports

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

test('manual mode wins over the system and system mode follows later changes', () => {
  for (const system of ['light', 'dark', null]) {
    systemScheme = system
    for (const mode of ['light', 'dark', 'system']) {
      selection = { skinId: 'pikachu', mode }
      assert.equal(useTheme().isDark, mode === 'dark' || (mode === 'system' && system === 'dark'))
      assert.equal(useWorkoutPalette().bg, useTheme().paper)
    }
  }
  selection = { skinId: 'classic', mode: 'system' }
})

test('construction registry matches all runtime IDs and both palettes', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/skins/registry.json'), 'utf8'))
  assert.deepEqual(registry.skins.map(skin => skin.id), Array.from(catalog.SKIN_CATALOG, skin => skin.id))
  assert.equal(registry.defaultSkinId, catalog.DEFAULT_APPEARANCE.skinId)
  assert.equal(registry.defaultMode, catalog.DEFAULT_APPEARANCE.mode)
  assert.equal(new Set(catalog.SKIN_CATALOG.map(skin => skin.id)).size, catalog.SKIN_CATALOG.length)
  for (const skin of catalog.SKIN_CATALOG) {
    const item = registry.skins.find(item => item.id === skin.id)
    assert.equal(item.name, skin.name)
    assert.deepEqual(item.modes, ['light', 'dark'])
    if (['native-verified', 'released'].includes(item.stage)) {
      for (const mode of item.modes) for (const screen of registry.requiredScreens) {
        assert.ok(fs.existsSync(path.join(__dirname, '..', item.nativeEvidence[mode][screen])), `${skin.id}/${mode}/${screen}: evidence required`)
      }
    }
    if (skin.id !== 'classic') assert.ok(skin.light && skin.dark, `${skin.id}: two explicit palettes required`)
    assert.equal(getTheme(skin.id, 'light').isDark, false)
    assert.equal(getTheme(skin.id, 'dark').isDark, true)
  }
  assert.equal(getTheme('removed-skin', 'light'), light)
})

for (const skin of catalog.SKIN_CATALOG) for (const mode of ['light', 'dark']) {
  test(`${skin.id}/${mode}: text, buttons, hero, workout and exported poster are readable`, () => {
    const theme = getTheme(skin.id, mode), p = getWorkoutPalette(theme), poster = getPosterPalette(theme)
    assert.equal(getThemeKey(theme), `${skin.id}/${mode}`)
    assert.equal(getWorkoutPalette(theme), p, 'palette identity is stable between sensor renders')
    for (const surface of ['paper', 'card', 'cardSoft', 'surfaceSoft']) {
      for (const text of ['ink', 'inkSoft', 'muted', 'mutedStrong', 'brandText']) readable(theme[text], theme[surface], `${text} on ${surface}`)
    }
    readable(theme.onBrand, theme.brand, 'primary button')
    readable(theme.heroInk, theme.heroSurface, 'hero headline')
    readable(theme.heroMuted, theme.heroSurface, 'hero secondary text')
    readable(theme.heroAccent, theme.heroSurface, 'hero accent')
    for (const surface of ['bg', 'surface', 'failureSurface']) {
      for (const text of ['ink', 'inkSoft', 'muted', 'brandText', 'warn', 'danger', 'estimate']) readable(p[text], p[surface], `workout ${text} on ${surface}`)
    }
    readable(p.onBrand, p.brandPressed, 'held finish button')
    readable(p.danger, p.dangerFill, 'held discard button')
    for (const text of ['ink', 'muted', 'orange']) readable(poster[text], poster.background, `poster ${text}`)
    for (const name of ['amber', 'red', 'info']) readable(theme[`${name}Ink`], theme[`${name}Soft`], `${name} message`)
  })
}
