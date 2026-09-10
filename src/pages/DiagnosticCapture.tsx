import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  BackHandler,
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
      <ScrollView
        style={styles.flex}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>LOCAL DIAGNOSTICS</Text>
          <Text style={styles.title}>让每次算法修改都有真实证据</Text>
          <Text style={styles.subtitle}>
            原始运动数据只保存在本机。文件会移除路线地点和经纬度，只有点击结束并导出后才会打开系统分享。
          </Text>
        </View>

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
                  {route.id === routeId ? <Pill tone="good">已选择</Pill> : null}
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

        <Card raised style={styles.liveCard}>
          <View style={styles.liveHead}>
            <View>
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
                <Pressable style={styles.annotationButton} onPress={markFloor}>
                  <Text style={styles.annotationButtonValue}>{markedFloor}F</Text>
                  <Text style={styles.annotationButtonLabel}>到达下一层</Text>
                </Pressable>
                <Pressable style={styles.annotationButton} onPress={markTurn}>
                  <Text style={styles.annotationButtonValue}>{turnCount}</Text>
                  <Text style={styles.annotationButtonLabel}>标记转弯</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </Card>

        {message ? <Text selectable style={styles.message}>{message}</Text> : null}

        {recording ? (
          <Button
            title="结束并导出"
            variant="danger"
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
      </ScrollView>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: theme.pagePaddingH },
    hero: { paddingTop: 12, paddingBottom: 8 },
    eyebrow: {
      color: theme.green,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1.6,
    },
    title: {
      marginTop: 7,
      color: theme.ink,
      fontSize: 27,
      lineHeight: 34,
      fontWeight: '900',
    },
    subtitle: {
      marginTop: 9,
      color: theme.muted,
      fontSize: 13,
      lineHeight: 20,
    },
    sectionLabel: {
      marginTop: 18,
      marginBottom: 8,
      color: theme.muted,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1,
    },
    optionCard: { padding: 14, marginBottom: 8 },
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
    },
    optionTitle: { flex: 1, color: theme.ink, fontSize: 15, fontWeight: '800' },
    optionDesc: { marginTop: 5, color: theme.muted, fontSize: 12 },
    emptyText: { color: theme.muted, fontSize: 13, lineHeight: 19 },
    chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      minHeight: 40,
      paddingHorizontal: 14,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.line,
      backgroundColor: theme.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipActive: { borderColor: theme.green, backgroundColor: theme.greenSoft },
    chipText: { color: theme.inkSoft, fontSize: 13, fontWeight: '600' },
    chipTextActive: { color: theme.green, fontWeight: '800' },
    segmented: {
      flexDirection: 'row',
      padding: 3,
      borderRadius: 13,
      backgroundColor: theme.surfaceSoft,
    },
    cohortInput: {
      minHeight: 46,
      paddingHorizontal: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.line,
      backgroundColor: theme.card,
      color: theme.ink,
      fontSize: 14,
    },
    segment: {
      flex: 1,
      minHeight: 42,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 10,
    },
    segmentActive: { backgroundColor: theme.card, ...theme.shadowSoft },
    segmentText: { color: theme.muted, fontSize: 13, fontWeight: '600' },
    segmentTextActive: { color: theme.ink, fontWeight: '800' },
    liveCard: { marginTop: 20, padding: 16 },
    liveHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    liveLabel: { color: theme.muted, fontSize: 11, fontWeight: '700' },
    liveValue: { marginTop: 3, color: theme.ink, fontSize: 20, fontWeight: '900' },
    metrics: { flexDirection: 'row', gap: 8, marginTop: 18 },
    metricItem: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
      backgroundColor: theme.cardSoft,
    },
    metricValue: {
      color: theme.ink,
      fontSize: 18,
      fontWeight: '900',
      fontVariant: ['tabular-nums'],
    },
    metricLabel: { marginTop: 3, color: theme.muted, fontSize: 10 },
    annotationBlock: {
      marginTop: 16,
      paddingTop: 14,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line,
    },
    annotationTitle: { color: theme.ink, fontSize: 13, fontWeight: '800' },
    annotationHint: { marginTop: 4, color: theme.muted, fontSize: 11, lineHeight: 17 },
    annotationActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
    annotationButton: {
      flex: 1,
      minHeight: 76,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.green,
      backgroundColor: theme.greenSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    annotationButtonValue: { color: theme.green, fontSize: 21, fontWeight: '900' },
    annotationButtonLabel: { marginTop: 3, color: theme.green, fontSize: 11, fontWeight: '700' },
    message: { marginTop: 12, color: theme.muted, fontSize: 12, lineHeight: 18 },
  })
