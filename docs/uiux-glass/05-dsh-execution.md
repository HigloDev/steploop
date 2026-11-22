# DeepSeekHarness 执行记录

Codex 负责分工、范围保护和独立验收。DeepSeekHarness 在 Windows 工作树对应的 WSL Ubuntu 路径运行并行任务。主视觉采用此前确认的冰川蓝玻璃 Bento。Impeccable 4.9.2 启动器以 `App.tsx` 为目标运行，前置读取了 Impeccable 及 Expo Overview、Design System、Native UI、Animation、Expo UI 的适用规范。

| 分工 | DSH 交付 | Codex 验收 |
| --- | --- | --- |
| 基础与 Dock | Token、玻璃材质、导航、布局和原型调整 | 验证挂载、选中语义、安全区和半透明模糊。独立修复 TabBar 的 Hook 挂载方式。 |
| 核心页面 | 首页、运动、成绩和记录，以及原型对照修整 | 对照剪纸资产和实拍，复查长按、实时指标、深色运动与轮次展示。 |
| 辅助页面 | 教练、设置、隐私、引导、分享、诊断的共享样式 | 检查大字号、课程操作、设置分组与夜间可读性。 |
| 图标 | 四个原创 Dock 矢量和全套语义图标 | DSH 最后一批迁移遇到直连余额限制。Codex 审查其迁移草稿并完成调用迁移和原生验证。 |

## OpenDesign Go 调用核验

本机 DSH 网页配置已有 `opendesign-go`，而命令行 `headless` 的旧默认是 `deepseek-official`。前一批实现因此走了直连。用户指定套餐后，当前项目的任务通过 `--patch` 使用独立覆盖配置，选定 `opendesign-go / deepseek-v4.1-flash`，端点为 `amr-link.open-design.ai`。覆盖配置引用本机保存的 `OPENDESIGN_GO_API_KEY`，任务禁用 DeepSeek 直连与账号插件。启动前检查实际合并后的 provider、模型和禁用状态。全局 DSH 设置与其他会话留在原位。套餐入口见 [OpenDesign Go](https://go.open-design.ai/)。

| 后续审查 | 结果与证据 |
| --- | --- |
| Dock 无障碍、运动动画源码审查 | 两项独立请求都开始了模型推理和源码读取，200 秒限时内未返回终稿。原始事件保留在 `.expo-export-check/glass-dsh/dock-accessibility.ndjson` 与 `workout-motion.ndjson`。 |
| 收敛验收审查 | Go 返回 `GO_RECEIPT`，进程退出 0。[路由回执](evidence/opendesign-go-routing.json) 可核对。原始 `go-review-receipt.ndjson` SHA-256 为 `2dddf393d2494b21fc5bc302a45edecb9a383a7c08f277f877867496d4ed4229`。 |

收敛审查提出运行期验证四枚标签切换时的高亮与选中语义，注入单次可信楼层增长检查轨道反馈，并单列真机及传感器边界。Codex 按原生证据验收。以后本项目的 DSH 批任务通过本工作树 `.expo-export-check/glass-dsh/run-opendesign-go.py` 的任务覆盖方式调用，避免裸用旧 `headless` 默认路由。
