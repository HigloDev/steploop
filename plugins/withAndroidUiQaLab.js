const fs = require('fs')
const path = require('path')
const { withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins')

const marker = '// palou-isolated-ui-qa'
function configureQaGradle(contents) {
  if (contents.includes(marker)) return contents
  const anchor = /buildTypes\s*\{\s*debug\s*\{/
  if (!anchor.test(contents)) throw new Error('Android debug build template changed')
  return contents.replace(anchor, match => `${match}\n            ${marker}\n            if (project.hasProperty('uiQa')) {\n                applicationIdSuffix '.uiqa'\n                versionNameSuffix '-uiqa'\n            }`)
}

function configureQaApplication(contents) {
  const anchor = 'context = applicationContext,'
  if (!contents.includes(anchor)) throw new Error('Expo 57 ReactHost template changed')
  if (contents.includes('jsMainModulePath = if (BuildConfig.DEBUG')) return contents
  const extra = `\n      jsMainModulePath = if (BuildConfig.DEBUG && BuildConfig.APPLICATION_ID.endsWith(".uiqa")) "index.uiqa" else ".expo/.virtual-metro-entry",`
  contents = contents.replace(anchor, anchor + extra)
  if (!contents.includes('useDevSupport = BuildConfig.DEBUG')) contents = contents.replace(anchor, anchor + '\n      useDevSupport = BuildConfig.DEBUG,')
  return contents
}

module.exports = config => {
  config = withAppBuildGradle(config, mod => {
    mod.modResults.contents = configureQaGradle(mod.modResults.contents)
    return mod
  })
  return withDangerousMod(config, ['android', async mod => {
    const file = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/java', ...config.android.package.split('.'), 'MainApplication.kt')
    fs.writeFileSync(file, configureQaApplication(fs.readFileSync(file, 'utf8')))
    return mod
  }])
}
module.exports.configureQaGradle = configureQaGradle
module.exports.configureQaApplication = configureQaApplication
