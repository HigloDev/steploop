import React, { memo, useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import {
  SensorMotionActivity,
  SensorVisualizationState,
  SensorWavePoint,
} from '../core/sensor-visualization'
import { clamp } from '../core/math'
import { Theme, useTheme } from '../theme'
import { useReduceMotion } from './ui'

interface SensorMotionVisualizerProps {
  visualization: SensorVisualizationState
  currentFloor: number
  startFloor: number
  endFloor: number
  barometerAvailable: boolean
  routeLearning?: boolean
  journey?: 'ascending' | 'returning'
}

const ACTIVITY_LABEL: Record<SensorMotionActivity, string> = {
  waiting: '等待传感器',
  still: '原地停留',
  climbing: '正在上楼',
  turning_left: '正在左转',
  turning_right: '正在右转',
  descending_stairs: '正在下楼',
  elevator_down: '电梯下降',
  elevator_up: '可能正在乘电梯上行',
  walking: '在走动，暂未看出上楼',
  uncertain: '在走动，上下方向还拿不准',
}

// 波形显示（纯 View 柱状图实现）。
//
// 重要：不要改回 react-native-svg。真机实测在 RN 0.86 新架构下，
// SVG 图表每次重渲染（即便只有几条动态 Path）都会在原生侧持续泄漏
// 内存（约 0.6MB/s，长训会被系统杀进程）。普通 View 重渲染无泄漏。
// 波形刷新频率 2.5fps（见 sensor-visualization.ts DISPLAY_INTERVAL_MS）。

const WAVE_BAR_WIDTH = 4
const WAVE_BAR_GAP = 2
const WAVE_BAR_MAX_HEIGHT = 34
const WAVE_LABEL_WIDTH = 44
const WAVE_ROW_HEIGHT = 48

// D10 减少动画：系统开启「减少动画」后，波形不再跟随 2.5fps 的流式刷新，
// 降级为「静态快照 + 10 秒低频更新」（合同验收 4）。
const REDUCED_MOTION_REFRESH_MS = 10000

/**
 * 波形数据节流：
 * - `refreshMs <= 0`：原样返回（跟随训练页 2.5fps 刷新）；
 * - `refreshMs > 0`：只在低频定时器里取最新快照，中间帧不进入渲染。
 * hook 必须无条件调用，所以用 refreshMs 是否大于 0 来切换，而不是条件调用。
 */
function useDisplayWaves(
  waves: SensorWavePoint[],
  refreshMs: number,
): SensorWavePoint[] {
  const [snapshot, setSnapshot] = useState(waves)
  const latest = useRef(waves)
  latest.current = waves
  // 训练刚开始还没有波形时先实时显示，避免开了「减少动画」后头 10 秒空白。
  const empty = waves.length === 0

  useEffect(() => {
    if (refreshMs <= 0) return
    setSnapshot(latest.current)
    const timer = setInterval(() => setSnapshot(latest.current), refreshMs)
    return () => clearInterval(timer)
  }, [refreshMs, empty])

  return refreshMs > 0 && snapshot.length > 0 ? snapshot : waves
}

function WaveRow({
  label,
  values,
  color,
  minValue,
  maxValue,
  theme,
}: {
  label: string
  values: number[]
  color: string
  minValue: number
  maxValue: number
  theme: Theme
}) {
  const range = Math.max(0.001, maxValue - minValue)
  return (
    <View style={stylesFor(theme).waveRow}>
      <Text style={stylesFor(theme).waveLabel}>{label}</Text>
      <View style={stylesFor(theme).waveRowBody}>
        {values.map((value, index) => {
          const normalized = clamp((value - minValue) / range, 0, 1)
          const barHeight = Math.max(2, normalized * WAVE_BAR_MAX_HEIGHT)
          return (
            <View
              key={index}
              style={[
                stylesFor(theme).waveBar,
                { height: barHeight, backgroundColor: color },
              ]}
            />
          )
        })}
      </View>
    </View>
  )
}

function WaveformPanel({
  visualization,
  waves,
  barometerAvailable,
  reducedMotion,
  theme,
}: {
  visualization: SensorVisualizationState
  waves: SensorWavePoint[]
  barometerAvailable: boolean
  reducedMotion: boolean
  theme: Theme
}) {
  const heightValues = waves.map((point) => point.height)
  const heightMin = Math.min(0, ...heightValues)
  const heightMax = Math.max(0.5, ...heightValues)
  const latest = waves[waves.length - 1]
  const styles = stylesFor(theme)
  // D10 读屏：图表用一句文字摘要代替逐条柱子；柱子本身是装饰，不进读屏树。
  const chartSummary = latest
    ? `传感器波形图：动作幅度 ${latest.motion.toFixed(2)}，转向 ${latest.turn.toFixed(
        2,
      )}，气压估计变化 ${
        barometerAvailable ? `${visualization.relativeHeightM.toFixed(1)} 米` : '不可用'
      }。${reducedMotion ? '已按系统「减少动画」降级，波形每 10 秒更新一次。' : '波形约每 0.4 秒更新一次。'}`
    : '传感器波形图：还没有采样数据。'

  return (
    <View
      style={styles.chart}
      accessible
      accessibilityRole="image"
      accessibilityLabel={chartSummary}
    >
      {waves.length ? (
        <View
          // 波形柱、坐标标签与图例都是图表的视觉表达，摘要已经在父节点给出，
          // 这里让读屏跳过，避免重复朗读几十个数字。
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <WaveRow
            label="动作"
            values={waves.map((point) => point.motion)}
            color={theme.brandTint}
            minValue={0}
            maxValue={1}
            theme={theme}
          />
          <WaveRow
            label="转向"
            values={waves.map((point) => point.turn)}
            color={theme.orange}
            minValue={-1}
            maxValue={1}
            theme={theme}
          />
          {barometerAvailable ? (
            <WaveRow
              label="气压"
              values={waves.map((point) => point.height)}
              color={theme.infoInk}
              minValue={heightMin}
              maxValue={heightMax}
              theme={theme}
            />
          ) : (
            <View style={styles.waveRow}>
              <Text style={styles.waveLabel}>气压</Text>
              <Text style={styles.noBaro}>无气压计</Text>
            </View>
          )}

          <View style={styles.waveReadingRow}>
            <View style={styles.waveReadingItem}>
              <Text style={[styles.waveReadingLabel, { color: theme.brandTint }]}>
                动作
              </Text>
              <Text style={styles.waveReadingValue}>
                {latest.motion.toFixed(2)}
              </Text>
            </View>
            <View style={styles.waveReadingItem}>
              <Text style={[styles.waveReadingLabel, { color: theme.orange }]}>
                转向
              </Text>
              <Text style={styles.waveReadingValue}>
                {latest.turn > 0 ? '+' : ''}
                {latest.turn.toFixed(2)}
              </Text>
            </View>
            <View style={styles.waveReadingItem}>
              <Text style={[styles.waveReadingLabel, { color: theme.infoInk }]}>
                气压
              </Text>
              <Text style={styles.waveReadingValue}>
                {barometerAvailable
                  ? `${visualization.relativeHeightM.toFixed(1)}米`
                  : '不可用'}
              </Text>
            </View>
          </View>
        </View>
      ) : (
        <Text style={styles.emptyHint}>开始爬楼后显示实时波形</Text>
      )}
    </View>
  )
}

// memo：训练页有约 10~20 次/秒的状态更新（波形/快照/计时），
// 波形图只在 visualization 等实际变化时重渲染，避免整页级联重绘。
export const SensorMotionVisualizer = memo(function SensorMotionVisualizer({
  visualization,
  currentFloor,
  startFloor,
  barometerAvailable,
  routeLearning = false,
  journey = 'ascending',
}: SensorMotionVisualizerProps) {
  const theme = useTheme()
  const styles = stylesFor(theme)
  // D10 验收 4：系统开启「减少动画」后，波形降级为静态 + 10 秒低频更新。
  const reducedMotion = useReduceMotion()
  const displayWaves = useDisplayWaves(
    visualization.waves,
    reducedMotion ? REDUCED_MOTION_REFRESH_MS : 0,
  )
  const floorText = journey === 'returning'
    ? '返回途中，楼层请看标志'
    : `估计在 ${currentFloor} 楼`
  const activityText = ACTIVITY_LABEL[visualization.activity]

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <View>
          <Text accessibilityRole="header" style={styles.title}>
            手机记录曲线
          </Text>
          <Text style={styles.subtitle}>
            {journey === 'returning'
              ? '正在监测返回过程'
              : '脚步、转身和气压变化'}
          </Text>
        </View>
        <View
          style={styles.activityChip}
          accessible
          accessibilityLabel={`当前动作：${activityText}`}
        >
          <View style={styles.activityDot} />
          <Text style={styles.activityText}>{activityText}</Text>
        </View>
      </View>

      <WaveformPanel
        visualization={visualization}
        waves={displayWaves}
        barometerAvailable={barometerAvailable}
        reducedMotion={reducedMotion}
        theme={theme}
      />

      {reducedMotion ? (
        <Text style={styles.reducedMotionHint}>
          已按系统「减少动画」设置降级：波形每 10 秒低频更新，读数仍实时刷新。
        </Text>
      ) : null}

      <View style={styles.readingRow}>
        <View
          style={styles.readingItem}
          accessible
          accessibilityLabel={`动作判断 ${activityText}`}
        >
          <Text style={styles.readingLabel}>动作判断</Text>
          <Text selectable style={styles.readingValue}>
            {activityText}
          </Text>
        </View>
        <View
          style={styles.readingItem}
          accessible
          accessibilityLabel={`高度进度 ${
            barometerAvailable ? floorText : '无气压计'
          }`}
        >
          <Text style={styles.readingLabel}>高度进度</Text>
          <Text selectable style={styles.readingValue}>
            {barometerAvailable ? floorText : '无气压计'}
          </Text>
        </View>
        <View
          style={styles.readingItem}
          accessible
          accessibilityLabel={`判断把握 ${Math.round(
            visualization.confidence * 100,
          )}%`}
        >
          <Text style={styles.readingLabel}>判断把握</Text>
          <Text selectable style={styles.readingValue}>
            {Math.round(visualization.confidence * 100)}%
          </Text>
        </View>
      </View>

      <View
        style={styles.legendRow}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <LegendDot color={theme.brandTint} label="动作幅度" />
        <LegendDot color={theme.orange} label="左右转向" />
        <LegendDot color={theme.infoInk} label="相对高度" />
      </View>
    </View>
  )
})

