# 皮肤与主题架构索引

本文件是循阶所有主题与外观工作的统一入口。机器索引见 [registry.json](registry.json)，建设规范见 [CONSTRUCTION.md](CONSTRUCTION.md)，整体视觉与交互规范见根目录 [DESIGN.md](../../DESIGN.md)。

## 当前架构（1.1.9 统一玻璃 Bento + 品牌运动环画风）

- 应用采用统一 **玻璃 Bento** 视觉框架，并在默认主题 **疾阶运动（`motion-ring`）** 中全站对齐应用 Logo（对角深钴蓝底、冰蓝→亮青开口圆头运动环、半透明三级圆角磨砂阶梯与克制端头光晕）。
- 用户在「设置 → 外观」分别选择 **明暗模式（跟随系统 / 浅色 / 深色）** 与 **6 套主题配色**；切换配色不重置明暗选择，即时生效并独立持久化至 `steploop.appearance.v1`。
- 默认外观为 **疾阶运动（`motion-ring`）＋跟随系统**。已有明确选过的有效主题（包括 `glacier-glass` 等 5 套配色）保持生效；旧版已退役的皮肤 ID（`classic`、`eva-unit-02`、`pikachu`）在读取本地旧偏好时自动平滑回退到 `motion-ring`。
- 主题只改变显示层，不改变训练算法、成绩、楼栋、备份、手势语义或训练状态。

## 当前 6 套轻量主题目录

| 稳定 ID | 显示名称 | 浅色方向 | 深色方向 |
| --- | --- | --- | --- |
| `motion-ring`（默认） | 疾阶运动 | 冰白画布、深海蓝文字与钴蓝操作，品牌主卡保留对角钴蓝、冰青开口运动环与三级磨砂阶梯 | 深海钴蓝画布与磨砂卡片，亮青圆头轨道与冰白核心数据 |
| `glacier-glass` | 冰川透蓝 | 冷白到冰蓝、钴蓝强调 | 深海军蓝、冰蓝强调 |
| `night-run` | 荧光夜行 | 冷雾白、深炭卡、荧光黄绿 | 深炭青黑、荧光黄绿强调 |
| `woodland` | 松风山岚 | 暖米白、松绿与鼠尾草 | 深森林绿、浅鼠尾草强调 |
| `eva-unit-01` | 紫电幽光 | 淡雾紫、机体紫与荧光绿 | 深紫黑、亮紫与荧光绿 |
| `k-on` | 樱粉和弦 | 暖奶油、莓粉与茶褐 | 可可棕紫、柔粉与奶油白 |

## 单一来源

- `docs/skins/registry.json`：机器索引、稳定 ID 与验证状态。
- `src/skin-catalog.ts`：运行时 6 套配色与背景光晕定义；设置页色卡由此自动生成。
- `src/skin-assets.ts`：每套主题的轻量 WebP 背景（`backdrop-{light,dark}.webp`）与明暗配对阶梯/运动环图（`stairwell-{light,dark}.webp`），由 `scripts/render-glacier-backdrops.py` 一键生成。
- `src/components/motion-ring-graphics.tsx`：`motion-ring` 专属 SVG 几何与磨砂光效语言组件（Logo 色卡徽章、对角钴蓝主卡底纹、真实数据开口进度环、结算光环与分享海报背景）。
- `src/theme.ts`：唯一显示层 Token 入口，提供 `useTheme()`、`useThemeStyles()`（WeakMap 样式缓存）、`brandVisual`、`isMotionRing()`、训练配色（含 `brandPressed` 高对比长按反馈）与海报配色。
- `src/services/appearance.ts` / `src/appearance.ts`：外观偏好存储与 React 订阅入口。

## 历史证据边界

- `docs/skins/GRAPHICS_REAUDIT.md`、`GRAPHICS_VALIDATION.md`、`VALIDATION.md` 及 `evidence/` 下的截图保留为 1.1.5 / 1.1.7 阶段的历史证据，不代表当前 1.1.9 的原生视觉验收已完成。
- 当前 6 套主题在源码与自动单测层已通过完整 Token、对比度、资源体积与回退校验；真机/模拟器原生多分辨率截屏验收单独跟踪。
