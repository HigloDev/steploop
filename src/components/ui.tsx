// 通用 UI 组件：Button、Card、Field、Pill、Metric、EmptyState、Notice。
// 所有样式通过 useThemeStyles 弱缓存，避免每次渲染重建 StyleSheet。

import React from 'react'
import { UIIcon, resolveUIIconName } from './ui-icon'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
  StyleProp,
  PressableProps,
} from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'
import { getPrimaryActionPaint, typography, useTheme, useThemeStyles, Theme } from '../theme'
import { getGlassSurfaceStyle } from './glass-material'
import { MotionPressable } from './motion-pressable'
import { triggerHaptic } from '../services/preferences'

type Variant = 'primary' | 'secondary' | 'danger'

/** 统一系统「减少动态」钩子，直接代理 Reanimated 同步状态，避免首帧闪动。 */
export function useReduceMotion(): boolean {
  return useReducedMotion()
}

interface ButtonProps extends Omit<PressableProps, 'style'> {
  title: string
  variant?: Variant
  loading?: boolean
  disabled?: boolean
  fullWidth?: boolean
  style?: StyleProp<ViewStyle>
  labelStyle?: TextStyle
}

export function Button({
  title,
  variant = 'primary',
  loading = false,
  disabled = false,
  fullWidth = true,
  style,
  labelStyle,
  onPress,
  ...rest
}: ButtonProps) {
  const theme = useTheme()
  const styles = useThemeStyles(makeStyles)
  const action = getPrimaryActionPaint(theme)
  const variantStyle =
    variant === 'primary'
      ? [styles.primary, { backgroundColor: action.fill }, theme.elevation.level2.shadow]
      : variant === 'secondary'
        ? getGlassSurfaceStyle(theme, 'card')
        : styles.danger
  const isDisabled = disabled || loading

  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      accessibilityLabel={title}
      style={[
        styles.buttonBase,
        variantStyle,
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
      contentStyle={styles.buttonContent}
      disabled={isDisabled}
      {...rest}
      onPress={event => {
        void triggerHaptic(variant === 'danger' ? 'medium' : 'light')
        onPress?.(event)
      }}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? action.ink : theme.brandText} />
      ) : (
        <Text
          style={[
            styles.label,
            variant === 'primary' && { color: action.ink },
            variant === 'danger' && { color: theme.redInk },
            labelStyle,
          ]}
        >
          {title}
        </Text>
      )}
    </MotionPressable>
  )
}

interface CardProps {
  children: React.ReactNode
  raised?: boolean
  style?: StyleProp<ViewStyle>
}

export function Card({ children, raised = false, style }: CardProps) {
  const theme = useTheme()
  const styles = useThemeStyles(makeStyles)
  return (
    <View style={[styles.card, getGlassSurfaceStyle(theme, raised ? 'feature' : 'card'), raised && styles.cardRaised, style]}>
      {children}
    </View>
  )
}

interface RowProps {
  label: string
  value?: string | number
  children?: React.ReactNode
  style?: ViewStyle
}

export function Row({ label, value, children, style }: RowProps) {
  const styles = useThemeStyles(makeStyles)
  return (
    <View
      style={[styles.row, style]}
      accessible={children ? undefined : true}
      accessibilityLabel={children ? undefined : `${label}，${value}`}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      {children ?? <Text style={styles.value}>{value}</Text>}
    </View>
  )
}

interface FieldProps {
  label: string
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
  keyboardType?: 'default' | 'numeric' | 'number-pad' | 'decimal-pad'
  multiline?: boolean
  numberOfLines?: number
  style?: ViewStyle
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  multiline = false,
  numberOfLines,
  style,
}: FieldProps) {
  const theme = useTheme()
  const styles = useThemeStyles(makeStyles)
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        keyboardType={keyboardType}
        multiline={multiline}
        numberOfLines={multiline ? (numberOfLines ?? 3) : undefined}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  )
}

type PillTone = 'default' | 'good' | 'warn' | 'danger'

interface PillProps {
  children: React.ReactNode
  tone?: PillTone
  style?: ViewStyle
  accessibilityLabel?: string
}

export function Pill({
  children,
  tone = 'default',
  style,
  accessibilityLabel,
}: PillProps) {
  const styles = useThemeStyles(makeStyles)
  const toneContainer =
    tone === 'good'
      ? styles.pillGood
      : tone === 'warn'
        ? styles.pillWarn
        : tone === 'danger'
          ? styles.pillDanger
          : styles.pillDefault
  const toneText =
    tone === 'good'
      ? styles.pillGoodText
      : tone === 'warn'
        ? styles.pillWarnText
        : tone === 'danger'
          ? styles.pillDangerText
          : styles.pillDefaultText
  const label = accessibilityLabel ?? (typeof children === 'string' ? children : undefined)
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.pill, toneContainer, style]}
    >
      <Text style={[styles.pillText, toneText]}>{children}</Text>
    </View>
  )
}

