# 循阶 1.1.2 完整界面审计与复审

复审时间：2026-10-10T02:40:50.452438+00:00。审计对象：<workspace>。Android 1.1.2 / 11。

共发现并实施 16 项问题；本轮范围内复审 0 项未关闭。10 个注册页面、23 个批准画面，以及字体、主题、滚动、键盘和边界状态纳入验收。

[打开三栏对照图册](index.html) · [问题与方案](findings.json) · [截图清单](manifest.json) · [最后操作结果](verification.json)

## 逐页范围与健康状态

| 页面 | 本轮检查 | 状态 |
|---|---|---|
| 1. 首页 | 开始、起始楼层、楼栋管理、重命名键盘、无楼栋状态 | 通过 |
| 2. 记录 | 筛选、趋势、更多菜单、详情修改、分享入口 | 通过 |
| 3. 设置 | 播报与体重持久化、后台提示、备份下载、CSV、取消导入 | 通过 |
| 4. 训练 | 五阶段、返回保护、短按与取消长按、保存失败恢复、独立包实际保存与放弃 | 通过 |
| 5. 结算 / 详情 | 单位与图表、层数修改重算和持久化、150 层边界、模板清空与保存 | 通过 |
| 6. 分享 | 四模板、文案和尺寸编辑、三比例 PNG、系统分享取消、复制脱敏数据 | 通过 |
| 7. 新手引导 | 全部三步、125% 与 130% 字体、完整说明滚动和完成 | 通过 |
| 8. 隐私协议 | 七项完整正文、首次拒绝实际退出、同意记录和首次引导、从设置返回 | 通过 |
| 9. 旧版单轮成绩 | 修正入口、单层用时、完整信息展开 | 通过 |
| 10. 传感器诊断 | 配置、原生采样、标记、无效样本脱敏导出 | 通过 |

## 问题与实施

### A01 / P2 / 已关闭

桌面图标、启动资源仍为旧蓝色，品牌与黑橙页面不统一

生成新爬楼人物 Logo，统一 App、海报、桌面、自适应、单色、启动与通知资产；重建原生安装包

[证据 1](release/actual/release-launcher.png) · [证据 2](release/launch-frames/cold-start-1.png) · [证据 3](logo-preview.png)

### A02 / P2 / 已关闭

首页、记录和模板页的楼栋图标变成窗格楼房，缺少批准稿的屋顶与三层横线

从批准稿生成统一透明楼栋资产，所有相关页面使用同一 BuildingThumb

[证据 1](after/actual/home.png) · [证据 2](after/actual/history.png) · [证据 3](after/actual/template.png)

### A03 / P2 / 已关闭

记录卡片缺少视觉稿的更多操作入口

补齐 48dp 更多按钮和原生菜单，连接已有详情修改与分享流程，长名称可换行

[证据 1](after/actual/history.png) · [证据 2](after/actual/history-more.png) · [证据 3](after/actual/history-more-detail.png) · [证据 4](after/actual/history-more-share.png)

### A04 / P3 / 已关闭

训练刻度过窄、统计分隔线缺失，下行箭头形态偏离批准稿

统一刻度宽度、增加指标分隔线、采用三角下行图标；保留用户要求的常驻保存与放弃按钮

[证据 1](after/actual/climbing.png) · [证据 2](after/actual/descending.png)

### A05 / P2 / 已关闭

普通结算缺少层/轮单位、指标分隔线和修改提示图标，图表圆角过大

恢复单位、分隔线、信息图标及柱形比例；普通主按钮采用批准稿的文字样式

[证据 1](after/actual/summary.png) · [证据 2](after/actual/round-corrected.png)

### A06 / P2 / 已关闭

保存模板的楼栋名称输入框缺少清空按钮

增加有标签的 48dp 清空按钮，保持校验、长度限制与保存逻辑

[证据 1](after/actual/template.png) · [证据 2](after/actual/template-cleared.png) · [证据 3](after/actual/template-saved-home.png)

### A07 / P3 / 已关闭

引导手机、盾牌、失败提示与趋势图标存在形态差异，结束文案落后于当前按钮

使用最接近批准稿的现有图标库字形，统一结束并保存的引导文案

[证据 1](after/actual/onboarding-1.png) · [证据 2](after/actual/onboarding-3.png) · [证据 3](after/actual/save-failed.png)

### A08 / P2 / 已关闭

设置单选、体重与数据操作、首页更多、记录筛选、海报编辑标签、协议底部及训练次级操作部分触控尺寸低于 48dp

扩大实际点击区域，长楼栋名称允许两行；复查小屏和大字体滚动及底部操作

[证据 1](after/actual/settings.png) · [证据 2](after/actual/settings-help-end.png) · [证据 3](after/actual/font125-settings.png) · [证据 4](after/actual/small130-settings.png)

### A09 / P1 / 已关闭

首次拒绝协议后点击退出应用却进入首页，动作与文案不一致

