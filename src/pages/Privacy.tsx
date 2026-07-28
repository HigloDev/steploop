// 隐私协议页：展示协议内容，同意后 agreePrivacy 并 navigation.replace('RouteEdit')。

import React, { useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'

import { Header } from '../components/Header'
import { Button } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen, RootStackNavigation } from '../navigation/types'
import { agreePrivacy } from '../services/privacy'

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
      // 无论从哪里进入，同意后都用 replace 跳到主页，避免返回键再次回到协议页
      navigation.replace('RouteEdit')
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
            // RN 无直接退出 API；退到主页
            if (navigation.canGoBack()) {
              navigation.goBack()
            } else {
              navigation.navigate('RouteEdit')
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
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>PRIVACY</Text>
          <Text style={styles.title}>隐私协议</Text>
          <Text style={styles.subtitle}>本协议说明本应用收集与处理的信息。请阅读后确认。</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>1. 信息收集</Text>
          <Text style={styles.paragraph}>本应用仅在用户主动操作时收集以下信息：</Text>
          <Text style={styles.itemLabel}>· 地理位置</Text>
          <Text style={styles.itemDesc}>用于在地图上选择爬楼建筑并按距离推荐附近已标定路线。仅在创建或修改路线时使用。</Text>
          <Text style={styles.itemLabel}>· 运动传感器</Text>
          <Text style={styles.itemDesc}>包括加速度计、陀螺仪与设备方向。仅在进行路线标定与正式爬楼时实时读取，用于识别楼层与步态。</Text>
          <Text style={styles.itemLabel}>· 设备标识</Text>
          <Text style={styles.itemDesc}>仅记录设备型号、平台与系统版本，用于在更换手机时提示重新验证路线模板，不上传任何唯一标识。</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>2. 信息存储</Text>
          <Text style={styles.paragraph}>所有路线模板、爬楼记录与成绩摘要均存储在本地存储中，保存在当前设备下，不会上传到任何服务器。</Text>
          <Text style={styles.paragraph}>原始传感器数据仅在标定复核期间临时保存在内存中，离开页面即清除。</Text>
          <Text style={styles.paragraph}>最近 100 次会话摘要会被保留，超出部分会被覆盖。</Text>
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
          <Text style={styles.paragraph}>本应用不会将上述信息共享给任何第三方，也不会用于广告或商业用途。</Text>
          <Text style={styles.paragraph}>用户主动选择分享的成绩仅包含路线名称与运动成绩。</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>5. 信息删除</Text>
          <Text style={styles.paragraph}>用户可在路线管理中手动删除任意路线模板，删除后历史成绩仍会保留但不再关联路线名称。</Text>
          <Text style={styles.paragraph}>卸载应用或清除应用数据将永久删除所有本地数据，无法恢复。</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>6. 技术边界</Text>
          <Text style={styles.paragraph}>· 累计高度来自人工确认的楼层模板，不是手机实时物理测高。</Text>
          <Text style={styles.paragraph}>· GPS 仅用于确定建筑和附近路线排序，不用于室内测高。</Text>
          <Text style={styles.paragraph}>· 识别依赖固定手机、固定携带位置和固定路线；更换手机后必须重新验证。</Text>
          <Text style={styles.paragraph}>· 锁屏、切出应用或传感器超过一秒无数据会留下中断记录，本次成绩不会被标记为完整。</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>7. 联系方式</Text>
          <Text style={styles.paragraph}>如有疑问，可通过应用反馈渠道联系开发者。</Text>
        </View>

        <Text style={styles.version}>版本 1.0 · 生效日期 {effectiveDate}</Text>

        <Button title="同意并开始" onPress={handleAgree} loading={agreeing} />
        <Pressable style={styles.rejectBtn} onPress={handleReject}>
          <Text style={styles.rejectText}>不同意</Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    flex: { flex: 1 },
    content: { paddingHorizontal: theme.pagePaddingH },
    hero: { marginBottom: 16, marginTop: 8 },
    eyebrow: {
      color: theme.green,
      fontSize: theme.fontEyebrow,
      fontWeight: '700',
      letterSpacing: 1.5,
    },
    title: {
      marginTop: 6,
      color: theme.ink,
      fontSize: theme.fontTitle,
      fontWeight: '700',
      lineHeight: 32,
    },
    subtitle: {
      marginTop: 8,
      color: theme.muted,
      fontSize: theme.fontSubtitle,
      lineHeight: 20,
    },
    card: {
      backgroundColor: theme.card,
      borderRadius: theme.radiusLg,
      padding: 14,
      marginBottom: 10,
      ...theme.shadowSoft,
    },
    sectionTitle: {
      color: theme.ink,
      fontSize: 15,
      fontWeight: '700',
      marginBottom: 8,
    },
    paragraph: {
      color: theme.inkSoft,
      fontSize: 13,
      lineHeight: 20,
      marginBottom: 6,
    },
    itemLabel: {
      color: theme.ink,
      fontSize: 13,
      fontWeight: '600',
      marginTop: 6,
      marginBottom: 2,
    },
    itemDesc: {
      color: theme.muted,
      fontSize: 12,
      lineHeight: 18,
      marginBottom: 4,
    },
    version: {
      color: theme.muted,
      fontSize: 12,
      textAlign: 'center',
      marginVertical: 12,
    },
    rejectBtn: {
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 6,
      marginBottom: 12,
    },
    rejectText: {
      color: theme.muted,
      fontSize: 14,
      fontWeight: '600',
    },
  })
