// 楼栋缩略图：简笔画小楼体（与 BuildingSketch 同一视觉语言的迷你版），楼层越多楼越高。
import React, { memo } from 'react'
import Svg, { Path, Rect } from 'react-native-svg'
import { useTheme } from '../theme'

export const BuildingThumb = memo(function BuildingThumb({ floors, size = 64, highlight }: {
  floors: number
  size?: number
  /** 高亮到第几层（可选，用于展示上次成绩）。 */
  highlight?: number
}) {
  const theme = useTheme()
  const rows = Math.max(2, Math.min(18, Math.round(floors)))
  const width = size * 0.62
  const left = (size - width) / 2
  const top = size * 0.14
  const bodyH = size - top - 4
  const rowH = bodyH / rows
  const lit = Math.max(0, Math.min(rows, Math.round(((highlight ?? floors) / Math.max(1, floors)) * rows)))
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d={`M ${left - 3} ${top} L ${size / 2} ${top - size * 0.1} L ${left + width + 3} ${top} Z`} fill={theme.brandInk} />
      <Rect x={left} y={top} width={width} height={bodyH} rx={3} fill={theme.brandSoft} stroke={theme.brandTint} strokeWidth={1} />
      {Array.from({ length: rows }, (_, index) => {
        const y = top + bodyH - (index + 1) * rowH
        const on = index < lit
        return (
          <Rect key={index} x={left + 4} y={y + rowH * 0.22} width={width - 8} height={Math.max(1.5, rowH * 0.56)} rx={1.5}
            fill={on ? theme.brand : theme.surfaceSoft} />
        )
      })}
      <Rect x={size / 2 - 4} y={size - 4 - Math.min(10, rowH * 1.4)} width={8} height={Math.min(10, rowH * 1.4)} fill={theme.brandInk} />
    </Svg>
  )
})
