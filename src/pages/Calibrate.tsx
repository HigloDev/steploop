// 标定采集页：启动 SensorRecorder 全程保留样本，停止后 analyzeCalibration 生成 draft，
// setActiveDraft 并跳转 Review。是 RouteEdit → Calibrate → Review 流程的中间环节。
//
// 采集时实时展示：步数、步频、净加速度波形、垂直位移估算、自动拐弯检测、
// 人工标记（拐弯/新楼层）、每层步数用时统计、异常实时提醒。

import React, { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Header } from '../components/Header'
import { BuildingSketch, buildRealtimeFloors } from '../components/BuildingSketch'
import { Button, Card, Metric, Pill } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import { SensorRecorder, SensorStatus, sensorStartErrorMessage } from '../services/sensor'
import { setActiveDraft } from '../services/draft'
import { analyzeCalibration } from '../core/analysis'
import { formatDuration, uid } from '../core/math'
import { ManualMark, RouteSeed, SensorSample, BarometerStatus } from '../core/types'
import { triggerHaptic } from '../services/preferences'
import { pressureToAltitude } from '../core/analysis'

type Phase = 'ready' | 'recording' | 'stopped'

// 波形可视化配置
const WAVEFORM_BARS = 48        // 显示条形数
const WAVEFORM_BUF = 240        // 缓冲最近样本（约 5 秒 @ 50Hz）
const WAVE_TICK_MS = 33         // 约 30fps 刷新
const GRAVITY = 9.8             // 重力基线（仅作 fallback，实际用前 1 秒采样校准）
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
  const [currentFloor, setCurrentFloor] = useState(1)
  const [floorMarkCount, setFloorMarkCount] = useState(0)

  // 实时指标
  const [cadence, setCadence] = useState(0)              // 步/分钟
  const [ascentM, setAscentM] = useState(0)              // 估算垂直爬升

  // 气压计实时显示
  // null = 未知（采集启动后 3 秒内待定），true/false = 是否可用
  const [baroAvailable, setBaroAvailable] = useState<boolean | null>(null)
  const [baroPressure, setBaroPressure] = useState(0)         // 当前气压 hPa
  const [baroRelAltitude, setBaroRelAltitude] = useState(0)   // 相对起点海拔 m
  const [baroFloorDetected, setBaroFloorDetected] = useState(0) // 气压自动检测到的楼层数
  const baroStartPressureRef = useRef<number | null>(null)    // 起点气压（首次样本）
  const baroFloorCountRef = useRef(0)                         // 气压楼层计数（ref）
  const baroLastFloorAtRef = useRef(0)                        // 上次楼层检测时间
  const BARO_FLOOR_THRESHOLD_HPA = 0.3                        // 楼层气压阈值
  const BARO_FLOOR_COOLDOWN_MS = 2000                         // 楼层检测冷却

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
    setCurrentFloor(1)
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
    setBaroFloorDetected(0)
    baroStartPressureRef.current = null
    baroFloorCountRef.current = 0
    baroLastFloorAtRef.current = 0
    const recorder = new SensorRecorder({
      retainSamples: true,
      onSample: (sample) => {
        samplesRef.current.push(sample)
        setSampleCount(samplesRef.current.length)
        // 计算加速度幅值 |a|
        const mag = Math.sqrt(
          sample.ax * sample.ax + sample.ay * sample.ay + sample.az * sample.az,
        )
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
          // 相对海拔 = 当前海拔 - 起点海拔
          const startP = baroStartPressureRef.current
          if (startP !== null) {
            const relAlt = pressureToAltitude(status.pressure) - pressureToAltitude(startP)
            setBaroRelAltitude(Number(relAlt.toFixed(1)))
            // 实时楼层检测：气压下降超阈值且过冷却时间
            const drop = startP - status.pressure
            const expectedFloors = Math.floor(drop / BARO_FLOOR_THRESHOLD_HPA)
            const now = Date.now()
            if (
              expectedFloors > baroFloorCountRef.current &&
              now - baroLastFloorAtRef.current > BARO_FLOOR_COOLDOWN_MS
            ) {
              baroFloorCountRef.current = expectedFloors
              baroLastFloorAtRef.current = now
              setBaroFloorDetected(expectedFloors)
            }
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
        // 估算垂直爬升：气压计可用时用气压反算（更准），否则按步数估算
        if (baroFloorCountRef.current > 0 || baroStartPressureRef.current !== null) {
          // 气压爬升已在 onBarometer 中更新到 baroRelAltitude，这里同步到 ascentM
          setAscentM(baroRelAltitude)
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
              navigation.navigate('RouteEdit')
            },
          },
        ],
      )
      return
    }
    navigation.navigate('RouteEdit')
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

  // 大楼简笔画：起始楼层固定为 1（Calibrate 内部未提供编辑入口）
  // 拐弯段总数 = 自动拐弯 + 人工拐弯，按已完成楼层均分
  const totalTurnsForBuilding = turnCount + manualTurnCount
  const buildingFloors = buildRealtimeFloors(1, currentFloor, totalTurnsForBuilding)

  return (
    <View style={styles.page}>
      <Header title="标定采集" back />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        <View style={styles.hero}>
          <Text style={styles.title}>标定新路线</Text>
          <Text style={styles.subtitle}>采集中显示运动强度</Text>
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
          <Card raised style={styles.lockedCard}>
            <Text style={styles.lockedName}>{routeName}</Text>
            <Text style={styles.lockedSub}>
              {carryMode === 'waist' ? '固定腰包' : '固定裤袋'} · 采集中已锁定
            </Text>
          </Card>
        )}

        {phase === 'recording' ? (
          <>
            <Card raised style={styles.vizCard}>
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
                    const barColor = intensity > 0.6 ? theme.amber : theme.green
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
                  <Text style={[styles.turnValue, { color: theme.greenInk }]}>
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

              {/* 气压计实时显示：气压 / 相对海拔 / 自动楼层 */}
              <View style={styles.baroRow}>
                <View style={styles.baroStatusBlock}>
                  <Text
                    style={[
                      styles.baroStatusText,
                      {
                        color:
                          baroAvailable === true
                            ? theme.greenInk
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
                      { color: baroRelAltitude > 0.5 ? theme.greenInk : theme.ink },
                    ]}
                  >
                    {baroAvailable === true ? `+${baroRelAltitude.toFixed(1)}` : '—'}
                  </Text>
                  <Text style={styles.baroLabel}>相对爬升米数</Text>
                </View>
                <View style={styles.baroBlock}>
                  <Text style={[styles.baroValue, { color: theme.amber }]}>
                    {baroAvailable === true ? baroFloorDetected : '—'}
                  </Text>
                  <Text style={styles.baroLabel}>气压楼层</Text>
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
            </Card>

            {/* 人工标记按钮 */}
            <Card raised style={styles.markCard}>
              <Text style={styles.markTitle}>人工标记</Text>
              <Text style={styles.markHint}>
                当前楼层 {currentFloor}层 · 已标记 {floorMarkCount} 个新楼层
              </Text>
              <View style={styles.markRow}>
                <Pressable style={[styles.markBtn, styles.markTurnBtn]} onPress={handleMarkTurn}>
                  <Text style={styles.markBtnIcon}>↩</Text>
                  <Text style={styles.markBtnText}>标记拐弯</Text>
                  <Text style={styles.markBtnSub}>+{manualTurnCount}</Text>
                </Pressable>
                <Pressable style={[styles.markBtn, styles.markFloorBtn]} onPress={handleMarkFloor}>
                  <Text style={styles.markBtnIcon}>▲</Text>
                  <Text style={styles.markBtnText}>到达新楼层</Text>
                  <Text style={styles.markBtnSub}>{currentFloor}层 → {currentFloor + 1}层</Text>
                </Pressable>
              </View>
            </Card>
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

        {phase === 'ready' ? (
          <Button title="开始采集" onPress={handleStart} />
        ) : phase === 'recording' ? (
          <Button
            title={analyzing ? '分析中…' : '停止并分析'}
            onPress={handleStop}
            loading={analyzing}
          />
        ) : (
          <Button title="已跳转复核" disabled />
        )}
        <Button title="放弃并返回" variant="secondary" onPress={handleCancel} />

        {phase === 'ready' ? (
          <Card raised style={styles.guideCard}>
            <Text style={styles.guideTitle}>采集说明</Text>
            <Text style={styles.guideText}>
              1. 到达起点楼层后点击「开始采集」。{'\n'}
              2. 保持手机固定在 {carryMode === 'waist' ? '腰包' : '裤袋'}，朝向一致。{'\n'}
              3. 每爬到楼梯转角时点击「标记拐弯」。{'\n'}
              4. 每到达一个新楼层时点击「到达新楼层」。{'\n'}
              5. 到达终点楼层后点击「停止并分析」。{'\n'}
              {'\n'}
              气压计会自动检测楼层变化（精度±0.3米），{'\n'}
              若手机有气压计，可少做或不做人工楼层标记。
            </Text>
            <View style={styles.guideAddrBox}>
              <Text style={styles.guideAddrLabel}>地址</Text>
              <Text style={styles.guideAddrText}>{seed.location.address || seed.location.name}</Text>
            </View>
          </Card>
        ) : null}
      </ScrollView>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: theme.pagePaddingH },
    hero: { marginTop: 8, marginBottom: 16 },
    eyebrow: {
      color: theme.green,
      fontSize: theme.fontEyebrow,
      fontWeight: '700',
      letterSpacing: 1.5,
    },
    title: {
      marginTop: 6,
      color: theme.ink,
      fontSize: theme.fontTitle,
      fontWeight: '700',
      lineHeight: 32,
    },
    subtitle: {
      marginTop: 6,
      color: theme.muted,
      fontSize: theme.fontSubtitle,
    },
    guideCard: { padding: 14, marginBottom: 12 },
    formCard: { padding: 14, marginBottom: 12 },
    lockedCard: { padding: 14, marginBottom: 12 },
    lockedName: {
      color: theme.ink,
      fontSize: 17,
      fontWeight: '700',
    },
    lockedSub: {
      marginTop: 4,
      color: theme.muted,
      fontSize: 12,
    },
    fieldLabel: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '700',
      marginBottom: 6,
    },
    fieldHint: {
      color: theme.muted,
      fontSize: 12,
      marginBottom: 8,
      marginTop: -2,
      lineHeight: 17,
    },
    input: {
      borderWidth: 1,
      borderColor: theme.line,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: theme.ink,
      marginBottom: 14,
    },
    carryRow: {
      flexDirection: 'row',
      gap: 10,
    },
    carryOption: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      borderWidth: 1.5,
      borderColor: theme.line,
      alignItems: 'center',
    },
    carryOptionActive: {
      borderColor: theme.green,
      backgroundColor: theme.greenSoft,
    },
    carryText: {
      color: theme.muted,
      fontSize: 14,
      fontWeight: '600',
    },
    carryTextActive: {
      color: theme.green,
    },
    guideTitle: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '700',
      marginBottom: 6,
    },
    guideText: {
      color: theme.muted,
      fontSize: 13,
      lineHeight: 20,
    },
    guideAddrBox: {
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line,
    },
    guideAddrLabel: {
      color: theme.muted,
      fontSize: 11,
      fontWeight: '600',
      marginBottom: 2,
    },
    guideAddrText: {
      color: theme.ink,
      fontSize: 13,
    },
    metricGrid: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 8,
    },
    metric: { flex: 1 },
    vizCard: { padding: 14, marginBottom: 12 },
    buildingSketch: {
      marginBottom: 12,
      alignItems: 'center',
    },
    vizHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
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
      backgroundColor: theme.green,
    },
    vizTitle: {
      color: theme.ink,
      fontSize: 15,
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
      fontSize: 11,
    },
    vizMetrics: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    vizMetric: {
      flex: 1,
      alignItems: 'center',
    },
    vizMetricDivider: {
      width: StyleSheet.hairlineWidth,
      height: 28,
      backgroundColor: theme.line,
    },
    vizMetricValue: {
      color: theme.ink,
      fontSize: 18,
      fontWeight: '800',
    },
    vizMetricLabel: {
      marginTop: 2,
      color: theme.muted,
      fontSize: 11,
    },
    turnRow: {
      flexDirection: 'row',
      marginTop: 12,
      gap: 8,
    },
    turnBlock: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 8,
      backgroundColor: theme.surfaceSoft,
      borderRadius: 8,
    },
    turnValue: {
      color: theme.ink,
      fontSize: 18,
      fontWeight: '800',
    },
    turnLabel: {
      marginTop: 2,
      color: theme.muted,
      fontSize: 11,
    },
    diagRow: {
      flexDirection: 'row',
      marginTop: 10,
      gap: 8,
    },
    diagBlock: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 8,
      backgroundColor: theme.surfaceSoft,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
    },
    diagValue: {
      color: theme.ink,
      fontSize: 15,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    diagLabel: {
      marginTop: 2,
      color: theme.muted,
      fontSize: 10,
      textAlign: 'center',
    },
    baroRow: {
      flexDirection: 'row',
      marginTop: 8,
      gap: 8,
      alignItems: 'stretch',
    },
    baroStatusBlock: {
      flex: 1.4,
      paddingVertical: 10,
      paddingHorizontal: 8,
      backgroundColor: theme.surfaceSoft,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      justifyContent: 'center',
    },
    baroStatusText: {
      fontSize: 12,
      fontWeight: '600',
      textAlign: 'center',
    },
    baroBlock: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 8,
      backgroundColor: theme.surfaceSoft,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
    },
    baroValue: {
      color: theme.ink,
      fontSize: 15,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    baroLabel: {
      marginTop: 2,
      color: theme.muted,
      fontSize: 10,
      textAlign: 'center',
    },
    warnBox: {
      marginTop: 10,
      padding: 10,
      backgroundColor: theme.amberSoft,
      borderLeftWidth: 3,
      borderLeftColor: theme.amber,
      borderRadius: 4,
    },
    warnText: {
      marginTop: 6,
      color: theme.amberInk,
      fontSize: 12,
      lineHeight: 18,
    },
    markCard: { padding: 14, marginBottom: 12 },
    markTitle: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '700',
    },
    markHint: {
      marginTop: 4,
      color: theme.muted,
      fontSize: 12,
      marginBottom: 10,
    },
    markRow: {
      flexDirection: 'row',
      gap: 10,
    },
    markBtn: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markTurnBtn: {
      backgroundColor: theme.amberChip,
    },
    markFloorBtn: {
      backgroundColor: theme.greenSoft,
    },
    markBtnIcon: {
      color: theme.ink,
      fontSize: 22,
      fontWeight: '800',
      marginBottom: 2,
    },
    markBtnText: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '700',
    },
    markBtnSub: {
      marginTop: 2,
      color: theme.muted,
      fontSize: 11,
    },
    errorBox: {
      backgroundColor: theme.amberSoft,
      borderLeftWidth: 3,
      borderLeftColor: theme.red,
      borderRadius: 4,
      padding: 11,
      marginVertical: 10,
    },
    errorText: {
      color: theme.red,
      fontSize: 12,
      lineHeight: 18,
    },
  })
