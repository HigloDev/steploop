// 训练页专用组件（浅色 / 深色高对比）：
// - FloorReadout / FloorRuler：固定读数配竖向滚动刻度，估算层使用虚线
// - PhaseStatusBar：顶部唯一一条状态栏（替代旧版 9 种 Notice）
// - HoldToConfirm：长按确认按钮（结束训练防误触）
// - MiniStat：底部小指标

import React, { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AppState, Pressable, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle, Line } from 'react-native-svg'
import { floorAfter, getFloorTransitionCount } from '../core/floors'
import { triggerHaptic } from '../services/preferences'

import { getWorkoutPalette, sport, typography, useTheme, useWorkoutPalette, WorkoutPalette } from '../theme'
import { useReduceMotion } from './ui'

/** The value stays still as the ruler scrolls. Its accessible label updates only with the real floor. */
export const FloorReadout = memo(function FloorReadout({ value, unit, size }: { value: number; unit: string; size: number }) {
  const { palette: P, styles } = useWorkoutStyles()
  const { fontScale } = useWindowDimensions()
  // Barlow's numeric ink sits below the center of its line box.
  const opticalLift = Math.round(size * fontScale * 0.05)
  return <View style={[styles.readout, { transform: [{ translateY: -opticalLift }] }]} accessible accessibilityRole="text"
    accessibilityLabel={`${value} ${unit}`} accessibilityLiveRegion="polite" testID="workout-floor-readout">
    <Text style={[styles.floorValue, { fontSize: size, lineHeight: Math.ceil(size * 1.05) }]}
      numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    <Text style={styles.floorUnit}>{unit}</Text>
  </View>
})

/** One native transform moves a bounded window of real floor ticks past a fixed guide. */
export const FloorRuler = memo(function FloorRuler({ startFloor, currentFloor, topFloor, estimated = false, compact = false }: {
  startFloor: number
  currentFloor: number
  topFloor?: number
  estimated?: boolean
  compact?: boolean
}) {
  const theme = useTheme()
  const P = getWorkoutPalette(theme)
  const { motion } = theme
  const reduced = useReduceMotion()
  const index = getFloorTransitionCount(startFloor, currentFloor)
  const end = topFloor === undefined ? index : getFloorTransitionCount(startFloor, topFloor)
  const tickSpacing = compact ? 25 : 29
  const height = tickSpacing * 5 + 4
  const center = height / 2
  const rulerWidth = compact ? 82 : 96
  const offset = useSharedValue(index)
  const previous = useRef(index)
  const { base, easing: { move } } = motion

  useEffect(() => {
    const delta = index - previous.current
    previous.current = index
    if (reduced || Math.abs(delta) > 2) {
      offset.set(index)
      return
    }
    if (delta !== 0) offset.set(withTiming(index, { duration: base, easing: Easing.bezier(...move) }))
  }, [base, index, move, offset, reduced])

  const scroll = useAnimatedStyle(() => ({ transform: [{ translateY: (offset.get() - index) * tickSpacing }] }))
  const first = Math.max(0, index - 5)
  const last = Math.min(Math.max(end, index), index + 5)
  const ticks = Array.from({ length: last - first + 1 }, (_, step) => first + step)
  const activeColor = estimated ? P.estimate : P.brandInk

  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    testID="workout-floor-ruler" style={[rulerStyles.viewport, { width: rulerWidth, height }]}>
    <View style={[rulerStyles.spine, { backgroundColor: P.line }]} />
    <Animated.View style={[StyleSheet.absoluteFill, scroll]}>
      {ticks.map(tick => {
        const major = tick === 0 || (topFloor !== undefined && tick === end) || tick % 5 === 0 || Math.abs(tick - index) <= 2
        const color = tick <= index ? P.inkSoft : P.muted
        return <View key={tick} style={[rulerStyles.tick, { top: center + (index - tick) * tickSpacing - 10 }]}>
          <View style={{ width: major ? 21 : 10, height: 1.5, backgroundColor: tick <= index ? P.brandText : P.line }} />
          {major && tick !== index ? <Text numberOfLines={1} style={[rulerStyles.label, { color }]}>{floorAfter(startFloor, tick)}</Text> : null}
        </View>
      })}
    </Animated.View>
    <Svg width={rulerWidth} height={12} style={[rulerStyles.guide, { top: center - 6 }]}>
      <Line x1={5} x2={rulerWidth - 5} y1={6} y2={6} stroke={activeColor} strokeWidth={2.5} strokeLinecap="round"
        strokeDasharray={estimated ? '4 3' : undefined} />
      <Circle cx={5} cy={6} r={3.75} fill={P.surface} stroke={activeColor} strokeWidth={2} />
    </Svg>
  </View>
})

