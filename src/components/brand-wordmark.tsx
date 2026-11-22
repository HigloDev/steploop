import React from 'react'
import Svg, { Path } from 'react-native-svg'

/** Two original letterforms with the same rounded corners as the stair mark. */
export function BrandWordmark({ color, size = 27 }: { color: string; size?: number }) {
  return <Svg width={size * 2.04} height={size} viewBox="0 0 57 28" accessible accessibilityRole="image"
    accessibilityLabel="循阶" fill="none" stroke={color} strokeWidth={2.05} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M8.8 4.8a18 18 0 0 1-4.6 4.1m4.9 1.2a22 22 0 0 1-5 4.7m2.7-2.1v10.9m5-15.8 12.7-2.5m-12.7 2.5v7.7c0 3.1-.7 5.7-2 7.7m3.8-12.3h11m-5.8-4v6.9m-4.4.1h9.2v9.7h-9.2Zm.1 3.2h9m-9 3.2h9" />
    <Path d="M32.2 23.6V5.4h6l-2.5 5.7c2.3 2.2 3 4.3 1.5 5.8-.6.6-1.7.8-3.6.6m6.5-5.4a25 25 0 0 0 7.4-7.3 25 25 0 0 0 7 7.1m-9.8.9v3.6c0 3.3-1 5.2-3.2 7.2m9-10.9v10.9" />
  </Svg>
}
