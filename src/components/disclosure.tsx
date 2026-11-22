import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { UIIcon, resolveUIIconName } from './ui-icon'
import { isGlacier, useTheme } from '../theme'
import { getGlassSurfaceStyle } from './glass-material'

/** 与现有主题一致的展开区；只有展开后才挂载详细视图。 */
export function Disclosure({ title, summary, children, initiallyOpen = false, compact = false, dense = false, marginTop }: {
  title: string
  summary?: string
  children: React.ReactNode
  initiallyOpen?: boolean
  compact?: boolean
  dense?: boolean
  marginTop?: number
}) {
  const theme = useTheme()
  const glass = isGlacier(theme)
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <View style={[{ borderRadius: theme.radiusLg, paddingHorizontal: compact ? 0 : 16, marginTop: marginTop ?? (compact ? 0 : 12) },
      glass ? (compact ? { backgroundColor: 'transparent' } : getGlassSurfaceStyle(theme, 'card')) : { backgroundColor: theme.card }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={title}
        accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}
        style={({ pressed }) => ({ minHeight: compact || dense ? 48 : 64, paddingVertical: compact ? 8 : dense ? 12 : 16, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.7 : 1 })}>
        {title === '趋势与最佳成绩' ? <UIIcon name="chart" size={24} color={theme.inkSoft} /> : ['备份与导出', '帮助与关于', '修正最终楼层', '单层用时'].includes(title) ? <UIIcon
          name={resolveUIIconName(title === '备份与导出' ? 'database' : title === '修正最终楼层' ? 'stairs' : title === '单层用时' ? 'clock-outline' : 'help-circle')} size={24} color={theme.inkSoft} /> : null}
        <View style={{ flex: 1, flexDirection: compact ? 'row' : 'column', justifyContent: 'space-between', alignItems: compact ? 'center' : undefined, gap: compact ? 8 : 0 }}>
          <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '600' }}>{title}</Text>
          {summary ? <Text style={{ color: theme.mutedStrong, fontSize: 13, marginTop: compact ? 0 : 4, flexShrink: 1 }}>{summary}</Text> : null}
        </View>
        <UIIcon name={resolveUIIconName(open ? dense ? 'chevron-down' : 'chevron-up' : 'chevron-forward')} color={theme.mutedStrong} size={18} />
      </Pressable>
      {open ? <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.lineSoft, paddingTop: dense ? 0 : 8, paddingBottom: dense ? 8 : 16 }}>{children}</View> : null}
    </View>
  )
}
