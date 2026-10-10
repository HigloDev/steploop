import React, { useEffect, useRef, useState } from 'react'
import { AppState, Linking, Pressable, Text, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
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
export function BackgroundTrainingReadiness({ compact = false, grouped = false, evidenceContext }: {
  compact?: boolean
  grouped?: boolean
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

  if (grouped) return <View>
    {([
      ['运动权限', 'run', status?.activityPermissionGranted, '检查运动权限'],
      ['通知权限', 'bell', status?.notificationsAllowed, '检查通知权限'],
      ['电池优化', 'battery-charging', status?.batteryOptimizationIgnored, '检查电池优化'],
    ] as const).map(([label, icon, allowed, accessibilityLabel], index) => <Pressable key={label}
      accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={opening}
      onPress={() => { if (index === 2) void open(!status?.batteryOptimizationIgnored); else void Linking.openSettings().catch(() => setError('无法打开系统页面，请在手机设置中检查循阶的权限。')) }}
      style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 16,
        borderTopWidth: index ? 0.5 : 0, borderTopColor: theme.line }}>
      <MaterialCommunityIcons name={icon} size={24} color={theme.ink} />
      <View style={{ flex: 1 }}><Text style={{ color: theme.ink, fontSize: 16, lineHeight: 22, fontWeight: '800' }}>{label}</Text>
        <Text style={{ color: theme.mutedStrong, fontSize: 12, lineHeight: 16 }}>{allowed ? '已允许' : index === 2 ? '待检查' : '未允许'}</Text></View>
      <MaterialCommunityIcons name={index === 2 ? 'chevron-right' : allowed ? 'check-circle' : 'alert-circle-outline'}
        size={24} color={index === 2 ? theme.brand : allowed ? '#39c35b' : theme.amberInk} />
    </Pressable>)}
    <Text style={{ color: theme.mutedStrong, fontSize: 12, lineHeight: 18, marginTop: 8 }}>权限就绪不代表后台采样一定连续。</Text>
    {error ? <Text accessibilityRole="alert" style={{ color: theme.amberInk, fontSize: 13, lineHeight: 20 }}>{error}</Text> : null}
  </View>

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
