import React, { useState } from 'react'
import { Image, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BrandMark } from './brand-mark'
import { getSkinHeaderArtwork } from '../skin-assets'
import { getSkinHeaderLayout, getSkinPageHeight, getThemeSkinId, isLargeText, SkinPage, useTheme } from '../theme'

/** A real text/control layer over page-specific art, never a screenshot of controls. */
export function SkinPageHeader({ page, title, subtitle, right, children, includeTopInset = true }: {
  page: SkinPage; title?: string; subtitle?: string; right?: React.ReactNode
  children?: React.ReactNode; includeTopInset?: boolean
}) {
  const theme = useTheme(), skin = getThemeSkinId(theme), { width, fontScale } = useWindowDimensions(), insets = useSafeAreaInsets()
  const mode = theme.isDark ? 'dark' : 'light'
  const source = getSkinHeaderArtwork(skin, page, mode)
  const identity = `${skin}/${mode}/${page}`
  const [failed, setFailed] = useState<string>()
  const baseHeight = getSkinPageHeight(theme, page, width)
  const largeText = isLargeText(fontScale)
  const art = getSkinHeaderLayout(theme, page, width, fontScale)
  const top = includeTopInset ? insets.top : 0
  const backgroundHeight = baseHeight + top
  const spacious = ['night-run', 'woodland'].includes(skin) && page === 'coach'
  return <View pointerEvents="box-none" style={{ marginHorizontal: -theme.pagePaddingH, minHeight: backgroundHeight, paddingTop: top + 14,
    ...(art.overlap ? { zIndex: 1 } : {}),
    paddingHorizontal: theme.pagePaddingH, paddingBottom: 14, position: 'relative' }}>
    {source && failed !== identity ? <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top, left: 0, right: 0, height: baseHeight, overflow: art.overlap ? 'visible' : 'hidden' }}>
      <Image key={identity} source={source} resizeMode="contain" fadeDuration={0} accessible={false} onError={() => setFailed(identity)}
        style={{ position: 'absolute', left: art.left, top: art.top,
          width: art.width, height: art.height, opacity: largeText ? 0.25 : 1 }} />
    </View> : null}
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 10 }}>
      {page === 'home' ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
        <BrandMark size={52} />
        <View style={{ flexDirection: ['k-on', 'woodland'].includes(skin) ? 'row' : 'column', alignItems: 'center', gap: ['k-on', 'woodland'].includes(skin) ? 10 : 0 }}><Text style={{ color: theme.ink, fontSize: 26, lineHeight: 30, fontWeight: '800' }}>循阶</Text>
          <Text style={{ color: theme.inkSoft, fontSize: 8, lineHeight: 12, fontWeight: '700', letterSpacing: 1 }}>STEPLOOP</Text></View>
      </View> : <Text accessibilityRole="header" style={{ flex: 1, color: theme.ink, fontSize: 28, lineHeight: 36, fontWeight: '800' }}>{title}</Text>}
      {right}
    </View>
    {page === 'home' ? <>
      <Text accessibilityRole="header" style={{ color: theme.ink, fontSize: skin === 'k-on' ? 28 : 24, lineHeight: skin === 'k-on' ? 36 : 32, fontWeight: '800',
        marginTop: skin === 'k-on' ? 12 : skin === 'woodland' ? 28 : 34, maxWidth: largeText ? '100%' : '85%' }}>每一步，都算数。</Text>
      <Text style={{ color: theme.mutedStrong, fontSize: skin === 'k-on' || largeText ? 15 : 12, lineHeight: skin === 'k-on' || largeText ? 23 : 20, marginTop: 6, maxWidth: largeText ? '100%' : '85%' }}>从熟悉的楼梯，开始今天的向上。</Text>
    </> : subtitle ? <Text style={{ color: theme.mutedStrong, fontSize: 16, lineHeight: 24, marginTop: 6,
      maxWidth: largeText ? '100%' : '80%' }}>{subtitle}</Text> : null}
    {spacious ? <View style={{ minHeight: baseHeight - 70 }} /> : null}
    {children}
  </View>
}
