/** Stable skin directory. Color data only; src/theme.ts remains the UI entry. */
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
}

export const SKIN_CATALOG = [
  {
    id: 'classic', name: '原版钴蓝', description: '保留 1.1.5 的冷白、钴蓝与深蓝', icon: 'layers',
    light: null, dark: null,
  },
  {
    id: 'night-run', name: '夜跑竞技', description: '夜城跑道与黄绿速度线，每一步都向前', icon: 'activity',
    light: { paper: '#F5FAF4', card: '#FFFFFF', ink: '#19221A', muted: '#546147', brand: '#D3F84B', brandText: '#4B620B', onBrand: '#202B0D',
      heroSurface: '#142830', heroInk: '#F4F8EF', heroMuted: '#C1CDBB', heroAccent: '#D7FF55' },
    dark: { paper: '#0C1717', card: '#142324', ink: '#F1F5EC', muted: '#BBC7B6', brand: '#D7FF55', brandText: '#D7FF55', onBrand: '#202B0D',
      heroSurface: '#1A241C', heroInk: '#F4F8EF', heroMuted: '#C1CDBB', heroAccent: '#D7FF55' },
  },
  {
    id: 'woodland', name: '山野自然', description: '松林、山径与米白，按照自己的节奏', icon: 'feather',
    light: { paper: '#F9F7EC', card: '#FFFDF7', ink: '#263B30', muted: '#536757', brand: '#2E614B', brandText: '#2E614B', onBrand: '#FFFFFF',
      heroSurface: '#F6F2E3', heroInk: '#142B2D', heroMuted: '#53666C', heroAccent: '#315E4D' },
    dark: { paper: '#0B1B17', card: '#12261F', ink: '#F0F4E9', muted: '#B4C6B6', brand: '#B6D79B', brandText: '#C0DFAA', onBrand: '#1C301A',
      heroSurface: '#11241F', heroInk: '#F4F8EA', heroMuted: '#C2D4BA', heroAccent: '#C6E7AA' },
  },
  {
    id: 'eva-unit-01', name: 'EVA 初号机', description: '紫绿机甲、独角与六角力场', icon: 'zap',
    light: { paper: '#F7F4FC', card: '#FFFFFF', ink: '#2D233E', muted: '#6D5B7D', brand: '#7545AB', brandText: '#6B379F', onBrand: '#FFFFFF',
      heroSurface: '#20253F', heroInk: '#F7F2FF', heroMuted: '#D7CAE6', heroAccent: '#B9ED52' },
    dark: { paper: '#10101C', card: '#191825', ink: '#F6F0FF', muted: '#C3B2D7', brand: '#B28AF0', brandText: '#C3A0FF', onBrand: '#251337',
      heroSurface: '#181629', heroInk: '#FBF6FF', heroMuted: '#D7C6E6', heroAccent: '#BBEF55' },
  },
  {
    id: 'eva-unit-02', name: 'EVA 二号机', description: '红橙机甲、四眼装甲与行动标记', icon: 'shield',
    light: { paper: '#FFF9F6', card: '#FFFCF9', ink: '#3B2524', muted: '#7B5550', brand: '#D51E30', brandText: '#A82727', onBrand: '#FFFFFF',
      heroSurface: '#FAE6E1', heroInk: '#271922', heroMuted: '#705355', heroAccent: '#AE2230', dangerInk: '#8F1745' },
    dark: { paper: '#180F12', card: '#23191C', ink: '#FFF1EA', muted: '#D9B5AE', brand: '#D51E30', brandText: '#FF7E87', onBrand: '#FFFFFF',
      heroSurface: '#25151B', heroInk: '#FFF5E8', heroMuted: '#E7C5BC', heroAccent: '#FFD480', dangerInk: '#FFB3CD' },
  },
  {
    id: 'pikachu', name: '皮卡丘', description: '耳朵、闪电尾巴与明黄，轻快有精神', icon: 'sun',
    light: { paper: '#FFF9E7', card: '#FFFFFF', ink: '#3C301B', muted: '#746039', brand: '#F4C83E', brandText: '#765500', onBrand: '#32290E',
      heroSurface: '#FFFFFF', heroInk: '#172337', heroMuted: '#586478', heroAccent: '#8C6400' },
    dark: { paper: '#1C190F', card: '#2F2719', ink: '#FFF4D1', muted: '#D4C19A', brand: '#FFD448', brandText: '#FFE074', onBrand: '#352908',
      heroSurface: '#28241A', heroInk: '#FFF5D0', heroMuted: '#E3D1A5', heroAccent: '#FFD94F' },
  },
  {
    id: 'k-on', name: 'K-On', description: '吉他、贝斯与茶杯，放课后的轻松', icon: 'music',
    light: { paper: '#FFF8F0', card: '#FFFDFA', ink: '#42302F', muted: '#7B5D62', brand: '#AF315B', brandText: '#A23760', onBrand: '#FFFFFF',
      heroSurface: '#973653', heroInk: '#FFF7E9', heroMuted: '#F4DBDE', heroAccent: '#FFD1E1' },
    dark: { paper: '#211A24', card: '#30242C', ink: '#FFF2E6', muted: '#D5B8C3', brand: '#F2A7C4', brandText: '#F7BAD1', onBrand: '#40212E',
      heroSurface: '#29212B', heroInk: '#FFF6E8', heroMuted: '#E6C9D0', heroAccent: '#F7BCD1' },
  },
] as const satisfies readonly { id: string; name: string; description: string; icon: string; light: SkinPaint | null; dark: SkinPaint | null }[]

export type SkinId = (typeof SKIN_CATALOG)[number]['id']
export type AppearanceMode = 'system' | 'light' | 'dark'
export const APPEARANCE_MODE_LABELS = { system: '跟随系统', light: '浅色', dark: '暗色' } as const
export type ResolvedAppearance = 'light' | 'dark'
export interface AppearanceSelection { skinId: SkinId; mode: AppearanceMode }
export const DEFAULT_APPEARANCE: AppearanceSelection = { skinId: 'classic', mode: 'system' }

export function normalizeSkinId(value: unknown): SkinId {
  return SKIN_CATALOG.some(skin => skin.id === value) ? value as SkinId : 'classic'
}
export function normalizeAppearanceMode(value: unknown): AppearanceMode {
  return value === 'light' || value === 'dark' ? value : 'system'
}
export function normalizeAppearance(value: unknown): AppearanceSelection {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return { skinId: normalizeSkinId(record.skinId), mode: normalizeAppearanceMode(record.mode) }
}
export function resolveAppearanceMode(mode: AppearanceMode, system: string | null | undefined): ResolvedAppearance {
  return mode === 'system' ? system === 'dark' ? 'dark' : 'light' : mode
}
export function skinName(id: SkinId): string {
  return SKIN_CATALOG.find(skin => skin.id === id)?.name ?? SKIN_CATALOG[0].name
}
