import React, { useCallback, useEffect, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Header } from '../components/Header'
import { Button, Card, Pill } from '../components/ui'
import { Disclosure } from '../components/disclosure'
import { FlowReveal } from '../components/flow-motion'
import { isRoutePrepared, preparationLabel, PREPARATION_LABELS } from '../core/route-preparation'
import { RouteTemplate } from '../core/types'
import { RootStackScreen } from '../navigation/types'
import { getRoute, saveRoute } from '../services/storage'
import { uid } from '../core/math'
import { savePreferences } from '../services/preferences'
import { shareRouteFile } from '../services/route-sharing'
import { useTheme } from '../theme'

export default function RouteProfileScreen({ navigation, route }: RootStackScreen<'RouteProfile'>) {
  const theme = useTheme(), insets = useSafeAreaInsets()
  const [template, setTemplate] = useState<RouteTemplate | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const value = await getRoute(route.params.id)
    if (!value) throw new Error('这条路线不存在。')
    setTemplate(value)
  }, [route.params.id])
  useEffect(() => {
    void load().catch(e => setError(e.message))
    return navigation.addListener('focus', () => { void load().catch(e => setError(e.message)) })
  }, [load, navigation])
  const ready = template ? isRoutePrepared(template) : false
  const primary = async () => {
    if (!template || busy) return
    setBusy(true); setError('')
    try {
      await savePreferences({ lastTrainingRouteId: template.id })
      if (ready) navigation.navigate('WorkoutSetup', { id: template.id })
      else navigation.navigate('Familiarize', { id: template.id })
    } catch { setError('没有选好这条路线，请重试。') } finally { setBusy(false) }
  }
  const share = async () => {
    if (!template || busy) return
    setBusy(true); setError('')
    try { await shareRouteFile(template) } catch (e) { setError(e instanceof Error ? e.message : '分享失败，请重试。') } finally { setBusy(false) }
  }
  const prepareAgain = async () => {
    if (!template || busy) return
    setBusy(true); setError('')
    try {
      const id = uid('route'), now = Date.now()
      await saveRoute({ ...template, id, name: `${template.name}（重新熟悉）`, preparation: undefined,
        motionReference: undefined, createdAt: now, updatedAt: now, status: 'draft' })
      navigation.navigate('Familiarize', { id })
    } catch { setError('没有建好，请重试。原路线仍然保留。') } finally { setBusy(false) }
  }
  const body = { color: theme.mutedStrong, fontSize: 15, lineHeight: 24 }
  return <View style={{ flex: 1, backgroundColor: theme.paper }}>
    <Header title="路线" back />
    <ScrollView contentContainerStyle={{ padding: theme.pagePaddingH, gap: 20, paddingBottom: 24 }}>
      {template ? <FlowReveal changeKey={template.id} style={{ gap: 20 }}>
        <Text accessibilityRole="header" style={{ color: theme.ink, fontSize: 28, lineHeight: 36, fontWeight: '700' }}>{template.name}</Text>
        <Text style={body}>{template.endFloor > template.startFloor ? `${template.startFloor} 楼 → ${template.endFloor} 楼` : '还没有填写楼层'} · 手机放在{template.carryMode === 'pocket' ? '口袋' : '腰包'}</Text>
        <Pill tone={ready ? 'good' : 'warn'}>{preparationLabel(template)}</Pill>
        <Card><Text style={body}>{ready ? '这部手机已经按步骤检查过。平时选好路线，点开始就能爬。' : template.preparation?.imported ? '路线已导入。换了手机，先按页面提示检查，避免把别人的检查结果当成你的。' : '先带手机逐层熟悉这段楼梯，再看看它自己能不能认对。已经保存的路线和成绩都还在。'}</Text></Card>
        <Disclosure title="熟悉进度" summary={ready ? '已完成' : '可以分几次做完'}>
          <Text style={body}>{template.preparation?.runs.filter(r => r.passed).map(r => PREPARATION_LABELS[r.step]).filter((v, i, a) => a.indexOf(v) === i).join('\n') || '还没有按新步骤熟悉路线。'}</Text>
          <Text style={body}>{template.preparation?.elevator === 'absent' ? '这条路线没有电梯；坐电梯返回的情况没有检查过。' : '电梯和平地也会检查，避免误算成爬楼。'}</Text>
          <Text style={body}>检查只说明这部手机按这次方式走过的情况；换手机、换携带方式或换楼梯，要重新检查。</Text>
        </Disclosure>
        <Disclosure title="地点" summary={template.location?.name ?? '未填写'}>
          <Text style={body}>{template.location?.address ?? '不填写地点也可以熟悉路线和锻炼。'}</Text>
          <Button title="修改地点" variant="secondary" disabled={busy} onPress={() => navigation.navigate('LocationPicker', { routeId: template.id })} />
        </Disclosure>
        <Button title="分享路线文件" variant="secondary" loading={busy} disabled={!template.segments.length} onPress={() => void share()} />
        <Text style={body}>分享内容包括地点、楼层和走楼梯的参考记录，不包括你的锻炼成绩。收到的人在“添加路线”里导入即可。</Text>
        {template.preparation ? <Disclosure title="更换手机放置方式，或重新熟悉">
          <Text style={body}>会另外建一条路线重新熟悉，原来的路线、走过的记录和成绩都保留。</Text>
          <Button title="另建一条，重新熟悉" variant="secondary" disabled={busy} onPress={() => void prepareAgain()} />
        </Disclosure> : null}
      </FlowReveal> : <Text style={body}>{error || '正在打开路线…'}</Text>}
      {error && template ? <Text accessibilityRole="alert" style={{ ...body, color: theme.redInk }}>{error}</Text> : null}
    </ScrollView>
    <View style={{ paddingHorizontal: theme.pagePaddingH, paddingTop: 12, paddingBottom: insets.bottom + 12 }}>
      <Button title={ready ? '使用这条路线' : '继续熟悉路线'} disabled={!template} loading={busy} onPress={() => void primary()} />
    </View>
  </View>
}
