const test = require('node:test')
const assert = require('node:assert/strict')
const { configureQaGradle, configureQaApplication } = require('../plugins/withAndroidUiQaLab')

test('visual lab changes only the explicit debug variant; release identity and signing stay intact', () => {
  const input = "android { defaultConfig { applicationId 'com.zxn.palou' } buildTypes { debug { signingConfig signingConfigs.debug } release { signingConfig signingConfigs.release } } }"
  const output = configureQaGradle(input)
  assert.match(output, /debug\s*\{[\s\S]*if \(project.hasProperty\('uiQa'\)\)/)
  assert.match(output, /release \{ signingConfig signingConfigs.release \}/)
  assert.match(output, /applicationId 'com.zxn.palou'/)
  assert.equal(configureQaGradle(output), output)
})

test('QA entry requires both a debug build and the isolated application ID', () => {
  const input = 'ExpoReactHostFactory.getDefaultReactHost(context = applicationContext, packageList = PackageList(this).packages)'
  const output = configureQaApplication(input)
  assert.match(output, /BuildConfig.DEBUG && BuildConfig.APPLICATION_ID.endsWith\(".uiqa"\)/)
  assert.match(output, /else ".expo\/.virtual-metro-entry"/)
  assert.equal(configureQaApplication(output), output)
  assert.throws(() => configureQaApplication('different host template'), /template changed/)
})
