import React, { memo, useEffect, useRef } from 'react'
import { Animated, Easing, Image, Text, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { BuildingFloor } from './BuildingSketch'
import { useReduceMotion } from './ui'
import { useTheme } from '../theme'

const FLOOR_IMAGE = require('../../assets/staircase/floor-unit.png')

interface Props {
  floors: BuildingFloor[]
  width?: number
  climbing?: boolean
  reveal?: boolean
  labels?: boolean
}

const StairLayer = memo(function StairLayer({ floor, index, count, width, climbing, reveal, labels, reduced }: {
  floor: BuildingFloor; index: number; count: number; width: number
  climbing: boolean; reveal: boolean; labels: boolean; reduced: boolean
}) {
  const theme = useTheme()
  const active = floor.status === 'current'
  const opacity = useRef(new Animated.Value(reveal && !reduced ? 0 : 1)).current
  const cursor = useRef(new Animated.Value(0)).current
  const stepHeight = width * 0.26

  useEffect(() => {
    opacity.stopAnimation()
    if (reduced) { opacity.setValue(1); return }
    const animation = Animated.timing(opacity, {
      toValue: 1, duration: reveal ? 260 : 200,
      delay: reveal ? (count - 1 - index) * 140 : 0,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [opacity, index, count, reveal, reduced])

  useEffect(() => {
    cursor.setValue(0)
    if (!active || !climbing || reduced) return
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(cursor, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(cursor, { toValue: 0, duration: 850, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]))
    animation.start()
    return () => animation.stop()
  }, [active, climbing, reduced, cursor])

  const visibility = floor.status === 'pending' ? (theme.isDark ? 0.25 : 0.32) : 1
  return (
    <Animated.View style={{ height: stepHeight, zIndex: count - index, opacity, transform: [{ translateY: opacity.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 0 : 9, 0] }) }] }}>
      {labels ? <Text allowFontScaling={false} style={{ position: 'absolute', top: stepHeight * 0.13, left: 0, fontSize: 12, fontWeight: active ? '700' : '400', color: active ? theme.amberInk : theme.mutedStrong }}>{floor.floor}F</Text> : null}
      <Image source={FLOOR_IMAGE} resizeMode="contain" accessible={false} style={{ width: width - (labels ? 24 : 0), height: (width - (labels ? 24 : 0)) / 2.5, marginLeft: labels ? 24 : 0, opacity: visibility, transform: [{ scaleX: floor.floor % 2 === 0 ? -1 : 1 }] }} />
      {active ? <Animated.View style={{ position: 'absolute', right: floor.floor % 2 === 0 ? width * 0.55 : width * 0.07, top: -4, borderRadius: 12, padding: 3, backgroundColor: theme.amberSoft, transform: [{ translateY: cursor.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }] }}><MaterialCommunityIcons name="walk" size={18} color={theme.amberInk} /></Animated.View> : null}
    </Animated.View>
  )
})

/** Decorative diagram of the supplied state; it never advances the recognition state. */
export const StaircaseScene = memo(function StaircaseScene({ floors, width = 190, climbing = false, reveal = false, labels = true }: Props) {
  const reduced = useReduceMotion()
  const visibleFloors = floors.slice(-6).reverse()
  return (
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width, paddingTop: 12, paddingBottom: width * 0.13 }}>
      {visibleFloors.map((floor, index) => <StairLayer key={floor.floor} floor={floor} index={index} count={visibleFloors.length} width={width} climbing={climbing} reveal={reveal} labels={labels} reduced={reduced} />)}
    </View>
  )
})

export function achievementFloors(total: number): BuildingFloor[] {
  return Array.from({ length: Math.min(6, Math.max(0, Math.floor(total))) }, (_, i) => ({ floor: i + 1, status: 'completed', turnSegments: 0 }))
}
