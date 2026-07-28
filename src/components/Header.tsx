// 顶部导航栏：对应原 miniprogram/components/app-header。
// RN 版用 useSafeAreaInsets 处理状态栏高度，用 Pressable 调 navigation.goBack()。

import React from 'react'
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { useTheme, Theme } from '../theme'
import { RootStackNavigation } from '../navigation/types'

interface HeaderProps {
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

export function Header({ title, back = true, rightLabel, onRightPress, style }: HeaderProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const navigation = useNavigation<RootStackNavigation>()

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack()
    } else {
      navigation.navigate('RouteEdit')
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }, style]}>
      <View style={styles.bar}>
        {back ? (
          <Pressable style={styles.backAction} onPress={handleBack} hitSlop={8}>
            <Text style={styles.backText}>返回</Text>
          </Pressable>
        ) : (
          <View style={styles.backPlaceholder} />
        )}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {rightLabel && onRightPress ? (
          <Pressable style={styles.rightAction} onPress={onRightPress} hitSlop={8}>
            <Text style={styles.rightText}>{rightLabel}</Text>
          </Pressable>
        ) : (
          <View style={styles.rightPlaceholder} />
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
      height: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
    },
    backAction: {
      minWidth: 56,
      minHeight: 44,
      height: 44,
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
      minWidth: 56,
    },
    title: {
      flex: 1,
      color: theme.ink,
      fontSize: 16,
      fontWeight: '600',
      letterSpacing: 0.32,
      textAlign: 'center',
      marginHorizontal: 8,
    },
    rightAction: {
      minWidth: 56,
      minHeight: 44,
      height: 44,
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
      minWidth: 56,
    },
  })
