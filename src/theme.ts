// 循阶 · 向上训练。显示层的唯一 token 来源。
// 钴蓝承担操作与进度，冷灰组织内容；深蓝训练摘要使用独立的成对文字色。

import { TextStyle, useColorScheme } from 'react-native'
import { useAppearance } from './appearance'
import { normalizeSkinId, resolveAppearanceMode, SKIN_CATALOG, SkinId, SkinPaint } from './skin-catalog'

export interface ShadowStyle {
  shadowColor: string
  shadowOffset: { width: number; height: number }
  shadowOpacity: number
  shadowRadius: number
  elevation: number
}

export interface Theme {
  isDark: boolean
  // 基础颜色
  ink: string
  inkSoft: string
  muted: string
  mutedStrong: string
  paper: string
  card: string
  cardSoft: string
  surfaceSoft: string
  line: string
  lineSoft: string
  scrim: string
  heroSurface: string
  heroInk: string
  heroMuted: string
  heroLine: string
  heroAccent: string
  // 品牌
  brand: string
  /** Accessible brand foreground; may differ from a bright button fill. */
  brandText: string
  brandInk: string
  brandBright: string
  brandSoft: string
  brandTint: string
  onBrand: string
  /** 能量色：热量、爬升等运动数据的强调色（与品牌同色系）。 */
  energy: string
  // 语义色
  success: string
  successSoft: string
  amber: string
  amberSoft: string
  amberChip: string
  amberInk: string
  orange: string
  red: string
  redSoft: string
  redChip: string
  redInk: string
  infoSoft: string
  infoInk: string
  // 尺寸
  radiusSm: number
  radiusMd: number
  radiusLg: number
  radiusXl: number
  tapMin: number
  pagePaddingH: number
  pagePaddingBottom: number
  // 字号
  fontBase: number
  fontEyebrow: number
  fontTitle: number
  fontSubtitle: number
  fontLabel: number
  fontValue: number
  fontMetric: number
  fontPill: number
  fontSmall: number
  /** 等宽数字粗体。 */
  numeric: TextStyle
  // 阴影
  shadowCard: ShadowStyle
  shadowSoft: ShadowStyle
  shadowLifted: ShadowStyle
}

const NUMERIC: TextStyle = { fontVariant: ['tabular-nums'], fontWeight: '700', letterSpacing: -1, includeFontPadding: false }

const light: Theme = {
  isDark: false,
  ink: '#152239',
  inkSoft: '#38475E',
  muted: '#5E6B7E',
  mutedStrong: '#4B5B70',
  paper: '#F7F9FC',
  card: '#ffffff',
  cardSoft: '#F0F4FA',
  surfaceSoft: '#E8EEF6',
  line: '#D5DFEC',
  lineSoft: '#E6ECF4',
  scrim: '#0B162DB3',
  heroSurface: '#13294B',
  heroInk: '#F6FAFF',
  heroMuted: '#B5C7E2',
  heroLine: '#385171',
  heroAccent: '#83BAFF',
  brand: '#245CD8',
  brandText: '#245CD8',
  brandInk: '#1E50BF',
  brandBright: '#1D4EB9',
  brandSoft: '#E9F0FF',
  brandTint: '#B9CFFF',
  onBrand: '#FFFFFF',
  energy: '#245CD8',
  success: '#1f7a55',
  successSoft: '#e4f4ec',
  amber: '#b7791f',
  amberSoft: '#fff7e6',
  amberChip: '#fff0d2',
  amberInk: '#86580d',
  orange: '#b7791f',
  red: '#c8363f',
  redSoft: '#fff0f0',
  redChip: '#fbe3e4',
  redInk: '#a3222d',
  infoSoft: '#e8f0fb',
  infoInk: '#2b5797',
  radiusSm: 8,
  radiusMd: 12,
  radiusLg: 16,
  radiusXl: 20,
  tapMin: 48,
  pagePaddingH: 20,
  pagePaddingBottom: 32,
  fontBase: 15,
  fontEyebrow: 12,
  fontTitle: 30,
  fontSubtitle: 14,
  fontLabel: 13,
  fontValue: 20,
  fontMetric: 30,
  fontPill: 12,
  fontSmall: 12,
  numeric: NUMERIC,
  shadowCard: {
    shadowColor: '#152239',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 0,
  },
  shadowSoft: {
    shadowColor: '#152239',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 7,
    elevation: 0,
  },
  shadowLifted: {
    shadowColor: '#245CD8',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
    elevation: 0,
  },
}

