// 循阶 · 向上训练。显示层的唯一 token 来源。
// 钴蓝承担操作与进度，冷灰组织内容；深蓝训练摘要使用独立的成对文字色。

import { createContext, useContext } from 'react'
import { TextStyle, useColorScheme } from 'react-native'
import { useAppearance } from './appearance'
import { normalizeSkinId, resolveAppearanceMode, SKIN_CATALOG, SkinId, SkinPaint } from './skin-catalog'

export const AppSkinContext = createContext<SkinId | undefined>(undefined)

export interface ShadowStyle {
  shadowColor: string
  shadowOffset: { width: number; height: number }
  shadowOpacity: number
  shadowRadius: number
  elevation: number
}

/** 节奏 token：120 / 180 / 320ms，配合明确的进出场曲线与紧实弹簧。 */
export interface MotionTokens {
  fast: number
  base: number
  slow: number
  easing: {
    enter: readonly [number, number, number, number]
    exit: readonly [number, number, number, number]
    move: readonly [number, number, number, number]
  }
  spring: { dampingRatio: number; duration: number }
}

/** 玻璃材质：透明度、真实虚化强度、1px 以内描边与顶部高光。 */
export interface GlassTokens {
  /** 玻璃填充的基准不透明色；合成时按 role 透明度叠加。 */
  fill: string
  /** 普通玻璃填充透明度。 */
  cardOpacity: number
  /** 重要数据表面透明度。 */
  featureOpacity: number
  /** Dock 与浮层透明度。 */
  overlayOpacity: number
  /** expo-blur 强度（1–100）。 */
  blurIntensity: number
  /** Android 模糊强度折减系数。 */
  blurReductionFactor: number
  /** 1px 以内描边。 */
  stroke: string
  /** 顶部细高光。 */
  highlight: string
  /** 画布渐变端点：浅色冷白→冰蓝，深色海军蓝→深海军蓝（纯 #RRGGBB，不掺黑）。 */
  backdropTop: string
  backdropBottom: string
  /** 右上高光晕基准色与最大不透明度（配合 stopOpacity 使用，勿用 rgba 透明黑）。 */
  backdropBloom: string
  backdropBloomOpacity: number
}

/** Elevation 0 背景/平面文本，1 小卡，2 主要卡/主按钮，3 Dock，4 弹层。 */
export interface ElevationLevel {
  borderWidth: number
  borderColor: string
  shadow: ShadowStyle
}

export type ElevationScale = Record<'level0' | 'level1' | 'level2' | 'level3' | 'level4', ElevationLevel>

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
  // 冰川玻璃版新增语义层（所有皮肤共享同一结构，非玻璃皮肤不使用 glass）。
  space: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number; xxxl: number }
  radius: { xs: number; sm: number; md: number; lg: number; xl: number; pill: number }
  elevation: ElevationScale
  glass: GlassTokens
  motion: MotionTokens
}

const NUMERIC: TextStyle = { fontVariant: ['tabular-nums'], fontWeight: '700', letterSpacing: -1, includeFontPadding: false }

export const WORKOUT_NUMBER_FONT = 'SteploopNumbers'

