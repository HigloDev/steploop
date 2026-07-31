import React, { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Svg, {
  Line,
  Path,
  Text as SvgText,
} from 'react-native-svg'

import {
  SensorMotionActivity,
  SensorVisualizationState,
  SensorWavePoint,
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

const CHART_WIDTH = 360
const PLOT_LEFT = 58
const PLOT_RIGHT = 344

function linePath(
  points: SensorWavePoint[],
  top: number,
  height: number,
  value: (point: SensorWavePoint) => number,
  minValue: number,
  maxValue: number,
): string {
  if (!points.length) return ''
  const range = Math.max(0.001, maxValue - minValue)

  return points
    .map((point, index) => {
      const x =
        PLOT_LEFT +
        (index / Math.max(1, points.length - 1)) *
          (PLOT_RIGHT - PLOT_LEFT)
      const normalized = clamp((value(point) - minValue) / range, 0, 1)
      const y = top + height - normalized * height
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
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

  const motionPath = useMemo(
    () => linePath(waves, 25, 42, (point) => point.motion, 0, 1),
    [waves],
  )
  const turnPath = useMemo(
    () => linePath(waves, 94, 42, (point) => point.turn, -1, 1),
    [waves],
  )
  const heightPath = useMemo(
    () =>
      linePath(
        waves,
        163,
        42,
        (point) => point.height,
        heightMin,
        heightMax,
      ),
    [waves, heightMin, heightMax],
  )

  return (
    <View style={stylesFor(theme).chart}>
      <Svg width="100%" height={228} viewBox={`0 0 ${CHART_WIDTH} 228`}>
        {[82, 140].map((y) => (
          <Line
            key={`divider-${y}`}
            x1={12}
            y1={y}
            x2={348}
            y2={y}
            stroke={theme.line}
            strokeWidth={1}
          />
        ))}
        {[58, 105, 153, 201, 249, 296, 344].map((x) => (
          <Line
            key={`grid-${x}`}
            x1={x}
            y1={18}
            x2={x}
            y2={210}
            stroke={theme.line}
            strokeWidth={0.7}
            opacity={0.45}
          />
        ))}
        {[46, 115, 184].map((y) => (
          <Line
            key={`baseline-${y}`}
            x1={PLOT_LEFT}
            y1={y}
            x2={PLOT_RIGHT}
            y2={y}
            stroke={theme.line}
            strokeWidth={1}
            strokeDasharray="4 5"
          />
        ))}

        <SvgText x={12} y={49} fill={theme.muted} fontSize={11} fontWeight="700">
          动作
        </SvgText>
        <SvgText x={12} y={118} fill={theme.muted} fontSize={11} fontWeight="700">
          转向
        </SvgText>
        <SvgText x={12} y={187} fill={theme.muted} fontSize={11} fontWeight="700">
          气压
        </SvgText>

        {motionPath ? (
          <Path
            d={motionPath}
            fill="none"
            stroke={theme.mint}
            strokeWidth={2.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {turnPath ? (
          <Path
            d={turnPath}
            fill="none"
            stroke={theme.orange}
            strokeWidth={2.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {barometerAvailable && heightPath ? (
          <Path
            d={heightPath}
            fill="none"
            stroke={theme.blueInk}
            strokeWidth={2.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}

        {waves.length ? (
          <>
            <SvgText
              x={342}
              y={31}
              fill={theme.mint}
              fontSize={10}
              fontWeight="700"
              textAnchor="end"
            >
              {latest.motion.toFixed(2)}
            </SvgText>
            <SvgText
              x={342}
              y={100}
              fill={theme.orange}
              fontSize={10}
              fontWeight="700"
              textAnchor="end"
            >
              {latest.turn > 0 ? '+' : ''}
              {latest.turn.toFixed(2)}
            </SvgText>
            <SvgText
              x={342}
              y={169}
              fill={theme.blueInk}
              fontSize={10}
              fontWeight="700"
              textAnchor="end"
            >
              {barometerAvailable
                ? `${visualization.relativeHeightM.toFixed(1)}米`
                : '不可用'}
            </SvgText>
          </>
        ) : (
          <SvgText
            x={201}
            y={117}
            fill={theme.muted}
            fontSize={12}
            textAnchor="middle"
          >
            开始爬楼后显示实时波形
          </SvgText>
        )}
      </Svg>
    </View>
  )
}

export function SensorMotionVisualizer({
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
}

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
