import React from 'react'
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'

export function MotionPressable({ children, contentStyle, onPressIn, onPressOut, ...props }: Omit<PressableProps, 'children'> & {
  children: React.ReactNode
  contentStyle?: StyleProp<ViewStyle>
}) {
  const reduced = useReducedMotion()
  const scale = useSharedValue(1)
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }))
  return (
    <Pressable
      {...props}
      onPressIn={event => {
        if (!reduced) scale.set(withTiming(.96, { duration: 90, easing: Easing.out(Easing.cubic) }))
        onPressIn?.(event)
      }}
      onPressOut={event => {
        scale.set(reduced ? 1 : withTiming(1, { duration: 175, easing: Easing.out(Easing.cubic) }))
        onPressOut?.(event)
      }}
    >
      <Animated.View pointerEvents="none" style={[contentStyle, animated]}>
        {children}
      </Animated.View>
    </Pressable>
  )
}