/** Reading roles use the system face. Apply digits only to numeric runs, with units in the system face. */
export const typography = {
  title: { fontSize: 28, lineHeight: 37, fontWeight: '700' },
  navigation: { fontSize: 19, lineHeight: 27, fontWeight: '600' },
  section: { fontSize: 21, lineHeight: 29, fontWeight: '600' },
  cardTitle: { fontSize: 18, lineHeight: 26, fontWeight: '600' },
  control: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  label: { fontSize: 16, lineHeight: 23, fontWeight: '500' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  secondary: { fontSize: 14, lineHeight: 21, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 19, fontWeight: '400' },
  digits: { ...NUMERIC, fontFamily: WORKOUT_NUMBER_FONT, fontWeight: 'normal', letterSpacing: 0 },
} as const satisfies Record<string, TextStyle>

const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const
const radius = { xs: 6, sm: 10, md: 16, lg: 22, xl: 28, pill: 999 } as const
const motion: MotionTokens = {
  fast: 120,
  base: 180,
  slow: 320,
  easing: {
    enter: [0.23, 1, 0.32, 1],
    exit: [0.23, 1, 0.32, 1],
    move: [0.77, 0, 0.175, 1],
  },
  spring: { dampingRatio: 0.8, duration: 300 },
}

const glassLight: GlassTokens = {
  fill: '#FFFFFF',
  cardOpacity: 0.64,
  featureOpacity: 0.82,
  overlayOpacity: 0.46,
  blurIntensity: 63,
  blurReductionFactor: 4,
  stroke: 'rgba(20, 38, 63, 0.16)',
  highlight: 'rgba(255, 255, 255, 0.90)',
  backdropTop: '#EDF4FD',
  backdropBottom: '#CCDFFA',
  backdropBloom: '#8EBBFF',
  backdropBloomOpacity: 0.55,
}

const glassDark: GlassTokens = {
  fill: '#16243A',
  cardOpacity: 0.74,
  featureOpacity: 0.88,
  overlayOpacity: 0.61,
  blurIntensity: 60,
  blurReductionFactor: 4,
  stroke: 'rgba(242, 247, 255, 0.18)',
  highlight: 'rgba(255, 255, 255, 0.12)',
  backdropTop: '#101C2E',
  backdropBottom: '#142841',
  backdropBloom: '#8EBBFF',
  backdropBloomOpacity: 0.22,
}

const lightShadowSoft: ShadowStyle = {
  shadowColor: '#152239',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.04,
  shadowRadius: 7,
  elevation: 0,
}

const lightShadowCard: ShadowStyle = {
  shadowColor: '#152239',
  shadowOffset: { width: 0, height: 3 },
  shadowOpacity: 0.05,
  shadowRadius: 12,
  elevation: 0,
}

const lightShadowLifted: ShadowStyle = {
  shadowColor: '#245CD8',
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.22,
  shadowRadius: 22,
  elevation: 0,
}

const darkShadowSoft: ShadowStyle = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0,
  shadowRadius: 7,
  elevation: 0,
}

const darkShadowCard: ShadowStyle = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0,
  shadowRadius: 17,
  elevation: 0,
}

const darkShadowLifted: ShadowStyle = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 9 },
  shadowOpacity: 0,
  shadowRadius: 22,
  elevation: 0,
}

