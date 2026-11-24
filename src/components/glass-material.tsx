// 玻璃材质层：按当前配色提供柔和渐变底图、玻璃表面样式、顶栏样式与浮动 Dock 内边距。
// 背景与表面不接收触摸、不进入朗读顺序；真实虚化由 MainTabs 的 BlurView 承担。

import React, { useContext } from 'react'
import { StyleSheet, View, ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs'
import { getThemeBackdrop } from '../skin-assets'
import { getThemeSkinId, isMotionRing, Theme, useTheme } from '../theme'

export type GlassRole = 'card' | 'feature' | 'overlay'

/** 浮动 Dock 的内容高度、水平外边距与底边到系统安全区的间距。 */
export const GLASS_DOCK_CONTENT_HEIGHT = 64
export const GLASS_DOCK_H_MARGIN = 16
export const GLASS_DOCK_MARGIN = 12

function withAlphaHex(hex: string, alpha: number): string {
  const [r, g, b] = hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function GlassBackdrop() {
  const theme = useTheme()
  const skinId = getThemeSkinId(theme)
  const source = getThemeBackdrop(skinId, theme.isDark ? 'dark' : 'light')
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.paper }]}
    >
      <Image
        source={source}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory"
        transition={0}
        accessible={false}
      />
    </View>
  )
}

/**
 * 玻璃表面：一致的边线、填色与阴影，默认 card。
 * - card：普通玻璃，保留背景色透出的层次。
 * - feature：重要数据表面，提高不透明度以稳定对比度。
 * - overlay：浮层，使用细描边、顶部高光和分层阴影。
 */
export function getGlassSurfaceStyle(theme: Theme, role: GlassRole = 'card'): ViewStyle {
  const glass = theme.glass
  const motionRing = isMotionRing(theme)
  const isOverlay = role === 'overlay'
  const opacity = role === 'feature' ? glass.featureOpacity : isOverlay ? glass.overlayOpacity : glass.cardOpacity
  const level = role === 'feature' ? theme.elevation.level2 : isOverlay ? theme.elevation.level3 : theme.elevation.level2
  const borderRadius = isOverlay ? theme.radius.lg : theme.radius.md
  return {
    backgroundColor: withAlphaHex(glass.fill, opacity),
    borderRadius,
    borderWidth: level.borderWidth,
    borderColor: isOverlay || motionRing ? glass.stroke : level.borderColor,
    borderTopColor: isOverlay || motionRing ? glass.highlight : undefined,
    shadowColor: level.shadow.shadowColor,
    shadowOffset: level.shadow.shadowOffset,
    shadowOpacity: level.shadow.shadowOpacity,
    shadowRadius: level.shadow.shadowRadius,
    elevation: level.shadow.elevation,
  }
}

/** 全宽顶部导航栏玻璃样式：平直贴顶、无圆角盒边，仅在底边保留细分隔线。 */
export function getGlassHeaderStyle(theme: Theme): ViewStyle {
  const motionRing = isMotionRing(theme)
  return {
    backgroundColor: withAlphaHex(theme.glass.fill, theme.isDark ? (motionRing ? 0.78 : 0.72) : (motionRing ? 0.72 : 0.62)),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: motionRing ? theme.glass.stroke : theme.lineSoft,
  }
}

/**
 * 非 Tab 页也可安全调用：不在底部 Tab 内时返回 0。
 * 返回浮动 Dock 内容高度 + 底部外边距，确保滚动列表最后一项可完整滚出。
 */
export function useGlassDockInset(): number {
  const tabBarHeight = useContext(BottomTabBarHeightContext)
  if (tabBarHeight == null) return 0
  return tabBarHeight + GLASS_DOCK_MARGIN
}
