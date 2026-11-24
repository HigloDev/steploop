// 设置页：外观（明暗+6套浅暗成对主题配色）、声音与提醒、训练偏好、锁屏与后台、数据与帮助。
// 统一 SettingsGroup 玻璃卡片与语义分组标题，统一折叠箭头（⌄/⌃）与跳转箭头（›），样式经 useThemeStyles 弱缓存。

import React, { useEffect, useRef, useState } from 'react'
import appConfig from '../../app.json'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { UIIcon } from '../components/ui-icon'
import { Host } from '@expo/ui'
import { ThemeSwitch as Switch } from '../components/theme-switch'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Disclosure } from '../components/disclosure'
import { FlowSheet } from '../components/flow-sheet'
import { AppearanceModeControl } from '../components/appearance-mode-control'
import { VoiceModeSelector } from '../components/voice-mode-selector'
import { VoiceSpeakerSelector } from '../components/voice-speaker-selector'
import { NativeChoice } from '../components/native-choice'
import { BackgroundTrainingReadiness } from '../components/background-training-readiness'
import { voiceModeChoice, voiceModePreferences } from '../services/workout-voice-settings'
import { Header } from '../components/Header'
import { Button, Card } from '../components/ui'
import { CompletionCelebration } from '../components/completion-celebration'
import { useAppearance } from '../appearance'
import { skinName } from '../skin-catalog'
import { sport, Theme, typography, useTheme, useThemeStyles } from '../theme'
import { GlassBackdrop, getGlassSurfaceStyle, useGlassDockInset } from '../components/glass-material'
import { MainTabScreen } from '../navigation/types'
import {
  getPreferences,
  savePreferences,
  didPreferencesWriteFail,
  triggerHapticPattern,
  Preferences as Prefs,
} from '../services/preferences'
import {
  exportBackup,
  importBackupPayload,
  pickBackupPayload,
  previewBackupImport,
  restorePreImportSnapshot,
  hasPreImportSnapshot,
  listPreUndoSnapshots,
  exportUndoSafetyBackup,
} from '../services/backup'
import { exportWorkoutCsv } from '../services/export-csv'
import { isLocalDownloadExportAvailable } from '../services/local-download-export'
import { isBackgroundTrainingSupported } from '../services/background-training'

const APP_VERSION = appConfig.expo.version
const UNDO_PAGE_SIZE = 5
const snapshotTime = (savedAt: number) => new Date(savedAt).toLocaleString('zh-CN', { hour12: false })

