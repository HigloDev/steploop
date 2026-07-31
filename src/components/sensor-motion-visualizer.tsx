import React, { memo } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import {
  SensorMotionActivity,
  SensorVisualizationState,
} from '../core/sensor-visualization'
import { clamp } from '../core/math'
import { Theme, useTheme } from '../theme'

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
  barometerAvailable,
  theme,
}: {
  visualization: SensorVisualizationState
  barometerAvailable: boolean
  theme: Theme
}) {
  const waves = visualization.waves
  const heightValues = waves.map((point) => point.height)
  const heightMin = Math.min(0, ...heightValues)
  const heightMax = Math.max(0.5, ...heightValues)
  const latest = waves[waves.length - 1]
  const styles = stylesFor(theme)

  return (
    <View style={styles.chart}>
      {waves.length ? (
        <>
          <WaveRow
            label="动作"
            values={waves.map((point) => point.motion)}
            color={theme.mint}
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
              color={theme.blueInk}
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
            <Text style={styles.waveReadingValue}>
              {latest.motion.toFixed(2)}
            </Text>
            <Text style={styles.waveReadingValue}>
              {latest.turn > 0 ? '+' : ''}
              {latest.turn.toFixed(2)}
            </Text>
            <Text style={styles.waveReadingValue}>
              {barometerAvailable
                ? `${visualization.relativeHeightM.toFixed(1)}米`
                : '不可用'}
            </Text>
          </View>
        </>
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
  const floorText = routeLearning
    ? `${currentFloor}层附近`
    : `${currentFloor}层`

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.title}>传感器实时波形</Text>
          <Text style={styles.subtitle}>
            {journey === 'returning'
              ? '正在监测返回过程'
              : '动作、转向与高度同步采样'}
          </Text>
        </View>
        <View style={styles.activityChip}>
          <View style={styles.activityDot} />
          <Text style={styles.activityText}>
            {ACTIVITY_LABEL[visualization.activity]}
          </Text>
        </View>
      </View>

      <WaveformPanel
        visualization={visualization}
        barometerAvailable={barometerAvailable}
        theme={theme}
      />

      <View style={styles.readingRow}>
        <View style={styles.readingItem}>
          <Text style={styles.readingLabel}>动作判断</Text>
          <Text selectable style={styles.readingValue}>
            {ACTIVITY_LABEL[visualization.activity]}
          </Text>
        </View>
        <View style={styles.readingItem}>
          <Text style={styles.readingLabel}>高度进度</Text>
          <Text selectable style={styles.readingValue}>
            {barometerAvailable ? floorText : '无气压计'}
          </Text>
        </View>
        <View style={styles.readingItem}>
          <Text style={styles.readingLabel}>判断把握</Text>
          <Text selectable style={styles.readingValue}>
            {Math.round(visualization.confidence * 100)}%
          </Text>
        </View>
      </View>

      <View style={styles.legendRow}>
        <LegendDot color={theme.mint} label="动作幅度" />
        <LegendDot color={theme.orange} label="左右转向" />
        <LegendDot color={theme.blueInk} label="相对高度" />
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
      backgroundColor: theme.greenSoft,
    },
    activityDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: theme.green,
    },
    activityText: {
      color: theme.green,
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
    waveReadingRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingTop: 6,
    },
    waveReadingValue: {
      color: theme.ink,
      fontSize: 11,
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