const dark: Theme = {
  ...light,
  isDark: true,
  ink: '#F2F6FE',
  inkSoft: '#D0DBED',
  muted: '#A5B5CE',
  mutedStrong: '#B7C6DC',
  paper: '#0E192B',
  card: '#17253B',
  cardSoft: '#1C2D46',
  surfaceSoft: '#233650',
  line: '#384D69',
  lineSoft: '#293D58',
  scrim: '#000000cc',
  brand: '#8AB7FF',
  brandText: '#8AB7FF',
  brandInk: '#A3C7FF',
  brandBright: '#A7CAFF',
  brandSoft: '#1D355B',
  brandTint: '#375F98',
  onBrand: '#102440',
  energy: '#8AB7FF',
  success: '#6fd6a5',
  successSoft: '#163428',
  amber: '#e8b86a',
  amberSoft: '#372a17',
  amberChip: '#44341a',
  amberInk: '#ecc583',
  orange: '#ff8a45',
  red: '#ff8a8f',
  redSoft: '#3a1f22',
  redChip: '#4a272b',
  redInk: '#ffa3a8',
  infoSoft: '#1d2a3d',
  infoInk: '#9fc0f0',
  shadowCard: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0,
    shadowRadius: 17,
    elevation: 0,
  },
  shadowSoft: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0,
    shadowRadius: 7,
    elevation: 0,
  },
  shadowLifted: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0,
    shadowRadius: 22,
    elevation: 0,
  },
}

/** Both training themes use explicit string colors, including animated controls. */
export interface WorkoutPalette {
  isDark: boolean
  bg: string
  surface: string
  surfaceHigh: string
  failureSurface: string
  line: string
  ink: string
  inkSoft: string
  muted: string
  brand: string
  brandText: string
  brandInk: string
  brandPressed: string
  brandDim: string
  onBrand: string
  good: string
  warn: string
  danger: string
  dangerFill: string
  estimate: string
}

const workoutLight: WorkoutPalette = {
  isDark: false,
  bg: light.paper,
  surface: light.card,
  surfaceHigh: light.surfaceSoft,
  failureSurface: light.card,
  line: light.line,
  ink: light.ink,
  inkSoft: light.inkSoft,
  muted: light.mutedStrong,
  brand: light.brand,
  brandText: light.brand,
  brandInk: light.brandInk,
  brandPressed: light.brandBright,
  brandDim: light.brandSoft,
  onBrand: light.onBrand,
  good: light.success,
  warn: light.amberInk,
  danger: light.redInk,
  dangerFill: light.redSoft,
  estimate: light.amberInk,
}

const workoutDark: WorkoutPalette = {
  isDark: true,
  bg: dark.paper,
  surface: dark.card,
  surfaceHigh: dark.surfaceSoft,
  failureSurface: dark.card,
  line: dark.line,
  ink: dark.ink,
  inkSoft: dark.inkSoft,
  muted: dark.muted,
  brand: dark.brand,
  brandText: dark.brand,
  brandInk: dark.brandInk,
  brandPressed: dark.brandBright,
  brandDim: dark.brandSoft,
  onBrand: dark.onBrand,
  good: '#3ddc84',
  warn: '#ffc542',
  danger: '#ff5a52',
  dangerFill: dark.redSoft,
  estimate: '#ffc542',
}

export const workoutPalettes = { light: workoutLight, dark: workoutDark } as const

function mix(first: string, second: string, weight: number): string {
  const a = first.slice(1).match(/../g)!.map(channel => parseInt(channel, 16))
  const b = second.slice(1).match(/../g)!.map(channel => parseInt(channel, 16))
  return '#' + a.map((value, index) => Math.round(value * (1 - weight) + b[index] * weight).toString(16).padStart(2, '0')).join('')
}

