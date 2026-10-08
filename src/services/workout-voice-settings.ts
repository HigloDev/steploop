import type { VoiceSettings } from '../core/voice-config'
import type { Preferences } from './preferences'
import { normalizeVoiceSpeaker } from '../core/voice-speaker'

export type VoiceModeChoice = 'concise' | 'standard' | 'coach' | 'off'

export function voiceModeChoice(prefs: Pick<Preferences, 'voiceEnabled' | 'voiceMode'>): VoiceModeChoice {
  if (prefs.voiceEnabled === false) return 'off'
  return prefs.voiceMode === 'concise' || prefs.voiceMode === 'coach' ? prefs.voiceMode : 'standard'
}

export function voiceModePreferences(value: VoiceModeChoice): Partial<Preferences> {
  return value === 'off' ? { voiceEnabled: false } : { voiceEnabled: true, voiceMode: value }
}

/** Settings and training use the same persisted options and event switches. */
export function workoutVoiceSettings(prefs: Preferences): Partial<VoiceSettings> {
  return {
    speaker: normalizeVoiceSpeaker(prefs.voiceSpeaker),
    enabled: prefs.voiceEnabled !== false,
    volume: prefs.voiceVolume ?? 0.85,
    detailMode: prefs.voiceMode ?? 'standard',
    rate: prefs.voiceRate ?? 1,
    bluetoothOnly: prefs.voiceBluetoothOnly === true,
    nightQuiet: prefs.voiceNightQuiet === true,
    duckMusic: prefs.voiceDuckMusic !== false,
    encouragementEnabled: prefs.voiceEncouragement !== false,
    eventEnabled: {
      calorie_milestone: prefs.voiceCalories !== false,
      step_milestone: prefs.voiceSteps !== false,
      floor_milestone: prefs.voiceFloors !== false,
    },
  }
}
