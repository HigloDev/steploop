import React, { useState } from 'react'
import { Image, ImageSourcePropType, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import type { CoachCourseId } from '../core/coach'
import { getSkinBuildingArtwork, getSkinCourseArtwork, getSkinHeaderArtwork, getSkinMarkArtwork } from '../skin-assets'
import { getCourseIconAccent, getThemeSkinId, useTheme } from '../theme'

function DetailArt({ source, identity, size, fallback }: {
  source?: ImageSourcePropType; identity: string; size: number; fallback: React.ReactNode
}) {
  const [failed, setFailed] = useState<string>()
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
    {source && failed !== identity ? <Image key={identity} source={source} resizeMode="contain" fadeDuration={0} accessible={false}
      style={{ width: size, height: size }} onError={() => setFailed(identity)} /> : fallback}
  </View>
}

export function SkinCourseThumbnail({ course, size = 36 }: { course: CoachCourseId; size?: number }) {
  const theme = useTheme(), skin = getThemeSkinId(theme)
  const icon = course === 'weight' ? 'bullseye-arrow' : course === 'beginner' ? (skin === 'night-run' ? 'shoe-sneaker' : 'stairs-up') : 'heart-pulse'
  return <DetailArt source={getSkinCourseArtwork(skin, course)} identity={`${skin}/course/${course}`} size={size}
    fallback={<MaterialCommunityIcons name={icon} size={size} color={getCourseIconAccent(theme, course)} accessible={false} />} />
}

export function SkinBuildingThumbnail({ size = 34, history = false, selected = true }: { size?: number; history?: boolean; selected?: boolean }) {
  const theme = useTheme(), skin = getThemeSkinId(theme), mode = theme.isDark ? 'dark' : 'light'
  const source = skin === 'k-on' && history ? getSkinMarkArtwork(skin, mode) : getSkinBuildingArtwork(skin)
  return <DetailArt source={source} identity={`${skin}/${mode}/building/${history}`} size={size}
    fallback={<MaterialCommunityIcons name={skin === 'k-on' || !selected ? 'stairs-up' : 'office-building-outline'} size={size - 5} color={theme.brandInk} accessible={false} />} />
}

/** Genuine theme artwork behind live metrics; it never paints over text or handles input. */
export function SkinWeekMotif() {
  const theme = useTheme(), skin = getThemeSkinId(theme), mode = theme.isDark ? 'dark' : 'light'
  const identity = `${skin}/${mode}/week`
  const [failed, setFailed] = useState<string>()
  if (!['eva-unit-01', 'eva-unit-02'].includes(skin) || failed === identity || skin === 'eva-unit-02' && !theme.isDark) return null
  const source = getSkinHeaderArtwork(skin, 'history', mode)
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 290, opacity: theme.isDark ? 0.2 : 0.12 }}>
    <Image key={identity} source={source} resizeMode="cover" fadeDuration={0} accessible={false}
      style={{ width: '100%', height: '100%' }} onError={() => setFailed(identity)} />
  </View>
}
