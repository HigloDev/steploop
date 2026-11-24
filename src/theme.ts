// 循阶 · 向上训练。显示层的唯一 token 来源。
// 全应用采用统一玻璃 Bento 结构，由 SKIN_CATALOG 提供 6 套浅暗成对轻量主题色（默认「疾阶运动」对齐应用 Logo）。

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
  fill: string
  cardOpacity: number
  featureOpacity: number
  overlayOpacity: number
  blurIntensity: number
  blurReductionFactor: number
  stroke: string
  highlight: string
  backdropTop: string
  backdropBottom: string
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

export interface BrandVisualTokens {
  /** 品牌画风：motion-ring 启用对角钴蓝、开口冰青运动环与三级磨砂阶梯；glass-bento 保持原有玻璃 Bento。 */
  family: 'motion-ring' | 'glass-bento'
  /** 品牌主卡与徽章对角渐变（深海钴蓝 → 亮电蓝） */
  gradientStart: string
  gradientEnd: string
  /** 开口运动环渐变（冰白蓝 → 亮青） */
  ringStart: string
  ringEnd: string
  /** 克制光晕色（仅用于环端头与激活节点） */
  ringGlow: string
  /** 未完成运动环底轨 */
  ringTrack: string
  /** 磨砂阶梯填充与顶边高光 */
  frostFill: string
  frostStroke: string
  /** 品牌主卡上的半透明操作胶囊底色与描边 */
  heroControlFill: string
  heroControlStroke: string
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
  /** 等宽数字粗体（Barlow Semi Condensed）。 */
  numeric: TextStyle
  // 阴影
  shadowCard: ShadowStyle
  shadowSoft: ShadowStyle
  shadowLifted: ShadowStyle
  // 统一语义层
  space: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number; xxxl: number }
  radius: { xs: number; sm: number; md: number; lg: number; xl: number; pill: number }
  elevation: ElevationScale
  glass: GlassTokens
  motion: MotionTokens
  brandVisual: BrandVisualTokens
}

export const WORKOUT_NUMBER_FONT = 'SteploopNumbers'

const NUMERIC: TextStyle = {
  fontFamily: WORKOUT_NUMBER_FONT,
  fontVariant: ['tabular-nums'],
  fontWeight: 'normal',
  letterSpacing: 0,
  includeFontPadding: false,
}

/** 正文沿用系统字体，数字使用离线 Barlow Semi Condensed SemiBold 等宽数字。 */
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
  digits: NUMERIC,
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

