/** 轻量玻璃 Bento 主题目录（6 套浅暗成对配色，默认「疾阶运动」对齐应用 Logo）。颜色与玻璃氛围数据；src/theme.ts 为唯一显示层入口。 */

export interface SkinBackdropPaint {
  backdropTop: string
  backdropBottom: string
  backdropBloom: string
  backdropBloomOpacity: number
  bounce: string
  bounceOpacity: number
}

export interface SkinPaint {
  paper: string
  card: string
  ink: string
  muted: string
  brand: string
  brandText: string
  onBrand: string
  heroSurface: string
  heroInk: string
  heroMuted: string
  heroAccent: string
  dangerInk?: string
  backdrop: SkinBackdropPaint
}

export const SKIN_CATALOG = [
  {
    id: 'motion-ring',
    name: '疾阶运动',
    description: '图标同款钴蓝与冰青环，轻透磨砂',
    icon: 'compass',
    swatch: '#0A5CE8',
    light: {
      paper: '#EDF5FF',
      card: '#FFFFFF',
      ink: '#071E4F',
      muted: '#33507C',
      brand: '#0A5CE8',
      brandText: '#0750CF',
      onBrand: '#FFFFFF',
      heroSurface: '#06246E',
      heroInk: '#F4FBFF',
      heroMuted: '#CCE3FF',
      heroAccent: '#5CEBFF',
      backdrop: {
        backdropTop: '#F2F8FF',
        backdropBottom: '#D2E8FF',
        backdropBloom: '#6CEBFF',
        backdropBloomOpacity: 0.36,
        bounce: '#7EB8FF',
        bounceOpacity: 0.30,
      },
    },
    dark: {
      paper: '#041338',
      card: '#091E4D',
      ink: '#F2F9FF',
      muted: '#A8C9F2',
      brand: '#5AE6FF',
      brandText: '#6CEBFF',
      onBrand: '#041A47',
      heroSurface: '#06205E',
      heroInk: '#F4FBFF',
      heroMuted: '#C6DFFF',
      heroAccent: '#67F0FF',
      backdrop: {
        backdropTop: '#041236',
        backdropBottom: '#092A74',
        backdropBloom: '#0D6EFF',
        backdropBloomOpacity: 0.42,
        bounce: '#2BD9FF',
        bounceOpacity: 0.18,
      },
    },
  },
  {
    id: 'glacier-glass',
    name: '冰川透蓝',
    description: '冰川科技蓝玻璃 Bento，清透克制',
    icon: 'droplet',
    swatch: '#245CD8',
    light: {
      paper: '#EDF4FD',
      card: '#FFFFFF',
      ink: '#14263F',
      muted: '#455D78',
      brand: '#245CD8',
      brandText: '#245CD8',
      onBrand: '#FFFFFF',
      heroSurface: '#16304F',
      heroInk: '#F2F7FF',
      heroMuted: '#B9CBE6',
      heroAccent: '#8EBBFF',
      backdrop: {
        backdropTop: '#EDF4FD',
        backdropBottom: '#CCDFFA',
        backdropBloom: '#8EBBFF',
        backdropBloomOpacity: 0.55,
        bounce: '#B3E8EA',
        bounceOpacity: 0.62,
      },
    },
    dark: {
      paper: '#101C2E',
      card: '#16243A',
      ink: '#F2F7FF',
      muted: '#BACDE6',
      brand: '#8EBBFF',
      brandText: '#8EBBFF',
      onBrand: '#0F2341',
      heroSurface: '#142841',
      heroInk: '#F2F7FF',
      heroMuted: '#C4D5EE',
      heroAccent: '#9CC6FF',
      backdrop: {
        backdropTop: '#101C2E',
        backdropBottom: '#142841',
        backdropBloom: '#8EBBFF',
        backdropBloomOpacity: 0.22,
        bounce: '#3F8C9C',
        bounceOpacity: 0.25,
      },
    },
  },
  {
    id: 'night-run',
    name: '荧光夜行',
    description: '冷雾与炭黑底色，荧光黄绿速度强调',
    icon: 'activity',
    swatch: '#A9DC29',
    light: {
      paper: '#F3F9F1',
      card: '#FFFFFF',
      ink: '#19221A',
      muted: '#4B5A42',
      brand: '#D3F84B',
      brandText: '#435A08',
      onBrand: '#1D270A',
      heroSurface: '#142830',
      heroInk: '#F4F8EF',
      heroMuted: '#C1CDBB',
      heroAccent: '#D7FF55',
      backdrop: {
        backdropTop: '#F3F9F1',
        backdropBottom: '#D6ECCF',
        backdropBloom: '#B8EC68',
        backdropBloomOpacity: 0.45,
        bounce: '#9BE0C8',
        bounceOpacity: 0.42,
      },
    },
    dark: {
      paper: '#0C1717',
      card: '#142324',
      ink: '#F1F5EC',
      muted: '#BBC7B6',
      brand: '#D7FF55',
      brandText: '#D7FF55',
      onBrand: '#1D270A',
      heroSurface: '#1A241C',
      heroInk: '#F4F8EF',
      heroMuted: '#C1CDBB',
      heroAccent: '#D7FF55',
      backdrop: {
        backdropTop: '#0B1617',
        backdropBottom: '#122625',
        backdropBloom: '#9BE03B',
        backdropBloomOpacity: 0.2,
        bounce: '#2F7B6C',
        bounceOpacity: 0.24,
      },
    },
  },
  {
    id: 'woodland',
    name: '松风山岚',
    description: '米白与深森林绿，沉静松林节奏',
    icon: 'feather',
    swatch: '#2E614B',
    light: {
      paper: '#F8F7EC',
      card: '#FFFDF7',
      ink: '#23372C',
      muted: '#4B6050',
      brand: '#2E614B',
      brandText: '#2E614B',
      onBrand: '#FFFFFF',
      heroSurface: '#F2EDE0',
      heroInk: '#142B2D',
      heroMuted: '#4F6368',
      heroAccent: '#2E614B',
      backdrop: {
        backdropTop: '#F8F7EC',
        backdropBottom: '#D9E8D4',
        backdropBloom: '#8EC49B',
        backdropBloomOpacity: 0.48,
        bounce: '#C9E2BA',
        bounceOpacity: 0.5,
      },
    },
    dark: {
      paper: '#0B1B17',
      card: '#12261F',
      ink: '#F0F4E9',
      muted: '#B4C6B6',
      brand: '#B6D79B',
      brandText: '#C0DFAA',
      onBrand: '#1A2E18',
      heroSurface: '#11241F',
      heroInk: '#F4F8EA',
      heroMuted: '#C2D4BA',
      heroAccent: '#C6E7AA',
      backdrop: {
        backdropTop: '#0A1A16',
        backdropBottom: '#132C24',
        backdropBloom: '#72B086',
        backdropBloomOpacity: 0.22,
        bounce: '#3E7563',
        bounceOpacity: 0.24,
      },
    },
  },
  {
    id: 'eva-unit-01',
    name: '紫电幽光',
    description: '雾紫与深紫黑玻璃，亮紫与荧光绿点缀',
    icon: 'zap',
    swatch: '#7545AB',
    light: {
      paper: '#F6F2FC',
      card: '#FFFFFF',
      ink: '#2B203C',
      muted: '#635275',
      brand: '#7545AB',
      brandText: '#6B379F',
      onBrand: '#FFFFFF',
      heroSurface: '#20253F',
      heroInk: '#F7F2FF',
      heroMuted: '#D7CAE6',
      heroAccent: '#B9ED52',
      backdrop: {
        backdropTop: '#F6F2FC',
        backdropBottom: '#DFD2F6',
        backdropBloom: '#B892F2',
        backdropBloomOpacity: 0.48,
        bounce: '#BFE8A8',
        bounceOpacity: 0.36,
      },
    },
    dark: {
      paper: '#10101C',
      card: '#191828',
      ink: '#F6F0FF',
      muted: '#C3B2D7',
      brand: '#B28AF0',
      brandText: '#C3A0FF',
      onBrand: '#221035',
      heroSurface: '#181629',
      heroInk: '#FBF6FF',
      heroMuted: '#D7C6E6',
      heroAccent: '#BBEF55',
      backdrop: {
        backdropTop: '#0F0F1C',
        backdropBottom: '#1E1836',
        backdropBloom: '#9D71EB',
        backdropBloomOpacity: 0.24,
        bounce: '#48753A',
        bounceOpacity: 0.22,
      },
    },
  },
  {
    id: 'k-on',
    name: '樱粉和弦',
    description: '暖奶油与可可棕玻璃，莓粉与柔粉点缀',
    icon: 'music',
    swatch: '#AF315B',
    light: {
      paper: '#FDF6F2',
      card: '#FFFDFA',
      ink: '#3F2D2D',
      muted: '#72565B',
      brand: '#AF315B',
      brandText: '#A23760',
      onBrand: '#FFFFFF',
      heroSurface: '#973653',
      heroInk: '#FFF7E9',
      heroMuted: '#F4DBDE',
      heroAccent: '#FFD1E1',
      backdrop: {
        backdropTop: '#FDF6F2',
        backdropBottom: '#F5DBE2',
        backdropBloom: '#F2A3BE',
        backdropBloomOpacity: 0.46,
        bounce: '#F5D6BA',
        bounceOpacity: 0.48,
      },
    },
    dark: {
      paper: '#201822',
      card: '#2F232C',
      ink: '#FFF2E6',
      muted: '#D5B8C3',
      brand: '#F2A7C4',
      brandText: '#F7BAD1',
      onBrand: '#3E1F2C',
      heroSurface: '#29212B',
      heroInk: '#FFF6E8',
      heroMuted: '#E6C9D0',
      heroAccent: '#F7BCD1',
      backdrop: {
        backdropTop: '#1E1621',
        backdropBottom: '#311F2D',
        backdropBloom: '#D97DA0',
        backdropBloomOpacity: 0.23,
        bounce: '#7A4E61',
        bounceOpacity: 0.24,
      },
    },
  },
] as const satisfies readonly {
  id: string
  name: string
  description: string
  icon: string
  swatch: string
  light: SkinPaint
  dark: SkinPaint
}[]

export type SkinId = (typeof SKIN_CATALOG)[number]['id']
export type AppearanceMode = 'system' | 'light' | 'dark'
export const APPEARANCE_MODE_LABELS = { system: '跟随系统', light: '浅色', dark: '深色' } as const
export type ResolvedAppearance = 'light' | 'dark'
export interface AppearanceSelection { skinId: SkinId; mode: AppearanceMode }
export const DEFAULT_APPEARANCE: AppearanceSelection = { skinId: 'motion-ring', mode: 'system' }

export function normalizeSkinId(value: unknown): SkinId {
  return SKIN_CATALOG.some(skin => skin.id === value) ? (value as SkinId) : 'motion-ring'
}

export function normalizeAppearanceMode(value: unknown): AppearanceMode {
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function normalizeAppearance(value: unknown): AppearanceSelection {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return { skinId: normalizeSkinId(record.skinId), mode: normalizeAppearanceMode(record.mode) }
}

export function resolveAppearanceMode(mode: AppearanceMode, system: string | null | undefined): ResolvedAppearance {
  return mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode
}

export function skinName(id: SkinId): string {
  return SKIN_CATALOG.find(skin => skin.id === id)?.name ?? SKIN_CATALOG[0].name
}
