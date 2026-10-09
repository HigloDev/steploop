import React, { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'

import { Button } from '../components/ui'
import { BrandMark } from '../components/brand-mark'
import { useTheme, Theme } from '../theme'
import { RootStackNavigation, RootStackScreen } from '../navigation/types'
import { markOnboardingSeen } from '../services/onboarding'
import { runTrainingSensorSelfTest } from '../services/sensor-self-test'

interface Step {
  key: string
  icon: keyof typeof Ionicons.glyphMap
  title: string
  body: string
  hint: string
}

const STEPS: Step[] = [
  { key: 'sensors', icon: 'hardware-chip-outline', title: '先检查必需传感器', body: '没有气压计，无法启动锻炼', hint: '训练需要气压计、加速度计和陀螺仪。自检会确认硬件和连续新数据；不支持的设备仍可浏览历史和导出备份。每次开练前都会重新检查。' },
  { key: 'carry', icon: 'phone-portrait-outline', title: '把手机放稳', body: '放进口袋或贴身腰包', hint: '每次保持相同携带方式，手持晃动会影响识别。' },
  { key: 'first-climb', icon: 'walk-outline', title: '第一轮，每层点一次', body: '电梯下行自动结束本轮', hint: '以后自动开始、逐层计数和播报。只在整次训练结束后统一核对各轮楼层，也可在爬升中纠正当前楼层。' },
  { key: 'foreground', icon: 'shield-checkmark-outline', title: '允许后台训练', body: '锁屏记录需要系统允许', hint: '开始前检查后台与省电权限。系统仍可能中断采样；缺段会记录并提醒，结束时可确认实际楼层。' },
]

export default function OnboardingScreen({ route }: RootStackScreen<'Onboarding'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const navigation = useNavigation<RootStackNavigation>()
  const fromSettings = route.params?.from === 'settings'
  const [stepIndex, setStepIndex] = useState(0)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState('')
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
    if (fromSettings) {
      navigation.goBack()
    } else if (stepIndex > 0) {
      setStepIndex((i) => i - 1)
    }
  }

  return (
    <View style={styles.page}>
      <View style={[styles.topBar, { paddingTop: insets.top }]}>
        {fromSettings || stepIndex > 0 ? <Pressable
          accessibilityRole="button"
          hitSlop={8}
          style={styles.topAction}
          onPress={handleBack}
        >
          <Text style={styles.topActionText}>
            {fromSettings ? '返回' : '上一步'}
          </Text>
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

      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            {step.key === 'first-climb' ? <BrandMark size={64} color={theme.green} /> : <Ionicons name={step.icon} size={52} color={theme.green} />}
          </View>
          <Text style={styles.stepLabel}>{`开始之前 · ${stepIndex + 1}/${STEPS.length}`}</Text>
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.bodyText}>{step.body}</Text>
          <Text style={styles.hint}>{step.hint}</Text>
          {step.key === 'sensors' && <>
            <Button title="运行传感器自检" loading={checking} disabled={checking} onPress={() => {
              setChecking(true)
              void runTrainingSensorSelfTest().then(result => setCheckResult(result.canStart ? '自检通过，可以开始爬楼训练。' : result.problems.join('\n'))).catch(e => setCheckResult(String(e))).finally(() => setChecking(false))
            }} />
            {!!checkResult && <Text accessibilityLiveRegion="polite" style={styles.hint}>{checkResult}</Text>}
          </>}
        </View>

        <View style={styles.dots}>
          {STEPS.map((s, i) => (
            <View key={s.key} style={[styles.dot, i === stepIndex && styles.dotActive]} />
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Button title={isLast ? '开始使用' : '下一步'} onPress={handlePrimary} />
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
      color: theme.green,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '600',
    },
    body: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: theme.pagePaddingH,
      paddingVertical: 32,
    },
    card: {
      paddingHorizontal: 16,
      paddingVertical: 24,
      alignItems: 'center',

    },
    iconWrap: {
      width: 112,
      height: 112,
      borderRadius: 56,
      backgroundColor: theme.greenSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 32,
    },
    stepLabel: {
      color: theme.green,
      fontSize: theme.fontSmall,
      lineHeight: 18,
      fontWeight: '600',
      marginBottom: 12,
    },
    title: {
      color: theme.ink,
      fontSize: theme.fontTitle,
      lineHeight: 34,
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: 16,
    },
    bodyText: {
      color: theme.inkSoft,
      fontSize: 17,
      lineHeight: 24,
      textAlign: 'center',
      marginBottom: 12,
    },
    hint: {
      color: theme.mutedStrong,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      textAlign: 'center',
    },
    dots: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
      marginTop: 24,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.line,
    },
    dotActive: {
      backgroundColor: theme.green,
      width: 20,
    },
    footer: {
      paddingHorizontal: theme.pagePaddingH,
      paddingTop: 8,
      backgroundColor: theme.card,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line,
    },
  })
