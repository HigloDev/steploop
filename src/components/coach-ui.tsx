import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextProps, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle, Line, Polyline } from 'react-native-svg'
import { Header } from './Header'
import { Button } from './ui'
import { useTheme } from '../theme'
import { CoachState, CoachWeighIn, localDate } from '../core/coach'
import { syncCoachWorkouts } from '../services/coach-storage'
import { listWorkouts } from '../services/workout-storage'

export function CoachText({ tone = 'normal', size = 'body', style, ...props }: TextProps & {
  tone?: 'normal' | 'muted' | 'accent' | 'error'; size?: 'body' | 'small' | 'title' | 'value'
}) {
  const t = useTheme()
  const fontSize = size === 'small' ? t.fontSubtitle : size === 'title' ? t.fontValue : size === 'value' ? t.fontTitle : t.fontBase
  return <Text selectable={tone === 'error' || size === 'value'} {...props} style={[{
    color: tone === 'muted' ? t.mutedStrong : tone === 'accent' ? t.brandInk : tone === 'error' ? t.redInk : t.ink,
    fontSize, lineHeight: Math.round(fontSize * 1.5), fontWeight: size === 'title' || size === 'value' ? '600' : '400',
    ...(size === 'value' ? { fontVariant: ['tabular-nums'] as const } : {}),
  }, style]} />
}
export function CoachPage({ title, back = true, children }: { title: string; back?: boolean; children: React.ReactNode }) {
  const t = useTheme(), insets = useSafeAreaInsets()
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.paper }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Header title={title} back={back} large={!back} />
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: t.pagePaddingH, paddingTop: 16, paddingBottom: insets.bottom + t.pagePaddingBottom, gap: 20 }}>
      {children}
    </ScrollView>
  </KeyboardAvoidingView>
}
export function CoachSection({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme()
  return <View style={{ gap: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: t.lineSoft }}>
    <CoachText size="title" accessibilityRole="header">{title}</CoachText>{children}
  </View>
}
export function CoachMessage({ error, loading, retry }: { error: string; loading?: boolean; retry?: () => void }) {
  const t = useTheme()
  return <View style={{ gap: 12 }}>
    {loading ? <ActivityIndicator accessibilityLabel="正在读取教练数据" color={t.brandText} /> : null}
    {error ? <CoachText tone="error" accessibilityRole="alert">{error}</CoachText> : null}
    {error && retry ? <Button title="重新加载" variant="secondary" onPress={retry} /> : null}
  </View>
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
      if (request === generation.current) { setState(next); setLoading(false) }
      return next
    } catch (e) {
      if (request === generation.current) { setError(e instanceof Error ? e.message : '读取失败，请重试。'); setLoading(false) }
      return null
    }
  }, [])
  useEffect(() => {
    void refresh()
    const unsubscribe = navigation.addListener('focus', () => { void refresh() })
    return () => { ++generation.current; unsubscribe() }
  }, [navigation, refresh])
  return { state, setState, error, setError, loading, refresh }
}
export const effortText = { comfortable: '舒适', hard: '有些吃力', unwell: '身体不适' }
export const displayDate = (date: string) => date.slice(5).replace('-', '月') + '日'
export const minutesText = (n: number) => (Math.round(n * 10) / 10).toString()

export function WeightTrend({ readings, target }: { readings: CoachWeighIn[]; target?: number }) {
  const t = useTheme()
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date)).slice(-12)
  if (sorted.length < 2) return <CoachText tone="muted" size="small">记录至少两天的体重后，这里会显示变化曲线。</CoachText>
  const values = sorted.map(w => w.weightKg)
  const min = Math.min(...values, target ?? values[0]) - 0.5, max = Math.max(...values, target ?? values[0]) + 0.5
  const x0 = new Date(sorted[0].date + 'T12:00:00').getTime()
  const span = Math.max(1, new Date(sorted[sorted.length - 1].date + 'T12:00:00').getTime() - x0)
  const x = (w: CoachWeighIn) => 12 + (new Date(w.date + 'T12:00:00').getTime() - x0) / span * 296
  const y = (n: number) => 100 - (n - min) / (max - min) * 88
  return <View accessible accessibilityLabel={'体重曲线，' + sorted.length + '天记录，从' + values[0] + '到' + values[values.length - 1] + '公斤。'}>
    <Svg width="100%" height={120} viewBox="0 0 320 112">
      {target ? <Line x1={0} x2={320} y1={y(target)} y2={y(target)} stroke={t.muted} strokeDasharray="4 5" /> : null}
      <Polyline points={sorted.map(w => x(w) + ',' + y(w.weightKg)).join(' ')} fill="none" stroke={t.brandText} strokeWidth={2.5} />
      {sorted.map(w => <Circle key={w.id} cx={x(w)} cy={y(w.weightKg)} r={3.5} fill={t.brandText} />)}
    </Svg>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <CoachText size="small" tone="muted">{displayDate(sorted[0].date)}</CoachText>
      <CoachText size="small" tone="muted">{displayDate(sorted[sorted.length - 1].date)}</CoachText>
    </View>
    <CoachText size="small" tone="muted">仅连接实际称重记录{target ? '，虚线为目标体重' : ''}。</CoachText>
  </View>
}

export function todayKey() { return localDate(Date.now()) }
