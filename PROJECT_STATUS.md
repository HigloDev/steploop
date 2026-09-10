# 项目状态

更新日期：2026-09-10

## 状态矩阵

| 项 | 状态 | 说明 |
|---|---|---|
| 多轮训练重构 | 已完成并验证 | 状态机、检查点、汇总、历史兼容 |
| 可信识别（多证据 + 0.90 自动完成可撤销） | 已完成并验证 | 纯函数测试覆盖 |
| 诊断采集 / V2 包 / 离线回放 / 发布门禁 | 已完成并验证 | 工具链与脱敏已加固；缺真实数据集 |
| 路线模型 V3 学习 | 已完成并验证 | 五次一致可信训练可验证 |
| 备份 V2 + 兼容 V1 | 已完成并验证（逻辑） | 导出走 listRoutes；迁移成功清理旧键 |
| 高德环境变量注入 | 已完成 | 需控制台轮换与来源限制（外部） |
| Android 权限收敛 | 已完成 | 真机 Manifest 冒烟待矩阵执行 |
| 分享海报 | 已完成并验证 | `design-qa.md` passed |
| 本地自动化（test + tsc） | 已完成并验证 | 2026-09-10：29/29 + tsc 通过 |
| expo export 冒烟 | 已完成并验证 | 2026-09-10 Android 导出成功 |
| 诊断回放/门禁 CLI 链路 | 已完成并验证 | 合成夹具 E2E；门禁正确拒绝不达标数据 |
| 真实验证集与 gate 指标 | 被阻塞 | 需真机采集，`C:\diagnostics` 不存在 |
| 真机矩阵 / 耗电 / TalkBack / 杀进程 | 被阻塞 | 需人工；当前无 adb 设备连接 |
| Release 签名、升级不丢数据、断 Metro | 被阻塞 | 需正式签名配置 |
| 公开发布 | 被阻塞 | 门槛未在真实数据上证明 |

## 本轮已修复（2026-09-10 审计）

- P0：诊断导出剥离绝对 `createdAt`，文件名不再含绝对 ISO 时间
- P0：`exportRawData` 改走 `listRoutes()`，避免绕过 V3 迁移丢路线
- P1：V3 迁移写入成功后清理 `palou.routes.v1/v2`
- P1：传感器权限误导文案修正；删除未使用 `registerPrivacyHandler`
- P1：补导出脱敏、空数据集比较、卡路里测试（29 用例）
- P2：隐私协议补充诊断包导出说明

## 仍存在的工程边界

- `/android` 依赖 config plugin 在 prebuild 注入 `native/android-location`；封闭包必须用含该插件的 prebuild 流程验收
- 客户端高德 Key 不可保密，必须控制台轮换与来源限制
- 合成诊断夹具只证明工具链，**不能**当作真实准确率证据

## 风险

| 级别 | 风险 | 处置 |
|---|---|---|
| P0 | 无真实验证集，不能声明准确率门槛 | 按 `algorithm-validation.md` 矩阵采集 |
| P0 | 高德 Key 未确认轮换/来源限制 | 高德控制台操作（需负责人） |
| P1 | 真机与发布矩阵未跑 | 排期执行回归清单 + smoke:android |
| P1 | 原生定位模块依赖 prebuild 插件 | 封装包验收时确认 Kotlin 注入成功 |
| P2 | 文档与实现需持续对齐 | 以代码+测试为准修订 docs |

## 决策记录（摘要）

1. 业务对象从单次 `ClimbSession` 升级为多轮 `ClimbWorkout`；旧数据在历史中兼容展示。
2. 开始训练倒计时移除；已验证路线保留 3 秒自动完成 + 撤销。
3. 诊断包 V2 兼容 V1；`invalid` 样本保留但不进发布指标；导出强制二次脱敏。
4. 高德 Key 改 `EXPO_PUBLIC_*` 注入，不进业务源码硬编码。
5. 在真实验证集达标前，版本只能作为封闭测试。
6. 备份导出必须经过 `listRoutes()`，保证旧路线不因迁移失败而从备份中消失。

## 下一步（优先级）

1. 真实诊断数据采集 → `diagnostics:replay` + `diagnostics:gate`
2. 真机回归：`docs/regression-checklist.md` + `npm run smoke:android`
3. 高德控制台密钥轮换与来源限制
4. Release 签名与升级/断 Metro 验收
5. 带 `withAndroidLocationModule` 的 prebuild 出封闭 APK 并确认原生定位模块在包内

## 交接注意

- `.env.local` 含高德 Key，已 gitignore，勿提交、勿外传。
- `/android`、`/ios` 为本地生成目录，不入库；原生定位模块源码在 `native/`。
- 算法或传感器相关合并需附：数据集指纹、前后报告、分组结果、资源对比、失败样本（见 `algorithm-validation.md`）。
- 合成诊断夹具在 `.diagnostics-synthetic/`（已 gitignore），仅用于链路冒烟。