const rulerStyles = StyleSheet.create({
  viewport: { flexShrink: 0, overflow: 'hidden', position: 'relative' },
  spine: { position: 'absolute', top: 3, bottom: 3, left: 19, width: 1 },
  tick: { position: 'absolute', left: 19, right: 0, height: 20, flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { ...typography.digits, fontSize: typography.secondary.fontSize, flexShrink: 1 },
  guide: { position: 'absolute', left: 0 },
})

// ---------------- PhaseStatusBar ----------------

export function PhaseStatusBar({ tone, text, extra }: { tone: 'info' | 'good' | 'warn'; text: string; extra?: string }) {
  const { palette: P, styles } = useWorkoutStyles()
  const color = tone === 'good' ? P.good : tone === 'warn' ? P.warn : P.inkSoft
  return (
    <View style={styles.statusBar} accessible accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={extra ? `${text}，${extra}` : text}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.statusText}>{text}</Text>
        {extra ? <Text style={styles.statusExtra}>{extra}</Text> : null}
      </View>
    </View>
  )
}

// ---------------- HoldToConfirm ----------------

export type HoldToConfirmAlertConfig = {
  title: string
  message: string
  confirmLabel: string
  destructive?: boolean
}

/** 长按 holdMs 才触发：训练中结束按钮防误触。 */
export function HoldToConfirm({ label, holdingLabel = '继续按住…', onConfirm, holdMs = 1200, style, tone = 'neutral', accessibilityHint, accessibilityAlert }: {
  label: string
  holdingLabel?: string
  onConfirm: () => void
  holdMs?: number
  style?: ViewStyle
  tone?: 'neutral' | 'accent' | 'danger' | 'primary'
  accessibilityHint?: string
  accessibilityAlert?: HoldToConfirmAlertConfig
}) {
  const { palette: P, styles } = useWorkoutStyles()
  const progress = useSharedValue(0)
  const [holding, setHolding] = useState(false)
  const mountedRef = useRef(true)
  const alertOpenRef = useRef(false)
  const alertTokenRef = useRef(0)
  const hasAccessibilityAlert = Boolean(accessibilityAlert)
  const fill = useAnimatedStyle(() => ({ width: `${progress.get() * 100}%` }))

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      alertOpenRef.current = false
      alertTokenRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!hasAccessibilityAlert || !AppState?.addEventListener) return
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') return
      alertOpenRef.current = false
      alertTokenRef.current += 1
    })
    return () => subscription?.remove?.()
  }, [hasAccessibilityAlert])

  const confirm = () => {
    if (!mountedRef.current) return
    void triggerHaptic('medium')
    onConfirm()
  }

  const openAccessibilityAlert = () => {
    if (!accessibilityAlert) {
      confirm()
      return
    }
    if (!mountedRef.current || alertOpenRef.current) return
    if (AppState?.currentState && AppState.currentState !== 'active') return
    if (!Alert?.alert) return
    const token = alertTokenRef.current + 1
    alertTokenRef.current = token
    alertOpenRef.current = true
    Alert.alert(
      accessibilityAlert.title,
      accessibilityAlert.message,
      [
        {
          text: '继续训练',
          style: 'cancel',
          onPress: () => {
            if (alertTokenRef.current !== token) return
            alertTokenRef.current += 1
            alertOpenRef.current = false
          },
        },
        {
          text: accessibilityAlert.confirmLabel,
          style: accessibilityAlert.destructive ? 'destructive' : 'default',
          onPress: () => {
            if (alertTokenRef.current !== token || !mountedRef.current) return
            alertTokenRef.current += 1
            alertOpenRef.current = false
            confirm()
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          if (alertTokenRef.current !== token) return
          alertTokenRef.current += 1
          alertOpenRef.current = false
        },
      },
    )
  }
  const start = () => {
    setHolding(true)
    // Animation may finish immediately when Reduce Motion is enabled. Only
    // Pressable's real hold timer may authorize the action; this is feedback.
    progress.set(withTiming(1, { duration: holdMs, easing: Easing.linear }))
  }
  const stop = () => {
    setHolding(false)
    cancelAnimation(progress)
    progress.set(withTiming(0, { duration: 160 }))
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}，需要长按`}
      accessibilityHint={accessibilityHint ?? (accessibilityAlert ? '长按约一秒确认，或使用读屏双击打开确认对话框' : '长按约一秒确认，或使用读屏的双击确认')}
      accessibilityActions={[{ name: 'activate', label }]}
      onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'activate') openAccessibilityAlert() }}
      onPressIn={start}
      onPressOut={stop}
      delayLongPress={holdMs}
      onLongPress={confirm}
      style={[styles.hold, tone === 'accent' && { borderColor: P.brandInk }, tone === 'danger' && { borderColor: P.danger }, tone === 'primary' && { borderColor: P.brandText, backgroundColor: P.brand }, style]}
    >
      <Animated.View style={[styles.holdFill, tone === 'danger' && { backgroundColor: P.dangerFill }, tone === 'primary' && { backgroundColor: P.brandPressed }, fill]} />
      <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.holdText, tone === 'accent' && { color: P.brandInk }, tone === 'danger' && { color: P.danger }, tone === 'primary' && { color: P.onBrand, fontSize: 20, fontWeight: '900' }]}>{holding ? holdingLabel : label}</Text>
    </Pressable>
  )
}

// ---------------- MiniStat ----------------

export function MiniStat({ label, value, accent, compact = false, divider = false }: { label: string; value: string; accent?: boolean; compact?: boolean; divider?: boolean }) {
  const { palette: P, styles } = useWorkoutStyles()
  return (
    <View style={[styles.mini, divider && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: P.line }]} accessible accessibilityLabel={`${label} ${value}`}>
      <Text style={[styles.miniValue, compact && { fontSize: 22 }, accent && { color: P.brandInk }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={[styles.miniLabel, compact && { fontSize: 12 }]}>{label}</Text>
    </View>
  )
}

function useWorkoutStyles() {
  const palette = useWorkoutPalette()
  const styles = useMemo(() => makeStyles(palette), [palette])
  return { palette, styles }
}

const makeStyles = (P: WorkoutPalette) => StyleSheet.create({
  readout: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: sport.space.sm },
  floorValue: { ...typography.digits, color: P.brandInk, flexShrink: 1 },
  floorUnit: { ...typography.navigation, color: P.inkSoft, flexShrink: 0 },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
   paddingVertical: 0 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { ...typography.label, flexShrink: 1, color: P.inkSoft },
  statusExtra: { ...typography.caption, color: P.muted },
  hold: {
    minHeight: 58,
    borderRadius: sport.radius.control,
    borderWidth: 1.5,
    borderColor: P.muted,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: 18,
  },
  holdFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: P.surfaceHigh },
  holdText: { ...typography.control, color: P.inkSoft },
  mini: { flex: 1, alignItems: 'center' },
  miniValue: { ...typography.digits, color: P.ink, fontSize: 25 },
  miniLabel: { ...typography.caption, color: P.muted, marginTop: 4 },
})
