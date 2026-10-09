// 标定复核页：从 getActiveDraft() 读取，调整起始楼层/层数/边界，保存为路线模板。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Disclosure } from '../components/disclosure'
import { Header } from '../components/Header'
import { BuildingSketch, buildPlaybackFloors } from '../components/BuildingSketch'
import { Button, Card, Field, Metric, Pill } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import { clearActiveDraft, getActiveDraft } from '../services/draft'
import { listRoutes, saveRoute } from '../services/storage'
import { buildFloorSplits, buildRouteDiagram, buildSegments, rebuildDraftBoundaries } from '../core/analysis'
import { createMotionReference } from '../core/route-motion'
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
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState('')
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
        [{ text: '返回', onPress: () => navigation.replace('Main') }],
      )
      return
    }
    draftRef.current = draft
    if (draft.seed.routeId) {
      setRouteLoading(true)
      void listRoutes().then(routes => {
        const previous = routes.find(r => r.id === draft.seed.routeId)
        if (!previous) throw new Error('原路线已不存在，请返回重新标定。')
        setStartFloor(String(previous.startFloor))
      }).catch(() => setRouteError('无法读取原路线，请返回后重试。'))
        .finally(() => setRouteLoading(false))
    }
    const count = draft.boundarySource === 'manual'
      ? Math.max(1, draft.boundaries.length - 1) : draft.inferred.estimatedFloorCount
    const averageHeight = (draft.estimatedAscentM ?? draft.inferred.estimatedAscentM) / Math.max(1, count)
    floorHeightsRef.current = Array.from({ length: count }, () =>
      Number(averageHeight.toFixed(1)),
    )
    setFloorCountInput(String(count))
    setEstimatedSteps(draft.inferred.estimatedStepCount)
    // 爬升米数仅为估计，不代表实测精度。
    const ascent = draft.estimatedAscentM ?? draft.inferred.estimatedAscentM
    setEstimatedAscentM(ascent)
    setEstimatedFloorCount(count)
    setFloorConfidence(Math.round(draft.inferred.confidence.floors * 100))
    // 气压不提供楼层或高度准确率证明。
    const heightConf = draft.inferred.confidence.height * 100
    setHeightConfidence(Math.round(heightConf))
    setLoaded(true)
    // 统计人工标记
    const mTurn = draft.manualMarks.filter((m) => m.type === 'turn').length
    const mFloor = draft.manualMarks.filter((m) => m.type === 'floor').length
    setManualMarkCount({ turn: mTurn, floor: mFloor })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = useCallback(() => {
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
    if (!markers.some((marker) => marker.type === 'turn' || marker.type === 'manual_turn') &&
        !draft.manualMarks.some((mark) => mark.type === 'floor')) {
      warns.push('没有楼层标记或拐弯记录，请看楼层标志补记这条路线。')
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
  }, [startFloor])

  useEffect(() => {
    if (loaded) refresh()
  }, [loaded, refresh])

  const applyFloorCount = () => {
    const draft = draftRef.current
    if (!draft) return
    const count = Math.round(Number(floorCountInput))
    if (!(count >= 1 && count <= 200)) {
      Alert.alert('提示', '层数应在 1–200 之间')
      setFloorCountInput(String(draft.boundaries.length - 1))
      return
    }
    draft.boundaries = rebuildDraftBoundaries(draft, count, Number(startFloor))
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
    if (saving || routeLoading || routeError) return
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
      if (draft.seed.routeId && !previous) throw new Error('原路线已不存在，标定数据尚未保存。')
      const segments = buildSegments(draft, startFloorNum, floorHeightsRef.current)
      const totalAscentM = Number(
        segments.reduce((sum, segment) => sum + segment.ascentM, 0).toFixed(1),
      )
      const firstReference = !previous ||
        (previous.segments.length === 0 && (previous.learning?.sampleCount ?? 0) === 0)
      const route: RouteTemplate = {
        // 重标定只更新参考参数；保留已有可信模型及旧模板的学习来源。
        ...previous,
        ...(firstReference ? { learningProvenance: 'training_rounds' as const } : {}),
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
        device: previous?.device ?? {
          platform: Platform.OS || 'unknown',
          model: 'unknown',
          system: Platform.Version?.toString() || 'unknown',
        },
        segments,
        ...(previous?.featureSpace === 'device' ? { featureSpace: 'heading' as const } : {}),
        motionReference: createMotionReference(draft.seed.carryMode, startFloorNum, startFloorNum + segments.length, draft.manualMarks),
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

  // 大楼剖面图：基于 floorSplits 回放，所有楼层显示为已完成
  const buildingFloors = useMemo(
    () => buildPlaybackFloors(floorSplits),
    [floorSplits],
  )

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
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        style={styles.flex}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: 24 }]}
      >
        <View style={styles.hero}>
          <Text style={styles.title}>
            {draftRef.current?.seed.name ?? '路线标定'}
          </Text>
          <Text style={styles.subtitle}>
            用时 {duration} · 共 {estimatedSteps} 步
          </Text>
        </View>

        <View style={styles.metricGrid}>
          <Metric
            label="参考层数"
            value={estimatedFloorCount}
            hint="请按楼层标志核对"
            style={styles.metric}
          />
          <Metric
            label="估算爬升"
            value={`${estimatedAscentM}米`}
            hint="米数只是估计，请以楼层标志为准"
            style={styles.metric}
          />
        </View>

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

        {routeError ? <Text style={{ color: theme.redInk }}>{routeError}</Text> : null}
        <Button
          title="放弃并返回"
          variant="secondary"
          disabled={saving}
          onPress={() => {
            clearActiveDraft()
            navigation.replace('Main')
          }}
        />
        <Disclosure title="楼层边界与事件标记">
        <Text style={styles.sectionLabel}>楼层边界</Text>
        {boundaries.map((b) => (
          <View key={b.index} style={styles.boundaryCard}>
            <View style={styles.boundaryHead}>
              <Text style={styles.boundaryFloor}>
                {b.floorFrom}层 → {b.floorTo}层
              </Text>
              <Pill tone={b.isFinal ? 'good' : 'default'}>{b.timeText}</Pill>
            </View>
            <View style={styles.boundaryRow}>
              <Pressable
                style={styles.adjustBtn}
                accessibilityRole="button"
                accessibilityLabel={`${b.floorFrom} 到 ${b.floorTo} 层边界提前 0.5 秒`}
                onPress={() => adjustBoundary(b.index, -500)}
              >
                <Text style={styles.adjustBtnText}>-0.5秒</Text>
              </Pressable>
              <Pressable
                style={styles.adjustBtn}
                accessibilityRole="button"
                accessibilityLabel={`${b.floorFrom} 到 ${b.floorTo} 层边界延后 0.5 秒`}
                onPress={() => adjustBoundary(b.index, 500)}
              >
                <Text style={styles.adjustBtnText}>+0.5秒</Text>
              </Pressable>
              <Field
                label="层高（米）"
                value={b.height}
                onChangeText={(v) => updateHeight(b.index - 1, v)}
                keyboardType="decimal-pad"
                style={styles.heightField}
              />
            </View>
          </View>
        ))}

        {markerViews.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>事件标记</Text>
            <View style={styles.markersCard}>
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
            </View>
          </>
        ) : null}

        </Disclosure>
        <Disclosure title="路线图与采集详情">
        {/* 大楼剖面简笔画：把已完成的楼层 + 拐弯合成成一张图 */}
        {buildingFloors.length > 0 ? (
          <View style={styles.buildingCard}>
            <Text style={styles.buildingTitle}>大楼剖面图</Text>
            <Text style={styles.buildingHint}>
              每节楼梯 = 一次拐弯 · ✓ = 已抵达楼层
            </Text>
            <BuildingSketch floors={buildingFloors} style={styles.buildingSketch} />
          </View>
        ) : null}

        {/* 爬楼路线图：基于人工楼层标记分段 */}
        {floorSplits.length > 0 ? (
          <View style={styles.diagramCard}>
            <View style={styles.diagramHead}>
              <Text style={styles.diagramTitle}>爬楼路线图</Text>
              <View style={styles.diagramMetaRow}>
                {draftRef.current?.boundarySource === 'manual' ? (
                  <Pill tone="good">人工楼层 ×{manualMarkCount.floor}</Pill>
                ) : draftRef.current?.boundarySource === 'barometer' ? (
                  <Pill tone="good">未人工核对的分层估计</Pill>
                ) : (
                  <Pill tone="warn">算法估算分层</Pill>
                )}
                <Pill tone="warn">
                  人工拐弯 ×{manualMarkCount.turn}
                </Pill>
                {draftRef.current?.ascentSource === 'barometer' ? (
                  <Pill tone="good">气压粗估</Pill>
                ) : null}
              </View>
            </View>

            {/* 路线图文本流 */}
            {routeDiagram ? (
              <View style={styles.diagramBox}>
                {floorSplits.map((s, i) => (
                  <View key={i} style={styles.diagramLine}>
                    <Text style={styles.diagramFloor}>{s.floor}层</Text>
                    <Text style={styles.diagramArrow}>──</Text>
                    <Text style={styles.diagramMeta}>
                      [{s.stepCount}步·{(s.durationMs / 1000).toFixed(0)}秒
                      {s.turnCount > 0 ? `·拐弯×${s.turnCount}` : ''}]
                    </Text>
                    <Text style={styles.diagramArrow}>──&gt;</Text>
                    <Text style={styles.diagramFloor}>{s.floor + 1}层</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* 每层详情列表 */}
            <View style={styles.splitList}>
              {floorSplits.map((s, i) => (
                <View key={i} style={styles.splitRow}>
                  <Text style={styles.splitFloor}>{s.floor}层→{s.floor + 1}层</Text>
                  <Text style={styles.splitSteps}>{s.stepCount} 步</Text>
                  <Text style={styles.splitTime}>{formatDuration(s.durationMs)}</Text>
                  <Text style={styles.splitTurns}>
                    {s.turnCount > 0 ? `${s.turnCount} 拐` : '—'}
                  </Text>
                  <Text style={styles.splitAscent}>{s.ascentM}米</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        </Disclosure>

      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Button title="保存为路线模板" onPress={handleSave} loading={saving || routeLoading} disabled={!!routeError} />
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
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: { color: theme.mutedStrong, fontSize: theme.fontBase, lineHeight: 22 },
    hero: { gap: 8 },
    eyebrow: {
      color: theme.brand,
      fontSize: theme.fontEyebrow,
      fontWeight: '700',
    },
    title: {
      color: theme.ink,
      fontSize: theme.fontTitle,
      fontWeight: '700',
      lineHeight: 34,
    },
    subtitle: {
      color: theme.mutedStrong,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
    },
    metricGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    metric: { flexGrow: 1, flexBasis: '45%', minWidth: 0 },
    warningBox: {
      backgroundColor: theme.amberSoft,
      borderRadius: theme.radiusMd,
      padding: 16,
      gap: 8,
    },
    warningText: {
      color: theme.amberInk,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
    },
    formCard: { padding: 16, gap: 12 },
    sectionLabel: {
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
      marginTop: 16,
      marginBottom: 12,
    },
    boundaryCard: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
    boundaryHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 12,
    },
    boundaryFloor: {
      color: theme.ink,
      fontSize: theme.fontBase,
      lineHeight: 22,
      fontWeight: '600',
    },
    boundaryRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'flex-end',
      gap: 8,
    },
    adjustBtn: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      minHeight: theme.tapMin,
      borderRadius: theme.radiusSm,
      backgroundColor: theme.surfaceSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    adjustBtnText: {
      color: theme.brand,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '600',
    },
    heightField: { flexBasis: '100%', minWidth: 0 },
    markersCard: { paddingVertical: 8 },
    markerRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    markerType: {
      color: theme.ink,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '600',
      minWidth: 72,
    },
    markerTime: {
      color: theme.mutedStrong,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontVariant: ['tabular-nums'],
    },
    markerDir: {
      color: theme.brandInk,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
    },
    markerConf: {
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
      marginLeft: 'auto',
    },
    buildingCard: { paddingVertical: 16 },
    buildingTitle: {
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
    },
    buildingHint: {
      marginTop: 4,
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
      marginBottom: 16,
    },
    buildingSketch: {
      alignItems: 'center',
    },
    diagramCard: { paddingVertical: 16 },
    diagramHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
      flexWrap: 'wrap',
      gap: 8,
    },
    diagramTitle: {
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
    },
    diagramMetaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    diagramBox: {
      backgroundColor: theme.surfaceSoft,
      borderRadius: theme.radiusMd,
      padding: 16,
      marginBottom: 16,
    },
    diagramLine: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      paddingVertical: 8,
    },
    diagramFloor: {
      color: theme.brandInk,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '600',
    },
    diagramArrow: {
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
    },
    diagramMeta: {
      color: theme.ink,
      fontSize: theme.fontSmall,
      lineHeight: 18,
      fontWeight: '600',
    },
    splitList: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line,
      paddingTop: 6,
    },
    splitRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
      gap: 8,
    },
    splitFloor: {
      color: theme.ink,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '600',
      flexBasis: '100%',
    },
    splitSteps: {
      color: theme.ink,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      flexGrow: 1,
      minWidth: 64,
    },
    splitTime: {
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
      minWidth: 56,
      fontVariant: ['tabular-nums'],
    },
    splitTurns: {
      color: theme.amberInk,
      fontSize: theme.fontSmall,
      lineHeight: 18,
      minWidth: 44,
    },
    splitAscent: {
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
      minWidth: 44,
      textAlign: 'right',
    },
    footer: { backgroundColor: theme.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, paddingHorizontal: theme.pagePaddingH, paddingTop: 8 },
  })
