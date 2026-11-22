# 02 · 统一矢量图标系统（第一批）

本批只新增两个文件，不改任何业务、状态机、数据口径或调用方：

- `src/components/ui-icon.tsx` — `UIIconName`、`UIIcon`、`UI_ICON_ALIASES`。
- 本文档 — 语义清单、别名合并与第二批迁移方式。

旧底栏与深页混用 Feather、MaterialCommunityIcons、MaterialIcons、Ionicons（见 `00-audit.md`）。本系统全部改用 `react-native-svg`，同一 28×28 画布、描边 1.75、圆端圆角，与四个原创标签共享“折阶”视觉。不用 Emoji、不用 icon-font 回退、不加载任何网络资源；复杂品牌图稿（`SkinArt`、`BrandMark`、楼栋缩略图）仍独立处理，不进入 `UIIcon`。

## 契约

```tsx
import { UIIcon, UIIconName } from '../components/ui-icon'

export type UIIconName = /* 70 个语义名，见下方清单 */

export function UIIcon({
  name,        // UIIconName
  size = 24,   // 渲染边长 dp；画布恒为 28×28，可任意缩放
  color,       // 描边色，调用方应传语义 token（theme.ink / theme.brandText / theme.muted …）
  accessible = false, // 装饰性默认隐藏；为 true 时暴露中文读屏标签
}: { name: UIIconName; size?: number; color?: string; accessible?: boolean })
```

- `UI_ICON_CANVAS = 28`、`UI_ICON_STROKE = 1.75` 一并导出。
- `UI_ICON_ALIASES` 是旧库字形名 → 语义名的冻结映射，供第二批迁移按确定性规则合并。

## 四个原创标签（坐标来自已认可原型，逐坐标一致）

| 语义名 | 含义 | 结构 |
| --- | --- | --- |
| `climb` | 向上三阶加终点 | 主描边 `M4.3 22.7h5.4v-5.5h5.5v-5.5h5.5V6.2h3.5`，次描边 `M14 22.7h8.2v-7.8`，顶点圆点 (24.2, 6.2) |
| `coach` | 开页路线册，左纸两级小阶，右纸小线 | 开页轮廓 `M14 23c-3-2.7-6.1-3.8-10-2.8V6.6c3.9-.9 7.1.4 10 2.8 2.9-2.4 6.1-3.7 10-2.8v13.6c-3.9-1-7 .1-10 2.8Zm0-13.6V23`，左页两级小阶 + 右页两短线 |
| `records` | 左下折阶加折角的成绩页 | 页轮廓 `M5.4 4.8h12.7l4.4 4.4v12.5a1.5 1.5 0 0 1-1.5 1.5H7a1.6 1.6 0 0 1-1.6-1.6V4.8Z`，折角 `M18.1 4.8v4.4h4.4`，左下小阶 + 两行成绩线 |
| `settings` | 三行不同位置的圆角方刻度（错档调节刻度） | 三条横线 + 三枚错档实心圆角方刻度（左 / 中 / 右） |

## 语义名清单（70 个）

- 标签：`climb` `coach` `records` `settings`
- 方向：`chevron-left` `chevron-right` `chevron-down` `chevron-up` `arrow-right` `arrow-up` `arrow-down` `arrow-up-right`
- 增删与选择：`plus` `minus` `close` `close-circle` `check` `check-circle`
- 编辑与操作：`pencil` `trash` `more` `undo` `replay`
- 状态：`alert` `info` `help` `pause-circle` `play-circle`
- 楼梯与楼栋：`stairs` `building`
- 教练与课程：`target` `compass` `activity` `book-open`
- 人与设备：`user` `group` `smartphone` `walk` `run`
- 权限与反馈：`shield` `shield-check` `lock` `bell` `battery` `vibrate` `sound` `clock` `accessibility`
- 数据与图表：`search` `download` `upload` `share` `file-text` `table` `database` `chart` `speedometer` `fire` `shoe-print` `lightning`
- 参照物与旗帜：`terrain` `soccer` `basketball` `flag` `flag-checkered`
- 皮肤标识：`layers` `zap` `sun` `feather` `music`

## 别名合并（确定性）

