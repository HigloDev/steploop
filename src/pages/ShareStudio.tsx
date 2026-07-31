import { Feather } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import * as MediaLibrary from 'expo-media-library/legacy'
import * as Sharing from 'expo-sharing'
import React, { useEffect, useRef, useState } from 'react'
import {
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

import { Header } from '../components/Header'
import {
  calculateStairCalories,
  DEFAULT_BODY_WEIGHT_KG,
  formatCalories,
} from '../core/calories'
import { formatDuration } from '../core/math'
import { ClimbWorkout, WorkoutSummary } from '../core/types'
import { calculateWorkoutSummary } from '../core/workout-summary'
import { RootStackScreen } from '../navigation/types'
import { getPreferences } from '../services/preferences'
import { getWorkout, saveWorkout } from '../services/workout-storage'
import { Theme, useTheme } from '../theme'

type EditorTab = 'template' | 'copy' | 'size'
type PosterTemplate = 'hero' | 'editorial' | 'report'
type PosterRatio = '4:5' | '3:4' | '1:1'
type LocationMode = 'name' | 'hidden'

const STAIRCASE_IMAGE = require('../../assets/share/staircase-editorial.png')

const QUOTES = [
  '今天不走平路，\n只往上。',
  '把压力变成海拔。',
  '一步一步，向上生活。',
  '楼梯不会辜负每一步。',
]

const RATIO_VALUES: Record<PosterRatio, number> = {
  '4:5': 1.25,
  '3:4': 1.34,
  '1:1': 1,
}

function dateText(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}.${String(date.getDate()).padStart(2, '0')}`
}

function trimDuration(value: string): string {
  return value.replace(/^00:/, '')
}

function displayLocation(workout: ClimbWorkout): string {
  return (
    workout.routeSnapshot.locationName.trim() ||
    workout.routeSnapshot.name.trim() ||
    '本次爬楼地点'
  )
}

interface PosterProps {
  workout: ClimbWorkout
  summary: WorkoutSummary
  quote: string
  width: number
  calories: number
  template: PosterTemplate
  ratio: PosterRatio
  locationMode: LocationMode
}

const SharePoster = React.forwardRef<View, PosterProps>(
  (
    {
      workout,
      summary,
      quote,
      width,
      calories,
      template,
      ratio,
      locationMode,
    },
    ref,
  ) => {
    const height = Math.round(width * RATIO_VALUES[ratio])
    const compact = ratio === '1:1'
    const isHero = template === 'hero'
    const isReport = template === 'report'

    return (
      <View
        ref={ref}
        collapsable={false}
        style={[posterStyles.poster, { width, height }]}
      >
        <ImageBackground
          source={STAIRCASE_IMAGE}
          resizeMode="cover"
          imageStyle={[
            posterStyles.image,
            template === 'editorial' && posterStyles.imageEditorial,
            isReport && posterStyles.imageReport,
          ]}
          style={posterStyles.imageBackground}
        >
          <View
            style={[
              posterStyles.shade,
              template === 'editorial' && posterStyles.shadeEditorial,
              isReport && posterStyles.shadeReport,
            ]}
          />

          <View style={posterStyles.posterContent}>
            <Text style={posterStyles.brand}>循阶</Text>

            <View style={[posterStyles.heroBlock, compact && posterStyles.heroBlockCompact]}>
              <View style={posterStyles.numberRow}>
                <Text
                  style={[
                    posterStyles.heroNumber,
                    compact && posterStyles.heroNumberCompact,
                    isReport && posterStyles.heroNumberReport,
                  ]}
                >
                  {summary.totalFloors}
                </Text>
                <Text style={posterStyles.heroUnit}>层</Text>
              </View>

              <View style={posterStyles.rule} />

              <View style={posterStyles.metricLine}>
                <Text style={posterStyles.metricLabel}>累计爬升</Text>
                <Text style={posterStyles.metricValue}>
                  {summary.totalAscentM.toFixed(0)}
                  <Text style={posterStyles.metricUnit}>米</Text>
                </Text>
              </View>
              <View style={posterStyles.metricLine}>
                <Feather name="clock" size={14} color="#8fe8c3" />
                <Text style={posterStyles.metricValueSmall}>
                  {trimDuration(formatDuration(summary.activeDurationMs))}
                </Text>
              </View>
              <View style={posterStyles.metricLine}>
                <Feather name="activity" size={14} color="#8fe8c3" />
                <Text style={posterStyles.metricValueSmall}>
                  {formatCalories(calories)}千卡
                </Text>
              </View>
            </View>

            <View style={posterStyles.posterFooter}>
              <Text style={posterStyles.date}>{dateText(workout.startedAt)}</Text>
              {locationMode === 'name' ? (
                <Text style={posterStyles.location} numberOfLines={1}>
                  {displayLocation(workout)}
                </Text>
              ) : null}
              <View style={posterStyles.shortRule} />
              <Text
                style={[
                  posterStyles.quote,
                  compact && posterStyles.quoteCompact,
                  !isHero && posterStyles.quoteSecondary,
                ]}
              >
                {quote}
              </Text>
            </View>
          </View>
        </ImageBackground>
      </View>
    )
  },
)
SharePoster.displayName = 'SharePoster'

function PosterThumbnail({
  active,
  template,
  floors,
  onPress,
}: {
  active: boolean
  template: PosterTemplate
  floors: number
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[stylesStatic.thumbnail, active && stylesStatic.thumbnailActive]}
    >
      <ImageBackground
        source={STAIRCASE_IMAGE}
        resizeMode="cover"
        imageStyle={stylesStatic.thumbnailImage}
        style={stylesStatic.thumbnailBackground}
      >
        <View style={stylesStatic.thumbnailShade} />
        <Text style={stylesStatic.thumbnailBrand}>循阶</Text>
        <Text
          style={[
            stylesStatic.thumbnailNumber,
            template === 'report' && stylesStatic.thumbnailNumberReport,
          ]}
        >
          {floors}
        </Text>
        <Text style={stylesStatic.thumbnailUnit}>层</Text>
        <View style={stylesStatic.thumbnailRule} />
        <Text style={stylesStatic.thumbnailCopy}>
          {template === 'editorial' ? '只往上。' : '今天不走平路'}
        </Text>
      </ImageBackground>
    </Pressable>
  )
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
  const [quote, setQuote] = useState(QUOTES[0])
  const [template, setTemplate] = useState<PosterTemplate>('hero')
  const [ratio, setRatio] = useState<PosterRatio>('4:5')
  const [editorTab, setEditorTab] = useState<EditorTab>('template')
  const [locationMode, setLocationMode] = useState<LocationMode>('name')
  const [busyAction, setBusyAction] = useState<'save' | 'share' | null>(null)
  const [bodyWeightKg, setBodyWeightKg] = useState(DEFAULT_BODY_WEIGHT_KG)
  const posterRef = useRef<View>(null)

  useEffect(() => {
    getWorkout(screenRoute.params.id)
      .then((stored) => {
        if (!stored) return
        setWorkout(stored)
        setSummary(
          calculateWorkoutSummary(
            stored.rounds,
            stored.startedAt,
            stored.endedAt,
          ),
        )
      })
      .catch(() => undefined)
  }, [screenRoute.params.id])

  useEffect(() => {
    getPreferences()
      .then((prefs) => setBodyWeightKg(prefs.bodyWeightKg))
      .catch(() => undefined)
  }, [])

  const capturePoster = async () => {
    if (!posterRef.current) throw new Error('海报还没有准备好')
    return captureRef(posterRef, {
      format: 'png',
      quality: 1,
      result: 'tmpfile',
    })
  }

  const markPosterCreated = async () => {
    if (!workout || workout.sharePosterCreatedAt) return
    const updated = { ...workout, sharePosterCreatedAt: Date.now() }
    await saveWorkout(updated)
    setWorkout(updated)
  }

  const savePoster = async () => {
    if (!workout || busyAction) return
    setBusyAction('save')
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(
        true,
        ['photo'],
      )
      if (permission.status !== 'granted') {
        Alert.alert('无法保存', '请允许循阶把海报保存到手机相册。')
        return
      }
      const uri = await capturePoster()
      await MediaLibrary.saveToLibraryAsync(uri)
      await markPosterCreated()
      Alert.alert('保存成功', '海报已经保存到手机相册。')
    } catch (error) {
      Alert.alert(
        '保存失败',
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
        Alert.alert('暂时无法分享', '这台设备没有可用的分享方式。')
        return
      }
      const uri = await capturePoster()
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle: '分享我的爬楼成果',
      })
      await markPosterCreated()
    } catch (error) {
      Alert.alert(
        '分享失败',
        error instanceof Error ? error.message : '无法生成分享海报。',
      )
    } finally {
      setBusyAction(null)
    }
  }

  const copyWorkoutData = async () => {
    if (!workout || !summary) return
    const calories = calculateStairCalories(
      summary.activeDurationMs,
      bodyWeightKg,
    )
    const text = [
      '我的爬楼运动数据',
      `日期：${dateText(workout.startedAt)}`,
      `地点：${displayLocation(workout)}`,
      `爬升楼层：${summary.totalFloors}层`,
      `累计爬升：${summary.totalAscentM.toFixed(1)}米`,
      `消耗热量：${formatCalories(calories)}千卡`,
      `净爬楼时间：${formatDuration(summary.activeDurationMs)}`,
      `累计步数：${summary.totalSteps}步`,
      `分享文案：${quote.replace('\n', '')}`,
    ].join('\n')

    try {
      await Clipboard.setStringAsync(text)
      Alert.alert('复制成功', '运动数据已经复制，可以直接交给文生图软件。')
    } catch {
      Alert.alert('复制失败', '暂时无法复制运动数据，请稍后再试。')
    }
  }

  if (!workout || !summary) {
    return (
      <View style={styles.page}>
        <Header title="分享工作室" back />
        <View style={styles.center}>
          <Text style={styles.loadingText}>正在制作你的成果…</Text>
        </View>
      </View>
    )
  }

  const posterWidth = Math.min(360, windowWidth - 40)
  const calories = calculateStairCalories(
    summary.activeDurationMs,
    bodyWeightKg,
  )
  const editorTabs: Array<{ key: EditorTab; label: string }> = [
    { key: 'template', label: '模板' },
    { key: 'copy', label: '文案' },
    { key: 'size', label: '尺寸' },
  ]

  return (
    <View style={styles.page}>
      <Header title="分享工作室" back />
      <ScrollView
        style={styles.flex}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 28 },
        ]}
      >
        <View style={styles.previewWrap}>
          <SharePoster
            ref={posterRef}
            workout={workout}
            summary={summary}
            quote={quote}
            width={posterWidth}
            calories={calories}
            template={template}
            ratio={ratio}
            locationMode={locationMode}
          />
        </View>

        <View style={styles.editorTabs}>
          {editorTabs.map((tab) => (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: editorTab === tab.key }}
              onPress={() => setEditorTab(tab.key)}
              style={[
                styles.editorTab,
                editorTab === tab.key && styles.editorTabActive,
              ]}
            >
              <Text
                style={[
                  styles.editorTabText,
                  editorTab === tab.key && styles.editorTabTextActive,
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {editorTab === 'template' ? (
          <View style={styles.thumbnailRow}>
            <PosterThumbnail
              active={template === 'hero'}
              template="hero"
              floors={summary.totalFloors}
              onPress={() => setTemplate('hero')}
            />
            <PosterThumbnail
              active={template === 'editorial'}
              template="editorial"
              floors={summary.totalFloors}
              onPress={() => setTemplate('editorial')}
            />
            <PosterThumbnail
              active={template === 'report'}
              template="report"
              floors={summary.totalFloors}
              onPress={() => setTemplate('report')}
            />
          </View>
        ) : null}

        {editorTab === 'copy' ? (
          <View style={styles.optionList}>
            {QUOTES.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: quote === item }}
                onPress={() => setQuote(item)}
                style={[
                  styles.option,
                  quote === item && styles.optionActive,
                ]}
              >
                <Text
                  style={[
                    styles.optionText,
                    quote === item && styles.optionTextActive,
                  ]}
                >
                  {item.replace('\n', '')}
                </Text>
                {quote === item ? (
                  <Feather name="check" size={18} color={theme.green} />
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}

        {editorTab === 'size' ? (
          <View style={styles.sizeRow}>
            {(Object.keys(RATIO_VALUES) as PosterRatio[]).map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: ratio === item }}
                onPress={() => setRatio(item)}
                style={[
                  styles.sizeOption,
                  ratio === item && styles.sizeOptionActive,
                ]}
              >
                <Text
                  style={[
                    styles.sizeValue,
                    ratio === item && styles.sizeValueActive,
                  ]}
                >
                  {item}
                </Text>
                <Text style={styles.sizeHint}>
                  {item === '4:5' ? '社交平台' : item === '3:4' ? '手机海报' : '方形图片'}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={() =>
            setLocationMode((current) =>
              current === 'name' ? 'hidden' : 'name',
            )
          }
          style={styles.locationRow}
        >
          <View style={styles.locationLeft}>
            <Feather name="lock" size={16} color={theme.muted} />
            <Text style={styles.locationText}>
              地点：{locationMode === 'name' ? '仅名称' : '不显示'}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={theme.muted} />
        </Pressable>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={busyAction !== null}
            onPress={savePoster}
            style={({ pressed }) => [
              styles.actionButton,
              styles.actionOutline,
              pressed && styles.actionPressed,
            ]}
          >
            <Feather name="download" size={19} color={theme.green} />
            <Text style={styles.actionOutlineText}>
              {busyAction === 'save' ? '保存中…' : '保存图片'}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={busyAction !== null}
            onPress={sharePoster}
            style={({ pressed }) => [
              styles.actionButton,
              styles.actionPrimary,
              pressed && styles.actionPressed,
            ]}
          >
            <Feather name="share-2" size={19} color="#07100f" />
            <Text style={styles.actionPrimaryText}>
              {busyAction === 'share' ? '生成中…' : '立即分享'}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={copyWorkoutData}
            style={({ pressed }) => [
              styles.actionButton,
              styles.actionOutline,
              pressed && styles.actionPressed,
            ]}
          >
            <Feather name="copy" size={18} color={theme.green} />
            <Text style={styles.actionOutlineText}>复制数据</Text>
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.goBack()}
          style={styles.backToResult}
        >
          <Text style={styles.backToResultText}>返回训练总结</Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}

const posterStyles = StyleSheet.create({
  poster: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#294139',
    backgroundColor: '#070d0b',
  },
  imageBackground: { flex: 1 },
  image: { opacity: 0.7 },
  imageEditorial: { opacity: 0.55, transform: [{ scaleX: -1 }] },
  imageReport: { opacity: 0.42 },
  shade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(3, 10, 8, 0.42)',
  },
  shadeEditorial: { backgroundColor: 'rgba(3, 10, 8, 0.55)' },
  shadeReport: { backgroundColor: 'rgba(3, 10, 8, 0.63)' },
  posterContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 22,
    justifyContent: 'space-between',
  },
  brand: {
    color: '#8fe8c3',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  heroBlock: { marginTop: -12, width: '72%' },
  heroBlockCompact: { marginTop: 2 },
  numberRow: { flexDirection: 'row', alignItems: 'flex-end' },
  heroNumber: {
    color: '#a7efd1',
    fontSize: 112,
    lineHeight: 116,
    fontWeight: '900',
    letterSpacing: -6,
    fontVariant: ['tabular-nums'],
  },
  heroNumberCompact: { fontSize: 88, lineHeight: 92 },
  heroNumberReport: { fontSize: 92, lineHeight: 98 },
  heroUnit: {
    paddingBottom: 16,
    paddingLeft: 8,
    color: '#a7efd1',
    fontSize: 26,
    fontWeight: '800',
  },
  rule: {
    width: 24,
    height: 2,
    marginBottom: 10,
    backgroundColor: '#8fe8c3',
  },
  metricLine: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(153, 205, 183, 0.22)',
  },
  metricLabel: { color: '#98a7a1', fontSize: 12 },
  metricValue: {
    color: '#8fe8c3',
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  metricUnit: { fontSize: 12 },
  metricValueSmall: {
    color: '#8fe8c3',
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  posterFooter: { gap: 5 },
  date: { color: '#95a19c', fontSize: 11, letterSpacing: 0.6 },
  location: { maxWidth: '72%', color: '#6f827a', fontSize: 9 },
  shortRule: {
    width: 22,
    height: 2,
    marginTop: 5,
    marginBottom: 4,
    backgroundColor: '#8fe8c3',
  },
  quote: {
    color: '#8fe8c3',
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  quoteCompact: { fontSize: 19, lineHeight: 26 },
  quoteSecondary: { color: '#eef8f4' },
})

const stylesStatic = StyleSheet.create({
  thumbnail: {
    flex: 1,
    aspectRatio: 0.72,
    borderRadius: 9,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#294139',
    backgroundColor: '#0a1512',
  },
  thumbnailActive: { borderWidth: 2, borderColor: '#71e2b5' },
  thumbnailBackground: { flex: 1, padding: 9 },
  thumbnailImage: { opacity: 0.55 },
  thumbnailShade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(3, 10, 8, 0.48)',
  },
  thumbnailBrand: {
    color: '#8fe8c3',
    fontSize: 6,
    fontWeight: '800',
  },
  thumbnailNumber: {
    marginTop: 8,
    color: '#a7efd1',
    fontSize: 42,
    lineHeight: 44,
    fontWeight: '900',
    letterSpacing: -2,
  },
  thumbnailNumberReport: { fontSize: 34 },
  thumbnailUnit: {
    color: '#a7efd1',
    fontSize: 8,
    fontWeight: '800',
  },
  thumbnailRule: {
    width: 12,
    height: 1,
    marginTop: 'auto',
    marginBottom: 5,
    backgroundColor: '#8fe8c3',
  },
  thumbnailCopy: { color: '#d8f7ea', fontSize: 6, fontWeight: '700' },
})

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: 20, gap: 14 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    loadingText: { color: theme.muted, fontSize: 14 },
    previewWrap: { alignItems: 'center', paddingTop: 8 },
    editorTabs: {
      alignSelf: 'center',
      width: '64%',
      minHeight: 42,
      flexDirection: 'row',
      padding: 2,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.line,
      backgroundColor: theme.card,
    },
    editorTab: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 10,
    },
    editorTabActive: {
      borderWidth: 1,
      borderColor: theme.green,
      backgroundColor: theme.greenSoft,
    },
    editorTabText: { color: theme.muted, fontSize: 13, fontWeight: '600' },
    editorTabTextActive: { color: theme.green, fontWeight: '800' },
    thumbnailRow: { flexDirection: 'row', gap: 10 },
    optionList: { gap: 8 },
    option: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.line,
      backgroundColor: theme.card,
    },
    optionActive: {
      borderColor: theme.green,
      backgroundColor: theme.greenSoft,
    },
    optionText: { flex: 1, color: theme.inkSoft, fontSize: 13 },
    optionTextActive: { color: theme.green, fontWeight: '700' },
    sizeRow: { flexDirection: 'row', gap: 8 },
    sizeOption: {
      flex: 1,
      minHeight: 72,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.line,
      backgroundColor: theme.card,
    },
    sizeOptionActive: {
      borderColor: theme.green,
      backgroundColor: theme.greenSoft,
    },
    sizeValue: { color: theme.ink, fontSize: 16, fontWeight: '800' },
    sizeValueActive: { color: theme.green },
    sizeHint: { paddingTop: 4, color: theme.muted, fontSize: 9 },
    locationRow: {
      minHeight: 46,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.line,
      backgroundColor: theme.card,
    },
    locationLeft: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    locationText: { color: theme.inkSoft, fontSize: 13 },
    actions: { flexDirection: 'row', gap: 8 },
    actionButton: {
      flex: 1,
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      borderRadius: 12,
    },
    actionOutline: {
      borderWidth: 1,
      borderColor: theme.green,
      backgroundColor: theme.card,
    },
    actionPrimary: { flex: 1.25, backgroundColor: theme.mint },
    actionPressed: { opacity: 0.72 },
    actionOutlineText: { color: theme.green, fontSize: 12, fontWeight: '800' },
    actionPrimaryText: { color: '#07100f', fontSize: 13, fontWeight: '900' },
    backToResult: {
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      backgroundColor: theme.greenSoft,
    },
    backToResultText: { color: theme.green, fontSize: 14, fontWeight: '700' },
  })
