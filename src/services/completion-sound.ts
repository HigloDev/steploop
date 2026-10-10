import { createAudioPlayer, setAudioModeAsync } from 'expo-audio'
import { AppState } from 'react-native'
import { getPreferences } from './preferences'

const CHIME = require('../../assets/audio/building-complete.wav')

/** 本地合成的柔和五音铃声；播放结束和页面退出都释放播放器。 */
export async function playCompletionSound(onFinished?: () => void): Promise<() => void> {
  const prefs = await getPreferences()
  const hour = new Date().getHours()
  if (!prefs.completionSound || (prefs.voiceNightQuiet && (hour >= 22 || hour < 7)) || AppState.currentState !== 'active') { onFinished?.(); return () => {} }
  let player: ReturnType<typeof createAudioPlayer> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let subscription: { remove(): void } | undefined
  let cleaned = false
  let loaded = false
  const stop = () => {
    if (cleaned) return
    cleaned = true
    if (timer) clearTimeout(timer)
    subscription?.remove()
    try { player?.pause(); player?.release() } catch { /* 页面已关闭时忽略。 */ }
  }
  try {
    await setAudioModeAsync({ playsInSilentMode: false, shouldPlayInBackground: false, interruptionMode: 'mixWithOthers', allowsRecording: false })
    player = createAudioPlayer(CHIME, { updateInterval: 100 })
    player.volume = 0.55
    subscription = player.addListener('playbackStatusUpdate', status => {
      if (status.isLoaded && !loaded) { loaded = true; if (__DEV__) console.info('[completion-sound] loaded') }
      if (status.didJustFinish) { console.info('[completion-sound] finished'); stop(); onFinished?.() }
    })
    player.play()
    timer = setTimeout(() => { stop(); onFinished?.() }, 6000)
  } catch { stop(); onFinished?.() }
  return stop
}
