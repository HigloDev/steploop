import React, { useEffect, useRef } from 'react'
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { isMotionRing, typography, useTheme } from '../theme'
import { GlassBackdrop } from './glass-material'
import { GlacierCompletionArt } from './glacier-completion'
import { MotionBrandBadge, MotionCompletionHalo } from './motion-ring-graphics'
import { BrandMark } from './brand-mark'

/** 结算盖楼预览弹窗：与真实结算页共用同一套动画与封顶音效节拍（1610ms）。 */
export function CompletionCelebration({
  floors,
  ascentM,
  onDone,
  preview = false,
}: {
  floors: number
  ascentM: number
  onDone: () => void
  preview?: boolean
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    const limit = setTimeout(() => doneRef.current(), reduced ? 3200 : 4800)
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      doneRef.current()
      return true
    })
    return () => {
      clearTimeout(limit)
      back.remove()
    }
  }, [reduced])

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        {
          zIndex: 100,
          backgroundColor: theme.paper,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 16,
          paddingHorizontal: 28,
        },
      ]}
    >
      <GlassBackdrop />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {isMotionRing(theme) ? (
          <MotionBrandBadge size={34}>
            <BrandMark size={19} color="#FFFFFF" />
          </MotionBrandBadge>
        ) : (
          <BrandMark size={28} color={theme.brandText} />
        )}
        <Text style={{ color: theme.ink, fontSize: 19, fontWeight: '800' }}>循阶</Text>
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
        <Text accessibilityRole="header" style={{ color: theme.brandInk, fontSize: 16, fontWeight: '700', letterSpacing: 2 }}>
          每一步，都在筑高
        </Text>
        <MotionCompletionHalo size={220} reducedMotion={reduced}>
          <GlacierCompletionArt floors={floors} size={220} fresh sound />
        </MotionCompletionHalo>
        <View
          style={{ alignItems: 'center', gap: 8 }}
          accessible
          accessibilityLabel={
            preview
              ? '盖楼结算预览，不生成训练记录'
              : `训练完成，已保存 ${floors} 层，爬升 ${Math.round(ascentM)} 米`
          }
        >
          <Text style={{ ...typography.title, color: theme.ink, textAlign: 'center' }}>
            {preview ? '一步一步，筑起一栋楼' : `你又向上了 ${floors} 层`}
          </Text>
          <Text style={{ ...typography.body, color: theme.inkSoft, textAlign: 'center' }}>
            {preview ? '示例效果 · 不生成训练记录' : `累计爬升 ${Math.round(ascentM)} 米 · 成绩已保存`}
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={preview ? '结束结算预览' : '查看本次成绩'}
        onPress={() => doneRef.current()}
        style={{ minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.md, backgroundColor: theme.brand }}
      >
        <Text style={{ ...typography.control, color: theme.onBrand }}>{preview ? '结束预览' : '查看成绩'}</Text>
      </Pressable>
    </View>
  )
}
