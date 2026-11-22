# 循阶品牌图标

1.1.9 界面候选使用浅冰蓝三阶带状标志。三段水平踏面、圆角转折和向下回折的蓝色内侧来自同一张 ImageGen 母版。[生成说明](../icons/SOURCES.md)

| 资源 | 使用位置 |
| --- | --- |
| `steploop/master.png` | ImageGen 透明母版 |
| `steploop/icon.png` | 标准桌面图标与 README |
| `steploop/adaptive-foreground.png`、`steploop/adaptive-monochrome.png` | Android 自适应图标和系统单色主题 |
| `steploop/splash.png` | 浅色与深色启动画面 |
| `steploop/mark.png` | 应用内、引导页和分享海报 |
| `steploop/favicon.png`、`docs/assets/site-icons/steploop.png` | Expo 网页图标与下载网站 |
| `native/android-training/res/drawable-*/ic_stat_steploop.png` | Android 通知栏五档密度 |

从仓库根目录运行 `node scripts/package-brand-assets.cjs`，再由 Expo 预构建复制 Android 资源。自适应图标前景最长边占 52% 以适配系统遮罩，普通图标占 72%。通知图标和可着色资源采用透明底单色轮廓。

## 历史黑橙方案

1.1.2 的黑橙资源见 [当时的视觉审计](AUDIT-20261010.md)。使用 `node scripts/package-brand-assets.cjs --audit` 可复现其打包流程。

## 历史蓝色方案

以下保留 2026-10-04 的母版记录。只有显式传入 `--legacy` 才会重新打包旧版蓝色资源。

2026-10-04：用户选择“人物向上爬楼”方案，替换旧荧光绿人物图标和 App 内作为品牌标识使用的普通楼梯符号。

- `master.png`：内置 Image Gen 根据用户批准方案生成的黑色透明母版。
- `mark.png`：母版裁除外部透明留白后，按同一 alpha 包装为白色；App 使用 tintColor 适配浅色/深色。
- 主色 `#3560E4`；深色背景 `#101522`；深色界面标记 `#A9BDFF`。
- 人物姿势、台阶和间隙均来自同一母版，不在不同端重新绘制。

历史资源打包使用 `node scripts/package-brand-assets.cjs --legacy`。

最终生成提示要点（内置 image_gen，不使用 CLI）：faithfully preserve the approved side-view person actively climbing three steps; separate circular head, forward-leaning body, bent arms and raised knee; one solid black silhouette on genuinely transparent background; clean edges, no texture, no shadows, no words, no blue tile, no duplicates. 1024 square requested; generated source is 1254 square, platform exports use explicit sizes.

Android foreground/monochrome 图形占画布最长边 52%，留出系统遮罩安全区；普通图标占 72%。通知资源使用白色 alpha，禁止使用整块启动器图标作为 smallIcon。内容中的楼梯插画、楼层图和功能性图示不属于品牌替换范围。
