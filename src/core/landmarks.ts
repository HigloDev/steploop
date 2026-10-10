// 爬升高度 → 地标换算（首页本周累计用），让“爬了多少米”更有画面感。
export interface Landmark { name: string; heightM: number }

export const LANDMARKS: Landmark[] = [
  { name: '黄鹤楼', heightM: 51 },
  { name: '天安门', heightM: 35 },
  { name: '埃菲尔铁塔', heightM: 330 },
  { name: '东方明珠', heightM: 468 },
  { name: '台北 101', heightM: 508 },
  { name: '广州塔', heightM: 600 },
  { name: '上海中心大厦', heightM: 632 },
  { name: '泰山', heightM: 1545 },
  { name: '珠穆朗玛峰', heightM: 8849 },
]

/** 找一个最有感觉的说法：刚好超过某地标就说“N 座”，否则说“某地标的百分之几”。 */
export function describeAscent(ascentM: number): string {
  const value = Math.max(0, ascentM)
  if (value < 1) return '还没开始爬'
  const sorted = [...LANDMARKS].sort((a, b) => a.heightM - b.heightM)
  const passed = sorted.filter(item => value >= item.heightM).at(-1)
  if (passed) {
    const times = value / passed.heightM
    return times >= 1.95 ? `≈ ${times.toFixed(1)} 座${passed.name}` : `已超过${passed.name}（${passed.heightM} 米）`
  }
  const target = sorted.find(item => item.heightM > value) ?? sorted[0]
  return `≈ ${target.name}的 ${Math.max(1, Math.round((value / target.heightM) * 100))}%`
}

/** 连续训练天数：从今天（或昨天）往前数，每天至少一次训练。 */
export function trainingStreakDays(dayKeys: string[], today: Date = new Date()): number {
  const set = new Set(dayKeys)
  const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (!set.has(key(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (set.has(key(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export function localDayKey(atMs: number): string {
  const date = new Date(atMs)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
