import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import Svg, { Rect, Line } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme'
import { triggerHapticPattern } from '../services/preferences'
import { useReduceMotion } from './ui'
import { buildingProgress } from '../core/building-progress'
import { formatDuration } from '../core/math'
import { Button } from './ui'
import { recordWorkoutEvidenceEvent } from '../services/workout-evidence'

export function WorkoutCompleteCeremony({ totalFloors, completeRounds, totalAscentM, planLines, onDone, totalSteps, calories, activeMs, totalMs, workoutId }: {
  totalFloors: number; completeRounds: number; totalAscentM: number; planLines: string[]; onDone: () => void
  totalSteps?: number; calories?: number; activeMs?: number; totalMs?: number
  workoutId?: string
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const reduced = useReduceMotion()
  const [displayFloors, setDisplayFloors] = useState(0)
  const [replay, setReplay] = useState(0)
  const [animationDone, setAnimationDone] = useState(false)
  const [eventSaveError, setEventSaveError] = useState('')
  const finished = useRef(false)
  const hapticPlayed = useRef(false)
  const logAnimation = useCallback((name: string, detail: unknown) => {
    if (!workoutId) return
    const at = Date.now()
    recordWorkoutEvidenceEvent({ workoutId, roundNumber: completeRounds, phase: 'workout_complete', startedAt: at }, name, at, detail, setEventSaveError)
  }, [workoutId, completeRounds])
  const finish = useCallback(() => {
    if (!finished.current) {
      finished.current = true
      logAnimation('building_exit', { totalFloors, builtFloors: displayFloors, skipped: !animationDone })
      onDone()
    }
  }, [onDone, logAnimation, totalFloors, displayFloors, animationDone])

  useEffect(() => {
    if (!hapticPlayed.current) { hapticPlayed.current = true; void triggerHapticPattern('goal_complete').catch(() => undefined) }
    setAnimationDone(false)
    setDisplayFloors(0)
    logAnimation('building_started', { totalFloors, reducedMotion: reduced, replay })
    if (reduced) { setDisplayFloors(totalFloors); setAnimationDone(true); return }
    const started = Date.now()
    const counter = setInterval(() => {
      const progress = buildingProgress(totalFloors, Date.now() - started)
      setDisplayFloors(progress.built)
      if (progress.complete) { clearInterval(counter); setAnimationDone(true) }
    }, 60)
    return () => { clearInterval(counter) }
  }, [totalFloors, reduced, replay, logAnimation])

  const building = buildingProgress(displayFloors, 0, true)
  const floorHeight = Math.min(18, 280 / Math.max(1, Math.min(80, totalFloors)))
  const drawingHeight = Math.max(50, Math.min(80, totalFloors) * floorHeight + 24)
  const builtHeight = building.visibleFloors.length * floorHeight
  const roofY = drawingHeight - 10 - builtHeight

  return (
    <View style={{ flex: 1, backgroundColor: theme.paper, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: theme.pagePaddingH, paddingVertical: 32 }}>
        <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: '700', color: theme.ink, marginBottom: 8 }}>训练完成</Text>
        <Text style={{ color: theme.mutedStrong, fontSize: 14, lineHeight: 22, marginBottom: 24 }}>{totalFloors > 0 ? '把每一层，积累成今天的成果' : '训练已保存，本次没有确认爬升'}</Text>
        <Svg width={200} height={drawingHeight} accessible={false}>
          <Line x1={15} x2={185} y1={drawingHeight - 8} y2={drawingHeight - 8} stroke={theme.mutedStrong} strokeWidth={2} />
          {building.visibleFloors.map((floor, index) => {
            const y = drawingHeight - 10 - (index + 1) * floorHeight
            return <React.Fragment key={floor}>
              <Rect x={36} y={y} width={128} height={floorHeight} fill={floor === displayFloors ? theme.green : theme.greenSoft} />
              {[52, 82, 112, 142].map(x => <Rect key={x} x={x} y={y + floorHeight * 0.25} width={10} height={Math.max(1, floorHeight * 0.4)} fill={floor === displayFloors ? theme.onPrimary : theme.greenBright} opacity={0.65} />)}
            </React.Fragment>
          })}
          {builtHeight > 0 ? <>
            <Rect x={164} y={roofY} width={14} height={builtHeight} fill={theme.greenInk} opacity={0.24} />
            <Line x1={164} x2={164} y1={roofY} y2={drawingHeight - 10} stroke={theme.card} strokeWidth={1} />
            <Rect x={34} y={roofY - 3} width={146} height={4} rx={1.5} fill={theme.green} />
          </> : null}
        </Svg>
        <Text style={{ color: theme.mutedStrong, fontSize: 13, marginTop: 8 }}>{building.firstVisibleFloor > 1 ? `下方 ${building.firstVisibleFloor - 1} 层已建成 · ` : ''}已盖到第 {displayFloors} 层</Text>
        <View accessible accessibilityLabel={`完成 ${totalFloors} 层，${completeRounds} 轮`} style={{ alignItems: 'center', marginTop: 20 }}>
          <Text style={{ color: theme.greenInk, fontSize: 64, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{reduced ? totalFloors : displayFloors}<Text style={{ fontSize: 22, fontWeight: '400', color: theme.mutedStrong }}> 层</Text></Text>
          <Text style={{ color: theme.mutedStrong, fontSize: 14, marginTop: 4 }}>累计实际爬升</Text>
        </View>
        <Text style={{ color: theme.mutedStrong, marginTop: 12, fontSize: 14 }}>{completeRounds} 轮 · {totalAscentM.toFixed(1)} 米</Text>
        {totalSteps !== undefined && <Text style={{ color: theme.ink, marginTop: 8 }}>{totalSteps} 步 · 估算 {Math.round(calories ?? 0)} 千卡</Text>}
        {activeMs !== undefined && <Text style={{ color: theme.mutedStrong, marginTop: 8 }}>净爬楼 {formatDuration(activeMs)} · 总时间 {formatDuration(totalMs ?? 0)}</Text>}
        {planLines.map((line, index) => <Text key={`${index}-${line}`} style={{ color: theme.mutedStrong, textAlign: 'center', marginTop: 12, fontSize: 14 }}>{line}</Text>)}
        {eventSaveError ? <Text style={{ color: theme.amberInk, fontSize: 13, marginTop: 12 }}>{eventSaveError}</Text> : null}
      </ScrollView>
      <View style={{ backgroundColor: theme.card, paddingHorizontal: theme.pagePaddingH, paddingTop: 8, paddingBottom: insets.bottom + 12, borderTopWidth: 0.5, borderTopColor: theme.lineSoft }}>
        {animationDone && !reduced && <Button title="重播盖楼动画" variant="secondary" onPress={() => setReplay(value => value + 1)} />}
        <Button title={animationDone || reduced ? '查看训练结果' : '跳过动画，查看结果'} accessibilityLabel={animationDone || reduced ? '查看训练结果' : '跳过完成动画'} onPress={finish} />
      </View>
    </View>
  )
}
