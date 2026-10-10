import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import * as MediaLibrary from 'expo-media-library/legacy'
import * as Sharing from 'expo-sharing'
import React, { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { captureRef } from 'react-native-view-shot'

import { Disclosure } from '../components/disclosure'
import { Header } from '../components/Header'
import { BrandMark } from '../components/brand-mark'
import { Button } from '../components/ui'
import {
  DEFAULT_BODY_WEIGHT_KG,
  formatCalories,
} from '../core/calories'
import { formatDuration } from '../core/math'
import { workoutCalories } from '../core/fusion-workout'
import { ClimbWorkout, WorkoutSummary } from '../core/types'
import {
  buildSharePayload,
  formatShareDate,
  formatShareDuration,
  isShareableResult,
  shareOutcomeFromSheetResult,
  ShareOutcome,
} from '../core/share-payload'
import { calculateWorkoutSummary } from '../core/workout-summary'
import { deriveTrainingProgress } from '../core/training-progress'
import { RootStackScreen } from '../navigation/types'
import { getPreferences } from '../services/preferences'
import { getWorkout, listWorkouts, saveWorkout } from '../services/workout-storage'
import { Theme, useTheme, visual } from '../theme'

type EditorTab = 'template' | 'copy' | 'size'
type PosterTemplate = 'hero' | 'editorial' | 'report' | 'streak'
type PosterRatio = '4:5' | '3:4' | '1:1'
type ShareAction = 'save' | 'share'

interface WeekStats {
  floors: number
  ascentM: number
  workouts: number
  consecutiveWeeks: number
}

const LIGHT_STAIRCASE_IMAGE = require('../../assets/share/staircase-editorial-light.png')
const STAIRCASE_IMAGE = require('../../assets/share/staircase-editorial.png')

const QUOTES = [
  '',
  '今天不走平路，\n只往上。',
  '把压力变成海拔。',
  '一步一步，向上生活。',
  '楼梯不会辜负每一步。',
  '这周也在向上。',
  '周周向上，不掉线。',
]

const RATIO_VALUES: Record<PosterRatio, number> = {
  '4:5': 1.25,
  '3:4': 4 / 3,
  '1:1': 1,
}

const TEMPLATE_LABELS: Record<PosterTemplate, string> = {
  hero: '简洁',
  editorial: '画报',
  report: '数据',
  streak: '本周累计',
}

interface PosterProps {
  workout: ClimbWorkout
  summary: WorkoutSummary
  quote: string
  width: number
  calories: number
  template: PosterTemplate
  ratio: PosterRatio
  onImageReady: () => void
  week?: WeekStats
}

export const SharePoster = React.forwardRef<View, PosterProps>(
  ({ workout, summary, quote, width, calories, template, ratio, week, onImageReady }, ref) => {
    const compact = ratio === '1:1'
    const streak = template === 'streak'
    const unit = width / 320
    const P = visual.poster
    const floors = streak ? week?.floors ?? 0 : summary.totalFloors
    const ascent = streak ? week?.ascentM ?? 0 : summary.totalAscentM
    const typography = { color: P.ink, fontSize: 14 * unit }
    return <View ref={ref} collapsable={false} accessible accessibilityRole="image"
      accessibilityLabel={`成果海报：${floors} 层，日期 ${formatShareDate(workout.startedAt)}。地点与身份信息已隐藏。`}
      style={{ width, height: Math.round(width * RATIO_VALUES[ratio]), backgroundColor: P.background, overflow: 'hidden', borderRadius: 20 * unit }}>
      {template === 'editorial' ? <ImageBackground source={LIGHT_STAIRCASE_IMAGE} resizeMode="cover" style={StyleSheet.absoluteFill} imageStyle={{ opacity: 0.12 }} /> : null}
      <View style={{ flex: 1, padding: 24 * unit, alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 * unit }}>
          <BrandMark key={`${template}-${ratio}`} size={32 * unit} color={P.orange} onLoad={onImageReady} />
          <Text allowFontScaling={false} style={{ ...typography, fontSize: 28 * unit, fontWeight: '900' }}>循阶</Text>
        </View>
        <Text allowFontScaling={false} numberOfLines={2} style={{ ...typography, fontSize: (compact ? 23 : 32) * unit, fontWeight: '900', textAlign: 'center', lineHeight: 38 * unit }}>{quote || (streak ? '这周也在向上' : '每一步向上')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' }}>
          <Text allowFontScaling={false} numberOfLines={1} adjustsFontSizeToFit style={{ color: P.orange, fontSize: (compact ? 108 : 160) * unit, lineHeight: (compact ? 116 : 168) * unit, fontWeight: '900', fontVariant: ['tabular-nums'], maxWidth: width * 0.65, includeFontPadding: false }}>{floors}</Text>
          <Text allowFontScaling={false} style={{ color: P.orange, fontSize: 34 * unit, fontWeight: '900', marginLeft: 6 }}>层</Text>
        </View>
        <Text allowFontScaling={false} style={{ ...typography, color: P.muted, fontWeight: '800', fontSize: (compact ? 18 : 22) * unit }}>实际爬升 <Text style={{ color: P.orange, fontSize: (compact ? 24 : 28) * unit }}>{Math.round(ascent)}米</Text></Text>
        {template === 'report' ? <Text allowFontScaling={false} style={{ ...typography, color: P.muted, fontSize: 12 * unit }}>{summary.totalSteps} 步 · 估算 {formatCalories(calories)} 千卡</Text> : null}
        <View style={{ alignSelf: 'stretch', borderTopWidth: 1, borderTopColor: P.line, paddingTop: 12 * unit, alignItems: 'center', gap: 12 * unit }}>
          <Text allowFontScaling={false} style={{ ...typography, color: P.muted, fontSize: (compact ? 14 : 16) * unit, fontWeight: '700' }}>{streak ? `本周训练 ${week?.workouts ?? 0} 次 · 连续 ${week?.consecutiveWeeks ?? 0} 周` : `净爬楼 ${formatDuration(summary.activeDurationMs)} · 完成 ${summary.completeRounds} 轮`}</Text>
          <Text allowFontScaling={false} style={{ ...typography, color: P.muted, fontSize: 14 * unit }}>{formatShareDate(workout.startedAt).replace(/-/g, '.')}</Text>
        </View>
      </View>
    </View>
  },
)
SharePoster.displayName = 'SharePoster'

function PosterThumbnail({ active, template, workout, summary, calories, week, onPress }: {
  active: boolean; template: PosterTemplate; workout: ClimbWorkout; summary: WorkoutSummary;
  calories: number; week?: WeekStats; onPress: () => void
}) {
  const theme = useTheme()
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }}
    accessibilityLabel={`${TEMPLATE_LABELS[template]}模板`} onPress={onPress}
    style={{ width: 112, padding: 4, borderRadius: 10, borderWidth: 2, borderColor: active ? theme.brand : 'transparent' }}>
    <SharePoster width={100} ratio="4:5" template={template} workout={workout} summary={summary}
      calories={calories} week={week} quote={template === 'editorial' ? '持续向上' : template === 'report' ? '今天也向上了' : ''} onImageReady={() => {}} />
  </Pressable>
}

