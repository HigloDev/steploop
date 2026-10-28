import React, { useState } from 'react'
import { Image, ImageProps, StyleProp, useWindowDimensions, View, ViewStyle } from 'react-native'
import { getThemeSkinId, isLargeText, skinGeometry, Theme, useTheme } from '../theme'
import { getSkinArtwork, SkinArtworkSet } from '../skin-assets'

type ArtKind = keyof SkinArtworkSet

/** Decoration is excluded from focus/reading order and never covers controls. */
export function SkinArt({ kind = 'scene', width = skinGeometry.sceneWidth, height = skinGeometry.sceneHeight,
  theme: suppliedTheme, style, onLoad, onError }: {
  kind?: ArtKind; width?: number; height?: number; theme?: Theme; style?: StyleProp<ViewStyle>
  onLoad?: ImageProps['onLoad']; onError?: ImageProps['onError']
}) {
  const currentTheme = useTheme(), theme = suppliedTheme ?? currentTheme
  const skinId = getThemeSkinId(theme), source = getSkinArtwork(skinId)?.[kind]
  const identity = `${skinId}/${kind}`
  const [failed, setFailed] = useState<string>()
  if (!source || failed === identity) return null
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[{ width, height, flexShrink: 0 }, style]}>
    <Image key={identity} source={source} resizeMode="contain" resizeMethod="resize" fadeDuration={0}
      accessible={false} style={{ width: '100%', height: '100%' }} onLoad={onLoad}
      onError={event => { setFailed(identity); onError?.(event) }} />
  </View>
}

/** A reserved image column keeps text, dynamic metrics and touch targets readable. */
export function SkinLead({ children, compact = false, featured = false, kind = 'scene', style }: {
  children: React.ReactNode; compact?: boolean; featured?: boolean; kind?: ArtKind; style?: StyleProp<ViewStyle>
}) {
  const theme = useTheme(), { width, fontScale } = useWindowDimensions()
  const small = width < 360 || isLargeText(fontScale)
  if (!getSkinArtwork(getThemeSkinId(theme))) return <>{children}</>
  if (featured) return <View style={style}>
    {children}
    <SkinArt kind={kind} width={Math.min(width - theme.pagePaddingH * 2, skinGeometry.featureWidth)}
      height={small ? skinGeometry.featureSmallHeight : skinGeometry.featureHeight}
      theme={theme} style={{ alignSelf: 'flex-end' }} />
  </View>
  const artWidth = small ? skinGeometry.smallWidth : compact ? skinGeometry.compactWidth : skinGeometry.sceneWidth
  const artHeight = small ? skinGeometry.smallHeight : compact ? skinGeometry.compactHeight : skinGeometry.sceneHeight
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: skinGeometry.gap }, style]}>
    <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    <SkinArt kind={kind} width={artWidth} height={artHeight} theme={theme} />
  </View>
}
