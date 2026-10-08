const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { withDangerousMod, withAndroidManifest } = require('@expo/config-plugins')

const nativeRoot = path.join(__dirname, '..', 'native', 'android-voice')
const voiceRoot = path.join(__dirname, '..', 'assets', 'voice')
const packagePath = ['app', 'src', 'main', 'java', 'com', 'zxn', 'palou']

/** Follows this app's existing location-module registration and prebuild ownership. */
function withAndroidVoiceModule(config) {
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest
    const queries = manifest.queries ?? []
    if (!queries.some((query) => (query.intent ?? []).some((intent) =>
      (intent.action ?? []).some((action) => action.$?.['android:name'] === 'android.intent.action.TTS_SERVICE'),
    ))) {
      if (queries.length === 0) queries.push({})
      queries[0].intent = queries[0].intent ?? []
      queries[0].intent.push({ action: [{ $: { 'android:name': 'android.intent.action.TTS_SERVICE' } }] })
    }
    manifest.queries = queries
    return mod
  })
  return withDangerousMod(config, ['android', async (mod) => {
    const projectRoot = mod.modRequest.platformProjectRoot
    const targetDir = path.join(projectRoot, ...packagePath)
    const assetDir = path.join(projectRoot, 'app', 'src', 'main', 'assets', 'voice')
    fs.mkdirSync(targetDir, { recursive: true })
    fs.mkdirSync(assetDir, { recursive: true })
    for (const file of ['AndroidVoiceModule.kt', 'AndroidVoicePackage.kt']) {
      fs.copyFileSync(path.join(nativeRoot, file), path.join(targetDir, file))
    }
    const catalog = JSON.parse(fs.readFileSync(path.join(voiceRoot, 'catalog.json'), 'utf8'))
    const manifest = JSON.parse(fs.readFileSync(path.join(voiceRoot, 'manifest.json'), 'utf8'))
    const speakers = ['serena', 'vivian', 'uncle_fu', 'dylan']
    if (catalog.version !== 3 || manifest.version !== 3) throw new Error('Four voice packs require voice catalog v3')
    const selected = []
    for (const speaker of speakers) for (const id of Object.keys(catalog.clips)) {
      if (!/^[a-z][a-z0-9_]{0,60}$/.test(id)) throw new Error('Invalid voice clip ID')
      const relative = `${speaker}/${id}.mp3`
      const source = path.join(voiceRoot, relative)
      const item = manifest.files.find(file => file.file === relative)
      const bytes = fs.readFileSync(source)
      if (!item || item.text !== catalog.clips[id] || item.bytes !== bytes.length ||
          item.sha256 !== crypto.createHash('sha256').update(bytes).digest('hex')) throw new Error(`Voice integrity mismatch: ${relative}`)
      selected.push({ source, target: path.join(assetDir, relative) })
    }
    for (const { source, target } of selected) {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(source, target)
    }
    // These generated legacy clip names belonged to the previous single-voice pack.
    for (const id of Object.keys(catalog.clips)) {
      const legacy = path.join(assetDir, `${id}.mp3`)
      if (fs.existsSync(legacy)) fs.unlinkSync(legacy)
    }
    fs.copyFileSync(path.join(voiceRoot, 'manifest.json'), path.join(assetDir, 'manifest.json'))
    const mainPath = path.join(targetDir, 'MainApplication.kt')
    let content = fs.readFileSync(mainPath, 'utf8')
    if (!content.includes('AndroidVoicePackage()')) {
      const anchor = 'PackageList(this).packages.apply {'
      if (!content.includes(anchor)) throw new Error('Voice registration anchor missing from Expo MainApplication.kt')
      content = content.replace(anchor, `${anchor}\n          add(AndroidVoicePackage())`)
      fs.writeFileSync(mainPath, content)
    }
    return mod
  }])
}

module.exports = withAndroidVoiceModule
