import React, { useCallback, useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Header } from '../components/Header'
import { Button, Card, Metric, Pill } from '../components/ui'
import { formatDuration } from '../core/math'
import {
  RouteLearningSummary,
  summarizeRouteLearning,
} from '../core/route-learning'
import { RouteTemplate } from '../core/types'
import { RootStackScreen } from '../navigation/types'
import { getRoute } from '../services/storage'
import { listWorkouts } from '../services/workout-storage'
import { Theme, useTheme } from '../theme'

function toneForStage(
  stage: RouteLearningSummary['stage'],
): 'default' | 'good' | 'warn' | 'danger' {
  if (stage === 'verified' || stage === 'usable') return 'good'
  if (stage === 'needs_review') return 'danger'
  if (stage === 'learning') return 'warn'
  return 'default'
}

export default function RouteProfileScreen({
  navigation,
  route,
}: RootStackScreen<'RouteProfile'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const [template, setTemplate] = useState<RouteTemplate | null>(null)
  const [learning, setLearning] = useState<RouteLearningSummary | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [storedRoute, workouts] = await Promise.all([
      getRoute(route.params.id),
      listWorkouts(),
    ])
    if (!storedRoute) {
      setError('路线不存在')
      return
    }
    setTemplate(storedRoute)
    setLearning(summarizeRouteLearning(storedRoute, workouts))
  }, [route.params.id])

  useEffect(() => {
    load().catch(() => setError('路线档案加载失败'))
    const unsubscribe = navigation.addListener('focus', () => {
      load().catch(() => undefined)
    })
    return unsubscribe
  }, [load, navigation])

  if (!template || !learning) {
    return (
      <View style={styles.page}>
        <Header title="路线档案" back />
        <View style={styles.center}>
          <Text style={styles.loadingText}>{error || '正在读取路线…'}</Text>
        </View>
      </View>
    )
  }

  const learned = learning.validCount > 0
  const progress = Math.min(1, learning.validCount / 5)
  const primaryTitle =
    learning.stage === 'unlearned'
      ? '开始首次采集'
      : learning.stage === 'verified'
        ? '进入训练设置'
        : '继续学习路线'

  const handlePrimaryAction = () => {
    if (learning.stage === 'unlearned') {
      navigation.replace('ClimbWorkout', {
        id: template.id,
        goal: { type: 'open' },
        returnConfirmationMode: 'assisted',
        countdownSeconds: 0,
      })
      return
    }
    navigation.navigate('WorkoutSetup', { id: template.id })
  }

  return (
    <View style={styles.page}>
      <Header
        title="路线档案"
        back
        rightLabel="地点"
        onRightPress={() =>
          navigation.navigate('LocationPicker', { routeId: template.id })
        }
      />
      <ScrollView
        style={styles.flex}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
      >
        <View style={styles.hero}>
          <Text style={styles.title}>{template.name}</Text>
          <Text style={styles.address}>
            {template.location?.address ?? '尚未补充具体地点'}
          </Text>
        </View>

        {learned ? (
          <Card raised style={styles.fingerprintCard}>
            <View style={styles.statusHeader}>
              <View>
                <Text style={styles.sectionEyebrow}>路线状态</Text>
                <Text style={styles.statusTitle}>{learning.stageLabel}</Text>
              </View>
              <Pill tone={toneForStage(learning.stage)}>
                {learning.validCount} 次有效数据
              </Pill>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressFill, { width: `${progress * 100}%` }]}
              />
            </View>
            <View style={styles.progressLabels}>
              <Text style={styles.progressText}>
                {learning.validCount < 3 ? '3次基本可用' : '已达到基本可用'}
              </Text>
              <Text style={styles.progressText}>约5次稳定验证</Text>
            </View>
            <Text style={styles.learningMessage}>{learning.message}</Text>
          </Card>
        ) : (
          <Card raised style={styles.unlearnedCard}>
            <Text style={styles.unlearnedLabel}>路线状态</Text>
            <Text style={styles.unlearnedTitle}>尚未学习</Text>
            <Text style={styles.unlearnedSummary}>
              这是一条刚刚建立的新路线，目前只有地点信息，还没有真实的爬楼数据。
            </Text>
            <View style={styles.unlearnedDivider} />
            <Text style={styles.firstCollectionTitle}>第一次采集怎么做</Text>
            <Text style={styles.firstCollectionText}>
              点击“开始首次采集”，从起点正常向上爬到终点。到达后确认实际终点楼层，应用会记录总爬升、楼梯、平台和转弯。
            </Text>
            <Text style={styles.firstCollectionHint}>
              完成第一次采集后，这里才会开始显示真实路线信息。
            </Text>
            <View style={styles.confirmationNote}>
              <Text style={styles.confirmationNoteTitle}>返回确认已经合并</Text>
              <Text style={styles.confirmationNoteText}>
                气压会自动判断你是否接近起点，到达后由你点一下确认，不需要再选择确认方式。
              </Text>
            </View>
          </Card>
        )}

        {learned ? (
          <>
            <Text style={styles.sectionLabel}>当前学习结果</Text>
            <View style={styles.metricGrid}>
              <Metric
                label="平均完成楼层"
                value={`${Math.round(learning.averageFloors)} 层`}
                style={styles.metric}
              />
              <Metric
                label="平均爬升"
                value={`${learning.averageAscentM.toFixed(1)}米`}
                style={styles.metric}
              />
              <Metric
                label="平均步数"
                value={Math.round(learning.averageSteps)}
                style={styles.metric}
              />
              <Metric
                label="平均一轮"
                value={formatDuration(learning.averageDurationMs)}
                style={styles.metric}
              />
            </View>
            <Card raised style={styles.consistencyCard}>
              <View style={styles.consistencyRow}>
                <Text style={styles.consistencyLabel}>多次数据一致程度</Text>
                <Text style={styles.consistencyValue}>
                  {Math.round(learning.consistency * 100)}%
                </Text>
              </View>
              <Text style={styles.consistencyHint}>
                正常数据用于学习；中断、未完成和明显异常的轮次不会加入路线标准。
              </Text>
            </Card>
          </>
        ) : null}

        <Button
          title={primaryTitle}
          onPress={handlePrimaryAction}
        />
        <Button
          title="查看历史"
          variant="secondary"
          onPress={() => navigation.navigate('History')}
        />
      </ScrollView>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: {
      paddingHorizontal: theme.pagePaddingH,
      gap: 10,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    loadingText: { color: theme.muted, fontSize: 14 },
    hero: { paddingTop: 8, paddingBottom: 6 },
    eyebrow: {
      color: theme.green,
      fontSize: theme.fontEyebrow,
      fontWeight: '700',
      letterSpacing: 1.5,
    },
    title: {
      paddingTop: 6,
      color: theme.ink,
      fontSize: 28,
      fontWeight: '800',
    },
    address: {
      paddingTop: 6,
      color: theme.muted,
      fontSize: 13,
      lineHeight: 19,
    },
    fingerprintCard: { padding: 14 },
    statusHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12,
    },
    sectionEyebrow: {
      color: theme.muted,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1,
    },
    statusTitle: {
      paddingTop: 4,
      color: theme.ink,
      fontSize: 22,
      fontWeight: '800',
    },
    progressTrack: {
      marginTop: 22,
      height: 8,
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: theme.surfaceSoft,
    },
    progressFill: {
      height: '100%',
      borderRadius: 999,
      backgroundColor: theme.green,
    },
    progressLabels: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingTop: 6,
    },
    progressText: { color: theme.muted, fontSize: 10 },
    learningMessage: {
      paddingTop: 10,
      color: theme.inkSoft,
      fontSize: 13,
      lineHeight: 20,
    },
    sectionLabel: {
      paddingTop: 8,
      color: theme.muted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
    },
    metricGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    metric: { flex: 1, minWidth: '45%' },
    consistencyCard: { padding: 14 },
    consistencyRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    consistencyLabel: { color: theme.muted, fontSize: 12 },
    consistencyValue: {
      color: theme.green,
      fontSize: 20,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    consistencyHint: {
      paddingTop: 8,
      color: theme.muted,
      fontSize: 12,
      lineHeight: 18,
    },
    unlearnedCard: {
      paddingHorizontal: 20,
      paddingVertical: 24,
      alignItems: 'center',
    },
    unlearnedLabel: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '700',
    },
    unlearnedTitle: {
      paddingTop: 8,
      color: theme.ink,
      fontSize: 28,
      fontWeight: '900',
    },
    unlearnedSummary: {
      paddingTop: 12,
      color: theme.muted,
      fontSize: 14,
      lineHeight: 22,
      textAlign: 'center',
    },
    unlearnedDivider: {
      width: '100%',
      height: StyleSheet.hairlineWidth,
      marginVertical: 20,
      backgroundColor: theme.line,
    },
    firstCollectionTitle: {
      color: theme.ink,
      fontSize: 16,
      fontWeight: '800',
      alignSelf: 'flex-start',
    },
    firstCollectionText: {
      paddingTop: 8,
      color: theme.muted,
      fontSize: 13,
      lineHeight: 20,
      alignSelf: 'flex-start',
    },
    firstCollectionHint: {
      paddingTop: 12,
      color: theme.green,
      fontSize: 12,
      lineHeight: 18,
      fontWeight: '700',
      alignSelf: 'flex-start',
    },
    confirmationNote: {
      width: '100%',
      marginTop: 16,
      padding: 12,
      borderRadius: theme.radiusMd,
      borderCurve: 'continuous',
      backgroundColor: theme.greenSoft,
    },
    confirmationNoteTitle: {
      color: theme.green,
      fontSize: 13,
      fontWeight: '800',
    },
    confirmationNoteText: {
      paddingTop: 4,
      color: theme.inkSoft,
      fontSize: 12,
      lineHeight: 18,
    },
  })