function paintTheme(base: Theme, paint: SkinPaint): Theme {
  const brandSoft = mix(paint.card, paint.brand, 0.08)
  return { ...base, ...paint,
    inkSoft: mix(paint.ink, paint.paper, 0.14), mutedStrong: mix(paint.ink, paint.paper, 0.23),
    cardSoft: base.isDark ? mix(paint.card, paint.ink, 0.04) : '#F1F3F7', surfaceSoft: mix(paint.card, paint.brand, 0.085),
    line: mix(paint.card, paint.ink, 0.23), lineSoft: mix(paint.card, paint.ink, 0.12),
    brandInk: paint.brandText, brandBright: paint.brand, brandSoft, brandTint: mix(paint.card, paint.brand, 0.25),
    heroLine: mix(paint.heroSurface, paint.heroInk, 0.22), energy: paint.brandText,
    infoSoft: brandSoft, infoInk: paint.brandText,
    redInk: paint.dangerInk ?? base.redInk,
    shadowCard: { ...base.shadowCard, shadowColor: paint.ink }, shadowSoft: { ...base.shadowSoft, shadowColor: paint.ink },
    shadowLifted: { ...base.shadowLifted, shadowColor: paint.brand },
  }
}

const themes = Object.fromEntries(SKIN_CATALOG.map(skin => [skin.id, {
  light: skin.light ? paintTheme(light, skin.light) : light,
  dark: skin.dark ? paintTheme(dark, skin.dark) : dark,
}])) as Record<SkinId, { light: Theme; dark: Theme }>
const themeKeys = new WeakMap<Theme, string>()
for (const skin of SKIN_CATALOG) for (const mode of ['light', 'dark'] as const) themeKeys.set(themes[skin.id][mode], `${skin.id}/${mode}`)

/** Stable skin identity also distinguishes future skins that share a few colors. */
export function getThemeKey(theme: Theme): string { return themeKeys.get(theme)! }

/** Artwork uses the same resolved selection as colors, including preview themes. */
export function getThemeSkinId(theme: Theme): SkinId {
  return normalizeSkinId(themeKeys.get(theme)?.split('/')[0])
}

export const skinGeometry = {
  sceneWidth: 156, sceneHeight: 112, compactWidth: 112, compactHeight: 84,
  featureWidth: 300, featureHeight: 160, featureSmallHeight: 96,
  smallWidth: 80, smallHeight: 64, mark: 28, badge: 88, gap: 12,
} as const

export type SkinPage = 'home' | 'coach' | 'history' | 'settings'
/** Android bridges its 32-bit font scale (e.g. 1.299999952 at 130%). */
export function isLargeText(fontScale: number): boolean {
  return Math.round(fontScale * 100) >= 130
}
/** Measurements from the approved four-tab boards, expressed at 360dp content width. */
const skinPageHeights: Record<SkinId, Record<SkinPage, number>> = {
  classic: { home: 0, coach: 0, history: 0, settings: 0 },
  'night-run': { home: 198, coach: 176, history: 198, settings: 160 },
  woodland: { home: 220, coach: 162, history: 226, settings: 170 },
  'eva-unit-01': { home: 190, coach: 192, history: 126, settings: 132 },
  'eva-unit-02': { home: 210, coach: 238, history: 132, settings: 156 },
  pikachu: { home: 244, coach: 246, history: 160, settings: 150 },
  'k-on': { home: 290, coach: 312, history: 160, settings: 112 },
}
export function getSkinPageHeight(theme: Theme, page: SkinPage, width: number): number {
  return skinPageHeights[getThemeSkinId(theme)][page] * Math.min(width / 360, 1.22)
}

export function getPrimaryActionPaint(theme: Theme): { fill: string; ink: string } {
  return theme.isDark && getThemeSkinId(theme) === 'eva-unit-01'
    ? { fill: '#AEF638', ink: '#17290B' } : { fill: theme.brand, ink: theme.onBrand }
}

export function getWeekBarFill(theme: Theme, today: boolean): string {
  const skin = getThemeSkinId(theme)
  if (skin === 'eva-unit-01') return today ? '#A9ED3E' : '#9959DB'
  if (skin === 'pikachu') return theme.brand
  if (skin === 'woodland' && !theme.isDark) return theme.brand
  return theme.heroAccent
}

export function getHistoryFilterPaint(theme: Theme): { fill: string; ink: string } {
  const skin = getThemeSkinId(theme)
  const solid = skin !== 'classic' && (theme.isDark || ['eva-unit-02', 'pikachu', 'k-on'].includes(skin))
  return solid ? { fill: theme.brand, ink: theme.onBrand } : { fill: theme.card, ink: theme.brandInk }
}

