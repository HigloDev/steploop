import React from 'react'
import { Text, View } from 'react-native'
import { NativeChoice } from './native-choice'
import { normalizeStairPace, STAIR_PACE_OPTIONS, StairPace } from '../core/segmented-calories'
import { useTheme } from '../theme'

export function StairPaceSelector({ value, onChange, disabled = false }: {
  value?: StairPace; onChange: (pace: StairPace) => void; disabled?: boolean
}) {
  const theme = useTheme()
  return <View style={{ gap: 10, paddingVertical: 12 }}>
    <Text accessibilityRole="header" style={{ color: theme.ink, fontSize: 15, fontWeight: '600' }}>爬楼速度 · 用于热量估算</Text>
    <NativeChoice options={STAIR_PACE_OPTIONS} value={normalizeStairPace(value)} onChange={onChange}
      disabled={disabled} testID="stair-calorie-pace" />
    <Text style={{ color: theme.mutedStrong, fontSize: 13, lineHeight: 20 }}>
      {value === undefined ? '未选择时暂按一般速度估算。' : ''}按实际速度选择，训练中调整只影响之后记录的上楼片段。快速档对应每次一级台阶。
    </Text>
  </View>
}
