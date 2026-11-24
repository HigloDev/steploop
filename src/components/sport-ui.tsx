import React from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { UIIcon, resolveUIIconName } from './ui-icon'
import { MotionPressable } from './motion-pressable'
import { getPrimaryActionPaint, sport, typography, useTheme } from '../theme'
import { triggerHaptic } from '../services/preferences'

export function SportButton({
  title,
  onPress,
  secondary = false,
  disabled = false,
  loading = false,
  icon,
  style,
  accessibilityLabel,
}: {
  title: string
  onPress: () => void
  secondary?: boolean
  disabled?: boolean
  loading?: boolean
  icon?: string
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
}) {
  const theme = useTheme()
  const action = getPrimaryActionPaint(theme)
  const color = secondary ? theme.brandInk : action.ink
  const isDisabled = disabled || loading

  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      contentStyle={styles.buttonContent}
      onPress={() => {
        void triggerHaptic('light')
        onPress()
      }}
      style={[
        styles.button,
        {
          backgroundColor: secondary ? theme.brandSoft : action.fill,
          opacity: isDisabled ? sport.opacity.disabled : 1,
        },
        !secondary && theme.elevation.level2.shadow,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <>
          {icon ? <UIIcon name={resolveUIIconName(icon)} size={22} color={color} accessible={false} /> : null}
          <Text style={{ ...typography.control, color, flexShrink: 1 }}>{title}</Text>
        </>
      )}
    </MotionPressable>
  )
}

export function SectionHeading({
  title,
  action,
  onPress,
  compact = false,
}: {
  title: string
  action?: string
  onPress?: () => void
  compact?: boolean
}) {
  const theme = useTheme()
  return (
    <View style={[styles.sectionHeading, compact && { marginTop: 8 }]}>
      <Text accessibilityRole="header" style={{ ...typography.section, color: theme.ink, flex: 1 }}>
        {title}
      </Text>
      {action && onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action}
          onPress={onPress}
          style={({ pressed }) => [styles.textAction, pressed && { opacity: sport.opacity.pressed }]}
        >
          <Text style={{ color: theme.brandInk, fontSize: sport.type.secondary, fontWeight: '500' }}>{action}</Text>
          <UIIcon name="arrow-right" size={16} color={theme.brandInk} accessible={false} />
        </Pressable>
      ) : null}
    </View>
  )
}

export function StatPair({
  value,
  label,
  unit = '',
  inverted = false,
  large = false,
}: {
  value: string
  label: string
  unit?: string
  inverted?: boolean
  large?: boolean
}) {
  const theme = useTheme()
  return (
    <View style={{ flex: 1, gap: sport.space.xs }} accessible accessibilityLabel={`${label} ${value}${unit}`}>
      <View style={styles.statValueRow}>
        <Text
          style={{
            ...typography.digits,
            color: inverted ? theme.heroInk : theme.ink,
            fontSize: large ? 32 : 24,
            lineHeight: large ? 38 : 30,
            flexShrink: 1,
          }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {value}
        </Text>
        {unit ? (
          <Text style={{ color: inverted ? theme.heroMuted : theme.mutedStrong, fontSize: large ? 14 : sport.type.caption }}>
            {unit}
          </Text>
        ) : null}
      </View>
      <Text style={{ color: inverted ? theme.heroMuted : theme.mutedStrong, fontSize: large ? 14 : sport.type.caption }}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  button: {
    minHeight: sport.control,
    borderRadius: sport.radius.control,
  },
  buttonContent: {
    minHeight: sport.control,
    paddingHorizontal: sport.space.lg,
    paddingVertical: sport.space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sport.space.sm,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sport.space.sm,
    marginTop: sport.space.page,
    marginBottom: sport.space.xs,
  },
  textAction: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: sport.space.xs,
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    flexWrap: 'wrap',
  },
})
