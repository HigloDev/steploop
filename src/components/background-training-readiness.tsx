import React, { useEffect, useRef, useState } from 'react'
import { AppState, Text, View } from 'react-native'
import { Button } from './ui'
import { useTheme } from '../theme'
import {
  BackgroundTrainingStatus,
  getBackgroundTrainingStatus,
  openBatteryOptimizationSettings,
  requestIgnoreBatteryOptimizations,
} from '../services/background-training'
import { recordWorkoutEvidenceEvent, WorkoutEvidenceContext } from '../services/workout-evidence'

/** System exemption is readiness information; only measured samples prove continuity. */
export function BackgroundTrainingReadiness({ compact = false, evidenceContext }: {
  compact?: boolean
  evidenceContext?: WorkoutEvidenceContext
}) {
  const theme = useTheme()
  const [status, setStatus] = useState<BackgroundTrainingStatus | null>(null)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  const mounted = useRef(true)
  const lastJournalKey = useRef('')

  const refresh = async () => {
    try {
      const next = await getBackgroundTrainingStatus()
      if (mounted.current) { setStatus(next); setError('') }
    } catch {
      if (mounted.current) setError('未能读取锁屏采集设置，请在系统中检查循阶的电池权限。')
    }
  }

  useEffect(() => {
    mounted.current = true
    void refresh()
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh()
    })
    return () => { mounted.current = false; subscription.remove() }
  }, [])

  useEffect(() => {
    if (!evidenceContext || !status) return
    const detail = {
      supported: status.supported,
      batteryOptimizationIgnored: status.batteryOptimizationIgnored,
      activityPermissionGranted: status.activityPermissionGranted,
      notificationsAllowed: status.notificationsAllowed,
    }
    const key = `${evidenceContext.workoutId}:${JSON.stringify(detail)}`
    if (lastJournalKey.current === key) return
    lastJournalKey.current = key
    recordWorkoutEvidenceEvent(evidenceContext, 'background_training_readiness', Date.now(), detail,
      () => { if (mounted.current) setError('锁屏设置状态未能写入分析记录，训练仍可继续。') })
  }, [evidenceContext, status])

  const open = async (request: boolean) => {
    if (opening) return
    setOpening(true)
    setError('')
    try {
      const result = await (request ? requestIgnoreBatteryOptimizations() : openBatteryOptimizationSettings())
      if (!result.opened && mounted.current) setError('无法打开系统页面，请在手机设置中将循阶的电池使用设为无限制。')
      await refresh()
    } catch {
      if (mounted.current) setError('无法打开系统页面，请在手机设置中将循阶的电池使用设为无限制。')
    } finally {
      if (mounted.current) setOpening(false)
    }
  }

  if (status && !status.supported) return compact ? null : (
    <Text style={{ color: theme.mutedStrong, fontSize: 13, lineHeight: 20 }}>当前运行环境不支持锁屏采集，请保持训练页面在前台。</Text>
  )
  if (compact && status?.batteryOptimizationIgnored && !error) return null
  if (!status && !error) return null

  return (
    <View style={{ marginVertical: 8, gap: 8 }}>
      <Text accessibilityLiveRegion="polite" style={{ color: theme.ink, fontSize: 15, fontWeight: '700' }}>锁屏采集</Text>
      <Text style={{ color: theme.mutedStrong, fontSize: 13, lineHeight: 20 }}>
        {status?.batteryOptimizationIgnored
          ? '已允许训练期间持续采集。部分手机还需将循阶的电池使用设为无限制；若发生缺段，会保留记录并提醒核实楼层。'
          : '系统省电限制仍可能造成锁屏漏记。请允许循阶在训练期间持续采集；也可保持亮屏继续训练。'}
      </Text>
      <Button title={opening ? '正在打开…' : status?.batteryOptimizationIgnored ? '检查系统电池设置' : '允许锁屏持续采集'}
        variant="secondary" disabled={opening} onPress={() => { void open(!status?.batteryOptimizationIgnored) }} />
      {error ? <Text accessibilityRole="alert" style={{ color: theme.amberInk, fontSize: 13, lineHeight: 20 }}>{error}</Text> : null}
    </View>
  )
}
