import React from 'react'
import { Platform } from 'react-native'
import { Switch as UniversalSwitch } from '@expo/ui'
import { Switch as ComposeSwitch } from '@expo/ui/jetpack-compose'
import { semantics } from '@expo/ui/jetpack-compose/modifiers'
import { useTheme } from '../theme'

/** Native controls with the approved brand colors, rather than Material seed tints. */
export function ThemeSwitch({ value, disabled, onValueChange, label }: {
  value: boolean; disabled?: boolean; onValueChange: (value: boolean) => void; label: string
}) {
  const theme = useTheme()
  if (Platform.OS !== 'android') return <UniversalSwitch value={value} disabled={disabled} onValueChange={onValueChange} />
  return <ComposeSwitch value={value} enabled={!disabled} onCheckedChange={onValueChange} modifiers={[semantics({ contentDescription: label })]}
    colors={{ checkedTrackColor: theme.brand, checkedThumbColor: '#ffffff', checkedBorderColor: theme.brand,
      uncheckedTrackColor: theme.surfaceSoft, uncheckedThumbColor: theme.mutedStrong, uncheckedBorderColor: theme.line }} />
}
