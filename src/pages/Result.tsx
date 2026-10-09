// 成绩页：从 getSession(id) 加载，展示楼层/爬升/用时/步数等，含"再爬一次"和"返回首页"。
// D06：新增「修正本轮最终楼层」入口 —— 原值保留、追加修正记录、重复提交同一值不产生新记录。

import React, { useCallback, useEffect, useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Disclosure } from '../components/disclosure'
import { Header } from '../components/Header'
import { Button, Field, Metric, Pill } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import { deleteSession, getRoute, getSession } from '../services/storage'
import { getWorkout, saveWorkout } from '../services/workout-storage'
import { formatDuration } from '../core/math'
import { splitDurations, normalizeSession } from '../core/session'
import {
  applyRoundCorrection,
  summarizeCorrectionChain,
  CorrectionChainSummary,
} from '../core/corrections'
import { buildWorkoutFromSession } from '../core/workout-summary'
import { ClimbSession, ClimbWorkout, RouteTemplate } from '../core/types'
import { getFloorAchievementCount } from '../core/floors'

function dateText(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 把多轮训练记录的最后一轮映射回单轮视图，供本页复用既有渲染。
 * 修正后重新进入本页时（旧单轮会话已升级为训练记录）仍能看到修正后的成绩。
 */
function sessionViewFromWorkout(workout: ClimbWorkout): ClimbSession {
  const round = workout.rounds[workout.rounds.length - 1]
  return {
    id: workout.id,
    templateId: workout.templateId,
    templateVersion: workout.templateVersion,
    startedAt: round.startedAt,
    endedAt: round.endedAt,
    startFloor: round.startFloor,
    finalFloor: round.finalFloor,
    floorsCompleted: round.floorsCompleted,
    ascentM: round.ascentM,
    steps: round.steps,
    confidence: round.confidence,
    complete: round.complete,
    events: round.events,
    floorSplits: round.floorSplits.map((split) => ({
      floor: split.floorTo,
      atMs: split.reachedAtMs,
      elapsedMs: split.splitDurationMs,
    })),
    interruptions: round.interruptions,
    durationMs: round.durationMs,
    averageFloorMs: round.averageFloorMs,
    bestFloorSplitMs: round.bestFloorSplitMs,
    routeSnapshot: {
      name: workout.routeSnapshot.name,
      locationName: workout.routeSnapshot.locationName,
      startFloor: workout.routeSnapshot.startFloor,
      endFloor: workout.routeSnapshot.endFloor,
      totalAscentM: workout.routeSnapshot.ascentPerRoundM,
    },
  }
}

/** 由单轮会话构造「修正目标」训练记录（与 buildWorkoutFromSession 同一 id，便于回读）。 */
function correctionTargetFor(
  storedWorkout: ClimbWorkout | undefined,
  session: ClimbSession,
): ClimbWorkout {
  return storedWorkout ?? buildWorkoutFromSession(session)
}

export default function ResultScreen({ navigation, route }: RootStackScreen<'Result'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const id = route.params.id
  const [session, setSession] = useState<ClimbSession | null>(null)
  const [correctionTarget, setCorrectionTarget] = useState<ClimbWorkout | null>(null)
  const [promoteOnSave, setPromoteOnSave] = useState(false)
  const [routeName, setRouteName] = useState('')
  const [statusTitle, setStatusTitle] = useState('')
  const [statusText, setStatusText] = useState('')
  const [floorSplits, setFloorSplits] = useState<
    Array<{ floor: number; time: string; split: string; fastest: boolean }>
  >([])
  const [loadError, setLoadError] = useState('')
  const [chain, setChain] = useState<CorrectionChainSummary | null>(null)
  const [manualCount, setManualCount] = useState(0)
  const [floorInput, setFloorInput] = useState('')
  const [saving, setSaving] = useState(false)

  const applyView = useCallback(
    (
      view: ClimbSession,
      options: {
        route?: RouteTemplate
        routeName: string
        target: ClimbWorkout
        promote: boolean
      },
    ) => {
      const normalized = normalizeSession(view, options.route)
      setSession(normalized)
      setCorrectionTarget(options.target)
      setPromoteOnSave(options.promote)
      setRouteName(options.routeName)
      const durations = splitDurations(normalized)
      const best = durations.length ? Math.min(...durations) : 0
      let title = '本次记录'
      let text = `路线匹配到${normalized.finalFloor}层，未到达模板终点。`
      if (normalized.complete) {
        title = '完整完成'
        text = '路线全程匹配，且没有检测到传感器中断。'
      } else if (normalized.interruptions.length) {
        text = '本次出现锁屏、切出应用或传感器断流，因此不是完整成绩。'
      } else if (normalized.confidence < 0.72) {
        text = '路线未完整匹配，系统保持最后确认楼层，没有补猜。'
      }
      setStatusTitle(title)
      setStatusText(text)
      setFloorSplits(
        normalized.floorSplits.map((split, index) => ({
          floor: split.floor,
          time: formatDuration(split.elapsedMs),
          split: formatDuration(durations[index] ?? 0),
          fastest: best > 0 && durations[index] === best,
        })),
      )
      const lastRound =
        options.target.rounds[options.target.rounds.length - 1]
      setChain(lastRound ? summarizeCorrectionChain(lastRound) : null)
      setManualCount(lastRound?.userCorrectionCount ?? 0)
      setFloorInput(String(normalized.finalFloor))
    },
    [],
  )

  useEffect(() => {
    let mounted = true
    const load = async () => {
      // D06：同一 id 可能已经升级为多轮训练记录（修正过），训练记录优先。
      const storedWorkout = await getWorkout(id).catch(() => undefined)
      if (storedWorkout && storedWorkout.rounds.length) {
        const storedRoute = await getRoute(storedWorkout.templateId).catch(
          () => undefined,
        )
        if (!mounted) return
        applyView(sessionViewFromWorkout(storedWorkout), {
          route: storedRoute,
          routeName:
            storedWorkout.routeSnapshot.locationName ||
            storedWorkout.routeSnapshot.name ||
            storedRoute?.name ||
            '已删除的路线',
          target: storedWorkout,
          promote: false,
        })
        return
      }

      const stored = await getSession(id)
      if (!mounted) return
      if (!stored) {
        setLoadError('记录不存在')
        Alert.alert('记录不存在', '该成绩可能已被删除。', [
          { text: '返回', onPress: () => navigation.navigate('Main', { screen: 'Train' }) },
        ])
        return
      }
      const storedRoute: RouteTemplate | undefined = await getRoute(
        stored.templateId,
      ).catch(() => undefined)
      if (!mounted) return
      const normalized = normalizeSession(stored, storedRoute)
      applyView(normalized, {
        route: storedRoute,
        routeName:
          normalized.routeSnapshot?.locationName ??
          storedRoute?.name ??
          '已删除的路线',
        target: correctionTargetFor(undefined, normalized),
        promote: true,
      })
    }
    load().catch((err) => {
      console.warn('[steploop] load session failed', err)
      if (mounted) setLoadError('加载失败')
    })
    return () => {
      mounted = false
    }
  }, [id, navigation, applyView])

  const submitCorrection = useCallback(async () => {
    if (!session || !correctionTarget || !correctionTarget.rounds.length || saving) return
    const parsed = Number.parseInt(floorInput.replace(/[^\d]/g, ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert('楼层无效', '请输入有效的楼层数字。')
      return
    }
    const lastIndex = correctionTarget.rounds.length - 1
    const lastRound = correctionTarget.rounds[lastIndex]
    const correctedRound = applyRoundCorrection(
      lastRound,
      { finalFloor: parsed },
      { reason: '结果页人工修正最终楼层' },
    )
    // 幂等：重复提交同一楼层不追加记录，也不改写成绩来源/可信状态。
    if (correctedRound === lastRound) {
      Alert.alert(
        '无需修正',
        `本轮最终楼层已经是 ${parsed} 层，没有新增修正记录。`,
      )
      return
    }
    const rounds = correctionTarget.rounds.map((round, index) =>
      index === lastIndex ? correctedRound : round,
    )
    // 训练级缓存总量按轮次重算，保证导出/备份/周累计与轮次详情同一口径。
    const nextWorkout: ClimbWorkout = {
      ...correctionTarget,
      rounds,
      totalFloorsCompleted: rounds.reduce(
        (sum, round) => sum + round.floorsCompleted,
        0,
      ),
      totalAscentM: Number(
        rounds.reduce((sum, round) => sum + round.ascentM, 0).toFixed(1),
      ),
      totalSteps: rounds.reduce((sum, round) => sum + round.steps, 0),
      activeDurationMs: rounds.reduce((sum, round) => sum + round.durationMs, 0),
      userCorrectionCount: rounds.reduce(
        (sum, round) => sum + (round.corrections?.length ?? 0),
        0,
      ),
      trustQuality: 'degraded',
      personalBestEligible: false,
      completionSource: 'manual',
      updatedAt: Date.now(),
    }

    setSaving(true)
    try {
      await saveWorkout(nextWorkout)
      if (promoteOnSave) {
        // 旧单轮会话升级为多轮记录后删除，避免历史页出现同一条成绩的两张卡片。
        try {
          await deleteSession(id)
        } catch (error) {
          console.warn('[steploop] drop legacy session after correction failed', error)
        }
      }
      const correctedChain = summarizeCorrectionChain(correctedRound)
      applyView(sessionViewFromWorkout(nextWorkout), {
        routeName:
          nextWorkout.routeSnapshot.locationName ||
          nextWorkout.routeSnapshot.name ||
          routeName,
        target: nextWorkout,
        promote: false,
      })
      Alert.alert(
        '修正已保存',
        `原值已保留在修正链中：${correctedChain.originalFinalFloor} 层 → ${correctedChain.latestFinalFloor} 层。该轮不再参与算法学习。`,
      )
    } catch (error) {
      console.warn('[steploop] save round correction failed', error)
      Alert.alert('保存失败', '修正没有保存，原记录保持不变。')
    } finally {
      setSaving(false)
    }
  }, [
    applyView,
    correctionTarget,
    floorInput,
    id,
    promoteOnSave,
    routeName,
    saving,
    session,
  ])

  if (!session && !loadError) {
    return (
      <View style={styles.page}>
        <Header title="成绩" back />
        <View style={styles.loading}>
          <Text style={styles.loadingText}>加载中…</Text>
        </View>
      </View>
    )
  }

  if (!session) {
    return (
      <View style={styles.page}>
        <Header title="成绩" back />
        <View style={styles.loading}>
          <Text style={styles.loadingText}>{loadError || '记录不存在'}</Text>
          <Button title="返回首页" onPress={() => navigation.navigate('Main', { screen: 'Train' })} />
        </View>
      </View>
    )
  }

  const correctionCount = chain?.count ?? 0

  return (
    <View style={styles.page}>
      <Header title="成绩" back />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        style={styles.flex}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: 24 }]}
      >
        <View style={styles.hero}>
          <Text style={styles.routeName}>{routeName}</Text>
          <Text style={styles.dateText}>{dateText(session.endedAt)}</Text>
          <View style={styles.statusRow}>
            <Pill tone={session.complete ? 'good' : 'warn'}>
              {statusTitle}
            </Pill>
          </View>
          <Text style={styles.statusText}>{statusText}</Text>
        </View>

        <View style={styles.achievement}>
          <Text style={styles.achievementLabel}>本次完成</Text>
          <View style={styles.achievementLine}>
            <Text selectable style={styles.achievementValue}>{session.floorsCompleted}</Text>
            <Text style={styles.achievementUnit}>层</Text>
          </View>
          <Text selectable style={styles.achievementDuration}>用时 {formatDuration(session.durationMs ?? 0)}</Text>
        </View>
        <Disclosure title="详细成绩">
        <View style={styles.metricGrid}>
          <Metric
            label="完成楼层"
            value={`${
              session.floorsCompleted
            } 层`}
            style={styles.metric}
          />
          <Metric
            label="累计爬升"
            value={`${session.ascentM}米`}
            style={styles.metric}
          />
          <Metric label="总用时" value={formatDuration(session.durationMs ?? 0)} style={styles.metric} />
          <Metric label="总步数" value={session.steps} style={styles.metric} />
          <Metric
            label="平均单层"
            value={session.floorsCompleted > 0 && (session.averageFloorMs ?? 0) > 0 ? formatDuration(session.averageFloorMs!) : '—'}
            style={styles.metric}
          />
          <Metric
            label="最快单层"
            value={session.floorsCompleted > 0 && (session.bestFloorSplitMs ?? 0) > 0 ? formatDuration(session.bestFloorSplitMs!) : '—'}
            style={styles.metric}
          />
        </View>

        <View style={styles.detailCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>起止楼层</Text>
            <Text style={styles.detailValue}>
              {session.startFloor}层 → {session.finalFloor}层
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>置信度</Text>
            <Text style={styles.detailValue}>{Math.round(session.confidence * 100)}%</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>中断次数</Text>
            <Text style={styles.detailValue}>{session.interruptions.length}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>人工修正</Text>
            <Text style={styles.detailValue}>
              {correctionCount > 0
                ? `${correctionCount} 次`
                : manualCount > 0
                  ? '已人工确认'
                  : '无'}
            </Text>
          </View>
        </View>

        </Disclosure>
        <Disclosure title="修正最终楼层" summary={correctionCount || manualCount ? '已人工修正' : undefined}>
        <View style={styles.correctionCard}>
          <Text style={styles.correctionTitle}>修正本轮最终楼层</Text>
          <Text style={styles.correctionHint}>
            修正只追加记录：原值会保留，成绩来源标记为人工，且该轮不再进入算法学习、
            不会提高置信度。
          </Text>
          <Field
            label="实际到达楼层"
            value={floorInput}
            onChangeText={setFloorInput}
            keyboardType="number-pad"
            placeholder="例如 13"
          />
          <Button
            title="保存修正"
            onPress={submitCorrection}
            loading={saving}
            disabled={saving}
          />
          {chain?.corrected ? (
            <Text style={styles.chainText}>
              原值 {chain.originalFinalFloor} 层 → 修正值 {chain.latestFinalFloor} 层 ·
              已修正 {chain.count} 次
            </Text>
          ) : manualCount > 0 ? (
            <Text style={styles.chainText}>
              该轮为人工确认成绩 · 修正次数 {manualCount}
            </Text>
          ) : (
            <Text style={styles.chainText}>当前没有人工修正记录。</Text>
          )}
        </View>

        </Disclosure>
        <Disclosure title="单层用时">
        {floorSplits.length > 0 ? (
          <View style={styles.splitCard}>
            <Text style={styles.splitTitle}>单层用时</Text>
            {floorSplits.map((split, index) => (
              <View key={`${split.floor}-${index}`} style={styles.splitRow}>
                <Text style={styles.splitFloor}>{split.floor}层</Text>
                <Text style={styles.splitTime}>{split.time}</Text>
                <Text
                  style={[
                    styles.splitDuration,
                    split.fastest && styles.splitFastest,
                  ]}
                >
                  {split.split}
                  {split.fastest ? ' 最快' : ''}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        </Disclosure>
        <Button
          title="再爬一次"
          variant="secondary"
          onPress={() =>
            navigation.replace('WorkoutSetup', { id: session.templateId })
          }
        />

      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Button title="完成" onPress={() => navigation.navigate('Main', { screen: 'Train' })} />
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
    loading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    loadingText: {
      color: theme.mutedStrong,
      fontSize: theme.fontBase,
      lineHeight: 22,
      marginBottom: 12,
    },
    hero: {
      gap: 8,
    },
    eyebrow: {
      color: theme.green,
      fontSize: theme.fontEyebrow,
      fontWeight: '700',
    },
    routeName: {
      color: theme.ink,
      fontSize: theme.fontTitle,
      fontWeight: '700',
      lineHeight: 34,
    },
    dateText: {
      color: theme.mutedStrong,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
    },
    statusRow: {
      paddingTop: 8,
    },
    statusText: {
      color: theme.inkSoft,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
    },
    metricGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    metric: {
      flexGrow: 1,
      flexBasis: '45%',
      minWidth: 0,
    },
    detailCard: {
      paddingTop: 16,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    detailLabel: {
      color: theme.mutedStrong,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
    },
    detailValue: {
      color: theme.ink,
      fontSize: theme.fontBase,
      lineHeight: 22,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    correctionCard: {
      paddingTop: 8,
      gap: 12,
    },
    correctionTitle: {
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
    },
    correctionHint: {
      color: theme.mutedStrong,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
    },
    chainText: {
      color: theme.inkSoft,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '600',
    },
    splitCard: {
      paddingTop: 8,
    },
    splitTitle: {
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
      marginBottom: 12,
    },
    splitRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 8,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    splitFloor: {
      color: theme.ink,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '600',
      minWidth: 56,
    },
    splitTime: {
      flex: 1,
      color: theme.muted,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      minWidth: 72,
      fontVariant: ['tabular-nums'],
    },
    splitDuration: {
      color: theme.ink,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    splitFastest: {
      color: theme.success,
    },
    achievement: { paddingVertical: 8, gap: 8 },
    achievementLabel: { color: theme.mutedStrong, fontSize: theme.fontSmall, lineHeight: 18 },
    achievementLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 },
    achievementValue: { color: theme.ink, fontSize: 56, lineHeight: 68, fontWeight: '700', fontVariant: ['tabular-nums'] },
    achievementUnit: { color: theme.mutedStrong, fontSize: 20, lineHeight: 28, fontWeight: '600' },
    achievementDuration: { color: theme.mutedStrong, fontSize: theme.fontBase, lineHeight: 22, fontVariant: ['tabular-nums'] },
    footer: { backgroundColor: theme.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, paddingHorizontal: theme.pagePaddingH, paddingTop: 8 },
  })
