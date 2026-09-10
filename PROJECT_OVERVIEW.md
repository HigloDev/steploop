# 循阶（steploop / palou-app）项目总纲

更新日期：2026-09-10

## 项目定义

Expo SDK 57 + React Native 的爬楼训练 App。用手机传感器识别楼层、转向与多轮训练，输出可学习路线、结构化成绩与分享海报。公开发布以「可信训练版」门槛为准。

- 包名：`com.zxn.palou`；npm name：`steploop`；Expo slug：`steploop`
- 远程：`https://gitee.com/higlo/palou-app.git`（分支 `master`）
- 技术栈：Expo 57 / RN 0.86 / React 19 / TypeScript / AsyncStorage；地图为高德 WebView JS API

## 当前阶段

**可信训练版工程实现已落地并通过本地自动化验证；公开发布被真实验证集与外部验收阻断。**

## 目标与门槛

见 `docs/trusted-release-baseline.md`。摘要：

| 类别 | 门槛 |
|---|---|
| 最终楼层准确率 | ≥ 98% |
| 楼层事件 P/R | ≥ 96% / ≥ 96% |
| 负样本误报率 | ≤ 1% |
| 识别延迟中位数 / P95 | ≤ 2s / ≤ 4s |
| 完整训练无崩溃率 | ≥ 99.8% |

无冻结真实验证集时，构建只能标记为封闭测试版。

## 核心业务对象

- `RouteTemplate`：路线模板；模型版本 V3（`src/core/route-model.ts`）
- `ClimbWorkout` / `WorkoutRound`：一次训练含多轮
- `ActiveWorkoutCheckpoint`：训练中断恢复
- 诊断包 V2：`src/core/diagnostics.ts` / `src/services/diagnostics.ts`

主流程：`RouteEdit → LocationPicker → Calibrate → Review/Validate → RouteProfile → WorkoutSetup → ClimbWorkout → WorkoutResult → ShareStudio`

## 自动验收入口

```powershell
npm test
npx tsc --noEmit
npx expo export --platform android --output-dir .expo-export-check --clear
npm run diagnostics:replay -- --out <report.json> <诊断目录>
npm run diagnostics:gate -- <report.json>
npm run diagnostics:smoke
npm run smoke:android -- -Serial <device-serial>
```

## 最近验证

- 2026-09-10：`npm test` 29/29 通过；`npx tsc --noEmit` 通过；`expo export --platform android` 成功；`npm run diagnostics:smoke` 链路通过。

## 关键文档

| 文档 | 用途 |
|---|---|
| `docs/trusted-release-baseline.md` | 发布门槛与阻断项 |
| `docs/trusted-release-implementation.md` | 已落地能力与外部验收清单 |
| `docs/algorithm-validation.md` | 诊断采集/回放/合并协议 |
| `docs/regression-checklist.md` | 真机回归清单 |
| `PROJECT_STATUS.md` | 当前状态矩阵与风险 |

## 已知边界

- 正式支持裤袋与腰包；手持仅为鲁棒性样本。
- 无气压计设备降级并降低置信度上限。
- 合成/纯函数测试保护逻辑回归，不能证明真实准确率。
- 开始训练倒计时已移除；已验证路线仍保留「3 秒自动完成 + 撤销」。
- 客户端高德 Key 必须在控制台轮换并限制来源；环境变量不能把 Key 变成秘密。
