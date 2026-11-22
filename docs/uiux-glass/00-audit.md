# 循阶全局 UI/UX 视觉审查

审查基线为 `aaa6bc8a78dc76d04ef6db6a393d8044ac21324f`。其运行源码及依赖与公开 1.1.7 / code 16 的 `00a5f54` 一致。工作树从干净提交建立，发布目录里并行的恢复及 B0 实验留在原位。`npm run check:project-state` 已通过。截图基线先读 `docs/skins/evidence/20261028-fidelity/core/classic-light-home.png` 与同目录的 `classic-light-history.png`，它们是历史 Android 图证。比较验收另用相同设备、数据和原生入口重采。

| 页面和入口 | 现有功能及交互 | 源码与审查结论 |
| --- | --- | --- |
| 隐私、首次引导 | 阅读同意、拒绝反馈、三步引导和背景训练提示 | `App.tsx`、`Privacy.tsx`、`Onboarding.tsx`。长文应有稳定底色和足够留白 |
| 首页 | 查看每周统计和高度参照、周分享、楼栋选择和编辑、新楼起点、开始、未结束训练恢复、最近记录 | `Home.tsx`。实拍原版周统计抢占首屏，主流程在其下。Bento 将路线和主操作向前，保留未结束训练优先的告警 |
| 实时运动 | 标定、到顶、下行、等待、上爬、结束、防误触及保存失败重试 | `Workout.tsx`、`useFusionWorkout.ts`、`workout-ui.tsx`。数值已有 Reanimated，减少动效已有入口，视觉先拉开状态、数据与操作的角色。高频计时不触发整页过渡 |
| 结算与旧记录 | 累计、逐轮、修正、楼栋保存、课程反馈、返回、分享 | `Summary.tsx`、`Result.tsx`、`completion-celebration.tsx`。保留新鲜完成与历史查看的区别。主数据和逐轮证据可拆成两个阅读层级 |
| 教练 | 课程选择和进度、当次训练、体重与复盘 | `coach-home.tsx`。以当前课程任务为主，日程、说明与课程目录分层 |
| 课程详情、目标、课次、教练记录、复盘 | 课程说明、安排和退出、课程训练、称重和训练记录、下一周调整 | `coach-course.tsx`、`coach-goal.tsx`、`coach-session.tsx`、`coach-records.tsx`、`coach-review.tsx`。共用 `CoachPage`、`CoachSection`，表单和数据组优先采用现有控件 |
| 记录 | 周月季和个人最佳、搜索、筛选、逐条管理、进入详情 | `History.tsx`、`training-visuals.tsx`。图证中三列摘要权重相同，趋势被折叠，记录浏览应保持轻量且可滚动 |
| 设置、外观 | 皮肤和系统明暗、音效、震动、后台引导、数据备份、撤销、帮助 | `Settings.tsx`、`Appearance.tsx`。保留原生控件，使用分组行统一切换与导航的反馈 |
| 周分享、成绩海报工作台 | 样式挑选、图像生成、复制、保存、系统分享 | `WeeklyShare.tsx`、`ShareStudio.tsx`。交互容器用同一主题，现有导出画布、权限检查和保存语义保持原样 |
| 诊断采集 | 准备检查、采集配置、进行中与导出 | `DiagnosticCapture.tsx`。沿用既有开发权限限制，状态信息用稳定表面，禁止动效绑采样 |
| 通用弹层、字段、空和错误 | 选择、管理、删除、修正、提醒、重试 | `flow-sheet.tsx`、`disclosure.tsx`、`ui.tsx`、`app-error-boundary.tsx`。保持关闭及系统返回，通过公共面板收敛边线、投影和焦点 |

根 Native Stack 14 个页面，`Main` 下是训练、教练、记录、设置四个标签，合计 18 个实际页面。源包依赖 Expo ~57.0.30、RN 0.86.3、React 19.2.3、React Navigation 7、@expo/ui、Reanimated 4.5.1 及 SVG。外观由 `skin-catalog.ts`、`appearance.ts`、`theme.ts` 驱动，产品数据通过既有服务保存在本机。运动状态定义、识别、存储和后台服务继续由现有模块拥有。

旧版底栏在两张实拍中贴着系统导航。训练使用品牌或阶梯图标，其余标签及深页混用了 Feather、MaterialCommunityIcons 和 Ionicons。公共 `Button`、`Card`、`Field`、`FlowSheet` 与局部页面容器的圆角和边线重复。主卡、小卡、Dock 和弹层缺少统一的层级登记。运动动效已有实现，改造需要核实时间语义和连续数据，不使用循环动画假装活跃。

按既定冰川科技蓝玻璃 Bento 原型实施，用新增外观承接共同材质。浅深成对，图标来自同一矢量系统，现有皮肤可继续选择。原生真实虚化用 Expo 57 BlurTargetView 和 BlurView，Android 31 以下采用高不透明表面。完成后用同源合成数据和独立 Android 包复查。
