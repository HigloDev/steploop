import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { captureRef } from 'react-native-view-shot'
import * as Clipboard from 'expo-clipboard'
import * as MediaLibrary from 'expo-media-library/legacy'
import * as Sharing from 'expo-sharing'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Header } from '../components/Header'
import { BrandMark } from '../components/brand-mark'
import { Button } from '../components/ui'
import { NativeChoice } from '../components/native-choice'
import { AchievementBuilding } from '../components/achievement-building'
import { ascentReference, describeAscent } from '../core/landmarks'
import { WeeklyAchievement, buildWeeklyAchievement, weeklyDateRange, weeklyShareText } from '../core/weekly-achievement'
import type { RootStackScreen } from '../navigation/types'
import { listWorkouts } from '../services/workout-storage'
import { triggerHaptic } from '../services/preferences'
import { useTheme, visual } from '../theme'

type Template = 'weekly' | 'height'

export const WeeklyPoster = React.forwardRef<View, { week: WeeklyAchievement; width: number; template: Template; onReady: () => void }>(
  ({ week, width, template, onReady }, ref) => {
    const u = width / 320, P = visual.poster
    const next = ascentReference(week.ascentM)
    const maximum = Math.max(1, ...week.days.map(day => day.floors))
    const text = { color: P.ink, fontSize: 12 * u }
    return <View ref={ref} collapsable={false} accessible accessibilityRole="image" accessibilityLabel={`本周成果海报，${week.floors} 层，${Math.round(week.ascentM)} 米，${week.workouts} 次训练`}
      style={{ width, height: width * 1.25, backgroundColor: P.background, borderRadius: 20 * u, overflow: 'hidden', padding: 22 * u, justifyContent: 'space-between' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 * u }}><BrandMark size={25 * u} color={P.orange} onLoad={onReady} />
          <Text allowFontScaling={false} style={{ ...text, fontSize: 23 * u, fontWeight: '900' }}>循阶</Text></View>
        <Text allowFontScaling={false} style={{ ...text, fontSize: 9 * u, color: P.muted, fontWeight: '700', letterSpacing: 1.5 * u }}>WEEKLY / UP</Text>
      </View>
      <View><Text allowFontScaling={false} style={{ ...text, fontSize: 25 * u, fontWeight: '900', lineHeight: 32 * u }}>{template === 'weekly' ? '这周也在向上。' : '把每一步，变成高度。'}</Text>
        <Text allowFontScaling={false} style={{ ...text, fontSize: 10 * u, color: P.muted, marginTop: 5 * u }}>{weeklyDateRange(week)}</Text></View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}><View style={{ flexDirection: 'row', alignItems: 'baseline' }}><Text allowFontScaling={false} numberOfLines={1} adjustsFontSizeToFit
          style={{ color: P.orange, fontSize: 82 * u, lineHeight: 86 * u, fontWeight: '900', fontVariant: ['tabular-nums'], flexShrink: 1, includeFontPadding: false }}>{week.floors}</Text>
          <Text allowFontScaling={false} style={{ ...text, fontSize: 22 * u, color: P.orange, fontWeight: '900' }}>层</Text></View>
          <Text allowFontScaling={false} style={{ ...text, fontWeight: '800', fontSize: 14 * u, marginTop: 4 * u }}>累计向上 {Math.round(week.ascentM)} 米</Text>
        </View>
        <AchievementBuilding floors={week.floors} width={100 * u} colors={{ ink: P.ink, card: P.background, line: P.line, brand: P.orange, brandSoft: '#f6d3b5' }} />
      </View>
      {template === 'weekly' ? <View style={{ flexDirection: 'row', gap: 8 * u, alignItems: 'flex-end', height: 53 * u }}>
        {week.days.map(day => <View key={day.at} style={{ flex: 1, alignItems: 'center' }}>
          <View style={{ width: 18 * u, height: Math.max(3, day.floors / maximum * 34) * u, borderRadius: 3 * u, backgroundColor: day.floors ? P.orange : P.line }} />
          <Text allowFontScaling={false} style={{ ...text, color: P.muted, fontSize: 9 * u, marginTop: 5 * u }}>{day.label}</Text>
        </View>)}
      </View> : <View style={{ borderLeftWidth: 3 * u, borderLeftColor: P.orange, paddingLeft: 12 * u, gap: 5 * u }}>
        <Text allowFontScaling={false} numberOfLines={1} style={{ ...text, fontSize: 14 * u, fontWeight: '800' }}>{describeAscent(week.ascentM)}</Text>
        <Text allowFontScaling={false} numberOfLines={2} style={{ ...text, color: P.muted, fontSize: 10 * u }}>{next.next ? `下一站 ${next.next.name} · 还差 ${Math.ceil(next.remainingM)} 米` : '一步一步，已达到珠峰相当高度'}</Text>
      </View>}
      <View style={{ borderTopWidth: 1, borderTopColor: P.line, paddingTop: 10 * u }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {[`${week.workouts} 次训练`, `${week.steps} 步`, `约 ${Math.round(week.calories)} 千卡`].map(value => <Text key={value} allowFontScaling={false} style={{ ...text, fontSize: 11 * u, fontWeight: '700' }}>{value}</Text>)}
        </View>
        <Text allowFontScaling={false} style={{ ...text, fontSize: 10 * u, color: P.muted, marginTop: 10 * u }}>一步一步，向上生活。                         STEPLOOP</Text>
      </View>
    </View>
  },
)
WeeklyPoster.displayName = 'WeeklyPoster'

