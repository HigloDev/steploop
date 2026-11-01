import React, { useState } from 'react'
import { Text, useWindowDimensions, View } from 'react-native'
import { SkinHeaderImage } from './skin-header-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BrandMark } from './brand-mark'
import { getSkinHeaderArtwork } from '../skin-assets'
import { getSkinHeaderLayout, getSkinPageHeight, getThemeSkinId, isLargeText, skinTypography, SkinPage, useTheme } from '../theme'

/** A real text/control layer over page-specific art, never a screenshot of controls. */
export function SkinPageHeader({ page, title, subtitle, right, children, includeTopInset = true }: {
  page: SkinPage; title?: string; subtitle?: string; right?: React.ReactNode
  children?: React.ReactNode; includeTopInset?: boolean
}) {
  const theme = useTheme(), skin = getThemeSkinId(theme), { width, fontScale } = useWindowDimensions(), insets = useSafeAreaInsets()
  const mode = theme.isDark ? 'dark' : 'light'
  const source = getSkinHeaderArtwork(skin, page, mode)
  const identity = `${skin}/${mode}/${page}`
  const baseHeight = getSkinPageHeight(theme, page, width)
  const largeText = isLargeText(fontScale)
  const art = getSkinHeaderLayout(theme, page, width, fontScale)
  const [copyHeight, setCopyHeight] = useState(0)
  // K-On's instrument group starts below its transparent text area. Reserve
  // additional space only when actual wrapped copy exceeds that safe area.
  const copySafeFraction = skin === 'k-on' ? page === 'coach' ? 414 / 1024 : page === 'home' ? 0.45 : undefined : undefined
  const artOffset = copySafeFraction === undefined ? 0 : Math.max(0, copyHeight + 26 - art.top - art.height * copySafeFraction)
  const top = includeTopInset ? insets.top : 0
  const backgroundHeight = baseHeight + top + artOffset
  const spacious = ['night-run', 'woodland'].includes(skin) && page === 'coach'
  const inlineControl = page === 'home'
    || page === 'history' && ['night-run', 'k-on'].includes(skin)
  // Keep copy inside the original left-hand negative space, including at 125%.
  const homeCopyWidth = ['woodland', 'night-run'].includes(skin) ? '52%' : '62%'
  return <View pointerEvents="box-none" style={{ marginHorizontal: -theme.pagePaddingH, minHeight: backgroundHeight, paddingTop: top + 14,
    ...(art.overlap ? { zIndex: 1 } : {}),
    paddingHorizontal: theme.pagePaddingH, paddingBottom: 14, position: 'relative' }}>
    {source ? <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top, left: 0, right: 0, height: baseHeight + artOffset, overflow: art.overlap ? 'visible' : 'hidden' }}>
      <SkinHeaderImage key={identity} identity={identity} source={source} resizeMode="contain" fadeDuration={0} accessible={false}
        style={{ position: 'absolute', left: art.left, top: art.top + artOffset,
          width: art.width, height: art.height, opacity: largeText && skin !== 'k-on' ? 0.25 : 1 }} />
    </View> : null}
    <View onLayout={event => setCopyHeight(event.nativeEvent.layout.height)}>
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 10 }}>
      {page === 'home' ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: inlineControl ? undefined : 1 }}>
        <BrandMark size={52} />
        <View style={{ flexDirection: ['k-on', 'woodland'].includes(skin) ? 'row' : 'column', alignItems: 'center', gap: ['k-on', 'woodland'].includes(skin) ? 10 : 0 }}><Text style={{ color: theme.ink, fontSize: 26, lineHeight: 30, fontWeight: '800' }}>循阶</Text>
          <Text style={{ color: theme.inkSoft, fontSize: 8, lineHeight: 12, fontWeight: '700', letterSpacing: 1 }}>STEPLOOP</Text></View>
      </View> : <Text accessibilityRole="header" style={{ flex: inlineControl ? undefined : 1, color: theme.ink, fontSize: 28, lineHeight: 36, fontWeight: '800' }}>{title}</Text>}
      {right}
    </View>
    {page === 'home' ? <>
      <Text accessibilityRole="header" style={{ color: theme.ink, fontSize: 24, lineHeight: 32, fontWeight: '800',
        marginTop: skin === 'k-on' ? 12 : skin === 'woodland' ? 28 : 34, maxWidth: largeText ? '100%' : '85%' }}>每一步，都算数。</Text>
      <Text style={{ color: theme.mutedStrong, ...skinTypography.secondary, marginTop: 6, maxWidth: largeText ? '100%' : homeCopyWidth }}>{'从熟悉的楼梯，\n开始今天的向上。'}</Text>
    </> : subtitle ? <Text style={{ color: theme.mutedStrong, ...skinTypography.body, marginTop: 8,
      maxWidth: largeText ? '100%' : '62%' }}>{subtitle}</Text> : null}
    {spacious ? <View style={{ minHeight: Math.max(0, baseHeight - 90) }} /> : null}
    {children}
    </View>
  </View>
}
