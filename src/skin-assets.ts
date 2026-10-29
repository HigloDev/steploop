import type { ImageSourcePropType } from 'react-native'
import type { SkinId } from './skin-catalog'
import type { SkinPage } from './theme'
import type { CoachCourseId } from './core/coach'

export interface SkinArtworkSet {
  mark: ImageSourcePropType
  scene: ImageSourcePropType
  achievement: ImageSourcePropType
}

/** Bundled local artwork; changing appearance never performs a network request. */
const artwork: Partial<Record<SkinId, SkinArtworkSet>> = {
  'night-run': {
    mark: require('../assets/skins/night-run/mark.png'),
    scene: require('../assets/skins/night-run/scene.png'),
    achievement: require('../assets/skins/night-run/achievement.png'),
  },
  woodland: {
    mark: require('../assets/skins/woodland/mark.png'),
    scene: require('../assets/skins/woodland/scene.png'),
    achievement: require('../assets/skins/woodland/achievement.png'),
  },
  'eva-unit-01': {
    mark: require('../assets/skins/eva-unit-01/mark.png'),
    scene: require('../assets/skins/eva-unit-01/scene.png'),
    achievement: require('../assets/skins/eva-unit-01/achievement.png'),
  },
  'eva-unit-02': {
    mark: require('../assets/skins/eva-unit-02/mark.png'),
    scene: require('../assets/skins/eva-unit-02/scene.png'),
    achievement: require('../assets/skins/eva-unit-02/achievement.png'),
  },
  pikachu: {
    mark: require('../assets/skins/pikachu/mark.png'),
    scene: require('../assets/skins/pikachu/scene.png'),
    achievement: require('../assets/skins/pikachu/achievement.png'),
  },
  'k-on': {
    mark: require('../assets/skins/k-on/mark.png'),
    scene: require('../assets/skins/k-on/scene.png'),
    achievement: require('../assets/skins/k-on/achievement.png'),
  },
}

export function getSkinArtwork(skinId: SkinId): SkinArtworkSet | undefined {
  return artwork[skinId]
}

export function getSkinMarkArtwork(skinId: SkinId, mode: 'light' | 'dark' = 'light'): ImageSourcePropType | undefined {
  return skinId === 'eva-unit-01' && mode === 'dark'
    ? require('../assets/skins/eva-unit-01/mark-dark.png') : artwork[skinId]?.mark
}

const courseArtwork: Partial<Record<SkinId, Partial<Record<CoachCourseId, ImageSourcePropType>>>> = {
  woodland: {
    weight: require('../assets/skins/woodland/course-weight.png'),
    beginner: require('../assets/skins/woodland/course-beginner.png'),
    cardio: require('../assets/skins/woodland/course-cardio.png'),
  },
  pikachu: { weight: require('../assets/skins/pikachu/course-weight.png'), beginner: require('../assets/skins/pikachu/course-beginner.png'), cardio: require('../assets/skins/pikachu/course-cardio.png') },
  'k-on': { weight: artwork['k-on']!.mark },
}

export function getSkinCourseArtwork(skinId: SkinId, course: CoachCourseId): ImageSourcePropType | undefined {
  return courseArtwork[skinId]?.[course]
}

const buildingArtwork: Partial<Record<SkinId, ImageSourcePropType>> = {
  woodland: require('../assets/skins/woodland/building.png'),
  'night-run': require('../assets/skins/night-run/building.png'),
  'eva-unit-01': require('../assets/skins/eva-unit-01/building.png'),
  'eva-unit-02': require('../assets/skins/eva-unit-02/building.png'),
  pikachu: require('../assets/skins/pikachu/building.png'),
}

export function getSkinBuildingArtwork(skinId: SkinId): ImageSourcePropType | undefined {
  return buildingArtwork[skinId]
}

const pageArtwork: Partial<Record<SkinId, Partial<Record<SkinPage, ImageSourcePropType>>>> = {
  'k-on': { home: require('../assets/skins/k-on/header-home.png'), coach: require('../assets/skins/k-on/header-coach.png'), history: require('../assets/skins/k-on/header-history.png'), settings: require('../assets/skins/k-on/header-settings.png') },
  'night-run': { home: require('../assets/skins/night-run/header-home.png'), coach: require('../assets/skins/night-run/header-coach.png'), history: require('../assets/skins/night-run/header-history.png'), settings: require('../assets/skins/night-run/header-settings.png') },
  woodland: { home: require('../assets/skins/woodland/header-home.png'), coach: require('../assets/skins/woodland/header-coach.png'), history: require('../assets/skins/woodland/header-history.png'), settings: require('../assets/skins/woodland/header-settings.png') },
  'eva-unit-01': { home: require('../assets/skins/eva-unit-01/header-home.png'), coach: require('../assets/skins/eva-unit-01/header-coach.png'), history: require('../assets/skins/eva-unit-01/header-history.png'), settings: require('../assets/skins/eva-unit-01/header-settings.png') },
  'eva-unit-02': { home: require('../assets/skins/eva-unit-02/header-home.png'), coach: require('../assets/skins/eva-unit-02/header-coach.png'), history: require('../assets/skins/eva-unit-02/header-history.png'), settings: require('../assets/skins/eva-unit-02/header-settings.png') },
  pikachu: { home: require('../assets/skins/pikachu/header-home.png'), coach: require('../assets/skins/pikachu/header-coach.png'), history: require('../assets/skins/pikachu/header-history.png'), settings: require('../assets/skins/pikachu/header-settings.png') },
}

/** Override only when the approved dark composition differs from the light art. */
const darkPageArtwork: Partial<Record<SkinId, Partial<Record<SkinPage, ImageSourcePropType>>>> = {
  'eva-unit-02': { history: require('../assets/skins/eva-unit-02/header-history-dark.png') },
  woodland: { coach: require('../assets/skins/woodland/header-coach-dark.png') },
  pikachu: { home: require('../assets/skins/pikachu/header-home-dark.png'), coach: require('../assets/skins/pikachu/header-coach-dark.png'), history: require('../assets/skins/pikachu/header-history-dark.png'), settings: require('../assets/skins/pikachu/header-settings-dark.png') },
}

export function getSkinHeaderArtwork(skinId: SkinId, page: SkinPage, mode: 'light' | 'dark' = 'light'): ImageSourcePropType | undefined {
  if (mode === 'dark' && darkPageArtwork[skinId]?.[page]) return darkPageArtwork[skinId][page]
  return pageArtwork[skinId]?.[page]
}
