# 1.1.0 手机测试源码快照

本分支保存 2026-10-09 已安装到测试手机的 1.1.0 / versionCode 9 源码。它基于无 Git 历史的本地交接包开发，不是对 GitHub 1.0.7 主分支的完整合并。主分支保留原样；本分支用于备份、复现及后续整合，不能直接视为可无损合并的发布分支。

本地核心测试 128 项、数据及服务测试 92 项、TypeScript、Expo Doctor 21 项及 Android release 构建通过，覆盖安装和冷启动成功。上传副本另通过 TypeScript 检查。未进行真实楼梯、电梯和锁屏训练验收。

上传时发现远端存在本地交接包没有的源码。为使运行源码与手机测试包一致，本快照未包含以下远端文件（仍完整保留在 main）：

- `scripts/replay-motion-evidence.cjs`
- `scripts/test-motion-recognition.cjs`
- `scripts/test-route-preparation.cjs`
- `src/components/flow-motion.tsx`
- `src/core/motion-signal.ts`
- `src/core/pressure-trend.ts`
- `src/core/route-file.ts`
- `src/core/route-motion.ts`
- `src/core/route-preparation.ts`
- `src/pages/AddRoute.tsx`
- `src/pages/Familiarize.tsx`
- `src/services/preparation-device.ts`
- `src/services/preparation-recording.ts`
- `src/services/recorded-motion-recognizer.ts`
- `src/services/route-sharing.ts`

其中两份远端测试不在本地原始交接包中，未纳入上述测试计数。《RELEASE_1.1.0.md》的“没有删除旧测试”仅指本地交接包里的测试，不代表本快照与远端 main 没有测试差异。与 main 的 motion-v3、路线文件分享和诊断工具的完整兼容整合仍需单独核对，不能沿用本地测试结论。

此次上传不包含安装包、手机旧 APK、私有数据、签名材料、构建日志或缓存。安装包已通过 USB 安装到用户手机。
