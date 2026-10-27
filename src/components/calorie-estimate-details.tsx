import React from 'react'
import { Linking, Text, View } from 'react-native'
import { CALORIE_MET_SOURCE, STAIR_PACE_OPTIONS, WorkoutCalorieEstimate } from '../core/segmented-calories'
import { formatDuration } from '../core/math'
import { useTheme } from '../theme'

export function CalorieEstimateDetails({ estimate }: { estimate: WorkoutCalorieEstimate }) {
  const theme = useTheme()
  const text = { color: theme.mutedStrong, fontSize: 13, lineHeight: 21 }
  return <View testID="calorie-estimate-details" style={{ gap: 8 }}>
    <Text style={text}>{estimate.weightSource === 'default_65kg' ? '未保存体重，使用默认体重' : '训练时采用的体重'}：{estimate.bodyWeightKg} 千克。</Text>
    {estimate.metric !== 'active' ? <Text style={text}>
      这条历史记录保留原有热量口径，沿用 1.1.5 的爬升高度、活动时间与轮间休息估算，未改算为分段 MET 活动热量。
    </Text> : <>
      <Text style={text}>按净上楼片段分别估算，并扣除 1 MET 的标准静息消耗；不含返回、休息、传感器缺段和额外恢复耗能。</Text>
      <Text style={text}>慢速 4.5 MET · 一般 6.8 MET · 快速 9.3 MET。档位由你选择，不是个人代谢实测。</Text>
      {(estimate.assumedGeneralDurationMs ?? 0) > 0 ? <Text style={text}>其中 {formatDuration(estimate.assumedGeneralDurationMs!)} 未选择速度，按一般速度估算。</Text> : null}
      {(estimate.assumedActivityDurationMs ?? 0) > 0 ? <Text style={text}>其中 {formatDuration(estimate.assumedActivityDurationMs!)} 活动类型未明确，按上爬阶段的运动估算。</Text> : null}
      {(estimate.excludedMotionDurationMs ?? 0) > 0 ? <Text style={text}>已排除 {formatDuration(estimate.excludedMotionDurationMs!)} 明确识别为平地、下楼、等待或电梯的片段。</Text> : null}
      {(estimate.unestimatedMotionDurationMs ?? 0) > 0 ? <Text style={text}>另有 {formatDuration(estimate.unestimatedMotionDurationMs!)} 运动时长缺少分段依据，未计入热量估算。</Text> : null}
      {estimate.segments.map((segment, index) => <Text key={index} style={text}>
        第 {segment.roundNumber} 轮 · {segment.activity === 'stairs_up'
          ? `${STAIR_PACE_OPTIONS.find(option => option.value === segment.pace)?.label ?? '一般'}${segment.paceSource === 'default' ? '（默认）' : ''}`
          : ({ walking: '平地步行', stairs_down: '下楼', elevator: '电梯', waiting: '等待' })[segment.activity]} · {formatDuration(segment.durationMs)} · {segment.activity === 'stairs_up' ? `${segment.met} MET` : '不计入爬楼热量'}
      </Text>)}
      <Text accessibilityRole="link" style={{ ...text, color: theme.brand, textDecorationLine: 'underline', paddingVertical: 8 }}
        onPress={() => { void Linking.openURL(CALORIE_MET_SOURCE).catch(() => undefined) }}>参考：2024 身体活动汇编</Text>
    </>}
  </View>
}
