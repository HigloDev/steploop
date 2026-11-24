import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextProps, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle, Defs, Line, LinearGradient, Path, Polyline, Stop, Text as SvgText } from 'react-native-svg'
import { Header } from './Header'
import { Button } from './ui'
import { isMotionRing, sport, typography, useTheme } from '../theme'
import { getGlassSurfaceStyle, GlassBackdrop, useGlassDockInset } from './glass-material'
import { CoachState, CoachWeighIn, localDate } from '../core/coach'
import { syncCoachWorkouts } from '../services/coach-storage'
import { listWorkouts } from '../services/workout-storage'

export function CoachText({
  tone = 'normal',
  size = 'body',
  style,
  ...props
}: TextProps & {
  tone?: 'normal' | 'muted' | 'accent' | 'good' | 'error'
  size?: 'body' | 'small' | 'caption' | 'title' | 'display' | 'value' | 'metric'
}) {
  const t = useTheme()
  const baseStyle =
    size === 'caption'
      ? typography.caption
      : size === 'small'
        ? typography.secondary
        : size === 'title'
          ? typography.cardTitle
          : size === 'display' || size === 'value'
            ? { fontSize: 22, lineHeight: 30, fontWeight: '700' as const, letterSpacing: -0.2 }
            : size === 'metric'
              ? { ...typography.digits, fontSize: 34, lineHeight: 40 }
              : typography.body
  const color =
    tone === 'muted'
      ? t.mutedStrong
      : tone === 'accent'
        ? t.brandInk
        : tone === 'good'
          ? t.success
          : tone === 'error'
            ? t.redInk
            : t.ink
  return (
    <Text
      selectable={tone === 'error' || size === 'metric'}
      {...props}
      style={[{ color }, baseStyle, style]}
    />
  )
}

export function CoachPage({
  title,
  back = true,
  children,
  hero,
}: {
  title: string
  back?: boolean
  children: React.ReactNode
  hero?: React.ReactNode
}) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const dockInset = useGlassDockInset()
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.paper }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <GlassBackdrop />
      <Header title={title} back={back} large={!back} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: t.pagePaddingH,
          paddingTop: back ? sport.space.md : sport.space.xs,
          paddingBottom: insets.bottom + t.pagePaddingBottom + dockInset,
          gap: sport.space.lg,
        }}
      >
        {hero}
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

export function CoachSection({
  title,
  meta,
  right,
  children,
  card = false,
}: {
  title: string
  meta?: string
  right?: React.ReactNode
  children: React.ReactNode
  card?: boolean
}) {
  const t = useTheme()
  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <CoachText size="title" accessibilityRole="header" style={{ flexShrink: 1 }}>{title}</CoachText>
      {right ?? (meta ? <CoachText size="caption" tone="muted">{meta}</CoachText> : null)}
    </View>
  )
  if (card) {
    return (
      <View style={[getGlassSurfaceStyle(t, 'card'), { padding: 16, gap: sport.space.md }]}>
        {header}
        {children}
      </View>
    )
  }
  return (
    <View style={{ gap: sport.space.md, paddingTop: sport.space.xs }}>
      {header}
      {children}
    </View>
  )
}

export function CoachMessage({ error, loading, retry }: { error: string; loading?: boolean; retry?: () => void }) {
  const t = useTheme()
  if (!loading && !error) return null
  return (
    <View style={{ gap: 10 }}>
      {loading ? <ActivityIndicator accessibilityLabel="正在读取教练数据" color={t.brandText} /> : null}
      {error ? <CoachText tone="error" accessibilityRole="alert">{error}</CoachText> : null}
      {error && retry ? <Button title="重新加载" variant="secondary" onPress={retry} /> : null}
    </View>
  )
}

export function useCoachData(navigation: { addListener: (event: 'focus', callback: () => void) => () => void }) {
  const [state, setState] = useState<CoachState | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++generation.current
    setError('')
    try {
      const workouts = await listWorkouts()
      const next = await syncCoachWorkouts(workouts)
      if (request === generation.current) {
        setState(next)
        setLoading(false)
      }
      return next
    } catch (e) {
      if (request === generation.current) {
        setError(e instanceof Error ? e.message : '读取失败，请重试。')
        setLoading(false)
      }
      return null
    }
  }, [])
  useEffect(() => {
    void refresh()
    const unsubscribe = navigation.addListener('focus', () => {
      void refresh()
    })
    return () => {
      ++generation.current
      unsubscribe()
    }
  }, [navigation, refresh])
  return { state, setState, error, setError, loading, refresh }
}

