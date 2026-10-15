import React from 'react'
import { ScrollView, Text, View, useWindowDimensions } from 'react-native'
import { BottomSheet, Host, RNHostView } from '@expo/ui'
import { useTheme } from '../theme'

/** Native sheet chrome with scrollable app content, including large text and forms. */
export function FlowSheet({ visible, title, onClose, busy = false, expanded = false, children }: {
  visible: boolean
  title: string
  onClose: () => void
  busy?: boolean
  expanded?: boolean
  children: React.ReactNode
}) {
  const theme = useTheme()
  const { height, width, fontScale } = useWindowDimensions()
  return (
    <Host colorScheme={theme.isDark ? 'dark' : 'light'} seedColor={theme.brand} style={{ position: 'absolute' }}>
      <BottomSheet isPresented={visible} onDismiss={onClose} containerColor={theme.cardSoft}
        snapPoints={expanded || height / fontScale < 700 ? ['full'] : undefined}
        contentPadding={0} shouldDismissOnBackPress={!busy} shouldDismissOnClickOutside={!busy}>
        <RNHostView matchContents>
          <ScrollView style={{ width: Math.min(width, 640), maxHeight: height * 0.75 }} keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24, gap: 8 }}>
            <Text accessibilityRole="header" style={{ color: theme.ink, fontSize: 23, fontWeight: '900' }}>{title}</Text>
            <View style={{ gap: 12 }}>{children}</View>
          </ScrollView>
        </RNHostView>
      </BottomSheet>
    </Host>
  )
}
