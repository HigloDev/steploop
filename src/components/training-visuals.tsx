import React, { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { getRoundAchievementCount } from '../core/floors'
import { formatDuration } from '../core/math'
import type { WorkoutRound } from '../core/types'
import type { WeeklyAchievement } from '../core/weekly-achievement'
import type { TrendPoint } from '../core/progress-trends'
import { sport, useTheme } from '../theme'

/** The same seven actual days are used by Home and the exported weekly summary. */
export function WeekBars({ days, inverted = false }: { days: WeeklyAchievement['days']; inverted?: boolean }) {
  const theme = useTheme()
  const maximum = Math.max(1, ...days.map(day => day.floors))
  const today = new Date().toDateString()
  const ink = inverted ? theme.heroMuted : theme.muted
  return <View style={styles.week} accessibilityRole="image" accessibilityLabel={`本周每天爬升层数：${days.map(day => `周${day.label} ${day.floors} 层`).join('，')}`}>
    {days.map(day => {
      const current = new Date(day.at).toDateString() === today
      return <View key={day.at} style={styles.day} accessible={false}>
        <View style={styles.track}>
          <View style={[styles.bar, { height: day.floors ? 10 + day.floors / maximum * 46 : 2,
            backgroundColor: day.floors ? inverted ? theme.heroAccent : theme.brandText : inverted ? theme.heroLine : theme.line }]} />
        </View>
        <View style={[styles.dayLabel, current && { backgroundColor: inverted ? theme.heroAccent : theme.brand }]}>
          <Text style={[styles.dayText, { color: current ? inverted ? theme.heroSurface : theme.onBrand : ink }]}>{day.label}</Text>
        </View>
      </View>
    })}
  </View>
}

/** Compact rows keep a single round useful; longer sessions reveal their rhythm. */
export function RoundBreakdown({ rounds, onEdit, disabled = false }: {
  rounds: WorkoutRound[]; onEdit?: (round: WorkoutRound) => void; disabled?: boolean
}) {
  const theme = useTheme()
  const maximum = Math.max(1, ...rounds.map(getRoundAchievementCount))
  if (!rounds.length) return <Text style={{ color: theme.muted, fontSize: sport.type.secondary, paddingVertical: sport.space.lg }}>本次没有已完成的轮次。</Text>
  return <View>
    {rounds.map((round, index) => {
      const floors = getRoundAchievementCount(round)
      const pending = round.floorConfirmation === 'pending'
      const corrected = (round.corrections?.length ?? 0) > 0
      const estimated = round.estimated === true && !corrected
      const label = round.roundKind === 'calibration' ? '标定轮' : `第 ${round.roundNumber} 轮`
      const detail = pending ? '层数待确认' : corrected ? '已修正' : estimated ? '估算' : `${Math.round(round.ascentM)} 米爬升`
      return <Pressable key={round.id} disabled={!onEdit || disabled}
        accessibilityRole={onEdit ? 'button' : 'text'}
        accessibilityLabel={`${label}，${floors} 层，${formatDuration(round.activeMs ?? round.durationMs ?? 0)}，${detail}${onEdit ? '，点按修改层数' : ''}`}
        onPress={() => onEdit?.(round)}
        style={({ pressed }) => [styles.round, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.lineSoft }, pressed && { opacity: sport.opacity.pressed }]}>
        <View style={[styles.roundIndex, { backgroundColor: theme.brandSoft }]}>
          <Text style={{ ...theme.numeric, fontSize: sport.type.heading, color: theme.brandInk }}>{String(index + 1).padStart(2, '0')}</Text>
        </View>
        <View style={{ flex: 1, gap: sport.space.xs }}>
          <View style={styles.roundHeading}>
            <Text style={{ color: theme.ink, fontSize: sport.type.body, fontWeight: '600' }}>{label}</Text>
            <Text style={{ ...theme.numeric, color: theme.ink, fontSize: sport.type.label }}>{pending ? '待确认' : `${floors} 层`}</Text>
          </View>
          <View style={[styles.roundTrack, { backgroundColor: theme.lineSoft }]}>
            <View style={{ height: '100%', width: `${Math.max(0, Math.min(100, floors / maximum * 100))}%`, backgroundColor: estimated || pending ? theme.amber : theme.brandText, borderRadius: sport.radius.pill }} />
          </View>
          <View style={styles.roundHeading}>
            <Text style={{ color: pending || estimated ? theme.amberInk : theme.muted, fontSize: sport.type.caption }}>{detail}</Text>
            <Text style={{ ...theme.numeric, color: theme.muted, fontSize: sport.type.caption }}>{formatDuration(round.activeMs ?? round.durationMs ?? 0)}</Text>
          </View>
        </View>
        {onEdit ? <MaterialCommunityIcons name="chevron-right" color={theme.muted} size={18} accessible={false} /> : null}
      </Pressable>
    })}
  </View>
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const theme = useTheme()
  const [selectedAt, setSelectedAt] = useState<number | null>(null)
  const selected = points.find(point => point.bucketStart === selectedAt) ?? [...points].reverse().find(point => point.workouts > 0) ?? points.at(-1)
  const maximum = Math.max(1, ...points.map(point => point.ascentM))
  if (!selected) return null
  return <View style={{ backgroundColor: theme.cardSoft, borderRadius: sport.radius.control, padding: sport.space.lg, marginVertical: sport.space.md }}>
    <View style={styles.roundHeading}>
      <Text style={{ color: theme.muted, fontSize: sport.type.caption }}>{selected.label}</Text>
      <Text style={{ ...theme.numeric, color: theme.brandInk, fontSize: sport.type.label }}>{Math.round(selected.ascentM)} 米</Text>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, gap: sport.space.sm, paddingTop: sport.space.md }}>
      {points.map(point => <Pressable key={point.bucketStart} onPress={() => setSelectedAt(point.bucketStart)} accessibilityRole="button"
        accessibilityState={{ selected: selected.bucketStart === point.bucketStart }} accessibilityLabel={`${point.label}，${point.workouts} 次训练，爬升 ${Math.round(point.ascentM)} 米`}
        style={{ flex: 1, minWidth: 32, alignItems: 'center', gap: sport.space.sm }}>
        <View style={{ height: 76, width: '100%', alignItems: 'center', justifyContent: 'flex-end' }}>
          <View style={{ width: 14, borderRadius: 3, height: point.ascentM > 0 ? 6 + point.ascentM / maximum * 70 : 2,
            backgroundColor: selected.bucketStart === point.bucketStart ? theme.brandText : point.ascentM > 0 ? theme.brandTint : theme.line }} />
        </View>
        <Text style={{ color: theme.muted, fontSize: sport.type.micro, textAlign: 'center' }} numberOfLines={2}>{point.label}</Text>
      </Pressable>)}
    </ScrollView>
    <Text style={{ color: theme.muted, fontSize: sport.type.caption, marginTop: sport.space.md }}>{selected.workouts} 次训练 · {selected.floors} 层 · 净爬楼 {formatDuration(selected.activeDurationMs)}</Text>
  </View>
}

const styles = StyleSheet.create({
  week: { flexDirection: 'row', alignItems: 'flex-end', gap: sport.space.xs },
  day: { flex: 1, minWidth: 12, alignItems: 'center', gap: sport.space.sm },
  track: { height: 60, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '64%', maxWidth: 14, borderRadius: 3 },
  dayLabel: { minWidth: 20, minHeight: 20, paddingHorizontal: 2, borderRadius: sport.radius.pill, justifyContent: 'center', alignItems: 'center' },
  dayText: { fontSize: sport.type.micro, fontWeight: '500' },
  round: { minHeight: 84, paddingVertical: sport.space.lg, flexDirection: 'row', alignItems: 'center', gap: sport.space.md },
  roundIndex: { width: 42, height: 46, borderRadius: sport.radius.small, alignItems: 'center', justifyContent: 'center' },
  roundHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sport.space.sm },
  roundTrack: { height: 4, borderRadius: sport.radius.pill, overflow: 'hidden' },
})