export const effortText = { comfortable: '舒适', hard: '有些吃力', unwell: '身体不适' }
export const displayDate = (date: string) => date.slice(5).replace('-', '月') + '日'
export const minutesText = (n: number) => (Math.round(n * 10) / 10).toString()

export function WeightTrend({ readings, target }: { readings: CoachWeighIn[]; target?: number }) {
  const t = useTheme()
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date)).slice(-12)
  if (sorted.length < 2) {
    return <CoachText tone="muted" size="small">记录至少两天的体重后，这里会显示变化曲线。</CoachText>
  }
  const values = sorted.map(w => w.weightKg)
  const maxVal = Math.max(...values, target ?? values[0])
  const minVal = Math.min(...values, target ?? values[0])
  const min = minVal - 0.6
  const max = maxVal + 0.6
  const x0 = new Date(sorted[0].date + 'T12:00:00').getTime()
  const span = Math.max(1, new Date(sorted[sorted.length - 1].date + 'T12:00:00').getTime() - x0)
  const chartRight = 252
  const x = (w: CoachWeighIn) => 10 + ((new Date(w.date + 'T12:00:00').getTime() - x0) / span) * (chartRight - 16)
  const y = (n: number) => 98 - ((n - min) / (max - min)) * 82
  const points = sorted.map(w => ({ id: w.id, px: x(w), py: y(w.weightKg) }))
  const polyPoints = points.map(p => `${p.px},${p.py}`).join(' ')
  const areaPath = `M ${points[0].px} ${points[0].py} ${points.slice(1).map(p => `L ${p.px} ${p.py}`).join(' ')} L ${points[points.length - 1].px} 106 L ${points[0].px} 106 Z`
  const lastPoint = points[points.length - 1]

  return (
    <View
      accessible
      accessibilityLabel={'体重曲线，' + sorted.length + '天记录，从' + values[0] + '到' + values[values.length - 1] + '公斤。'}
      style={{ gap: 4 }}
    >
      <Svg width="100%" height={116} viewBox="0 0 320 112">
        <Defs>
          <LinearGradient id="coachWtArea" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={isMotionRing(t) ? t.brandVisual.ringEnd : t.brandText} stopOpacity={t.isDark ? 0.30 : 0.22} />
            <Stop offset="100%" stopColor={t.brandText} stopOpacity={0.01} />
          </LinearGradient>
          {isMotionRing(t) ? (
            <LinearGradient id="coachWtStroke" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0%" stopColor={t.isDark ? t.brandVisual.ringStart : '#3388FF'} />
              <Stop offset="100%" stopColor={t.isDark ? t.brandVisual.ringEnd : t.brand} />
            </LinearGradient>
          ) : null}
        </Defs>
        {target !== undefined ? (
          <>
            <Line x1={6} x2={chartRight} y1={y(target)} y2={y(target)} stroke={t.muted} strokeDasharray="4 4" strokeWidth={1.2} />
            <SvgText x={chartRight + 6} y={y(target) + 4} fill={t.mutedStrong} fontSize={10} fontWeight="600">
              {`目标 ${target.toFixed(1)}`}
            </SvgText>
          </>
        ) : null}
        <SvgText x={chartRight + 6} y={18} fill={t.mutedStrong} fontSize={10}>
          {`${maxVal.toFixed(1)} kg`}
        </SvgText>
        <Path d={areaPath} fill="url(#coachWtArea)" />
        <Polyline
          points={polyPoints}
          fill="none"
          stroke={isMotionRing(t) ? 'url(#coachWtStroke)' : t.brandText}
          strokeWidth={isMotionRing(t) ? 3 : 2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.slice(0, -1).map(p => (
          <Circle key={p.id} cx={p.px} cy={p.py} r={3} fill={t.brandText} />
        ))}
        {isMotionRing(t) ? (
          <Circle cx={lastPoint.px} cy={lastPoint.py} r={8} fill={t.brandVisual.ringGlow} fillOpacity={t.isDark ? 0.28 : 0.2} />
        ) : null}
        <Circle cx={lastPoint.px} cy={lastPoint.py} r={4.5} fill={t.card} stroke={t.brandText} strokeWidth={2.5} />
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <CoachText size="caption" tone="muted">{displayDate(sorted[0].date)}</CoachText>
        <CoachText size="caption" tone="muted">{displayDate(sorted[sorted.length - 1].date)}</CoachText>
      </View>
      <CoachText size="caption" tone="muted">仅连接实际称重记录{target ? '，虚线为目标体重' : ''}。</CoachText>
    </View>
  )
}

export function todayKey() {
  return localDate(Date.now())
}
