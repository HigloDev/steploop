// 循阶设计 token（fusion-v1 改版）。
// - 品牌色：能量橙（brand*）。旧 token 里的 green* 实际是蓝色，已全部更名：
//   green→brand、greenInk→brandInk、greenSoft→brandSoft、greenBright→brandBright、mint→brandTint、
//   onPrimary→onBrand、blueSoft/blueInk→infoSoft/infoInk。
// - 首页、记录、设置：浅色（跟随系统深色模式）；训练页：固定深色高对比（workoutPalette）。
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

const NUMERIC: TextStyle = { fontVariant: ['tabular-nums'], fontWeight: '800', letterSpacing: -0.5 }

const light: Theme = {
  isDark: false,
  ink: '#1c1917',
  inkSoft: '#44403c',
  muted: '#78716c',
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
  onBrand: '#ffffff',
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
  radiusMd: 14,
  radiusLg: 20,
  radiusXl: 28,
  tapMin: 48,
  pagePaddingH: 20,
  pagePaddingBottom: 32,
  fontBase: 15,
  fontEyebrow: 12,
  fontTitle: 28,
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
    elevation: 6,
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
    shadowOpacity: 0.3,
    shadowRadius: 17,
    elevation: 4,
  },
  shadowSoft: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 7,
    elevation: 2,
  },
  shadowLifted: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.45,
    shadowRadius: 22,
    elevation: 6,
  },
}

/**
 * 训练页固定深色：墨黑底 + 能量橙，高对比。
 * 爬楼时手机晃动、满头大汗，也要一眼看清楼层数字。
 */
export const workoutPalette = {
  bg: '#0b0b0c',
  surface: '#17171a',
  surfaceHigh: '#222226',
  line: '#2e2e33',
  ink: '#ffffff',
  inkSoft: '#d9d6d2',
  muted: '#9b968f',
  brand: '#ff6b1a',
  brandDeep: '#c24a0a',
  brandDim: '#4a230c',
  onBrand: '#140800',
  good: '#3ddc84',
  warn: '#ffc542',
  danger: '#ff5a52',
  estimate: '#ffc542',
} as const

export function useTheme(): Theme {
  const scheme = useColorScheme()
  return scheme === 'dark' ? dark : light
}

export { light, dark }