interface MetricProps {
  label: string
  value: string | number
  hint?: string
  style?: ViewStyle
}

export function Metric({ label, value, hint, style }: MetricProps) {
  const styles = useThemeStyles(makeStyles)
  const spoken = hint ? `${label}，${value}，${hint}` : `${label}，${value}`
  return (
    <View accessible accessibilityLabel={spoken} style={[styles.metric, style]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      {hint ? <Text style={styles.metricHint}>{hint}</Text> : null}
    </View>
  )
}

interface EmptyStateProps {
  title: string
  subtitle?: string
  style?: ViewStyle
}

export function EmptyState({ title, subtitle, style }: EmptyStateProps) {
  const styles = useThemeStyles(makeStyles)
  return (
    <View style={[styles.empty, style]}>
      <Text accessibilityRole="header" style={styles.emptyTitle}>
        {title}
      </Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
    </View>
  )
}

export function Notice({ children, tone = 'warn' }: { children: React.ReactNode; tone?: 'warn' | 'danger' }) {
  const theme = useTheme()
  const styles = useThemeStyles(makeStyles)
  return (
    <View
      style={[styles.notice, tone === 'danger' && styles.noticeDanger]}
      accessible
      accessibilityRole={tone === 'danger' ? 'alert' : 'text'}
    >
      <UIIcon
        name={resolveUIIconName(tone === 'danger' ? 'alert-circle' : 'info')}
        size={18}
        color={tone === 'danger' ? theme.redInk : theme.amberInk}
        style={{ marginTop: 1 }}
      />
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    buttonBase: {
      minHeight: 54,
      borderRadius: theme.radius.md,
    },
    buttonContent: {
      minHeight: 54,
      paddingHorizontal: 20,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fullWidth: { alignSelf: 'stretch' },
    primary: {
      backgroundColor: theme.brand,
    },
    danger: {
      backgroundColor: theme.redChip,
    },
    label: {
      ...typography.control,
      color: theme.brandText,
    },
    disabled: {
      opacity: 0.42,
    },
    card: {
      backgroundColor: theme.card,
      padding: 18,
      borderRadius: theme.radius.md,
    },
    cardRaised: {
      padding: 16,
      borderRadius: theme.radius.md,
      marginBottom: 8,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 8,
    },
    rowLabel: {
      ...typography.secondary,
      color: theme.muted,
      flexShrink: 1,
    },
    value: {
      ...typography.digits,
      color: theme.ink,
      fontSize: 18,
      flexShrink: 1,
    },
    field: {
      marginBottom: 12,
    },
    fieldLabel: {
      ...typography.label,
      color: theme.muted,
      marginBottom: 8,
    },
    input: {
      borderWidth: 1,
      borderColor: theme.line,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.card,
      paddingHorizontal: 14,
      paddingVertical: 12,
      minHeight: 52,
      color: theme.ink,
      fontSize: typography.body.fontSize,
    },
    inputMultiline: {
      minHeight: 96,
      paddingTop: 12,
      paddingBottom: 12,
    },
    pill: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      alignSelf: 'flex-start',
    },
    pillDefault: { backgroundColor: theme.surfaceSoft },
    pillGood: { backgroundColor: theme.successSoft, borderWidth: 1, borderColor: theme.success },
    pillWarn: { backgroundColor: theme.amberChip },
    pillDanger: { backgroundColor: theme.redChip },
    pillText: {
      fontSize: theme.fontPill,
      fontWeight: '600',
    },
    pillDefaultText: { color: theme.mutedStrong },
    pillGoodText: { color: theme.success },
    pillWarnText: { color: theme.amberInk },
    pillDangerText: { color: theme.redInk },
    metric: {
      backgroundColor: theme.cardSoft,
      borderRadius: theme.radius.md,
      padding: 16,
    },
    metricLabel: {
      ...typography.secondary,
      color: theme.muted,
    },
    metricValue: {
      ...typography.digits,
      marginTop: 4,
      color: theme.ink,
      fontSize: theme.fontMetric,
    },
    metricHint: {
      marginTop: 4,
      color: theme.muted,
      ...typography.caption,
    },
    empty: {
      paddingVertical: 40,
      paddingHorizontal: 15,
      alignItems: 'center',
    },
    emptyTitle: {
      ...typography.section,
      color: theme.ink,
      textAlign: 'center',
    },
    emptySubtitle: {
      ...typography.secondary,
      marginTop: 8,
      color: theme.muted,
      textAlign: 'center',
    },
    notice: {
      marginVertical: 12,
      padding: 12,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      backgroundColor: theme.amberSoft,
      borderRadius: theme.radius.md,
    },
    noticeDanger: {
      backgroundColor: theme.redSoft,
    },
    noticeText: {
      flex: 1,
      color: theme.ink,
      fontSize: 13,
      lineHeight: 20,
    },
  })
