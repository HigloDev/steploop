import React from 'react'
import { ScrollView, Text, View, useWindowDimensions } from 'react-native'
import { BottomSheet, Host, RNHostView } from '@expo/ui'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { isGlacier, useTheme } from '../theme'

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
  const glass = isGlacier(theme)
  const insets = useSafeAreaInsets()
  const { height, width, fontScale } = useWindowDimensions()
  const maxSheetHeight = Math.max(0, Math.min(height * 0.75, height - insets.top - insets.bottom))
  const scrollMaxHeight = Math.max(0, maxSheetHeight - insets.bottom)
  return (
    <Host colorScheme={theme.isDark ? 'dark' : 'light'} seedColor={theme.brand} style={{ position: 'absolute' }}>
      <BottomSheet isPresented={visible} onDismiss={onClose} containerColor={glass ? theme.card : theme.cardSoft}
        snapPoints={expanded || height / fontScale < 700 ? ['full'] : undefined}
        contentPadding={0} shouldDismissOnBackPress={!busy} shouldDismissOnClickOutside={!busy}>
        <RNHostView matchContents>
          <View style={{ width: Math.min(width, 640), maxHeight: maxSheetHeight, paddingBottom: insets.bottom }}>
            <ScrollView style={{ width: '100%', maxHeight: scrollMaxHeight }} keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24, gap: 8 }}>
              <Text accessibilityRole="header" style={{ color: theme.ink, fontSize: 20, fontWeight: '700' }}>{title}</Text>
              <View style={{ gap: 12 }}>{children}</View>
            </ScrollView>
          </View>
        </RNHostView>
      </BottomSheet>
    </Host>
  )
}
