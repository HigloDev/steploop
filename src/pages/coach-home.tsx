import React, { useRef, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { UIIcon, resolveUIIconName } from '../components/ui-icon'
import { TrackedImage } from '../components/tracked-image'
import { MainTabScreen } from '../navigation/types'
import { Button, Card, Pill } from '../components/ui'
import { Disclosure } from '../components/disclosure'
import { FlowSheet } from '../components/flow-sheet'
import { CoachMessage, CoachPage, CoachSection, CoachText, WeightTrend, displayDate, minutesText, todayKey, useCoachData } from '../components/coach-ui'
import {
  COACH_COURSES, activeEnrollment, addDays, courseById, endDate, habitLesson, latestWeight,
  nextSession, sessionProgress, weekStart, weeklySummary, weightGoalReached,
} from '../core/coach'
import { setEnrollmentStatus } from '../services/coach-storage'
import { getCourseIconAccent, getThemeSkinId, isLargeText, isMotionRing, skinTypography, sport, useTheme } from '../theme'
import { getThemeStairwell } from '../skin-assets'
import { getGlassSurfaceStyle } from '../components/glass-material'
import { MotionHeroSurfaceArt, MotionRingArc } from '../components/motion-ring-graphics'
import { MotionPressable } from '../components/motion-pressable'

export default function CoachHome({ navigation }: MainTabScreen<'Coach'>) {
  const t = useTheme(), data = useCoachData(navigation)
  const skinId = getThemeSkinId(t)
  const motionRing = isMotionRing(t)
  const mode = t.isDark ? 'dark' : 'light'
  const stairwellSource = getThemeStairwell(skinId, mode)
  const [busy, setBusy] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const lock = useRef(false)
  const s = data.state, today = todayKey()
  const e = s ? activeEnrollment(s) : undefined
  const summary = s && e ? weeklySummary(s, e, today) : undefined
  const next = s && e ? nextSession(s, e, today) : undefined
  const recent = s ? latestWeight(s, today) : undefined
  const { fontScale, width } = useWindowDimensions()
  const largeText = isLargeText(fontScale)
  const showWatermark = !largeText && width >= 340

  const introduction = (
    <View style={[
      motionRing
        ? {
            backgroundColor: t.heroSurface,
            borderWidth: 1,
            borderColor: t.brandVisual.frostStroke,
            ...t.elevation.level2.shadow,
          }
        : getGlassSurfaceStyle(t, 'feature'),
      {
        gap: t.space.xs,
        padding: t.space.lg,
        borderRadius: t.radius.xl,
        minHeight: showWatermark ? 112 : undefined,
        justifyContent: 'center',
        overflow: 'hidden',
      },
    ]}>
      {motionRing ? (
        <MotionHeroSurfaceArt variant="coach" />
      ) : showWatermark ? (
        <View
          pointerEvents="none"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '34%', opacity: t.isDark ? 0.42 : 0.48 }}
        >
          <TrackedImage
            identity={`art/${skinId}/${mode}/coach-catalog-stairwell`}
            source={stairwellSource}
            resizeMode="cover"
            accessible={false}
            style={{ width: '100%', height: '100%' }}
          />
        </View>
      ) : null}
      <CoachText size="display" style={[{ maxWidth: showWatermark ? '68%' : '100%' }, motionRing && { color: t.heroInk }]}>
        给每一次向上，{'\n'}一个方向。
      </CoachText>
      <CoachText size="small" tone="muted" style={[{ maxWidth: showWatermark ? '68%' : '100%' }, motionRing && { color: t.heroMuted }]}>
        按自己的体力选一门节奏，记录全部留在本机。
      </CoachText>
    </View>
  )

  const status = async (id: string, value: 'active' | 'paused' | 'completed' | 'maintaining') => {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try { data.setState(await setEnrollmentStatus(id, value, Date.now())) } catch (err) {
      data.setError(err instanceof Error ? err.message : '操作未保存，请重试。')
    } finally { lock.current = false; setBusy(false) }
  }

  const weekSessions = s && e
    ? s.sessions.filter(v => v.enrollmentId === e.id && v.date >= weekStart(today) && v.date <= addDays(weekStart(today), 6))
    : []

  const otherEnrollments = s ? [...s.enrollments].filter(v => v.status === 'paused' || v.status === 'completed').reverse() : []
  const weightDelta = e?.courseId === 'weight' && recent && e.targetWeightKg !== undefined
    ? Number((recent.weightKg - e.targetWeightKg).toFixed(1))
    : undefined

  return <CoachPage title="教练" back={false} hero={s && !e ? introduction : undefined}>
    <CoachMessage error={data.error} loading={data.loading && !s} retry={() => void data.refresh()} />
    {s ? <>
      {e ? <>
        {/* 今日课程 Hero 卡：胶囊内收 + 楼梯/运动环做背景 + 全宽主按钮不折行 */}
        <Card
          style={[
            motionRing
              ? {
                  backgroundColor: t.heroSurface,
                  borderWidth: 1,
                  borderColor: t.brandVisual.frostStroke,
                  ...t.elevation.level2.shadow,
                }
              : getGlassSurfaceStyle(t, 'feature'),
            { overflow: 'hidden', gap: 12 },
          ]}
        >
          {motionRing ? (
            <MotionHeroSurfaceArt variant="coach" />
          ) : showWatermark ? (
            <View
              pointerEvents="none"
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{ position: 'absolute', top: 0, right: 0, width: 132, height: 102, opacity: t.isDark ? 0.36 : 0.42 }}
            >
              <TrackedImage
                identity={`art/${skinId}/${mode}/coach-today-stairwell`}
                source={stairwellSource}
                resizeMode="cover"
                accessible={false}
                style={{ width: '100%', height: '100%' }}
              />
            </View>
          ) : null}
          {motionRing ? (
            <View
              accessible
              accessibilityRole="text"
              style={{
                alignSelf: 'flex-start',
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 999,
                backgroundColor: 'rgba(13, 56, 44, 0.72)',
                borderWidth: 1,
                borderColor: '#6FD6A5',
              }}
            >
              <Text style={{ fontSize: t.fontPill, fontWeight: '600', color: '#A5F5CE' }}>
                {e.status === 'maintaining' ? '维持阶段' : '正在进行'} · {courseById(e.courseId).name}
              </Text>
            </View>
          ) : (
            <Pill tone="good">
              {e.status === 'maintaining' ? '维持阶段' : '正在进行'} · {courseById(e.courseId).name}
            </Pill>
          )}
          <View style={{ gap: 6, maxWidth: showWatermark ? '76%' : '100%' }}>
            <CoachText size="display" accessibilityRole="header" style={motionRing ? { color: t.heroInk } : undefined}>
              {next?.date === today ? '今天，按自己的节奏向上' : '今天留给恢复与日常活动'}
            </CoachText>
            <CoachText size="small" tone="muted" style={motionRing ? { color: t.heroMuted } : undefined}>
              {next
                ? (next.date === today ? `第 ${next.week} 周 · 本次` : `下次 ${displayDate(next.date)}`) +
                  `净上爬 ${minutesText(next.targetMinutes)} 分钟，另含热身、返回和恢复。`
                : endDate(e) < today
                  ? '这阶段已到复盘日期。看看记录，再调整后续计划。'
                  : '本阶段课程已完成，保持舒适的日常活动。'}
            </CoachText>
          </View>
          {next ? (
            <Button
              title={next.date === today ? '查看并开始今日课程' : '查看下次课程'}
              style={motionRing ? { backgroundColor: t.heroAccent } : undefined}
              labelStyle={motionRing ? { color: '#041A47' } : undefined}
              onPress={() => navigation.navigate('CoachSession', { sessionId: next.id })}
            />
          ) : (
            <Button
              title="调整后续计划"
              style={motionRing ? { backgroundColor: t.heroAccent } : undefined}
              labelStyle={motionRing ? { color: '#041A47' } : undefined}
              onPress={() => navigation.navigate('CoachGoal', { courseId: e.courseId, enrollmentId: e.id })}
            />
          )}
        </Card>

        {/* 体重与阶段趋势卡 */}
        {e.courseId === 'weight' ? (
          <CoachSection
            card
            title="体重与阶段趋势"
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="记录体重或查看全部趋势"
                onPress={() => navigation.navigate('CoachRecords', { tab: 'weight' })}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 36, opacity: pressed ? sport.opacity.pressed : 1 })}
              >
                <CoachText size="small" tone="accent" style={{ fontWeight: '600' }}>记录体重</CoachText>
                <UIIcon name="chevron-right" size={16} color={t.brandText} />
              </Pressable>
            }
          >
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <CoachText size="metric">{recent ? recent.weightKg.toFixed(1) : '—'}</CoachText>
                <CoachText size="small" tone="muted">公斤</CoachText>
              </View>
              {weightDelta !== undefined ? (
                <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: t.brandSoft }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: t.brandText }}>
                    {e.goalMode === 'maintain'
                      ? `维持参考 ${e.targetWeightKg} kg`
                      : weightDelta > 0
                        ? `距目标 ${e.targetWeightKg} 还差 ${weightDelta.toFixed(1)} kg`
                        : `已达到目标 ${e.targetWeightKg} kg`}
                  </Text>
                </View>
              ) : null}
            </View>
            <CoachText size="caption" tone="muted">
              {displayDate(endDate(e))} 阶段复盘{recent ? ` · 最近称重 ${recent.date}（起始 ${e.initialWeightKg} 公斤）` : ''}
            </CoachText>
            <WeightTrend readings={s.weighIns.filter(w => w.date >= e.startedOn && w.date <= today)} target={e.targetWeightKg} />
            {e.status !== 'maintaining' && e.goalMode === 'lose' && weightGoalReached(s, e, today) ? (
              <Button title="近期均重达到目标，转入维持" disabled={busy} onPress={() => void status(e.id, 'maintaining')} />
            ) : null}
          </CoachSection>
        ) : null}

        {/* 本周进度与语义统一的时间线 */}
        {summary ? (
          <CoachSection
            card
            title="本周进度"
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="做一次本周复盘"
                onPress={() => navigation.navigate('CoachReview', { enrollmentId: e.id })}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 36, opacity: pressed ? sport.opacity.pressed : 1 })}
              >
                <CoachText size="small" tone="accent" style={{ fontWeight: '600' }}>本周复盘</CoachText>
                <UIIcon name="chevron-right" size={16} color={t.brandText} />
              </Pressable>
            }
          >
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <View style={{ gap: 2, flexShrink: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                  <CoachText size="metric">{summary.completed} / {summary.planned}</CoachText>
                  <CoachText size="small" tone="muted">次课程完成</CoachText>
                </View>
                <CoachText size="caption" tone="muted">净上爬 {minutesText(summary.minutes)} 分钟</CoachText>
              </View>
              {motionRing ? (
                <MotionRingArc
                  progress={summary.planned > 0 ? summary.completed / summary.planned : 0}
                  size={56}
                  strokeWidth={5.5}
                  center={
                    <Text style={{ fontSize: 13, fontWeight: '700', color: t.brandText, fontVariant: ['tabular-nums'] }}>
                      {summary.planned > 0 ? `${Math.min(100, Math.round((summary.completed / summary.planned) * 100))}%` : '0%'}
                    </Text>
                  }
                />
              ) : null}
            </View>
            {summary.attempted > summary.completed ? (
              <CoachText size="caption" tone="muted">未完成的努力也已保留在训练记录中。</CoachText>
            ) : null}
            <View>
              {weekSessions.map((session, index) => {
                const progress = sessionProgress(s, session)
                const isToday = session.date === today
                const isPastMissed = !progress.completed && (session.skipped || session.date < today)
                const isFirst = index === 0
                const isLast = index === weekSessions.length - 1
                return (
                  <MotionPressable
                    key={session.id}
                    accessibilityRole="button"
                    accessibilityLabel={session.date + '课程，' + (progress.completed ? '已完成' : session.skipped ? '已跳过' : '查看安排')}
                    onPress={() => navigation.navigate('CoachSession', { sessionId: session.id })}
                    style={{ minHeight: t.tapMin }}
                    contentStyle={{ flexDirection: 'row', alignItems: 'stretch', gap: 12 }}
                  >
                    <View pointerEvents="none" style={{ width: 22, alignItems: 'center' }}>
                      <View style={{ width: 2, flex: 1, backgroundColor: isFirst ? 'transparent' : t.lineSoft }} />
                      {isToday && !progress.completed ? (
                        <View
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 9,
                            backgroundColor: t.brandSoft,
                            borderWidth: motionRing ? 1.5 : 0,
                            borderColor: motionRing ? t.brandVisual.ringEnd : 'transparent',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: t.brandText }} />
                        </View>
                      ) : (
                        <View
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 5,
                            backgroundColor: progress.completed ? t.success : isPastMissed ? t.muted : t.card,
                            borderWidth: progress.completed || isPastMissed ? 0 : 2,
                            borderColor: t.line,
                          }}
                        />
                      )}
                      <View style={{ width: 2, flex: 1, backgroundColor: isLast ? 'transparent' : t.lineSoft }} />
                    </View>
                    <View
                      style={{
                        flex: 1,
                        minWidth: 0,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        paddingVertical: 12,
                        borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                        borderBottomColor: t.lineSoft,
                      }}
                    >
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <CoachText style={isToday ? { color: t.brandText, fontWeight: '700' } : undefined}>
                          {displayDate(session.date)}{isToday ? '（今天）' : ''} · 上爬 {minutesText(session.targetMinutes)} 分钟
                        </CoachText>
                        <CoachText size="small" tone={progress.completed ? 'good' : 'muted'}>
                          {progress.completed
                            ? '已完成'
                            : session.skipped
                              ? '已跳过，不补量'
                              : session.date < today
                                ? '未完成，不补量'
                                : progress.minutes > 0
                                  ? '已练 ' + minutesText(progress.minutes) + ' 分钟，可继续'
                                  : isToday
                                    ? '今天的安排'
                                    : '待开始'}
                        </CoachText>
                      </View>
                      <UIIcon name="chevron-right" size={18} color={t.mutedStrong} />
                    </View>
                  </MotionPressable>
                )
              })}
            </View>
          </CoachSection>
        ) : null}

        {/* 本周习惯小课 */}
        {(() => {
          const lesson = habitLesson(e, next?.week ?? 1)
          return (
            <CoachSection card title={lesson.title} meta={`第 ${next?.week ?? 1} 周提示`}>
              <CoachText size="small" tone="muted">{lesson.text}</CoachText>
            </CoachSection>
          )
        })()}

        {/* 紧凑管理与记录入口（替代 3 个全宽大按钮瀑布） */}
        <View style={[getGlassSurfaceStyle(t, 'card'), { paddingHorizontal: 14, paddingVertical: 6 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="管理当前计划，调整目标、暂停或结束课程"
            disabled={busy}
            onPress={() => setManageOpen(true)}
            style={({ pressed }) => ({
              minHeight: 56,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              opacity: pressed ? sport.opacity.pressed : 1,
            })}
          >
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: t.surfaceSoft, alignItems: 'center', justifyContent: 'center' }}>
              <UIIcon name="pencil" size={18} color={t.brandText} />
            </View>
            <CoachText style={{ flex: 1, fontWeight: '600' }}>管理当前计划</CoachText>
            <CoachText size="small" tone="muted">调整 / 暂停</CoachText>
            <UIIcon name="chevron-right" size={18} color={t.mutedStrong} />
          </Pressable>

          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.lineSoft }} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="查看全部体重、课程与复盘记录"
            onPress={() => navigation.navigate('CoachRecords', undefined)}
            style={({ pressed }) => ({
              minHeight: 56,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              opacity: pressed ? sport.opacity.pressed : 1,
            })}
          >
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: t.surfaceSoft, alignItems: 'center', justifyContent: 'center' }}>
              <UIIcon name="records" size={18} color={t.brandText} />
            </View>
            <CoachText style={{ flex: 1, fontWeight: '600' }}>全部体重、课程与复盘</CoachText>
            <UIIcon name="chevron-right" size={18} color={t.mutedStrong} />
          </Pressable>

          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.lineSoft }} />

          <Disclosure icon="book-open" title="其他课程" summary={`共 ${COACH_COURSES.length} 门课程`} compact marginTop={0}>
            <View style={{ gap: 8, paddingTop: 4 }}>
              {COACH_COURSES.map(course => {
                const isCurrent = e.courseId === course.id
                const iconAccent = getCourseIconAccent(t, course.id)
                return (
                  <Pressable
                    key={course.id}
                    accessibilityRole="button"
                    accessibilityLabel={course.name + '，' + course.duration + (isCurrent ? '，进行中' : '')}
                    onPress={() => navigation.navigate('CoachCourse', { courseId: course.id })}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      padding: 12,
                      borderRadius: t.radiusMd,
                      backgroundColor: isCurrent ? t.brandSoft : t.surfaceSoft,
                      opacity: pressed ? sport.opacity.pressed : 1,
                    })}
                  >
                    <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center' }}>
                      <UIIcon name={resolveUIIconName(course.icon)} size={20} color={iconAccent} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <CoachText style={{ fontWeight: '600' }}>{course.name}</CoachText>
                        {isCurrent ? <Pill tone="good">进行中</Pill> : null}
                      </View>
                      <CoachText size="caption" tone="muted">{course.duration} · {course.description}</CoachText>
                    </View>
                    <UIIcon name="chevron-right" size={18} color={t.mutedStrong} />
                  </Pressable>
                )
              })}
            </View>
          </Disclosure>
        </View>
      </> : <>
        {/* 未报名状态：干净的课程目录（去除了冗余的重复体重按钮） */}
        <CoachSection title="选择课程" meta="一次专注一个阶段">
          {COACH_COURSES.map((course, index) => {
            const iconAccent = getCourseIconAccent(t, course.id)
            return (
              <MotionPressable
                key={course.id}
                accessibilityRole="button"
                accessibilityLabel={course.name + '，' + course.duration}
                onPress={() => navigation.navigate('CoachCourse', { courseId: course.id })}
                style={[
                  getGlassSurfaceStyle(t, 'card'),
                  { paddingHorizontal: 16, paddingVertical: 14, borderRadius: t.radiusLg },
                ]}
              >
                <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                  <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: t.brandSoft, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <UIIcon name={resolveUIIconName(course.icon)} size={24} color={iconAccent} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <CoachText size="title" style={skinTypography.cardTitle}>{course.name}</CoachText>
                      {index === 0 ? (
                        <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: t.brandSoft }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: t.brandText }}>推荐起步</Text>
                        </View>
                      ) : null}
                    </View>
                    <CoachText tone="muted" style={skinTypography.secondary}>{course.duration} · {course.description}</CoachText>
                  </View>
                  <UIIcon name="chevron-right" size={18} color={t.mutedStrong} />
                </View>
              </MotionPressable>
            )
          })}
        </CoachSection>

        <View style={[getGlassSurfaceStyle(t, 'card'), { paddingHorizontal: 14, paddingVertical: 4 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="全部体重、课程与复盘记录"
            onPress={() => navigation.navigate('CoachRecords', undefined)}
            style={({ pressed }) => ({
              minHeight: 54,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              opacity: pressed ? sport.opacity.pressed : 1,
            })}
          >
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: t.surfaceSoft, alignItems: 'center', justifyContent: 'center' }}>
              <UIIcon name="records" size={18} color={t.brandText} />
            </View>
            <CoachText style={{ flex: 1, fontWeight: '600' }}>全部体重、课程与复盘</CoachText>
            <UIIcon name="chevron-right" size={18} color={t.mutedStrong} />
          </Pressable>
        </View>
      </>}

      {otherEnrollments.length ? (
        <CoachSection card title="我的其他阶段" meta={`${otherEnrollments.length} 个阶段`}>
          {otherEnrollments.map((v, idx) => (
            <View
              key={v.id}
              style={{
                gap: 8,
                paddingBottom: idx < otherEnrollments.length - 1 ? 12 : 0,
                borderBottomWidth: idx < otherEnrollments.length - 1 ? StyleSheet.hairlineWidth : 0,
                borderBottomColor: t.lineSoft,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <CoachText style={{ fontWeight: '600' }}>{courseById(v.courseId).name}</CoachText>
                <Pill tone={v.status === 'paused' ? 'warn' : 'default'}>{v.status === 'paused' ? '已暂停' : '已结束'}</Pill>
              </View>
              <CoachText size="small" tone="muted">
                {v.startedOn} 开始 · 已完成 {s.sessions.filter(session => session.enrollmentId === v.id && sessionProgress(s, session).completed).length} 次课程
              </CoachText>
              {v.status === 'paused' ? (
                <Button title={'继续' + courseById(v.courseId).name} variant="secondary" disabled={busy || !!e} onPress={() => void status(v.id, 'active')} />
              ) : null}
            </View>
          ))}
          {e ? <CoachText size="caption" tone="muted">先暂停当前课程，即可继续其他阶段。</CoachText> : null}
        </CoachSection>
      ) : null}
    </> : null}

    {e ? (
      <FlowSheet visible={manageOpen} title="管理当前计划" busy={busy} onClose={() => setManageOpen(false)}>
        <CoachText size="small" tone="muted">
          当前进行中：{courseById(e.courseId).name}（{displayDate(endDate(e))} 阶段复盘）。历史训练、称重和复盘记录始终保留。
        </CoachText>
        <Button
          title="调整目标与训练日"
          variant="secondary"
          disabled={busy}
          onPress={() => {
            setManageOpen(false)
            navigation.navigate('CoachGoal', { courseId: e.courseId, enrollmentId: e.id })
          }}
        />
        <Button
          title="暂停课程"
          variant="secondary"
          disabled={busy}
          onPress={() => {
            setManageOpen(false)
            Alert.alert('暂停这门课程？', '已完成的训练、称重和复盘都会保留，之后可以继续。', [
              { text: '取消', style: 'cancel' },
              { text: '暂停', onPress: () => void status(e.id, 'paused') },
            ])
          }}
        />
        <Button
          title="结束这一阶段"
          variant="danger"
          disabled={busy}
          onPress={() => {
            setManageOpen(false)
            Alert.alert('结束这一阶段？', '课程会移入已结束列表，历史记录继续保留。你仍可以开始新的阶段。', [
              { text: '取消', style: 'cancel' },
              { text: '结束并保留记录', style: 'destructive', onPress: () => void status(e.id, 'completed') },
            ])
          }}
        />
      </FlowSheet>
    ) : null}
  </CoachPage>
}
