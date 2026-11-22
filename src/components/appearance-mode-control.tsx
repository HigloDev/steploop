import React from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useAppearance } from '../appearance'
import { hydrateAppearance, saveAppearance } from '../services/appearance'
import { APPEARANCE_MODE_LABELS, type AppearanceMode } from '../skin-catalog'
import { sport, typography, useTheme } from '../theme'
import { NativeChoice } from './native-choice'

const modeOptions = (['light', 'dark', 'system'] as const).map(value => ({
  value, label: APPEARANCE_MODE_LABELS[value],
}))

export function AppearanceModeControl() {
  const theme = useTheme()
  const appearance = useAppearance()
  const { error, saving } = appearance

  return <View style={{ gap: sport.space.sm }}>
    <NativeChoice<AppearanceMode> testID="appearance-mode" value={appearance.mode} options={modeOptions}
      onChange={mode => { void saveAppearance({ mode }) }} />
    {error ? <View accessibilityLiveRegion="polite">
      <Text style={[typography.secondary, { color: theme.redInk }]}>
        {error === 'read' ? '暂时无法读取外观设置。' : '这次选择尚未保存。'}
      </Text>
      <Pressable accessibilityRole="button" style={{ minHeight: theme.tapMin, justifyContent: 'center' }}
        onPress={() => { void (error === 'read' ? hydrateAppearance(true) : saveAppearance()) }}>
        <Text style={[typography.control, { color: theme.brandText }]}>{error === 'read' ? '重试读取' : '重试保存'}</Text>
      </Pressable>
    </View> : saving ? <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: sport.space.sm }}>
      <ActivityIndicator size="small" color={theme.brandText} />
      <Text style={[typography.secondary, { color: theme.inkSoft }]}>正在保存外观</Text>
    </View> : null}
  </View>
}
