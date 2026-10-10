// 训练页专用组件（浅色 / 深色高对比）：
// - FlipNumber：巨大楼层数字，变化时上翻动画（reanimated）
// - StairGauge：竖向楼梯刻度，一格一层，估算层用虚线
// - PhaseStatusBar：顶部唯一一条状态栏（替代旧版 9 种 Notice）
// - HoldToConfirm：长按确认按钮（结束训练防误触）
// - MiniStat：底部小指标

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { triggerHaptic } from '../services/preferences'

import { useWorkoutPalette, WorkoutPalette } from '../theme'
import { useReduceMotion } from './ui'

// ---------------- FlipNumber ----------------

export function FlipNumber({ value, size = 140, color, accessibilityLabel }: {
  value: number | string
  size?: number
  color?: string
  accessibilityLabel?: string
}) {
  const { palette: P, styles } = useWorkoutStyles()
  const reduced = useReduceMotion()
  const shift = useSharedValue(0)
  const scale = useSharedValue(1)
  const previous = useRef(value)
  useEffect(() => {
    if (previous.current === value) return
    previous.current = value
    if (reduced) return
    shift.set(size * 0.35)
    shift.set(withTiming(0, { duration: 320, easing: Easing.bezier(0.2, 0.9, 0.2, 1) }))
    scale.set(withSequence(withTiming(1.08, { duration: 120 }), withTiming(1, { duration: 220 })))
  }, [value, reduced, shift, scale, size])
  const animated = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, Math.abs(shift.get()) / (size * 0.6)),
    transform: [{ translateY: shift.get() }, { scale: scale.get() }],
  }))
  return (
    <View style={{ flexShrink: 1, minWidth: 0 }} accessible accessibilityRole="text" accessibilityLabel={accessibilityLabel ?? String(value)} accessibilityLiveRegion="polite">
      <Animated.Text
        style={[styles.flip, { fontSize: size, lineHeight: size * 1.05, color: color ?? P.ink }, animated]}
        adjustsFontSizeToFit
        numberOfLines={1}
      >
        {value}
      </Animated.Text>
    </View>
  )
}

// ---------------- StairGauge ----------------

export interface GaugeCell {
  /** 该格对应到达的楼层号。 */
  floor: number
  state: 'done' | 'current' | 'todo'
  estimated?: boolean
}

/** 竖向楼梯刻度：从下往上一格一层，右侧逐格错位形成台阶感。 */
export function StairGauge({ cells, height = 360, style, maxVisible = 24, startFloor }: { cells: GaugeCell[]; height?: number; style?: ViewStyle; maxVisible?: number; startFloor?: number }) {
  const { palette: P, styles } = useWorkoutStyles()
  const currentIndex = cells.findIndex(cell => cell.state === 'current')
  const completed = cells.filter(cell => cell.state === 'done' || cell.state === 'current').length
  const first = Math.max(0, Math.min(cells.length - maxVisible, currentIndex < 0 ? completed === 0 ? 0 : cells.length - maxVisible : currentIndex - 3))
  const visible = cells.slice(first, first + maxVisible)
  const gap = 5
  const cellH = Math.max(6, Math.min(26, (height - gap * visible.length) / Math.max(1, visible.length)))
  return (
    <View
      style={[{ height, justifyContent: 'flex-end' }, style]}
      accessible
      accessibilityLabel={`楼层刻度，已完成 ${completed} 层`}
    >
      {[...visible].reverse().map((cell, index) => {
        const offset = 0
        const done = cell.state === 'done'
        const current = cell.state === 'current'
        return (
          <View key={`${cell.floor}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', marginTop: gap }}>
            <View
              style={{
                height: cellH,
                width: 40 + offset,
                borderRadius: 4,
                backgroundColor: done ? (cell.estimated ? 'transparent' : P.brand) : current ? P.brandDim : P.surfaceHigh,
                borderWidth: done && cell.estimated ? 2 : current ? 2 : 0,
                borderStyle: done && cell.estimated ? 'dashed' : 'solid',
                borderColor: done && cell.estimated ? P.estimate : P.brand,
              }}
            />
            {(current || (done && index === 0)) && cellH >= 12 ? (
              <Text style={styles.gaugeLabel}>{cell.floor}F</Text>
            ) : null}
          </View>
        )
      })}
      {completed === 0 && startFloor !== undefined ? <Text style={[styles.gaugeLabel, { position: 'absolute', bottom: -18, marginLeft: 0 }]}>{startFloor}F</Text> : null}
    </View>
  )
}

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

/** 长按 holdMs 才触发：训练中结束按钮防误触。 */
export function HoldToConfirm({ label, holdingLabel = '继续按住…', onConfirm, holdMs = 1200, style, tone = 'neutral', accessibilityHint }: {
  label: string
  holdingLabel?: string
  onConfirm: () => void
  holdMs?: number
  style?: ViewStyle
  tone?: 'neutral' | 'accent' | 'danger' | 'primary'
  accessibilityHint?: string
}) {
  const { palette: P, styles } = useWorkoutStyles()
  const progress = useSharedValue(0)
  const [holding, setHolding] = useState(false)
  const fill = useAnimatedStyle(() => ({ width: `${progress.get() * 100}%` }))
  const confirm = () => { void triggerHaptic('medium'); onConfirm() }
  const start = () => {
    setHolding(true)
    progress.set(withTiming(1, { duration: holdMs, easing: Easing.linear }, finished => {
      if (finished) scheduleOnRN(confirm)
    }))
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
      accessibilityHint={accessibilityHint ?? '长按约一秒确认，或使用读屏的双击确认'}
      accessibilityActions={[{ name: 'activate', label }]}
      onAccessibilityAction={confirm}
      onPressIn={start}
      onPressOut={stop}
      style={[styles.hold, tone === 'accent' && { borderColor: P.brandInk }, tone === 'danger' && { borderColor: P.danger }, tone === 'primary' && { borderColor: P.brand, backgroundColor: P.brand }, style]}
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
  flip: {
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
    letterSpacing: -4,
    textAlign: 'center',
    includeFontPadding: false,
  },
  gaugeLabel: {
    color: P.inkSoft,
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginLeft: 6,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: P.surface,
   paddingVertical: 6,},
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { flexShrink: 1, fontSize: 15, fontWeight: '800', color: P.ink,},
  statusExtra: { color: P.muted, fontSize: 12, fontWeight: '600' },
  hold: {
    minHeight: 58,
    borderRadius: 29,
    borderWidth: 1.5,
    borderColor: P.muted,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: 18,
  },
  holdFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: P.surfaceHigh },
  holdText: { color: P.inkSoft, fontSize: 17, fontWeight: '800' },
  mini: { flex: 1, alignItems: 'center' },
  miniValue: { color: P.ink, fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
  miniLabel: { color: P.muted, fontSize: 14, fontWeight: '700', marginTop: 2 },
})
