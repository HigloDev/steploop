import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Header } from '../components/Header'
import { Disclosure } from '../components/disclosure'
import { Button, Card, Pill } from '../components/ui'
import {
  DiagnosticActivity,
  DiagnosticAnnotation,
  DiagnosticBundle,
  DiagnosticGap,
  DIAGNOSTIC_ALGORITHM_VERSION,
  DIAGNOSTIC_BUNDLE_VERSION,
  DIAGNOSTIC_PARAMETER_VERSION,
  calculateDiagnosticQuality,
  isValidDeviceBrand,
  isValidParticipantId,
  normalizeDiagnosticSamples,
  sanitizeDiagnosticBundleForExport,
  sanitizeDiagnosticRoute,
} from '../core/diagnostics'
import { CarryMode, RouteTemplate } from '../core/types'
import { uid } from '../core/math'
import { RootStackScreen } from '../navigation/types'
import { exportDiagnosticBundle } from '../services/diagnostics'
import {
  SensorRecorder,
  SensorStatus,
  sensorStartErrorMessage,
} from '../services/sensor'
import { listRoutes } from '../services/storage'
import { Theme, useTheme } from '../theme'

const ACTIVITY_OPTIONS: Array<{
  key: DiagnosticActivity
  label: string
  negative?: boolean
}> = [
  { key: 'climb_up', label: '向上爬楼' },
  { key: 'walk_flat', label: '平地行走', negative: true },
  { key: 'stationary', label: '原地静止', negative: true },
  { key: 'elevator_up', label: '电梯上行', negative: true },
  { key: 'elevator_down', label: '电梯下行', negative: true },
  { key: 'stairs_down', label: '向下走楼梯', negative: true },
  { key: 'escalator', label: '乘扶梯', negative: true },
]

