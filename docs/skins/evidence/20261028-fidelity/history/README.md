# 整改前证据

本目录只保留少量未修饰的整改前截图，不计入当前原生验收。

`captures-before.json`记录6张360dp、100%字号的旧截图、原稿区域及当时源码指纹；对应K-On密度、皮卡丘图形衔接、山野标题与初号机首屏问题。它们来自旧`round-4`。

`eva-unit-01-large-font-before.png`来自最后一次字号阈值修复前，720×1600 / 360dpi / 320dp / Android 130%字号。对应源码指纹为`3e366b3d56bf1aaffee0b4eb58107dad24e82829a9b34f179624a5fe1a511318`。当时浮点值略小于1.3，背景插画未淡化；最终截图使用`isLargeText`的百分比舍入规则。

其余过程截图和记录已可逆移至本地被Git忽略的`output/graphics-qa/history/20261028-drafts/`。原有1.1.5配色证据`docs/skins/evidence/20261028/`保留原位。当前结果见上级的`inventory.json`及`validation-summary.json`。
