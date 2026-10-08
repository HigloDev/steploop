import voiceTemplateDocument from './voice-templates.json'
import voiceMilestoneDocument from './voice-milestones.json'
import { VoiceSpeaker, normalizeVoiceSpeaker, DEFAULT_VOICE_SPEAKER } from './voice-speaker'

export const VOICE_MILESTONE_CONFIG_VERSION = voiceMilestoneDocument.version

/** Voice content is a versioned, replaceable library of recorded IDs and numeric slots. */
export type VoiceEventKind =
  | 'time_milestone'
  | 'calorie_milestone'
  | 'step_milestone'
  | 'floor_milestone'
  | 'rest_reminder'
  | 'round_finished'
  | 'elevator_descending'
  | 'returned_to_start'
  | 'round_started'
  | 'workout_finished'
  | 'correction'

export type VoiceDetailMode = 'concise' | 'standard' | 'coach'
export type VoiceNumberSlot = 'minutes' | 'calories' | 'roundNumber' | 'floors' | 'floor' | 'steps'
export type VoiceSegment =
  | { kind: 'clip'; id: string }
  | { kind: 'number'; value: string }
export type VoiceTemplatePart =
  | { kind: 'clip'; id: string }
  | { kind: 'number'; slot: VoiceNumberSlot }
  | { kind: 'encouragement'; pool: string[] }
export interface VoiceTemplate {
  id?: string
  parts: VoiceTemplatePart[]
  /** Read confirmed arrival in the same round announcement when recognition was corrected. */
  confirmedFloorParts?: VoiceTemplatePart[]
  priority: number
  expiresAfterMs: number
}

export interface VoiceTemplateLibrary {
  id: string
  version: string
  templates: Record<VoiceEventKind, VoiceTemplate>
}

const EVENT_KINDS: VoiceEventKind[] = [
  'time_milestone', 'calorie_milestone', 'step_milestone', 'floor_milestone', 'rest_reminder',
  'round_finished', 'elevator_descending', 'returned_to_start', 'round_started', 'workout_finished', 'correction',
]
const NUMBER_SLOTS: VoiceNumberSlot[] = ['minutes', 'calories', 'roundNumber', 'floors', 'floor', 'steps']
const CLIP_ID = /^[a-z0-9_]{1,80}$/

function parseTemplate(value: unknown): VoiceTemplate {
  if (!value || typeof value !== 'object') throw new Error('Invalid voice template')
  const item = value as Partial<VoiceTemplate>
  if (!Number.isFinite(item.priority) || item.priority! < 0 || item.priority! > 100 ||
      !Number.isFinite(item.expiresAfterMs) || item.expiresAfterMs! < 1000 || item.expiresAfterMs! > 120_000 ||
      !Array.isArray(item.parts) || item.parts.length === 0 || item.parts.length > 40 ||
      (item.id !== undefined && (typeof item.id !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(item.id)))) {
    throw new Error('Invalid voice template properties')
  }
  function parseParts(parts: VoiceTemplatePart[]): VoiceTemplatePart[] {
    return parts.map((part): VoiceTemplatePart => {
      if (!part || typeof part !== 'object') throw new Error('Invalid voice template part')
      if (part.kind === 'clip' && typeof part.id === 'string' && CLIP_ID.test(part.id)) return { ...part }
      if (part.kind === 'number' && NUMBER_SLOTS.includes(part.slot)) return { ...part }
      if (part.kind === 'encouragement' && Array.isArray(part.pool) && part.pool.length > 0 && part.pool.length <= 20 &&
          part.pool.every((id) => typeof id === 'string' && CLIP_ID.test(id))) return { kind: 'encouragement', pool: [...part.pool] }
      throw new Error('Voice templates accept recorded clip IDs and numeric slots only')
    })
  }
  if (item.confirmedFloorParts !== undefined && (!Array.isArray(item.confirmedFloorParts) ||
      item.confirmedFloorParts.length + item.parts.length > 40)) throw new Error('Invalid confirmed-floor voice template')
  return {
    id: item.id, priority: Math.round(item.priority!), expiresAfterMs: Math.round(item.expiresAfterMs!),
    parts: parseParts(item.parts), confirmedFloorParts: item.confirmedFloorParts && parseParts(item.confirmedFloorParts),
  }
}

