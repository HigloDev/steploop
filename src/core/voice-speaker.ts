export const VOICE_SPEAKERS = [
  { value: 'uncle_fu', label: '沉稳男声', name: 'Uncle_Fu' },
  { value: 'dylan', label: '年轻男声', name: 'Dylan' },
  { value: 'serena', label: '温柔女声', name: 'Serena' },
  { value: 'vivian', label: '明亮女声', name: 'Vivian' },
] as const

export type VoiceSpeaker = typeof VOICE_SPEAKERS[number]['value']
export const DEFAULT_VOICE_SPEAKER: VoiceSpeaker = 'serena'
export function normalizeVoiceSpeaker(value: unknown): VoiceSpeaker {
  return VOICE_SPEAKERS.some(speaker => speaker.value === value) ? value as VoiceSpeaker : DEFAULT_VOICE_SPEAKER
}