export default function DiagnosticCaptureScreen({
  navigation,
}: RootStackScreen<'DiagnosticCapture'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const recorderRef = useRef<SensorRecorder | undefined>(undefined)
  const annotationsRef = useRef<DiagnosticAnnotation[]>([])
  const gapsRef = useRef<DiagnosticGap[]>([])
  const sampleCountRef = useRef(0)
  const renderAtRef = useRef(0)

  const [routes, setRoutes] = useState<RouteTemplate[]>([])
  const [routeId, setRouteId] = useState('')
  const [activity, setActivity] =
    useState<DiagnosticActivity>('climb_up')
  const [carryMode, setCarryMode] = useState<CarryMode>('pocket')
  const [recording, setRecording] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [sampleCount, setSampleCount] = useState(0)
  const [markedFloor, setMarkedFloor] = useState(0)
  const [turnCount, setTurnCount] = useState(0)
  const [barometerAvailable, setBarometerAvailable] = useState(false)
  const [sensorSignal, setSensorSignal] =
    useState<SensorStatus['signal']>('waiting')
  const [message, setMessage] = useState('')
  const [deviceCohortId, setDeviceCohortId] = useState('android-a')
  // 化名与品牌是数据集要求的采集元数据（门禁按条目校验，缺失即 fail closed）。
  // 只允许化名代码：不写姓名/手机号/邮箱。
  const [participantId, setParticipantId] = useState('p01')
  const [deviceBrand, setDeviceBrand] = useState('')

  const selectedRoute = useMemo(
    () => routes.find((route) => route.id === routeId),
    [routeId, routes],
  )
  const isNegative = activity !== 'climb_up'

  useEffect(() => {
    listRoutes()
      .then((items) => {
        const usable = items.filter((route) => route.segments.length > 0)
        setRoutes(usable)
        if (usable[0]) {
          setRouteId(usable[0].id)
          setCarryMode(usable[0].carryMode)
          setMarkedFloor(usable[0].startFloor)
        }
      })
      .catch(() => setMessage('路线读取失败'))
  }, [])

  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 250)
    return () => clearInterval(timer)
  }, [recording, startedAt])

  useEffect(
    () => () => {
      recorderRef.current?.stop().catch(() => undefined)
      recorderRef.current = undefined
    },
    [],
  )

  useEffect(() => {
    if (!recording) return
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        requestLeave()
        return true
      },
    )
    return () => subscription.remove()
  }, [recording])

  const chooseRoute = (route: RouteTemplate) => {
    if (recording) return
    setRouteId(route.id)
    setCarryMode(route.carryMode)
    setMarkedFloor(route.startFloor)
  }

  const startCapture = async () => {
    if (!selectedRoute || recording) return
    const captureStartedAt = Date.now()
    annotationsRef.current = []
    gapsRef.current = []
    sampleCountRef.current = 0
    renderAtRef.current = 0
    setSampleCount(0)
    setTurnCount(0)
    setMarkedFloor(selectedRoute.startFloor)
    setElapsedMs(0)
    setBarometerAvailable(false)
    setMessage('正在启动传感器…')

    const recorder = new SensorRecorder({
      retainSamples: true,
      onSample: (sample) => {
        sampleCountRef.current += 1
        if (sample.t - renderAtRef.current >= 500) {
          renderAtRef.current = sample.t
          setSampleCount(sampleCountRef.current)
        }
      },
      onGap: (gap) => gapsRef.current.push(gap),
      onStatus: (status) => setSensorSignal(status.signal),
      onBarometer: (status) => setBarometerAvailable(status.available),
    })
    recorderRef.current = recorder
    try {
      await recorder.start()
      const actualStartedAt = recorder.getStartedAt() || captureStartedAt
      setStartedAt(actualStartedAt)
      setRecording(true)
      setMessage('正在本地采集。请按真实动作完成本次样本。')
    } catch (error) {
      recorderRef.current = undefined
      setMessage(sensorStartErrorMessage(error))
    }
  }

  const markFloor = () => {
    if (!recording || !selectedRoute || isNegative) return
    const next = markedFloor + 1
    setMarkedFloor(next)
    annotationsRef.current.push({
      type: 'floor',
      floor: next,
      atMs: Date.now() - startedAt,
    })
  }

  const markTurn = () => {
    if (!recording) return
    setTurnCount((count) => count + 1)
    annotationsRef.current.push({
      type: 'turn',
      atMs: Date.now() - startedAt,
    })
  }

  const finishCapture = async () => {
    if (!recording || !selectedRoute || !recorderRef.current || exporting) return
    setRecording(false)
    setExporting(true)
    setMessage('正在整理本地诊断包…')
    try {
      const recorder = recorderRef.current
      const samples = await recorder.stop()
      recorderRef.current = undefined
      const endedAt = Date.now()
      const durationMs = Math.max(0, endedAt - startedAt)
      const normalizedSamples = normalizeDiagnosticSamples(samples, startedAt)
      const quality = calculateDiagnosticQuality(
        normalizedSamples,
        20,
        durationMs,
      )
      const participant = participantId.trim()
      const brand = deviceBrand.trim().toLowerCase()
      if (!isValidParticipantId(participant)) {
        setMessage(
          '采集者化名不合法：只允许字母数字/下划线/连字符（≤32 字符）且至少含一个字母；不要填写姓名、手机号或邮箱。',
        )
        setExporting(false)
        return
      }
      if (!isValidDeviceBrand(brand)) {
        setMessage(
          '设备品牌不合法：只允许小写字母数字与连字符（例如 xiaomi、samsung、oneplus）。',
        )
        setExporting(false)
        return
      }
      const markedInvalid = await new Promise<boolean>((resolve) => {
        Alert.alert(
          '确认样本真值',
          `真实终点：${isNegative ? selectedRoute.startFloor : markedFloor}层\n采样质量：${quality.sampleQuality}\n请确认楼层标注正确；动作异常时将样本标记为无效。`,
          [
            {
              text: '标记无效并导出',
              style: 'destructive',
              onPress: () => resolve(true),
            },
            { text: '确认并导出', onPress: () => resolve(false) },
          ],
          { cancelable: false },
        )
      })
      const truthEndFloor = isNegative
        ? selectedRoute.startFloor
        : markedFloor
      const bundle: DiagnosticBundle = {
        version: DIAGNOSTIC_BUNDLE_VERSION,
        id: uid('diagnostic'),
        createdAt: 0,
        durationMs,
        activity,
        carryMode,
        routeTemplate: sanitizeDiagnosticRoute(selectedRoute),
        truth: {
          startFloor: selectedRoute.startFloor,
          endFloor: truthEndFloor,
          completedFloors: Math.max(
            0,
            truthEndFloor - selectedRoute.startFloor,
          ),
        },
        samples: normalizedSamples,
        annotations: annotationsRef.current,
        gaps: gapsRef.current,
        capture: {
          platform: process.env.EXPO_OS ?? 'unknown',
          systemVersion: String(Platform.Version),
          sampleIntervalTargetMs: 20,
          barometerAvailable,
          deviceCohortId: deviceCohortId.trim() || 'android-unknown',
          participantId: participant,
          deviceBrand: brand,
        },
        algorithmVersion: DIAGNOSTIC_ALGORITHM_VERSION,
        parameterVersion: DIAGNOSTIC_PARAMETER_VERSION,
        datasetId: 'collection-unassigned',
        routeModelVersion: selectedRoute.version,
        sampleQuality: markedInvalid ? 'invalid' : quality.sampleQuality,
        samplingStats: quality.samplingStats,
        barometerStats: quality.barometerStats,
        invalidReasons: markedInvalid
          ? [...quality.invalidReasons, 'marked_invalid_by_tester']
          : quality.invalidReasons,
      }
      const result = await exportDiagnosticBundle(
        sanitizeDiagnosticBundleForExport(bundle),
      )
      setSampleCount(samples.length)
      setElapsedMs(durationMs)
      setMessage(result.message)
    } catch (error) {
      setMessage(
        `诊断包生成失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    } finally {
      setExporting(false)
    }
  }

  const requestLeave = () => {
    if (!recording) {
      navigation.goBack()
      return
    }
    Alert.alert('正在采集', '退出会丢弃本次尚未导出的诊断数据。', [
      { text: '继续采集', style: 'cancel' },
      {
        text: '丢弃并退出',
        style: 'destructive',
        onPress: async () => {
          await recorderRef.current?.stop().catch(() => undefined)
          recorderRef.current = undefined
          setRecording(false)
          navigation.goBack()
        },
      },
    ])
  }

  return (
    <View style={styles.page}>
      <Header title="传感器诊断" back={false} rightLabel="关闭" onRightPress={requestLeave} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.flex}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>本机诊断</Text>
          <Text style={styles.title}>记录一段真实动作</Text>
          <Text style={styles.subtitle}>
            原始运动数据只保存在本机。文件会移除路线地点和经纬度，只有点击结束并导出后才会打开系统分享。
          </Text>
        </View>

        <Disclosure key={recording ? 'recording-options' : 'ready-options'} title="本次采集设置" summary={selectedRoute?.name ?? '选择参考路线与动作'} initiallyOpen={!recording}>
        <Text style={styles.sectionLabel}>参考路线</Text>
        {routes.length ? (
          routes.map((route) => (
            <Pressable
              key={route.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: route.id === routeId }}
              disabled={recording}
              onPress={() => chooseRoute(route)}
            >
              <Card
                raised
                style={
                  route.id === routeId
                    ? { ...styles.optionCard, ...styles.optionCardActive }
                    : styles.optionCard
                }
              >
                <View style={styles.optionHead}>
                  <Text style={styles.optionTitle}>{route.name}</Text>
                  {route.id === routeId ? <Text style={styles.optionSelected}>已选择</Text> : null}
                </View>
                <Text style={styles.optionDesc}>
                  {route.startFloor}层 → {route.endFloor}层 · {route.segments.length} 个模板段
                </Text>
              </Card>
            </Pressable>
          ))
        ) : (
          <Card raised>
            <Text style={styles.emptyText}>至少需要一条已经完成首次采集的路线。</Text>
          </Card>
        )}

        <Text style={styles.sectionLabel}>真实动作</Text>
        <View style={styles.chipGrid}>
          {ACTIVITY_OPTIONS.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="radio"
              accessibilityState={{ selected: activity === item.key }}
              disabled={recording}
              style={[
                styles.chip,
                activity === item.key && styles.chipActive,
              ]}
              onPress={() => setActivity(item.key)}
            >
              <Text
                style={[
                  styles.chipText,
                  activity === item.key && styles.chipTextActive,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>手机位置</Text>
        <View style={styles.segmented}>
          {([
            ['pocket', '裤袋'],
            ['waist', '腰部'],
          ] as const).map(([key, label]) => (
            <Pressable
              key={key}
              accessibilityRole="radio"
              accessibilityState={{ selected: carryMode === key }}
              disabled={recording}
              style={[
                styles.segment,
                carryMode === key && styles.segmentActive,
              ]}
              onPress={() => setCarryMode(key)}
            >
              <Text
                style={[
                  styles.segmentText,
                  carryMode === key && styles.segmentTextActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>匿名设备组</Text>
        <TextInput
          value={deviceCohortId}
          onChangeText={setDeviceCohortId}
          editable={!recording}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={32}
          accessibilityLabel="匿名设备组编号"
          placeholder="例如 android-a"
          placeholderTextColor={theme.muted}
          style={styles.cohortInput}
        />

        <Text style={styles.sectionLabel}>采集者化名（不要填姓名/手机号）</Text>
        <TextInput
          value={participantId}
          onChangeText={setParticipantId}
          editable={!recording}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={32}
          accessibilityLabel="采集者化名代码"
          accessibilityHint="只填写化名代码，例如 p01；不要填写真实姓名或联系方式"
          placeholder="例如 p01"
          placeholderTextColor={theme.muted}
          style={styles.cohortInput}
        />

        <Text style={styles.sectionLabel}>设备品牌（小写，例如 xiaomi）</Text>
        <TextInput
          value={deviceBrand}
          onChangeText={setDeviceBrand}
          editable={!recording}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={24}
          accessibilityLabel="设备品牌"
          placeholder="例如 xiaomi"
          placeholderTextColor={theme.muted}
          style={styles.cohortInput}
        />

        </Disclosure>
        <Card raised style={styles.liveCard}>
          <View style={styles.liveHead}>
            <View style={styles.liveHeading}>
              <Text style={styles.liveLabel}>采集状态</Text>
              <Text style={styles.liveValue}>
                {recording ? '记录中' : exporting ? '正在导出' : '待机'}
              </Text>
            </View>
            <Pill tone={sensorSignal === 'good' ? 'good' : sensorSignal === 'interrupted' ? 'danger' : 'default'}>
              {sensorSignal === 'good'
                ? '信号稳定'
                : sensorSignal === 'interrupted'
                  ? '信号中断'
                  : '等待信号'}
            </Pill>
          </View>
          <View style={styles.metrics}>
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{(elapsedMs / 1000).toFixed(1)}</Text>
              <Text style={styles.metricLabel}>秒</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{sampleCount}</Text>
              <Text style={styles.metricLabel}>样本</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{barometerAvailable ? '有' : '无'}</Text>
              <Text style={styles.metricLabel}>气压计</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>
                {elapsedMs > 0 ? Math.round((sampleCount * 1000) / elapsedMs) : 0}
              </Text>
              <Text style={styles.metricLabel}>赫兹</Text>
            </View>
          </View>
          {recording && !isNegative ? (
            <View style={styles.annotationBlock}>
              <Text style={styles.annotationTitle}>人工真值标注</Text>
              <Text style={styles.annotationHint}>
                双脚到达新楼层平台时标记楼层；身体完成转向时标记转弯。
              </Text>
              <View style={styles.annotationActions}>
                <Pressable accessibilityRole="button" accessibilityLabel={`标记到达 ${markedFloor + 1} 层`} style={styles.annotationButton} onPress={markFloor}>
                  <Text style={styles.annotationButtonValue}>{markedFloor}F</Text>
                  <Text style={styles.annotationButtonLabel}>到达下一层</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="标记刚刚完成的转弯" style={styles.annotationButton} onPress={markTurn}>
                  <Text style={styles.annotationButtonValue}>{turnCount}</Text>
                  <Text style={styles.annotationButtonLabel}>标记转弯</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </Card>

        {message ? <Text selectable style={styles.message}>{message}</Text> : null}

      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        {recording ? (
          <Button
            title="结束并导出"
            accessibilityLabel="结束传感器诊断并导出本地文件"
            onPress={finishCapture}
          />
        ) : (
          <Button
            title="开始诊断采集"
            accessibilityLabel="开始本地传感器诊断采集"
            onPress={startCapture}
            disabled={!selectedRoute || exporting}
            loading={exporting}
          />
        )}
      </View>
      </KeyboardAvoidingView>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: theme.pagePaddingH, paddingTop: 16, gap: 16 },
    hero: { gap: 8 },
    eyebrow: {
      color: theme.green,
      fontSize: theme.fontSmall,
      fontWeight: '700',
    },
    title: {
      color: theme.ink,
      fontSize: theme.fontTitle,
      lineHeight: 34,
      fontWeight: '700',
    },
    subtitle: {
      color: theme.mutedStrong,
      fontSize: theme.fontBase,
      lineHeight: 22,
    },
    sectionLabel: {
      marginTop: 24,
      marginBottom: 12,
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
    },
    optionCard: { padding: 16, marginBottom: 12 },
    optionCardActive: {
      borderWidth: 1,
      borderColor: theme.green,
      backgroundColor: theme.greenSoft,
    },
    optionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      flexWrap: 'wrap',
    },
    optionTitle: { flex: 1, minWidth: 140, color: theme.ink, fontSize: theme.fontBase, lineHeight: 22, fontWeight: '600' },
    optionDesc: { marginTop: 8, color: theme.mutedStrong, fontSize: theme.fontSubtitle, lineHeight: 21 },
    optionSelected: { color: theme.green, fontSize: theme.fontSmall, lineHeight: 18, fontWeight: '600' },
    emptyText: { color: theme.muted, fontSize: theme.fontSubtitle, lineHeight: 21 },
    chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      minHeight: theme.tapMin,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: theme.radiusMd,
      borderWidth: 1,
      borderColor: theme.line,
      backgroundColor: theme.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipActive: { borderColor: theme.green, backgroundColor: theme.greenSoft },
    chipText: { color: theme.inkSoft, fontSize: theme.fontSubtitle, lineHeight: 21, fontWeight: '600' },
    chipTextActive: { color: theme.green, fontWeight: '700' },
    segmented: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      padding: 4,
      borderRadius: theme.radiusMd,
      backgroundColor: theme.surfaceSoft,
    },
    cohortInput: {
      minHeight: theme.tapMin,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: theme.radiusMd,
      borderWidth: 1,
      borderColor: theme.line,
      backgroundColor: theme.card,
      color: theme.ink,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
    },
    segment: {
      flex: 1,
      minHeight: theme.tapMin,
      minWidth: 100,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 10,
    },
    segmentActive: { backgroundColor: theme.card, ...theme.shadowSoft },
    segmentText: { color: theme.mutedStrong, fontSize: theme.fontSubtitle, lineHeight: 21, fontWeight: '600' },
    segmentTextActive: { color: theme.ink, fontWeight: '700' },
    liveCard: { padding: 16 },
    liveHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 12,
    },
    liveHeading: { flex: 1, minWidth: 120 },
    liveLabel: { color: theme.mutedStrong, fontSize: theme.fontSmall, lineHeight: 18 },
    liveValue: { marginTop: 8, color: theme.ink, fontSize: 20, lineHeight: 28, fontWeight: '700' },
    metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
    metricItem: {
      flexGrow: 1,
      flexBasis: '45%',
      minWidth: 0,
      paddingVertical: 12,
      borderRadius: theme.radiusMd,
      alignItems: 'center',
      backgroundColor: theme.cardSoft,
    },
    metricValue: {
      color: theme.ink,
      fontSize: 24,
      lineHeight: 32,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    metricLabel: { marginTop: 4, color: theme.mutedStrong, fontSize: theme.fontSmall, lineHeight: 18 },
    annotationBlock: {
      marginTop: 16,
      paddingTop: 14,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line,
    },
    annotationTitle: { color: theme.ink, fontSize: 17, lineHeight: 24, fontWeight: '600' },
    annotationHint: { marginTop: 4, color: theme.muted, fontSize: theme.fontSmall, lineHeight: 18 },
    annotationActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
    annotationButton: {
      flex: 1,
      minWidth: 120,
      minHeight: 76,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.green,
      backgroundColor: theme.greenSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    annotationButtonValue: { color: theme.green, fontSize: 21, fontWeight: '700' },
    annotationButtonLabel: { marginTop: 4, color: theme.green, fontSize: theme.fontSmall, lineHeight: 18, fontWeight: '600' },
    message: { marginTop: 12, color: theme.muted, fontSize: theme.fontSmall, lineHeight: 18 },
    footer: { backgroundColor: theme.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, paddingHorizontal: theme.pagePaddingH, paddingTop: 8 },
  })