统一原生确认层；首次 Android 拒绝后退出 Activity，不写入同意记录；从设置查看则明确返回上一页

[证据 1](after/actual/privacy-reject.png) · [证据 2](after/actual/privacy-exited.png)

### A10 / P2 / 已关闭

手机 125% 字体时训练数字被提前缩小，中间留白过大

增加高屏紧凑布局分支，按可用高度恢复主要数字与刻度；小屏保持可滚动操作

[证据 1](after/actual/font125-climbing.png) · [证据 2](after/actual/font125-calibrating.png)

### A11 / P3 / 已关闭

后台电池图标缺少闪电，Excel 导出使用四宫格图标，数据库、帮助及分享锁图标的填充不一致

改用内嵌闪电电池、表格、实心数据库/帮助/锁图标，保持原有导出和权限操作

[证据 1](after/actual/settings-lower.png) · [证据 2](after/actual/share.png)

### A12 / P2 / 已关闭

复审发现准备阶段刻度显示 2F 而主数字为 1 楼；读屏的已完成层数遗漏当前层，超过模板高度时刻度范围不足

零完成层数显示真实起始楼层、已完成含当前刻度、范围包含所有实际已完成层数；复查五阶段与三位数楼层

[证据 1](after/actual/waiting.png) · [证据 2](after/actual/normal-climbing-101.png) · [证据 3](after/actual/small130-climbing-101.png)

### A13 / P2 / 已关闭

复审发现小屏引导的装饰尺寸和留白过大，主要说明被推到首屏下方；设置在 130% 字体时因浮点阈值未切换到预期分行布局

小屏和大字体引导缩减装饰、间距及底部留白；设置按字体与宽度分行，仍可滚动读取完整内容

[证据 1](after/actual/small130-onboarding.png) · [证据 2](after/actual/small130-onboarding-3.png) · [证据 3](after/actual/small130-settings.png)

### A14 / P2 / 已关闭

复审的三位数边界测试发现小屏修改 150 层时，加减按钮被数字挤出屏幕

计数输入保留完整数字语义，允许按可用宽度缩放；减小横向间距，保持加减按钮 72dp 与保存/取消完整可见

[证据 1](review/actual/small130-edit-150-before.png) · [证据 2](after/actual/small130-edit-150.png)

### A15 / P3 / 已关闭

浅色复审发现结算页透明指标区继承了卡片阴影，出现额外矩形框

移除指标区阴影，只保留上方和各项之间的分隔线；重新核验浅色、深色和两档大字体

[证据 1](review/actual/light-summary-before.png) · [证据 2](after/actual/light-summary.png)

### A16 / P3 / 已关闭

旧版记录缺少单层明细时，展开单层用时只显示空卡片，无法区分无数据和未响应

补充没有单层用时明细的空状态说明，不补造旧记录的采样或用时数据；重新核验兼容页与展开状态

[证据 1](review/actual/legacy-splits-before.png) · [证据 2](after/actual/legacy-splits.png)

## 复审证据

- 24 项操作用例最后结果全部通过；原始记录保留 5 次早期失败。真实 UI 边界错误已修复，启动时机、测试常量和横向模板查找的脚本错误也已更正并复测。
- TypeScript、差异空白检查和两项隔离包测试通过。
- 81 个既有核心、服务和 hook 文件哈希与审计前相同；所有生产页面源码与实际构建目录一致。
- 独立 APK 在关闭 QA Metro 后覆盖安装、冷启动，首页/记录/设置可打开；原有存储不变，真实生产 hook 保存两层恰好一次并可重启恢复。
- 四海报模板可选择，三比例导出实际 PNG 为 1080×1350、1080×1080、1080×1440；系统分享取消未记为成功。
- Logo 检查包括小尺寸、alpha 噪声、自适应安全圆、单色资源和实际 Android 启动图。

## 安装包

[循阶 1.1.2 审计内部 APK](https://github.com/HigloDev/steploop/releases/tag/v1.1.2-preview.1)

SHA-256：`7cfe25ba4c2c4aa2baeaa460ab7b8dbfb29fbf563a4d9343469836559626b94b`。大小 75,724,634 字节，arm64-v8a / x86_64。沿用原 Android Debug 内部证书，未作为商店公开发行包。

## 本轮边界

手机当前离线，本轮未安装到物理手机。布局矩阵按手机 125% 字体补验，但模拟器不替代 OEM 真机或真实爬楼准确率验收。尚未进行 TalkBack 人工朗读或全部设备组合验证。

批准稿为生成图像，允许示例数据、生成纹理、字体细节与实际界面存在规范中明确的差异。训练页常驻保存和放弃按钮遵循用户后续明确要求。0 项未关闭只代表本轮列明范围内的发现已闭环，不是所有未来状态绝无缺陷的保证。

原有蓝色母版、审计前源码与资源、旧版密封报告和私有数据备份均保留；不清空、不卸载、不自动导入。全部公开测试记录为隔离包合成数据；诊断导出标为无效模拟器样本。
