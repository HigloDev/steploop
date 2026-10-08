const fs = require('fs')
const path = require('path')
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins')

const SOURCE = path.join(__dirname, '..', 'native', 'android-training')
const FILES = ['AndroidTrainingPackage.kt', 'AndroidTrainingModule.kt', 'AndroidTrainingService.kt', 'TrainingSensorJournal.kt', 'TrainingJournalReader.kt']
const NOTIFICATION_DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']
const PERMISSIONS = ['android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_HEALTH', 'android.permission.ACTIVITY_RECOGNITION', 'android.permission.POST_NOTIFICATIONS', 'android.permission.WAKE_LOCK', 'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS']

function configureTrainingManifest(manifest) {
  manifest['uses-permission'] ||= []
  for (const name of PERMISSIONS) if (!manifest['uses-permission'].some(p => p.$?.['android:name'] === name)) {
    manifest['uses-permission'].push({ $: { 'android:name': name } })
  }
  const application = manifest.application?.[0]
  if (!application) throw new Error('[withAndroidTrainingModule] AndroidManifest application is missing')
  application.service ||= []
  let service = application.service.find(s => s.$?.['android:name'] === '.AndroidTrainingService')
  if (!service) { service = { $: { 'android:name': '.AndroidTrainingService' } }; application.service.push(service) }
  Object.assign(service.$, { 'android:exported': 'false', 'android:foregroundServiceType': 'health', 'android:stopWithTask': 'false' })
  return manifest
}

function installTrainingSources(androidRoot) {
  const target = path.join(androidRoot, 'app', 'src', 'main', 'java', 'com', 'zxn', 'palou')
  fs.mkdirSync(target, { recursive: true })
  for (const name of FILES) fs.copyFileSync(path.join(SOURCE, name), path.join(target, name))
  for (const density of NOTIFICATION_DENSITIES) {
    const directory = `drawable-${density}`
    const resources = path.join(androidRoot, 'app', 'src', 'main', 'res', directory)
    fs.mkdirSync(resources, { recursive: true })
    fs.copyFileSync(path.join(SOURCE, 'res', directory, 'ic_stat_steploop.png'), path.join(resources, 'ic_stat_steploop.png'))
  }
  const applicationPath = path.join(target, 'MainApplication.kt')
  let content = fs.readFileSync(applicationPath, 'utf8')
  if (!content.includes('add(AndroidTrainingPackage())')) {
    const anchor = 'PackageList(this).packages.apply {'
    if (!content.includes(anchor)) throw new Error('[withAndroidTrainingModule] Expo MainApplication PackageList anchor changed')
    content = content.replace(anchor, `${anchor}\n          add(AndroidTrainingPackage())`)
    fs.writeFileSync(applicationPath, content)
  }
}

function withAndroidTrainingModule(config) {
  config = withAndroidManifest(config, config => { configureTrainingManifest(config.modResults.manifest); return config })
  return withDangerousMod(config, ['android', async config => {
    installTrainingSources(config.modRequest.platformProjectRoot)
    return config
  }])
}

module.exports = withAndroidTrainingModule
module.exports.configureTrainingManifest = configureTrainingManifest
module.exports.installTrainingSources = installTrainingSources
