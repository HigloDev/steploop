import React, { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { UIIcon } from '../components/ui-icon'

import { Button, useReduceMotion } from '../components/ui'
import { BrandMark } from '../components/brand-mark'
import { MotionBrandBadge, MotionRingArc } from '../components/motion-ring-graphics'
import { isMotionRing, typography, useTheme, useThemeStyles, Theme } from '../theme'
import { GlassBackdrop, getGlassSurfaceStyle } from '../components/glass-material'
import { RootStackNavigation, RootStackScreen } from '../navigation/types'
import { markOnboardingSeen } from '../services/onboarding'

interface Step {
  key: 'carry' | 'first-climb' | 'foreground'
  title: string
  body: string
  hint: string
}

const STEPS: Step[] = [
  { key: 'carry', title: '把手机放稳', body: '放进口袋或贴身腰包', hint: '每次保持相同携带方式，手持晃动会影响识别。' },
  { key: 'first-climb', title: '第一轮，认识这栋楼', body: '每到一层，点一下“到了一层”', hint: '首页直接开始爬楼，到顶点“到顶了”。结束训练后保存楼栋，下次选它就能自动计层。' },
  { key: 'foreground', title: '结束后，核对每一轮', body: '发现层数不对，可以修改', hint: '训练中长按“结束并保存”，结算页点任意一轮修改层数。锁屏前在设置中检查后台权限；估算和采样中断仍需核对。' },
]

function CarryIllustration({ size, accent, soft }: { size: number; accent: string; soft: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" accessible={false}>
      <Circle cx={60} cy={60} r={52} fill={soft} />
      <Rect x={38} y={24} width={44} height={72} rx={11} fill="none" stroke={accent} strokeWidth={4.5} />
      <Path d="M52 34h16" stroke={accent} strokeWidth={4} strokeLinecap="round" />
      <Path d="M46 66l9-9 7 7 12-13" fill="none" stroke={accent} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={60} cy={85} r={3} fill={accent} />
    </Svg>
  )
}

function VerifyIllustration({ size, accent, soft }: { size: number; accent: string; soft: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" accessible={false}>
      <Circle cx={60} cy={60} r={52} fill={soft} />
      <Path
        d="M60 22l28 11v24c0 20-12 34-28 41-16-7-28-21-28-41V33l28-11Z"
        fill="none"
        stroke={accent}
        strokeWidth={4.5}
        strokeLinejoin="round"
      />
      <Path d="M47 60l9 9 18-19" fill="none" stroke={accent} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export default function OnboardingScreen({ route }: RootStackScreen<'Onboarding'>) {
  const theme = useTheme()
  const motionRing = isMotionRing(theme)
  const reduced = useReduceMotion()
  const insets = useSafeAreaInsets()
  const { height, fontScale } = useWindowDimensions()
  const compact = height / fontScale < 720
  const styles = useThemeStyles(makeStyles)
  const navigation = useNavigation<RootStackNavigation>()
  const fromSettings = route.params?.from === 'settings'
  const [stepIndex, setStepIndex] = useState(0)
  const [finishing, setFinishing] = useState(false)
  const finishingRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const step = STEPS[stepIndex]
  const isLast = stepIndex === STEPS.length - 1

  const finish = async () => {
    if (finishingRef.current || !mountedRef.current) return
    finishingRef.current = true
    setFinishing(true)
    await markOnboardingSeen()
    if (!mountedRef.current) return
    if (fromSettings) {
      navigation.goBack()
    } else {
      navigation.replace('Main')
    }
  }

  const handlePrimary = () => {
    if (finishingRef.current) return
    if (isLast) {
      void finish()
    } else {
      setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))
    }
  }

  const handleBack = () => {
    if (finishingRef.current) return
    if (stepIndex > 0) {
      setStepIndex((i) => Math.max(0, i - 1))
    } else if (fromSettings) {
      navigation.goBack()
    }
  }

  const artSize = compact ? 104 : 132

  return (
    <View style={styles.page}>
      <GlassBackdrop />
      <View style={[styles.topBar, { paddingTop: insets.top + (compact ? 10 : 18) }]}>
        {fromSettings || stepIndex > 0 ? <Pressable
          accessibilityRole="button"
          accessibilityLabel={stepIndex > 0 ? '上一步' : '返回'}
          accessibilityState={{ disabled: finishing }}
          disabled={finishing}
          hitSlop={8}
          style={styles.topAction}
          onPress={handleBack}
        >
          <UIIcon name="chevron-left" size={26} color={theme.ink} />
        </Pressable> : <View style={styles.topAction} />}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: finishing, busy: finishing }}
          disabled={finishing}
          hitSlop={8}
          style={styles.topAction}
          onPress={() => void finish()}
        >
          <Text style={styles.topActionText}>跳过</Text>
        </Pressable>
      </View>

      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.body, compact && { paddingVertical: 12 }]}>
        <View style={[getGlassSurfaceStyle(theme, 'feature'), styles.card, compact && { paddingVertical: 20, paddingHorizontal: 18 }]}>
          <View style={styles.stepPill}>
            <Text accessibilityLiveRegion="polite" style={styles.stepLabel}>{`开始之前 · ${stepIndex + 1}/${STEPS.length}`}</Text>
          </View>
          <View style={[styles.iconWrap, compact && { width: 112, height: 112, marginTop: 14, marginBottom: 18 }]}>
            {motionRing ? (
              <MotionRingArc
                progress={(stepIndex + 1) / STEPS.length}
                size={artSize + 14}
                strokeWidth={5.5}
                reducedMotion={reduced}
                center={
                  step.key === 'first-climb' ? (
                    <MotionBrandBadge size={Math.round(artSize * 0.62)}>
                      <BrandMark size={Math.round(artSize * 0.36)} color="#FFFFFF" />
                    </MotionBrandBadge>
                  ) : step.key === 'carry' ? (
                    <CarryIllustration size={Math.round(artSize * 0.72)} accent={theme.brandText} soft={theme.brandSoft} />
                  ) : (
                    <VerifyIllustration size={Math.round(artSize * 0.72)} accent={theme.brandText} soft={theme.brandSoft} />
                  )
                }
              />
            ) : step.key === 'first-climb' ? (
              <BrandMark size={artSize} color={theme.brandText} />
            ) : step.key === 'carry' ? (
              <CarryIllustration size={artSize} accent={theme.brandText} soft={theme.brandSoft} />
            ) : (
              <VerifyIllustration size={artSize} accent={theme.brandText} soft={theme.brandSoft} />
            )}
          </View>
          <Text accessibilityRole="header" style={[styles.title, compact && { fontSize: 25, lineHeight: 33 }]}>{step.title}</Text>
          <Text style={[styles.bodyText, compact && { fontSize: 17, lineHeight: 24 }]}>{step.body}</Text>
          <Text style={[styles.hint, compact && { fontSize: 14, lineHeight: 21 }]}>{step.hint}</Text>
        </View>

        <View style={[styles.dots, compact && { marginTop: 14 }]}>
          {STEPS.map((s, i) => (
            <View key={s.key} style={[styles.dot, i === stepIndex && styles.dotActive]} />
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + (compact ? 16 : 32) }]}>
        <Button style={styles.primaryBtn} title={isLast ? '开始使用' : '下一步'} loading={finishing} onPress={handlePrimary} />
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
      justifyContent: 'center',
      paddingHorizontal: theme.pagePaddingH,
      paddingVertical: 20,
    },
    card: {
      paddingHorizontal: 24,
      paddingVertical: 28,
      borderRadius: theme.radiusXl,
      alignItems: 'center',
    },
    stepPill: {
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: theme.brandSoft,
    },
    stepLabel: {
      ...typography.label,
      color: theme.brandText,
      fontWeight: '700',
    },
    iconWrap: {
      width: 144,
      height: 144,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 22,
      marginBottom: 24,
    },
    title: {
      color: theme.ink,
      fontSize: 28,
      lineHeight: 36,
      fontWeight: '700',
      letterSpacing: -0.3,
      textAlign: 'center',
      marginBottom: 10,
    },
    bodyText: {
      color: theme.ink,
      fontSize: 19,
      lineHeight: 27,
      fontWeight: '600',
      textAlign: 'center',
      marginBottom: 10,
    },
    hint: {
      color: theme.mutedStrong,
      fontSize: 15,
      lineHeight: 23,
      textAlign: 'center',
      maxWidth: 320,
    },
    dots: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
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
      backgroundColor: theme.brandText,
      width: 24,
    },
    footer: {
      paddingHorizontal: theme.pagePaddingH,
      paddingTop: 12,
    },
    primaryBtn: {
      minHeight: 56,
      borderRadius: theme.radiusLg,
    },
  })
