// 训练页专用组件（浅色 / 深色高对比）：
// - FloorReadout / FloorRuler：固定读数配竖向滚动刻度，估算层使用虚线
// - PhaseStatusBar：顶部唯一一条状态栏
// - HoldToConfirm：长按确认按钮（结束训练防误触，含可见长按进度填充与减少动态适配）
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
import Svg, { Circle, Defs, Line, LinearGradient, RadialGradient, Stop } from 'react-native-svg'
import { floorAfter, getFloorTransitionCount } from '../core/floors'
import { triggerHaptic } from '../services/preferences'

import { getWorkoutPalette, isMotionRing, sport, typography, useTheme, useWorkoutPalette, WorkoutPalette } from '../theme'
import { useReduceMotion } from './ui'

/** The value stays still as the ruler scrolls. Its accessible label updates only with the real floor. */
export const FloorReadout = memo(function FloorReadout({ value, unit, size }: { value: number; unit: string; size: number }) {
  const { styles } = useWorkoutStyles()
  const { fontScale } = useWindowDimensions()
  // Barlow's numeric ink sits below the center of its line box.
  const opticalLift = Math.round(size * fontScale * 0.05)
  return (
    <View
      style={[styles.readout, { transform: [{ translateY: -opticalLift }] }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${value} ${unit}`}
      accessibilityLiveRegion="polite"
      testID="workout-floor-readout"
    >
      <Text
        style={[styles.floorValue, { fontSize: size, lineHeight: Math.ceil(size * 1.05) }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={styles.floorUnit}>{unit}</Text>
    </View>
  )
})

/** One native transform moves a bounded window of real floor ticks past a fixed guide. */
export const FloorRuler = memo(function FloorRuler({
  startFloor,
  currentFloor,
  topFloor,
  estimated = false,
  compact = false,
}: {
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
  const motionRing = isMotionRing(theme)
  const activeColor = estimated ? P.estimate : P.brandInk
  const ringEnd = estimated ? P.estimate : theme.isDark ? theme.brandVisual.ringEnd : theme.brand
  const ringStart = estimated ? P.estimate : theme.isDark ? theme.brandVisual.ringStart : '#3388FF'

  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="workout-floor-ruler"
      style={[rulerStyles.viewport, { width: rulerWidth, height }]}
    >
      <View
        style={[
          rulerStyles.spine,
          motionRing
            ? { width: 3, left: 18, borderRadius: 2, backgroundColor: theme.brandVisual.ringTrack }
            : { backgroundColor: P.line },
        ]}
      />
      <Animated.View style={[StyleSheet.absoluteFill, scroll]}>
        {ticks.map(tick => {
          const major = tick === 0 || (topFloor !== undefined && tick === end) || tick % 5 === 0 || Math.abs(tick - index) <= 2
          const color = tick <= index ? P.inkSoft : P.muted
          return (
            <View key={tick} style={[rulerStyles.tick, { top: center + (index - tick) * tickSpacing - 10 }]}>
              <View
                style={{
                  width: major ? 21 : 10,
                  height: motionRing ? 2.5 : 1.5,
                  borderRadius: motionRing ? 2 : 0,
                  backgroundColor: tick <= index ? (motionRing && !estimated ? ringEnd : P.brandText) : P.line,
                }}
              />
              {major && tick !== index ? <Text numberOfLines={1} style={[rulerStyles.label, { color }]}>{floorAfter(startFloor, tick)}</Text> : null}
            </View>
          )
        })}
      </Animated.View>
      <Svg width={rulerWidth} height={18} style={[rulerStyles.guide, { top: center - 9 }]}>
        {motionRing ? (
          <Defs>
            <LinearGradient id="mrRulerGuide" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0%" stopColor={ringStart} />
              <Stop offset="100%" stopColor={ringEnd} />
            </LinearGradient>
            <RadialGradient id="mrRulerGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={theme.brandVisual.ringGlow} stopOpacity={theme.isDark ? 0.65 : 0.35} />
              <Stop offset="100%" stopColor={theme.brandVisual.ringGlow} stopOpacity={0} />
            </RadialGradient>
          </Defs>
        ) : null}
        {motionRing && !reduced && !estimated ? <Circle cx={6} cy={9} r={8} fill="url(#mrRulerGlow)" /> : null}
        <Line
          x1={6}
          x2={rulerWidth - 5}
          y1={9}
          y2={9}
          stroke={motionRing && !estimated ? 'url(#mrRulerGuide)' : activeColor}
          strokeWidth={motionRing ? 3 : 2.5}
          strokeLinecap="round"
          strokeDasharray={estimated ? '4 3' : undefined}
        />
        <Circle cx={6} cy={9} r={motionRing ? 4.2 : 3.75} fill={P.surface} stroke={motionRing && !estimated ? ringEnd : activeColor} strokeWidth={2.2} />
      </Svg>
    </View>
  )
})

const rulerStyles = StyleSheet.create({
  viewport: { flexShrink: 0, overflow: 'hidden', position: 'relative' },
  spine: { position: 'absolute', top: 3, bottom: 3, left: 19, width: 1 },
  tick: { position: 'absolute', left: 19, right: 0, height: 20, flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { ...typography.digits, fontSize: typography.secondary.fontSize, flexShrink: 1 },
  guide: { position: 'absolute', left: 0 },
})

// ---------------- PhaseStatusBar ----------------

export const PhaseStatusBar = memo(function PhaseStatusBar({
  tone,
  text,
  extra,
}: {
  tone: 'info' | 'good' | 'warn'
  text: string
  extra?: string
}) {
  const { palette: P, styles } = useWorkoutStyles()
  const color = tone === 'good' ? P.good : tone === 'warn' ? P.warn : P.inkSoft
  return (
    <View
      style={styles.statusBar}
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={extra ? `${text}，${extra}` : text}
    >
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.statusText}>{text}</Text>
        {extra ? <Text style={styles.statusExtra}>{extra}</Text> : null}
      </View>
    </View>
  )
})

// ---------------- HoldToConfirm ----------------

export type HoldToConfirmAlertConfig = {
  title: string
  message: string
  confirmLabel: string
  destructive?: boolean
}

/** 长按 holdMs 才触发：训练中结束按钮防误触。 */
export const HoldToConfirm = memo(function HoldToConfirm({
  label,
  holdingLabel = '继续按住…',
  onConfirm,
  holdMs = 1200,
  style,
  tone = 'neutral',
  accessibilityHint,
  accessibilityAlert,
}: {
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
  const reduced = useReduceMotion()
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
    // Reduce Motion 开启时不触发瞬间跳满 100% 的填充条，改为稳态按压色 + 文案反馈，
    // 仍严格由 Pressable 真实长按计时器（delayLongPress）授权触发。
    if (!reduced) {
      progress.set(withTiming(1, { duration: holdMs, easing: Easing.linear }))
    }
  }

  const stop = () => {
    setHolding(false)
    cancelAnimation(progress)
    progress.set(reduced ? 0 : withTiming(0, { duration: 160 }))
  }

  const reducedHoldingFill =
    holding && reduced
      ? tone === 'danger'
        ? { backgroundColor: P.dangerFill }
        : tone === 'primary'
          ? { backgroundColor: P.brandPressed }
          : { backgroundColor: P.surfaceHigh }
      : undefined

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}，需要长按`}
      accessibilityHint={
        accessibilityHint ??
        (accessibilityAlert ? '长按约一秒确认，或使用读屏双击打开确认对话框' : '长按约一秒确认，或使用读屏的双击确认')
      }
      accessibilityActions={[{ name: 'activate', label }]}
      onAccessibilityAction={event => {
        if (event.nativeEvent.actionName === 'activate') openAccessibilityAlert()
      }}
      onPressIn={start}
      onPressOut={stop}
      delayLongPress={holdMs}
      onLongPress={confirm}
      style={[
        styles.hold,
        tone === 'accent' && { borderColor: P.brandInk },
        tone === 'danger' && { borderColor: P.danger },
        tone === 'primary' && { borderColor: P.brandText, backgroundColor: P.brand },
        reducedHoldingFill,
        style,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.holdFill,
          tone === 'danger' && { backgroundColor: P.dangerFill },
          tone === 'primary' && { backgroundColor: P.brandPressed },
          fill,
        ]}
      />
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[
          styles.holdText,
          tone === 'accent' && { color: P.brandInk },
          tone === 'danger' && { color: P.danger },
          tone === 'primary' && { color: P.onBrand, fontSize: 19, fontWeight: '800' },
        ]}
      >
        {holding ? holdingLabel : label}
      </Text>
    </Pressable>
  )
})

