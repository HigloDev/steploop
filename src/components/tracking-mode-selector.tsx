import React from 'react'
import { Text, View } from 'react-native'
import { NativeChoice } from './native-choice'
import { TrackingMode } from '../core/types'
import { useTheme } from '../theme'

export const TRACKING_MODES: Array<{ value: TrackingMode; label: string; description: string }> = [
  { value: 'manual', label: '手动', description: '由你结束本轮、确认返回和开始下一轮。' },
  { value: 'automatic', label: '自动', description: '自动识别进度，在结束本轮、返回和下一轮时由你确认。' },
  { value: 'full_auto', label: '自动衔接', description: '尝试自动结束并接着记录；返回起点仍由你确认，拿不准的楼层留待确认。' },
]

export function TrackingModeSelector({ value, onChange, disabled = false, compact = false }: {
  value: TrackingMode; onChange: (mode: TrackingMode) => void; disabled?: boolean; compact?: boolean
}) {
  const theme = useTheme()
  return <View style={{ paddingVertical: compact ? 8 : 12, gap: 8 }}>
    <Text style={{ color: theme.ink, fontWeight: '600', fontSize: 15 }}>记录模式</Text>
    <NativeChoice testID="tracking-mode" options={TRACKING_MODES} value={value} onChange={onChange} disabled={disabled} />
    {!compact && <Text style={{ color: theme.mutedStrong, fontSize: 13, lineHeight: 20 }}>{TRACKING_MODES.find(mode => mode.value === value)?.description}</Text>}
  </View>
}
