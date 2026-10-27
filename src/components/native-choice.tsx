import React, { useState } from 'react'
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native'
import SegmentedControl from '@expo/ui/community/segmented-control'
import { sport, useTheme } from '../theme'
import { triggerHaptic } from '../services/preferences'

/** Visible single-choice controls with selection conveyed by contrast and semantics. */
export function NativeChoice<T extends string>({ options, value, onChange, disabled = false, testID }: {
  options: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void; disabled?: boolean; testID?: string
}) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const [availableWidth, setAvailableWidth] = useState(0)
  const [labelWidths, setLabelWidths] = useState<Record<string, number>>({})
  const measurementKey = (option: { value: T; label: string }) => `${fontScale}:${option.value}:${option.label}`
  const labelStyle = { fontSize: sport.type.body, lineHeight: 22, fontWeight: '600' as const, textAlign: 'center' as const }
  // Native text measurement includes the current Android font scaling. A
  // conservative initial estimate is replaced as soon as that measurement arrives.
  const widestLabel = Math.max(0, ...options.map(option => labelWidths[measurementKey(option)]
    ?? Array.from(option.label).reduce((width, char) => width + (char.charCodeAt(0) < 128 ? 0.65 : 1), 0) * sport.type.body * fontScale))
  const minimumWidth = Math.max(48, widestLabel + sport.space.sm * 2)
  const maxColumns = availableWidth ? Math.max(1, Math.floor((availableWidth - sport.space.xs * 2) / minimumWidth)) : Math.max(1, options.length)
  const rowCount = Math.max(1, Math.ceil(options.length / maxColumns))
  const columns = Math.max(1, Math.ceil(options.length / rowCount))
  const rows = Array.from({ length: Math.ceil(options.length / columns) }, (_, row) => options.slice(row * columns, row * columns + columns))
  if (Platform.OS !== 'android') return <SegmentedControl
    values={options.map(option => option.label)} selectedIndex={options.findIndex(option => option.value === value)}
    enabled={!disabled} appearance={theme.isDark ? 'dark' : 'light'} tintColor={theme.brandSoft}
    onChange={event => { void triggerHaptic('selection'); onChange(options[event.nativeEvent.selectedSegmentIndex].value) }}
    style={{ alignSelf: 'stretch', minHeight: 48 }} testID={testID} />
  return <View testID={testID} accessibilityRole="radiogroup"
    onLayout={event => {
      const width = event.nativeEvent.layout.width
      setAvailableWidth(current => Math.abs(current - width) < 0.5 ? current : width)
    }}
    style={{ alignSelf: 'stretch', gap: sport.space.xs, padding: sport.space.xs, borderRadius: sport.radius.control, backgroundColor: theme.cardSoft }}>
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', width: 10000, opacity: 0 }}>
      {options.map(option => <Text key={measurementKey(option)} accessible={false} numberOfLines={1} style={labelStyle}
        onTextLayout={event => {
          const width = Math.max(0, ...event.nativeEvent.lines.map(line => line.width))
          if (width) setLabelWidths(current => Math.abs((current[measurementKey(option)] ?? 0) - width) < 0.5
            ? current : { ...current, [measurementKey(option)]: width })
        }}>{option.label}</Text>)}
    </View>
    {rows.map((row, index) => <View key={index} style={{ flexDirection: 'row' }}>
      {row.map(option => {
        const selected = value === option.value
        return <Pressable key={option.value} disabled={disabled} accessibilityRole="radio"
          accessibilityLabel={option.label} accessibilityState={{ selected, checked: selected, disabled }}
          onPress={() => { if (!selected) { void triggerHaptic('selection'); onChange(option.value) } }}
          style={({ pressed }) => ({ flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: sport.space.sm, paddingVertical: sport.space.sm,
            borderRadius: sport.radius.small, alignItems: 'center', justifyContent: 'center',
            ...(selected && theme.brand !== theme.brandText ? { borderWidth: 1, borderColor: theme.brandText } : {}),
            backgroundColor: selected ? theme.brand : 'transparent', opacity: disabled ? 0.5 : pressed ? 0.75 : 1 })}>
          <Text style={[labelStyle, { color: selected ? theme.onBrand : theme.inkSoft }]}>{option.label}</Text>
        </Pressable>
      })}
    </View>)}
  </View>
}