/** Validate an imported replacement before activating it. No arbitrary sentence can reach TTS. */
export function parseVoiceTemplateLibrary(value: unknown): VoiceTemplateLibrary {
  if (!value || typeof value !== 'object') throw new Error('Invalid voice library')
  const item = value as Partial<VoiceTemplateLibrary>
  if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(item.id) ||
      typeof item.version !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(item.version) ||
      !item.templates || typeof item.templates !== 'object') throw new Error('Invalid voice library metadata')
  const templates = Object.fromEntries(EVENT_KINDS.map((kind) => [kind, parseTemplate(item.templates![kind])])) as Record<VoiceEventKind, VoiceTemplate>
  return { id: item.id, version: item.version, templates }
}

export const DEFAULT_VOICE_LIBRARY = parseVoiceTemplateLibrary(voiceTemplateDocument)
/** Compatibility accessor; editable content lives in voice-templates.json. */
export const VOICE_TEMPLATE_LIBRARY = DEFAULT_VOICE_LIBRARY.templates

export interface VoiceSettings {
  speaker: VoiceSpeaker
  enabled: boolean
  volume: number
  detailMode: VoiceDetailMode
  rate: number
  bluetoothOnly: boolean
  duckMusic: boolean
  nightQuiet: boolean
  encouragementEnabled: boolean
  timeMilestonesMinutes: number[]
  calorieMilestones: number[]
  stepMilestones: number[]
  floorMilestones: number[]
  /** Extend floor thresholds past the configured last milestone; zero disables extension. */
  floorMilestoneInterval: number
  restReminderMinutes: number
  eventEnabled: Partial<Record<VoiceEventKind, boolean>>
  templateLibrary?: VoiceTemplateLibrary
  templateOverrides?: Partial<Record<VoiceEventKind, VoiceTemplate>>
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  speaker: DEFAULT_VOICE_SPEAKER,
  enabled: true,
  volume: 0.9,
  detailMode: 'standard',
  rate: 1,
  bluetoothOnly: false,
  duckMusic: true,
  nightQuiet: false,
  encouragementEnabled: true,
  timeMilestonesMinutes: [...voiceMilestoneDocument.timeMilestonesMinutes],
  calorieMilestones: [...voiceMilestoneDocument.calorieMilestones],
  stepMilestones: [...voiceMilestoneDocument.stepMilestones],
  floorMilestones: [...voiceMilestoneDocument.floorMilestones],
  floorMilestoneInterval: voiceMilestoneDocument.floorMilestoneInterval,
  restReminderMinutes: voiceMilestoneDocument.restReminderMinutes,
  eventEnabled: {},
}

function milestones(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return [...fallback]
  return [...new Set(value.filter((item): item is number =>
    typeof item === 'number' && Number.isFinite(item) && item > 0 && item <= 999_999,
  ).map(Math.round).filter((item) => item > 0))].sort((a, b) => a - b)
}

export function normalizeVoiceSettings(settings: Partial<VoiceSettings> = {}): VoiceSettings {
  return {
    speaker: normalizeVoiceSpeaker(settings.speaker),
    enabled: settings.enabled ?? DEFAULT_VOICE_SETTINGS.enabled,
    volume: Number.isFinite(settings.volume)
      ? Math.max(0, Math.min(1, settings.volume!))
      : DEFAULT_VOICE_SETTINGS.volume,
    detailMode: settings.detailMode === 'concise' || settings.detailMode === 'coach' ? settings.detailMode : 'standard',
    rate: Number.isFinite(settings.rate)
      ? [0.8, 1, 1.2].reduce((nearest, rate) => Math.abs(rate - settings.rate!) < Math.abs(nearest - settings.rate!) ? rate : nearest, 1)
      : DEFAULT_VOICE_SETTINGS.rate,
    bluetoothOnly: settings.bluetoothOnly ?? DEFAULT_VOICE_SETTINGS.bluetoothOnly,
    duckMusic: settings.duckMusic ?? DEFAULT_VOICE_SETTINGS.duckMusic,
    nightQuiet: settings.nightQuiet ?? DEFAULT_VOICE_SETTINGS.nightQuiet,
    encouragementEnabled: settings.encouragementEnabled ?? DEFAULT_VOICE_SETTINGS.encouragementEnabled,
    timeMilestonesMinutes: milestones(settings.timeMilestonesMinutes, DEFAULT_VOICE_SETTINGS.timeMilestonesMinutes),
    calorieMilestones: milestones(settings.calorieMilestones, DEFAULT_VOICE_SETTINGS.calorieMilestones),
    stepMilestones: milestones(settings.stepMilestones, DEFAULT_VOICE_SETTINGS.stepMilestones),
    floorMilestones: milestones(settings.floorMilestones, DEFAULT_VOICE_SETTINGS.floorMilestones),
    floorMilestoneInterval: Number.isFinite(settings.floorMilestoneInterval)
      ? Math.max(0, Math.min(999_999, Math.round(settings.floorMilestoneInterval!))) : DEFAULT_VOICE_SETTINGS.floorMilestoneInterval,
    restReminderMinutes: Number.isFinite(settings.restReminderMinutes)
      ? Math.max(1, Math.min(60, Math.round(settings.restReminderMinutes!))) : DEFAULT_VOICE_SETTINGS.restReminderMinutes,
    eventEnabled: { ...settings.eventEnabled },
    templateLibrary: settings.templateLibrary,
    templateOverrides: settings.templateOverrides,
  }
}

