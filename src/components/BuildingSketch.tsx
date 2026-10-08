// 大楼剖面简笔画可视化器：把抽象的「楼层 + 拐弯 + 当前进度」合成成一张
// 正在长高的大楼图像。
//
// 事件 → 图形映射（与用户对齐过的方案）：
// - 完成一段楼层（人工标记 + 气压自动检测，任一触发）→ 该层填充确认色 + 打勾
// - 检测到拐弯（自动陀螺仪 + 人工标记，都算）→ 楼梯井内追加一节楼梯段
// - 正在爬楼层（实时状态）→ 当前层高亮 + 顶部光标上下浮动动画
//
// 同时服务两个场景：
// 1. Calibrate 采集页：实时驱动，floors 由 buildRealtimeFloors 组装
// 2. Review 复核页：基于 floorSplits 回放，floors 由 buildPlaybackFloors 组装

import React, { memo, useEffect, useRef } from 'react'
import { Animated, StyleSheet, Text, View, ViewStyle } from 'react-native'

import { useTheme, Theme } from '../theme'
import { FloorSplit } from '../core/types'

export type FloorStatus = 'completed' | 'current' | 'pending'

export interface BuildingFloor {
  floor: number             // 楼层号（如 1、2、3）
  turnSegments: number      // 该楼层楼梯井里的楼梯段数（拐弯事件次数）
  status: FloorStatus
}

interface BuildingSketchProps {
  floors: BuildingFloor[]
  // 是否在当前层显示「正在向上爬」的光标动画；Review 回放时传 false
  climbing?: boolean
  style?: ViewStyle
  floorHeight?: number
}

const FLOOR_HEIGHT = 52           // 单层楼层带高度
const ROOF_HEIGHT = 24            // 屋顶高度
const BUILDING_WIDTH = 220        // 大楼主体宽度
const STAIR_TREAD_W = 12          // 单段楼梯踏面宽度
const STAIR_RISER_H = 10          // 单段楼梯立面高度
const MAX_VISIBLE_TURNS = 8       // 单层最多画出段数，超出显示 +N

