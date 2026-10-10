// 传感器算法参数单一来源。
// analysis / free-recognizer / recognizer 必须从这里 import，禁止就地魔改数值。

export const METERS_PER_HPA = 8.3
export const BARO_FLOOR_M = 3
// 实时识别气压层阈值：约 3m 一层。旧值 0.3hPa≈2.5m 会在半层
// 转弯后的气压滞后点提前报层。
export const BARO_EPS = BARO_FLOOR_M / METERS_PER_HPA
// 标定离线切分用的气压阈值，比实时更敏感（0.3hPa≈2.5m）：
// 离线可回溯修正，且现有标定流程与诊断基线依赖该值。
export const BARO_EPS_CALIBRATE = 0.3
export const BARO_SMOOTH_WINDOW = 10
export const BARO_FLOOR_COOLDOWN_MS = 2000
export const BARO_BASELINE_SAMPLE_COUNT = 5
export const P0_HPA = 1013.25
export const BARO_EXP = 0.190263
export const STEPS_PER_FLOOR_CALIBRATE = 18
export const STEPS_PER_FLOOR_FREE = 32
export const DEFAULT_FLOOR_HEIGHT_M = 3
// 电梯/扶梯负样本：近窗内高度上升却几乎无脚步、无整拐、无持续能量
export const ELEVATOR_WINDOW_MS = 6000
export const ELEVATOR_MIN_FLOORS = 0.6
export const ELEVATOR_MAX_STEPS = 1
export const ELEVATOR_MIN_ACTIVE_FRAMES = 4

export type FeatureSpace = 'heading' | 'device'
export const DEFAULT_FEATURE_SPACE: FeatureSpace = 'heading'

// ===================== fusion-v1 融合识别参数 =====================
// 以下参数只被 fusion-v1（标定轮 + 自动轮）使用；旧 motion-v3 参数保持不变以便回放旧数据。

/** 识别版本号：新训练记录写入该值。 */
export const FUSION_RECOGNITION_VERSION = 'fusion-v1' as const

// ---- 气压 ----
/** 超过该时长没有新的气压事件，视为气压停更（stale），停更期间不得用气压做任何判断。 */
export const BARO_STALE_MS = 2000
/** 中位数窗口：先取 1s 中位数，压掉开门、风压等瞬时尖峰。 */
export const BARO_MEDIAN_WINDOW_MS = 1000
/** 滑动平均窗口：再做 3s 平均，得到平滑高度。 */
export const BARO_MEAN_WINDOW_MS = 3000
/** 垂直速度：对最近 4s 平滑高度做线性回归取斜率。 */
export const BARO_SPEED_WINDOW_MS = 4000
/** 平滑高度历史保留时长（用于标定点取值、平台判定、闭合漂移估计）。 */
export const BARO_HISTORY_MS = 30 * 60 * 1000
/** 标定点的高度：取点击时刻前后 ±1s 的平滑高度中位数。 */
export const MARK_HEIGHT_WINDOW_MS = 1000
/** 单个气压事件与 1s 中位数偏离超过该值（米）时视为尖峰，直接丢弃（开门/关门压力跳变）。 */
export const BARO_SPIKE_M = 2.5

// ---- 计步（自适应阈值 + 迟滞）----
/** 高阈值下限（g）：手机静置或轻微晃动不应触发步伐。 */
export const STEP_MIN_HIGH_G = 0.075
/** 高阈值 = 底噪 + 该比例 × (峰值包络 − 底噪)。 */
export const STEP_HIGH_RATIO = 0.5
/** 低阈值（重新武装）= 底噪 + 该比例 × (峰值包络 − 底噪)。信号必须先跌破低阈值才能计下一步。 */
export const STEP_LOW_RATIO = 0.28
/** 峰值包络衰减时间常数（ms）。 */
export const STEP_PEAK_DECAY_MS = 1800
/** 底噪跟随时间常数（ms）。 */
export const STEP_FLOOR_RISE_MS = 2500
/** 两步最小间隔（ms），对应 ≤ 3.6 步/秒。 */
export const STEP_MIN_INTERVAL_MS = 280
/** 步频统计窗口（ms），用真实步间隔计算步频，代替旧的 steps×120。 */
export const CADENCE_WINDOW_MS = 4000

