// Expo config plugin：把自定义 Android 定位模块注入 prebuild 生成的 android 工程。
//
// 背景：部分国产 ROM 上 Google Fused Location 不把定位结果交给 Expo，
// 项目手写了直读系统 LocationManager 的原生模块（AndroidSystemLocation）。
// android/ 目录由 `expo prebuild` 生成且被 .gitignore 忽略，若不加本插件，
// 新鲜 clone 或云构建（EAS）都会静默丢失该模块。
//
// 本插件在 prebuild 时：
// 1. 把 native/android-location/*.kt 复制到 android/app/src/main/java/com/zxn/palou/
// 2. 在 MainApplication.kt 的 PackageList 中注册 AndroidLocationPackage()
//
// 源文件唯一真源：native/android-location/（已纳入版本库）。

const fs = require('fs')
const path = require('path')
const { withDangerousMod } = require('@expo/config-plugins')

const MODULE_SOURCE_DIR = path.join(__dirname, '..', 'native', 'android-location')
const MODULE_TARGET_DIR = ['app', 'src', 'main', 'java', 'com', 'zxn', 'palou']
const KOTLIN_FILES = ['AndroidLocationModule.kt', 'AndroidLocationPackage.kt']
const MAIN_APPLICATION_FILE = 'MainApplication.kt'
// prebuild 重新生成 MainApplication.kt 时保留的稳定锚点
const PACKAGE_LIST_ANCHOR = 'PackageList(this).packages.apply {'
const REGISTRATION_LINE = '          add(AndroidLocationPackage())'

function withAndroidLocationModule(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.platformProjectRoot
      const targetDir = path.join(projectRoot, ...MODULE_TARGET_DIR)
      fs.mkdirSync(targetDir, { recursive: true })

      for (const file of KOTLIN_FILES) {
        const source = path.join(MODULE_SOURCE_DIR, file)
        if (!fs.existsSync(source)) {
          throw new Error(
            `[withAndroidLocationModule] 缺少源文件 ${source}，请检查 native/android-location/`,
          )
        }
        fs.copyFileSync(source, path.join(targetDir, file))
      }

      const mainApplicationPath = path.join(targetDir, MAIN_APPLICATION_FILE)
      if (!fs.existsSync(mainApplicationPath)) {
        throw new Error(
          `[withAndroidLocationModule] 未找到 ${mainApplicationPath}，prebuild 输出结构异常`,
        )
      }
      let content = fs.readFileSync(mainApplicationPath, 'utf8')
      if (!content.includes('AndroidLocationPackage()')) {
        if (!content.includes(PACKAGE_LIST_ANCHOR)) {
          throw new Error(
            '[withAndroidLocationModule] MainApplication.kt 缺少 PackageList 锚点，请检查 Expo SDK 模板',
          )
        }
        content = content.replace(
          PACKAGE_LIST_ANCHOR,
          `${PACKAGE_LIST_ANCHOR}\n${REGISTRATION_LINE}`,
        )
        fs.writeFileSync(mainApplicationPath, content)
      }
      return config
    },
  ])
}

module.exports = withAndroidLocationModule