const skinLayouts: Record<SkinId, { tabs: readonly [number, number]; compactCatalog: boolean; compactHistory: boolean; compactWeek: boolean; compactRecent?: 'inline' | 'stacked'; homeOverlap?: readonly [number, number] }> = {
  classic: { tabs: [64, 64], compactCatalog: false, compactHistory: false, compactWeek: false },
  'night-run': { tabs: [84, 84], compactCatalog: false, compactHistory: false, compactWeek: false },
  woodland: { tabs: [82, 82], compactCatalog: false, compactHistory: false, compactWeek: false },
  'eva-unit-01': { tabs: [72, 74], compactCatalog: false, compactHistory: true, compactWeek: true, compactRecent: 'stacked' },
  'eva-unit-02': { tabs: [80, 80], compactCatalog: false, compactHistory: false, compactWeek: false },
  pikachu: { tabs: [78, 74], compactCatalog: true, compactHistory: true, compactWeek: true, compactRecent: 'inline', homeOverlap: [12, 22] },
  'k-on': { tabs: [64, 74], compactCatalog: true, compactHistory: true, compactWeek: true },
}
export function getSkinLayout(theme: Theme) {
  const layout = skinLayouts[getThemeSkinId(theme)]
  return { ...layout, tabHeight: layout.tabs[theme.isDark ? 1 : 0], homeOverlap: (layout.homeOverlap ?? [0, 0])[theme.isDark ? 1 : 0] }
}

export function getTheme(skinId: unknown, mode: 'light' | 'dark'): Theme {
  return themes[normalizeSkinId(skinId)][mode]
}

export function useTheme(): Theme {
  const scheme = useColorScheme()
  const selection = useAppearance()
  return getTheme(selection.skinId, resolveAppearanceMode(selection.mode, scheme))
}

const workoutThemeCache = new WeakMap<Theme, WorkoutPalette>()
export function getWorkoutPalette(theme: Theme): WorkoutPalette {
  if (theme === light) return workoutLight
  if (theme === dark) return workoutDark
  const cached = workoutThemeCache.get(theme)
  if (cached) return cached
  const action = getPrimaryActionPaint(theme)
  const palette: WorkoutPalette = { isDark: theme.isDark, bg: theme.paper, surface: theme.card, surfaceHigh: theme.surfaceSoft, failureSurface: theme.card,
    line: theme.line, ink: theme.ink, inkSoft: theme.inkSoft, muted: theme.mutedStrong,
    brand: action.fill, brandText: theme.brandText, brandInk: theme.brandInk, brandPressed: action.fill,
    brandDim: theme.brandSoft, onBrand: action.ink, good: theme.success, warn: theme.amberInk,
    danger: theme.redInk, dangerFill: theme.redSoft, estimate: theme.amberInk }
  workoutThemeCache.set(theme, palette)
  return palette
}

/** Resolve in render so a system theme change also updates an active workout. */
export function useWorkoutPalette(): WorkoutPalette {
  return getWorkoutPalette(useTheme())
}

export interface PosterPalette { background: string; ink: string; muted: string; orange: string; line: string; tint: string }
export function getPosterPalette(theme: Theme): PosterPalette {
  return theme === light ? visual.poster : { background: theme.paper, ink: theme.ink, muted: theme.mutedStrong,
    orange: theme.brandText, line: theme.line, tint: theme.brandSoft }
}

export { light, dark }

/** Shared geometry, in density-independent pixels. */
export const visual = {
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, page: 20, section: 24, xl: 32 },
  radius: { control: 12, card: 16, hero: 20, sheet: 24, pill: 999 },
  type: { title: 28, heading: 18, body: 16, secondary: 14, caption: 12, numericWeight: '700' as const },
  controlHeight: 52,
  // `orange` is the legacy export key used by existing poster templates.
  poster: { background: '#F2F6FC', ink: '#152239', muted: '#5E6B7E', orange: '#245CD8', line: '#D5DFEC', tint: '#DCE8FF' },
} as const

export const sport = {
  space: { xs: 4, sm: 8, md: 12, lg: 16, page: 20, section: 24, xl: 32, xxl: 40 },
  type: { micro: 10, caption: 12, secondary: 13, body: 15, label: 16, heading: 20, title: 28, display: 36, number: 64, live: 112 },
  radius: { small: 8, control: 12, panel: 16, hero: 20, pill: 999 },
  control: 52,
  opacity: { pressed: 0.76, disabled: 0.42 },
} as const
