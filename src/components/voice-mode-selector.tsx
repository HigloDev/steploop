import React from 'react'
import { Text, View } from 'react-native'
import { NativeChoice } from './native-choice'
import type { VoiceModeChoice } from '../services/workout-voice-settings'
import { useTheme } from '../theme'

export const VOICE_MODES: Array<{ value: VoiceModeChoice; label: string; description: string }> = [
  { value: 'concise', label: '精简', description: '只播本轮完成、回到起点和训练结束。' },
  { value: 'standard', label: '标准', description: '关键状态加时间、卡路里反馈。' },
  { value: 'coach', label: '教练', description: '加入步数、楼层里程碑及温和休息提醒。' },
  { value: 'off', label: '关闭', description: '保留视觉提示，震动由运动反馈设置控制。' },
]

export function VoiceModeSelector({ value, onChange, compact = false, disabled = false }: {
  value: VoiceModeChoice; onChange: (value: VoiceModeChoice) => void; compact?: boolean; disabled?: boolean
}) {
  const theme = useTheme()
  return <View style={{ paddingVertical: compact ? 8 : 12, gap: 8 }}>
    <Text style={{ color: theme.ink, fontWeight: '600', fontSize: 15 }}>播报模式</Text>
    <NativeChoice testID="voice-detail-mode" options={VOICE_MODES} value={value} onChange={onChange} disabled={disabled} />
    {!compact && <Text style={{ color: theme.mutedStrong, fontSize: 13, lineHeight: 20 }}>{VOICE_MODES.find(mode => mode.value === value)?.description}</Text>}
  </View>
}