// ---------------- MiniStat ----------------

export const MiniStat = memo(function MiniStat({
  label,
  value,
  accent,
  compact = false,
  divider = false,
}: {
  label: string
  value: string
  accent?: boolean
  compact?: boolean
  divider?: boolean
}) {
  const { palette: P, styles } = useWorkoutStyles()
  return (
    <View
      style={[styles.mini, divider && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: P.line }]}
      accessible
      accessibilityLabel={`${label} ${value}`}
    >
      <Text
        style={[styles.miniValue, compact && { fontSize: 22 }, accent && { color: P.brandInk }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={[styles.miniLabel, compact && { fontSize: 12 }]}>{label}</Text>
    </View>
  )
})

const workoutStyleCache = new WeakMap<WorkoutPalette, ReturnType<typeof makeStyles>>()
function useWorkoutStyles() {
  const palette = useWorkoutPalette()
  const styles = useMemo(() => {
    const cached = workoutStyleCache.get(palette)
    if (cached) return cached
    const created = makeStyles(palette)
    workoutStyleCache.set(palette, created)
    return created
  }, [palette])
  return { palette, styles }
}

const makeStyles = (P: WorkoutPalette) =>
  StyleSheet.create({
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
      paddingVertical: 0,
    },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    statusText: { ...typography.label, flexShrink: 1, color: P.inkSoft },
    statusExtra: { ...typography.caption, color: P.muted },
    hold: {
      minHeight: 56,
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
