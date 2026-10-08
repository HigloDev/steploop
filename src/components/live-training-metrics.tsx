import React from 'react'
import { Text, View, useWindowDimensions } from 'react-native'
import { formatDuration } from '../core/math'
import { formatCalories } from '../core/calories'
import { deriveLiveWorkoutMetrics } from '../core/live-workout-metrics'
import { useTheme } from '../theme'

export function LiveTrainingMetrics({ metrics }: { metrics: ReturnType<typeof deriveLiveWorkoutMetrics> }) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const items = [
    { label: '本轮爬楼时间', value: formatDuration(metrics.currentRoundActiveMs) },
    { label: '训练总时间', value: formatDuration(metrics.totalMs) },
    { label: '累计爬楼时间', value: formatDuration(metrics.activeMs) },
    { label: '休息 / 电梯合计', value: formatDuration(metrics.nonClimbingMs) },
    { label: '估算消耗', value: formatCalories(metrics.calories), unit: '千卡', color: theme.energy },
    { label: '累计步数', value: String(metrics.steps), unit: '步' },
    { label: '累计爬升', value: String(metrics.floors), unit: '层' },
    { label: '平均配速', value: metrics.floorsPerMinute.toFixed(1), unit: '层/分' },
  ]
  return <View testID="live-training-metrics" style={{ backgroundColor: theme.card, borderRadius: theme.radiusLg, paddingHorizontal: 16, paddingVertical: 4, flexDirection: 'row', flexWrap: 'wrap' }}>
    {metrics.floors > metrics.confirmedFloors ? <Text style={{ width: '100%', color: theme.mutedStrong, paddingTop: 12 }}>已确认 {metrics.confirmedFloors} 层；本轮增加的楼层还是估计值。</Text> : null}
    {items.map(({ label, value, unit, color }, index) => <View key={label} accessible accessibilityLabel={`${label} ${value} ${unit ?? ''}`} style={{ width: fontScale > 1.4 ? '100%' : '50%', minHeight: 76, paddingVertical: 12, paddingRight: index % 2 === 0 ? 8 : 0 }}>
      <Text style={{ color: theme.mutedStrong, fontSize: 12, lineHeight: 18 }}>{label}</Text>
      <Text style={{ color: color ?? theme.ink, fontSize: 25, fontWeight: '600', fontVariant: ['tabular-nums'], marginTop: 4 }}>{value}{unit ? <Text style={{ fontSize: 12, fontWeight: '400' }}> {unit}</Text> : null}</Text>
    </View>)}
  </View>
}