const glassLightBase: GlassTokens = {
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

const glassDarkBase: GlassTokens = {
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
  shadowColor: '#14263F',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.04,
  shadowRadius: 7,
  elevation: 0,
}

const lightShadowCard: ShadowStyle = {
  shadowColor: '#14263F',
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

/** 边线承担 Android 的层级；iOS 另加软阴影。 */
function elevationScale(
  borderSoft: string,
  border: string,
  shadowSoft: ShadowStyle,
  shadowCard: ShadowStyle,
  shadowLifted: ShadowStyle,
): ElevationScale {
  const flat: ShadowStyle = {
    shadowColor: shadowCard.shadowColor,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  }
  return {
    level0: { borderWidth: 0, borderColor: 'transparent', shadow: flat },
    level1: { borderWidth: 0.5, borderColor: borderSoft, shadow: shadowSoft },
    level2: { borderWidth: 1, borderColor: border, shadow: shadowCard },
    level3: { borderWidth: 1, borderColor: border, shadow: shadowCard },
    level4: { borderWidth: 1, borderColor: border, shadow: shadowLifted },
  }
}

const lightBase: Theme = {
  isDark: false,
  ink: '#14263F',
  inkSoft: '#354860',
  muted: '#455D78',
  mutedStrong: '#455D78',
  paper: '#EDF4FD',
  card: '#FFFFFF',
  cardSoft: '#F0F4FA',
  surfaceSoft: '#E6EEF8',
  line: '#CFDCEB',
  lineSoft: '#E2EBF6',
  scrim: '#0B162DB3',
  heroSurface: '#16304F',
  heroInk: '#F2F7FF',
  heroMuted: '#B9CBE6',
  heroLine: '#385171',
  heroAccent: '#8EBBFF',
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
  elevation: elevationScale('#E2EBF6', '#CFDCEB', lightShadowSoft, lightShadowCard, lightShadowLifted),
  glass: glassLightBase,
  motion,
  brandVisual: {
    family: 'glass-bento',
    gradientStart: '#16304F',
    gradientEnd: '#245CD8',
    ringStart: '#B9CFFF',
    ringEnd: '#245CD8',
    ringGlow: '#8EBBFF',
    ringTrack: 'rgba(20, 38, 63, 0.14)',
    frostFill: 'rgba(255, 255, 255, 0.56)',
    frostStroke: 'rgba(255, 255, 255, 0.85)',
    heroControlFill: 'rgba(255, 255, 255, 0.16)',
    heroControlStroke: 'rgba(242, 247, 255, 0.28)',
  },
}

const darkBase: Theme = {
  ...lightBase,
  isDark: true,
  ink: '#F2F7FF',
  inkSoft: '#D0DBED',
  muted: '#BACDE6',
  mutedStrong: '#BACDE6',
  paper: '#101C2E',
  card: '#16243A',
  cardSoft: '#1C2D46',
  surfaceSoft: '#233650',
  line: '#384D69',
  lineSoft: '#293D58',
  scrim: '#000000cc',
  brand: '#8EBBFF',
  brandText: '#8EBBFF',
  brandInk: '#A3C7FF',
  brandBright: '#A7CAFF',
  brandSoft: '#1D355B',
  brandTint: '#375F98',
  onBrand: '#0F2341',
  energy: '#8EBBFF',
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
  glass: glassDarkBase,
}

/** 训练页配色：支持浅色与深色，且按钮按压/长按填充色必须与常态明显区分。 */
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

function rgbChannels(hex: string): [number, number, number] {
  const parts = hex.slice(1).match(/../g)!
  return [parseInt(parts[0], 16), parseInt(parts[1], 16), parseInt(parts[2], 16)]
}

function luminance(hex: string): number {
  const [r, g, b] = rgbChannels(hex).map(channel => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return r * 0.2126 + g * 0.7152 + b * 0.0722
}

function mix(first: string, second: string, weight: number): string {
  const a = rgbChannels(first)
  const b = rgbChannels(second)
  return '#' + a.map((value, index) => Math.round(value * (1 - weight) + b[index] * weight).toString(16).padStart(2, '0')).join('')
}

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = rgbChannels(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 长按填充色：深底白字时明显压深，亮底深字时明显提亮，保证视觉推进可见且保持高对比度。 */
function computePressedFill(fill: string, ink: string): string {
  return luminance(ink) > 0.5 ? mix(fill, '#000000', 0.28) : mix(fill, '#FFFFFF', 0.34)
}

function paintTheme(base: Theme, paint: SkinPaint, skinId: SkinId): Theme {
  const { backdrop, ...colors } = paint
  const motionRing = skinId === 'motion-ring'
  const brandSoft = mix(colors.card, colors.brand, base.isDark ? 0.14 : 0.09)
  const line = mix(colors.card, colors.ink, base.isDark && motionRing ? 0.24 : 0.22)
  const lineSoft = mix(colors.card, colors.ink, 0.12)
  const shadowSoft = { ...base.shadowSoft, shadowColor: colors.ink }
  const shadowCard = { ...base.shadowCard, shadowColor: colors.ink }
  const shadowLifted = { ...base.shadowLifted, shadowColor: colors.brand }
  const brandVisual: BrandVisualTokens = motionRing
    ? base.isDark
      ? {
          family: 'motion-ring',
          gradientStart: '#03174E',
          gradientEnd: '#0A5CE8',
          ringStart: '#BFE4FF',
          ringEnd: '#5AEBFF',
          ringGlow: '#5AEBFF',
          ringTrack: 'rgba(168, 212, 255, 0.20)',
          frostFill: 'rgba(186, 224, 255, 0.22)',
          frostStroke: 'rgba(148, 226, 255, 0.42)',
          heroControlFill: 'rgba(3, 18, 62, 0.82)',
          heroControlStroke: 'rgba(148, 226, 255, 0.46)',
        }
      : {
          family: 'motion-ring',
          gradientStart: '#041C5C',
          gradientEnd: '#0B63F0',
          ringStart: '#CBE8FF',
          ringEnd: '#5EEFFF',
          ringGlow: '#52E6FF',
          ringTrack: 'rgba(10, 92, 232, 0.15)',
          frostFill: 'rgba(214, 238, 255, 0.34)',
          frostStroke: 'rgba(255, 255, 255, 0.72)',
          heroControlFill: 'rgba(4, 22, 74, 0.78)',
          heroControlStroke: 'rgba(166, 230, 255, 0.50)',
        }
    : {
        family: 'glass-bento',
        gradientStart: colors.heroSurface,
        gradientEnd: colors.brand,
        ringStart: mix(colors.brand, '#FFFFFF', 0.35),
        ringEnd: colors.heroAccent,
        ringGlow: colors.heroAccent,
        ringTrack: withAlpha(colors.ink, base.isDark ? 0.2 : 0.14),
        frostFill: withAlpha('#FFFFFF', base.isDark ? 0.12 : 0.56),
        frostStroke: withAlpha('#FFFFFF', base.isDark ? 0.22 : 0.82),
        heroControlFill: withAlpha('#FFFFFF', 0.16),
        heroControlStroke: withAlpha(colors.heroInk, 0.28),
      }
  return {
    ...base,
    ...colors,
    inkSoft: mix(colors.ink, colors.paper, 0.14),
    mutedStrong: mix(colors.ink, colors.paper, 0.23),
    cardSoft: base.isDark ? mix(colors.card, colors.ink, 0.05) : mix(colors.card, colors.paper, 0.65),
    surfaceSoft: mix(colors.card, colors.brand, base.isDark ? 0.12 : 0.085),
    line,
    lineSoft,
    brandInk: colors.brandText,
    brandBright: colors.brand,
    brandSoft,
    brandTint: mix(colors.card, colors.brand, 0.25),
    heroLine: mix(colors.heroSurface, colors.heroInk, 0.22),
    energy: colors.brandText,
    infoSoft: brandSoft,
    infoInk: colors.brandText,
    redInk: colors.dangerInk ?? base.redInk,
    shadowCard,
    shadowSoft,
    shadowLifted,
    elevation: elevationScale(lineSoft, line, shadowSoft, shadowCard, shadowLifted),
    glass: {
      ...base.glass,
      fill: colors.card,
      cardOpacity: motionRing ? (base.isDark ? 0.78 : 0.72) : base.glass.cardOpacity,
      featureOpacity: motionRing ? (base.isDark ? 0.90 : 0.86) : base.glass.featureOpacity,
      stroke: motionRing
        ? (base.isDark ? 'rgba(116, 214, 255, 0.26)' : 'rgba(10, 82, 210, 0.16)')
        : withAlpha(colors.ink, base.isDark ? 0.18 : 0.16),
      highlight: motionRing
        ? (base.isDark ? 'rgba(156, 232, 255, 0.28)' : 'rgba(255, 255, 255, 0.95)')
        : withAlpha('#FFFFFF', base.isDark ? 0.12 : 0.9),
      backdropTop: backdrop.backdropTop,
      backdropBottom: backdrop.backdropBottom,
      backdropBloom: backdrop.backdropBloom,
      backdropBloomOpacity: backdrop.backdropBloomOpacity,
    },
    brandVisual,
  }
}

const themes = Object.fromEntries(
  SKIN_CATALOG.map(skin => [
    skin.id,
    {
      light: paintTheme(lightBase, skin.light, skin.id),
      dark: paintTheme(darkBase, skin.dark, skin.id),
    },
  ]),
) as Record<SkinId, { light: Theme; dark: Theme }>

const light: Theme = themes['motion-ring'].light
const dark: Theme = themes['motion-ring'].dark

const themeKeys = new WeakMap<Theme, string>()
for (const skin of SKIN_CATALOG) {
  for (const mode of ['light', 'dark'] as const) {
    themeKeys.set(themes[skin.id][mode], `${skin.id}/${mode}`)
  }
}

/** 按 Theme 对象弱缓存 StyleSheet，避免页面与基础组件在每次渲染重建样式表。 */
const styleCache = new WeakMap<(theme: Theme) => unknown, WeakMap<Theme, unknown>>()
export function getThemeStyles<T>(theme: Theme, factory: (theme: Theme) => T): T {
  let byTheme = styleCache.get(factory)
  if (!byTheme) {
    byTheme = new WeakMap<Theme, unknown>()
    styleCache.set(factory, byTheme)
  }
  if (byTheme.has(theme)) return byTheme.get(theme) as T
  const created = factory(theme)
  byTheme.set(theme, created)
  return created
}

export function useThemeStyles<T>(factory: (theme: Theme) => T): T {
  return getThemeStyles(useTheme(), factory)
}

export function getThemeKey(theme: Theme): string {
  return themeKeys.get(theme) ?? `motion-ring/${theme.isDark ? 'dark' : 'light'}`
}

export function getThemeSkinId(theme: Theme): SkinId {
  return normalizeSkinId(themeKeys.get(theme)?.split('/')[0])
}

/** 全部 6 套轻量配色共用同一玻璃 Bento 材质、浮动 Dock 与图标体系。 */
export function isGlacier(_theme?: Theme): boolean {
  return true
}

/** 是否为「疾阶运动」品牌默认主题（对齐应用 Logo 的对角钴蓝、开口冰青运动环与三级磨砂阶梯语言）。 */
export function isMotionRing(theme: Theme): boolean {
  return theme.brandVisual.family === 'motion-ring'
}

/** Android bridges its 32-bit font scale (e.g. 1.299999952 at 130%). */
export function isLargeText(fontScale: number): boolean {
  return Math.round(fontScale * 100) >= 130
}

export const skinTypography = {
  introduction: { fontSize: 22, lineHeight: 30, fontWeight: '700' },
  section: typography.section,
  cardTitle: typography.cardTitle,
  label: typography.label,
  body: typography.body,
  secondary: typography.secondary,
} as const satisfies Record<string, TextStyle>

export function getCourseIconAccent(theme: Theme, course: 'weight' | 'beginner' | 'cardio'): string {
  return getThemeSkinId(theme) === 'eva-unit-01' && course === 'weight'
    ? (theme.isDark ? '#AEF638' : '#517B1B')
    : theme.brandText
}

export function getPrimaryActionPaint(theme: Theme): { fill: string; ink: string } {
  return theme.isDark && getThemeSkinId(theme) === 'eva-unit-01'
    ? { fill: '#AEF638', ink: '#17290B' }
    : { fill: theme.brand, ink: theme.onBrand }
}

export function getWeekBarFill(theme: Theme, today: boolean): string {
  const skin = getThemeSkinId(theme)
  if (skin === 'motion-ring') return today ? theme.heroAccent : theme.brandVisual.ringStart
  if (skin === 'eva-unit-01') return today ? '#A9ED3E' : '#9959DB'
  if (skin === 'woodland' && !theme.isDark) return theme.brand
  return theme.heroAccent
}

export function getHistoryFilterPaint(theme: Theme): { fill: string; ink: string } {
  const action = getPrimaryActionPaint(theme)
  return { fill: action.fill, ink: action.ink }
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
  const cached = workoutThemeCache.get(theme)
  if (cached) return cached
  const action = getPrimaryActionPaint(theme)
  const palette: WorkoutPalette = {
    isDark: theme.isDark,
    bg: theme.paper,
    surface: theme.card,
    surfaceHigh: theme.surfaceSoft,
    failureSurface: theme.card,
    line: theme.line,
    ink: theme.ink,
    inkSoft: theme.inkSoft,
    muted: theme.mutedStrong,
    brand: action.fill,
    brandText: theme.brandText,
    brandInk: theme.brandInk,
    brandPressed: computePressedFill(action.fill, action.ink),
    brandDim: theme.brandSoft,
    onBrand: action.ink,
    good: theme.isDark ? '#3ddc84' : theme.success,
    warn: theme.isDark ? '#ffc542' : theme.amberInk,
    danger: theme.isDark ? '#ff6f6a' : theme.redInk,
    dangerFill: theme.redSoft,
    estimate: theme.isDark ? '#ffc542' : theme.amberInk,
  }
  workoutThemeCache.set(theme, palette)
  return palette
}

export const workoutPalettes = {
  light: getWorkoutPalette(light),
  dark: getWorkoutPalette(dark),
} as const

/** Resolve in render so a system theme change also updates an active workout. */
export function useWorkoutPalette(): WorkoutPalette {
  return getWorkoutPalette(useTheme())
}

export interface PosterPalette {
  background: string
  ink: string
  muted: string
  orange: string
  line: string
  tint: string
}

export function getPosterPalette(theme: Theme): PosterPalette {
  return {
    background: theme.paper,
    ink: theme.ink,
    muted: theme.mutedStrong,
    orange: theme.brandText,
    line: theme.line,
    tint: theme.brandSoft,
  }
}

export { light, dark }

/** Shared geometry, in density-independent pixels. */
export const visual = {
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, page: 20, section: 24, xl: 32 },
  radius: { control: 12, card: 16, hero: 20, sheet: 24, pill: 999 },
  type: {
    title: typography.title.fontSize,
    heading: typography.cardTitle.fontSize,
    body: typography.body.fontSize,
    secondary: typography.secondary.fontSize,
    caption: typography.caption.fontSize,
    numericWeight: '700' as const,
  },
  controlHeight: 52,
  poster: { background: '#EDF5FF', ink: '#071E4F', muted: '#33507C', orange: '#0750CF', line: '#C6D9F2', tint: '#DCEBFF' },
} as const

export const sport = {
  space: { xs: 4, sm: 8, md: 12, lg: 16, page: 20, section: 24, xl: 32, xxl: 40 },
  type: {
    micro: 10,
    caption: typography.caption.fontSize,
    secondary: typography.secondary.fontSize,
    body: typography.body.fontSize,
    label: typography.label.fontSize,
    heading: typography.section.fontSize,
    title: typography.title.fontSize,
    display: 36,
    number: 64,
    live: 112,
  },
  radius: { small: 8, control: 12, panel: 16, hero: 20, pill: 999 },
  control: 52,
  opacity: { pressed: 0.76, disabled: 0.42 },
} as const