// 单层楼梯段：踏面 + 立面 组成一段折线，多段累加自然形成楼梯
function StairSegment({ color }: { color: string }) {
  return (
    <View style={styles.stairSegment}>
      <View style={[styles.stairTread, { backgroundColor: color }]} />
      <View style={[styles.stairRiser, { backgroundColor: color }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  stairSegment: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  stairTread: {
    width: STAIR_TREAD_W,
    height: 2,
  },
  stairRiser: {
    width: 2,
    height: STAIR_RISER_H,
  },
})

export const BuildingSketch = memo(function BuildingSketch({
  floors,
  climbing = false,
  style,
  floorHeight = FLOOR_HEIGHT,
}: BuildingSketchProps) {
  const theme = useTheme()
  const ts = makeStyles(theme)
  const cursorAnim = useRef(new Animated.Value(0)).current

  // 当前层的向上光标动画：上下浮动 + 透明度脉动
  useEffect(() => {
    if (!climbing) {
      cursorAnim.stopAnimation()
      cursorAnim.setValue(0)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(cursorAnim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(cursorAnim, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [climbing, cursorAnim])

  // 楼层从上到下渲染（顶楼在上方，符合视觉直觉）
  const reversed = [...floors].reverse()

  return (
    <View style={[ts.building, style]}>
      {/* 屋顶：用三角形 border 模拟 */}
      <View style={ts.roof} />

      {/* 大楼主体 */}
      <View style={ts.body}>
        {reversed.map((f) => {
          const isCurrent = f.status === 'current'
          const isCompleted = f.status === 'completed'
          const isPending = f.status === 'pending'
          const visibleTurns = Math.min(f.turnSegments, MAX_VISIBLE_TURNS)
          const overflow = Math.max(0, f.turnSegments - MAX_VISIBLE_TURNS)
          // 楼梯段颜色：已完成层用主绿色，当前层用 amber 强调，未到达层灰显
          const stairColor = isPending
            ? theme.line
            : isCurrent
              ? theme.amber
              : theme.greenInk

          return (
            <View
              key={f.floor}
              style={[
                ts.floor,
                { height: floorHeight },
                isCompleted && ts.floorCompleted,
                isCurrent && ts.floorCurrent,
                isPending && ts.floorPending,
              ]}
            >
              {/* 楼层号 */}
              <View style={ts.floorLabel}>
                <Text
                  style={[
                    ts.floorLabelText,
                    isPending && ts.floorLabelTextPending,
                    isCurrent && ts.floorLabelTextCurrent,
                  ]}
                >
                  {f.floor}层
                </Text>
              </View>

              {/* 楼梯井：横向排列的楼梯段 */}
              <View style={ts.stairWell}>
                {Array.from({ length: visibleTurns }).map((_, i) => (
                  <StairSegment key={i} color={stairColor} />
                ))}
                {overflow > 0 ? (
                  <Text style={ts.overflowText}>+{overflow}</Text>
                ) : null}
              </View>

              {/* 状态标记 */}
              <View style={ts.statusBox}>
                {isCompleted ? (
                  <Text style={ts.statusDone}>✓</Text>
                ) : isCurrent ? (
                  <Animated.View
                    style={[
                      ts.cursor,
                      {
                        transform: [
                          {
                            translateY: cursorAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [4, -6],
                            }),
                          },
                        ],
                        opacity: cursorAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.4, 1],
                        }),
                      },
                    ]}
                  />
                ) : (
                  <Text style={ts.statusPending}>·</Text>
                )}
              </View>
            </View>
          )
        })}
      </View>
    </View>
  )
})

// 实时场景：Calibrate 采集页调用
// 已完成段（completed）= startFloor 到 currentFloor - 1
// 当前段（current）= currentFloor
// 预留段（pending）= currentFloor + 1 到 currentFloor + lookAhead
// 拐弯段总数按已完成楼层均分，余数归到最顶层已完成层
export function buildRealtimeFloors(
  startFloor: number,
  currentFloor: number,
  totalTurns: number,
  lookAhead = 2,
  maxVisibleFloors?: number,
): BuildingFloor[] {
  const completedCount = Math.max(0, currentFloor - startFloor)
  const floors: BuildingFloor[] = []

  const base = completedCount > 0 ? Math.floor(totalTurns / completedCount) : 0
  const remainder = completedCount > 0 ? totalTurns % completedCount : totalTurns

  let visibleCompleted = completedCount
  let completedStart = startFloor
  if (maxVisibleFloors !== undefined && maxVisibleFloors > 0) {
    const reserved = 1 + Math.max(0, lookAhead)
    const maxCompleted = Math.max(1, maxVisibleFloors - reserved)
    if (completedCount > maxCompleted) {
      visibleCompleted = maxCompleted
      completedStart = currentFloor - maxCompleted
    }
  }

  for (let i = 0; i < visibleCompleted; i++) {
    const floorNum = completedStart + i
    floors.push({
      floor: floorNum,
      turnSegments: base + (floorNum === currentFloor - 1 ? remainder : 0),
      status: 'completed',
    })
  }

  floors.push({
    floor: currentFloor,
    turnSegments: 0,
    status: 'current',
  })

  for (let i = 1; i <= lookAhead; i++) {
    floors.push({
      floor: currentFloor + i,
      turnSegments: 0,
      status: 'pending',
    })
  }

  return floors
}

// 回放场景：Review 复核页调用
// 全部 floorSplits 显示为已完成层；如 splits 非空，追加一个「终点楼层」标记
export function buildPlaybackFloors(splits: FloorSplit[]): BuildingFloor[] {
  if (splits.length === 0) return []
  const floors: BuildingFloor[] = splits.map((s) => ({
    floor: s.floor,
    turnSegments: s.turnCount,
    status: 'completed',
  }))
  // 追加终点楼层（最后一段的 floor + 1）作为已抵达标记
  const lastFloor = splits[splits.length - 1].floor + 1
  floors.push({
    floor: lastFloor,
    turnSegments: 0,
    status: 'completed',
  })
  return floors
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    building: {
      alignItems: 'center',
    },
    roof: {
      width: 0,
      height: 0,
      borderLeftWidth: BUILDING_WIDTH / 2,
      borderRightWidth: BUILDING_WIDTH / 2,
      borderBottomWidth: ROOF_HEIGHT,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      borderBottomColor: theme.green,
    },
    body: {
      width: BUILDING_WIDTH,
      borderWidth: 2,
      borderColor: theme.green,
      borderRadius: 4,
      overflow: 'hidden',
      backgroundColor: theme.card,
    },
    floor: {
      height: FLOOR_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    floorCompleted: {
      backgroundColor: theme.greenSoft,
    },
    floorCurrent: {
      backgroundColor: theme.amberSoft,
    },
    floorPending: {
      backgroundColor: theme.card,
      opacity: 0.55,
    },
    floorLabel: {
      width: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    floorLabelText: {
      color: theme.ink,
      fontSize: 12,
      fontWeight: '700',
    },
    floorLabelTextPending: {
      color: theme.muted,
    },
    floorLabelTextCurrent: {
      color: theme.amberInk,
      fontWeight: '800',
    },
    stairWell: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'flex-start',
      paddingHorizontal: 4,
      gap: 1,
    },
    overflowText: {
      color: theme.amberInk,
      fontSize: 10,
      fontWeight: '700',
      marginLeft: 2,
    },
    statusBox: {
      width: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statusDone: {
      color: theme.green,
      fontSize: 14,
      fontWeight: '800',
    },
    statusPending: {
      color: theme.muted,
      fontSize: 14,
    },
    cursor: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.amber,
    },
  })