/** 边线承担 Android 的层级；iOS 另加软阴影。每个层级只声明一次“边线或阴影”。 */
function elevationScale(borderSoft: string, border: string, shadowSoft: ShadowStyle, shadowCard: ShadowStyle, shadowLifted: ShadowStyle): ElevationScale {
  const flat: ShadowStyle = { shadowColor: shadowCard.shadowColor, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, shadowRadius: 0, elevation: 0 }
  return {
    level0: { borderWidth: 0, borderColor: 'transparent', shadow: flat },
    level1: { borderWidth: 0.5, borderColor: borderSoft, shadow: shadowSoft },
    level2: { borderWidth: 1, borderColor: border, shadow: shadowCard },
    level3: { borderWidth: 1, borderColor: border, shadow: shadowCard },
    level4: { borderWidth: 1, borderColor: border, shadow: shadowLifted },
  }
}

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
  fontBase: typography.body.fontSize,
  fontEyebrow: typography.caption.fontSize,
  fontTitle: 30,
  fontSubtitle: typography.secondary.fontSize,
  fontLabel: typography.caption.fontSize,
  fontValue: 20,
  fontMetric: 30,
  fontPill: typography.caption.fontSize,
  fontSmall: typography.caption.fontSize,
  numeric: NUMERIC,
  shadowCard: lightShadowCard,
  shadowSoft: lightShadowSoft,
  shadowLifted: lightShadowLifted,
  space,
  radius,
  elevation: elevationScale('#E6ECF4', '#D5DFEC', lightShadowSoft, lightShadowCard, lightShadowLifted),
  glass: glassLight,
  motion,
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
  shadowCard: darkShadowCard,
  shadowSoft: darkShadowSoft,
  shadowLifted: darkShadowLifted,
  elevation: elevationScale('#293D58', '#384D69', darkShadowSoft, darkShadowCard, darkShadowLifted),
  glass: glassDark,
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

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function paintTheme(base: Theme, paint: SkinPaint): Theme {
  const brandSoft = mix(paint.card, paint.brand, 0.08)
  const line = mix(paint.card, paint.ink, 0.23)
  const lineSoft = mix(paint.card, paint.ink, 0.12)
  const shadowSoft = { ...base.shadowSoft, shadowColor: paint.ink }
  const shadowCard = { ...base.shadowCard, shadowColor: paint.ink }
  const shadowLifted = { ...base.shadowLifted, shadowColor: paint.brand }
  return { ...base, ...paint,
    inkSoft: mix(paint.ink, paint.paper, 0.14), mutedStrong: mix(paint.ink, paint.paper, 0.23),
    cardSoft: base.isDark ? mix(paint.card, paint.ink, 0.04) : '#F1F3F7', surfaceSoft: mix(paint.card, paint.brand, 0.085),
    line, lineSoft,
    brandInk: paint.brandText, brandBright: paint.brand, brandSoft, brandTint: mix(paint.card, paint.brand, 0.25),
    heroLine: mix(paint.heroSurface, paint.heroInk, 0.22), energy: paint.brandText,
    infoSoft: brandSoft, infoInk: paint.brandText,
    redInk: paint.dangerInk ?? base.redInk,
    shadowCard, shadowSoft, shadowLifted,
    elevation: elevationScale(lineSoft, line, shadowSoft, shadowCard, shadowLifted),
    glass: { ...base.glass, fill: paint.card, stroke: withAlpha(paint.ink, base.isDark ? 0.18 : 0.16), highlight: withAlpha('#FFFFFF', base.isDark ? 0.12 : 0.9) },
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

/** 冰川透蓝是唯一启用玻璃材质、真实虚化与浮动 Dock 的稳定外观。 */
export function isGlacier(theme: Theme): boolean {
  return getThemeSkinId(theme) === 'glacier-glass'
}

export const skinGeometry = {
  sceneWidth: 156, sceneHeight: 112, compactWidth: 112, compactHeight: 84,
  featureWidth: 300, featureHeight: 160, featureSmallHeight: 96,
  smallWidth: 80, smallHeight: 64, mark: 28, badge: 88, gap: 12,
} as const

/** Graphic skins share reading hierarchy; artwork geometry remains skin-specific. */
export const skinTypography = {
  introduction: { fontSize: 22, lineHeight: 30, fontWeight: '700' },
  section: typography.section,
  cardTitle: typography.cardTitle,
  label: typography.label,
  body: typography.body,
  secondary: typography.secondary,
} as const satisfies Record<string, TextStyle>

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
  'eva-unit-01': { home: 190, coach: 192, history: 126, settings: 160 },
  'eva-unit-02': { home: 210, coach: 238, history: 132, settings: 196 },
  pikachu: { home: 244, coach: 246, history: 160, settings: 150 },
  'k-on': { home: 290, coach: 312, history: 160, settings: 112 },
  'glacier-glass': { home: 96, coach: 72, history: 64, settings: 64 },
}
export function getSkinPageHeight(theme: Theme, page: SkinPage, width: number): number {
  return skinPageHeights[getThemeSkinId(theme)][page] * Math.min(width / 360, 1.22)
}

/** Keep upper motifs and bottom fades visible. K-On home may crop only its
 * verified empty lower 17%, bringing the organic tabletop close to the week card. */
export function getSkinHeaderLayout(theme: Theme, page: SkinPage, width: number, fontScale = 1) {
  const skin = getThemeSkinId(theme), height = getSkinPageHeight(theme, page, width)
  const overlap = skin === 'pikachu' && page === 'home' && !isLargeText(fontScale)
  // These windows exclude only the audited empty margins of sparse canvases.
  // Fitting their whole canvas would reduce the actual subject to a tiny icon.
  const window = page === 'settings'
    ? ({ 'k-on': [0.07, 0.58], 'eva-unit-01': [0.04, 0.81], 'eva-unit-02': [0, 0.82],
        pikachu: theme.isDark ? [0.04, 435 / 1024] : [0.04, 484 / 1024] } as Partial<Record<SkinId, number[]>>)[skin]
    : page === 'history' ? ({ 'k-on': [0.30, 1], pikachu: [0.46, 1] } as Partial<Record<SkinId, number[]>>)[skin] : undefined
  if (window) {
    const artHeight = height / (window[1] - window[0]), artWidth = artHeight * 1.5
    return { width: artWidth, height: artHeight, top: -artHeight * window[0], left: width - artWidth,
      overlap: false, safeBottomFraction: 0, visibleWindow: window }
  }
  // The coach copy needs its own clear area above the complete instrument set.
  const textClearance = skin === 'k-on' && page === 'coach' ? height * 0.2 : 0
  const artWidth = overlap ? Math.max(width, height * 1.5) * 1.216 : (height - textClearance) * 1.5
  const safeBottomFraction = skin === 'k-on' && page === 'home' ? 0.17 : 0
  const clearSearch = page === 'history' && (skin === 'eva-unit-01' || skin === 'eva-unit-02' && theme.isDark)
  return { width: artWidth, height: artWidth / 1.5, top: overlap ? -12 * Math.min(width / 360, 1.22) : textClearance + height * safeBottomFraction,
    left: width - artWidth - (clearSearch ? 48 * Math.min(width / 360, 1.22) : 0), overlap, safeBottomFraction, visibleWindow: undefined }
}

export function getCourseIconAccent(theme: Theme, course: 'weight' | 'beginner' | 'cardio'): string {
  return getThemeSkinId(theme) === 'eva-unit-01' && course === 'weight'
    ? (theme.isDark ? '#AEF638' : '#629323') : theme.brandText
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
  'glacier-glass': { tabs: [64, 64], compactCatalog: true, compactHistory: true, compactWeek: true, compactRecent: 'inline' },
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
  const appSkinId = useContext(AppSkinContext)
  return getTheme(appSkinId ?? selection.skinId, resolveAppearanceMode(selection.mode, scheme))
}

const workoutThemeCache = new WeakMap<Theme, WorkoutPalette>()
export function getWorkoutPalette(theme: Theme): WorkoutPalette {
  // 训练页与其余页面使用同一外观选择：浅色保持浅色，深色保持深色；跟随系统由 useTheme 解析。
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
  type: { title: typography.title.fontSize, heading: typography.cardTitle.fontSize, body: typography.body.fontSize,
    secondary: typography.secondary.fontSize, caption: typography.caption.fontSize, numericWeight: '700' as const },
  controlHeight: 52,
  // `orange` is the legacy export key used by existing poster templates.
  poster: { background: '#F2F6FC', ink: '#152239', muted: '#5E6B7E', orange: '#245CD8', line: '#D5DFEC', tint: '#DCE8FF' },
} as const

export const sport = {
  space: { xs: 4, sm: 8, md: 12, lg: 16, page: 20, section: 24, xl: 32, xxl: 40 },
  type: { micro: 10, caption: typography.caption.fontSize, secondary: typography.secondary.fontSize,
    body: typography.body.fontSize, label: typography.label.fontSize, heading: typography.section.fontSize,
    title: typography.title.fontSize, display: 36, number: 64, live: 112 },
  radius: { small: 8, control: 12, panel: 16, hero: 20, pill: 999 },
  control: 52,
  opacity: { pressed: 0.76, disabled: 0.42 },
} as const
