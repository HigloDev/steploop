# Android 本地构建

使用 Expo SDK 57。依赖安装用 `npm ci`，不要随意升级 SDK 或原生依赖。

## 环境

- Node.js 22.13+（22.x）、npm。
- JDK 17 或 21，Android SDK Platform 36；NDK/CMake 版本由生成工程指定。
- `ANDROID_HOME` 指向 Android SDK；`JAVA_HOME` 指向 JDK。
- 全量测试使用 FFmpeg 的 `ffprobe` 检查预录 MP3。
- Windows 映射目录必须从实际路径执行，避免 Metro/Gradle 混用盘符。

```sh
npm ci
npm test
npx tsc --noEmit
npx expo-doctor
```

## 调试

```sh
npx expo run:android
```

Expo Go 不包含项目的自定义原生模块。修改 `native/`、插件或原生配置后，先运行 `npx expo prebuild --platform android --no-install`。不要用 `--clean` 删除现有工程中的本地改动。

## 发布签名

发布密钥和属性文件必须放在仓库之外，并另行安全备份。签名属性格式：

```properties
storeFile=/absolute/path/outside/repository/release.p12
storePassword=YOUR_PRIVATE_PASSWORD
keyAlias=YOUR_KEY_ALIAS
keyPassword=YOUR_PRIVATE_PASSWORD
```

不要将真实口令放进命令行、Git、Issue 或构建日志。设置 `PALOU_SIGNING_PROPERTIES` 为属性文件的绝对路径。公开构建不要设置 `PALOU_INTERNAL_BUILD=1`；该选项仅供沿用旧内部证书的个人升级。

PowerShell 示例（公开候选，不嵌入本机地图凭据）：

```powershell
$env:PALOU_SIGNING_PROPERTIES = 'D:\private\steploop\signing.properties'
$env:EXPO_NO_DOTENV = '1'
$env:EXPO_PUBLIC_AMAP_JS_KEY = ''
$env:EXPO_PUBLIC_AMAP_SECURITY_CODE = ''
$env:EXPO_PUBLIC_DIAGNOSTIC_CAPTURE = '0'
$env:NODE_ENV = 'production'
Remove-Item Env:PALOU_INTERNAL_BUILD -ErrorAction SilentlyContinue
npx expo prebuild --platform android --no-install
Set-Location android
.\gradlew.bat :app:assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64' --max-workers=4 --console=plain
```

macOS/Linux 使用等价环境变量和 `./gradlew`。APK 位于 `android/app/build/outputs/apk/release/app-release.apk`，包含 JS，无须 Metro。

## 交付核对

使用 Android SDK 的 `apksigner verify --verbose --print-certs` 与 `aapt dump badging` 检查证书、包名、版本、SDK 和架构，另计算 SHA-256。不要把 debug 证书的内部包标作公开包。

GitHub Release 应上传 APK、SHA256SUMS.txt 和发布说明，选择 Pre-release。Source code ZIP 用于源码浏览，不可代替 APK。候选包必须先在隔离设备完成安装/启动/保存检查，再补真实训练证据；构建成功不等于验收通过。

`npm run release:check` 是本地工程检查，不会代替真实运动验收，也不会上传任何内容。
