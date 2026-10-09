// 通用页面容器：把原 .page 样式（24rpx/40rpx padding + safe-area bottom）封装为 RN 组件。
// 同时提供 hero（眉标 + 标题 + 副标题）和 scroll 容器。

import React from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ViewProps,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme, Theme } from '../theme'

interface ScreenProps extends ViewProps {
  children: React.ReactNode
  scroll?: boolean
  avoidKeyboard?: boolean
}

export function Screen({ children, scroll = true, avoidKeyboard = false, style, ...rest }: ScreenProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)

  const content = (
    <View
      style={[
        styles.page,
        {
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + theme.pagePaddingBottom,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  )

  if (scroll) {
    return (
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={avoidKeyboard ? Platform.OS === 'ios' ? 'padding' : undefined : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </ScrollView>
      </KeyboardAvoidingView>
    )
  }
  return content
}

interface HeroProps {
  eyebrow?: string
  title: string
  subtitle?: string
}

export function Hero({ eyebrow, title, subtitle }: HeroProps) {
  const theme = useTheme()
  const styles = makeStyles(theme)
  return (
    <View style={styles.hero}>
      {eyebrow ? <HeroText style={styles.eyebrow}>{eyebrow}</HeroText> : null}
      <HeroText style={styles.title}>{title}</HeroText>
      {subtitle ? <HeroText style={styles.subtitle}>{subtitle}</HeroText> : null}
    </View>
  )
}

function HeroText({ children, style }: { children: React.ReactNode; style: any }) {
  return <Text style={style}>{children}</Text>
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: theme.paper },
    scrollContent: { flexGrow: 1 },
    page: {
      flex: 1,
      paddingHorizontal: theme.pagePaddingH,
      backgroundColor: theme.paper,
    },
    hero: {
      marginBottom: 16,
    },
    eyebrow: {
      color: theme.brand,
      fontSize: theme.fontEyebrow,
      fontWeight: '700',
      letterSpacing: 1.5,
      textTransform: 'uppercase',
    },
    title: {
      marginTop: 6,
      color: theme.ink,
      fontSize: theme.fontTitle,
      fontWeight: '700',
      lineHeight: 32,
    },
    subtitle: {
      marginTop: 8,
      color: theme.muted,
      fontSize: theme.fontSubtitle,
      lineHeight: 20,
    },
  })
