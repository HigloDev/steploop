// 爬升高度的视觉参照。建筑/物体用自身高度，山峰用海拔，不能解释为登山路线爬升。
// 数据来源、口径和核对日期见 docs/HEIGHT_REFERENCES_20261010.md。
export interface Landmark {
  id: string
  name: string
  heightM: number
  kind: 'everyday' | 'city' | 'mountain'
  unit: '个' | '道' | '座'
  note: string
}

/** 严格按高度递增；每个参照都是独立实物，不以同一地标的倍数凑数。 */
export const LANDMARKS: readonly Landmark[] = [
  { id: 'goal', name: '足球球门', heightM: 2.44, kind: 'everyday', unit: '个', note: '地面至横梁下缘' },
  { id: 'hoop', name: '篮球篮筐', heightM: 3.05, kind: 'everyday', unit: '个', note: '地面至篮圈上缘' },
  { id: 'palace-wall', name: '故宫城墙', heightM: 9.9, kind: 'city', unit: '道', note: '地面至墙顶' },
  { id: 'yueyang', name: '岳阳楼', heightM: 19.42, kind: 'city', unit: '座', note: '主楼高度' },
  { id: 'tiananmen', name: '天安门', heightM: 34.7, kind: 'city', unit: '座', note: '城台与城楼通高' },
  { id: 'taihe', name: '故宫太和殿', heightM: 35.05, kind: 'city', unit: '座', note: '含台基通高' },
  { id: 'qinian', name: '祈年殿', heightM: 38.2, kind: 'city', unit: '座', note: '通高' },
  { id: 'yellow-crane', name: '黄鹤楼', heightM: 51.4, kind: 'city', unit: '座', note: '含宝顶通高' },
  { id: 'tengwang', name: '滕王阁', heightM: 57.5, kind: 'city', unit: '座', note: '主体建筑净高' },
  { id: 'wild-goose', name: '大雁塔', heightM: 64.5, kind: 'city', unit: '座', note: '塔身通高' },
  { id: 'leshan', name: '乐山大佛', heightM: 71, kind: 'city', unit: '座', note: '佛像通高' },
  { id: 'liberty', name: '自由女神像', heightM: 92.99, kind: 'city', unit: '座', note: '含基座至火炬顶' },
  { id: 'elizabeth', name: '伦敦钟塔', heightM: 96, kind: 'city', unit: '座', note: '伊丽莎白塔通高' },
  { id: 'washington', name: '华盛顿纪念碑', heightM: 169, kind: 'city', unit: '座', note: '通高，约值' },
  { id: 'gateway', name: '圣路易斯拱门', heightM: 192, kind: 'city', unit: '座', note: '通高，约值' },
  { id: 'eiffel', name: '埃菲尔铁塔', heightM: 330, kind: 'city', unit: '座', note: '含天线高度' },
  { id: 'tokyo', name: '东京塔', heightM: 333, kind: 'city', unit: '座', note: '含天线高度' },
  { id: 'empire', name: '帝国大厦', heightM: 443, kind: 'city', unit: '座', note: '含尖顶及天线，约值' },
  { id: 'oriental', name: '东方明珠', heightM: 468, kind: 'city', unit: '座', note: '塔体总高' },
  { id: 'taipei', name: '台北 101', heightM: 508, kind: 'city', unit: '座', note: '建筑高度' },
  { id: 'canton', name: '广州塔', heightM: 600, kind: 'city', unit: '座', note: '含天线高度' },
  { id: 'shanghai', name: '上海中心大厦', heightM: 632, kind: 'city', unit: '座', note: '建筑高度' },
  { id: 'burj', name: '哈利法塔', heightM: 828, kind: 'city', unit: '座', note: '建筑高度' },
  { id: 'yandang', name: '雁荡山百岗尖', heightM: 1108, kind: 'mountain', unit: '座', note: '西峰海拔' },
  { id: 'hengshan', name: '衡山祝融峰', heightM: 1300.2, kind: 'mountain', unit: '座', note: '峰顶海拔' },
  { id: 'jiuhua', name: '九华山十王峰', heightM: 1344.4, kind: 'mountain', unit: '座', note: '峰顶海拔' },
  { id: 'lushan', name: '庐山汉阳峰', heightM: 1473.4, kind: 'mountain', unit: '座', note: '峰顶海拔' },
  { id: 'songshan', name: '嵩山峻极峰', heightM: 1491.7, kind: 'mountain', unit: '座', note: '峰顶海拔' },
  { id: 'taishan', name: '泰山玉皇顶', heightM: 1532.7, kind: 'mountain', unit: '座', note: '峰顶海拔' },
  { id: 'huangshan', name: '黄山莲花峰', heightM: 1864.8, kind: 'mountain', unit: '座', note: '峰顶海拔' },
  { id: 'huashan', name: '华山南峰', heightM: 2154.9, kind: 'mountain', unit: '座', note: '峰顶海拔' },
  { id: 'emei', name: '峨眉山金顶', heightM: 3079.3, kind: 'mountain', unit: '座', note: '金顶海拔' },
  { id: 'fuji', name: '富士山', heightM: 3776, kind: 'mountain', unit: '座', note: '剑峰海拔' },
  { id: 'yulong', name: '玉龙雪山', heightM: 5596, kind: 'mountain', unit: '座', note: '扇子陡海拔' },
  { id: 'siguniang', name: '四姑娘山', heightM: 6250, kind: 'mountain', unit: '座', note: '幺妹峰海拔' },
  { id: 'k2', name: '乔戈里峰', heightM: 8611, kind: 'mountain', unit: '座', note: '峰顶海拔' },
  { id: 'everest', name: '珠穆朗玛峰', heightM: 8848.86, kind: 'mountain', unit: '座', note: '峰顶雪面海拔' },
]

export function normalizeAscent(ascentM: number): number {
  return Number.isFinite(ascentM) ? Math.max(0, ascentM) : 0
}

export function ascentReference(ascentM: number): { passed?: Landmark; next?: Landmark; remainingM: number } {
  const value = normalizeAscent(ascentM)
  const nextIndex = LANDMARKS.findIndex(item => item.heightM > value)
  const next = nextIndex < 0 ? undefined : LANDMARKS[nextIndex]
  const passed = nextIndex < 0 ? LANDMARKS.at(-1) : LANDMARKS[nextIndex - 1]
  return { passed, next, remainingM: next ? next.heightM - value : 0 }
}

export function referenceProgress(ascentM: number, heightM: number): string {
  const value = normalizeAscent(ascentM)
  const ratio = value / heightM
  if (ratio >= 1) return '已达到'
  if (ratio <= 0) return '0%'
  // 不把未达到的 99.9% 舍入为 100%，也不把微小爬升夸大到 1%。
  const percent = Math.floor(ratio * 100)
  return percent < 1 ? '<1%' : `${percent}%`
}

/** 默认展示最高已达到的参照；山峰强调高度相当，避免声称实际登顶。 */
export function describeAscent(ascentM: number): string {
  const value = normalizeAscent(ascentM)
  if (value === 0) return '还没开始爬'
  const { passed, next } = ascentReference(value)
  if (!passed && next) return `≈ ${next.name}的 ${referenceProgress(value, next.heightM)}`
  if (!passed) return '还没开始爬'
  const times = value / passed.heightM
  if (times >= 1.95) return `≈ ${times.toFixed(1)} ${passed.unit}${passed.name}`
  return passed.kind === 'mountain' ? `高度相当于${passed.name}` : `已达到${passed.name}高度`
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
