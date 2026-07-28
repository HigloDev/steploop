// 主题系统：把原 miniprogram/app.wxss 的 CSS 变量迁移为 RN StyleSheet 友好的常量。
//
// 设计原则：
// - 浅色为主，深色保留语义颜色变量；不再用 CSS 变量，直接通过 useColorScheme 切换主题对象
// - rpx 单位换算为 px：750rpx ≈ 屏幕宽度，按 380px 设计基准，1rpx ≈ 0.5px
// - 字号、间距、圆角等以原 wxss 为准，按 RN 实际渲染微调

import { useColorScheme } from 'react-native'

export interface Theme {
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
  // 语义色
  green: string
  greenInk: string
  greenBright: string
  greenSoft: string
  mint: string
  amber: string
  amberSoft: string
  amberChip: string
  amberInk: string
  orange: string
  red: string
  redSoft: string
  redChip: string
  redInk: string
  blueSoft: string
  blueInk: string
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
  // 阴影
  shadowCard: ShadowStyle
  shadowSoft: ShadowStyle
  shadowLifted: ShadowStyle
}

export interface ShadowStyle {
  shadowColor: string
  shadowOffset: { width: number; height: number }
  shadowOpacity: number
  shadowRadius: number
  elevation: number
}

const light: Theme = {
  ink: '#101916',
  inkSoft: '#43534d',
  muted: '#65716c',
  mutedStrong: '#4d5e57',
  paper: '#f3f5f4',
  card: '#ffffff',
  cardSoft: '#f7f9f8',
  surfaceSoft: '#edf1ef',
  line: '#dce2df',
  lineSoft: '#e7ebe9',
  green: '#12372e',
  greenInk: '#276750',
  greenBright: '#35715f',
  greenSoft: '#e1f1ea',
  mint: '#71e2b5',
  amber: '#e7b45a',
  amberSoft: '#fff8e8',
  amberChip: '#fff4d9',
  amberInk: '#9b6a15',
  orange: '#ff914d',
  red: '#e26058',
  redSoft: '#fff1ef',
  redChip: '#f8dfda',
  redInk: '#68403d',
  blueSoft: '#e3eef4',
  blueInk: '#2a6b8a',
  radiusSm: 6,
  radiusMd: 10,
  radiusLg: 14,
  radiusXl: 20,
  tapMin: 44,
  pagePaddingH: 20,
  pagePaddingBottom: 32,
  fontBase: 15,
  fontEyebrow: 11,
  fontTitle: 26,
  fontSubtitle: 13,
  fontLabel: 12,
  fontValue: 17,
  fontMetric: 23,
  fontPill: 11,
  fontSmall: 12,
  shadowCard: {
    shadowColor: '#101916',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 17,
    elevation: 3,
  },
  shadowSoft: {
    shadowColor: '#101916',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 7,
    elevation: 1,
  },
  shadowLifted: {
    shadowColor: '#101916',
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.1,
    shadowRadius: 22,
    elevation: 5,
  },
}

const dark: Theme = {
  ...light,
  ink: '#f4faf7',
  inkSoft: '#b9c8c1',
  muted: '#8fa39a',
  mutedStrong: '#b9c8c1',
  paper: '#07100f',
  card: '#0e1e1b',
  cardSoft: '#142723',
  surfaceSoft: '#142723',
  line: '#1f3530',
  lineSoft: '#1a2b27',
  green: '#71e2b5',
  greenInk: '#35715f',
  greenBright: '#9af0cb',
  greenSoft: '#103029',
  mint: '#9af0cb',
  amberSoft: '#2a2210',
  amberChip: '#3a2f12',
  amberInk: '#e7b45a',
  redSoft: '#2a1311',
  redChip: '#3a1c1a',
  redInk: '#e26058',
  blueSoft: '#0e2530',
  blueInk: '#7ec3e0',
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
    shadowOpacity: 0.4,
    shadowRadius: 22,
    elevation: 6,
  },
}

export function useTheme(): Theme {
  const scheme = useColorScheme()
  return scheme === 'dark' ? dark : light
}

export { light, dark }
