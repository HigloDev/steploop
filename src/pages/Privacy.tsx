// 隐私协议页：展示协议内容，同意后 agreePrivacy；未看过引导则进入 Onboarding，否则进入主应用。

import React, { useState } from 'react'
import { Alert, BackHandler, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'

import { Header } from '../components/Header'
import { Button } from '../components/ui'
import { FlowSheet } from '../components/flow-sheet'
import { useTheme, Theme } from '../theme'
import { RootStackScreen, RootStackNavigation } from '../navigation/types'
import { agreePrivacy } from '../services/privacy'
import { hasSeenOnboarding } from '../services/onboarding'
import { HISTORY_SESSION_LIMIT, HISTORY_WORKOUT_LIMIT } from '../services/history-repository'

// Date of this description revision; it must not change whenever the page opens.
const PRIVACY_NOTICE_UPDATED_AT = '2026-10-15'
const FEEDBACK_URL = 'https://github.com/HigloDev/steploop/issues'

export default function PrivacyScreen({ route }: RootStackScreen<'Privacy'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const navigation = useNavigation<RootStackNavigation>()
  const from = route.params?.from
  const fromSettings = from === 'settings'
  const [agreeing, setAgreeing] = useState(false)
  const [rejecting, setRejecting] = useState(false)

  const handleAgree = async () => {
    if (agreeing) return
    setAgreeing(true)
    try {
      await agreePrivacy()
      const seen = await hasSeenOnboarding()
      if (!seen) {
        navigation.replace('Onboarding')
      } else {
        navigation.replace('Main')
      }
    } catch (err) {
      setAgreeing(false)
      Alert.alert('同意失败', err instanceof Error ? err.message : '请稍后重试。')
    }
  }

  const handleReject = () => setRejecting(true)
  const leaveWithoutAgreeing = () => {
    setRejecting(false)
    if (navigation.canGoBack()) navigation.goBack()
    else if (Platform.OS === 'android') BackHandler.exitApp()
  }

  return (
    <View style={styles.page}>
      <Header title="隐私协议" align="left" back={from === 'route-edit' || (navigation.canGoBack() as boolean)} />
      <ScrollView
        style={styles.flex}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
      >
        <View style={styles.hero}>
          <Text style={styles.title}>你的记录，留在本机</Text>
          <Text style={styles.subtitle}>了解运动数据如何收集、保存、导出与删除。</Text>
        </View>

        <PrivacySection number="01" title="信息收集" summary="训练期间使用运动传感器数据，辅助判断爬楼状态。">
          <Text style={styles.paragraph}>本应用仅在用户主动操作时收集以下信息：</Text>
          <Text style={styles.itemDesc}>当前版本以楼栋模板标定与训练为主，开始爬楼无需地图选点。旧版路线、地点与成绩继续保留。</Text>
          <Text style={styles.itemLabel}>· 地理位置</Text>
          <Text style={styles.itemDesc}>旧版路线可能含有你在地图上选择的建筑位置。当前训练入口不使用定位来判断楼层；这些历史地点仍可能包含在你主动导出的备份中。</Text>
          <Text style={styles.itemLabel}>· 运动传感器</Text>
          <Text style={styles.itemDesc}>包括加速度、旋转、气压及设备可用的步数信息。仅在你主动开始标定、训练或诊断时读取，用于识别楼层与运动过程。</Text>
          <Text style={styles.itemLabel}>· 设备标识</Text>
          <Text style={styles.itemDesc}>仅记录设备型号、平台与系统版本，用于在更换手机时提示重新验证路线模板，不上传任何唯一标识。</Text>
        </PrivacySection>

        <PrivacySection number="02" title="信息存储" summary="运动记录保存在本机，可由你主动导出。">
          <Text style={styles.paragraph}>所有楼栋模板、旧版路线、爬楼记录与成绩摘要均存储在本地存储中，保存在当前设备下，不会上传到任何服务器。</Text>
          <Text style={styles.paragraph}>训练时按约 10 Hz 留存原始运动样本，采样中断会保留缺段记录。识别结果、人工修正和语音播报日志也保存在本机，可由你主动导出用于电脑分析，不会自动上传。</Text>
          <Text style={styles.paragraph}>标定复核使用当前采集草稿；离开页面不会清除已经保存的训练分析文件。</Text>
          <Text style={styles.paragraph}>
            开发者诊断包仅在用户主动导出时生成，不会自动上传。诊断包包含：你填写的化名与
            设备品牌、携带方式、平台、数据包与算法版本，以及脱敏后的传感器样本；
            不包含地点（坐标 / 地址 / 建筑名称）、精确机型与序列号、绝对采集日历时间（时间轴会整体偏移）。
          </Text>
          <Text style={styles.paragraph}>
            化名与设备品牌必须填写（化名只允许代码，不要填真实姓名或联系方式），
            否则无法导出——这样每个数据包都可以被追溯到同一位采集者，而无需记录身份信息。
          </Text>
          <Text style={styles.paragraph}>
            训练明细保留最近 {HISTORY_WORKOUT_LIMIT} 条，旧版单轮明细保留最近 {HISTORY_SESSION_LIMIT} 条。
            更早记录的统计贡献会归档保留（次数、楼层、爬升、净时长和按天分布），归档条数会在记录页显示。
            进行中的训练恢复点不参与归档。
          </Text>
        </PrivacySection>

        <PrivacySection number="03" title="信息使用" summary="用于计层、成绩展示和训练诊断。">
          <Text style={styles.paragraph}>收集的信息仅用于：</Text>
          <Text style={styles.itemDesc}>· 显示你保存的楼栋模板与旧版路线信息</Text>
          <Text style={styles.itemDesc}>· 识别当前楼层、步态与转向事件</Text>
          <Text style={styles.itemDesc}>· 生成本地成绩摘要（仅包含路线名称与运动成绩）</Text>
          <Text style={styles.itemDesc}>· 在更换手机时提示重新验证</Text>
        </PrivacySection>

        <PrivacySection number="04" title="信息共享" summary="不会自动向第三方上传运动记录。">
          <Text style={styles.paragraph}>运动记录不会自动上传或共享给第三方，也不会用于广告。只有你主动导出或分享时，文件才会交给你选择的目标应用。</Text>
          <Text style={styles.paragraph}>旧版地图选点使用高德在线地图服务，加载地图、搜索地点和解析地址时会发送必要的位置或搜索信息。当前首页的“开始爬楼”不需要地图选点；主动分享旧版路线或导出备份前，请留意其中可能包含的地点信息。</Text>
        </PrivacySection>

        <PrivacySection number="05" title="信息删除" summary="可删除楼栋模板，历史训练会保留。">
          <Text style={styles.paragraph}>可在首页楼栋卡片的管理菜单中删除楼栋模板。旧版路线在首页移除后，其原始数据仍保留在备份中；已保存的训练不受影响，有路线快照的记录继续显示当次信息。</Text>
          <Text style={styles.paragraph}>卸载应用或清除应用数据将永久删除所有本地数据，无法恢复。</Text>
        </PrivacySection>

        <PrivacySection number="06" title="技术边界" summary="楼层估算会受携带方式和后台采样影响。">
          <Text style={styles.paragraph}>· 楼层和爬升是结合运动样本、可用气压与路线模板得到的估算，实际到达楼层可由你确认或修正。</Text>
          <Text style={styles.paragraph}>· 手机定位仅用于确定建筑和附近路线排序，不用于室内测高。</Text>
          <Text style={styles.paragraph}>· 识别受手机型号、携带位置和路线影响；更换手机或携带方式后建议重新验证。</Text>
          <Text style={styles.paragraph}>· 锁屏持续采集需要系统允许后台训练和相应权限，部分手机的省电策略仍可能中断采样。缺段会保留记录并提醒，不会补造样本。</Text>
        </PrivacySection>

        <PrivacySection number="07" title="联系方式" summary="可通过项目反馈页联系开发者。">
          <Text style={styles.paragraph}>如有疑问，可在项目反馈页描述问题。请勿公开上传完整备份、位置或其他个人信息。</Text>
          <Pressable accessibilityRole="link" accessibilityLabel="打开循阶项目反馈页" onPress={() => { void Linking.openURL(FEEDBACK_URL).catch(() => Alert.alert('无法打开反馈页', '请复制下方地址，在浏览器中打开。')) }} style={{ minHeight: 48, justifyContent: 'center' }}>
            <Text style={[styles.paragraph, { color: theme.brandInk }]}>打开项目反馈页</Text>
          </Pressable>
          <Text selectable style={styles.itemDesc}>{FEEDBACK_URL}</Text>
        </PrivacySection>

        <Text style={styles.version}>隐私说明 1.0 · 内容更新日期 {PRIVACY_NOTICE_UPDATED_AT}</Text>

      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
        {fromSettings ? <Button title="返回设置" onPress={() => navigation.goBack()} /> : <>
        <Button title="同意并开始" style={{ minHeight: 48, paddingVertical: 6 }} onPress={handleAgree} loading={agreeing} />
        <Pressable style={styles.rejectBtn} accessibilityRole="button" disabled={agreeing} onPress={handleReject}>
          <Text style={styles.rejectText}>不同意</Text>
        </Pressable>
        </>}
      </View>
      <FlowSheet visible={rejecting} title="未同意隐私协议" onClose={() => setRejecting(false)}>
        <Text style={styles.paragraph}>未同意前无法开始标定和训练。可以稍后重新进入应用，再查看并确认。</Text>
        <Button title="返回协议" onPress={() => setRejecting(false)} />
        {navigation.canGoBack() || Platform.OS === 'android' ? <Button title={navigation.canGoBack() ? '返回上一页' : '退出应用'} variant="secondary" onPress={leaveWithoutAgreeing} /> : null}
      </FlowSheet>
    </View>
  )
}

/** Summaries follow the approved layout; every original policy paragraph remains expandable. */
function PrivacySection({ number, title, summary, children }: { number: string; title: string; summary: string; children: React.ReactNode }) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  return <View style={{ backgroundColor: theme.card, borderRadius: 20, marginBottom: 6, paddingHorizontal: 18 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}，查看完整协议`} accessibilityState={{ expanded: open }}
      accessibilityHint="点开查看完整协议正文" onPress={() => setOpen(value => !value)} style={{ flexDirection: 'row', gap: 18, paddingVertical: 8, minHeight: 66, alignItems: 'flex-start' }}>
      <Text style={{ ...theme.numeric, color: theme.brand, fontSize: 28, lineHeight: 32, marginTop: 4 }}>{number}</Text>
      <View style={{ flex: 1 }}><Text style={{ color: theme.ink, fontSize: 19, lineHeight: 24, fontWeight: '900' }}>{title}</Text>
        <Text style={{ color: theme.mutedStrong, fontSize: 15, lineHeight: 20, marginTop: 2 }}>{summary}</Text></View>
    </Pressable>
    {open ? <View style={{ paddingTop: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: theme.line }}>{children}</View> : null}
  </View>
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 8 },
    hero: { marginBottom: 8, gap: 8 },
    eyebrow: {
      color: theme.brand,
      fontSize: theme.fontEyebrow,
      fontWeight: '700',
    },
    title: {
      color: theme.ink,
      fontSize: 36,
      fontWeight: '900',
      lineHeight: 42,
    },
    subtitle: {
      color: theme.mutedStrong,
      fontSize: 14,
      lineHeight: 20,
    },
    card: {
      paddingVertical: 20,
      borderBottomWidth: 0,
      borderBottomColor: theme.line,
     backgroundColor: theme.card, borderRadius: theme.radiusLg, paddingHorizontal: 20, marginBottom: 12,},
    sectionTitle: {
      color: theme.ink,
      fontSize: 19,
      lineHeight: 24,
      fontWeight: '900',
      marginBottom: 12,
    },
    paragraph: {
      color: theme.inkSoft,
      fontSize: theme.fontBase,
      lineHeight: 22,
      marginBottom: 8,
    },
    itemLabel: {
      color: theme.ink,
      fontSize: theme.fontBase,
      lineHeight: 22,
      fontWeight: '600',
      marginTop: 8,
      marginBottom: 4,
    },
    itemDesc: {
      color: theme.mutedStrong,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      marginBottom: 8,
    },
    version: {
      color: theme.muted,
      fontSize: theme.fontSmall,
      lineHeight: 18,
      textAlign: 'center',
      marginTop: 2,
      marginBottom: 0,
    },
    rejectBtn: {
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 6,
      borderWidth: 1,
      borderColor: theme.mutedStrong,
      borderRadius: 22,
    },
    rejectText: {
      color: theme.muted,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '600',
    },
    footer: { backgroundColor: theme.paper, borderTopWidth: 0, borderTopColor: theme.line, paddingHorizontal: theme.pagePaddingH, paddingTop: 8 },
  })
