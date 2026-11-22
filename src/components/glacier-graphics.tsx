// 冰川透蓝的结算徽章。
import React from 'react'
import { View } from 'react-native'
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg'
import { useTheme } from '../theme'

function badgePalette(isDark: boolean) {
  return isDark
    ? { faceA: '#223A5E', faceB: '#4E7FC6', stroke: '#8EBBFF', inner: '#A9CDFF', stair: '#DFEBFF', ribbon: '#7FA8E8' }
    : { faceA: '#F3F8FF', faceB: '#A9CCFF', stroke: '#245CD8', inner: '#2A63DC', stair: '#1D4EB9', ribbon: '#5E86D6' }
}

/** 结算页蓝色多面阶梯徽章：主面淡白蓝渐变、描边内层、中央阶梯与尾带。 */
export function GlacierAchievementBadge({ size = 96 }: { size?: number }) {
  const theme = useTheme()
  const colors = badgePalette(theme.isDark)
  return (
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size * 116 / 120 }}>
      <Svg width="100%" height="100%" viewBox="0 0 120 116">
        <Defs>
          <LinearGradient id="glacierBadgeFace" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.faceA} />
            <Stop offset="1" stopColor={colors.faceB} />
          </LinearGradient>
        </Defs>
        {/* 尾带 */}
        <Path d="M42 74 L37 102 L51 97 L56 108 L66 82 M78 73 L85 101 L71 96 L66 108 L57 82"
          fill="none" stroke={colors.ribbon} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {/* 主面 */}
        <Path d="M60 4 L94 22 L99 60 L75 89 L44 89 L21 60 L26 22 Z"
          fill="url(#glacierBadgeFace)" stroke={colors.stroke} strokeWidth={2} strokeLinejoin="round" />
        {/* 描边内层 */}
        <Path d="M60 13 L87 28 L91 59 L72 81 L48 81 L29 58 L33 28 Z"
          fill="none" stroke={colors.inner} strokeWidth={1.5} strokeLinejoin="round" />
        {/* 中央阶梯 */}
        <Path d="M41 62 h11 v-11 h11 V40 h11 V30 h6"
          fill="none" stroke={colors.stair} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  )
}
