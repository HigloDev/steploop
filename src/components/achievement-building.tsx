import React from 'react'
import { View } from 'react-native'
import Animated, { cubicBezier } from 'react-native-reanimated'
import { useTheme } from '../theme'

/** 建楼只绘制代表性的 3–10 层；实际成绩单独标出，不虚构楼层数。 */
export function AchievementBuilding({ floors, width = 188, animate = false, reducedMotion = false, colors }: {
  floors: number; width?: number; animate?: boolean; reducedMotion?: boolean
  colors?: Pick<ReturnType<typeof useTheme>, 'ink' | 'brand' | 'brandSoft' | 'card' | 'line'>
}) {
  const resolved = useTheme()
  const theme = colors ?? resolved
  const rows = Math.min(10, Math.max(3, Math.ceil(Math.sqrt(Math.max(0, floors)))))
  const scale = width / 188
  const rowHeight = 19 * scale
  const ink = theme.ink
  const motion = (index: number) => animate && !reducedMotion ? {
    animationName: { '0%': { opacity: 0, transform: [{ translateY: -14 }] }, '100%': { opacity: 1, transform: [{ translateY: 0 }] } },
    animationDuration: 280,
    animationDelay: 160 + index * 110,
    animationFillMode: 'both' as const,
    animationTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
  } : {}
  return <View accessible accessibilityRole="image" accessibilityLabel={`代表本次 ${floors} 层成绩的楼栋`} style={{ width, height: (rows * 19 + 68) * scale, alignItems: 'center', justifyContent: 'flex-end' }}>
    <Animated.View style={[{ width: 42 * scale, height: 9 * scale, borderWidth: 2 * scale, borderColor: ink, backgroundColor: theme.brand, marginBottom: -2 * scale }, motion(rows + 1)]} />
    <Animated.View style={[{ width: 148 * scale, height: 10 * scale, borderWidth: 2 * scale, borderColor: ink, backgroundColor: theme.brand, marginBottom: -2 * scale }, motion(rows)]} />
    {Array.from({ length: rows }, (_, index) => <Animated.View key={index}
      style={[{ width: 134 * scale, height: rowHeight, borderWidth: 2 * scale, borderColor: ink, borderTopWidth: 0, backgroundColor: theme.card,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' }, motion(rows - index - 1)]}>
      {Array.from({ length: 5 }, (_, col) => <View key={col} style={{ width: 12 * scale, height: 8 * scale,
        borderWidth: 1 * scale, borderColor: ink, backgroundColor: (index + col) % 3 === 0 ? theme.brand : theme.brandSoft }} />)}
    </Animated.View>)}
    <View style={{ width: 134 * scale, height: 26 * scale, borderWidth: 2 * scale, borderColor: ink, borderTopWidth: 0, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'flex-end' }}>
      <View style={{ width: 24 * scale, height: 22 * scale, borderWidth: 2 * scale, borderColor: ink, borderBottomWidth: 0, backgroundColor: theme.brand }} />
    </View>
    <View style={{ width: 178 * scale, height: 2 * scale, backgroundColor: ink }} />
    <View style={{ width: 156 * scale, height: 5 * scale, backgroundColor: theme.line, marginTop: 4 * scale, borderRadius: 10 * scale }} />
  </View>
}
