// 通用 UI 组件：Button、Card、Field、Pill、Metric、EmptyState 等。
// 把原 .button-primary/.card/.field/.pill/.metric 等 wxss 类映射为 RN 组件。

import React from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
  PressableProps,
} from 'react-native'
import { useTheme, Theme } from '../theme'

type Variant = 'primary' | 'secondary' | 'danger'

interface ButtonProps extends Omit<PressableProps, 'style'> {
  title: string
  variant?: Variant
  loading?: boolean
  disabled?: boolean
  fullWidth?: boolean
  style?: ViewStyle
}

export function Button({
  title,
  variant = 'primary',
  loading = false,
  disabled = false,
  fullWidth = true,
  style,
  ...rest
}: ButtonProps) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  const variantStyle =
    variant === 'primary'
      ? styles.primary
      : variant === 'secondary'
        ? styles.secondary
        : styles.danger
  return (
    <Pressable
      style={({ pressed }) => [
        styles.buttonBase,
        variantStyle,
        fullWidth && styles.fullWidth,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? theme.card : theme.green} />
      ) : (
        <Text style={[styles.label, variant === 'primary' && styles.labelOnPrimary]}>{title}</Text>
      )}
    </Pressable>
  )
}

interface CardProps {
  children: React.ReactNode
  raised?: boolean
  style?: ViewStyle
}

export function Card({ children, raised = false, style }: CardProps) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  return (
    <View style={[styles.card, raised && styles.cardRaised, style]}>{children}</View>
  )
}

interface RowProps {
  label: string
  value?: string | number
  children?: React.ReactNode
  style?: ViewStyle
}

export function Row({ label, value, children, style }: RowProps) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  return (
    <View style={[styles.row, style]}>
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
  style?: ViewStyle
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  style,
}: FieldProps) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        keyboardType={keyboardType}
      />
    </View>
  )
}

type PillTone = 'default' | 'good' | 'warn' | 'danger'

interface PillProps {
  children: React.ReactNode
  tone?: PillTone
  style?: ViewStyle
}

export function Pill({ children, tone = 'default', style }: PillProps) {
  const theme = useTheme()
  const styles = makeStyles(theme)
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
  return (
    <View style={[styles.pill, toneContainer, style]}>
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
  const theme = useTheme()
  const styles = makeStyles(theme)
  return (
    <View style={[styles.metric, style]}>
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
  const theme = useTheme()
  const styles = makeStyles(theme)
  return (
    <View style={[styles.empty, style]}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
    </View>
  )
}

export function Notice({ children, tone = 'warn' }: { children: React.ReactNode; tone?: 'warn' | 'danger' }) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  return (
    <View style={[styles.notice, tone === 'danger' && styles.noticeDanger]}>
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    buttonBase: {
      minHeight: 48,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 9,
    },
    fullWidth: { alignSelf: 'stretch' },
    primary: {
      backgroundColor: theme.green,
      shadowColor: theme.green,
      shadowOpacity: 0.18,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 11,
      elevation: 2,
    },
    secondary: {
      backgroundColor: theme.greenSoft,
    },
    danger: {
      backgroundColor: theme.redChip,
    },
    label: {
      color: theme.green,
      fontSize: 15,
      fontWeight: '700',
    },
    labelOnPrimary: {
      color: theme.card,
    },
    pressed: {
      transform: [{ scale: 0.97 }],
      opacity: 0.9,
    },
    disabled: {
      opacity: 0.4,
    },
    card: {
      backgroundColor: theme.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
      paddingHorizontal: 0,
      paddingVertical: 14,
    },
    cardRaised: {
      paddingHorizontal: 14,
      paddingVertical: 14,
      borderRadius: theme.radiusLg,
      marginBottom: 8,
      ...theme.shadowCard,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 9,
      paddingVertical: 6,
    },
    rowLabel: {
      color: theme.muted,
      fontSize: 13,
    },
    value: {
      color: theme.ink,
      fontSize: 17,
      fontWeight: '700',
    },
    field: {
      marginBottom: 12,
    },
    fieldLabel: {
      color: theme.muted,
      fontSize: 12,
      marginBottom: 5,
    },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      borderRadius: theme.radiusSm,
      backgroundColor: theme.card,
      paddingHorizontal: 11,
      height: 43,
      color: theme.ink,
      fontSize: 15,
    },
    pill: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      alignSelf: 'flex-start',
    },
    pillDefault: { backgroundColor: theme.surfaceSoft },
    pillGood: { backgroundColor: theme.greenSoft },
    pillWarn: { backgroundColor: theme.amberChip },
    pillDanger: { backgroundColor: theme.redChip },
    pillText: {
      fontSize: 11,
      fontWeight: '600',
    },
    pillDefaultText: { color: theme.muted },
    pillGoodText: { color: theme.green },
    pillWarnText: { color: theme.amber },
    pillDangerText: { color: theme.red },
    metric: {
      backgroundColor: theme.cardSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      borderRadius: theme.radiusMd,
      padding: 12,
      ...theme.shadowSoft,
    },
    metricLabel: {
      color: theme.muted,
      fontSize: 12,
    },
    metricValue: {
      marginTop: 4,
      color: theme.ink,
      fontSize: 23,
      fontWeight: '800',
    },
    metricHint: {
      marginTop: 4,
      color: theme.muted,
      fontSize: 11,
    },
    empty: {
      paddingVertical: 40,
      paddingHorizontal: 15,
      alignItems: 'center',
    },
    emptyTitle: {
      color: theme.muted,
      fontSize: 15,
      fontWeight: '600',
      textAlign: 'center',
    },
    emptySubtitle: {
      marginTop: 4,
      color: theme.muted,
      fontSize: 12,
      textAlign: 'center',
    },
    notice: {
      marginVertical: 10,
      padding: 11,
      borderLeftWidth: 3,
      borderLeftColor: theme.amber,
      backgroundColor: theme.amberSoft,
      borderRadius: 4,
    },
    noticeDanger: {
      borderLeftColor: theme.red,
      backgroundColor: theme.redSoft,
    },
    noticeText: {
      color: theme.amberInk,
      fontSize: 13,
      lineHeight: 20,
    },
  })
