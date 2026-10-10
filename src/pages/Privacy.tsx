// 隐私协议页：展示协议内容，同意后 agreePrivacy；未看过引导则进入 Onboarding，否则进入主应用。

import React, { useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'

import { Header } from '../components/Header'
import { Button } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen, RootStackNavigation } from '../navigation/types'
import { agreePrivacy } from '../services/privacy'
import { hasSeenOnboarding } from '../services/onboarding'
import { HISTORY_SESSION_LIMIT, HISTORY_WORKOUT_LIMIT } from '../services/history-repository'

export default function PrivacyScreen({ route }: RootStackScreen<'Privacy'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const navigation = useNavigation<RootStackNavigation>()
  const from = route.params?.from
  const [agreeing, setAgreeing] = useState(false)

  const today = new Date()
  const effectiveDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

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

  const handleReject = () => {
    Alert.alert(
      '未同意隐私协议',
      '不同意将无法使用需要位置与传感器的功能。可以稍后在重新进入时确认。',
      [
        { text: '返回协议', style: 'cancel' },
        {
          text: '退出应用',
          style: 'destructive',
          onPress: () => {
            if (navigation.canGoBack()) {
              navigation.goBack()
            } else {
              navigation.replace('Main')
            }
          },
        },
      ],
    )
  }

  return (
    <View style={styles.page}>
      <Header title="隐私协议" back={from === 'route-edit' || (navigation.canGoBack() as boolean)} />
      <ScrollView
        style={styles.flex}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
      >
        <View style={styles.hero}>
          <Text style={styles.title}>隐私协议</Text>
          <Text style={styles.subtitle}>你的运动记录保存在本机。这里说明会收集哪些信息，以及如何保存、导出和删除。</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>1. 信息收集</Text>
          <Text style={styles.paragraph}>本应用仅在用户主动操作时收集以下信息：</Text>
          <Text style={styles.itemLabel}>· 地理位置</Text>
          <Text style={styles.itemDesc}>用于在地图上选择爬楼建筑并按距离推荐附近已标定路线。仅在创建或修改路线时使用。</Text>
          <Text style={styles.itemLabel}>· 运动传感器</Text>
          <Text style={styles.itemDesc}>包括加速度、旋转、气压及设备可用的步数信息。仅在你主动开始标定、训练或诊断时读取，用于识别楼层与运动过程。</Text>
          <Text style={styles.itemLabel}>· 设备标识</Text>
          <Text style={styles.itemDesc}>仅记录设备型号、平台与系统版本，用于在更换手机时提示重新验证路线模板，不上传任何唯一标识。</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>2. 信息存储</Text>
          <Text style={styles.paragraph}>所有路线模板、爬楼记录与成绩摘要均存储在本地存储中，保存在当前设备下，不会上传到任何服务器。</Text>
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
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>3. 信息使用</Text>
          <Text style={styles.paragraph}>收集的信息仅用于：</Text>
          <Text style={styles.itemDesc}>· 在地图上选点与推荐附近路线</Text>
          <Text style={styles.itemDesc}>· 识别当前楼层、步态与转向事件</Text>
          <Text style={styles.itemDesc}>· 生成本地成绩摘要（仅包含路线名称与运动成绩）</Text>
          <Text style={styles.itemDesc}>· 在更换手机时提示重新验证</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>4. 信息共享</Text>
          <Text style={styles.paragraph}>运动记录不会自动上传或共享给第三方，也不会用于广告。只有你主动导出或分享时，文件才会交给你选择的目标应用。</Text>
          <Text style={styles.paragraph}>地图选点使用高德在线地图服务，加载地图、搜索地点和解析地址时会发送必要的位置或搜索信息。你也可以通过“快速开练”开始不记录地点的训练。</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>5. 信息删除</Text>
          <Text style={styles.paragraph}>用户可在路线管理中手动删除路线模板，已经保存的训练仍会保留；有路线快照的历史记录继续显示当次路线信息。</Text>
          <Text style={styles.paragraph}>卸载应用或清除应用数据将永久删除所有本地数据，无法恢复。</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>6. 技术边界</Text>
          <Text style={styles.paragraph}>· 楼层和爬升是结合运动样本、可用气压与路线模板得到的估算，实际到达楼层可由你确认或修正。</Text>
          <Text style={styles.paragraph}>· 手机定位仅用于确定建筑和附近路线排序，不用于室内测高。</Text>
          <Text style={styles.paragraph}>· 识别受手机型号、携带位置和路线影响；更换手机或携带方式后建议重新验证。</Text>
          <Text style={styles.paragraph}>· 锁屏持续采集需要系统允许后台训练和相应权限，部分手机的省电策略仍可能中断采样。缺段会保留记录并提醒，不会补造样本。</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>7. 联系方式</Text>
          <Text style={styles.paragraph}>如有疑问，可通过应用反馈渠道联系开发者。</Text>
        </View>

        <Text style={styles.version}>版本 1.0 · 生效日期 {effectiveDate}</Text>

      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Button title="同意并开始" onPress={handleAgree} loading={agreeing} />
        <Pressable style={styles.rejectBtn} accessibilityRole="button" disabled={agreeing} onPress={handleReject}>
          <Text style={styles.rejectText}>不同意</Text>
        </Pressable>
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: theme.pagePaddingH, paddingTop: 16, paddingBottom: 24 },
    hero: { marginBottom: 8, gap: 8 },
    eyebrow: {
      color: theme.brand,
      fontSize: theme.fontEyebrow,
      fontWeight: '700',
    },
    title: {
      color: theme.ink,
      fontSize: theme.fontTitle,
      fontWeight: '700',
      lineHeight: 34,
    },
    subtitle: {
      color: theme.mutedStrong,
      fontSize: theme.fontBase,
      lineHeight: 22,
    },
    card: {
      paddingVertical: 24,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    sectionTitle: {
      color: theme.ink,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
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
      marginVertical: 24,
    },
    rejectBtn: {
      minHeight: theme.tapMin,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
    },
    rejectText: {
      color: theme.muted,
      fontSize: theme.fontSubtitle,
      lineHeight: 21,
      fontWeight: '600',
    },
    footer: { backgroundColor: theme.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, paddingHorizontal: theme.pagePaddingH, paddingTop: 8 },
  })
