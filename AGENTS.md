# 循阶项目入口

## 开始工作前

1. 先读取根目录 `project-state.json` 和 `PROJECT_STATUS.md`，确认当前开发版本、公开版本及未合入修改。不要从旧报告、旧工作目录或会话记忆推断当前版本。
2. 运行 `git rev-parse --show-toplevel`、`git status --short --branch` 和 `npm run check:project-state`。版本或远端不一致时先说明冲突，不能只改版本号来掩盖旧源码。
3. 当前主版本为 **1.1.5 / Android versionCode 14**；主仓库为 `https://github.com/HigloDev/steploop.git`，默认分支为 `main`。在任务分支上工作是正常的，不能因此切回旧 `master`。

## 当前资料与历史边界

- 当前功能、安装和构建以 `README.md`、`docs/USER_GUIDE.md`、`docs/BUILDING.md` 为入口；发布范围见 `docs/RELEASE_1.1.5.md` 和 `docs/RELEASE_READINESS_20261021.md`。
- `docs/archive/` 及早期 QA 图册是历史证据，默认不作为当前规范；仅在任务需要追溯时读取。历史文件中的“当前”“最新”和测试结果只对当时版本成立。
- 待合入修复由 `project-state.json` 的 `pendingChanges` 列出。保留分支不代表已经合入 `main` 或已包含在公开 APK 中。
- 本地完整旧目录、未提交文件、补丁和 Git bundle 单独归档。恢复位置见被 Git 忽略的 `.project-local.json`；不要将本地配置、签名、备份、原始记录或完整私有归档加入提交。
- 保留其他工作目录中的修改；不要重置、清理或覆盖它们。界面、算法及依赖升级应由各自任务明确授权，不能顺带合入。

## Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## 验证

- 任何皮肤、主题或外观工作，先读 `docs/skins/README.md`、`docs/skins/registry.json` 和 `docs/skins/CONSTRUCTION.md`。新增皮肤先登记稳定ID，浅暗成对，所有页面经 `src/theme.ts` 取语义token；设计图、源码实现、自动通过、原生验证和公开发布分别标记。

- 版本与入口整理：`npm run check:project-state`、`npm run test:project-state`。
- 修改源码或构建流程：按变更范围运行 `npm run typecheck`、`npm test` 及现有 CI。自动检查与原生/真实运动验收分别记录。
- 不改写历史 Release 标签或已有附件；新发布时同时更新实际源码版本与 `project-state.json`，并保留当前开发版和已公开版本的区别。
