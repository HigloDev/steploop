import React from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg'
import { useAppearance } from '../appearance'
import { hydrateAppearance, saveAppearance } from '../services/appearance'
import { APPEARANCE_MODE_LABELS, SKIN_CATALOG, type AppearanceMode } from '../skin-catalog'
import { getTheme, isLargeText, sport, typography, useTheme, useThemeStyles, type Theme } from '../theme'
import { triggerHaptic } from '../services/preferences'
import { NativeChoice } from './native-choice'
import { MotionRingLogoOrb } from './motion-ring-graphics'
import { UIIcon } from './ui-icon'

const modeOptions = (['light', 'dark', 'system'] as const).map(value => ({
  value,
  label: APPEARANCE_MODE_LABELS[value],
}))

function DualToneOrb({
  id,
  bgTop,
  bgBottom,
  accent,
  size = 34,
}: {
  id: string
  bgTop: string
  bgBottom: string
  accent: string
  size?: number
}) {
  const gradId = `orb-${id}`
  return (
    <Svg width={size} height={size} viewBox="0 0 36 36" accessible={false}>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor={bgTop} />
          <Stop offset="100%" stopColor={bgBottom} />
        </LinearGradient>
      </Defs>
      <Circle cx={18} cy={18} r={17} fill={`url(#${gradId})`} />
      <Path d="M 30.02 5.98 A 17 17 0 0 1 5.98 30.02 Z" fill={accent} />
    </Svg>
  )
}

