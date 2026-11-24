import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { UIIcon, type UIIconName } from './ui-icon'
import { useTheme } from '../theme'
import { getGlassSurfaceStyle } from './glass-material'

/** 与玻璃主题一致的展开区；支持非受控与受控模式，只有展开后才挂载详细视图。 */
export function Disclosure({
  title,
  summary,
  icon,
  children,
  initiallyOpen = false,
  open: controlledOpen,
  onToggle,
  compact = false,
  dense = false,
  marginTop,
}: {
  title: string
  summary?: string
  icon?: UIIconName
  children: React.ReactNode
  initiallyOpen?: boolean
  open?: boolean
  onToggle?: (next: boolean) => void
  compact?: boolean
  dense?: boolean
  marginTop?: number
}) {
  const theme = useTheme()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(initiallyOpen)
  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen

  const toggle = () => {
    const next = !isOpen
    if (!isControlled) setUncontrolledOpen(next)
    onToggle?.(next)
  }

  return (
    <View
      style={[
        {
          borderRadius: theme.radius.md,
          paddingHorizontal: compact ? 0 : 16,
          marginTop: marginTop ?? (compact ? 0 : 12),
        },
        compact ? { backgroundColor: 'transparent' } : getGlassSurfaceStyle(theme, 'card'),
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: isOpen }}
        onPress={toggle}
        style={({ pressed }) => ({
          minHeight: compact || dense ? 48 : 64,
          paddingVertical: compact ? 8 : dense ? 12 : 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        {icon ? <UIIcon name={icon} size={22} color={theme.inkSoft} /> : null}
        <View
          style={{
            flex: 1,
            flexDirection: compact ? 'row' : 'column',
            justifyContent: 'space-between',
            alignItems: compact ? 'center' : undefined,
            gap: compact ? 8 : 0,
          }}
        >
          <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '600' }}>{title}</Text>
          {summary ? (
            <Text style={{ color: theme.mutedStrong, fontSize: 13, marginTop: compact ? 0 : 4, flexShrink: 1 }}>
              {summary}
            </Text>
          ) : null}
        </View>
        <UIIcon
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          color={theme.mutedStrong}
          size={18}
        />
      </Pressable>
      {isOpen ? (
        <View
          style={{
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.lineSoft,
            paddingTop: dense ? 0 : 8,
            paddingBottom: dense ? 8 : 16,
          }}
        >
          {children}
        </View>
      ) : null}
    </View>
  )
}