function SettingsGroup({
  title,
  badge,
  spaced = false,
  children,
}: {
  title: string
  badge?: string
  spaced?: boolean
  children: React.ReactNode
}) {
  const theme = useTheme()
  const styles = useThemeStyles(makeStyles)
  return (
    <View style={spaced ? styles.nextGroup : undefined}>
      <View style={styles.sectionHeaderRow}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
        {badge ? (
          <View style={styles.sectionBadge}>
            <Text style={styles.sectionBadgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Card style={[styles.group, getGlassSurfaceStyle(theme, 'card')]}>{children}</Card>
    </View>
  )
}

export default function SettingsScreen({ navigation }: MainTabScreen<'Profile'>) {
  const theme = useTheme()
  const styles = useThemeStyles(makeStyles)
  const appearance = useAppearance()
  const dockInset = useGlassDockInset()
  const insets = useSafeAreaInsets()
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [exportTarget, setExportTarget] = useState<'share' | 'downloads' | null>(null)
  const [exportingCsv, setExportingCsv] = useState(false)
  const [importing, setImporting] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [exportingUndo, setExportingUndo] = useState(false)
  const [canUndoImport, setCanUndoImport] = useState(false)
  const [undoBackups, setUndoBackups] = useState<Awaited<ReturnType<typeof listPreUndoSnapshots>>>([])
  const [showUndoBackups, setShowUndoBackups] = useState(false)
  const [undoBackupPage, setUndoBackupPage] = useState(0)
  const [recoveryLoading, setRecoveryLoading] = useState(true)
  const [recoveryError, setRecoveryError] = useState('')
  const dataOperationRef = useRef(false)
  const recoveryRequestRef = useRef(0)
  const mountedRef = useRef(true)
  const dataBusy = importing || undoing || exportTarget !== null || exportingCsv || exportingUndo
  const [exportMessage, setExportMessage] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [prefsWriteError, setPrefsWriteError] = useState('')
  const [previewCompletion, setPreviewCompletion] = useState(false)
  const [weightSheetOpen, setWeightSheetOpen] = useState(false)
  const [weightDraft, setWeightDraft] = useState('')

  const refreshRecovery = async (duringOperation = false) => {
    if (dataOperationRef.current && !duringOperation) return
    const request = ++recoveryRequestRef.current
    setRecoveryLoading(true)
    try {
      const [canUndo, snapshots] = await Promise.all([hasPreImportSnapshot(), listPreUndoSnapshots()])
      if (!mountedRef.current || request !== recoveryRequestRef.current) return
      setCanUndoImport(canUndo)
      setUndoBackups(snapshots)
      setUndoBackupPage(page => Math.min(page, Math.max(0, Math.ceil(snapshots.length / UNDO_PAGE_SIZE) - 1)))
      setRecoveryError('')
    } catch {
      if (mountedRef.current && request === recoveryRequestRef.current) {
        setCanUndoImport(false)
        setRecoveryError('暂时无法读取恢复副本，请重试。')
      }
    } finally {
      if (mountedRef.current && request === recoveryRequestRef.current) setRecoveryLoading(false)
    }
  }

  const invalidateRecoveryRead = () => {
    recoveryRequestRef.current += 1
    setRecoveryLoading(false)
  }

  useEffect(() => {
    mountedRef.current = true
    let mounted = true
    const loadPreferences = () => {
      getPreferences().then(value => { if (mounted) setPrefs(value) }).catch(() => undefined)
      void refreshRecovery()
    }
    loadPreferences()
    const unsubscribe = navigation.addListener('focus', loadPreferences)
    return () => {
      mounted = false
      mountedRef.current = false
      recoveryRequestRef.current += 1
      unsubscribe()
    }
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

  const toggleHaptic = async (value: boolean) => {
    await update({ hapticFeedback: value })
    if (value) void triggerHapticPattern('floor')
  }

  const adjustWeight = (delta: number) => {
    const current = prefs?.bodyWeightKg ?? 65
    void update({ bodyWeightKg: Math.min(200, Math.max(30, Math.round(current + delta))) })
  }

  const openWeightSheet = () => {
    if (!prefs) return
    setWeightDraft(String(Math.round(prefs.bodyWeightKg ?? 65)))
    setWeightSheetOpen(true)
  }

  const commitWeightDraft = () => {
    const parsed = Number.parseFloat(weightDraft.trim())
    if (!Number.isFinite(parsed) || parsed < 30 || parsed > 200) {
      Alert.alert('体重范围', '请输入 30 到 200 之间的数字（千克）。')
      return
    }
    void update({ bodyWeightKg: Math.round(parsed) })
    setWeightSheetOpen(false)
  }

  const handleExport = async (destination: 'share' | 'downloads' = 'share') => {
    if (dataOperationRef.current) return
    dataOperationRef.current = true
    setExportTarget(destination)
    setExportMessage(destination === 'downloads' ? '正在保存到下载目录…' : '正在生成备份文件…')
    try {
      const result = await exportBackup({ destination })
      setExportMessage(result.message)
    } catch (err) {
      setExportMessage(`导出失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      dataOperationRef.current = false
      setExportTarget(null)
    }
  }

  const handleExportCsv = async () => {
    if (dataOperationRef.current) return
    dataOperationRef.current = true
    setExportingCsv(true)
    setExportMessage('正在生成 CSV…')
    try {
      const result = await exportWorkoutCsv()
      setExportMessage(result.message)
    } catch (err) {
      setExportMessage(`CSV 导出失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      dataOperationRef.current = false
      setExportingCsv(false)
    }
  }

  const handleImport = () => {
    if (dataOperationRef.current) return
    Alert.alert(
      '导入备份',
      '导入前会自动创建恢复快照。合并导入保留本机已有内容；覆盖导入会替换备份包含的路线、楼栋模板与成绩，请核对下一步预览。',
      [
        { text: '取消', style: 'cancel' },
        { text: '合并导入', onPress: () => runImport('merge') },
        { text: '覆盖导入', style: 'destructive', onPress: confirmReplaceImport },
      ],
    )
  }

  const confirmReplaceImport = () => {
    Alert.alert(
      '覆盖导入',
      '将用备份文件替换路线和成绩；包含楼栋模板的备份也会替换本机楼栋模板。旧版备份未包含楼栋模板时，会保留本机模板。导入前会创建恢复快照，请在下一步核对数量后确认。',
      [
        { text: '取消', style: 'cancel' },
        { text: '覆盖', style: 'destructive', onPress: () => runImport('replace') },
      ],
    )
  }

  const runImport = async (mode: 'merge' | 'replace') => {
    if (dataOperationRef.current) return
    dataOperationRef.current = true
    invalidateRecoveryRead()
    setImporting(true)
    setImportMessage('请选择备份文件…')
    try {
      const payload = await pickBackupPayload()
      setImportMessage('正在核对备份内容…')
      const preview = await previewBackupImport(payload, { mode })
      const lines = [
        `路线 ${preview.incoming.routes} 条、会话 ${preview.incoming.sessions} 条、训练 ${preview.incoming.workouts} 条`,
        `导入后保留：路线 ${preview.kept.routes} 条、会话 ${preview.kept.sessions} 条、训练 ${preview.kept.workouts} 条`,
      ]
      if (preview.warnings.length) {
        lines.push('', ...preview.warnings.map(line => `· ${line}`))
      }
      let decided = false
      Alert.alert(
        mode === 'replace' ? '确认覆盖导入' : '确认合并导入',
        lines.join('\n'),
        [
          {
            text: '取消',
            style: 'cancel',
            onPress: () => {
              if (decided) return
              decided = true
              dataOperationRef.current = false
              setImporting(false)
              setImportMessage('')
              void refreshRecovery()
            },
          },
          {
            text: '确认导入',
            onPress: () => {
              if (decided) return
              decided = true
              void performImport(payload, mode)
            },
          },
        ],
        { cancelable: false },
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
      dataOperationRef.current = false
      void refreshRecovery()
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
      setCanUndoImport(result.snapshotCreated)
      await refreshRecovery(true)
      const trimmedNote =
        (result.sessionsTruncated ?? 0) + (result.workoutsTruncated ?? 0) > 0
          ? `；按容量上限裁剪了 ${result.sessionsTruncated ?? 0} 条会话、${result.workoutsTruncated ?? 0} 条训练（已归档为统计）`
          : ''
      setImportMessage(
        `已${mode === 'replace' ? '覆盖' : '合并'}导入 ${result.routesCount} 条旧版路线、${result.sessionsCount} 条单轮记录、${result.workoutsCount} 次训练${trimmedNote}`,
      )
      Alert.alert('导入成功', '返回训练或记录页即可查看。需要回退时，可在这里选择“撤销上次导入”。', [
        { text: '知道了' },
      ])
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知错误'
      setImportMessage(`导入失败：${message}`)
      Alert.alert('导入失败', message)
      await refreshRecovery(true)
    } finally {
      dataOperationRef.current = false
      setImporting(false)
    }
  }

  const performUndo = async () => {
    if (dataOperationRef.current) return
    dataOperationRef.current = true
    invalidateRecoveryRead()
    setUndoing(true)
    setImportMessage('正在保留当前数据并恢复导入前记录…')
    try {
      const result = await restorePreImportSnapshot()
      if (!result) {
        setCanUndoImport(false)
        setImportMessage('没有可撤销的导入。')
        return
      }
      setCanUndoImport(false)
      setUndoBackupPage(0)
      setImportMessage(
        `已恢复导入前的 ${result.workoutsCount} 次训练和 ${result.sessionsCount} 条单轮记录。撤销前的数据已另存，可通过下方入口导出。`,
      )
      await refreshRecovery(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知错误'
      setImportMessage(`撤销失败：${message}。恢复副本仍保留，请重试。`)
      Alert.alert('撤销失败', message)
    } finally {
      dataOperationRef.current = false
      setUndoing(false)
    }
  }

  const confirmUndo = () => {
    if (dataOperationRef.current || recoveryLoading || !canUndoImport) return
    Alert.alert(
      '撤销上次导入？',
      '将恢复到上次导入之前的楼栋、路线与训练记录。导入后新增或修改的内容也会回退；应用会先保留当前数据副本，可通过“导出撤销前备份”取出。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '保留副本并撤销',
          style: 'destructive',
          onPress: () => {
            void performUndo()
          },
        },
      ],
    )
  }

  const exportUndoBackup = async (snapshotId: string) => {
    if (dataOperationRef.current) return
    dataOperationRef.current = true
    setExportingUndo(true)
    try {
      const result = await exportUndoSafetyBackup({
        destination: isLocalDownloadExportAvailable() ? 'downloads' : 'share',
        snapshotId,
      })
      setExportMessage(result.message)
    } catch (err) {
      setExportMessage(`导出失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      dataOperationRef.current = false
      setExportingUndo(false)
    }
  }

  const hapticPreview = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="试一下楼层震动"
      disabled={!prefs?.hapticFeedback}
      onPress={() => void triggerHapticPattern('floor')}
      style={({ pressed }) => [
        styles.previewAction,
        { opacity: !prefs?.hapticFeedback ? 0.45 : pressed ? sport.opacity.pressed : 1 },
      ]}
    >
      <Text style={styles.previewActionText}>试一下楼层震动</Text>
      <UIIcon name="vibrate" size={18} color={theme.brandText} />
    </Pressable>
  )

  const completionPreview = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="预览盖楼结算"
      disabled={!prefs}
      onPress={() => setPreviewCompletion(true)}
      style={({ pressed }) => [styles.previewAction, pressed && { opacity: sport.opacity.pressed }]}
    >
      <Text style={styles.previewActionText}>预览盖楼动画与音效</Text>
      <UIIcon name="play-circle" size={18} color={theme.brandText} />
    </Pressable>
  )

  return (
    <View style={styles.page}>
      <GlassBackdrop />
      {previewCompletion ? (
        <CompletionCelebration preview floors={30} ascentM={90} onDone={() => setPreviewCompletion(false)} />
      ) : null}
      <Header title="设置" back={false} large />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 + dockInset }]}
      >
        <SettingsGroup title="外观" badge={skinName(appearance.skinId)}>
          <AppearanceModeControl />
        </SettingsGroup>

        <SettingsGroup title="声音与提醒" spaced>
          {!prefs ? <ActivityIndicator color={theme.brandText} accessibilityLabel="正在读取设置" /> : null}
          <VoiceModeSelector
            value={voiceModeChoice(prefs ?? {})}
            disabled={!prefs}
            onChange={value => {
              void update(voiceModePreferences(value))
            }}
          />
          <View style={styles.divider} />
          <Disclosure title="播报设置" summary="音量、语速与内容" compact marginTop={0}>
            <View style={styles.voiceControl}>
              <Text style={styles.rowTitle}>音量 {Math.round((prefs?.voiceVolume ?? 0.85) * 100)}%</Text>
              <NativeChoice
                disabled={!prefs}
                value={String(prefs?.voiceVolume ?? 0.85)}
                options={[0.45, 0.65, 0.85, 1].map(value => ({ value: String(value), label: `${Math.round(value * 100)}%` }))}
                onChange={value => {
                  void update({ voiceVolume: Number(value) })
                }}
              />
            </View>
            <View style={styles.voiceControl}>
              <Text style={styles.rowTitle}>语速</Text>
              <NativeChoice
                disabled={!prefs}
                value={String(prefs?.voiceRate ?? 1)}
                options={[
                  { value: '0.8', label: '稍慢' },
                  { value: '1', label: '正常' },
                  { value: '1.2', label: '稍快' },
                ]}
                onChange={value => {
                  void update({ voiceRate: Number(value) })
                }}
              />
            </View>

            <VoiceSpeakerSelector
              prefs={prefs}
              onChange={voiceSpeaker => {
                void update({ voiceSpeaker })
              }}
            />

            <Text style={styles.subGroupHeading}>播报条件</Text>
            {(
              [
                ['voiceBluetoothOnly', '仅蓝牙耳机播报', '未连接蓝牙耳机时保持静音'],
                ['voiceNightQuiet', '夜间免打扰', '每天 22:00 至次日 07:00 静音'],
                ['voiceDuckMusic', '播报时压低音乐', '关闭时遇到音乐播放会略过播报'],
              ] as const
            ).map(([key, label, description], index) => (
              <React.Fragment key={key}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <View style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{label}</Text>
                    <Text style={styles.rowDesc}>{description}</Text>
                  </View>
                  <Host matchContents colorScheme={theme.isDark ? 'dark' : 'light'} seedColor={theme.brand} style={styles.switchHost}>
                    <Switch label={label} disabled={!prefs} value={Boolean(prefs?.[key])} onValueChange={value => { void update({ [key]: value }) }} />
                  </Host>
                </View>
              </React.Fragment>
            ))}

            <Text style={styles.subGroupHeading}>播报内容</Text>
            <View style={styles.detailGroup}>
              {(
                [
                  ['voiceEncouragement', '鼓励语', '可关闭额外鼓励，关键状态仍保留'],
                  ['voiceCalories', '卡路里里程碑', '标准与教练模式播报'],
                  ['voiceSteps', '步数里程碑', '教练模式播报'],
                  ['voiceFloors', '楼层里程碑', '教练模式播报'],
                ] as const
              ).map(([key, label, description], index) => (
                <React.Fragment key={key}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <View style={styles.row}>
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle}>{label}</Text>
                      <Text style={styles.rowDesc}>{description}</Text>
                    </View>
                    <Host matchContents colorScheme={theme.isDark ? 'dark' : 'light'} seedColor={theme.brand} style={styles.switchHost}>
                      <Switch label={label} disabled={!prefs} value={Boolean(prefs?.[key])} onValueChange={value => { void update({ [key]: value }) }} />
                    </Host>
                  </View>
                </React.Fragment>
              ))}
            </View>
          </Disclosure>

          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>震动反馈</Text>
              <Text style={styles.rowDesc}>楼层变化与操作确认</Text>
            </View>
            <Host matchContents colorScheme={theme.isDark ? 'dark' : 'light'} seedColor={theme.brand} style={styles.switchHost}>
              <Switch label="震动反馈" disabled={!prefs} value={Boolean(prefs?.hapticFeedback)} onValueChange={toggleHaptic} />
            </Host>
          </View>

          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>结算音效</Text>
              <Text style={styles.rowDesc}>盖楼完成时播放铃声</Text>
            </View>
            <Host matchContents colorScheme={theme.isDark ? 'dark' : 'light'} seedColor={theme.brand} style={styles.switchHost}>
              <Switch label="结算音效" disabled={!prefs} value={Boolean(prefs?.completionSound)} onValueChange={value => { void update({ completionSound: value }) }} />
            </Host>
          </View>

          <View style={styles.divider} />
          <Disclosure title="反馈预览" summary="楼层震动与盖楼动画" compact marginTop={0}>
            {hapticPreview}
            <View style={styles.divider} />
            {completionPreview}
          </Disclosure>
        </SettingsGroup>

        {prefsWriteError ? (
          <Text accessibilityLiveRegion="polite" style={[styles.messageText, { color: theme.amberInk }]}>
            {prefsWriteError}
          </Text>
        ) : null}

        <SettingsGroup title="训练偏好" spaced>
          <View style={styles.weightRow}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>体重估算（千克）</Text>
              <Text style={styles.rowDesc}>点按数字可快速输入，教练课优先读最近称重</Text>
            </View>
            <View style={styles.weightControl}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="体重减一千克"
                disabled={!prefs}
                style={({ pressed }) => [styles.weightButton, pressed && { opacity: sport.opacity.pressed }]}
                onPress={() => adjustWeight(-1)}
              >
                <Text style={styles.weightButtonText}>−</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`当前体重 ${Math.round(prefs?.bodyWeightKg ?? 65)} 千克，点按输入`}
                disabled={!prefs}
                onPress={openWeightSheet}
                style={styles.weightValueButton}
              >
                <Text style={styles.weightValue}>{Math.round(prefs?.bodyWeightKg ?? 65)}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="体重加一千克"
                disabled={!prefs}
                style={({ pressed }) => [styles.weightButton, pressed && { opacity: sport.opacity.pressed }]}
                onPress={() => adjustWeight(1)}
              >
                <Text style={styles.weightButtonText}>＋</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.rowCaption} accessibilityHint="历史成绩保留训练时的体重。">
            热量结合体重与步频自动估算，历史成绩保留当时的计算方式。
          </Text>
        </SettingsGroup>

        <SettingsGroup title="锁屏与后台" spaced>
          <BackgroundTrainingReadiness grouped />
        </SettingsGroup>

        <SettingsGroup title="数据与帮助" spaced>
          <Disclosure icon="database" title="备份与导出" summary="本地备份、Excel 与恢复" compact marginTop={0}>
            <View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="导出备份"
                accessibilityHint="导出楼栋模板、旧版路线与训练成绩"
                style={({ pressed }) => [styles.dataRow, pressed && { opacity: sport.opacity.pressed }]}
                onPress={() => {
                  void handleExport('share')
                }}
                disabled={dataBusy}
              >
                <UIIcon name="download" size={20} color={theme.inkSoft} />
                <View style={styles.rowText}>
                  <Text style={styles.dataTitle}>导出备份</Text>
                </View>
                {exportTarget === 'share' ? <Text style={styles.rowAction}>导出中…</Text> : <UIIcon name="chevron-right" size={18} color={theme.mutedStrong} />}
              </Pressable>
              {isLocalDownloadExportAvailable() ? (
                <>
                  <View style={styles.divider} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="保存备份到下载"
                    accessibilityHint="保存到本机 Download/循阶，包含楼栋模板、旧版路线与训练成绩"
                    style={({ pressed }) => [styles.dataRow, pressed && { opacity: sport.opacity.pressed }]}
                    onPress={() => {
                      void handleExport('downloads')
                    }}
                    disabled={dataBusy}
                  >
                    <UIIcon name="download" size={20} color={theme.inkSoft} />
                    <View style={styles.rowText}>
                      <Text style={styles.dataTitle}>保存备份到下载</Text>
                    </View>
                    {exportTarget === 'downloads' ? <Text style={styles.rowAction}>保存中…</Text> : <UIIcon name="chevron-right" size={18} color={theme.mutedStrong} />}
                  </Pressable>
                </>
              ) : null}
              <View style={styles.divider} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="导出成绩表 Excel"
                accessibilityHint="训练记录表格，可用 Excel 打开"
                style={({ pressed }) => [styles.dataRow, pressed && { opacity: sport.opacity.pressed }]}
                onPress={handleExportCsv}
                disabled={dataBusy}
              >
                <UIIcon name="table" size={20} color={theme.inkSoft} />
                <View style={styles.rowText}>
                  <Text style={styles.dataTitle}>导出成绩表 Excel</Text>
                </View>
                {exportingCsv ? <Text style={styles.rowAction}>导出中…</Text> : <UIIcon name="chevron-right" size={18} color={theme.mutedStrong} />}
              </Pressable>
              <View style={styles.divider} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="导入备份"
                accessibilityHint="从备份文件恢复楼栋模板、旧版路线与训练成绩"
                style={({ pressed }) => [styles.dataRow, pressed && { opacity: sport.opacity.pressed }]}
                onPress={handleImport}
                disabled={dataBusy}
              >
                <UIIcon name="upload" size={20} color={theme.inkSoft} />
                <View style={styles.rowText}>
                  <Text style={styles.dataTitle}>导入备份</Text>
                </View>
                {importing ? <Text style={styles.rowAction}>导入中…</Text> : <UIIcon name="chevron-right" size={18} color={theme.mutedStrong} />}
              </Pressable>
              <View style={styles.divider} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="撤销上次导入"
                accessibilityHint="保留当前数据副本，然后恢复到上次导入前的记录"
                style={({ pressed }) => [
                  styles.dataRow,
                  (dataBusy || recoveryLoading || !canUndoImport) && { opacity: 0.55 },
                  pressed && { opacity: sport.opacity.pressed },
                ]}
                onPress={confirmUndo}
                disabled={dataBusy || recoveryLoading || !canUndoImport}
              >
                <UIIcon name="undo" size={20} color={canUndoImport ? theme.inkSoft : theme.mutedStrong} />
                <View style={styles.rowText}>
                  <Text style={styles.dataTitle}>撤销上次导入</Text>
                  <Text style={styles.rowDesc}>
                    {recoveryLoading
                      ? '正在读取恢复副本…'
                      : recoveryError
                        ? '恢复副本暂时无法读取'
                        : canUndoImport
                          ? '恢复导入前记录，当前数据另存副本'
                          : '没有可撤销的导入'}
                  </Text>
                </View>
                {undoing ? <ActivityIndicator color={theme.brandText} /> : null}
              </Pressable>
              {undoBackups.length > 0 ? (
                <>
                  <View style={styles.divider} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="导出撤销前备份"
                    accessibilityState={{ expanded: showUndoBackups }}
                    style={({ pressed }) => [styles.dataRow, pressed && { opacity: sport.opacity.pressed }]}
                    onPress={() => {
                      setShowUndoBackups(value => !value)
                    }}
                    disabled={dataBusy || recoveryLoading}
                  >
                    <UIIcon name="shield" size={20} color={theme.inkSoft} />
                    <View style={styles.rowText}>
                      <Text style={styles.dataTitle}>导出撤销前备份</Text>
                      <Text style={styles.rowDesc}>{undoBackups.length} 份历史副本，按撤销时间选择</Text>
                    </View>
                    {exportingUndo ? (
                      <ActivityIndicator color={theme.brandText} />
                    ) : (
                      <UIIcon name={showUndoBackups ? 'chevron-up' : 'chevron-down'} size={18} color={theme.mutedStrong} />
                    )}
                  </Pressable>
                </>
              ) : null}
              {showUndoBackups && undoBackups.length > 0 ? (
                <View style={styles.undoBackups}>
                  <Text style={styles.rowDesc}>每次撤销前的数据都单独保留。选择时间，将该副本导出为备份文件。</Text>
                  {undoBackups.slice(undoBackupPage * UNDO_PAGE_SIZE, (undoBackupPage + 1) * UNDO_PAGE_SIZE).map(snapshot => (
                    <Pressable
                      key={snapshot.id}
                      accessibilityRole="button"
                      accessibilityLabel={`导出撤销前备份 ${snapshotTime(snapshot.savedAt)}`}
                      testID={`undo-backup-${snapshot.id}`}
                      disabled={dataBusy}
                      style={styles.dataRow}
                      onPress={() => {
                        void exportUndoBackup(snapshot.id)
                      }}
                    >
                      <View style={styles.rowText}>
                        <Text style={styles.dataTitle}>{snapshotTime(snapshot.savedAt)}</Text>
                        <Text style={styles.rowDesc}>撤销前的训练、路线与楼栋数据</Text>
                      </View>
                      <Text style={styles.rowAction}>导出</Text>
                    </Pressable>
                  ))}
                  {undoBackups.length > UNDO_PAGE_SIZE ? (
                    <View style={styles.row}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="较新的撤销前备份"
                        disabled={dataBusy || undoBackupPage === 0}
                        style={styles.pagerButton}
                        onPress={() => setUndoBackupPage(page => Math.max(0, page - 1))}
                      >
                        <Text style={[styles.previewActionText, { opacity: undoBackupPage === 0 ? 0.45 : 1 }]}>较新</Text>
                      </Pressable>
                      <Text style={styles.rowDesc}>
                        {undoBackupPage + 1} / {Math.ceil(undoBackups.length / UNDO_PAGE_SIZE)}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="较早的撤销前备份"
                        disabled={dataBusy || (undoBackupPage + 1) * UNDO_PAGE_SIZE >= undoBackups.length}
                        style={styles.pagerButton}
                        onPress={() =>
                          setUndoBackupPage(page => Math.min(Math.ceil(undoBackups.length / UNDO_PAGE_SIZE) - 1, page + 1))
                        }
                      >
                        <Text
                          style={[
                            styles.previewActionText,
                            { opacity: (undoBackupPage + 1) * UNDO_PAGE_SIZE >= undoBackups.length ? 0.45 : 1 },
                          ]}
                        >
                          较早
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ) : null}
              {recoveryError ? (
                <View>
                  <Text accessibilityRole="alert" style={styles.messageText}>{recoveryError}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="重新读取恢复副本"
                    style={styles.dataRow}
                    disabled={dataBusy || recoveryLoading}
                    onPress={() => {
                      void refreshRecovery()
                    }}
                  >
                    <Text style={[styles.dataTitle, { color: theme.brandText }]}>重新读取恢复副本</Text>
                  </Pressable>
                </View>
              ) : null}
              {exportMessage ? <Text accessibilityLiveRegion="polite" style={styles.messageText}>{exportMessage}</Text> : null}
              {importMessage ? <Text accessibilityLiveRegion="polite" style={styles.messageText}>{importMessage}</Text> : null}
              <Text style={styles.rowCaption}>备份包含楼栋模板、旧版路线与训练成绩。原始传感器采样文件需单独导出。</Text>
            </View>
          </Disclosure>

          <View style={styles.divider} />

          <Disclosure icon="help" title="帮助与关于" summary="隐私协议、引导与原理" compact marginTop={0}>
            <View>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.dataRow, pressed && { opacity: sport.opacity.pressed }]}
                onPress={() => navigation.navigate('Privacy', { from: 'settings' })}
              >
                <UIIcon name="file-text" size={20} color={theme.inkSoft} />
                <Text style={[styles.dataTitle, { flex: 1 }]}>隐私协议</Text>
                <UIIcon name="chevron-right" size={18} color={theme.mutedStrong} />
              </Pressable>
              <View style={styles.divider} />
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.dataRow, pressed && { opacity: sport.opacity.pressed }]}
                onPress={() => navigation.navigate('Onboarding', { from: 'settings' })}
              >
                <UIIcon name="book-open" size={20} color={theme.inkSoft} />
                <Text style={[styles.dataTitle, { flex: 1 }]}>新手引导</Text>
                <UIIcon name="chevron-right" size={18} color={theme.mutedStrong} />
              </Pressable>
              <View style={styles.divider} />
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.dataRow, pressed && { opacity: sport.opacity.pressed }]}
                onPress={() =>
                  Alert.alert(
                    '如何判断爬楼',
                    '首次在一栋楼训练时，每到一层点一下“到了一层”，到顶点“到顶了”。保存楼栋后，下次选择它开始自动计层。\n\n' +
                      '应用结合标定时的逐层高度、步数、转弯与当前传感器数据估算楼层。气压帮助判断爬升与下行；缺少气压时使用运动数据估算。楼梯结构、携带方式或采样中断都可能影响结果，请在结算时核对实际层数。\n\n' +
                      '当前楼层与爬升层数不同：从 1 楼到 2 楼，爬升 1 层。新训练从 1 到 15 楼记为爬升 14 层；未标新口径的旧成绩保留原值。\n\n' +
                      (isBackgroundTrainingSupported()
                        ? '正式锻炼时，这个 Android 版本可以在锁屏后继续记录，并显示通知。系统强制关闭或权限改变仍可能打断记录；结束时可以确认实际楼层。熟悉路线时，请保持页面打开。\n\n'
                        : '训练中请保持屏幕点亮。锁屏或切到其它应用时，系统会暂停传感器，这段时间的楼层不会被记录。返回后会提示后台缺段，结束时可手动修正最终楼层。\n\n') +
                      '携带方式变化可能影响识别，你可以随时确认实际楼层和结束本轮。',
                    [{ text: '知道了' }],
                  )
                }
              >
                <UIIcon name="info" size={20} color={theme.inkSoft} />
                <Text style={[styles.dataTitle, { flex: 1 }]}>如何判断爬楼</Text>
                <UIIcon name="chevron-right" size={18} color={theme.mutedStrong} />
              </Pressable>
            </View>
          </Disclosure>

          {__DEV__ || process.env.EXPO_PUBLIC_DIAGNOSTIC_CAPTURE === '1' ? (
            <>
              <View style={styles.divider} />
              <Disclosure icon="settings" title="诊断工具" summary="开发与采样" compact marginTop={0}>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.dataRow, pressed && { opacity: sport.opacity.pressed }]}
                  onPress={() => navigation.navigate('DiagnosticCapture')}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.dataTitle}>测试采样</Text>
                    <Text style={styles.rowDesc}>本地采集、标注并导出脱敏样本（验收采样）</Text>
                  </View>
                  <UIIcon name="chevron-right" size={18} color={theme.mutedStrong} />
                </Pressable>
              </Disclosure>
            </>
          ) : null}
        </SettingsGroup>

        <Text style={styles.appFooter}>循阶 · {APP_VERSION}</Text>
      </ScrollView>

      <FlowSheet
        visible={weightSheetOpen}
        title="调整估算体重（千克）"
        onClose={() => setWeightSheetOpen(false)}
      >
        <View style={styles.weightQuickRow}>
          {([-5, -1, 1, 5] as const).map(step => (
            <Pressable
              key={step}
              accessibilityRole="button"
              accessibilityLabel={`体重${step > 0 ? '加' : '减'}${Math.abs(step)}千克`}
              onPress={() => {
                const base = Number.parseFloat(weightDraft) || Math.round(prefs?.bodyWeightKg ?? 65)
                setWeightDraft(String(Math.min(200, Math.max(30, Math.round(base + step)))))
              }}
              style={({ pressed }) => [styles.weightQuickChip, pressed && { opacity: sport.opacity.pressed }]}
            >
              <Text style={styles.weightQuickText}>{step > 0 ? `+${step}` : String(step)}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          accessibilityLabel="输入体重（千克）"
          value={weightDraft}
          onChangeText={setWeightDraft}
          keyboardType="number-pad"
          maxLength={3}
          placeholder="30–200"
          placeholderTextColor={theme.muted}
          style={styles.weightInput}
          returnKeyType="done"
          onSubmitEditing={commitWeightDraft}
        />
        <Button title="保存体重" onPress={commitWeightDraft} />
      </FlowSheet>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: theme.pagePaddingH, paddingTop: 6 },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
      marginBottom: 8,
    },
    sectionTitle: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
      letterSpacing: 0.4,
      color: theme.mutedStrong,
    },
    sectionBadge: {
      paddingHorizontal: 9,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: theme.brandSoft,
    },
    sectionBadgeText: {
      fontSize: 11,
      lineHeight: 16,
      fontWeight: '700',
      color: theme.brandText,
    },
    group: { padding: 14, borderRadius: theme.radius.md, gap: sport.space.xs },
    nextGroup: { marginTop: 20 },
    voiceControl: { gap: sport.space.sm, marginTop: 10 },
    subGroupHeading: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '700',
      color: theme.mutedStrong,
      marginTop: 14,
      marginBottom: 2,
    },
    detailGroup: { paddingTop: 0, paddingBottom: 0 },
    previewAction: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: sport.space.sm,
    },
    pagerButton: {
      minHeight: 48,
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    previewActionText: { color: theme.brandInk, fontSize: sport.type.secondary, lineHeight: 20, fontWeight: '600' },
    dataRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sport.space.md,
      minHeight: 52,
      paddingVertical: sport.space.sm,
    },
    dataTitle: { color: theme.ink, ...typography.label },
    undoBackups: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: theme.lineSoft,
      paddingHorizontal: sport.space.sm,
      paddingTop: sport.space.sm,
    },
    appFooter: { color: theme.mutedStrong, fontSize: 12, lineHeight: 18, textAlign: 'center', paddingTop: 20 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: sport.space.md,
      paddingVertical: sport.space.sm,
      minHeight: 58,
    },
    switchHost: {
      width: 60,
      minHeight: 48,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: { color: theme.ink, ...typography.label },
    rowDesc: { marginTop: 2, color: theme.mutedStrong, ...typography.secondary },
    rowCaption: { marginTop: 6, color: theme.mutedStrong, ...typography.caption },
    weightRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 4,
    },
    weightControl: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    weightButton: {
      width: 48,
      height: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.lineSoft,
      backgroundColor: theme.surfaceSoft,
    },
    weightButtonText: { color: theme.ink, fontSize: 20, fontWeight: '700', lineHeight: 22 },
    weightValueButton: {
      minWidth: 52,
      minHeight: 48,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      borderBottomWidth: 1.5,
      borderStyle: 'dashed',
      borderBottomColor: theme.brandText,
    },
    weightValue: { ...typography.digits, color: theme.ink, fontSize: 22, lineHeight: 28, textAlign: 'center' },
    weightQuickRow: { flexDirection: 'row', gap: 8 },
    weightQuickChip: {
      flex: 1,
      minHeight: 48,
      borderRadius: 12,
      backgroundColor: theme.surfaceSoft,
      borderWidth: 1,
      borderColor: theme.lineSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    weightQuickText: { ...typography.digits, color: theme.brandText, fontSize: 16 },
    weightInput: {
      ...typography.digits,
      fontSize: 24,
      textAlign: 'center',
      minHeight: 54,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.line,
      backgroundColor: theme.card,
      color: theme.ink,
      paddingHorizontal: 14,
    },
    rowAction: { color: theme.brandText, fontSize: 13, fontWeight: '600' },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.lineSoft, marginVertical: 2 },
    messageText: { color: theme.mutedStrong, fontSize: 13, lineHeight: 20, marginTop: 8 },
  })