`UI_ICON_ALIASES` 已把实际源码中出现的旧字形名合并到语义名。要点：

- 各库“向右箭头”合并：`chevron-right`（Feather/MCI）、`chevron-forward`（Ionicons）→ `chevron-right`；`arrow-right` 保留为带长柄的箭头。
- 各库“齿轮/调节”合并：`cog-outline`、`sliders`、`tune-variant` → `settings`。
- 各库“阶梯”合并：`stairs-up`、`stairs` → `stairs`；训练底部标签请显式用 `climb`（更丰富的原创三阶）。
- 语义同形合并：`alert-circle`/`alert-circle-outline` → `alert`；`check-circle`/`check-circle-outline` → `check-circle`（本系统统一描边，不再分实心/描边两版）；`info`/`information-outline` → `info`；`help-circle` → `help`；`rotate-ccw`/`undo-variant` → `undo`；`office-building`/`office-building-outline` → `building`；`shoe-print`/`shoe-sneaker` → `shoe-print`；`activity`/`heart-pulse` → `activity`；`target`/`bullseye-arrow` → `target`；`download`/`upload`/`table`/`database`/`vibrate`/`bell`/`lock`/`battery`(charging)/`clock`(outline) 等同名直映。
- 三个底部标签的旧名默认合并目标：`account-tie-outline` → `coach`、`chart-timeline-variant` → `records`、`cog-outline` → `settings`（仅在旧标签处有意义，普通图表仍用 `chart`）。

## 第二批迁移方式（本批不做）

1. 删掉各文件的 `@expo/vector-icons` 导入，改为 `import { UIIcon } from '../components/ui-icon'`（组件在 `src/components/ui-icon.tsx`）。
2. 语义替换：`<MaterialCommunityIcons name="magnify" size={25} color={theme.inkSoft} />` → `<UIIcon name="search" size={25} color={theme.inkSoft} />`；`<Feather name="chevron-right" size={20} color={theme.mutedStrong} />` → `<UIIcon name="chevron-right" size={20} color={theme.mutedStrong} />`。
3. 四个底部标签（`MainTabs.tsx`）改为原创名：Train→`climb`、Coach→`coach`、History→`records`、Profile→`settings`（`Train` 保留 `BrandMark` 分支的现有判断不变）。
4. 动态图标源改为语义名：`Workout.tsx` 指标 `icon`、`Result.tsx`/`DiagnosticCapture.tsx`/`ascent-references.tsx` 的字符串数组、`coach.ts` 课程 `icon`、`skin-catalog.ts` 皮肤 `icon`、`disclosure.tsx` 的按标题映射，均按上表替换；`keyof typeof MaterialCommunityIcons.glyphMap` / `Ionicons.glyphMap` 等类型改为 `UIIconName`。
5. 皮肤课程缩略图（`skin-detail-art.tsx`）与 `ascent-references.tsx` 的装饰参照物保留语义名（`target`/`compass`/`activity`、`terrain`/`soccer`/`basketball`），`SkinCourseThumbnail` 的 artwork 回退逻辑不变。

迁移过程中不改动 `src/core`、`src/services`、`src/hooks`、`native`、`plugins`、生产配置、签名或依赖；不改动任何运动口径或状态机。

## 规则与限制

- 描边 1.75、`strokeLinecap/strokeLinejoin="round"`；除 `settings` 的圆角方刻度与顶点/圆点外一律 `fill="none"`。
- 图标默认 `accessible={false}`（装饰性）；交互控件应由外层 `Pressable` 提供标签，或显式传 `accessible` 暴露中文语义。
- 空、错误、加载状态的可读性由页面保证，图标只作辅助，不替代文字。
- 未覆盖：品牌图稿、楼栋缩略图、皮肤 artwork、海报画布（这些是插图/品牌资产，不属于功能 glyph）。

## 验证

- `tsc --noEmit`（隔离该文件）通过；全量 typecheck 受并行编辑（基础组尚未落地的 `isGlacier`/`glass-material`）影响，属预期外的跨组中间态。
- 用脚本解析全部 path/line/circle/rect 坐标，确认落在 0–28 画布内、无 NaN/非法弧参数。
- 本批未做真机/截图渲染，视觉口径待第二批迁移后统一复查。
