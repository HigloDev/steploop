import React, { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'

import { Button } from '../components/ui'
import { BrandMark } from '../components/brand-mark'
import { useTheme, Theme } from '../theme'
import { RootStackNavigation, RootStackScreen } from '../navigation/types'
import { markOnboardingSeen } from '../services/onboarding'

interface Step {
  key: string
  icon: keyof typeof Ionicons.glyphMap
  title: string
  body: string
  hint: string
}

const STEPS: Step[] = [
  { key: 'carry', icon: 'phone-portrait-outline', title: '把手机放稳', body: '放进口袋或贴身腰包', hint: '每次保持相同携带方式，手持晃动会影响识别。' },
  { key: 'first-climb', icon: 'walk-outline', title: '第一轮，认识这栋楼', body: '每到一层，点一下“到了一层”', hint: '首页直接开始爬楼，到顶点“到顶了”。结束训练后保存楼栋，下次选它就能自动计层。' },
  { key: 'foreground', icon: 'shield-checkmark-outline', title: '结束后，核对每一轮', body: '发现层数不对，可以修改', hint: '训练中长按“结束并保存”，结算页点任意一轮修改层数。锁屏前在设置中检查后台权限；估算和采样中断仍需核对。' },
]

export default function OnboardingScreen({ route }: RootStackScreen<'Onboarding'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { height, fontScale } = useWindowDimensions()
  const compact = height / fontScale < 720
  const styles = makeStyles(theme)
  const navigation = useNavigation<RootStackNavigation>()
  const fromSettings = route.params?.from === 'settings'
  const [stepIndex, setStepIndex] = useState(0)
  const step = STEPS[stepIndex]
  const isLast = stepIndex === STEPS.length - 1

  const finish = async () => {
    await markOnboardingSeen()
    if (fromSettings) {
      navigation.goBack()
    } else {
      navigation.replace('Main')
    }
  }

  const handlePrimary = () => {
    if (isLast) {
      void finish()
    } else {
      setStepIndex((i) => i + 1)
    }
  }

  const handleBack = () => {
    if (stepIndex > 0) {
      setStepIndex((i) => i - 1)
    } else if (fromSettings) {
      navigation.goBack()
    }
  }

  return (
    <View style={styles.page}>
      <View style={[styles.topBar, { paddingTop: insets.top + (compact ? 12 : 24) }]}>
        {fromSettings || stepIndex > 0 ? <Pressable
          accessibilityRole="button"
          accessibilityLabel={stepIndex > 0 ? '上一步' : '返回'}
          hitSlop={8}
          style={styles.topAction}
          onPress={handleBack}
        >
          <Ionicons name="chevron-back" size={28} color={theme.ink} />
        </Pressable> : <View style={styles.topAction} />}
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          style={styles.topAction}
          onPress={() => void finish()}
        >
          <Text style={styles.topActionText}>跳过</Text>
        </Pressable>
      </View>

      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.body, compact && { paddingVertical: 12 }]}>
        <View style={[styles.card, compact && { paddingVertical: 8 }]}>
          <Text style={styles.stepLabel}>{`开始之前 · ${stepIndex + 1}/${STEPS.length}`}</Text>
          <View style={[styles.iconWrap, compact && { width: 128, height: 112, marginTop: 12, marginBottom: 16 }]}>
            {step.key === 'first-climb' ? <BrandMark size={compact ? 108 : 150} color={theme.brand} /> : step.key === 'carry' ? <Feather name="smartphone" size={compact ? 100 : 144} color={theme.brand} /> : <MaterialCommunityIcons name="shield-check-outline" size={compact ? 100 : 144} color={theme.brand} />}
          </View>
          <Text style={[styles.title, step.title.length > 8 && { fontSize: 36 }, compact && { fontSize: step.title.length > 8 ? 30 : 36, lineHeight: 42, marginBottom: 8 }]}>{step.title}</Text>
          <Text style={[styles.bodyText, compact && { fontSize: 20, lineHeight: 28, marginBottom: 8 }]}>{step.body}</Text>
          <Text style={[styles.hint, { maxWidth: step.key === 'carry' ? 300 : 340 }, compact && { fontSize: 15, lineHeight: 22, marginTop: 8 }]}>{step.hint}</Text>
        </View>

        <View style={[styles.dots, compact && { marginTop: 12 }]}>
          {STEPS.map((s, i) => (
            <View key={s.key} style={[styles.dot, i === stepIndex && styles.dotActive]} />
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + (compact ? 20 : 56) }]}>
        <Button style={{ minHeight: compact ? 64 : 80, borderRadius: 24 }} labelStyle={{ fontSize: compact ? 22 : 26 }} title={isLast ? '开始使用' : '下一步'} onPress={handlePrimary} />
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: {
      flex: 1,
      backgroundColor: theme.paper,
    },
    topBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: theme.pagePaddingH,
      minHeight: theme.tapMin,
    },
    topAction: {
      minHeight: theme.tapMin,
      minWidth: theme.tapMin,
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    topActionText: {
      color: theme.inkSoft,
      fontSize: 16,
      lineHeight: 21,
      fontWeight: '600',
    },
    body: {
      flexGrow: 1,
      justifyContent: 'space-between',
      paddingHorizontal: theme.pagePaddingH,
      paddingVertical: 24,
    },
    card: {
      paddingHorizontal: 0,
      paddingVertical: 12,
      alignItems: 'center',

    },
    iconWrap: {
      width: 160,
      height: 160,
      borderRadius: 56,
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 40,
     marginTop: 24,},
    stepLabel: {
      color: theme.brand,
      fontSize: 20,
      lineHeight: 26,
      fontWeight: '800',
      marginBottom: 12,
    },
    title: {
      color: theme.ink,
      fontSize: 48,
      lineHeight: 56,
      fontWeight: '900',
      textAlign: 'center',
      marginBottom: 16,
    },
    bodyText: {
      color: theme.ink,
      fontSize: 26,
      lineHeight: 34,
      textAlign: 'center',
      marginBottom: 12,
     fontWeight: '800',},
    hint: {
      color: theme.mutedStrong,
      fontSize: 20,
      lineHeight: 30,
      textAlign: 'center',
     marginTop: 20,},
    dots: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 14,
      marginTop: 28,
    },
    dot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: theme.line,
    },
    dotActive: {
      backgroundColor: theme.brand,
      width: 12,
    },
    footer: {
      paddingHorizontal: theme.pagePaddingH,
      paddingTop: 8,
      backgroundColor: theme.paper,
      borderTopWidth: 0,
      borderTopColor: theme.line,
     paddingBottom: 24,},
  })
