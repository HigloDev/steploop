import { getRoundAchievementCount } from './floors'
import { localDayKey, trainingStreakDays } from './landmarks'
import { workoutCalories } from './fusion-workout'
import { isEligibleTrendWorkout } from './progress-trends'
import { deriveTrainingProgress } from './training-progress'
import type { ClimbWorkout } from './types'

export interface WeeklyAchievement {
  weekStart: number
  weekEnd: number
  floors: number
  ascentM: number
  workouts: number
  steps: number
  calories: number
  activeMs: number
  streak: number
  days: Array<{ at: number; label: string; floors: number }>
}

/** 首页与分享采用同一个周口径，仅导出汇总数，不带楼栋、位置或记录标识。 */
export function buildWeeklyAchievement(workouts: ClimbWorkout[], now = Date.now()): WeeklyAchievement {
  const progress = deriveTrainingProgress(workouts, now)
  const eligible = workouts.filter(isEligibleTrendWorkout)
  const week = eligible.filter(workout => workout.startedAt >= progress.weekStart && workout.startedAt <= progress.weekEnd)
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(progress.weekStart)
    date.setDate(date.getDate() + index)
    return { at: date.getTime(), label: ['一', '二', '三', '四', '五', '六', '日'][index],
      floors: week.filter(workout => localDayKey(workout.startedAt) === localDayKey(date.getTime()))
        .reduce((sum, workout) => sum + workout.rounds.reduce((count, round) => count + getRoundAchievementCount(round), 0), 0) }
  })
  return {
    weekStart: progress.weekStart, weekEnd: progress.weekEnd,
    floors: progress.floors, ascentM: progress.ascentM, workouts: progress.validWorkouts,
    steps: week.reduce((sum, workout) => sum + workout.rounds.reduce((count, round) => count + Math.max(0, round.steps ?? 0), 0), 0),
    calories: week.reduce((sum, workout) => sum + workoutCalories(workout), 0),
    activeMs: week.reduce((sum, workout) => sum + workout.rounds.reduce((count, round) => count + Math.max(0, round.activeMs ?? round.durationMs ?? 0), 0), 0),
    streak: trainingStreakDays(eligible.map(workout => localDayKey(workout.startedAt)), new Date(now)), days,
  }
}

export function weeklyDateRange(week: Pick<WeeklyAchievement, 'weekStart' | 'weekEnd'>): string {
  const from = new Date(week.weekStart), to = new Date(week.weekEnd)
  const date = (value: Date) => `${value.getMonth() + 1}.${String(value.getDate()).padStart(2, '0')}`
  return `${from.getFullYear()} / ${date(from)} — ${date(to)}`
}

export function weeklyShareText(week: WeeklyAchievement): string {
  return `这周也在向上。\n${weeklyDateRange(week)}\n我用 ${week.workouts} 次训练，爬了 ${week.floors} 层，累计向上 ${Math.round(week.ascentM)} 米。\n一步一步，向上生活。循阶。`
}
