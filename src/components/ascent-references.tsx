import React, { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { LANDMARKS, ascentReference, normalizeAscent, referenceProgress } from '../core/landmarks'
import { Theme, useTheme } from '../theme'
import { FlowSheet } from './flow-sheet'

export function AscentReferences({ visible, onClose, ascentM, floors }: {
  visible: boolean; onClose: () => void; ascentM: number; floors: number
}) {
  const theme = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const value = normalizeAscent(ascentM)
  const { next, remainingM } = ascentReference(value)
  return <FlowSheet visible={visible} title={`${LANDMARKS.length} 种高度参照`} onClose={onClose} expanded>
    <View style={styles.topRow}>
      <Text style={styles.current}>本周 {Number(value.toFixed(2))} 米 · {floors} 层</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭高度参照" onPress={onClose} style={styles.close}>
        <MaterialCommunityIcons name="close" size={24} color={theme.mutedStrong} accessible={false} />
      </Pressable>
    </View>
    <Text style={styles.hint}>建筑看自身高度，山峰看海拔，只作高度对照。</Text>
    <View style={styles.next} accessible accessibilityLabel={next ? `下一站 ${next.name}，还差 ${Math.ceil(remainingM)} 米` : '已达到珠峰海拔相当的高度'}>
      <MaterialCommunityIcons name={next?.kind === 'mountain' || !next ? 'terrain' : 'flag-checkered'} size={28} color={theme.brand} accessible={false} />
      <View style={{ flex: 1 }}>
        <Text style={styles.nextTitle}>{next ? `下一站 · ${next.name}` : '已达到珠峰相当高度'}</Text>
        <Text style={styles.nextHint}>{next ? `再向上 ${Math.ceil(remainingM)} 米` : `珠峰海拔的 ${(value / LANDMARKS[LANDMARKS.length - 1].heightM).toFixed(2)} 倍`}</Text>
      </View>
    </View>
    <View>
      {LANDMARKS.map((item, index) => {
        const reached = value >= item.heightM
        const isNext = item.id === next?.id
        const progress = referenceProgress(value, item.heightM)
        const icon = item.id === 'goal' ? 'soccer' : item.id === 'hoop' ? 'basketball-hoop-outline'
          : item.kind === 'mountain' ? 'terrain' : 'office-building-outline'
        return <React.Fragment key={item.id}>
          {index === 0 || item.kind !== LANDMARKS[index - 1].kind ? <Text accessibilityRole="header" style={styles.section}>
            {item.kind === 'everyday' ? '身边的高度' : item.kind === 'city' ? '城市与地标' : '群山与珠峰'}
          </Text> : null}
          <View accessible accessibilityLabel={`${item.name}，${item.note} ${item.heightM} 米，${progress}`} style={[styles.row, isNext && styles.rowNext]}>
            <View style={[styles.icon, reached && styles.iconReached]}>
              <MaterialCommunityIcons name={icon} size={24} color={reached || isNext ? theme.brand : theme.mutedStrong} accessible={false} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>{item.heightM} 米 · {item.note}</Text>
            </View>
            <View style={styles.progress}>
              {reached ? <MaterialCommunityIcons name="check" size={16} color={theme.brandInk} accessible={false} /> : null}
              <Text style={[styles.progressText, (reached || isNext) && { color: theme.brandInk }]}>{progress}</Text>
            </View>
          </View>
        </React.Fragment>
      })}
    </View>
  </FlowSheet>
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: -4 },
  current: { color: theme.inkSoft, fontSize: 16, fontWeight: '700', flex: 1 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  hint: { color: theme.mutedStrong, fontSize: 14, lineHeight: 21 },
  next: { backgroundColor: theme.brandSoft, borderRadius: theme.radiusMd, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  nextTitle: { color: theme.brandInk, fontSize: 17, fontWeight: '800' },
  nextHint: { color: theme.brandInk, fontSize: 14, marginTop: 4 },
  section: { color: theme.mutedStrong, fontSize: 13, fontWeight: '800', marginTop: 18, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, paddingVertical: 12, paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.lineSoft, borderRadius: 12 },
  rowNext: { backgroundColor: theme.surfaceSoft },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceSoft },
  iconReached: { backgroundColor: theme.brandSoft },
  name: { color: theme.ink, fontSize: 16, fontWeight: '800' },
  meta: { color: theme.mutedStrong, fontSize: 12, lineHeight: 18, marginTop: 3 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  progressText: { color: theme.mutedStrong, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
})
