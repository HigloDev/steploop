# 冰川透蓝原生验收

## 版本和证据

使用独立工作树 `G:/sl-glass-20261118`。基线是发布维护库的 `aaa6bc8a78dc76d04ef6db6a393d8044ac21324f`。证据来自 Android API 35 的 `steploop_skins_20261028` AVD 和隔离应用 `com.zxn.palou.uiqa`。前后使用相同合成训练记录、楼栋和字体设置。六页实拍按前后分栏，开头状态栏和设备 UI 都保留在原图中。[原生前后对比](evidence/native-comparison.png) · [新版六页](evidence/native-overview.png) · [安装与 SHA-256](evidence/apk-install.txt)

| 验收面 | 验证记录 |
| --- | --- |
| 浅色全页面 | 400dp、125% 字号。18 个入口全部打开并采集原生截图与无障碍树。初次录屏脚本把运动场景当成首页取标记，失败保留在其回执中。六个核心页在状态栏顺序修复后重新安装并复查。[18 页原片](evidence/after-final-light/receipt.json) · [核心回执](evidence/after-verified-light/receipt.json) |
| 训练状态 | 标定、到顶、下行、等待、保存失败与空记录六个现有状态均有截图。运动页面统一高对比深色。[状态回执](evidence/after-final-states/receipt.json) |
| 深色与小屏 | 六个核心页分别在深色 400dp／125% 和浅色 320dp／130% 打开。小屏首页统计改为单列，操作区仍在滚动内容中可达。[深色回执](evidence/after-final-dark/receipt.json) · [小屏回执](evidence/after-final-small/receipt.json) |
| 导航与反馈 | 实际点击四个标签并重复巡回、检查无障碍树的 selected 值。教练、记录与设置下方内容在经过 Dock 时被原生虚化。Dock 与系统手势区有间距。 |
| 原有交互 | 实际触控验证短按不会结束、长按进入成绩、标定楼层 +1 并可撤销、记录筛选空结果可读。保存及状态分支在 QA 测试数据下执行。 |

## 楼层动效

隔离 QA 场景在运动中提供一次合成的可信上爬事件，复用实际运动 UI。录屏与 UI 树分别核对 9 楼和 10 楼，数字、轨道及累计指标更新。逐帧核对期间，完整动效出现扩散并收束的轨道光晕。开启 Android 减少动效后，数值和轨道端点直接更新，轨道保留稳态圆点。测试后恢复 AVD 原设置。[完整动效录屏](evidence/motion-normal/floor-motion.mp4) · [减少动效录屏](evidence/reduced-motion/floor-motion.mp4) · [原生帧对照](evidence/floor-motion-frame-comparison.png)

## 帧时记录

同一最终 APK、同一 API 35 AVD、400dp／125% 的两次样本，各执行两轮四标签切换。两次都在首页就绪后清零 `gfxinfo`。

| 外观 | 帧数 | Android 计为 janky | P50 | P95 |
| --- | ---: | ---: | ---: | ---: |
| 经典 | 195 | 187，95.90% | 89ms | 150ms |
| 冰川透蓝 | 180 | 163，90.56% | 93ms | 200ms |

两种外观在这台模拟器上的帧时均偏高。冰川透蓝样本的尾部帧时更长，流畅性验收仍未通过。这里的样本用于定位开销，真机长时间运行需要独立的性能结果。[经典原始帧时](evidence/perf-classic/gfxinfo-tab-flow.txt) · [冰川原始帧时](evidence/perf-glass/gfxinfo-tab-flow.txt)

## 自动化与保护

- `npm run check:project-state`、`npm run typecheck`、`git diff --check` 通过。原有 `npm test` 包含 772 项，739 通过，33 项按原有条件跳过，0 失败。页面处理程序测试保留原有断言，仅调整容器注册断言、图标和视觉组件的测试替身。[自动化汇总](evidence/automation-summary.txt)
- SDK 57 匹配新增的唯一运行依赖 `expo-blur ~57.0.3`。基线与候选的 Expo 依赖检查都提出同样七项既有版本建议，本轮未升级这些依赖。`package.json` 新增一行，锁文件新增 12 行。
- `src/core/`、`src/hooks/`、`src/services/`、`native/`、`plugins/` 与 `app.json` 差异为空。没有迁移数据、变更计层、改动正式暂停、开启 B0 或调整正式包标识。测试入口只写 QA 包的合成数据。正式签名、发布及手机安装都未发生。
- 早期 APK 实拍定位到导航回调直接执行 Hook 的崩溃。已经改为由回调返回 React 组件。另两次软件渲染模拟器进程退出，现有取证使用独立 AVD 的主机 GPU；模拟器退出单列为环境故障。

## 待验收范围

| 优先级 | 范围 | 证据与边界 |
| --- | --- | --- |
| P1 | 真机长时间训练、掉帧与能耗 | 模拟器两套外观帧时均偏高。真机传感器、后台能力和真实能耗没有设备实测。 |
| P1 | 旧版 Android 的材质降级 | Dock 与首页按 API 及目标可用性降级。本次安装仅覆盖 API 35，API 24–30 和其他 GPU 没有实际运行结果。 |
| P2 | 读屏和全矩阵 | 已采集无障碍树并验证按钮标签、选中及 130% 字号。完整 TalkBack 走查、所有页面的深色小屏组合等待实测。 |
| P2 | 视觉确认 | 原生图与已确认原型一并交付。课程页依现有课程状态展示内容，示例文案与数字随测试数据变化。最终观感以产品负责人对实拍的反馈为准。 |
