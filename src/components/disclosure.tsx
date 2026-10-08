import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../theme'

/** 与现有主题一致的展开区；只有展开后才挂载详细视图。 */
export function Disclosure({ title, summary, children, initiallyOpen = false }: {
  title: string
  summary?: string
  children: React.ReactNode
  initiallyOpen?: boolean
}) {
  const theme = useTheme()
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <View style={{ backgroundColor: theme.card, borderRadius: theme.radiusLg, paddingHorizontal: 16, marginTop: 16 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={title}
        accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}
        style={({ pressed }) => ({ minHeight: 64, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.7 : 1 })}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.ink, fontSize: 17, fontWeight: '600' }}>{title}</Text>
          {summary ? <Text style={{ color: theme.mutedStrong, fontSize: 13, marginTop: 4 }}>{summary}</Text> : null}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} color={theme.mutedStrong} size={18} />
      </Pressable>
      {open ? <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.lineSoft, paddingTop: 8, paddingBottom: 16 }}>{children}</View> : null}
    </View>
  )
}
