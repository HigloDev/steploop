// 设置页：震动/声音反馈开关 + 数据导出/导入 + 关于。

import React, { useEffect, useState } from 'react'
import appConfig from '../../app.json'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Host, Switch } from '@expo/ui'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Disclosure } from '../components/disclosure'
import { VoiceModeSelector } from '../components/voice-mode-selector'
import { VoiceSpeakerSelector } from '../components/voice-speaker-selector'
import { NativeChoice } from '../components/native-choice'
import { BackgroundTrainingReadiness } from '../components/background-training-readiness'
import { voiceModeChoice, voiceModePreferences } from '../services/workout-voice-settings'
import { Header } from '../components/Header'
import { Card } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { MainTabScreen } from '../navigation/types'
import {
  getPreferences,
  savePreferences,
  didPreferencesWriteFail,
  triggerHaptic,
  Preferences as Prefs,
} from '../services/preferences'
import {
  exportBackup,
  importBackupPayload,
  pickBackupPayload,
  previewBackupImport,
} from '../services/backup'
import { exportWorkoutCsv } from '../services/export-csv'
import { isLocalDownloadExportAvailable } from '../services/local-download-export'
import { isBackgroundTrainingSupported } from '../services/background-training'

const APP_VERSION = appConfig.expo.version

export default function SettingsScreen({ navigation }: MainTabScreen<'Profile'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportingCsv, setExportingCsv] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [prefsWriteError, setPrefsWriteError] = useState('')

  useEffect(() => {
    let mounted = true
    const loadPreferences = () => {
      getPreferences().then(value => { if (mounted) setPrefs(value) }).catch(() => undefined)
    }
    loadPreferences()
    const unsubscribe = navigation.addListener('focus', loadPreferences)
    return () => { mounted = false; unsubscribe() }
  }, [navigation])


  const update = async (patch: Partial<Prefs>) => {
    const next = await savePreferences(patch)
    setPrefs(next)
    if (didPreferencesWriteFail()) {
      setPrefsWriteError('设置保存失败，更改可能在重启后丢失')
    } else {
      setPrefsWriteError('')
    }
  }

  const toggleHaptic = (value: boolean) => {
    update({ hapticFeedback: value })
    if (value) triggerHaptic('light')
  }

  const adjustWeight = (delta: number) => {
    const current = prefs?.bodyWeightKg ?? 65
    update({ bodyWeightKg: Math.min(200, Math.max(30, current + delta)) })
  }

  const handleExport = async (destination: 'share' | 'downloads' = 'share') => {
    if (exporting) return
    setExporting(true)
    setExportMessage('正在生成备份文件…')
    try {
      const result = await exportBackup({ destination })
      setExportMessage(result.message)
    } catch (err) {
      setExportMessage(`导出失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setExporting(false)
    }
  }

  const handleExportCsv = async () => {
    if (exportingCsv) return
    setExportingCsv(true)
    setExportMessage('正在生成 CSV…')
    try {
      const result = await exportWorkoutCsv()
      setExportMessage(result.message)
    } catch (err) {
      setExportMessage(`CSV 导出失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setExportingCsv(false)
    }
  }

  const handleImport = () => {
    Alert.alert(
      '导入备份',
      '导入前会自动备份当前数据。合并导入保留本机已有内容；覆盖导入会替换全部数据。',
      [
        { text: '取消', style: 'cancel' },
        { text: '合并导入', onPress: () => runImport('merge') },
        {
          text: '覆盖导入',
          style: 'destructive',
          onPress: confirmReplaceImport,
        },
      ],
    )
  }

  const confirmReplaceImport = () => {
    Alert.alert(
      '覆盖导入',
      '将用备份文件替换本机全部路线和成绩。导入前会自动创建快照，出错时可恢复。确定覆盖吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '覆盖',
          style: 'destructive',
          onPress: () => runImport('replace'),
        },
      ],
    )
  }

  const runImport = async (mode: 'merge' | 'replace') => {
    if (importing) return
    setImporting(true)
    setImportMessage('请选择备份文件…')
    try {
      // F16：先只选文件并预览，把「会裁掉多少条 / 归档统计是否认领」如实告诉用户，
      // 由用户确认后再真正写入。预览本身不写任何数据。
      const payload = await pickBackupPayload()
      setImportMessage('正在核对备份内容…')
      const preview = await previewBackupImport(payload, { mode })
      setImporting(false)
      const lines = [
        `路线 ${preview.incoming.routes} 条、会话 ${preview.incoming.sessions} 条、训练 ${preview.incoming.workouts} 条`,
        `导入后保留：路线 ${preview.kept.routes} 条、会话 ${preview.kept.sessions} 条、训练 ${preview.kept.workouts} 条`,
      ]
      if (preview.warnings.length) {
        lines.push('', ...preview.warnings.map((line) => `· ${line}`))
      }
      Alert.alert(
        mode === 'replace' ? '确认覆盖导入' : '确认合并导入',
        lines.join('\n'),
        [
          { text: '取消', style: 'cancel', onPress: () => setImportMessage('') },
          {
            text: '确认导入',
            onPress: () => {
              void performImport(payload, mode)
            },
          },
        ],
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知错误'
      if (message === 'CANCEL') {
        setImportMessage('')
      } else {
        setImportMessage(`导入失败：${message}`)
        Alert.alert('导入失败', message)
      }
      setImporting(false)
    }
  }

  const performImport = async (
    payload: Parameters<typeof importBackupPayload>[0],
    mode: 'merge' | 'replace',
  ) => {
    setImporting(true)
    setImportMessage('正在导入…')
    try {
      const result = await importBackupPayload(payload, { mode })
      const trimmedNote =
        (result.sessionsTruncated ?? 0) + (result.workoutsTruncated ?? 0) > 0
          ? `；按容量上限裁剪了 ${result.sessionsTruncated ?? 0} 条会话、${result.workoutsTruncated ?? 0} 条训练（已归档为统计）`
          : ''
      setImportMessage(
        `已${mode === 'replace' ? '覆盖' : '合并'}导入 ${result.routesCount} 条路线、${result.sessionsCount} 条成绩${trimmedNote}`,
      )
      Alert.alert('导入成功', '建议重新打开应用以确保所有页面刷新最新数据。', [
        { text: '知道了' },
      ])
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知错误'
      setImportMessage(`导入失败：${message}`)
      Alert.alert('导入失败', message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <View style={styles.page}>
      <Header title="设置" back={false} large />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        <Text style={styles.intro}>按你的习惯，调整每一次训练。</Text>
        <View style={[styles.sectionHead, { marginTop: 0 }]}>
          <View style={styles.sectionHeading}>
            <Feather name="volume-2" size={20} color={theme.brand} />
            <Text accessibilityRole="header" style={styles.sectionTitle}>运动播报</Text>
          </View>
          <Text style={styles.statusText}>
            {!prefs ? '读取中' : voiceModeChoice(prefs) === 'off' ? '已关闭' : '已开启'}
          </Text>
        </View>
        <Card style={styles.group}>
          {!prefs ? <ActivityIndicator color={theme.brand} accessibilityLabel="正在读取设置" /> : null}
          <VoiceModeSelector
            value={voiceModeChoice(prefs ?? {})}
            disabled={!prefs}
            onChange={value => { void update(voiceModePreferences(value)) }}
          />
          <View style={styles.divider} />
          <View style={styles.voiceControl}>
            <Text style={styles.rowTitle}>音量（%）</Text>
            <NativeChoice
              disabled={!prefs}
              value={String(prefs?.voiceVolume ?? 0.85)}
              options={[0.45, 0.65, 0.85, 1].map(value => ({ value: String(value), label: String(Math.round(value * 100)) }))}
              onChange={value => { void update({ voiceVolume: Number(value) }) }}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.voiceControl}>
            <Text style={styles.rowTitle}>语速</Text>
            <NativeChoice
              disabled={!prefs}
              value={String(prefs?.voiceRate ?? 1)}
              options={[{ value: '0.8', label: '稍慢' }, { value: '1', label: '正常' }, { value: '1.2', label: '稍快' }]}
              onChange={value => { void update({ voiceRate: Number(value) }) }}
            />
          </View>
          <View style={styles.divider} />
          <VoiceSpeakerSelector prefs={prefs} onChange={voiceSpeaker => { void update({ voiceSpeaker }) }} />
        </Card>
        {prefsWriteError ? <Text accessibilityLiveRegion="polite" style={[styles.messageText, { color: theme.amberInk }]}>{prefsWriteError}</Text> : null}

        <View style={styles.sectionHead}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>声音与提醒</Text>
        </View>
        <Card style={styles.group}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>震动反馈</Text>
              <Text style={styles.rowDesc}>识别楼层、转向与结束时轻触提醒</Text>
            </View>
            <Host matchContents seedColor={theme.brand} style={{ width: 64, minHeight: 48 }}>
              <Switch disabled={!prefs} value={Boolean(prefs?.hapticFeedback)} onValueChange={toggleHaptic} />
            </Host>
          </View>
          {([
            ['voiceBluetoothOnly', '仅蓝牙耳机播报', '未连接蓝牙耳机时保持静音'],
            ['voiceNightQuiet', '夜间免打扰', '每天 22:00 至次日 07:00 静音'],
            ['voiceDuckMusic', '播报时压低音乐', '关闭时遇到音乐播放会略过播报'],
          ] as const).map(([key, label, description]) => <React.Fragment key={key}>
            <View style={styles.divider} />
            <View style={styles.row}>
              <View style={styles.rowText}><Text style={styles.rowTitle}>{label}</Text><Text style={styles.rowDesc}>{description}</Text></View>
              <Host matchContents seedColor={theme.brand} style={{ width: 64, minHeight: 48 }}>
                <Switch disabled={!prefs} value={Boolean(prefs?.[key])} onValueChange={value => { void update({ [key]: value }) }} />
              </Host>
            </View>
          </React.Fragment>)}
        </Card>
        <Disclosure title="播报内容" summary="里程碑与鼓励">
          <View style={styles.detailGroup}>
            {([
              ['voiceEncouragement', '鼓励语', '可关闭额外鼓励，关键状态仍保留'],
              ['voiceCalories', '卡路里里程碑', '标准与教练模式播报'],
              ['voiceSteps', '步数里程碑', '教练模式播报'],
              ['voiceFloors', '楼层里程碑', '教练模式播报'],
            ] as const).map(([key, label, description], index) => <React.Fragment key={key}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <View style={styles.row}>
                <View style={styles.rowText}><Text style={styles.rowTitle}>{label}</Text><Text style={styles.rowDesc}>{description}</Text></View>
                <Host matchContents seedColor={theme.brand} style={{ width: 64, minHeight: 48 }}>
                  <Switch disabled={!prefs} value={Boolean(prefs?.[key])} onValueChange={value => { void update({ [key]: value }) }} />
                </Host>
              </View>
            </React.Fragment>)}
          </View>
        </Disclosure>

        <View style={styles.sectionHead}><Text accessibilityRole="header" style={styles.sectionTitle}>训练偏好</Text></View>
        <Card style={styles.group}>
          <Text style={styles.rowTitle}>体重</Text>
          <Text style={styles.rowDesc}>用于估算消耗。历史成绩保留训练时的体重。</Text>
          <View style={styles.weightControl}>
            <Pressable accessibilityRole="button" accessibilityLabel="体重减一千克" disabled={!prefs} style={styles.weightButton} onPress={() => adjustWeight(-1)}><Text style={styles.weightButtonText}>−</Text></Pressable>
            <Text style={styles.weightValue}>{Math.round(prefs?.bodyWeightKg ?? 65)}<Text style={styles.weightUnit}> 千克</Text></Text>
            <Pressable accessibilityRole="button" accessibilityLabel="体重加一千克" disabled={!prefs} style={styles.weightButton} onPress={() => adjustWeight(1)}><Text style={styles.weightButtonText}>＋</Text></Pressable>
          </View>
          <View style={styles.divider} />
        </Card>

        <View style={styles.sectionHead}><Text accessibilityRole="header" style={styles.sectionTitle}>锁屏与后台</Text></View>
        <Card style={styles.group}><BackgroundTrainingReadiness /></Card>

        <View style={styles.sectionHead}><Text accessibilityRole="header" style={styles.sectionTitle}>数据与帮助</Text></View>
        <Disclosure title="备份与导出">
        <View style={styles.detailGroup}>
          <Pressable accessibilityRole="button" style={styles.row} onPress={() => { void handleExport() }} disabled={exporting}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>导出备份</Text>
              <Text style={styles.rowDesc}>导出路线与成绩数据文件</Text>
            </View>
            <Text style={styles.rowAction}>{exporting ? '导出中…' : '导出'}</Text>
          </Pressable>
          {isLocalDownloadExportAvailable() ? <>
            <View style={styles.divider} />
            <Pressable accessibilityRole="button" style={styles.row} onPress={() => { void handleExport('downloads') }} disabled={exporting}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>保存备份到下载</Text>
                <Text style={styles.rowDesc}>仅保存本机 Download/循阶，文件含路线与训练数据</Text>
              </View>
              <Text style={styles.rowAction}>{exporting ? '保存中…' : '保存'}</Text>
            </Pressable>
          </> : null}
          {exportMessage ? (
            <Text style={styles.messageText}>{exportMessage}</Text>
          ) : null}
          <View style={styles.divider} />
          <Pressable accessibilityRole="button" style={styles.row} onPress={handleExportCsv} disabled={exportingCsv}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>导出成绩表</Text>
              <Text style={styles.rowDesc}>训练记录表格，可用 Excel 打开</Text>
            </View>
            <Text style={styles.rowAction}>{exportingCsv ? '导出中…' : '导出'}</Text>
          </Pressable>
          <View style={styles.divider} />
          <Pressable accessibilityRole="button" style={styles.row} onPress={handleImport} disabled={importing}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>导入备份</Text>
              <Text style={styles.rowDesc}>从数据文件恢复路线与成绩</Text>
            </View>
            <Text style={styles.rowAction}>{importing ? '导入中…' : '导入'}</Text>
          </Pressable>
          {importMessage ? (
            <Text style={styles.messageText}>{importMessage}</Text>
          ) : null}
        </View>

        </Disclosure>
        <Disclosure title="帮助与关于">
        <View style={styles.detailGroup}>
          <Text style={styles.rowTitle}>训练记录说明</Text>
          <Text style={styles.rowDesc}>{isBackgroundTrainingSupported()
            ? '当前 Android 版本支持锁屏与后台采样，训练时显示持续通知。系统强制停止可能产生缺段，结束时可手动修正最终楼层。'
            : '锁屏或切到其它应用时，系统会暂停传感器；返回后会提示后台缺段，结束时可手动修正最终楼层。'}</Text>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowTitle}>版本</Text>
            <Text style={styles.rowValue}>{APP_VERSION}</Text>
          </View>
          <View style={styles.divider} />
          <Pressable
            accessibilityRole="button"
            style={styles.row}
            onPress={() => navigation.navigate('Privacy', { from: 'settings' })}
          >
            <Text style={styles.rowTitle}>隐私协议</Text>
            <Text style={styles.rowAction}>查看</Text>
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            accessibilityRole="button"
            style={styles.row}
            onPress={() => navigation.navigate('Onboarding', { from: 'settings' })}
          >
            <Text style={styles.rowTitle}>新手引导</Text>
            <Text style={styles.rowAction}>重看</Text>
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            accessibilityRole="button"
            style={styles.row}
            onPress={() =>
              Alert.alert(
                '如何判断爬楼',
                '先带手机逐层熟悉路线，再检查它能不能认对。平时参考这段楼梯的脚步和转弯；气压只帮助判断上楼、下楼等变化，不按固定高度直接换算楼层。\n\n' +
                  '当前算法每层还要求识别到两次完整转弯；不同楼梯或携带方式可能导致报层延迟，正在用真实采样核对。缺少气压时，估算精度会下降。\n\n' +
                  '当前楼层与爬升层数不同：从 1 楼到 2 楼，爬升 1 层。新训练从 1 到 15 楼记为爬升 14 层；未标新口径的旧成绩保留原值。\n\n' +
                  (isBackgroundTrainingSupported()
                    ? '正式锻炼时，这个 Android 版本可以在锁屏后继续记录，并显示通知。系统强制关闭或权限改变仍可能打断记录；结束时可以确认实际楼层。熟悉路线时，请保持页面打开。\n\n'
                    : '训练中请保持屏幕点亮。锁屏或切到其它应用时，系统会暂停传感器，这段时间的楼层不会被记录。返回后会提示后台缺段，结束时可手动修正最终楼层。\n\n') +
                  '携带方式变化可能影响识别，你可以随时确认实际楼层和结束本轮。',
                [{ text: '知道了' }],
              )
            }
          >
            <Text style={styles.rowTitle}>如何判断爬楼</Text>
            <Text style={styles.rowAction}>查看</Text>
          </Pressable>

        </View>

        </Disclosure>
        {(__DEV__ || process.env.EXPO_PUBLIC_DIAGNOSTIC_CAPTURE === '1') ? <Disclosure title="诊断工具">          {(__DEV__ || process.env.EXPO_PUBLIC_DIAGNOSTIC_CAPTURE === '1') && (
            <>
              <View style={styles.divider} />
              <Pressable
                accessibilityRole="button"
                style={styles.row}
                onPress={() => navigation.navigate('DiagnosticCapture')}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>测试采样</Text>
                  <Text style={styles.rowDesc}>本地采集、标注并导出脱敏样本（验收采样）</Text>
                </View>
                <Text style={styles.rowAction}>进入</Text>
              </Pressable>
            </>
          )}
          {(__DEV__ || process.env.EXPO_PUBLIC_DIAGNOSTIC_CAPTURE === '1') && (
            <>
              <View style={styles.divider} />
              <Pressable
                style={styles.row}
                onPress={() => navigation.navigate('ClimbPreview')}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>开发预览</Text>
                  <Text style={styles.rowDesc}>多轮训练状态机预览（仅调试）</Text>
                </View>
                <Text style={styles.rowAction}>进入</Text>
              </Pressable>
            </>
          )}
        </Disclosure> : null}

        <Text style={styles.appFooter}>循阶 · {APP_VERSION}</Text>
      </ScrollView>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: 20, paddingTop: 8 },
    intro: { color: theme.mutedStrong, fontSize: 15, lineHeight: 22, marginBottom: 24 },
    sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 24, marginBottom: 12 },
    sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    sectionTitle: { color: theme.ink, fontSize: 17, lineHeight: 24, fontWeight: '600' },
    statusText: { color: theme.brand, fontSize: 14, lineHeight: 21, fontWeight: '600' },
    group: { padding: 16, borderRadius: 20 },
    voiceControl: { paddingVertical: 8, gap: 8 },
    detailGroup: { paddingTop: 4, paddingBottom: 16 },
    footerNote: { color: theme.mutedStrong, fontSize: 12, lineHeight: 18, paddingTop: 12 },
    appFooter: { color: theme.mutedStrong, fontSize: 12, lineHeight: 18, textAlign: 'center', paddingTop: 24 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 8,
      minHeight: 56,
    },
    rowText: {
      flex: 1,
    },
    rowTitle: {
      color: theme.ink,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '500',
    },
    rowDesc: {
      marginTop: 3,
      color: theme.mutedStrong,
      fontSize: 14,
      lineHeight: 21,
    },
    weightControl: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 16,
    },
    weightButton: {
      width: 48,
      height: 48,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.line,
      backgroundColor: theme.surfaceSoft,
    },
    weightButtonText: {
      color: theme.brand,
      fontSize: 20,
      fontWeight: '700',
      lineHeight: 22,
    },
    weightValue: {
      minWidth: 58,
      color: theme.ink,
      fontSize: 28,
      lineHeight: 34,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      textAlign: 'center',
    },
    weightUnit: { color: theme.mutedStrong, fontSize: 14, lineHeight: 21, fontWeight: '400' },
    rowValue: { color: theme.mutedStrong, fontSize: 14, lineHeight: 21 },
    rowAction: {
      color: theme.brand,
      fontSize: 14,
      fontWeight: '600',
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.line,
      marginVertical: 6,
    },
    messageText: {
      color: theme.mutedStrong,
      fontSize: 14,
      lineHeight: 21,
      marginTop: 8,
    },
  })
