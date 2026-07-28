export type CarryMode = 'pocket' | 'waist'
export type MarkerType = 'turn' | 'landing' | 'pause' | 'manual_turn' | 'manual_floor'
export type TurnDirection = 'left' | 'right'
export type RouteStatus = 'draft' | 'needs_validation' | 'verified'
export type ClimbMode = 'validation' | 'formal'

// 人工标记：用户在采集过程中点击「标记拐弯」或「到达新楼层」时记录
export interface ManualMark {
  id: string
  type: 'turn' | 'floor'
  atMs: number          // 相对采集开始的毫秒时间戳
  floor?: number        // type='floor' 时为该标记对应的楼层
  note?: string
}

export interface SensorSample {
  t: number
  ax: number
  ay: number
  az: number
  gx: number
  gy: number
  gz: number
  alpha: number
  beta: number
  gamma: number
}

export interface FeatureFrame {
  startMs: number
  endMs: number
  steps: number
  cadence: number
  energy: number
  turnRad: number
  paused: number
}

export interface RouteMarker {
  id: string
  type: MarkerType
  atMs: number
  endMs?: number
  direction?: TurnDirection
  confidence: number
}

export interface RouteSegment {
  id: string
  type: 'flight'
  startMs: number
  endMs: number
  floorFrom: number
  floorTo: number
  ascentM: number
  stepCount: number
  features: number[][]
}

export interface DeviceFingerprint {
  platform: string
  model: string
  system: string
}

export interface RouteLocation {
  name: string
  address: string
  latitude: number
  longitude: number
  accuracy: number
  source: 'gps' | 'map'
  confirmedAt: number
}

export interface InferredRoute {
  estimatedFloorCount: number
  estimatedStepCount: number
  estimatedAscentM: number
  defaultRiserM: number
  floorBoundaries: number[]
  turnCount: number
  landingCount: number
  confidence: {
    floors: number
    height: number
    overall: number
  }
}

export interface RouteTemplate {
  id: string
  name: string
  startFloor: number
  endFloor: number
  carryMode: CarryMode
  floorHeightM: number
  totalAscentM: number
  device: DeviceFingerprint
  segments: RouteSegment[]
  markers: RouteMarker[]
  createdAt: number
  updatedAt: number
  version: number
  status: RouteStatus
  verifiedAt?: number
  location?: RouteLocation
}

export interface RouteSeed {
  routeId?: string
  name: string
  carryMode: CarryMode
  location: RouteLocation
}

export interface CalibrationDraft {
  seed: RouteSeed
  samples: SensorSample[]
  frames: FeatureFrame[]
  markers: RouteMarker[]
  boundaries: number[]
  inferred: InferredRoute
  startedAt: number
  endedAt: number
  gaps: Array<{ startMs: number; endMs: number }>
  manualMarks: ManualMark[]
  // 垂直位移估算（基于加速度二次积分，单位 m）
  estimatedAscentM?: number
}

export interface RecognitionEvent {
  t: number
  type: 'floor' | 'turn' | 'pause' | 'resume' | 'gap'
  floor?: number
  direction?: TurnDirection
  confidence: number
}

export interface ClimbSession {
  id: string
  templateId: string
  templateVersion: number
  startedAt: number
  endedAt: number
  startFloor: number
  finalFloor: number
  floorsCompleted: number
  ascentM: number
  steps: number
  confidence: number
  complete: boolean
  events: RecognitionEvent[]
  floorSplits: Array<{ floor: number; atMs: number; elapsedMs: number }>
  interruptions: Array<{ startMs: number; endMs: number }>
  mode?: ClimbMode
  routeSnapshot?: {
    name: string
    locationName: string
    startFloor: number
    endFloor: number
    totalAscentM: number
  }
  durationMs?: number
  averageFloorMs?: number
  bestFloorSplitMs?: number
  sharePosterCreatedAt?: number
}

export interface RecognitionSnapshot {
  currentFloor: number
  floorsCompleted: number
  ascentM: number
  steps: number
  confidence: number
  status: 'matching' | 'low_confidence' | 'paused' | 'complete'
  lastTurn?: TurnDirection
}

// 爬楼路线图：基于人工楼层标记分段后的单层数据
export interface FloorSplit {
  floor: number                 // 该层楼层号
  startMs: number               // 该段起始时间（相对采集开始）
  endMs: number                 // 该段结束时间
  durationMs: number            // 该段用时
  stepCount: number             // 该段步数（自动检测）
  turnCount: number             // 该段拐弯次数（自动+人工）
  ascentM: number               // 该段爬升估算
}
