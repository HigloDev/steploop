import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, StyleSheet, View } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import { Image } from 'expo-image'
import { useReducedMotion } from 'react-native-reanimated'
import { AchievementBuilding } from './achievement-building'
import {
  getGlacierCompletionAssets,
  getGlacierCompletionHeightScale,
  GLACIER_FLIGHT_ASPECT,
  GLACIER_FLIGHT_DURATION_MS,
} from './glacier-completion-assets'
import { useTheme } from '../theme'
import { triggerHapticPattern } from '../services/preferences'
import { playCompletionSound } from '../services/completion-sound'

export function GlacierCompletionArt({ floors, fresh = false, size = 240, sound = false }: {
  floors: number
  fresh?: boolean
  size?: number
  sound?: boolean
}) {
  const theme = useTheme()
  const focused = useIsFocused()
  const reduced = useReducedMotion()
  const { motion, still } = getGlacierCompletionAssets(floors, theme.isDark)
  const initialMotion = useRef(motion)
  const [completed, setCompleted] = useState(!fresh || reduced)
  const [failedStill, setFailedStill] = useState<number | null>(null)
  const displayed = useRef(false)
  const feedbackConsumed = useRef(false)
  const generation = useRef(0)
  const stopAudio = useRef<(() => void) | undefined>(undefined)
  const cutoff = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const soundCue = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const running = fresh && focused && !completed && !reduced && motion === initialMotion.current

  const stop = useCallback(() => {
    generation.current += 1
    clearTimeout(cutoff.current)
    clearTimeout(soundCue.current)
    stopAudio.current?.()
    stopAudio.current = undefined
  }, [])

  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        feedbackConsumed.current = true
        setCompleted(true)
        stop()
      }
    })
    return () => {
      listener.remove()
      stop()
    }
  }, [stop])

  useEffect(() => {
    if (!focused || motion !== initialMotion.current) {
      feedbackConsumed.current = true
      setCompleted(true)
      stop()
    }
  }, [focused, motion, stop])

  function playFeedback() {
    const request = generation.current
    void triggerHapticPattern('goal_complete').catch(() => {})
    void playCompletionSound().then(release => {
      if (request === generation.current) stopAudio.current = release
      else release()
    }).catch(() => {})
  }

  function onDisplay() {
    if (running && !displayed.current) {
      displayed.current = true
      cutoff.current = setTimeout(() => setCompleted(true), GLACIER_FLIGHT_DURATION_MS + 40)
    }
    if (fresh && sound && focused && !feedbackConsumed.current) {
      feedbackConsumed.current = true
      if (running) soundCue.current = setTimeout(playFeedback, 1610)
      else playFeedback()
    }
  }

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`代表本次 ${floors} 层成绩的楼栋`}
      testID="glacier-completion-art"
      pointerEvents="none"
      style={{ width: size, height: size / GLACIER_FLIGHT_ASPECT, alignSelf: 'center' }}
    >
      <View style={[StyleSheet.absoluteFill, {
        transformOrigin: ['50%', '82.1%', 0],
        transform: [{ scaleY: getGlacierCompletionHeightScale(floors) }],
      }]}>
        {failedStill === still ? (
          <AchievementBuilding floors={floors} width={size * 0.65} />
        ) : (
          <Image
            accessible={false}
            source={running ? motion : still}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            autoplay={running}
            transition={0}
            onDisplay={onDisplay}
            onError={() => {
              if (running) setCompleted(true)
              else setFailedStill(still)
            }}
          />
        )}
      </View>
    </View>
  )
}
