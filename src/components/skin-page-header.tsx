import React, { useState } from 'react'
import { Text, useWindowDimensions, View } from 'react-native'
import { SkinHeaderImage } from './skin-header-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BrandMark } from './brand-mark'
import { BrandWordmark } from './brand-wordmark'
import { getSkinHeaderArtwork } from '../skin-assets'
import { getSkinHeaderLayout, getSkinPageHeight, getThemeSkinId, isGlacier, isLargeText, SkinPage, typography, useTheme } from '../theme'

/** A real text/control layer over page-specific art, never a screenshot of controls. */
export function SkinPageHeader({ page, title, right, children, includeTopInset = true }: {
  page: SkinPage; title?: string; right?: React.ReactNode
  children?: React.ReactNode; includeTopInset?: boolean
}) {
  const theme = useTheme(), skin = getThemeSkinId(theme), glass = isGlacier(theme), { width, fontScale } = useWindowDimensions(), insets = useSafeAreaInsets()
  const mode = theme.isDark ? 'dark' : 'light'
  // 冰川视觉没有页头插画：标题与副标题直接落在稳定玻璃画布上，避免 NaN 高度与空画布。
  const source = glass ? undefined : getSkinHeaderArtwork(skin, page, mode)
  const identity = `${skin}/${mode}/${page}`
  const baseHeight = glass ? 0 : getSkinPageHeight(theme, page, width)
  const largeText = isLargeText(fontScale)
  const art = glass ? undefined : getSkinHeaderLayout(theme, page, width, fontScale)
  const [copyHeight, setCopyHeight] = useState(0)
  // K-On's instrument group starts below its transparent text area. Reserve
  // additional space only when actual wrapped copy exceeds that safe area.
  const copySafeFraction = skin === 'k-on' ? page === 'coach' ? 414 / 1024 : page === 'home' ? 0.45 : undefined : undefined
  const artOffset = copySafeFraction === undefined || !art ? 0 : Math.max(0, copyHeight + 26 - art.top - art.height * copySafeFraction)
  const top = includeTopInset ? insets.top : 0
  const backgroundHeight = baseHeight + top + artOffset
  const spacious = ['night-run', 'woodland'].includes(skin) && page === 'coach'
  const inlineControl = page === 'home'
    || page === 'history' && ['night-run', 'k-on'].includes(skin)
  return <View pointerEvents="box-none" style={{ marginHorizontal: -theme.pagePaddingH, minHeight: backgroundHeight, paddingTop: top + 14,
    ...(art?.overlap ? { zIndex: 1 } : {}),
    paddingHorizontal: theme.pagePaddingH, paddingBottom: 14, position: 'relative' }}>
    {source && art ? <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top, left: 0, right: 0, height: baseHeight + artOffset, overflow: art.overlap ? 'visible' : 'hidden' }}>
      <SkinHeaderImage key={identity} identity={identity} source={source} resizeMode="contain" fadeDuration={0} accessible={false}
        style={{ position: 'absolute', left: art.left, top: art.top + artOffset,
          width: art.width, height: art.height, opacity: largeText && skin !== 'k-on' ? 0.25 : 1 }} />
    </View> : null}
    <View onLayout={event => setCopyHeight(event.nativeEvent.layout.height)}>
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 10 }}>
      {page === 'home' ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: inlineControl ? undefined : 1 }}>
        <BrandMark size={52} />
        <View style={{ flexDirection: ['k-on', 'woodland'].includes(skin) ? 'row' : 'column', alignItems: 'center', gap: ['k-on', 'woodland'].includes(skin) ? 10 : 0 }}><BrandWordmark color={theme.ink} />
          <Text style={{ color: theme.inkSoft, fontSize: 8, lineHeight: 12, fontWeight: '700', letterSpacing: 1 }}>STEPLOOP</Text></View>
      </View> : <Text accessibilityRole="header" style={{ ...typography.title, flex: inlineControl ? undefined : 1, color: theme.ink }}>{title}</Text>}
      {right}
    </View>
    {page === 'home' ? <>
      <Text accessibilityRole="header" style={{ ...typography.section, color: theme.ink,
        marginTop: skin === 'k-on' ? 12 : skin === 'woodland' ? 28 : 34, maxWidth: largeText ? '100%' : '85%' }}>每一步，都算数。</Text>
    </> : null}
    {spacious ? <View style={{ minHeight: Math.max(0, baseHeight - 90) }} /> : null}
    {children}
    </View>
  </View>
}
