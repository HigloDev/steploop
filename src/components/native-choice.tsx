import React from 'react'
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native'
import SegmentedControl from '@expo/ui/community/segmented-control'
import { useTheme } from '../theme'
import { triggerHaptic } from '../services/preferences'

/** Visible single-choice controls with selection conveyed by contrast and semantics. */
export function NativeChoice<T extends string>({ options, value, onChange, disabled = false, testID }: {
  options: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void; disabled?: boolean; testID?: string
}) {
  const theme = useTheme()
  const { fontScale, width } = useWindowDimensions()
  const needsRows = fontScale >= 1.25 || width < 360
  const columns = needsRows && options.length >= 4 ? 2
    : needsRows && options.length === 3 && options.some(option => option.label.length >= 3) ? 1
    : options.length
  const rows = Array.from({ length: Math.ceil(options.length / columns) }, (_, row) => options.slice(row * columns, row * columns + columns))
  if (Platform.OS !== 'android') return <SegmentedControl
    values={options.map(option => option.label)} selectedIndex={options.findIndex(option => option.value === value)}
    enabled={!disabled} appearance={theme.isDark ? 'dark' : 'light'} tintColor={theme.brandSoft}
    onChange={event => { void triggerHaptic('selection'); onChange(options[event.nativeEvent.selectedSegmentIndex].value) }}
    style={{ alignSelf: 'stretch', minHeight: 48 }} testID={testID} />
  return <View testID={testID} style={{ alignSelf: 'stretch', gap: 8 }}>
    {rows.map((row, index) => <View key={index} accessibilityRole="radiogroup"
      style={{ flexDirection: 'row', padding: 3, borderRadius: 16, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.cardSoft }}>
      {row.map(option => {
        const selected = value === option.value
        return <Pressable key={option.value} disabled={disabled} accessibilityRole="radio"
          accessibilityLabel={option.label} accessibilityState={{ selected, checked: selected, disabled }}
          onPress={() => { if (!selected) { void triggerHaptic('selection'); onChange(option.value) } }}
          style={({ pressed }) => ({ flex: 1, minHeight: 48, paddingHorizontal: 4, paddingVertical: 6,
            borderRadius: 12, alignItems: 'center', justifyContent: 'center',
            backgroundColor: selected ? theme.brand : 'transparent', opacity: disabled ? 0.5 : pressed ? 0.75 : 1 })}>
          <Text style={{ color: selected ? theme.onBrand : theme.inkSoft, fontSize: 16, lineHeight: 20,
            fontWeight: selected ? '800' : '500', textAlign: 'center' }}>{option.label}</Text>
        </Pressable>
      })}
    </View>)}
  </View>
}
