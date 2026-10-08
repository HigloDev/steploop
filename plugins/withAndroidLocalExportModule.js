const fs = require('fs')
const path = require('path')
const { withDangerousMod } = require('@expo/config-plugins')

const nativeRoot = path.join(__dirname, '..', 'native', 'android-local-export')
const packagePath = ['app', 'src', 'main', 'java', 'com', 'zxn', 'palou']

/** App-owned file copies through MediaStore.Downloads need no broad storage permission. */
function withAndroidLocalExportModule(config) {
  return withDangerousMod(config, ['android', async mod => {
    const targetDir = path.join(mod.modRequest.platformProjectRoot, ...packagePath)
    fs.mkdirSync(targetDir, { recursive: true })
    for (const file of ['AndroidLocalExportModule.kt', 'AndroidLocalExportPackage.kt']) {
      fs.copyFileSync(path.join(nativeRoot, file), path.join(targetDir, file))
    }
    const mainPath = path.join(targetDir, 'MainApplication.kt')
    let content = fs.readFileSync(mainPath, 'utf8')
    if (!content.includes('AndroidLocalExportPackage()')) {
      const anchor = 'PackageList(this).packages.apply {'
      if (!content.includes(anchor)) throw new Error('Local export registration anchor missing from Expo MainApplication.kt')
      content = content.replace(anchor, `${anchor}\n          add(AndroidLocalExportPackage())`)
      fs.writeFileSync(mainPath, content)
    }
    return mod
  }])
}

module.exports = withAndroidLocalExportModule
