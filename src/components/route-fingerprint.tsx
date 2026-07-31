import React from 'react'
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg'

import { RouteTemplate } from '../core/types'
import { Theme, useTheme } from '../theme'

function buildRoutePath(route: RouteTemplate): string {
  const floorCount = Math.max(
    4,
    Math.min(12, route.segments.length || route.endFloor - route.startFloor),
  )
  let x = 32
  let y = 156
  const commands = [`M ${x} ${y}`]
  for (let index = 0; index < floorCount; index += 1) {
    const direction =
      route.markers[index]?.direction ??
      (index % 2 === 0 ? 'left' : 'right')
    y -= 11
    x += direction === 'left' ? 18 : -18
    commands.push(`L ${x} ${y}`)
    y -= 11
    commands.push(`L ${x} ${y}`)
  }
  return commands.join(' ')
}

export function RouteFingerprint({
  route,
  theme: suppliedTheme,
  height = 176,
}: {
  route: RouteTemplate
  theme?: Theme
  height?: number
}) {
  const currentTheme = useTheme()
  const theme = suppliedTheme ?? currentTheme
  const path = buildRoutePath(route)

  return (
    <Svg width="100%" height={height} viewBox="0 0 320 176">
      <Defs>
        <LinearGradient id="routeGlow" x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor={theme.green} stopOpacity={0.25} />
          <Stop offset="0.55" stopColor={theme.mint} stopOpacity={0.95} />
          <Stop offset="1" stopColor={theme.greenBright} stopOpacity={0.2} />
        </LinearGradient>
      </Defs>
      <Path
        d={path}
        fill="none"
        stroke={theme.line}
        strokeWidth={12}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d={path}
        fill="none"
        stroke="url(#routeGlow)"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={32} cy={156} r={7} fill={theme.green} />
      <Circle cx={32} cy={156} r={3} fill={theme.card} />
    </Svg>
  )
}