export default function ShareStudioScreen({
  navigation,
  route: screenRoute,
}: RootStackScreen<'ShareStudio'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { width: windowWidth } = useWindowDimensions()
  const styles = makeStyles(theme)
  const [workout, setWorkout] = useState<ClimbWorkout | null>(null)
  const [summary, setSummary] = useState<WorkoutSummary | null>(null)
  const [week, setWeek] = useState<WeekStats | null>(null)
  const [quote, setQuote] = useState(QUOTES[0])
  const [template, setTemplate] = useState<PosterTemplate>('hero')
  const [ratio, setRatio] = useState<PosterRatio>('4:5')
  const [editorTab, setEditorTab] = useState<EditorTab>('template')
  const [busyAction, setBusyAction] = useState<'save' | 'share' | null>(null)
  const [lastAction, setLastAction] = useState<ShareAction | null>(null)
  const [lastOutcome, setLastOutcome] = useState<ShareOutcome | null>(null)
  const [bodyWeightKg, setBodyWeightKg] = useState(DEFAULT_BODY_WEIGHT_KG)
  const posterRef = useRef<View>(null)
  const [readyTheme, setReadyTheme] = useState<boolean | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    let mounted = true
    setLoadError('')
    setWorkout(null)
    setSummary(null)
    setWeek(null)
    setReadyTheme(null)
    const load = async () => {
      try {
        const stored = await getWorkout(screenRoute.params.id)
        if (!stored) throw new Error('训练记录不存在')
        const all = await listWorkouts()
        if (!mounted) return
        const progress = deriveTrainingProgress(all, stored.endedAt ?? stored.startedAt)
        setWorkout(stored)
        setSummary(
          calculateWorkoutSummary(
            stored.rounds,
            stored.startedAt,
            stored.endedAt,
          ),
        )
        setWeek({ floors: progress.floors, ascentM: progress.ascentM, workouts: progress.validWorkouts, consecutiveWeeks: progress.consecutiveWeeks })
      } catch (error) {
        if (mounted) setLoadError(error instanceof Error && error.message === '训练记录不存在' ? '这条训练记录不存在。' : '暂时无法读取成绩，请重试。')
      }
    }
    void load()
    return () => { mounted = false }
  }, [screenRoute.params.id, loadAttempt])

  useEffect(() => {
    getPreferences()
      .then((prefs) => setBodyWeightKg(prefs.bodyWeightKg))
      .catch(() => undefined)
  }, [])

  const capturePoster = async () => {
    if (!posterRef.current) throw new Error('海报还没有准备好')
    if (readyTheme !== theme.isDark) throw new Error('海报正在准备，请稍后再试')
    return captureRef(posterRef, {
      format: 'png',
      quality: 1,
      width: 1080,
      height: Math.round(1080 * RATIO_VALUES[ratio]),
      result: 'tmpfile',
    })
  }

  const markPosterCreated = async () => {
    if (!workout || workout.sharePosterCreatedAt) return
    const updated = { ...workout, sharePosterCreatedAt: Date.now() }
    await saveWorkout(updated)
    setWorkout(updated)
  }

  /**
   * D10 验收 2：保存 / 分享的统一收口。
   *
   * 只有 `isShareableResult` 为真（即 'success'）才写「已生成分享海报」记录并给出成功文案；
   * 'cancelled'（用户取消 / 系统面板未回报）与 'failed' 一律不写记录、不显示成功。
   */
  const settleShareResult = async (
    action: ShareAction,
    outcome: ShareOutcome,
    detail?: string,
  ) => {
    setLastAction(action)
    setLastOutcome(outcome)
    if (!isShareableResult(outcome)) {
      if (!detail) return
      Alert.alert(
        outcome === 'failed'
          ? action === 'save'
            ? '保存失败'
            : '分享失败'
          : action === 'save'
            ? '未保存'
            : '未确认分享结果',
        detail,
      )
      return
    }
    await markPosterCreated()
    Alert.alert('完成', '海报已保存到相册，并记入分享记录。')
  }

  const savePoster = async () => {
    if (!workout || busyAction) return
    setBusyAction('save')
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true)
      if (permission.status !== 'granted') {
        await settleShareResult(
          'save',
          'cancelled',
          '没有获得相册权限，海报没有保存，也不会计入分享记录。',
        )
        return
      }
      const uri = await capturePoster()
      await MediaLibrary.saveToLibraryAsync(uri)
      await settleShareResult('save', 'success')
    } catch (error) {
      await settleShareResult(
        'save',
        'failed',
        error instanceof Error ? error.message : '请稍后再试。',
      )
    } finally {
      setBusyAction(null)
    }
  }

  const sharePoster = async () => {
    if (!workout || busyAction) return
    setBusyAction('share')
    try {
      const available = await Sharing.isAvailableAsync()
      if (!available) {
        await settleShareResult(
          'share',
          'failed',
          '这台设备没有可用的分享方式。',
        )
        return
      }
      const uri = await capturePoster()
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle: '分享我的爬楼成果',
      })
      // 分享面板返回 ≠ 用户真的发出去了（Android chooser 恒返回 sharedAction，
      // iOS 也不回报结果），所以这里按「未确认」收口：不写记录、不显示成功。
      await settleShareResult(
        'share',
        shareOutcomeFromSheetResult('resolved'),
      )
    } catch (error) {
      await settleShareResult(
        'share',
        'failed',
        error instanceof Error ? error.message : '无法生成分享海报。',
      )
    } finally {
      setBusyAction(null)
    }
  }

  const copyWorkoutData = async () => {
    if (!workout || !summary) return
    // D10：分享文本只能由 core/share-payload 生成（地点/身份/时分秒已剔除），
    // 页面不得再自行拼接任何一行分享文案。
    const payload = buildSharePayload({
      workout,
      mode: 'summary',
      includeRouteName: false,
      includeDate: true,
    })
    const text = `${payload.title}\n${payload.body}`

    try {
      await Clipboard.setStringAsync(text)
      Alert.alert(
        '复制成功',
        `运动数据已经复制，并已剔除 ${payload.redacted.length} 项隐私字段（地点、身份、时分秒），可以直接交给文生图软件。`,
      )
    } catch {
      Alert.alert('复制失败', '暂时无法复制运动数据，请稍后再试。')
    }
  }

  if (!workout || !summary) {
    return (
      <View style={styles.page}>
        <Header title="分享成绩" back />
        <View style={styles.center}>
          <Text
            style={styles.loadingText}
            accessibilityLiveRegion="polite"
            accessibilityLabel={loadError || '正在制作你的成果'}
          >
            {loadError || '正在制作你的成果…'}
          </Text>
          {loadError ? <>
            <Button title="重新读取" onPress={() => setLoadAttempt(value => value + 1)} />
            <Button title="返回训练总结" style={{ marginTop: 12 }} variant="secondary" onPress={() => navigation.goBack()} />
          </> : <ActivityIndicator color={theme.brand} />}
        </View>
      </View>
    )
  }

  const posterWidth = Math.min(328, windowWidth - 64)
  // 热量按爬升机械功 + 活动/休息代谢估算（与结算页同一口径）。
  const calories = workoutCalories({ ...workout, bodyWeightKg: workout.bodyWeightKg ?? bodyWeightKg })
  // D10：页面不再自己拼分享文案；隐私剔除结果（redacted）由纯函数给出，UI 只负责展示。
  const sharePayload = buildSharePayload({
    workout,
    mode: 'summary',
    includeRouteName: false,
    includeDate: true,
  })
  const editorTabs: Array<{ key: EditorTab; label: string }> = [
    { key: 'template', label: '模板' },
    { key: 'copy', label: '文案' },
    { key: 'size', label: '尺寸' },
  ]
  const outcomeLabel = (() => {
    if (!lastOutcome) return ''
    if (isShareableResult(lastOutcome)) {
      return '已确认保存成功，并记入分享记录。'
    }
    if (lastAction === 'share') {
      return '未确认分享结果：系统分享面板不会回报用户是否真的发出，本次不计为成功。'
    }
    return lastOutcome === 'failed'
      ? '操作失败：没有记入分享记录。'
      : '已取消：没有记入分享记录。'
  })()

  return (
    <View style={styles.page}>
      <Header title="分享成绩" back />
      <ScrollView
        style={styles.flex}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: 32 }]}
      >
        <View style={styles.previewHeading}>
          <Text style={styles.previewLabel}>成果预览</Text>
          <Text style={styles.previewRatio}>{ratio}</Text>
        </View>
        <View style={styles.previewWrap}>
          <SharePoster
            key={theme.isDark ? 'dark' : 'light'}
            ref={posterRef}
            onImageReady={() => setReadyTheme(theme.isDark)}
            workout={workout}
            summary={summary}
            quote={quote}
            width={posterWidth}
            calories={calories}
            template={template}
            ratio={ratio}
            week={week ?? undefined}
          />
        </View>
        <View
          style={styles.privacyRow}
          accessible
          accessibilityRole="text"
          accessibilityLabel={'分享内容已隐藏 ' + sharePayload.redacted.length + ' 项隐私字段：' + sharePayload.redacted.join('、')}
        >
          <MaterialCommunityIcons name="lock" size={16} color={theme.mutedStrong} />
          <Text style={styles.privacyText}>地点已隐藏 · 不含身份信息</Text>
        </View>
        {outcomeLabel ? <Text style={styles.outcomeText} accessibilityLiveRegion="polite" accessibilityLabel={outcomeLabel}>{outcomeLabel}</Text> : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><Text accessibilityRole="header" style={styles.sectionTitle}>海报样式</Text>
        <View style={styles.editorTabs} accessibilityRole="tablist">
          {editorTabs.map(tab => <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: editorTab === tab.key }}
            onPress={() => setEditorTab(tab.key)}
            style={[styles.editorTab, editorTab === tab.key && styles.editorTabActive]}
          ><Text style={[styles.editorTabText, editorTab === tab.key && styles.editorTabTextActive]}>{tab.label}</Text></Pressable>)}
        </View>

        </View>
        {editorTab === 'template' ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnailRow}>
          {(['hero', 'editorial', 'report', 'streak'] as PosterTemplate[]).map(value => <PosterThumbnail
            key={value}
            active={template === value}
            template={value}
            workout={workout} summary={summary} calories={calories} week={week ?? undefined}
            onPress={() => { if (value !== template) { setReadyTheme(null); setTemplate(value) } }}
          />)}
        </ScrollView> : null}

        {editorTab === 'copy' ? <View style={styles.optionList}>
          {QUOTES.map(item => <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: quote === item }}
            accessibilityLabel={item.replace('\n', '') || '无文案'}
            onPress={() => setQuote(item)}
            style={[styles.option, quote === item && styles.optionActive]}
          >
            <Text style={[styles.optionText, quote === item && styles.optionTextActive]}>{item.replace('\n', '') || '无文案'}</Text>
          </Pressable>)}
        </View> : null}

        {editorTab === 'size' ? <View style={styles.sizeRow}>
          {(Object.keys(RATIO_VALUES) as PosterRatio[]).map(item => <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: ratio === item }}
            accessibilityLabel={item + ' ' + (item === '4:5' ? '社交平台' : item === '3:4' ? '手机海报' : '方形图片')}
            onPress={() => setRatio(item)}
            style={[styles.sizeOption, ratio === item && styles.sizeOptionActive]}
          >
            <Text style={[styles.sizeValue, ratio === item && styles.sizeValueActive]}>{item}</Text>
            <Text style={styles.sizeHint}>{item === '4:5' ? '社交平台' : item === '3:4' ? '手机海报' : '方形图片'}</Text>
          </Pressable>)}
        </View> : null}

        <Disclosure title="复制成绩数据" summary="文字分享">
          <Text style={styles.copyNote}>仅复制运动摘要，地点、身份与具体时分秒已剔除。</Text>
          <Button title="复制数据" variant="secondary" disabled={busyAction !== null} onPress={copyWorkoutData} />
        </Disclosure>
      </ScrollView>
      <View style={[styles.dock, { paddingBottom: insets.bottom + 12 }]}>
        <Button
          title={busyAction === 'save' ? '保存中…' : '保存图片'}
          variant="secondary"
          fullWidth={false}
          style={styles.dockButton}
          accessibilityLabel="保存图片到相册"
          accessibilityState={{ disabled: busyAction !== null, busy: busyAction === 'save' }}
          disabled={busyAction !== null}
          onPress={savePoster}
        />
        <Button
          title={busyAction === 'share' ? '生成中…' : '立即分享'}
          fullWidth={false}
          style={styles.dockButton}
          accessibilityLabel="立即分享海报"
          accessibilityState={{ disabled: busyAction !== null, busy: busyAction === 'share' }}
          disabled={busyAction !== null}
          onPress={sharePoster}
        />
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: theme.pagePaddingH, paddingTop: 4, gap: 10,},
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
    loadingText: { color: theme.mutedStrong, fontSize: 15, lineHeight: 22, marginBottom: 24 },
    previewHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    previewLabel: { color: theme.ink, fontSize: 16, lineHeight: 21, fontWeight: '800',},
    previewRatio: { color: theme.mutedStrong, fontSize: 12, lineHeight: 18, fontVariant: ['tabular-nums'] },
    previewWrap: { alignItems: 'center', paddingVertical: 0, backgroundColor: 'transparent', borderRadius: 20 },
    privacyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 32 },
    privacyText: { color: theme.mutedStrong, fontSize: 12, lineHeight: 18, flexShrink: 1 },
    sectionTitle: { color: theme.ink, fontSize: 20, lineHeight: 24, fontWeight: '900', marginTop: 0 },
    editorTabs: { flexDirection: 'row', flex: 1, minWidth: 210, padding: 3, borderRadius: 24, backgroundColor: theme.card, gap: 0 },
    editorTab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4 },
    editorTabActive: { backgroundColor: theme.brand,},
    editorTabText: { color: theme.mutedStrong, fontSize: 14, lineHeight: 21, fontWeight: '500' },
    editorTabTextActive: { color: theme.onBrand, fontWeight: '800',},
    thumbnailRow: { flexDirection: 'row', flexWrap: 'nowrap', gap: 8,},
    optionList: { gap: 8 },
    option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card },
    optionActive: { borderColor: theme.brand, backgroundColor: theme.brandSoft },
    optionText: { flex: 1, color: theme.ink, fontSize: 15, lineHeight: 22 },
    optionTextActive: { color: theme.brand, fontWeight: '600' },
    sizeRow: { flexDirection: 'row', gap: 12 },
    sizeOption: { flex: 1, minHeight: 88, alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 14, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card },
    sizeOptionActive: { borderColor: theme.brand, backgroundColor: theme.brandSoft },
    sizeValue: { color: theme.ink, fontSize: 24, lineHeight: 32, fontWeight: '600', fontVariant: ['tabular-nums'] },
    sizeValueActive: { color: theme.brand },
    sizeHint: { marginTop: 4, color: theme.mutedStrong, fontSize: 12, lineHeight: 18, textAlign: 'center' },
    copyNote: { color: theme.mutedStrong, fontSize: 14, lineHeight: 21, marginBottom: 16 },
    outcomeText: { color: theme.mutedStrong, fontSize: 14, lineHeight: 21 },
    dock: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 8, backgroundColor: theme.paper, borderTopWidth: 0, borderTopColor: theme.line },
    dockButton: { flex: 1 },
  })
