// 标定采集页：启动 SensorRecorder 全程保留样本，停止后 analyzeCalibration 生成 draft，
// setActiveDraft 并跳转 Review。是 RouteEdit → Calibrate → Review 流程的中间环节。
//
// 采集时实时展示：步数、步频、净加速度波形、垂直位移估算、自动拐弯检测、
// 人工标记（拐弯/新楼层）、每层步数用时统计、异常实时提醒。

import React, { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Animated,
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

import { Disclosure } from '../components/disclosure'
import { Header } from '../components/Header'
import { BuildingSketch, buildRealtimeFloors } from '../components/BuildingSketch'
import { Button, Card, Metric, Pill } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import { SensorRecorder, SensorStatus, sensorStartErrorMessage } from '../services/sensor'
import { setActiveDraft, saveCalibrateProgress, loadPersistedDraft, clearActiveDraft } from '../services/draft'
import { analyzeCalibration } from '../core/analysis'
import { formatDuration, uid } from '../core/math'
import { ManualMark, RouteSeed, SensorSample, BarometerStatus } from '../core/types'
import { triggerHaptic } from '../services/preferences'
import { pressureToAltitude } from '../core/analysis'
import { PressureTrend, type PressureDirection } from '../core/pressure-trend'

type Phase = 'ready' | 'recording' | 'stopped'

// 波形可视化配置
const WAVEFORM_BARS = 48        // 显示条形数
const WAVEFORM_BUF = 240        // 缓冲最近样本（约 5 秒 @ 50Hz）
const WAVE_TICK_MS = 33         // 约 30fps 刷新
const GRAVITY = 9.8             // 重力基线（仅作 fallback，实际用前 1 秒采样校准）
const METERS_PER_SECOND_SQUARED_PER_G = 9.80665 // Recorder 加速度统一为 g；页面检测和波形使用 m/s²
const STEP_THRESHOLD = 3.0      // 步态峰值检测阈值（m/s² 净加速度，走路约 3~6，跑步 6+）
const STEP_COOLDOWN_MS = 280    // 两步最小间隔，避免误计
const STEP_CONFIRM_N = 3        // 滑动窗口样本数
const STEP_CONFIRM_K = 2        // 窗口内超阈值样本数下限，过滤单点抖动
const BASELINE_CAL_MS = 1000    // 前 1 秒做静止基线校准

// 自动拐弯检测配置（陀螺仪 Z 轴角速度）
const TURN_GZ_THRESHOLD = 1.5   // rad/s，超过视为正在转向
const TURN_COOLDOWN_MS = 800    // 两次拐弯最小间隔

// 异常检测配置
const IDLE_THRESHOLD_MS = 5000        // 静止超过 5 秒提醒
const CADENCE_HIGH = 180              // 步频上限（步/分钟）
const CADENCE_LOW = 30                // 步频下限（步/分钟）
const CADENCE_WINDOW_MS = 10000       // 步频计算窗口（最近 10 秒）

// 垂直位移估算（每步抬升约 0.17m）
const ASCENT_PER_STEP_M = 0.17

export default function CalibrateScreen({ navigation, route }: RootStackScreen<'Calibrate'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const { seed } = route.params
  const routeStartFloor = Number.isSafeInteger(seed.startFloor) ? seed.startFloor! : 1

  const recorderRef = useRef<SensorRecorder | undefined>(undefined)
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const startedAtRef = useRef(0)
  const samplesRef = useRef<SensorSample[]>([])
  const gapsRef = useRef<Array<{ startMs: number; endMs: number }>>([])
  const manualMarksRef = useRef<ManualMark[]>([])

  // 波形可视化相关
  const waveBufRef = useRef<number[]>([])           // 净加速度幅值缓冲
  const waveTickRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const lastStepAtRef = useRef(0)                    // 上次步态时间戳
  const stepCountRef = useRef(0)                     // 步数计数（ref，避免闭包陈旧）
  const stepTimesRef = useRef<number[]>([])          // 所有步态时间戳，用于步频计算
  // 静止基线校准：前 1 秒采样平均 |a| 作为重力参考，避免不同手机传感器偏置
  const baselineStartRef = useRef(0)
  const baselineSumRef = useRef(0)
  const baselineCountRef = useRef(0)
  const gravityRef = useRef(GRAVITY)
  // 滑动窗口：最近 STEP_CONFIRM_N 个样本是否超阈值，用于过滤单点抖动
  const stepWinRef = useRef<boolean[]>([])
  // 诊断显示：实时 |a| 和 net
  const [diagMag, setDiagMag] = useState(0)
  const [diagNet, setDiagNet] = useState(0)
  const [diagGravity, setDiagGravity] = useState(GRAVITY)
  const [waveBars, setWaveBars] = useState<number[]>(() => new Array(WAVEFORM_BARS).fill(0))
  const [stepCount, setStepCount] = useState(0)
  const [peakIntensity, setPeakIntensity] = useState(0)   // 当前瞬时强度 0~1，用于脉动

  // 自动拐弯检测
  const lastTurnAtRef = useRef(0)
  const turnCountRef = useRef(0)
  const [turnCount, setTurnCount] = useState(0)
  const [lastTurnDir, setLastTurnDir] = useState<'left' | 'right' | ''>('')

  // 人工标记
  const [manualTurnCount, setManualTurnCount] = useState(0)
  const [currentFloor, setCurrentFloor] = useState(routeStartFloor)
  const [floorMarkCount, setFloorMarkCount] = useState(0)

  // 实时指标
  const [cadence, setCadence] = useState(0)              // 步/分钟
  const [ascentM, setAscentM] = useState(0)              // 估算垂直爬升

  // 气压计实时显示
  // null = 未知（采集启动后 3 秒内待定），true/false = 是否可用
  const [baroAvailable, setBaroAvailable] = useState<boolean | null>(null)
  const [baroPressure, setBaroPressure] = useState(0)         // 当前气压 hPa
  const [baroRelAltitude, setBaroRelAltitude] = useState(0)   // 相对起点海拔 m
  const baroRelAltitudeRef = useRef(0)                      // 定时器读取最新高度，避免捕获启动时的 state
  const baroStartPressureRef = useRef<number | null>(null)    // 起点气压（首次样本）
  const pressureTrendRef = useRef(new PressureTrend())
  const [pressureDirection, setPressureDirection] = useState<PressureDirection>('unknown')

  // 异常提醒
  const [warnings, setWarnings] = useState<string[]>([])
  const lastStepAtForIdleRef = useRef(0)  // 用于静止检测

  // 脉动呼吸动画
  const pulseAnim = useRef(new Animated.Value(0)).current

  const [phase, setPhase] = useState<Phase>('ready')
  const [elapsed, setElapsed] = useState('00:00')
  const [sampleCount, setSampleCount] = useState(0)
  const [signal, setSignal] = useState<SensorStatus['signal']>('waiting')
  const [error, setError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  // 路线名称与携带方式：从 seed 带入默认值，采集前可编辑
  const [routeName, setRouteName] = useState(seed.name)
  const [carryMode, setCarryMode] = useState<'pocket' | 'waist'>(seed.carryMode ?? 'pocket')

  useEffect(() => {
    let cancelled = false
    loadPersistedDraft().then((restored) => {
      if (cancelled || !restored) return
      if (restored.kind === 'draft') {
        navigation.replace('Review')
        return
      }
      const p = restored.progress
      if (p.phase !== 'recording') return
      setRouteName(p.routeName)
      setCarryMode(p.carryMode)
      setCurrentFloor(p.currentFloor)
      manualMarksRef.current = p.manualMarks
      setManualTurnCount(p.manualMarks.filter((m) => m.type === 'turn').length)
      setFloorMarkCount(p.manualMarks.filter((m) => m.type === 'floor').length)
    })
    return () => {
      cancelled = true
    }
  }, [navigation])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (waveTickRef.current) clearInterval(waveTickRef.current)
      recorderRef.current?.stop().catch(() => undefined)
    }
  }, [])

  const handleStart = async () => {
    setError('')
    samplesRef.current = []
    gapsRef.current = []
    manualMarksRef.current = []
    waveBufRef.current = []
    stepCountRef.current = 0
    stepTimesRef.current = []
    lastStepAtRef.current = 0
    lastStepAtForIdleRef.current = 0
    lastTurnAtRef.current = 0
    turnCountRef.current = 0
    baselineStartRef.current = 0
    baselineSumRef.current = 0
    baselineCountRef.current = 0
    gravityRef.current = GRAVITY
    stepWinRef.current = []
    setStepCount(0)
    setTurnCount(0)
    setManualTurnCount(0)
    setCurrentFloor(routeStartFloor)
    setFloorMarkCount(0)
    setCadence(0)
    setAscentM(0)
    setWarnings([])
    setLastTurnDir('')
    setDiagMag(0)
    setDiagNet(0)
    setDiagGravity(GRAVITY)
    setWaveBars(new Array(WAVEFORM_BARS).fill(0))
    // 重置气压计状态
    setBaroAvailable(null)
    setBaroPressure(0)
    setBaroRelAltitude(0)
    baroRelAltitudeRef.current = 0
    baroStartPressureRef.current = null
    pressureTrendRef.current = new PressureTrend()
    setPressureDirection('unknown')
    const recorder = new SensorRecorder({
      retainSamples: true,
      onSample: (sample) => {
        samplesRef.current.push(sample)
        setSampleCount(samplesRef.current.length)
        // 仅将页面实时检测/显示的幅值转换为 m/s²，保留原始 sample 的 g 单位
        const mag = Math.sqrt(
          sample.ax * sample.ax + sample.ay * sample.ay + sample.az * sample.az,
        ) * METERS_PER_SECOND_SQUARED_PER_G
        // 前 1 秒做静止基线校准：累加 |a| 求平均，作为该设备的重力参考
        if (!baselineStartRef.current) {
          baselineStartRef.current = sample.t
        }
        if (sample.t - baselineStartRef.current < BASELINE_CAL_MS) {
          baselineSumRef.current += mag
          baselineCountRef.current += 1
          if (baselineCountRef.current >= 10) {
            gravityRef.current = baselineSumRef.current / baselineCountRef.current
          }
        } else if (baselineCountRef.current > 0 && gravityRef.current === GRAVITY) {
          // 校准结束，锁定基线
          gravityRef.current = baselineSumRef.current / baselineCountRef.current
          setDiagGravity(gravityRef.current)
        }
        // 净加速度幅值（减去校准后的重力基线）
        const net = Math.abs(mag - gravityRef.current)
        waveBufRef.current.push(net)
        if (waveBufRef.current.length > WAVEFORM_BUF) {
          waveBufRef.current.shift()
        }
        // 步态检测：滑动窗口确认 + 冷却时间，过滤单点抖动
        stepWinRef.current.push(net > STEP_THRESHOLD)
        if (stepWinRef.current.length > STEP_CONFIRM_N) {
          stepWinRef.current.shift()
        }
        // 窗口内至少 STEP_CONFIRM_K 个样本超阈值才视为真实步态
        const overCount = stepWinRef.current.filter(Boolean).length
        if (
          stepWinRef.current.length === STEP_CONFIRM_N &&
          overCount >= STEP_CONFIRM_K &&
          net > STEP_THRESHOLD
        ) {
          const now = sample.t
          if (now - lastStepAtRef.current > STEP_COOLDOWN_MS) {
            stepCountRef.current += 1
            lastStepAtRef.current = now
            lastStepAtForIdleRef.current = now
            stepTimesRef.current.push(now)
            // 只保留最近 10 秒步态时间戳
            const cutoff = now - CADENCE_WINDOW_MS
            while (stepTimesRef.current.length && stepTimesRef.current[0] < cutoff) {
              stepTimesRef.current.shift()
            }
            // 计步后清空窗口，避免一次步态被重复计数
            stepWinRef.current = []
          }
        }
        // 自动拐弯检测：陀螺仪 Z 轴角速度突变
        const absGz = Math.abs(sample.gz)
        if (absGz > TURN_GZ_THRESHOLD) {
          const now = sample.t
          if (now - lastTurnAtRef.current > TURN_COOLDOWN_MS) {
            turnCountRef.current += 1
            lastTurnAtRef.current = now
            // gz > 0 在 expo-sensors 中通常表示左转（取决于设备朝向）
            setLastTurnDir(sample.gz > 0 ? 'left' : 'right')
          }
        }
        // 诊断显示更新（降频：每 5 个样本更新一次，避免 setState 过频）
        if (samplesRef.current.length % 5 === 0) {
          setDiagMag(mag)
          setDiagNet(net)
        }
      },
      onGap: (gap) => {
        gapsRef.current.push(gap)
        pressureTrendRef.current.gap()
        setPressureDirection('unknown')
      },
      onStatus: (status) => {
        setSignal(status.signal)
      },
      onBarometer: (status: BarometerStatus) => {
        // 首次收到气压样本时锁定起点气压，用于后续计算相对海拔
        if (status.available) {
          if (baroStartPressureRef.current === null) {
            baroStartPressureRef.current = status.pressure
          }
          setBaroAvailable(true)
          setBaroPressure(status.pressure)
          pressureTrendRef.current.push(status.pressure, status.lastSampleAt || Date.now())
          // 相对海拔 = 当前海拔 - 起点海拔
          const startP = baroStartPressureRef.current
          if (startP !== null) {
            const relAlt = pressureToAltitude(status.pressure) - pressureToAltitude(startP)
            baroRelAltitudeRef.current = Number(relAlt.toFixed(1))
            setBaroRelAltitude(baroRelAltitudeRef.current)
          }
        } else {
          // 气压计不可用：仅当状态仍为 null（待定）时才设为 false，
          // 避免被迟到的「不可用」通知覆盖已确认的可用状态
          setBaroAvailable((prev) => (prev === null ? false : prev))
        }
      },
    })
    recorderRef.current = recorder
    try {
      await recorder.start()
      startedAtRef.current = recorder.getStartedAt()
      lastStepAtForIdleRef.current = Date.now()
      setPhase('recording')
      saveCalibrateProgress({
        routeName: routeName.trim() || seed.name,
        carryMode,
        currentFloor: routeStartFloor,
        manualMarks: [],
        startedAt: startedAtRef.current,
        phase: 'recording',
      })
      timerRef.current = setInterval(() => {
        const now = Date.now()
        setElapsed(formatDuration(now - startedAtRef.current))
        // 计算步频（步/分钟）：基于最近 CADENCE_WINDOW_MS 内的步数
        const recentSteps = stepTimesRef.current.filter((t) => now - t <= CADENCE_WINDOW_MS)
        const windowMs = recentSteps.length > 0
          ? Math.min(CADENCE_WINDOW_MS, now - (recentSteps[0] || now))
          : CADENCE_WINDOW_MS
        const cpm = recentSteps.length > 0
          ? Math.round((recentSteps.length / windowMs) * 60000)
          : 0
        setCadence(cpm)
        const trend = pressureTrendRef.current.snapshot(now)
        setPressureDirection(trend.reliable ? trend.direction : 'unknown')
        // 米数仅作粗略显示，楼层只来自用户的实际楼层标记。
        if (baroStartPressureRef.current !== null) {
          // onBarometer 同步最新气压爬升到 ref，定时器不读取启动时捕获的旧 state
          setAscentM(baroRelAltitudeRef.current)
        } else {
          setAscentM(Number((stepCountRef.current * ASCENT_PER_STEP_M).toFixed(1)))
        }
        setTurnCount(turnCountRef.current)
        // 异常实时提醒
        const warns: string[] = []
        // 1. 静止检测：距离上次步态超过 IDLE_THRESHOLD_MS
        if (lastStepAtForIdleRef.current && now - lastStepAtForIdleRef.current > IDLE_THRESHOLD_MS) {
          warns.push('已静止超过 5 秒，若在休息请忽略；若在爬楼请检查手机是否固定。')
        }
        // 2. 步频异常
        if (cpm > CADENCE_HIGH) {
          warns.push(`步频 ${cpm} 步/分偏高，可能正在跑步或数据异常。`)
        } else if (cpm > 0 && cpm < CADENCE_LOW) {
          warns.push(`步频 ${cpm} 步/分偏低，可能停顿较多。`)
        }
        setWarnings(warns)
      }, 500)
      // 启动波形刷新定时器：30fps 从 ref 读取缓冲并降采样为条形高度
      waveTickRef.current = setInterval(() => {
        const buf = waveBufRef.current
        const bars: number[] = []
        const step = Math.max(1, Math.floor(buf.length / WAVEFORM_BARS))
        let maxPeak = 0
        for (let i = 0; i < WAVEFORM_BARS; i++) {
          const start = i * step
          const end = Math.min(start + step, buf.length)
          if (start >= buf.length) {
            bars.push(0)
            continue
          }
          let max = 0
          for (let j = start; j < end; j++) {
            if (buf[j] > max) max = buf[j]
          }
          bars.push(max)
          if (max > maxPeak) maxPeak = max
        }
        setWaveBars(bars)
        setStepCount(stepCountRef.current)
        // 瞬时强度归一化到 0~1（约 6 m/s² 视为满格）
        setPeakIntensity(Math.min(1, maxPeak / 6))
      }, WAVE_TICK_MS)
      // 启动呼吸动画
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.3,
            duration: 900,
            useNativeDriver: true,
          }),
        ]),
      ).start()
    } catch (err) {
      setError(sensorStartErrorMessage(err))
    }
  }

  // 人工标记拐弯
  const handleMarkTurn = () => {
    if (phase !== 'recording') return
    const now = Date.now()
    const atMs = now - startedAtRef.current
    manualMarksRef.current.push({
      id: uid('mturn'),
      type: 'turn',
      atMs,
    })
    setManualTurnCount((prev) => prev + 1)
    saveCalibrateProgress({
      routeName,
      carryMode,
      currentFloor,
      manualMarks: manualMarksRef.current,
      startedAt: startedAtRef.current,
      phase: 'recording',
    })
    triggerHaptic('light')
  }

  // 人工标记到达新楼层
  const handleMarkFloor = () => {
    if (phase !== 'recording') return
    const nextFloor = currentFloor + 1
    const now = Date.now()
    const atMs = now - startedAtRef.current
    manualMarksRef.current.push({
      id: uid('mfloor'),
      type: 'floor',
      atMs,
      floor: nextFloor,
    })
    setCurrentFloor(nextFloor)
    setFloorMarkCount((prev) => prev + 1)
    saveCalibrateProgress({
      routeName,
      carryMode,
      currentFloor: nextFloor,
      manualMarks: manualMarksRef.current,
      startedAt: startedAtRef.current,
      phase: 'recording',
    })
    triggerHaptic('medium')
  }

  const handleStop = async () => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (waveTickRef.current) clearInterval(waveTickRef.current)
    const recorder = recorderRef.current
    if (!recorder) return
    setAnalyzing(true)
    try {
      const samples = await recorder.stop()
      const endedAt = Date.now()
      samplesRef.current = samples
      if (samples.length < 50) {
        setError('采集样本过少，请保持应用在前台并持续爬楼至少 10 秒后停止。')
        setPhase('ready')
        setAnalyzing(false)
        return
      }
      const routeSeed: RouteSeed = {
        routeId: seed.routeId,
        name: routeName.trim() || seed.name,
        carryMode,
        location: seed.location,
      }
      const draft = analyzeCalibration(
        routeSeed,
        samples,
        startedAtRef.current,
        endedAt,
        gapsRef.current,
        manualMarksRef.current,
      )
      setActiveDraft(draft)
      triggerHaptic('medium')
      setPhase('stopped')
      navigation.replace('Review')
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '分析失败，请重试。',
      )
      setPhase('ready')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleCancel = () => {
    if (phase === 'recording') {
      Alert.alert(
        '放弃标定？',
        '当前采集的数据将被丢弃。',
        [
          { text: '继续采集', style: 'cancel' },
          {
            text: '放弃',
            style: 'destructive',
            onPress: () => {
              if (timerRef.current) clearInterval(timerRef.current)
              recorderRef.current?.stop().catch(() => undefined)
              clearActiveDraft()
              navigation.navigate('Main', { screen: 'Train' })
            },
          },
        ],
      )
      return
    }
    clearActiveDraft()
    navigation.navigate('Main', { screen: 'Train' })
  }

  const signalTone: 'good' | 'warn' | 'danger' =
    signal === 'good' ? 'good' : signal === 'interrupted' ? 'danger' : 'warn'
  const signalText =
    signal === 'good'
      ? '信号良好'
      : signal === 'interrupted'
        ? '信号中断'
        : signal === 'unsupported'
          ? '设备不支持'
          : '等待信号'

  // 重新记录已有路线时沿用实际起点。
  // 拐弯段总数 = 自动拐弯 + 人工拐弯，按已完成楼层均分
  const totalTurnsForBuilding = turnCount + manualTurnCount
  const buildingFloors = buildRealtimeFloors(routeStartFloor, currentFloor, totalTurnsForBuilding)

  return (
    <View style={styles.page}>
      <Header title="标定采集" back />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        style={styles.flex}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: 24 }]}
      >
        <View style={styles.hero}>
          <Text style={styles.title}>{phase === 'recording' ? '记录这段楼梯' : '标定新路线'}</Text>
          <Text style={styles.subtitle}>{phase === 'recording' ? '到达新楼层或转角时，留下一个标记。到终点后停止并复核。' : '从起点开始，记录一轮真实爬楼，再确认楼层。'}</Text>
        </View>

        {phase === 'ready' ? (
          <Card raised style={styles.formCard}>
            <Text style={styles.fieldLabel}>路线名称</Text>
            <TextInput
              style={styles.input}
              value={routeName}
              onChangeText={setRouteName}
              placeholder="如：上海中心大厦1层→7层"
              placeholderTextColor={theme.muted}
              returnKeyType="done"
              blurOnSubmit
            />
            <Text style={styles.fieldLabel}>固定携带方式</Text>
            <Text style={styles.fieldHint}>
              不同携带位置步态特征不同，建议每次标定与爬楼保持一致
            </Text>
            <View style={styles.carryRow}>
              <Pressable
                style={[
                  styles.carryOption,
                  carryMode === 'pocket' && styles.carryOptionActive,
                ]}
                onPress={() => setCarryMode('pocket')}
              >
                <Text
                  style={[
                    styles.carryText,
                    carryMode === 'pocket' && styles.carryTextActive,
                  ]}
                >
                  固定裤袋
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.carryOption,
                  carryMode === 'waist' && styles.carryOptionActive,
                ]}
                onPress={() => setCarryMode('waist')}
              >
                <Text
                  style={[
                    styles.carryText,
                    carryMode === 'waist' && styles.carryTextActive,
                  ]}
                >
                  固定腰包
                </Text>
              </Pressable>
            </View>
          </Card>
        ) : (
          <View style={styles.lockedCard}>
            <Text style={styles.lockedName}>{routeName}</Text>
            <Text style={styles.lockedSub}>
              {carryMode === 'waist' ? '固定腰包' : '固定裤袋'} · 采集中已锁定
            </Text>
          </View>
        )}

        {phase === 'recording' ? (
          <>
            <View style={styles.captureOverview}>
              <Text style={styles.captureLabel}>当前楼层</Text>
              <View style={styles.captureNumberLine}>
                <Text selectable style={styles.captureNumber}>{currentFloor}</Text>
                <Text style={styles.captureUnit}>层</Text>
              </View>
              <Text selectable style={styles.captureElapsed}>采集中 · {elapsed}</Text>
              <View style={styles.captureStats}>
                <Text selectable style={styles.captureStat}>{stepCount} 步</Text>
                <Text selectable style={styles.captureStat}>爬升 {ascentM.toFixed(1)} 米</Text>
              </View>
            </View>
            {warnings.length ? <Text style={styles.warnText}>{warnings.join('；')}</Text> : null}
            {signal === 'interrupted' || gapsRef.current.length > 0 ? <Text style={styles.warnText}>传感器有中断，请保持前台；这次采集可能需要复核。</Text> : null}
            {/* 人工标记按钮 */}
            <Card raised style={styles.markCard}>
              <Text style={styles.markTitle}>人工标记</Text>
              <Text style={styles.markHint}>
                当前楼层 {currentFloor}层 · 已标记 {floorMarkCount} 个新楼层
              </Text>
              <View style={styles.markRow}>
                <Pressable accessibilityRole="button" accessibilityLabel="标记刚刚完成的转弯" style={[styles.markBtn, styles.markTurnBtn]} onPress={handleMarkTurn}>
                  <Text style={styles.markBtnIcon}>↩</Text>
                  <Text style={styles.markBtnText}>标记拐弯</Text>
                  <Text style={styles.markBtnSub}>+{manualTurnCount}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`确认到达 ${currentFloor + 1} 层`} style={[styles.markBtn, styles.markFloorBtn]} onPress={handleMarkFloor}>
                  <Text style={styles.markBtnIcon}>▲</Text>
                  <Text style={styles.markBtnText}>到达新楼层</Text>
                  <Text style={styles.markBtnSub}>{currentFloor}层 → {currentFloor + 1}层</Text>
                </Pressable>
              </View>
            </Card>
            <Disclosure title="采集技术详情">
            <View style={styles.vizCard}>
              {/* 脉动采集指示器 */}
              <View style={styles.vizHead}>
                <View style={styles.vizHeadLeft}>
                  <Animated.View
                    style={[
                      styles.pulseDot,
                      {
                        opacity: pulseAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.35, 1],
                        }),
                        transform: [
                          {
                            scale: pulseAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.8, 1.3],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                  <Text style={styles.vizTitle}>采集中</Text>
                </View>
                <Pill tone={signalTone}>{signalText}</Pill>
              </View>

              {/* 大楼剖面简笔画：把楼层+拐弯+当前进度合成成一张图 */}
              <BuildingSketch
                floors={buildingFloors}
                climbing
                style={styles.buildingSketch}
              />

              {/* 实时加速度波形（对称条形） */}
              <View style={styles.waveformWrap}>
                <View style={styles.waveform}>
                  {waveBars.map((v, i) => {
                    // 净加速度缩放到条形高度（约 6 m/s² 满格，单边最高 30px）
                    const h = Math.min(30, v * 5)
                    const intensity = Math.min(1, v / 6)
                    // 强度越高颜色越偏向橙红
                    const barColor = intensity > 0.6 ? theme.amber : theme.brand
                    return (
                      <View
                        key={i}
                        style={[styles.waveBarWrap, { flexGrow: 1 }]}
                      >
                        <View
                          style={[
                            styles.waveBar,
                            {
                              height: Math.max(2, h),
                              backgroundColor: barColor,
                              opacity: 0.35 + intensity * 0.65,
                            },
                          ]}
                        />
                        <View
                          style={[
                            styles.waveBar,
                            {
                              height: Math.max(2, h),
                              backgroundColor: barColor,
                              opacity: 0.35 + intensity * 0.65,
                            },
                          ]}
                        />
                      </View>
                    )
                  })}
                </View>
                <View style={styles.waveformAxis}>
                  <Text style={styles.waveformAxisText}>运动强度</Text>
                  <Text style={styles.waveformAxisText}>
                    {peakIntensity > 0.6 ? '强烈' : peakIntensity > 0.2 ? '活动中' : '平稳'}
                  </Text>
                </View>
              </View>

              {/* 实时指标四联：用时/步数/步频/爬升 */}
              <View style={styles.vizMetrics}>
                <View style={styles.vizMetric}>
                  <Text style={styles.vizMetricValue}>{elapsed}</Text>
                  <Text style={styles.vizMetricLabel}>用时</Text>
                </View>
                <View style={styles.vizMetricDivider} />
                <View style={styles.vizMetric}>
                  <Text style={styles.vizMetricValue}>{stepCount}</Text>
                  <Text style={styles.vizMetricLabel}>步数</Text>
                </View>
                <View style={styles.vizMetricDivider} />
                <View style={styles.vizMetric}>
                  <Text style={styles.vizMetricValue}>{cadence}</Text>
                  <Text style={styles.vizMetricLabel}>步/分</Text>
                </View>
                <View style={styles.vizMetricDivider} />
                <View style={styles.vizMetric}>
                  <Text style={styles.vizMetricValue}>{ascentM.toFixed(1)}</Text>
                  <Text style={styles.vizMetricLabel}>爬升米数</Text>
                </View>
              </View>

              {/* 拐弯检测：自动 + 人工 */}
              <View style={styles.turnRow}>
                <View style={styles.turnBlock}>
                  <Text style={styles.turnValue}>{turnCount}</Text>
                  <Text style={styles.turnLabel}>自动拐弯</Text>
                </View>
                <View style={styles.turnBlock}>
                  <Text style={styles.turnValue}>{manualTurnCount}</Text>
                  <Text style={styles.turnLabel}>人工拐弯</Text>
                </View>
                <View style={styles.turnBlock}>
                  <Text style={[styles.turnValue, { color: theme.brandInk }]}>
                    {lastTurnDir === 'left' ? '左' : lastTurnDir === 'right' ? '右' : '—'}
                  </Text>
                  <Text style={styles.turnLabel}>上次方向</Text>
                </View>
              </View>

              {/* 传感器诊断：实时 |a| / net / 校准重力，便于判断数据是否正常 */}
              <View style={styles.diagRow}>
                <View style={styles.diagBlock}>
                  <Text style={styles.diagValue}>{diagMag.toFixed(2)}</Text>
                  <Text style={styles.diagLabel}>加速度（米/秒²）</Text>
                </View>
                <View style={styles.diagBlock}>
                  <Text
                    style={[
                      styles.diagValue,
                      { color: diagNet > STEP_THRESHOLD ? theme.amber : theme.ink },
                    ]}
                  >
                    {diagNet.toFixed(2)}
                  </Text>
                  <Text style={styles.diagLabel}>净加速度（米/秒²，阈值{STEP_THRESHOLD}）</Text>
                </View>
                <View style={styles.diagBlock}>
                  <Text style={styles.diagValue}>{diagGravity.toFixed(2)}</Text>
                  <Text style={styles.diagLabel}>重力基线</Text>
                </View>
              </View>

              {/* 气压仅显示参考米数与方向，不能换算楼层。 */}
              <View style={styles.baroRow}>
                <View style={styles.baroStatusBlock}>
                  <Text
                    style={[
                      styles.baroStatusText,
                      {
                        color:
                          baroAvailable === true
                            ? theme.brandInk
                            : baroAvailable === false
                              ? theme.muted
                              : theme.amber,
                      },
                    ]}
                  >
                    {baroAvailable === true
                      ? '气压计已连接'
                      : baroAvailable === false
                        ? '气压计不可用'
                        : '气压计检测中…'}
                  </Text>
                </View>
                <View style={styles.baroBlock}>
                  <Text style={styles.baroValue}>
                    {baroPressure > 0 ? baroPressure.toFixed(1) : '—'}
                  </Text>
                  <Text style={styles.baroLabel}>百帕</Text>
                </View>
                <View style={styles.baroBlock}>
                  <Text
                    style={[
                      styles.baroValue,
                      { color: baroRelAltitude > 0.5 ? theme.brandInk : theme.ink },
                    ]}
                  >
                    {baroAvailable === true ? `+${baroRelAltitude.toFixed(1)}` : '—'}
                  </Text>
                  <Text style={styles.baroLabel}>参考米数 · 估计</Text>
                </View>
                <View style={styles.baroBlock}>
                  <Text style={[styles.baroValue, { color: theme.amber }]}>
                    {pressureDirection === 'up' ? '上升' : pressureDirection === 'down' ? '下降' : pressureDirection === 'level' ? '暂时平稳' : '还看不清'}
                  </Text>
                  <Text style={styles.baroLabel}>气压走势</Text>
                </View>
              </View>

              {/* 异常实时提醒 */}
              {warnings.length > 0 ? (
                <View style={styles.warnBox}>
                  {warnings.map((w, i) => (
                    <Text key={i} style={styles.warnText}>· {w}</Text>
                  ))}
                </View>
              ) : null}

              {signal === 'interrupted' ? (
                <Text style={styles.warnText}>
                  传感器信号中断，请保持应用在前台、不要锁屏。
                </Text>
              ) : null}
              {gapsRef.current.length > 0 ? (
                <Text style={styles.warnText}>
                  已记录 {gapsRef.current.length} 段中断，可能影响识别精度。
                </Text>
              ) : null}
            </View>

            </Disclosure>
          </>
        ) : (
          <View style={styles.metricGrid}>
            <Metric label="用时" value={elapsed} style={styles.metric} />
            <Metric label="样本数" value={sampleCount} style={styles.metric} />
          </View>
        )}

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Button title="放弃并返回" variant="secondary" onPress={handleCancel} />

        {phase === 'ready' ? (
          <Disclosure title="采集说明与地点"><View style={styles.guideCard}>
            <Text style={styles.guideTitle}>采集说明</Text>
            <Text style={styles.guideText}>
              1. 到达起点楼层后点击「开始采集」。{'\n'}
              2. 保持手机固定在 {carryMode === 'waist' ? '腰包' : '裤袋'}，朝向一致。{'\n'}
              3. 每爬到楼梯转角时点击「标记拐弯」。{'\n'}
              4. 每到达一个新楼层时点击「到达新楼层」。{'\n'}
              5. 到达终点楼层后点击「停止并分析」。{'\n'}
              {'\n'}
              气压只帮助观察上升或下降，不能直接数楼层。{'\n'}
              每层请看楼层标志再标记，到终点后核对记录。
            </Text>
            <View style={styles.guideAddrBox}>
              <Text style={styles.guideAddrLabel}>地址</Text>
              <Text style={styles.guideAddrText}>{seed.location?.address || seed.location?.name || '未记录地点，也可以记录路线'}</Text>
            </View>
          </View></Disclosure>
        ) : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        {phase === 'ready' ? (
          <Button title="开始采集" onPress={handleStart} />
        ) : phase === 'recording' ? (
          <Button title={analyzing ? '分析中…' : '停止并分析'} onPress={handleStop} loading={analyzing} />
        ) : <Button title="已跳转复核" disabled />}
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
      color: theme.brand,
      fontSize: theme.fontEyebrow,
      fontWeight: '700',    },
    title: {
      marginTop: 6,
      color: theme.ink,
      fontSize: theme.fontTitle,
      fontWeight: '700',
      lineHeight: 34,
    },
    subtitle: {
      color: theme.mutedStrong,
      fontSize: theme.fontBase,
      lineHeight: 22,
    },
    guideCard: { paddingVertical: 8 },
    formCard: { padding: 16 },
    lockedCard: { paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
    lockedName: {
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '700',
    },
    lockedSub: {
      marginTop: 4,
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
    },
    fieldLabel: {
      color: theme.ink,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '600',
      marginBottom: 8,
    },
    fieldHint: {
      color: theme.muted,
      fontSize: theme.fontSmall,
      marginBottom: 8,
      lineHeight: 18,
    },
    input: {
      minHeight: theme.tapMin,
      borderWidth: 1,
      borderColor: theme.line,
      borderRadius: theme.radiusSm,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: theme.fontBase,
      lineHeight: 22,
      color: theme.ink,
      marginBottom: 16,
    },
    carryRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    carryOption: {
      flex: 1,
      minWidth: 120,
      minHeight: theme.tapMin,
      paddingVertical: 12,
      borderRadius: theme.radiusSm,
      borderWidth: 1,
      borderColor: theme.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    carryOptionActive: {
      borderColor: theme.brand,
      backgroundColor: theme.brandSoft,
    },
    carryText: {
      color: theme.muted,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '600',
    },
    carryTextActive: {
      color: theme.brand,
    },
    guideTitle: {
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
      marginBottom: 12,
    },
    guideText: {
      color: theme.muted,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
    },
    guideAddrBox: {
      marginTop: 16,
      paddingTop: 16,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line,
    },
    guideAddrLabel: {
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
      fontWeight: '600',
      marginBottom: 4,
    },
    guideAddrText: {
      color: theme.ink,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
    },
    metricGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    metric: { flexGrow: 1, flexBasis: '45%', minWidth: 0 },
    vizCard: { paddingVertical: 8 },
    buildingSketch: {
      marginBottom: 12,
      alignItems: 'center',
    },
    vizHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 12,
    },
    vizHeadLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    pulseDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: theme.brand,
    },
    vizTitle: {
      color: theme.ink,
      fontSize: theme.fontBase,
      fontWeight: '700',
    },
    waveformWrap: {
      marginBottom: 12,
    },
    waveform: {
      height: 80,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    waveBarWrap: {
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      height: '100%',
    },
    waveBar: {
      width: '100%',
      borderRadius: 2,
    },
    waveformAxis: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 6,
    },
    waveformAxisText: {
      color: theme.muted,
      fontSize: theme.fontSmall,
    },
    vizMetrics: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      paddingVertical: 16,
      gap: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    vizMetric: {
      flexGrow: 1,
      flexBasis: '45%',
      minWidth: 0,
      alignItems: 'center',
    },
    vizMetricDivider: {
      display: 'none',
    },
    vizMetricValue: {
      color: theme.ink,
      fontSize: 24,
      lineHeight: 32,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    vizMetricLabel: {
      marginTop: 2,
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
    },
    turnRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 12,
      gap: 8,
    },
    turnBlock: {
      flex: 1,
      minWidth: 88,
      alignItems: 'center',
      paddingVertical: 8,
      backgroundColor: theme.surfaceSoft,
      borderRadius: theme.radiusSm,
    },
    turnValue: {
      color: theme.ink,
      fontSize: 18,
      lineHeight: 26,
      fontWeight: '700',
    },
    turnLabel: {
      marginTop: 2,
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
    },
    diagRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 10,
      gap: 8,
    },
    diagBlock: {
      flexGrow: 1,
      flexBasis: '45%',
      minWidth: 0,
      alignItems: 'center',
      paddingVertical: 8,
      backgroundColor: theme.surfaceSoft,
      borderRadius: theme.radiusSm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
    },
    diagValue: {
      color: theme.ink,
      fontSize: theme.fontBase,
      lineHeight: 22,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    diagLabel: {
      marginTop: 2,
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
      textAlign: 'center',
    },
    baroRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 8,
      gap: 8,
      alignItems: 'stretch',
    },
    baroStatusBlock: {
      flexBasis: '100%',
      paddingVertical: 10,
      paddingHorizontal: 8,
      backgroundColor: theme.surfaceSoft,
      borderRadius: theme.radiusSm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      justifyContent: 'center',
    },
    baroStatusText: {
      fontSize: theme.fontSmall,
      lineHeight: 18,
      fontWeight: '600',
      textAlign: 'center',
    },
    baroBlock: {
      flexGrow: 1,
      flexBasis: '45%',
      minWidth: 0,
      alignItems: 'center',
      paddingVertical: 8,
      backgroundColor: theme.surfaceSoft,
      borderRadius: theme.radiusSm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
    },
    baroValue: {
      color: theme.ink,
      fontSize: theme.fontBase,
      lineHeight: 22,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    baroLabel: {
      marginTop: 2,
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
      textAlign: 'center',
    },
    warnBox: {
      marginTop: 12,
      padding: 16,
      backgroundColor: theme.amberSoft,
      borderRadius: theme.radiusMd,
    },
    warnText: {
      marginTop: 8,
      color: theme.amberInk,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
    },
    markCard: { padding: 16 },
    markTitle: {
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
    },
    markHint: {
      marginTop: 4,
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
      marginBottom: 12,
    },
    markRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    markBtn: {
      flex: 1,
      minWidth: 120,
      minHeight: 96,
      paddingVertical: 16,
      borderRadius: theme.radiusMd,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markTurnBtn: {
      backgroundColor: theme.amberChip,
    },
    markFloorBtn: {
      backgroundColor: theme.brandSoft,
    },
    markBtnIcon: {
      color: theme.ink,
      fontSize: 22,
      fontWeight: '700',
      marginBottom: 2,
    },
    markBtnText: {
      color: theme.ink,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '700',
    },
    markBtnSub: {
      marginTop: 2,
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
    },
    errorBox: {
      backgroundColor: theme.redSoft,
      borderRadius: theme.radiusMd,
      padding: 16,
    },
    errorText: {
      color: theme.redInk,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
    },
    captureOverview: { gap: 8, paddingVertical: 8 },
    captureLabel: { color: theme.mutedStrong, fontSize: theme.fontSmall, lineHeight: 18 },
    captureNumberLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 },
    captureNumber: { color: theme.ink, fontSize: 52, lineHeight: 64, fontWeight: '700', fontVariant: ['tabular-nums'] },
    captureUnit: { color: theme.mutedStrong, fontSize: 20, lineHeight: 28 },
    captureElapsed: { color: theme.brand, fontSize: theme.fontBase, lineHeight: 22, fontVariant: ['tabular-nums'] },
    captureStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
    captureStat: { color: theme.mutedStrong, fontSize: theme.fontBase, lineHeight: 22, fontVariant: ['tabular-nums'] },
    footer: { backgroundColor: theme.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, paddingHorizontal: theme.pagePaddingH, paddingTop: 8 },
  })
