import React, { useEffect, useRef, useState } from 'react'
import { Text, View } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import { NativeChoice } from './native-choice'
import { Button } from './ui'
import { VOICE_SPEAKERS, VoiceSpeaker, normalizeVoiceSpeaker } from '../core/voice-speaker'
import { createWorkoutVoiceService, WorkoutVoiceService } from '../services/voice-feedback'
import { workoutVoiceSettings } from '../services/workout-voice-settings'
import type { Preferences } from '../services/preferences'
import { useTheme } from '../theme'

export function VoiceSpeakerSelector({ prefs, onChange }: {
  prefs: Preferences | null; onChange: (speaker: VoiceSpeaker) => void
}) {
  const theme = useTheme()
  const focused = useIsFocused()
  const active = useRef<WorkoutVoiceService | null>(null)
  const [playing, setPlaying] = useState(false)
  const [message, setMessage] = useState('')
  const speaker = normalizeVoiceSpeaker(prefs?.voiceSpeaker)
  useEffect(() => {
    if (focused) { setPlaying(false); setMessage('') }
    return () => {
      const service = active.current
      active.current = null
      if (service) void service.dispose()
    }
  }, [focused])

  async function preview() {
    if (!prefs) return
    if (active.current) {
      const service = active.current
      active.current = null
      await service.dispose()
      setPlaying(false)
      return
    }
    setMessage('')
    setPlaying(true)
    const service = createWorkoutVoiceService({ persistJournal: false, settings: {
      ...workoutVoiceSettings(prefs), speaker, enabled: true, detailMode: 'standard', nightQuiet: false,
    } })
    active.current = service
    const at = Date.now()
    service.enqueue([{ id: 'voice-preview', workoutId: 'voice-preview', kind: 'round_finished',
      at, expiresAt: at + 60000, priority: 100, numbers: { roundNumber: 2, floors: 14 } }])
    await service.waitUntilIdle()
    if (active.current !== service) return
    const result = service.getJournal().at(-1)
    setMessage(result?.outcome === 'played' ? '' : result?.outcome === 'suppressed'
      ? '试听未播放，请检查蓝牙连接或音乐播放设置。'
      : prefs.voiceVolume === 0 ? '请先调高播报音量。' : '试听未能播放，请确认已安装包含四种音色的新版应用。')
    await service.dispose()
    if (active.current === service) { active.current = null; setPlaying(false) }
  }
  return <View style={{ paddingVertical: 12, gap: 10 }}>
    <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '600' }}>播报音色</Text>
    <NativeChoice testID="voice-speaker" options={VOICE_SPEAKERS.map(item => ({ ...item }))}
      value={speaker} disabled={!prefs || playing} onChange={value => { setMessage(''); onChange(value) }} />
    <Text style={{ color: theme.mutedStrong, fontSize: 13, lineHeight: 20 }}>两种男声、两种女声，提示和数字均可离线播放。</Text>
    <Button title={playing ? '停止试听' : '试听当前音色'} variant="secondary" disabled={!prefs} onPress={() => { void preview() }} />
    {message ? <Text accessibilityLiveRegion="polite" style={{ color: theme.amberInk, fontSize: 13 }}>{message}</Text> : null}
  </View>
}
