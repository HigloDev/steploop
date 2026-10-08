import React from 'react'
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native'
import SegmentedControl from '@expo/ui/community/segmented-control'
import { useTheme } from '../theme'

/** Visible single-choice controls with selection conveyed by contrast and semantics. */
export function NativeChoice<T extends string>({ options, value, onChange, disabled = false, testID }: {
  options: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void; disabled?: boolean; testID?: string
}) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const columns = fontScale >= 1.3 && options.length >= 4 ? 2
    : fontScale >= 1.3 && options.length === 3 && options.some(option => option.label.length >= 3) ? 1
    : options.length
  const rows = Array.from({ length: Math.ceil(options.length / columns) }, (_, row) => options.slice(row * columns, row * columns + columns))
  if (Platform.OS !== 'android') return <SegmentedControl
    values={options.map(option => option.label)} selectedIndex={options.findIndex(option => option.value === value)}
    enabled={!disabled} appearance={theme.isDark ? 'dark' : 'light'} tintColor={theme.greenSoft}
    onChange={event => onChange(options[event.nativeEvent.selectedSegmentIndex].value)}
    style={{ alignSelf: 'stretch', minHeight: 48 }} testID={testID} />
  return <View testID={testID} style={{ alignSelf: 'stretch', gap: 8 }}>
    {rows.map((row, index) => <View key={index} accessibilityRole="radiogroup" style={{ flexDirection: 'row', alignSelf: 'stretch' }}>
      {row.map((option, position) => {
        const selected = value === option.value
        // SDK57's Compose SegmentedButton does not expose its default check icon.
        return <Pressable key={option.value} disabled={disabled} accessibilityRole="radio"
          accessibilityLabel={option.label} accessibilityState={{ selected, checked: selected, disabled }}
          onPress={() => onChange(option.value)}
          style={{ flex: 1, minHeight: 48, paddingHorizontal: 8, paddingVertical: 10, alignItems: 'center', justifyContent: 'center',
            marginLeft: position > 0 ? -1 : 0, borderWidth: 1, borderColor: selected ? theme.green : theme.line,
            zIndex: selected ? 1 : 0, backgroundColor: selected ? theme.greenSoft : theme.card, opacity: disabled ? 0.5 : 1,
            borderTopLeftRadius: position === 0 ? 24 : 0, borderBottomLeftRadius: position === 0 ? 24 : 0,
            borderTopRightRadius: position === row.length - 1 ? 24 : 0, borderBottomRightRadius: position === row.length - 1 ? 24 : 0 }}>
          <Text style={{ color: selected ? theme.greenInk : theme.inkSoft, fontSize: 14, lineHeight: 20,
            fontWeight: selected ? '600' : '400', textAlign: 'center' }}>{option.label}</Text>
        </Pressable>
      })}
    </View>)}
  </View>
}
