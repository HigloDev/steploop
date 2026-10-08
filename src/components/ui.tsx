// 通用 UI 组件：Button、Card、Field、Pill、Metric、EmptyState 等。
// 把原 .button-primary/.card/.field/.pill/.metric 等 wxss 类映射为 RN 组件。

import React, { useEffect, useState } from 'react'
import { Feather } from '@expo/vector-icons'
import {
  AccessibilityInfo,
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

/**
 * D10：系统「减少动画」开关。
 *
 * 关键交互（庆祝动效、传感器波形）在开启后必须降级：不做无意义的持续动画/重绘。
 * 组件库导出这一个 hook，避免各页面各写一份监听。
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    let mounted = true
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled)
      })
      .catch(() => undefined)
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => setReduceMotion(enabled),
    )
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  return reduceMotion
}

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
      // D10 预备：读屏需要明确的角色与状态；标题文本会作为可读名称。
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      // 可读名称来自可见文本（title）；loading 时文本被菊花替换，这里兜底，
      // 调用方传入的 accessibilityLabel 仍可覆盖（见 {...rest}）。
      accessibilityLabel={title}
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
        <ActivityIndicator color={variant === 'primary' ? theme.onPrimary : theme.green} />
      ) : (
        <Text style={[styles.label, variant === 'primary' && styles.labelOnPrimary, variant === 'danger' && { color: theme.redInk }]}>{title}</Text>
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
        // D10：输入框有独立可读名称，读屏聚焦时才知道要填什么（标签是同级 Text，不会自动关联）。
        accessibilityLabel={label}
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
  /** 缺省时用可见文本作为可读名称；不要传英文标识符。 */
  accessibilityLabel?: string
}

export function Pill({
  children,
  tone = 'default',
  style,
  accessibilityLabel,
}: PillProps) {
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
  // D10：状态标签要让读屏读成一句完整的话，名称来自可见文本。
  const label =
    accessibilityLabel ?? (typeof children === 'string' ? children : undefined)
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
  const theme = useTheme()
  const styles = makeStyles(theme)
  // D10：数值卡片合并成一个读屏节点，「累计爬升 126.0米」而不是两个孤立文本。
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
  const theme = useTheme()
  const styles = makeStyles(theme)
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
  const styles = makeStyles(theme)
  return (
    <View
      style={[styles.notice, tone === 'danger' && styles.noticeDanger]}
      accessible
      accessibilityRole={tone === 'danger' ? 'alert' : 'text'}
    >
      <Feather name={tone === 'danger' ? 'alert-circle' : 'info'} size={18} color={tone === 'danger' ? theme.redInk : theme.amberInk} style={{ marginTop: 1 }} />
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    buttonBase: {
      minHeight: 56,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: theme.radiusMd,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 8,
    },
    fullWidth: { alignSelf: 'stretch' },
    primary: {
      backgroundColor: theme.green,

    },
    secondary: {
      backgroundColor: theme.greenSoft,
    },
    danger: {
      backgroundColor: theme.redChip,
    },
    label: {
      color: theme.green,
      fontSize: 16,
      fontWeight: '700',
    },
    labelOnPrimary: {
      color: theme.onPrimary,
    },
    pressed: {
      transform: [{ scale: 0.985 }],
      opacity: 0.9,
    },
    disabled: {
      opacity: 0.4,
    },
    card: {
      backgroundColor: theme.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
      padding: 16,
    },
    cardRaised: {
      padding: 16,
      borderRadius: theme.radiusLg,
      marginBottom: 8,
      borderBottomWidth: 0,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 8,
    },
    rowLabel: {
      color: theme.muted,
      fontSize: 14,
      flexShrink: 1,
    },
    value: {
      color: theme.ink,
      fontSize: 17,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
      flexShrink: 1,
    },
    field: {
      marginBottom: 12,
    },
    fieldLabel: {
      color: theme.muted,
      fontSize: 14,
      marginBottom: 8,
    },
    input: {
      borderWidth: 1,
      borderColor: theme.line,
      borderRadius: theme.radiusSm,
      backgroundColor: theme.card,
      paddingHorizontal: 14,
      paddingVertical: 12,
      // D10 大字体：用 minHeight 而不是固定 height，系统字体放大到 1.5x 时文字不被裁切。
      minHeight: 52,
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
    pillGood: { backgroundColor: theme.successSoft },
    pillWarn: { backgroundColor: theme.amberChip },
    pillDanger: { backgroundColor: theme.redChip },
    pillText: {
      fontSize: theme.fontPill,
      fontWeight: '600',
    },
    pillDefaultText: { color: theme.muted },
    pillGoodText: { color: theme.success },
    pillWarnText: { color: theme.amberInk },
    pillDangerText: { color: theme.redInk },
    metric: {
      backgroundColor: theme.cardSoft,
      borderRadius: theme.radiusMd,
      padding: 16,

    },
    metricLabel: {
      color: theme.muted,
      fontSize: 13,
    },
    metricValue: {
      marginTop: 4,
      color: theme.ink,
      fontSize: theme.fontMetric,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    metricHint: {
      marginTop: 4,
      color: theme.muted,
      fontSize: 12,
      lineHeight: 18,
    },
    empty: {
      paddingVertical: 40,
      paddingHorizontal: 15,
      alignItems: 'center',
    },
    emptyTitle: {
      color: theme.ink,
      fontSize: 20,
      fontWeight: '600',
      textAlign: 'center',
    },
    emptySubtitle: {
      marginTop: 8,
      color: theme.muted,
      fontSize: 14,
      lineHeight: 21,
      textAlign: 'center',
    },
    notice: {
      marginVertical: 12,
      padding: 12,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      backgroundColor: theme.amberSoft,
      borderRadius: theme.radiusMd,
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
