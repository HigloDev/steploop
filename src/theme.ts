// 循阶设计 token（fusion-v1 改版）。
// - 品牌色：能量橙（brand*）。旧 token 里的 green* 实际是蓝色，已全部更名：
//   green→brand、greenInk→brandInk、greenSoft→brandSoft、greenBright→brandBright、mint→brandTint、
//   onPrimary→onBrand、blueSoft/blueInk→infoSoft/infoInk。
// - 所有页面和训练状态跟随系统主题；训练页保留独立的高对比配色。
// - 数字统一用等宽数字粗体（numeric），爬楼时一眼读清、跳动不抖。

import { TextStyle, useColorScheme } from 'react-native'

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
  // 品牌（能量橙）
  brand: string
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

const NUMERIC: TextStyle = { fontVariant: ['tabular-nums'], fontWeight: '900', letterSpacing: -0.5, includeFontPadding: false }

const light: Theme = {
  isDark: false,
  ink: '#1c1917',
  inkSoft: '#44403c',
  muted: '#6b635c',
  mutedStrong: '#57534e',
  paper: '#f7f5f2',
  card: '#ffffff',
  cardSoft: '#f4f1ed',
  surfaceSoft: '#ece7e1',
  line: '#e2dcd5',
  lineSoft: '#ece7e1',
  scrim: '#1c1917b3',
  brand: '#f05a0a',
  brandInk: '#b8420a',
  brandBright: '#ff7a2e',
  brandSoft: '#fff0e6',
  brandTint: '#ffc9a6',
  onBrand: '#1a0d05',
  energy: '#f05a0a',
  success: '#1f7a55',
  successSoft: '#e4f4ec',
  amber: '#b7791f',
  amberSoft: '#fff7e6',
  amberChip: '#fff0d2',
  amberInk: '#86580d',
  orange: '#f05a0a',
  red: '#c8363f',
  redSoft: '#fff0f0',
  redChip: '#fbe3e4',
  redInk: '#a3222d',
  infoSoft: '#e8f0fb',
  infoInk: '#2b5797',
  radiusSm: 10,
  radiusMd: 16,
  radiusLg: 20,
  radiusXl: 28,
  tapMin: 48,
  pagePaddingH: 16,
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
    shadowColor: '#1c1917',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 1,
  },
  shadowSoft: {
    shadowColor: '#1c1917',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 7,
    elevation: 0,
  },
  shadowLifted: {
    shadowColor: '#c2410c',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
    elevation: 0,
  },
}

const dark: Theme = {
  ...light,
  isDark: true,
  ink: '#f5f0ea',
  inkSoft: '#d6cfc7',
  muted: '#a29a91',
  mutedStrong: '#bdb5ac',
  paper: '#121110',
  card: '#1c1a18',
  cardSoft: '#24211e',
  surfaceSoft: '#2c2824',
  line: '#3a3530',
  lineSoft: '#2e2a26',
  scrim: '#000000cc',
  brand: '#ff7a2e',
  brandInk: '#ffa46b',
  brandBright: '#ff9450',
  brandSoft: '#3a2214',
  brandTint: '#7a3a14',
  onBrand: '#1a0d05',
  energy: '#ff8a45',
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

// Keep the approved dark training appearance; pressed fills remain legible.
const workoutDark: WorkoutPalette = {
  isDark: true,
  bg: '#0b0b0c',
  surface: '#17171a',
  surfaceHigh: '#222226',
  failureSurface: dark.card,
  line: '#2e2e33',
  ink: '#ffffff',
  inkSoft: '#d9d6d2',
  muted: '#9b968f',
  brand: '#ff6b1a',
  brandInk: '#ff6b1a',
  brandPressed: '#ee641a',
  brandDim: '#4a230c',
  onBrand: '#140800',
  good: '#3ddc84',
  warn: '#ffc542',
  danger: '#ff5a52',
  dangerFill: dark.redSoft,
  estimate: '#ffc542',
}

export const workoutPalettes = { light: workoutLight, dark: workoutDark } as const

export function useTheme(): Theme {
  const scheme = useColorScheme()
  return scheme === 'dark' ? dark : light
}

/** Resolve in render so a system theme change also updates an active workout. */
export function useWorkoutPalette(): WorkoutPalette {
  return useTheme().isDark ? workoutPalettes.dark : workoutPalettes.light
}

export { light, dark }

/** Approved 1.1.2 redraw geometry, in density-independent pixels. */
export const visual = {
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, page: 20, section: 24, xl: 32 },
  radius: { control: 14, card: 20, hero: 28, sheet: 28, pill: 999 },
  type: { title: 30, heading: 19, body: 16, secondary: 14, caption: 12, numericWeight: '900' as const },
  controlHeight: 52,
  poster: { background: '#f7f2e9', ink: '#171411', muted: '#817a72', orange: '#f56616', line: '#d8d0c5' },
} as const
