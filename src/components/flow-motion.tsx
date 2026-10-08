import React, { useEffect } from 'react'
import { StyleProp, ViewStyle } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useReduceMotion } from './ui'

/** Only animates a meaningful step change, without moving surrounding controls. */
export function FlowReveal({ children, changeKey, style }: { children: React.ReactNode; changeKey: string | number; style?: StyleProp<ViewStyle> }) {
  const reduced = useReduceMotion()
  const progress = useSharedValue(1)
  useEffect(() => {
    progress.set(reduced ? 1 : 0)
    progress.set(withTiming(1, { duration: reduced ? 0 : 220, easing: Easing.bezier(0.23, 1, 0.32, 1) }))
  }, [changeKey, reduced, progress])
  const animated = useAnimatedStyle(() => ({ opacity: progress.get(), transform: [{ translateY: (1 - progress.get()) * 8 }] }))
  return <Animated.View style={[style, animated]}>{children}</Animated.View>
}
