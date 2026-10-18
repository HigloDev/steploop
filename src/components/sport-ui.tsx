import React from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { sport, useTheme } from '../theme'

export function SportButton({ title, onPress, secondary = false, disabled = false, loading = false, icon, style, accessibilityLabel }: {
  title: string; onPress: () => void; secondary?: boolean; disabled?: boolean; loading?: boolean;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap; style?: StyleProp<ViewStyle>; accessibilityLabel?: string
}) {
  const theme = useTheme()
  const color = secondary ? theme.brandInk : theme.onBrand
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title}
    accessibilityState={{ disabled: disabled || loading, busy: loading }} disabled={disabled || loading}
    onPress={onPress} style={({ pressed }) => [styles.button, { backgroundColor: secondary ? theme.brandSoft : theme.brand,
      opacity: disabled ? sport.opacity.disabled : pressed ? sport.opacity.pressed : 1 }, style]}>
    {loading ? <ActivityIndicator color={color} /> : <>
      {icon ? <MaterialCommunityIcons name={icon} size={22} color={color} accessible={false} /> : null}
      <Text style={{ color, fontSize: sport.type.label, fontWeight: '700', flexShrink: 1 }}>{title}</Text>
    </>}
  </Pressable>
}

export function SectionHeading({ title, action, onPress }: { title: string; action?: string; onPress?: () => void }) {
  const theme = useTheme()
  return <View style={styles.sectionHeading}>
    <Text accessibilityRole="header" style={{ color: theme.ink, fontSize: sport.type.heading, fontWeight: '700', flex: 1 }}>{title}</Text>
    {action && onPress ? <Pressable accessibilityRole="button" accessibilityLabel={action} onPress={onPress} style={({ pressed }) => [styles.textAction, pressed && { opacity: sport.opacity.pressed }]}>
      <Text style={{ color: theme.brandInk, fontSize: sport.type.secondary, fontWeight: '500' }}>{action}</Text>
      <MaterialCommunityIcons name="arrow-right" size={16} color={theme.brandInk} accessible={false} />
    </Pressable> : null}
  </View>
}

export function StatPair({ value, label, unit = '', inverted = false }: { value: string; label: string; unit?: string; inverted?: boolean }) {
  const theme = useTheme()
  return <View style={{ flex: 1, gap: sport.space.xs }} accessible accessibilityLabel={`${label} ${value}${unit}`}>
    <Text style={{ ...theme.numeric, color: inverted ? theme.heroInk : theme.ink, fontSize: sport.type.heading }} numberOfLines={1} adjustsFontSizeToFit>
      {value}{unit ? <Text style={{ fontSize: sport.type.caption, fontWeight: '400', letterSpacing: 0 }}> {unit}</Text> : null}
    </Text>
    <Text style={{ color: inverted ? theme.heroMuted : theme.muted, fontSize: sport.type.caption }}>{label}</Text>
  </View>
}

const styles = StyleSheet.create({
  button: { minHeight: sport.control, borderRadius: sport.radius.control, paddingHorizontal: sport.space.lg, paddingVertical: sport.space.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sport.space.sm },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: sport.space.sm, marginTop: sport.space.page, marginBottom: sport.space.xs },
  textAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: sport.space.xs },
})
