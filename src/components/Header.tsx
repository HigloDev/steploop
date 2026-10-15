// 顶部导航栏：对应原 miniprogram/components/app-header。
// RN 版用 useSafeAreaInsets 处理状态栏高度，用 Pressable 调 navigation.goBack()。

import React from 'react'
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
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
  rightContent?: React.ReactNode
  align?: 'center' | 'left'
  onBackPress?: () => void
  /** 透传样式。 */
  style?: ViewStyle
}

export function Header({ title, back = true, large = false, rightLabel, onRightPress, rightContent, align = 'center', onBackPress, style }: HeaderProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const navigation = useNavigation<RootStackNavigation>()

  const handleBack = () => {
    if (onBackPress) { onBackPress(); return }
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
            <Feather name="chevron-left" size={26} color={theme.ink} />
          </Pressable>
        ) : (
          large ? <MaterialCommunityIcons name={title === '记录' ? 'history' : title === '设置' ? 'cog' : 'stairs-up'} size={32} color={theme.brand} style={{ marginRight: 12 }} /> : <View style={styles.backPlaceholder} />
        )}
        <Text accessibilityRole="header" style={[styles.title, large && styles.largeTitle, align === 'left' && { textAlign: 'left' }]}>
          {title}
        </Text>
        {rightContent ?? (rightLabel && onRightPress ? (
          <Pressable accessibilityRole="button" accessibilityLabel={rightLabel} style={({ pressed }) => [styles.rightAction, pressed && { backgroundColor: theme.surfaceSoft }]} onPress={onRightPress} hitSlop={4}>
            <Text style={styles.rightText}>{rightLabel}</Text>
          </Pressable>
        ) : (
          large ? null : <View style={styles.rightPlaceholder} />
        ))}
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
    largeBar: { minHeight: 76, paddingHorizontal: theme.pagePaddingH, paddingTop: 32, paddingBottom: 4,},
    largeTitle: { textAlign: 'left', fontSize: 30, lineHeight: 38, fontWeight: '900', marginHorizontal: 0 },
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
      fontSize: 20,
      fontWeight: '900',
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
      color: theme.brand,
      fontSize: 16,
      fontWeight: '800',
    },
    rightPlaceholder: {
      minWidth: 48,
    },
  })
