# 原生实现与工程范围

当前候选工作树从 1.1.7／Android code 16 建立。选择「设置 → 皮肤与外观 → 冰川透蓝」可体验新外观。原有七套外观 ID 与经典默认选项继续可用。

| 范围 | 实现与核对入口 |
| --- | --- |
| 全局 Token 和外观 | `src/theme.ts` 管理主题色、字号、留白、圆角、阴影、玻璃和动效。`src/skin-catalog.ts` 与 `docs/skins/registry.json` 对齐外观登记。 |
| 共用组件 | `src/components/glass-material.tsx`、`ui.tsx`、`flow-sheet.tsx`、`Header.tsx`、`coach-ui.tsx` 和 `sport-ui.tsx` 负责画布、卡片、表单、弹层及训练文字。 |
| Dock 与图标 | `src/navigation/MainTabs.tsx` 复用 React Navigation 的选中语义和切换行为，用原生 BlurTargetView 与 BlurView 生成悬浮 Dock。`src/components/ui-icon.tsx` 提供统一的矢量图标。 |
| 首页与教练 | `src/pages/Home.tsx` 与 `coach-home.tsx` 使用已确认的剪纸楼梯资产，主操作和核心信息优先。主页本周高度、趋势、最近一次采用非对称 Bento。 |
| 实时与结算 | `src/pages/Workout.tsx`、`Summary.tsx`、`Result.tsx`、`src/components/workout-ui.tsx` 和 `glacier-graphics.tsx` 展示现有状态、实时数据、轨道和徽章。 |
| 记录与辅助页 | `History.tsx` 以高度大字与趋势分层。`Settings.tsx`、`Appearance.tsx`、`Onboarding.tsx`、`Privacy.tsx`、`ShareStudio.tsx`、`WeeklyShare.tsx`、`DiagnosticCapture.tsx` 与教练子页采用对应的共享组件与图标。 |
| 设备检查 | `scripts/ui-glass-native-qa.py` 拒绝真机串号和未获准的 AVD，只打开隔离包 `com.zxn.palou.uiqa`，用测试入口的合成场景截图、抓取无障碍树并执行触控回归。 |

玻璃采用项目 Expo SDK 57 对应的 `expo-blur ~57.0.3`。Android 原生背景模糊集中在 Dock 和首页叠在楼梯图上的楼栋入口。一般卡片采用按角色分配的半透明表面、细边线与高光，低 API 或目标尚未布局时显示近不透明表面。对应 SDK 文档见 [Expo BlurView SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/blur-view/)。

运动轨道从现有起点、当前层与折返层计算可视进度。已有动效表达数字变化和结束反馈，新增徽章只装饰已有结算。确认防误触、保存状态及历史查看由原有业务路径决定。训练、传感器、持久化及统计保护通过源码差异和现有回归验证，设备验收范围见验收记录。

运行 `npm run typecheck`、`npm test` 与 `git diff --check`。原生复查需要先在隔离 AVD 装入 QA 包，再用 `python scripts/ui-glass-native-qa.py --serial emulator-5584 --group all --skin glacier-glass --mode light --flow --out output/uiux-glass/recheck`。测试脚本在录入任何触控前检查设备和包身份。
