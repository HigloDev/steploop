# 当前项目状态

更新日期：2026-10-28。机器可读版本信息见 [project-state.json](project-state.json)；开始工作先运行 `npm run check:project-state`。

## 当前开发工作：皮肤系统（未发布）

隔离分支 `codex/skins-system-20261028` 基于1.1.5主版本建设7套可切换皮肤，每套具有浅暗配色。规划与状态见 [皮肤建设索引](docs/skins/README.md)。这不表示现有公开1.1.5 APK已经具备皮肤选择；并行教练工作和待合入审计修复保持独立。

## 当前基准

- 当前主版本：**1.1.5 / Android versionCode 14**，默认分支 `main`。
- 主仓库：[HigloDev/steploop](https://github.com/HigloDev/steploop)。Gitee `master` 和早期本地工作目录是历史来源。
- 已公开版本：[v1.1.5-preview.1](https://github.com/HigloDev/steploop/releases/tag/v1.1.5-preview.1)，2026-10-21 发布；发布源码为 `77c148a63c35c179fbaa1537b422cd3a8f33fb5c`。
- 本次整理从 GitHub `main` 的 `9f01ba87548e4858544abd2a72e5d9c32c528ff4` 开始，该提交已包含 1.1.5 源码和新版下载页。
- 2026-10-27的版本归档仅整理入口、版本检查和历史资料。当前皮肤开发另见上文，不修改训练算法、应用依赖或已发布 APK。

当前使用说明见 [用户指南](docs/USER_GUIDE.md)，构建见 [构建说明](docs/BUILDING.md)，发布内容及证据边界见 [1.1.5 说明](docs/RELEASE_1.1.5.md) 和 [发布状态](docs/RELEASE_READINESS_20261021.md)。现有界面依据与图册从 [视觉基准](design-qa.md) 进入。

## 后续修复：已保存，尚未合入

[codex/fix-115-audit-20261023](https://github.com/HigloDev/steploop/tree/codex/fix-115-audit-20261023) 的提交为 `f11687d200bd4478991aecf6a665b662c3691735`，基于 1.1.5 发布源码，包含训练计层、采样、备份恢复及设置页修复。

该分支单独保留，不能宣称已存在于 `main` 或当前公开 APK。版本归档时未合入此修复；皮肤任务也不顺带合入它。以后应基于当前 `main` 单独审查该修复提交，保留已发布下载页，完成对应验证后再决定合入及发布。

## 历史与本地资料

- 旧版本发布说明、早期交接和 1.1.2 视觉验收已进入 [历史索引](docs/archive/README.md)。旧 QA 图册保留原链接，适用版本见 [QA 索引](docs/qa/README.md)。
- 原 1.0.7 工作目录完整保留在主项目之外，包括未提交内容、未跟踪文件、本地配置、生成目录和 `.git`；另有补丁、文件清单、校验记录及分支 bundle。
- 本机恢复入口在被 Git 忽略的 `.project-local.json`。私有归档不上传 GitHub，不能批量加入 Git。
- 其他历史构建/审计目录按索引保留原路径；它们不再是日常开发入口。

本次目录归一不代表真实爬楼、锁屏连续采样、耗电或手机升级验收新增通过；这些仍以对应候选及证据记录为准。
