import { isRoundLearnable } from './corrections'
import { ClimbSession, ClimbWorkout } from './types'

function csvEscape(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return ''
  const text = String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function row(cells: Array<string | number | undefined | null>): string {
  return cells.map(csvEscape).join(',')
}

export interface WorkoutCsvInput {
  workouts: ClimbWorkout[]
  sessions?: ClimbSession[]
}

/** 训练记录 CSV：UTF-8 BOM，便于 Excel 直接打开中文表头。 */
export function buildWorkoutCsv({ workouts, sessions = [] }: WorkoutCsvInput): string {
  const lines: string[] = [
    row([
      '类型',
      '记录ID',
      '路线ID',
      '路线名称',
      '开始时间',
      '结束时间',
      '完成轮次',
      '总楼层',
      '爬升米',
      '步数',
      '净爬楼毫秒',
      '总历时毫秒',
      '状态',
      '可信',
    ]),
  ]

  workouts.forEach((workout) => {
    const completeRounds = workout.rounds.filter((round) => round.complete).length
    // 可信口径与结果页/汇总/学习资格统一：人工修正链、manual/recovered 来源、
    // trustworthy=false 的轮次都不得再标记为可信。
    const trustworthy =
      workout.status === 'completed' &&
      completeRounds > 0 &&
      workout.rounds.every(
        (round) =>
          round.interruptions.length === 0 &&
          isRoundLearnable(round) &&
          round.confidence >= 0.8,
      )
    lines.push(
      row([
        'workout',
        workout.id,
        workout.templateId,
        workout.routeSnapshot.locationName || workout.routeSnapshot.name,
        workout.startedAt,
        workout.endedAt ?? '',
        completeRounds,
        workout.totalFloorsCompleted,
        workout.totalAscentM,
        workout.totalSteps,
        workout.activeDurationMs,
        workout.totalElapsedMs,
        workout.status,
        trustworthy ? '1' : '0',
      ]),
    )
  })

  sessions.forEach((session) => {
    lines.push(
      row([
        'legacy_session',
        session.id,
        session.templateId,
        session.routeSnapshot?.name ?? '',
        session.startedAt,
        session.endedAt ?? '',
        session.complete ? 1 : 0,
        session.floorsCompleted,
        session.ascentM,
        session.steps,
        session.durationMs,
        session.durationMs,
        session.complete ? 'completed' : 'incomplete',
        '',
      ]),
    )
  })

  return `﻿${lines.join('\n')}\n`
}
