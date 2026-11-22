import React from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Header } from '../components/Header'
import { GlassBackdrop } from '../components/glass-material'
import { AppearanceModeControl } from '../components/appearance-mode-control'
import { isGlacier, sport, typography, useTheme } from '../theme'

export default function AppearanceScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  return <View style={{ flex: 1, backgroundColor: theme.paper }}>
    {isGlacier(theme) ? <GlassBackdrop /> : null}
    <Header title="外观" />
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + sport.space.section }]}>
      <Text accessibilityRole="header" style={[typography.section, { color: theme.ink }]}>显示模式</Text>
      <AppearanceModeControl />
    </ScrollView>
  </View>
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: sport.space.page, paddingTop: sport.space.lg, gap: sport.space.md },
})