// ---- 楼层判定 ----
/** 当前高度 ≥ H_k − 该比例 × h_k 时，认为已到达第 k 层（每层边界在接近平台时触发）。 */
export const FLOOR_REACH_RATIO = 0.3
/** 达到门限后需持续的时长（ms），防止开门压力跳变把楼层推上去。 */
export const FLOOR_DWELL_MS = 1200
/** 推进一层要求的最少步数 = 该比例 × 模板该层步数（防电梯/站立晃动误推进）。 */
export const FLOOR_MIN_STEP_RATIO = 0.4
/** 气压已明显越过本层（H_k + 该比例 × h_k）但步数不足：仍推进，但标“估算”。 */
export const FLOOR_FORCE_RATIO = 0.25
/** 无气压/气压停更时的退化计层：本层步数达到模板的该比例。 */
export const MOTION_FLOOR_STEP_RATIO = 0.85
/** 退化计层：拐弯数不足时，步数达到模板该比例也允许推进（拐弯可能漏识别）。 */
export const MOTION_FLOOR_STEP_RATIO_NO_TURN = 1.3
/** 无模板步数信息时，每层默认步数。 */
export const DEFAULT_STEPS_PER_FLOOR = 18
/** 楼层置信度低于该值即标为“估算”。 */
export const FLOOR_ESTIMATE_BELOW = 0.6

// ---- 标定轮异常检查 ----
export const CAL_FLOOR_MIN_M = 1.8
export const CAL_FLOOR_MAX_M = 6
/** 第一层（大堂）允许更高。 */
export const CAL_LOBBY_MAX_M = 9
/** 某层高度 ≈ 中位层高的该倍数（且步数也接近两倍）时，判为漏点一层，自动拆成两层并标“估算”。 */
export const CAL_MISSED_TAP_RATIO = 1.75
/** “到顶了”距离上一次“到了一层”很近且几乎没走步时，只确认顶层，不再多加一层。 */
export const CAL_TOP_MERGE_MS = 4000
export const CAL_TOP_MERGE_STEPS = 4

// ---- 电梯/下楼/起爬 ----
/** 电梯下行：垂直速度 < −该值 m/s。 */
export const ELEVATOR_SPEED_MPS = 0.7
/** 电梯判定需持续的时长。 */
export const ELEVATOR_MIN_MS = 2000
/** 电梯判定窗口内允许的最大步数。 */
export const ELEVATOR_MAX_STEPS_FUSION = 2
/** 走楼梯下楼：从本轮最高点下降超过 max(该值, 0.8 × 中位层高) 且有步数。 */
export const STAIRS_DOWN_MIN_M = 2.5
/** 平台：|垂直速度| < 该值持续 PLATEAU_MS，视为停稳（到达楼下）。 */
export const PLATEAU_SPEED_MPS = 0.2
export const PLATEAU_MS = 3000
/** 自动起爬：相对楼下平台上升 ≥ 该值，并且自离开平台起步数 ≥ AUTO_START_STEPS（与爬楼速度无关）。 */
export const AUTO_START_RISE_M = 0.6
export const AUTO_START_STEPS = 3
export const AUTO_START_WINDOW_MS = 8000
/** 无气压时自动起爬：近 6s 步数 ≥ 该值。 */
export const AUTO_START_STEPS_NO_BARO = 8
/** 无气压时：到达模板顶层后连续该时长无步数，视为本轮结束。 */
export const NO_BARO_IDLE_END_MS = 15000
/** 漂移补偿：近该时长无步数且 |v| 很小，高度变化计入漂移。 */
export const DRIFT_IDLE_MS = 8000
export const DRIFT_MAX_SPEED_MPS = 0.12
/** 闭合漂移修正最多接受的漂移（× 中位层高）。超出说明回到的不是同一层，不修正；另需步数交叉核对通过。 */
export const DRIFT_CLOSURE_MAX_RATIO = 1.25
/** 活动时间：两步间隔不超过该值才把间隔计入活动时间。 */
export const ACTIVE_GAP_MAX_MS = 3500
