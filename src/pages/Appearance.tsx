import React from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Header } from '../components/Header'
import { NativeChoice } from '../components/native-choice'
import { useAppearance } from '../appearance'
import { hydrateAppearance, saveAppearance } from '../services/appearance'
import { APPEARANCE_MODE_LABELS, AppearanceMode, SKIN_CATALOG } from '../skin-catalog'
import { getTheme, sport, Theme, useTheme } from '../theme'

/** Small previews use the same tokens as the actual app, including both modes. */
function SkinPreview({ theme, label }: { theme: Theme; label: string }) {
  return <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.preview, { backgroundColor: theme.paper, borderColor: theme.line }]}>
    <View style={styles.previewHeading}>
      <Text style={[styles.previewLabel, { color: theme.mutedStrong }]}>{label}</Text>
      <View style={[styles.previewDot, { backgroundColor: theme.brand, borderColor: theme.brandText }]} />
    </View>
    <View style={[styles.previewHero, { backgroundColor: theme.heroSurface }]}>
      <Text style={[styles.previewMetric, { color: theme.heroInk }]}>150 <Text style={styles.previewUnit}>米</Text></Text>
      <View style={[styles.previewLine, { backgroundColor: theme.heroAccent }]} />
    </View>
    <View style={[styles.previewButton, { backgroundColor: theme.brand }]}>
      <Text style={[styles.previewButtonText, { color: theme.onBrand }]}>开始爬楼</Text>
    </View>
  </View>
}

export default function AppearanceScreen() {
  const theme = useTheme()
  const appearance = useAppearance()
  const insets = useSafeAreaInsets()
  return <View style={{ flex: 1, backgroundColor: theme.paper }}>
    <Header title="皮肤与外观" />
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + sport.space.section }]}>
      <Text style={[styles.intro, { color: theme.mutedStrong }]}>选择喜欢的配色，带着自己的节奏向上。</Text>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.ink }]}>显示模式</Text>
      <NativeChoice testID="appearance-mode" value={appearance.mode}
        options={(Object.keys(APPEARANCE_MODE_LABELS) as AppearanceMode[]).map(value => ({ value, label: APPEARANCE_MODE_LABELS[value] }))}
        onChange={mode => { void saveAppearance({ mode: mode as AppearanceMode }) }} />
      <View style={styles.saveStatus} accessibilityLiveRegion="polite">
        {appearance.error ? <>
          <Text style={[styles.statusText, { color: theme.redInk }]}>{appearance.error === 'read' ? '未能读取外观设置，暂用原版配色。' : '这次选择尚未保存，重新打开后可能恢复为上次设置。'}</Text>
          <Pressable accessibilityRole="button" onPress={() => { void (appearance.error === 'read' ? hydrateAppearance(true) : saveAppearance()) }} style={styles.retry}>
            <Text style={[styles.retryText, { color: theme.brandText }]}>{appearance.error === 'read' ? '重试读取' : '重试保存'}</Text>
          </Pressable>
        </> : <View style={styles.savedRow}>
          {appearance.saving ? <ActivityIndicator size="small" color={theme.brandText} /> : <Feather name="check" size={15} color={theme.mutedStrong} />}
          <Text style={[styles.statusText, { color: theme.mutedStrong }]}>{appearance.saving ? '正在保存…' : '选择立即生效，并自动保留。'}</Text>
        </View>}
      </View>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.ink }]}>皮肤 · {SKIN_CATALOG.length} 款</Text>
      <View accessibilityRole="radiogroup" style={styles.list}>
        {SKIN_CATALOG.map(skin => {
          const selected = appearance.skinId === skin.id
          return <Pressable key={skin.id} testID={`skin-${skin.id}`} accessibilityRole="radio"
            accessibilityLabel={skin.name} accessibilityHint={skin.description} accessibilityState={{ checked: selected, selected }}
            onPress={() => { void saveAppearance({ skinId: skin.id }) }}
            style={({ pressed }) => [styles.skin, { backgroundColor: theme.card, borderColor: selected ? theme.brandText : theme.line, opacity: pressed ? sport.opacity.pressed : 1 }]}>
            <View style={styles.skinHeading}>
              <View style={[styles.skinIcon, { backgroundColor: theme.brandSoft }]}><Feather name={skin.icon} size={21} color={theme.brandText} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.skinName, { color: theme.ink }]}>{skin.name}</Text>
                <Text style={[styles.description, { color: theme.mutedStrong }]}>{skin.description}</Text>
              </View>
              <View style={[styles.radio, { borderColor: selected ? theme.brandText : theme.mutedStrong, backgroundColor: selected ? theme.brand : theme.card }]}>
                {selected ? <Feather name="check" size={16} color={theme.onBrand} /> : null}
              </View>
            </View>
            <View style={styles.previews}>
              <SkinPreview theme={getTheme(skin.id, 'light')} label="浅色" />
              <SkinPreview theme={getTheme(skin.id, 'dark')} label="暗色" />
            </View>
          </Pressable>
        })}
      </View>
    </ScrollView>
  </View>
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: sport.space.page, paddingTop: sport.space.sm },
  intro: { fontSize: 14, lineHeight: 22, marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '600', lineHeight: 24, marginBottom: 12 },
  saveStatus: { marginTop: 8, marginBottom: 24 },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28 },
  statusText: { fontSize: 12, lineHeight: 19, flexShrink: 1 },
  retry: { minHeight: 48, justifyContent: 'center' },
  retryText: { fontSize: 14, fontWeight: '600' },
  list: { gap: 12 },
  skin: { padding: 16, borderRadius: sport.radius.panel, borderWidth: 1.5 },
  skinHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  skinIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  skinName: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  description: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  radio: { width: 24, height: 24, borderWidth: 1.5, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  previews: { flexDirection: 'row', gap: 10 },
  preview: { flex: 1, minWidth: 0, borderRadius: 10, borderWidth: 1, padding: 9, gap: 7 },
  previewHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  previewLabel: { fontSize: 11, lineHeight: 17 },
  previewDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  previewHero: { borderRadius: 7, padding: 9, gap: 7 },
  previewMetric: { fontSize: 22, lineHeight: 29, fontWeight: '700', fontVariant: ['tabular-nums'] },
  previewUnit: { fontSize: 10, fontWeight: '500' },
  previewLine: { height: 3, width: '65%', borderRadius: 2 },
  previewButton: { minHeight: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  previewButtonText: { fontSize: 10, fontWeight: '600', lineHeight: 16 },
})
