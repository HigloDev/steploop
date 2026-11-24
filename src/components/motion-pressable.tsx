import React from 'react'
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'

const OUTER_LAYOUT_KEYS = new Set([
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical',
  'position', 'top', 'bottom', 'left', 'right', 'zIndex',
  'width', 'minWidth', 'maxWidth', 'opacity',
])

function splitPressableStyle(flat: ViewStyle | undefined): { outer: ViewStyle; inner: ViewStyle } {
  if (!flat) return { outer: {}, inner: {} }
  const outer: Record<string, unknown> = {}
  const inner: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(flat)) {
    if (value === undefined) continue
    if (OUTER_LAYOUT_KEYS.has(key)) outer[key] = value
    else inner[key] = value
  }
  if (outer.flex !== undefined || outer.flexGrow !== undefined || inner.height !== undefined) {
    inner.flexGrow = 1
  }
  return { outer: outer as ViewStyle, inner: inner as ViewStyle }
}

/**
 * 统一按压反馈：外层 Pressable 承接全量触区（含 padding），内层 Animated.View 承接可见表面
 * （背景、边框、阴影与内容），使整个按钮/卡片在 UI 线程整体缩放，避免“框不动、字缩水”。
 */
export function MotionPressable({
  children,
  style,
  contentStyle,
  pressedOpacity = 0.88,
  onPressIn,
  onPressOut,
  ...props
}: Omit<PressableProps, 'children'> & {
  children: React.ReactNode
  contentStyle?: StyleProp<ViewStyle>
  pressedOpacity?: number
}) {
  const reduced = useReducedMotion()
  const scale = useSharedValue(1)
  const opacity = useSharedValue(1)
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
    opacity: opacity.get(),
  }))

  const staticFlat = typeof style === 'function' ? undefined : StyleSheet.flatten(style)
  const { outer, inner } = splitPressableStyle(staticFlat)

  return (
    <Pressable
      {...props}
      style={state => {
        if (typeof style === 'function') {
          const resolved = StyleSheet.flatten(style(state))
          return splitPressableStyle(resolved).outer
        }
        return outer
      }}
      onPressIn={event => {
        if (!reduced) {
          scale.set(withTiming(0.97, { duration: 90, easing: Easing.out(Easing.cubic) }))
        }
        opacity.set(withTiming(pressedOpacity, { duration: 90, easing: Easing.out(Easing.cubic) }))
        onPressIn?.(event)
      }}
      onPressOut={event => {
        scale.set(reduced ? 1 : withTiming(1, { duration: 175, easing: Easing.out(Easing.cubic) }))
        opacity.set(reduced ? 1 : withTiming(1, { duration: 175, easing: Easing.out(Easing.cubic) }))
        onPressOut?.(event)
      }}
    >
      {state => {
        const dynamicInner = typeof style === 'function' ? splitPressableStyle(StyleSheet.flatten(style(state))).inner : inner
        return (
          <Animated.View pointerEvents="none" style={[contentStyle, dynamicInner, animated]}>
            {children}
          </Animated.View>
        )
      }}
    </Pressable>
  )
}
