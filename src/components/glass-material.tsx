// 冰川透蓝的玻璃材质层：柔和冰蓝渐变背景、一致的玻璃表面与浮动 Dock 内边距。
// 背景与表面都不接收触摸、不进入朗读顺序；真实虚化由 MainTabs 的 BlurView 承担，
// 本文件提供共享的渐变底图、玻璃表面样式与布局内边距。

import React, { useContext } from 'react'
import { StyleSheet, View, ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs'
import { isGlacier, Theme, useTheme } from '../theme'

export type GlassRole = 'card' | 'feature' | 'overlay'

/** 浮动 Dock 的内容高度、水平外边距与底边到系统安全区的间距。 */
export const GLASS_DOCK_CONTENT_HEIGHT = 64
export const GLASS_DOCK_H_MARGIN = 16
export const GLASS_DOCK_MARGIN = 30

const LIGHT_BACKDROP = require('../../assets/skins/glacier-glass/backdrop-light.webp')
const DARK_BACKDROP = require('../../assets/skins/glacier-glass/backdrop-dark.webp')

function withAlphaHex(hex: string, alpha: number): string {
  const [r, g, b] = hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * The bundled images preserve the palette and 360:780 framing of the former
 * gradients. A full-screen SVG on Android rasterizes again on reattachment.
 * The image decoder can reuse this much smaller, opaque surface across tabs.
 */
export function GlassBackdrop() {
  const theme = useTheme()
  if (!isGlacier(theme)) return null
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.paper }]}
    >
      <Image source={theme.isDark ? DARK_BACKDROP : LIGHT_BACKDROP} style={StyleSheet.absoluteFill}
        contentFit="cover" cachePolicy="memory" transition={0} accessible={false} />
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
  const isOverlay = role === 'overlay'
  const opacity = role === 'feature' ? glass.featureOpacity : isOverlay ? glass.overlayOpacity : glass.cardOpacity
  const level = role === 'feature' ? theme.elevation.level2 : isOverlay ? theme.elevation.level3 : theme.elevation.level2
  const borderRadius = isOverlay ? theme.radius.lg : theme.radius.md
  return {
    backgroundColor: withAlphaHex(glass.fill, opacity),
    borderRadius,
    borderWidth: level.borderWidth,
    borderColor: isOverlay ? glass.stroke : level.borderColor,
    borderTopColor: isOverlay ? glass.highlight : undefined,
    shadowColor: level.shadow.shadowColor,
    shadowOffset: level.shadow.shadowOffset,
    shadowOpacity: level.shadow.shadowOpacity,
    shadowRadius: level.shadow.shadowRadius,
    elevation: level.shadow.elevation,
  }
}

/**
 * 非 Tab 页也可安全调用：不在底部 Tab 内（没有 BottomTabBarHeightContext）时返回 0。
 * 冰川透蓝的底栏是绝对定位的浮动 Dock，内容会滚到其下方。页面已各自加上 insets.bottom，
 * 这里返回 Dock 内容高度（随大字号增长）加底边间距，保证最后一项能完整滚出。
 */
export function useGlassDockInset(): number {
  const theme = useTheme()
  const tabBarHeight = useContext(BottomTabBarHeightContext)
  if (!isGlacier(theme) || tabBarHeight == null) return 0
  return tabBarHeight + GLASS_DOCK_MARGIN
}