export default function WeeklyShareScreen({ navigation }: RootStackScreen<'WeeklyShare'>) {
  const theme = useTheme(), insets = useSafeAreaInsets(), { width } = useWindowDimensions()
  const [week, setWeek] = useState<WeeklyAchievement>()
  const [template, setTemplate] = useState<Template>('weekly')
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<'save' | 'share' | null>(null)
  const [readyKey, setReadyKey] = useState('')
  const poster = useRef<View>(null)
  const busyRef = useRef(false)
  const key = `${theme.isDark}-${template}-${width}-${week?.weekStart}`
  useEffect(() => {
    let active = true
    setError('')
    void listWorkouts().then(workouts => { if (active) setWeek(buildWeeklyAchievement(workouts)) })
      .catch(() => { if (active) setError('本周记录暂时无法读取，请重试。') })
    return () => { active = false }
  }, [attempt])
  const exportPoster = async (action: 'save' | 'share') => {
    if (!week?.workouts || busyRef.current) return
    busyRef.current = true; setBusy(action); setMessage('')
    try {
      if (!poster.current || readyKey !== key) throw new Error('海报正在准备，请稍后再试。')
      if (action === 'save') {
        const permission = await MediaLibrary.requestPermissionsAsync(true)
        if (!permission.granted) { setMessage('没有获得相册权限，海报未保存。'); return }
      } else if (!(await Sharing.isAvailableAsync())) throw new Error('这台设备暂时没有可用的分享方式。')
      const uri = await captureRef(poster, { format: 'png', quality: 1, width: 1080, height: 1350, result: 'tmpfile' })
      if (action === 'save') { await MediaLibrary.saveToLibraryAsync(uri); setMessage('本周成果海报已保存到相册。'); void triggerHaptic('success') }
      else { await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: '分享本周爬楼成果' }); setMessage('已返回分享页面。可继续保存海报或选择分享方式。') }
    } catch (e) { setMessage(e instanceof Error ? e.message : '无法导出海报，请重试。'); void triggerHaptic('error') }
    finally { busyRef.current = false; setBusy(null) }
  }
  return <View style={{ flex: 1, backgroundColor: theme.paper }}>
    <Header title="本周成果分享" back />
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, gap: 16 }}>
      {error ? <><Text selectable style={{ color: theme.redInk }}>{error}</Text><Button title="重新读取" onPress={() => setAttempt(value => value + 1)} /></>
        : !week ? <ActivityIndicator color={theme.brand} style={{ marginTop: 100 }} /> : !week.workouts ? <View style={{ alignItems: 'center', gap: 20, marginTop: 40, padding: 24, borderRadius: 24, backgroundColor: theme.card }}>
          <AchievementBuilding floors={0} width={150} />
          <Text accessibilityRole="header" style={{ color: theme.ink, fontSize: 23, fontWeight: '900', textAlign: 'center' }}>本周还没有训练</Text>
          <Text style={{ color: theme.inkSoft, fontSize: 15, lineHeight: 24, textAlign: 'center' }}>从今天的第一层开始。完成训练后，就能把一周的成果做成海报。</Text>
          <Button title="去爬一会儿" onPress={() => navigation.navigate('Main', { screen: 'Train' })} />
        </View> : <>
          <Text style={{ color: theme.muted, fontSize: 13, textAlign: 'center' }}>一整周的向上，做成一张海报</Text>
          <View style={{ alignItems: 'center' }}><WeeklyPoster key={key} ref={poster} week={week} width={Math.min(360, width - 40)} template={template} onReady={() => setReadyKey(key)} /></View>
          <NativeChoice value={template} onChange={value => { setTemplate(value); setMessage('') }} options={[{ value: 'weekly', label: '本周周报' }, { value: 'height', label: '高度足迹' }]} />
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}><MaterialCommunityIcons name="shield-check-outline" size={18} color={theme.mutedStrong} accessible={false} />
            <Text style={{ color: theme.mutedStrong, fontSize: 12, lineHeight: 18, flex: 1 }}>只分享本周汇总，不含楼栋名称、地址、身份和逐次训练详情。热量为估算。</Text></View>
          <>
            <View style={{ flexDirection: 'row', gap: 12 }}><Button title="保存海报" variant="secondary" fullWidth={false} style={{ flex: 1 }} disabled={busy !== null || readyKey !== key} loading={busy === 'save'} onPress={() => void exportPoster('save')} />
              <Button title="分享本周成果" fullWidth={false} style={{ flex: 1 }} disabled={busy !== null || readyKey !== key} loading={busy === 'share'} onPress={() => void exportPoster('share')} /></View>
            <Pressable accessibilityRole="button" accessibilityLabel="复制本周分享文案" disabled={busy !== null} onPress={() => { void Clipboard.setStringAsync(weeklyShareText(week)).then(() => { setMessage('本周分享文案已复制。'); void triggerHaptic('success') }).catch(() => setMessage('暂时无法复制，请重试。')) }}
              style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: theme.brandInk, fontSize: 14, fontWeight: '700' }}>复制分享文案</Text></Pressable>
          </>
          {message ? <Text accessibilityLiveRegion="polite" style={{ color: theme.inkSoft, fontSize: 14, lineHeight: 22, textAlign: 'center' }}>{message}</Text> : null}
        </>}
    </ScrollView>
  </View>
}
