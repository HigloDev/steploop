# 循阶 1.1.2 视觉实施交付

2026-10-10。计划内的10个页面、23个代表状态已落实到现有原生应用，Android 内部包已构建并完成本报告范围内的验收。

目标工作区：`<workspace>`，分支 `codex/continue-fusion-20261009`。这是批准视觉稿对应的1.1.2项目。旧目录 `palou-app` 不是此次交付源码。

## 直接查看和使用

- [原生界面与视觉稿对照图册](qa/ui-redraw-20261010/index.html)，本机浏览地址：<http://127.0.0.1:8792/docs/qa/ui-redraw-20261010/index.html>。
- [最终视觉验收报告](../design-qa.md)：`final result: passed`；记录每轮修正、剩余P3和验收边界。
- [Android独立内部APK](https://github.com/HigloDev/steploop/releases/tag/v1.1.2-preview.1)。不需要电脑上的Metro服务。
- [交付清单](https://github.com/HigloDev/steploop/releases/tag/v1.1.2-preview.1)、[原生操作结果](qa/ui-redraw-20261010/runtime-checks.json)、[安装和数据保留结果](qa/ui-redraw-20261010/release-checks.json)、[源码一致性](qa/ui-redraw-20261010/source-integrity.json)。

APK：`com.zxn.palou`，1.1.2 / versionCode11，最低Android24，targetSDK36，arm64-v8a / x86_64，75,568,635字节。SHA-256：

```text
c50eaf90886c846bab3eb3403f431c28fd9e9a8f817924a8339bf40c1fc3db97
```

使用 Android Debug 内部签名。它是可独立启动的个人内部包，尚未形成商店签名和公开发布。本次没有连接或改动真实手机；签名匹配只对当前模拟器原包确认。

## 计划执行矩阵

|阶段|交付|结果|
|---|---|---|
|锁定视觉权威|保留原7张效果图、10页清单、23个裁切参考；先核对1.1.2版本和真实项目|完成|
|保护当前工作|保存实施前脏工作区437文件、补丁、分支、提交、清单与源码ZIP，逐一核验哈希|完成|
|建立统一视觉基础|暖黑/橙色令牌、数字字重、圆角、卡片、标题、标签栏、原生表单和共享弹窗|完成|
|主页面|首页、记录、设置及设置下半页；保留真实偏好、筛选、趋势、数据入口|完成|
|训练全过程|标定、到顶、自动爬升、下行、等待、长按结束和保存失败页|完成|
|成果和编辑|结算、保存楼栋模板、轮次修正、旧版成绩兼容与人工修正|完成|
|分享|真实可编辑海报、样式、文案、尺寸、相册/系统分享、1080px导出|完成|
|辅助页面|三步引导、隐私摘要和完整正文、条件开放的诊断采样与标注|完成|
|运行截图和修正|23个原生画面、8处局部同框、57张额外截图；修正密度、遮挡、字体和小屏问题|完成|
|功能回归|24类原生操作检查的最新结果全部通过；含真实hook训练保存链路|完成|
|独立构建|同源短路径干净依赖安装，Release variant内嵌JS，排除开发测试入口|完成|
|安装与保留数据|原包同签名覆盖安装，关闭QA Metro后冷启动，原8个存储项完全一致|完成|
|交付|APK、哈希、图册、根目录design-qa.md、结果JSON及本说明|完成|

## 页面与源码

|页面|主要文件|验收状态|
|---|---|---|
|首页|`src/pages/Home.tsx`|home、start-floor、manage、rename|
|记录|`src/pages/History.tsx`|history、筛选和趋势展开、空记录|
|设置|`src/pages/Settings.tsx`|settings、settings-lower、偏好持久化、原生开关|
|训练|`src/pages/Workout.tsx`|climbing、calibrating、calibration_top、descending、waiting、save-failed|
|结算|`src/pages/Summary.tsx`|summary、template、edit-round、修改重算和模板保存|
|分享|`src/pages/ShareStudio.tsx`|share、样式、文案和尺寸、复制与系统分享|
|引导|`src/pages/Onboarding.tsx`|三步、返回、跳过/完成、小屏滚动说明|
|隐私|`src/pages/Privacy.tsx`|七项摘要、完整协议、同意与拒绝返回、长内容滚动|
|旧版成绩|`src/pages/Result.tsx`|legacy、详细成绩、保存人工修正与可信度保留|
|诊断|`src/pages/DiagnosticCapture.tsx`|diagnostic、配置、实际采样、标注和脱敏导出|

共享变更在 `src/theme.ts`、`src/components/` 和 `src/navigation/MainTabs.tsx`。开发截图入口为 `index.uiqa.ts` / `src/dev/UiQaApp.tsx`，APK使用原来的 `index.ts`。`withAndroidUiQaLab.js` 只为指定调试构建提供 `com.zxn.palou.uiqa` 包名，测试数据与普通应用存储分开。

## 实际验证结果

- 390×844dp主页面、390×697dp弹窗，同尺寸同主题对照；密度2倍，系统栏从比较区域裁除，原始PNG保留。
- 小屏320×568dp和130%字号：标定全部操作可见可点、长楼栋名可保存；引导与完整隐私文字可滚动阅读。浅色六页和空首页/记录补验。
- 起始楼层跳过0；重命名、轮次修改、取消、保存、设置和历史数据重启后保持。
- 标定手动记层、撤销、到顶、下一轮、短按保护、长按结束、重试保存和稍后返回通过。
- 真实 `useFusionWorkout` 原生采样和手动标定2层后保存，结算、历史和重启读取通过。它不提供自动识别准确率证明。
- 系统分享取消不写成功记录。实际海报PNG为1080×1350、1080×1080、1080×1440；复制运动摘要、备份到Download、CSV系统导出和取消选文件导入通过。
- 旧版成绩人工修正保存且标记degraded、不进入个人最佳；原生诊断采样与两种标注导出通过，模拟器样本明确invalid。
- 最终APK在关闭本轮Metro、移除8081反向端口后冷启动，首页/记录/设置正常，日志未发现运行时异常。

TypeScript通过，Expo Doctor21/21，QA隔离插件测试2/2，Android构建成功。核心、数据、生命周期等串联套件384项通过，语音35/35通过。

历史测试债务保持公开：完整 `npm test` 在旧训练自动化套件的29项失败停止，和实施前失败名称完全相同；单独PRD88项中40通过、48失败，基线50失败，无新增失败名称。这些测试仍读取旧架构或旧源码结构，未以恢复旧hook、改动算法或降低检查标准来掩盖它们。

## 源码、旧数据与恢复材料

基线保存在 `G:\CDriveData\Users\zxn\Documents\palou-ui-baselines\20261010-002242`。未重置分支、覆盖用户已有修改或提交/推送。

98个 `src/core`、`src/hooks`、`src/services` 和native业务文件与任务开始时基线逐字节相同。Git中这些文件原有的修改仍然保留；不能把整个Git差异当成这次UI任务的新改动。

Windows原长路径遇到Reanimated/Ninja路径问题，独立构建使用 `<build-workspace>`。359个构建输入逐一和交付工作区核对SHA-256一致，干净 `npm ci` 后构建。源码与构建清单见 `build-source-manifest.json`。

原包APK、私有数据备份和普通包运行截图保留于 `.expo-export-check/`。覆盖安装使用 `adb install -r`；没有卸载、清数据或导入。最终启动前后8个存储项语义哈希相同：

```text
4b4fb16f495d7cf54a61e5c6b69bbbb6df9359440c48535fabdcbae7571d45aa
```

数据库内容不放入公开图册或交付JSON。`release-checks.json`只含核验结果和哈希。

## 继续开发和构建

开发请在上述1.1.2工作区运行 `npm start` / `npm run android`，避免从旧目录启动Metro。所用版本为Expo57.0.27、React19.2.3、React Native0.86.3；遵循 [Expo SDK57版本文档](https://docs.expo.dev/versions/v57.0.0/)。

对照自动化脚本位于 `scripts/ui-qa-*.py`。它们默认绑定本轮模拟器 `emulator-5582` 和隔离包，仅供复核；不要改成正式包后运行合成数据准备脚本。设备显示参数在结束时恢复。

本轮独立构建命令（已预构建的同源短路径）：

```powershell
# <build-workspace>\android
$env:PALOU_INTERNAL_BUILD = '1'
.\gradlew.bat :app:assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'
```

真实手机后续安装前应核对它当前包的签名，使用覆盖安装；如果签名不一致，不以卸载来绕过。手机真实爬楼、锁屏连续采样、功耗、TalkBack、iOS/平板和公开发布未在本轮实测。原稿未提供字体文件，并且部分分组稿自身有比例差异；剩余P3已在视觉报告列明，本次不宣称逐像素100%相同。
