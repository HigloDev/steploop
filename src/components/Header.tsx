// 顶部导航栏：对应原 miniprogram/components/app-header。
// RN 版用 useSafeAreaInsets 处理状态栏高度，用 Pressable 调 navigation.goBack()。

import React from 'react'
import { Feather } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { useTheme, Theme } from '../theme'
import { RootStackNavigation } from '../navigation/types'

interface HeaderProps {
  large?: boolean
  title: string
  /** 是否显示返回按钮。默认 true。 */
  back?: boolean
  /** 右侧可选操作按钮文字。 */
  rightLabel?: string
  /** 右侧按钮点击回调。 */
  onRightPress?: () => void
  /** 透传样式。 */
  style?: ViewStyle
}

export function Header({ title, back = true, large = false, rightLabel, onRightPress, style }: HeaderProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const navigation = useNavigation<RootStackNavigation>()

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack()
    } else {
      navigation.navigate('Main', { screen: 'Train' })
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }, style]}>
      <View style={[styles.bar, large && styles.largeBar]}>
        {back ? (
          <Pressable accessibilityRole="button" accessibilityLabel="返回" style={({ pressed }) => [styles.backAction, pressed && { backgroundColor: theme.surfaceSoft }]} onPress={handleBack} hitSlop={4}>
            <Feather name="arrow-left" size={23} color={theme.ink} />
          </Pressable>
        ) : (
          large ? null : <View style={styles.backPlaceholder} />
        )}
        <Text accessibilityRole="header" style={[styles.title, large && styles.largeTitle]}>
          {title}
        </Text>
        {rightLabel && onRightPress ? (
          <Pressable accessibilityRole="button" accessibilityLabel={rightLabel} style={({ pressed }) => [styles.rightAction, pressed && { backgroundColor: theme.surfaceSoft }]} onPress={onRightPress} hitSlop={4}>
            <Text style={styles.rightText}>{rightLabel}</Text>
          </Pressable>
        ) : (
          large ? null : <View style={styles.rightPlaceholder} />
        )}
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      backgroundColor: theme.paper,
      zIndex: 20,
    },
    // 高度 88rpx ≈ 44pt
    bar: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
    },
    largeBar: { minHeight: 64, paddingHorizontal: theme.pagePaddingH, paddingTop: 8, paddingBottom: 12 },
    largeTitle: { textAlign: 'left', fontSize: theme.fontTitle, lineHeight: 34, fontWeight: '700', marginHorizontal: 0 },
    backAction: {
      minWidth: 48,
      minHeight: 48,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
    },
    backText: {
      color: theme.ink,
      fontSize: 14,
    },
    backPlaceholder: {
      minWidth: 48,
    },
    title: {
      flex: 1,
      color: theme.ink,
      fontSize: 17,
      fontWeight: '600',
      textAlign: 'center',
      marginHorizontal: 8,
    },
    rightAction: {
      minWidth: 48,
      minHeight: 48,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
    },
    rightText: {
      color: theme.green,
      fontSize: 14,
      fontWeight: '600',
    },
    rightPlaceholder: {
      minWidth: 48,
    },
  })