function LegendDot({ color, label }: { color: string; label: string }) {
  const theme = useTheme()
  const styles = stylesFor(theme)
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  )
}

const stylesFor = (theme: Theme) =>
  StyleSheet.create({
    container: {
      marginTop: 10,
      padding: 14,
      gap: 12,
      backgroundColor: theme.card,
      borderRadius: theme.radiusLg,
      borderCurve: 'continuous',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
    },
    headingRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 10,
    },
    title: {
      color: theme.ink,
      fontSize: 18,
      fontWeight: '800',
    },
    subtitle: {
      paddingTop: 4,
      color: theme.muted,
      fontSize: 11,
    },
    activityChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: theme.brandSoft,
    },
    activityDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: theme.brand,
    },
    activityText: {
      color: theme.brand,
      fontSize: 11,
      fontWeight: '700',
    },
    chart: {
      overflow: 'hidden',
      borderRadius: theme.radiusMd,
      borderCurve: 'continuous',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      backgroundColor: theme.paper,
      paddingVertical: 8,
    },
    waveRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      height: WAVE_ROW_HEIGHT,
      paddingHorizontal: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.lineSoft,
    },
    waveLabel: {
      width: WAVE_LABEL_WIDTH,
      color: theme.muted,
      fontSize: 10,
      fontWeight: '700',
      paddingBottom: 6,
    },
    waveRowBody: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-end',
      height: WAVE_ROW_HEIGHT - 6,
      paddingBottom: 2,
    },
    waveBar: {
      width: WAVE_BAR_WIDTH,
      marginHorizontal: WAVE_BAR_GAP / 2,
      borderRadius: 1.5,
      opacity: 0.85,
    },
    noBaro: {
      paddingBottom: 6,
      color: theme.muted,
      fontSize: 11,
    },
    emptyHint: {
      paddingVertical: 36,
      color: theme.muted,
      fontSize: 12,
      textAlign: 'center',
    },
    reducedMotionHint: {
      marginTop: -4,
      color: theme.muted,
      fontSize: 11,
      lineHeight: 16,
    },
    waveReadingRow: {
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 8,
      paddingTop: 8,
    },
    waveReadingItem: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 5,
      paddingHorizontal: 8,
      borderRadius: theme.radiusSm,
      borderCurve: 'continuous',
      backgroundColor: theme.surfaceSoft,
    },
    waveReadingLabel: {
      fontSize: 10,
      fontWeight: '700',
    },
    waveReadingValue: {
      paddingTop: 2,
      color: theme.ink,
      fontSize: 12,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    readingRow: {
      flexDirection: 'row',
      gap: 8,
    },
    readingItem: {
      flex: 1,
      minHeight: 64,
      padding: 10,
      borderRadius: theme.radiusSm,
      borderCurve: 'continuous',
      backgroundColor: theme.surfaceSoft,
    },
    readingLabel: {
      color: theme.muted,
      fontSize: 10,
      fontWeight: '600',
    },
    readingValue: {
      paddingTop: 7,
      color: theme.ink,
      fontSize: 13,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    legendRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      flexWrap: 'wrap',
      gap: 16,
    },
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    legendDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
    },
    legendText: {
      color: theme.muted,
      fontSize: 10,
      fontWeight: '600',
    },
  })
