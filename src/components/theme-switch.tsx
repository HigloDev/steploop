import React from 'react'
import { Platform } from 'react-native'
import { Switch as UniversalSwitch } from '@expo/ui'
import { Switch as ComposeSwitch } from '@expo/ui/jetpack-compose'
import { semantics } from '@expo/ui/jetpack-compose/modifiers'
import { useTheme } from '../theme'
import { triggerHaptic } from '../services/preferences'

/** Native controls with the approved brand colors, rather than Material seed tints. */
export function ThemeSwitch({ value, disabled, onValueChange, label }: {
  value: boolean; disabled?: boolean; onValueChange: (value: boolean) => void; label: string
}) {
  const theme = useTheme()
  const change = (next: boolean) => { if (label !== '震动反馈') void triggerHaptic('selection'); onValueChange(next) }
  if (Platform.OS !== 'android') return <UniversalSwitch value={value} disabled={disabled} onValueChange={change} />
  return <ComposeSwitch value={value} enabled={!disabled} onCheckedChange={change} modifiers={[semantics({ contentDescription: label })]}
    colors={{ checkedTrackColor: theme.brand, checkedThumbColor: theme.onBrand, checkedBorderColor: theme.brand,
      uncheckedTrackColor: theme.surfaceSoft, uncheckedThumbColor: theme.mutedStrong, uncheckedBorderColor: theme.line }} />
}
