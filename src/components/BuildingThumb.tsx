import React, { memo } from 'react'
import { Image } from 'react-native'
import Svg, { Path, Rect, Line } from 'react-native-svg'
import { buildingVisualLevel } from '../core/building-visual'
import { useTheme } from '../theme'

/** 保留楼栋模板的原稿图形；训练记录使用同色、同线条的层数变体。 */
export const BuildingThumb = memo(function BuildingThumb({ floors, size = 48, dynamic = false }: {
  floors: number; size?: number; highlight?: number; dynamic?: boolean
}) {
  const theme = useTheme()
  if (dynamic) {
    const level = buildingVisualLevel(floors)
    const rows = [1, 2, 3, 4, 5, 6, 6][level]
    const top = [31, 26, 21, 11, 9, 7, 7][level]
    const left = level === 6 ? 20 : 10
    const right = 38
    const rowWidth = right - left - 10
    const pitch = (42 - top) / (rows + 1)
    return <Svg width={size} height={size} viewBox="0 0 48 48" accessible={false}
      style={{ flexShrink: 0 }} fill="none" stroke={theme.brand} strokeWidth={2.8} strokeLinejoin="round">
      {level < 3 ? <Path d={`M${left} ${top} L24 ${top - 9} L${right} ${top} V44 H${left} Z`} />
        : <Rect x={left} y={top} width={right - left} height={44 - top} rx={1} />}
      {level >= 4 ? <Path d={`M${left + 6} ${top} V${top - 4} H${right - 6} V${top}`} /> : null}
      {level >= 5 ? <Line x1={level === 6 ? 29 : 24} y1={top - 4} x2={level === 6 ? 29 : 24} y2={1} /> : null}
      {Array.from({ length: rows }, (_, i) => <Line key={i} x1={left + 5} x2={left + 5 + rowWidth}
        y1={top + (i + 1) * pitch} y2={top + (i + 1) * pitch} />)}
      {level === 6 ? <>
        <Path d="M8 44 V23 H17 V44" />
        <Line x1={11} x2={14} y1={29} y2={29} /><Line x1={11} x2={14} y1={35} y2={35} />
      </> : null}
    </Svg>
  }
  return <Image source={require('../../assets/icons/building.png')} resizeMode="contain" fadeDuration={0}
    accessible={false} style={{ width: size, height: size, tintColor: theme.brand, flexShrink: 0 }} />
})
