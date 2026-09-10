// 设置页：震动/声音反馈开关 + 数据导出/导入 + 关于。

import React, { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Header } from '../components/Header'
import { Button, Card } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import {
  getPreferences,
  savePreferences,
  triggerHaptic,
  Preferences as Prefs,
} from '../services/preferences'
import { exportBackup, importBackup } from '../services/backup'

const APP_VERSION = '1.0.0'

export default function SettingsScreen({ navigation }: RootStackScreen<'Settings'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  const [importMessage, setImportMessage] = useState('')

  useEffect(() => {
    getPreferences().then(setPrefs).catch(() => undefined)
  }, [])

  const update = async (patch: Partial<Prefs>) => {
    const next = await savePreferences(patch)
    setPrefs(next)
  }

  const toggleHaptic = (value: boolean) => {
    update({ hapticFeedback: value })
    if (value) triggerHaptic('light')
  }

  const toggleSound = (value: boolean) => {
    update({ soundFeedback: value })
  }

  const adjustWeight = (delta: number) => {
    const current = prefs?.bodyWeightKg ?? 65
    update({ bodyWeightKg: Math.min(200, Math.max(30, current + delta)) })
  }

  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    setExportMessage('正在生成备份文件…')
    try {
      const result = await exportBackup()
      setExportMessage(result.message)
    } catch (err) {
      setExportMessage(`导出失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setExporting(false)
    }
  }

  const handleImport = () => {
    Alert.alert(
      '导入备份',
      '导入会用备份文件中的路线和成绩覆盖当前设备数据，无法撤销。确定继续吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '覆盖导入',
          style: 'destructive',
          onPress: runImport,
        },
      ],
    )
  }

  const runImport = async () => {
    if (importing) return
    setImporting(true)
    setImportMessage('请选择备份文件…')
    try {
      const result = await importBackup()
      setImportMessage(
        `已导入 ${result.routesCount} 条路线、${result.sessionsCount} 条成绩`,
      )
      Alert.alert('导入成功', '建议重新打开应用以确保所有页面刷新最新数据。', [
        { text: '知道了' },
      ])
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知错误'
      if (message === 'CANCEL') {
        setImportMessage('')
      } else {
        setImportMessage(`导入失败：${message}`)
        Alert.alert('导入失败', message)
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <View style={styles.page}>
      <Header title="设置" />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        <Text style={styles.sectionLabel}>运动资料</Text>
        <Card raised style={styles.group}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>体重</Text>
              <Text style={styles.rowDesc}>用于估算爬楼消耗，可随时调整</Text>
            </View>
            <View style={styles.weightControl}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="体重减一千克"
                style={styles.weightButton}
                onPress={() => adjustWeight(-1)}
              >
                <Text style={styles.weightButtonText}>−</Text>
              </Pressable>
              <Text style={styles.weightValue}>
                {Math.round(prefs?.bodyWeightKg ?? 65)} 千克
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="体重加一千克"
                style={styles.weightButton}
                onPress={() => adjustWeight(1)}
              >
                <Text style={styles.weightButtonText}>＋</Text>
              </Pressable>
            </View>
          </View>
        </Card>

        <Text style={styles.sectionLabel}>反馈</Text>
        <Card raised style={styles.group}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>震动反馈</Text>
              <Text style={styles.rowDesc}>识别推进、转向事件、结束时触发</Text>
            </View>
            <Switch
              value={Boolean(prefs?.hapticFeedback)}
              onValueChange={toggleHaptic}
              trackColor={{ false: theme.line, true: theme.green }}
              thumbColor={theme.card}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>声音反馈</Text>
              <Text style={styles.rowDesc}>仅在结束时短促提示</Text>
            </View>
            <Switch
              value={Boolean(prefs?.soundFeedback)}
              onValueChange={toggleSound}
              trackColor={{ false: theme.line, true: theme.green }}
              thumbColor={theme.card}
            />
          </View>
        </Card>

        <Text style={styles.sectionLabel}>数据</Text>
        <Card raised style={styles.group}>
          <Pressable style={styles.row} onPress={handleExport} disabled={exporting}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>导出备份</Text>
              <Text style={styles.rowDesc}>导出路线与成绩数据文件</Text>
            </View>
            <Text style={styles.rowAction}>{exporting ? '导出中…' : '导出'}</Text>
          </Pressable>
          {exportMessage ? (
            <Text style={styles.messageText}>{exportMessage}</Text>
          ) : null}
          <View style={styles.divider} />
          <Pressable style={styles.row} onPress={handleImport} disabled={importing}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>导入备份</Text>
              <Text style={styles.rowDesc}>从数据文件恢复路线与成绩</Text>
            </View>
            <Text style={styles.rowAction}>{importing ? '导入中…' : '导入'}</Text>
          </Pressable>
          {importMessage ? (
            <Text style={styles.messageText}>{importMessage}</Text>
          ) : null}
        </Card>

        <Text style={styles.sectionLabel}>关于</Text>
        <Card raised style={styles.group}>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>版本</Text>
            <Text style={styles.rowValue}>{APP_VERSION}</Text>
          </View>
          <View style={styles.divider} />
          <Pressable
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
            onPress={() => navigation.navigate('DiagnosticCapture')}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>测试采样（封测）</Text>
              <Text style={styles.rowDesc}>本地采集、人工标注并主动导出脱敏样本</Text>
            </View>
            <Text style={styles.rowAction}>进入</Text>
          </Pressable>
          {__DEV__ && (
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
        </Card>

        <Button
          title="返回首页"
          variant="secondary"
          onPress={() => navigation.navigate('RouteEdit')}
        />
      </ScrollView>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: theme.pagePaddingH },
    sectionLabel: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
      marginTop: 18,
      marginBottom: 8,
      paddingHorizontal: 4,
    },
    group: {
      padding: 14,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingVertical: 6,
    },
    rowText: {
      flex: 1,
    },
    rowTitle: {
      color: theme.ink,
      fontSize: 15,
      fontWeight: '600',
    },
    rowDesc: {
      marginTop: 3,
      color: theme.muted,
      fontSize: 12,
    },
    weightControl: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    weightButton: {
      width: 34,
      height: 34,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.line,
      backgroundColor: theme.surfaceSoft,
    },
    weightButtonText: {
      color: theme.green,
      fontSize: 20,
      fontWeight: '700',
      lineHeight: 22,
    },
    weightValue: {
      minWidth: 58,
      color: theme.ink,
      fontSize: 14,
      fontWeight: '800',
      textAlign: 'center',
    },
    rowValue: {
      color: theme.muted,
      fontSize: 14,
    },
    rowAction: {
      color: theme.green,
      fontSize: 14,
      fontWeight: '600',
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.line,
      marginVertical: 6,
    },
    messageText: {
      color: theme.muted,
      fontSize: 12,
      marginTop: 6,
    },
  })
