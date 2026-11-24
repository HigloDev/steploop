import type { ImageSourcePropType } from 'react-native'
import type { SkinId, ResolvedAppearance } from './skin-catalog'

export interface ThemeVisualAssets {
  backdrop: Record<ResolvedAppearance, ImageSourcePropType>
  stairwell: Record<ResolvedAppearance, ImageSourcePropType>
}

/** 全部 6 套轻量玻璃主题的本地静态资源，切换主题零网络请求。 */
const THEME_ASSETS: Record<SkinId, ThemeVisualAssets> = {
  'motion-ring': {
    backdrop: {
      light: require('../assets/skins/motion-ring/backdrop-light.webp'),
      dark: require('../assets/skins/motion-ring/backdrop-dark.webp'),
    },
    stairwell: {
      light: require('../assets/skins/motion-ring/stairwell-light.webp'),
      dark: require('../assets/skins/motion-ring/stairwell-dark.webp'),
    },
  },
  'glacier-glass': {
    backdrop: {
      light: require('../assets/skins/glacier-glass/backdrop-light.webp'),
      dark: require('../assets/skins/glacier-glass/backdrop-dark.webp'),
    },
    stairwell: {
      light: require('../assets/skins/glacier-glass/stairwell.webp'),
      dark: require('../assets/skins/glacier-glass/stairwell-dark.webp'),
    },
  },
  'night-run': {
    backdrop: {
      light: require('../assets/skins/night-run/backdrop-light.webp'),
      dark: require('../assets/skins/night-run/backdrop-dark.webp'),
    },
    stairwell: {
      light: require('../assets/skins/night-run/stairwell-light.webp'),
      dark: require('../assets/skins/night-run/stairwell-dark.webp'),
    },
  },
  woodland: {
    backdrop: {
      light: require('../assets/skins/woodland/backdrop-light.webp'),
      dark: require('../assets/skins/woodland/backdrop-dark.webp'),
    },
    stairwell: {
      light: require('../assets/skins/woodland/stairwell-light.webp'),
      dark: require('../assets/skins/woodland/stairwell-dark.webp'),
    },
  },
  'eva-unit-01': {
    backdrop: {
      light: require('../assets/skins/eva-unit-01/backdrop-light.webp'),
      dark: require('../assets/skins/eva-unit-01/backdrop-dark.webp'),
    },
    stairwell: {
      light: require('../assets/skins/eva-unit-01/stairwell-light.webp'),
      dark: require('../assets/skins/eva-unit-01/stairwell-dark.webp'),
    },
  },
  'k-on': {
    backdrop: {
      light: require('../assets/skins/k-on/backdrop-light.webp'),
      dark: require('../assets/skins/k-on/backdrop-dark.webp'),
    },
    stairwell: {
      light: require('../assets/skins/k-on/stairwell-light.webp'),
      dark: require('../assets/skins/k-on/stairwell-dark.webp'),
    },
  },
}

export function getThemeBackdrop(skinId: SkinId, mode: ResolvedAppearance): ImageSourcePropType {
  return THEME_ASSETS[skinId].backdrop[mode]
}

export function getThemeStairwell(skinId: SkinId, mode: ResolvedAppearance): ImageSourcePropType {
  return THEME_ASSETS[skinId].stairwell[mode]
}