export function AppearanceModeControl() {
  const theme = useTheme()
  const styles = useThemeStyles(makeStyles)
  const { width, fontScale } = useWindowDimensions()
  const appearance = useAppearance()
  const { error, saving, skinId } = appearance
  const readFailed = error === 'read'
  const twoColumns = isLargeText(fontScale) || width < 340
  const activeSkin = SKIN_CATALOG.find(item => item.id === skinId) ?? SKIN_CATALOG[0]
  const resolvedMode = theme.isDark ? 'dark' : 'light'

  return (
    <View style={styles.root}>
      <View style={styles.subSection}>
        <View style={styles.headingRow}>
          <Text style={styles.headingTitle}>显示模式</Text>
          <Text style={styles.headingMeta}>
            {appearance.mode === 'system' ? `跟随系统 · 当前${theme.isDark ? '深色' : '浅色'}` : APPEARANCE_MODE_LABELS[appearance.mode]}
          </Text>
        </View>
        <NativeChoice<AppearanceMode>
          testID="appearance-mode"
          value={appearance.mode}
          options={modeOptions}
          disabled={readFailed}
          onChange={mode => {
            void saveAppearance({ mode })
          }}
        />
      </View>

      <View style={styles.divider} />

      <View style={styles.subSection}>
        <View style={styles.headingRow}>
          <Text style={styles.headingTitle}>主题配色</Text>
          <Text style={styles.headingMeta} numberOfLines={1}>{activeSkin.name}</Text>
        </View>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="主题配色"
          style={styles.orbGrid}
        >
          {SKIN_CATALOG.map(skin => {
            const selected = skinId === skin.id
            const preview = getTheme(skin.id, resolvedMode)
            const paint = skin[resolvedMode]
            const isDefaultBrand = skin.id === 'motion-ring'
            return (
              <Pressable
                key={skin.id}
                testID={`appearance-skin-${skin.id}`}
                accessibilityRole="radio"
                accessibilityLabel={`${skin.name}${isDefaultBrand ? '，默认品牌配色' : ''}，${skin.description}`}
                accessibilityState={{ selected, checked: selected, disabled: readFailed }}
                disabled={readFailed}
                onPress={() => {
                  if (!selected) {
                    void triggerHaptic('selection')
                    void saveAppearance({ skinId: skin.id })
                  }
                }}
                style={({ pressed }) => [
                  styles.orbCard,
                  twoColumns ? styles.orbCardTwoCol : styles.orbCardThreeCol,
                  selected && {
                    borderColor: theme.brandText,
                    backgroundColor: theme.brandSoft,
                  },
                  pressed && { opacity: 0.78 },
                  readFailed && { opacity: sport.opacity.disabled },
                ]}
              >
                <View style={[styles.orbRing, { borderColor: selected ? theme.brandText : preview.line }]}>
                  {isDefaultBrand ? (
                    <MotionRingLogoOrb theme={preview} size={32} />
                  ) : (
                    <DualToneOrb
                      id={`${skin.id}-${resolvedMode}`}
                      bgTop={paint.backdrop.backdropTop}
                      bgBottom={paint.backdrop.backdropBottom}
                      accent={preview.brand}
                      size={32}
                    />
                  )}
                  {selected ? (
                    <View style={[styles.orbCheckBadge, { backgroundColor: theme.brandText, borderColor: theme.card }]}>
                      <UIIcon name="check" size={10} color={theme.paper} accessible={false} />
                    </View>
                  ) : null}
                </View>
                <View style={styles.orbLabelRow}>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit={!twoColumns}
                    minimumFontScale={0.88}
                    style={[styles.orbName, selected && { color: theme.brandText, fontWeight: '700' }]}
                  >
                    {skin.name}
                  </Text>
                  {isDefaultBrand ? (
                    <View style={[styles.defaultTag, { backgroundColor: selected ? theme.brand : theme.surfaceSoft }]}>
                      <Text style={[styles.defaultTagText, { color: selected ? theme.onBrand : theme.brandText }]}>
                        默认
                      </Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            )
          })}
        </View>
        <Text style={styles.themeDesc}>{activeSkin.description}</Text>
      </View>

      {error ? (
        <View accessibilityLiveRegion="polite">
          <Text style={[typography.secondary, { color: theme.redInk }]}>
            {error === 'read' ? '暂时无法读取外观设置。' : error === 'invalid' ? '外观设置格式异常，可以重新选择。' : '这次选择尚未保存。'}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={{ minHeight: theme.tapMin, justifyContent: 'center' }}
            onPress={() => {
              void (error === 'write' ? saveAppearance() : hydrateAppearance(true))
            }}
          >
            <Text style={[typography.control, { color: theme.brandText }]}>
              {error === 'write' ? '重试保存' : '重试读取'}
            </Text>
          </Pressable>
        </View>
      ) : saving ? (
        <View accessibilityLiveRegion="polite" style={styles.savingRow}>
          <ActivityIndicator size="small" color={theme.brandText} />
          <Text style={[typography.secondary, { color: theme.inkSoft }]}>正在保存外观</Text>
        </View>
      ) : null}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { gap: sport.space.md },
    subSection: { gap: sport.space.sm },
    headingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: sport.space.sm,
    },
    headingTitle: {
      ...typography.label,
      color: theme.ink,
      fontWeight: '600',
    },
    headingMeta: {
      ...typography.caption,
      color: theme.mutedStrong,
      flexShrink: 1,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.lineSoft,
    },
    orbGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'stretch',
      gap: sport.space.sm,
    },
    orbCard: {
      minHeight: 82,
      paddingHorizontal: 6,
      paddingVertical: 10,
      borderRadius: theme.radius.sm,
      borderWidth: 1.5,
      borderColor: theme.lineSoft,
      backgroundColor: theme.cardSoft,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    orbCardThreeCol: {
      flexBasis: '30.5%',
      flexGrow: 1,
      minWidth: 90,
    },
    orbCardTwoCol: {
      flexBasis: '47%',
      flexGrow: 1,
      minWidth: 120,
      paddingHorizontal: 10,
    },
    orbLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      flexWrap: 'wrap',
    },
    defaultTag: {
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 999,
    },
    defaultTagText: {
      fontSize: 10,
      lineHeight: 13,
      fontWeight: '700',
    },
    orbRing: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    },
    orbCheckBadge: {
      position: 'absolute',
      right: -3,
      bottom: -3,
      width: 17,
      height: 17,
      borderRadius: 9,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    orbName: {
      fontSize: 12,
      lineHeight: 16,
      color: theme.inkSoft,
      fontWeight: '600',
      textAlign: 'center',
    },
    themeDesc: {
      ...typography.caption,
      color: theme.mutedStrong,
    },
    savingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sport.space.sm,
    },
  })
