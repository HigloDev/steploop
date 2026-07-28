// 标定复核页：从 getActiveDraft() 读取，调整起始楼层/层数/边界，保存为路线模板。

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Header } from '../components/Header'
import { Button, Card, Field, Metric, Pill } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import { clearActiveDraft, getActiveDraft } from '../services/draft'
import { listRoutes, saveRoute } from '../services/storage'
import { buildFloorSplits, buildRouteDiagram, buildSegments, rebuildDraftBoundaries } from '../core/analysis'
import { clamp, formatDuration, uid } from '../core/math'
import { CalibrationDraft, FloorSplit, RouteMarker, RouteTemplate } from '../core/types'
import { Platform } from 'react-native'

interface BoundaryView {
  index: number
  floorFrom: number
  floorTo: number
  atMs: number
  timeText: string
  height: string
  isFinal: boolean
}

const TYPE_TEXT: Record<RouteMarker['type'], string> = {
  turn: '转角',
  landing: '平台',
  pause: '停顿',
  manual_turn: '人工拐弯',
  manual_floor: '人工楼层',
}

export default function ReviewScreen({ navigation }: RootStackScreen<'Review'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const draftRef = useRef<CalibrationDraft | undefined>(undefined)
  const floorHeightsRef = useRef<number[]>([])
  const [loaded, setLoaded] = useState(false)
  const [startFloor, setStartFloor] = useState('1')
  const [floorCountInput, setFloorCountInput] = useState('1')
  const [estimatedSteps, setEstimatedSteps] = useState(0)
  const [estimatedAscentM, setEstimatedAscentM] = useState(0)
  const [estimatedFloorCount, setEstimatedFloorCount] = useState(1)
  const [floorConfidence, setFloorConfidence] = useState(0)
  const [heightConfidence, setHeightConfidence] = useState(0)
  const [boundaries, setBoundaries] = useState<BoundaryView[]>([])
  const [duration, setDuration] = useState('00:00')
  const [warnings, setWarnings] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  // 爬楼路线图相关
  const [floorSplits, setFloorSplits] = useState<FloorSplit[]>([])
  const [routeDiagram, setRouteDiagram] = useState('')
  const [manualMarkCount, setManualMarkCount] = useState({ turn: 0, floor: 0 })

  useEffect(() => {
    const draft = getActiveDraft()
    if (!draft) {
      Alert.alert(
        '标定数据已失效',
        '原始数据只在本次标定流程中临时保留，请重新标定。',
        [{ text: '返回', onPress: () => navigation.replace('RouteEdit') }],
      )
      return
    }
    draftRef.current = draft
    const count = draft.inferred.estimatedFloorCount
    const averageHeight = draft.inferred.estimatedAscentM / Math.max(1, count)
    floorHeightsRef.current = Array.from({ length: count }, () =>
      Number(averageHeight.toFixed(1)),
    )
    setFloorCountInput(String(count))
    setEstimatedSteps(draft.inferred.estimatedStepCount)
    setEstimatedAscentM(draft.inferred.estimatedAscentM)
    setEstimatedFloorCount(count)
    setFloorConfidence(Math.round(draft.inferred.confidence.floors * 100))
    setHeightConfidence(Math.round(draft.inferred.confidence.height * 100))
    setLoaded(true)
    // 统计人工标记
    const mTurn = draft.manualMarks.filter((m) => m.type === 'turn').length
    const mFloor = draft.manualMarks.filter((m) => m.type === 'floor').length
    setManualMarkCount({ turn: mTurn, floor: mFloor })
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = () => {
    const draft = draftRef.current
    if (!draft) return
    const startFloorNum = Number(startFloor)
    const validStart = Number.isFinite(startFloorNum) ? startFloorNum : 1
    const nextBoundaries = draft.boundaries.slice(1).map((atMs, index) => ({
      index: index + 1,
      floorFrom: validStart + index,
      floorTo: validStart + index + 1,
      atMs,
      timeText: formatDuration(atMs),
      height: String(floorHeightsRef.current[index] ?? 0),
      isFinal: index === draft.boundaries.length - 2,
    }))
    setBoundaries(nextBoundaries)

    // 生成爬楼路线图（基于人工楼层标记分段）
    const splits = buildFloorSplits(draft, validStart)
    setFloorSplits(splits)
    setRouteDiagram(buildRouteDiagram(splits))

    const typeMap = TYPE_TEXT
    const markers = draft.markers
    const warns: string[] = []
    if (!markers.some((marker) => marker.type === 'turn' || marker.type === 'manual_turn')) {
      warns.push('没有识别到任何拐弯（自动或人工），建议重新标定或人工补标记。')
    }
    if (draft.gaps.length) {
      warns.push(`记录中有 ${draft.gaps.length} 段传感器中断，建议重新标定。`)
    }
    if (!draft.manualMarks.some((m) => m.type === 'floor')) {
      warns.push('未人工标记任何楼层，路线图按估算楼层分段，精度有限。')
    }
    setWarnings(warns)
    const finalTime = draft.frames.at(-1)?.endMs ?? 0
    setDuration(formatDuration(finalTime))
  }

  const applyFloorCount = () => {
    const draft = draftRef.current
    if (!draft) return
    const count = Math.round(Number(floorCountInput))
    if (!(count >= 1 && count <= 200)) {
      Alert.alert('提示', '层数应在 1–200 之间')
      setFloorCountInput(String(draft.boundaries.length - 1))
      return
    }
    draft.boundaries = rebuildDraftBoundaries(draft, count)
    const averageHeight = draft.inferred.estimatedAscentM / count
    floorHeightsRef.current = Array.from(
      { length: count },
      (_, index) =>
        floorHeightsRef.current[index] ?? Number(averageHeight.toFixed(1)),
    )
    refresh()
  }

  const adjustBoundary = (index: number, delta: number) => {
    const draft = draftRef.current
    if (!draft) return
    const previous = draft.boundaries[index - 1] + 1000
    const next = draft.boundaries[index + 1] - 1000
    draft.boundaries[index] = Math.round(
      clamp(draft.boundaries[index] + delta, previous, next),
    )
    refresh()
  }

  const updateHeight = (index: number, value: string) => {
    const num = Number(value)
    if (num > 0) floorHeightsRef.current[index] = num
    setBoundaries((prev) =>
      prev.map((b) => (b.index === index + 1 ? { ...b, height: value } : b)),
    )
  }

  const handleSave = async () => {
    const draft = draftRef.current
    if (!draft) return
    if (saving) return
    const startFloorNum = Number(startFloor)
    if (!Number.isFinite(startFloorNum)) {
      Alert.alert('提示', '请确认起始楼层')
      return
    }
    if (floorHeightsRef.current.some((h) => !(h > 0 && h < 20))) {
      Alert.alert('提示', '请确认每层高度')
      return
    }
    setSaving(true)
    try {
      const now = Date.now()
      const allRoutes = await listRoutes()
      const previous = draft.seed.routeId
        ? allRoutes.find((route) => route.id === draft.seed.routeId)
        : undefined
      const segments = buildSegments(draft, startFloorNum, floorHeightsRef.current)
      const totalAscentM = Number(
        segments.reduce((sum, segment) => sum + segment.ascentM, 0).toFixed(1),
      )
      const route: RouteTemplate = {
        id: previous?.id ?? uid('route'),
        name: draft.seed.name,
        startFloor: startFloorNum,
        endFloor: startFloorNum + segments.length,
        carryMode: draft.seed.carryMode,
        floorHeightM: Number(
          (totalAscentM / Math.max(1, segments.length)).toFixed(1),
        ),
        totalAscentM,
        location: draft.seed.location,
        device: {
          platform: Platform.OS || 'unknown',
          model: 'unknown',
          system: Platform.Version?.toString() || 'unknown',
        },
        segments,
        markers: draft.markers,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        version: (previous?.version ?? 0) + 1,
        status: 'needs_validation',
      }
      await saveRoute(route)
      clearActiveDraft()
      navigation.replace('Validate', { id: route.id })
    } catch (err) {
      Alert.alert(
        '保存失败',
        err instanceof Error ? err.message : '本地存储空间不足，路线未能保存。',
      )
    } finally {
      setSaving(false)
    }
  }

  const markerViews = useMemo(() => {
    const draft = draftRef.current
    if (!draft) return []
    return draft.markers.map((marker) => ({
      id: marker.id,
      type: marker.type,
      typeText: TYPE_TEXT[marker.type],
      timeText: formatDuration(marker.atMs),
      directionText:
        marker.direction === 'left'
          ? '左转'
          : marker.direction === 'right'
            ? '右转'
            : '',
      confidenceText: `${Math.round(marker.confidence * 100)}%`,
    }))
  }, [loaded])

  if (!loaded) {
    return (
      <View style={styles.page}>
        <Header title="标定复核" back />
        <View style={styles.loading}>
          <Text style={styles.loadingText}>加载中…</Text>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.page}>
      <Header title="标定复核" back />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>CALIBRATION</Text>
          <Text style={styles.title}>
            {draftRef.current?.seed.name ?? '路线标定'}
          </Text>
          <Text style={styles.subtitle}>
            用时 {duration} · 共 {estimatedSteps} 步
          </Text>
        </View>

        <View style={styles.metricGrid}>
          <Metric
            label="估算楼层"
            value={estimatedFloorCount}
            hint={`置信度 ${floorConfidence}%`}
            style={styles.metric}
          />
          <Metric
            label="估算爬升"
            value={`${estimatedAscentM} m`}
            hint={`置信度 ${heightConfidence}%`}
            style={styles.metric}
          />
        </View>

        {/* 爬楼路线图：基于人工楼层标记分段 */}
        {floorSplits.length > 0 ? (
          <Card raised style={styles.diagramCard}>
            <View style={styles.diagramHead}>
              <Text style={styles.diagramTitle}>爬楼路线图</Text>
              <View style={styles.diagramMetaRow}>
                <Pill tone="good">
                  人工楼层 ×{manualMarkCount.floor}
                </Pill>
                <Pill tone="warn">
                  人工拐弯 ×{manualMarkCount.turn}
                </Pill>
              </View>
            </View>

            {/* 路线图文本流 */}
            {routeDiagram ? (
              <View style={styles.diagramBox}>
                {floorSplits.map((s, i) => (
                  <View key={i} style={styles.diagramLine}>
                    <Text style={styles.diagramFloor}>{s.floor}F</Text>
                    <Text style={styles.diagramArrow}>──</Text>
                    <Text style={styles.diagramMeta}>
                      [{s.stepCount}步·{(s.durationMs / 1000).toFixed(0)}秒
                      {s.turnCount > 0 ? `·拐弯×${s.turnCount}` : ''}]
                    </Text>
                    <Text style={styles.diagramArrow}>──&gt;</Text>
                    <Text style={styles.diagramFloor}>{s.floor + 1}F</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* 每层详情列表 */}
            <View style={styles.splitList}>
              {floorSplits.map((s, i) => (
                <View key={i} style={styles.splitRow}>
                  <Text style={styles.splitFloor}>{s.floor}F→{s.floor + 1}F</Text>
                  <Text style={styles.splitSteps}>{s.stepCount} 步</Text>
                  <Text style={styles.splitTime}>{formatDuration(s.durationMs)}</Text>
                  <Text style={styles.splitTurns}>
                    {s.turnCount > 0 ? `${s.turnCount} 拐` : '—'}
                  </Text>
                  <Text style={styles.splitAscent}>{s.ascentM} m</Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        {warnings.length > 0 ? (
          <View style={styles.warningBox}>
            {warnings.map((w, i) => (
              <Text key={i} style={styles.warningText}>
                · {w}
              </Text>
            ))}
          </View>
        ) : null}

        <Card raised style={styles.formCard}>
          <Field
            label="起始楼层"
            value={startFloor}
            onChangeText={setStartFloor}
            placeholder="例如 1"
            keyboardType="number-pad"
          />
          <Field
            label="层数"
            value={floorCountInput}
            onChangeText={setFloorCountInput}
            placeholder="例如 6"
            keyboardType="number-pad"
          />
          <Button title="应用层数" variant="secondary" onPress={applyFloorCount} />
        </Card>

        <Text style={styles.sectionLabel}>楼层边界</Text>
        {boundaries.map((b) => (
          <Card key={b.index} raised style={styles.boundaryCard}>
            <View style={styles.boundaryHead}>
              <Text style={styles.boundaryFloor}>
                {b.floorFrom}F → {b.floorTo}F
              </Text>
              <Pill tone={b.isFinal ? 'good' : 'default'}>{b.timeText}</Pill>
            </View>
            <View style={styles.boundaryRow}>
              <Pressable
                style={styles.adjustBtn}
                onPress={() => adjustBoundary(b.index, -500)}
              >
                <Text style={styles.adjustBtnText}>-0.5s</Text>
              </Pressable>
              <Pressable
                style={styles.adjustBtn}
                onPress={() => adjustBoundary(b.index, 500)}
              >
                <Text style={styles.adjustBtnText}>+0.5s</Text>
              </Pressable>
              <Field
                label="层高(m)"
                value={b.height}
                onChangeText={(v) => updateHeight(b.index - 1, v)}
                keyboardType="decimal-pad"
                style={styles.heightField}
              />
            </View>
          </Card>
        ))}

        {markerViews.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>事件标记</Text>
            <Card raised style={styles.markersCard}>
              {markerViews.map((m, i) => (
                <View key={m.id} style={styles.markerRow}>
                  <Text style={styles.markerType}>{m.typeText}</Text>
                  <Text style={styles.markerTime}>{m.timeText}</Text>
                  {m.directionText ? (
                    <Text style={styles.markerDir}>{m.directionText}</Text>
                  ) : null}
                  <Text style={styles.markerConf}>{m.confidenceText}</Text>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        <Button title="保存为路线模板" onPress={handleSave} loading={saving} />
        <Button
          title="放弃并返回"
          variant="secondary"
          onPress={() => {
            clearActiveDraft()
            navigation.replace('RouteEdit')
          }}
        />
      </ScrollView>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: theme.pagePaddingH },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: { color: theme.muted, fontSize: 14 },
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
    metricGrid: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 8,
    },
    metric: { flex: 1 },
    warningBox: {
      backgroundColor: theme.amberSoft,
      borderLeftWidth: 3,
      borderLeftColor: theme.amber,
      borderRadius: 4,
      padding: 11,
      marginVertical: 10,
    },
    warningText: {
      color: theme.amberInk,
      fontSize: 12,
      lineHeight: 18,
    },
    formCard: { padding: 14, marginTop: 8 },
    sectionLabel: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
      marginTop: 16,
      marginBottom: 8,
      paddingHorizontal: 4,
    },
    boundaryCard: { padding: 14, marginBottom: 8 },
    boundaryHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    boundaryFloor: {
      color: theme.ink,
      fontSize: 15,
      fontWeight: '700',
    },
    boundaryRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
    },
    adjustBtn: {
      paddingHorizontal: 12,
      height: 43,
      borderRadius: theme.radiusSm,
      backgroundColor: theme.surfaceSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    adjustBtnText: {
      color: theme.green,
      fontSize: 13,
      fontWeight: '600',
    },
    heightField: { flex: 1 },
    markersCard: { padding: 14 },
    markerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    markerType: {
      color: theme.ink,
      fontSize: 13,
      fontWeight: '700',
      width: 48,
    },
    markerTime: {
      color: theme.muted,
      fontSize: 13,
    },
    markerDir: {
      color: theme.greenInk,
      fontSize: 13,
    },
    markerConf: {
      color: theme.muted,
      fontSize: 12,
      marginLeft: 'auto',
    },
    diagramCard: { padding: 14, marginTop: 8 },
    diagramHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
      flexWrap: 'wrap',
      gap: 8,
    },
    diagramTitle: {
      color: theme.ink,
      fontSize: 15,
      fontWeight: '700',
    },
    diagramMetaRow: {
      flexDirection: 'row',
      gap: 6,
    },
    diagramBox: {
      backgroundColor: theme.surfaceSoft,
      borderRadius: 8,
      padding: 10,
      marginBottom: 10,
    },
    diagramLine: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      paddingVertical: 3,
    },
    diagramFloor: {
      color: theme.greenInk,
      fontSize: 13,
      fontWeight: '800',
    },
    diagramArrow: {
      color: theme.muted,
      fontSize: 12,
    },
    diagramMeta: {
      color: theme.ink,
      fontSize: 12,
      fontWeight: '600',
    },
    splitList: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line,
      paddingTop: 6,
    },
    splitRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
      gap: 8,
    },
    splitFloor: {
      color: theme.ink,
      fontSize: 13,
      fontWeight: '700',
      width: 72,
    },
    splitSteps: {
      color: theme.ink,
      fontSize: 13,
      flex: 1,
    },
    splitTime: {
      color: theme.muted,
      fontSize: 12,
      width: 56,
    },
    splitTurns: {
      color: theme.amberInk,
      fontSize: 12,
      width: 44,
    },
    splitAscent: {
      color: theme.muted,
      fontSize: 12,
      width: 44,
      textAlign: 'right',
    },
  })
