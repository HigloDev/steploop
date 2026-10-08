// Shared native design tokens. Legacy green* names remain compatible with
// existing screens; they now refer to the blue action palette.

import { useColorScheme } from 'react-native'

export interface Theme {
  isDark: boolean
  onPrimary: string
  success: string
  successSoft: string
  energy: string
  scrim: string
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
  isDark: false,
  onPrimary: '#ffffff',
  ink: '#17243a',
  inkSoft: '#43516a',
  muted: '#637189',
  mutedStrong: '#526078',
  paper: '#f4f6fa',
  card: '#ffffff',
  cardSoft: '#f4f6fb',
  surfaceSoft: '#ebeff6',
  line: '#d8dfeb',
  lineSoft: '#e6eaf2',
  green: '#3560e4',
  greenInk: '#284bb8',
  greenBright: '#4e73e9',
  greenSoft: '#e9eeff',
  mint: '#a3c6ff',
  success: '#28745d',
  successSoft: '#e6f3ed',
  energy: '#ad562b',
  scrim: '#101a2eb3',
  amber: '#b78023',
  amberSoft: '#fff6e6',
  amberChip: '#fff0d2',
  amberInk: '#86580d',
  orange: '#ad562b',
  red: '#c84b53',
  redSoft: '#fff0f1',
  redChip: '#fbe4e7',
  redInk: '#a72e3f',
  blueSoft: '#e9eeff',
  blueInk: '#284bb8',
  radiusSm: 10,
  radiusMd: 14,
  radiusLg: 20,
  radiusXl: 24,
  tapMin: 48,
  pagePaddingH: 20,
  pagePaddingBottom: 32,
  fontBase: 15,
  fontEyebrow: 12,
  fontTitle: 28,
  fontSubtitle: 14,
  fontLabel: 13,
  fontValue: 20,
  fontMetric: 28,
  fontPill: 12,
  fontSmall: 12,
  shadowCard: {
    shadowColor: '#17243a',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  shadowSoft: {
    shadowColor: '#17243a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 7,
    elevation: 0,
  },
  shadowLifted: {
    shadowColor: '#17243a',
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.1,
    shadowRadius: 22,
    elevation: 5,
  },
}

const dark: Theme = {
  ...light,
  isDark: true,
  onPrimary: '#17264a',
  ink: '#edf2fc',
  inkSoft: '#c3cee4',
  muted: '#9aa8c1',
  mutedStrong: '#b6c2d9',
  paper: '#101522',
  card: '#1a2131',
  cardSoft: '#20293b',
  surfaceSoft: '#263147',
  line: '#37435b',
  lineSoft: '#2b354a',
  green: '#a9bdff',
  greenInk: '#bed0ff',
  greenBright: '#cad8ff',
  greenSoft: '#26365e',
  mint: '#a3c6ff',
  success: '#8fd6b7',
  successSoft: '#173b32',
  energy: '#f3b68d',
  scrim: '#030710cc',
  amber: '#e4b669',
  amberSoft: '#382b18',
  amberChip: '#44341a',
  amberInk: '#ebc47e',
  orange: '#f3b68d',
  red: '#f4a0a9',
  redSoft: '#38222e',
  redChip: '#482934',
  redInk: '#f5adb6',
  blueSoft: '#26365e',
  blueInk: '#bed0ff',
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