export function getVoiceTemplate(kind: VoiceEventKind, settings: VoiceSettings): VoiceTemplate {
  return settings.templateOverrides?.[kind] ?? (settings.templateLibrary ?? DEFAULT_VOICE_LIBRARY).templates[kind]
}

export function voiceEventAllowed(kind: VoiceEventKind, settings: VoiceSettings): boolean {
  if (!settings.enabled || settings.eventEnabled[kind] === false) return false
  if (settings.detailMode === 'concise') return kind === 'round_finished' || kind === 'returned_to_start' || kind === 'workout_finished'
  if (settings.detailMode === 'standard') return kind !== 'step_milestone' && kind !== 'floor_milestone' && kind !== 'rest_reminder'
  return true
}

/** Quiet hours use the phone's local timezone, including changes while training. */
export function isVoiceNightQuiet(settings: VoiceSettings, at: number): boolean {
  const hour = new Date(at).getHours()
  return settings.nightQuiet && (hour >= 22 || hour < 7)
}

export function buildVoiceSegments(
  kind: VoiceEventKind,
  numbers: Partial<Record<VoiceNumberSlot, number>>,
  settings: VoiceSettings,
  encouragementIndex = 0,
  previousEncouragementId?: string,
): VoiceSegment[] {
  const template = getVoiceTemplate(kind, settings)
  const segments: VoiceSegment[] = []
  const parts = [...template.parts, ...(numbers.floor !== undefined ? template.confirmedFloorParts ?? [] : [])]
  for (const part of parts) {
    if (part.kind === 'clip') {
      segments.push({ kind: 'clip', id: part.id })
      continue
    }
    if (part.kind === 'encouragement') {
      if (settings.encouragementEnabled && settings.detailMode !== 'concise') {
        const pool = part.pool.length > 1 ? part.pool.filter((id) => id !== previousEncouragementId) : part.pool
        segments.push({ kind: 'clip', id: pool[Math.abs(Math.trunc(encouragementIndex)) % pool.length] })
      }
      continue
    }
    const value = numbers[part.slot]
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 999_999) {
      throw new Error(`Invalid numeric voice slot: ${part.slot}`)
    }
    // Values are rounded for speech. Raw training precision stays in the record.
    segments.push({ kind: 'number', value: String(Math.round(value)) })
  }
  return segments
}

/** Deterministic Chinese number pack for devices without a usable Chinese TTS voice. */
export function recordedNumberClipIds(value: string): string[] {
  if (!/^-?\d{1,6}(\.\d{1,2})?$/.test(value)) throw new Error('Voice accepts numeric tokens only')
  const negative = value.startsWith('-')
  const [integer, fraction] = (negative ? value.slice(1) : value).split('.')
  const number = Number(integer)
  const ids: string[] = negative ? ['n_minus'] : []
  function group(input: number, omitLeadingOne: boolean): string[] {
    if (input === 0) return ['n0']
    const out: string[] = []
    let zero = false
    for (const unit of [1000, 100, 10, 1]) {
      const digit = Math.floor(input / unit) % 10
      if (digit === 0) {
        if (out.length > 0) zero = true
        continue
      }
      if (zero) out.push('n0')
      zero = false
      if (!(unit === 10 && digit === 1 && out.length === 0 && omitLeadingOne)) out.push(`n${digit}`)
      if (unit > 1) out.push(`n${unit}`)
    }
    return out
  }
  if (number >= 10_000) {
    ids.push(...group(Math.floor(number / 10_000), true), 'n10000')
    const rest = number % 10_000
    if (rest > 0) {
      if (rest < 1000) ids.push('n0')
      ids.push(...group(rest, false))
    }
  } else {
    ids.push(...group(number, true))
  }
  if (fraction) ids.push('n_point', ...fraction.split('').map((digit) => `n${digit}`))
  return ids
}
