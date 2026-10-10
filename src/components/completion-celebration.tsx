import React, { useEffect, useRef } from 'react'
import { AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme'
import { triggerHapticPattern } from '../services/preferences'
import { playCompletionSound } from '../services/completion-sound'
import { AchievementBuilding } from './achievement-building'
import { BrandMark } from './brand-mark'

export function CompletionCelebration({ floors, ascentM, onDone, preview = false }: { floors: number; ascentM: number; onDone: () => void; preview?: boolean }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  useEffect(() => {
    let cancelled = false
    let animationDone = false
    let audioDone = false
    let stopSound: (() => void) | undefined
    const maybeDone = () => { if (!cancelled && animationDone && audioDone) doneRef.current() }
    void triggerHapticPattern('goal_complete')
    void playCompletionSound(() => { audioDone = true; maybeDone() })
      .then(stop => { if (cancelled) stop(); else stopSound = stop })
      .catch(() => { audioDone = true; maybeDone() })
    const timer = setTimeout(() => { animationDone = true; maybeDone() }, reduced ? 3000 : 3200)
    const limit = setTimeout(() => doneRef.current(), 6500)
    const back = BackHandler.addEventListener('hardwareBackPress', () => { doneRef.current(); return true })
    const state = AppState.addEventListener('change', next => { if (next !== 'active') stopSound?.() })
    return () => { cancelled = true; clearTimeout(timer); clearTimeout(limit); stopSound?.(); back.remove(); state.remove() }
  }, [reduced])
  return <View style={[StyleSheet.absoluteFill, { zIndex: 100, backgroundColor: theme.paper, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16, paddingHorizontal: 28 }]}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><BrandMark size={28} color={theme.brand} /><Text style={{ color: theme.ink, fontSize: 19, fontWeight: '900' }}>循阶</Text></View>
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
      <Text accessibilityRole="header" style={{ color: theme.brandInk, fontSize: 16, fontWeight: '800', letterSpacing: 2 }}>每一步，都在筑高</Text>
      <AchievementBuilding floors={floors} width={220} animate reducedMotion={reduced} />
      <View style={{ alignItems: 'center', gap: 8 }} accessible accessibilityLabel={preview ? '盖楼结算预览，不生成训练记录' : `训练完成，已保存 ${floors} 层，爬升 ${Math.round(ascentM)} 米`}>
        <Text style={{ color: theme.ink, fontSize: 28, fontWeight: '900' }}>{preview ? '一步一步，筑起一栋楼' : `你又向上了 ${floors} 层`}</Text>
        <Text style={{ color: theme.inkSoft, fontSize: 16 }}>{preview ? '示例效果 · 不生成训练记录' : `累计爬升 ${Math.round(ascentM)} 米 · 成绩已保存`}</Text>
      </View>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={preview ? '结束结算预览' : '查看本次成绩'} onPress={() => doneRef.current()}
      style={{ minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: theme.brand }}>
      <Text style={{ color: theme.onBrand, fontSize: 17, fontWeight: '900' }}>{preview ? '结束预览' : '查看成绩'}</Text>
    </Pressable>
  </View>
}
