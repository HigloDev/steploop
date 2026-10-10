import type { FusionSnapshot } from './fusion-engine'

export type WorkoutFeedback = 'floor' | 'round_complete'

/** 一次状态推进只发一种提示；恢复、轮次结算和 UI 重绘不重复震动。 */
export class WorkoutFeedbackTracker {
  private floors: number
  private rounds: number

  constructor(snapshot: Pick<FusionSnapshot, 'totalFloors' | 'completedRounds'>) {
    this.floors = snapshot.totalFloors
    this.rounds = snapshot.completedRounds
  }

  observe(snapshot: Pick<FusionSnapshot, 'totalFloors' | 'completedRounds'>): WorkoutFeedback | undefined {
    const completed = snapshot.completedRounds > this.rounds
    const advanced = snapshot.totalFloors > this.floors
    this.floors = snapshot.totalFloors
    this.rounds = snapshot.completedRounds
    return completed ? 'round_complete' : advanced ? 'floor' : undefined
  }
}
