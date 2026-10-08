# 循阶品牌图标

2026-10-04：用户选择“人物向上爬楼”方案，替换旧荧光绿人物图标和 App 内作为品牌标识使用的普通楼梯符号。

- `master.png`：内置 Image Gen 根据用户批准方案生成的黑色透明母版。
- `mark.png`：母版裁除外部透明留白后，按同一 alpha 包装为白色；App 使用 tintColor 适配浅色/深色。
- 主色 `#3560E4`；深色背景 `#101522`；深色界面标记 `#A9BDFF`。
- 人物姿势、台阶和间隙均来自同一母版，不在不同端重新绘制。

资源打包：`node scripts/package-brand-assets.cjs`。生成桌面图标、Android 自适应/单色图标、启动图、favicon 和五档通知图标。原生资源与 Expo 配置所指向的资产同时更新。

最终生成提示要点（内置 image_gen，不使用 CLI）：faithfully preserve the approved side-view person actively climbing three steps; separate circular head, forward-leaning body, bent arms and raised knee; one solid black silhouette on genuinely transparent background; clean edges, no texture, no shadows, no words, no blue tile, no duplicates. 1024 square requested; generated source is 1254 square, platform exports use explicit sizes.

Android foreground/monochrome 图形占画布最长边 52%，留出系统遮罩安全区；普通图标占 72%。通知资源使用白色 alpha，禁止使用整块启动器图标作为 smallIcon。内容中的楼梯插画、楼层图和功能性图示不属于品牌替换范围。
