import React, { useRef, useState } from 'react'
import { Platform, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Header } from '../components/Header'
import { Button, Card, Field } from '../components/ui'
import { FlowReveal } from '../components/flow-motion'
import { Disclosure } from '../components/disclosure'
import { RootStackScreen } from '../navigation/types'
import { useTheme } from '../theme'
import { RouteTemplate } from '../core/types'
import { uid } from '../core/math'
import { listRoutes, saveRoute } from '../services/storage'
import { pickRouteFile } from '../services/route-sharing'
import { savePreferences } from '../services/preferences'

export default function AddRouteScreen({ navigation, route }: RootStackScreen<'AddRoute'>) {
  const theme = useTheme(), insets = useSafeAreaInsets()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [preview, setPreview] = useState<RouteTemplate>(), [duplicate, setDuplicate] = useState<RouteTemplate>()
  const lock = useRef(false), savedId = useRef<string | undefined>(undefined)
  const guarded = async (action: () => Promise<void>) => { if (lock.current) return; lock.current = true; setBusy(true); setError(''); try { await action() } catch (e) { setError(e instanceof Error ? e.message : '没有保存成功，请重试。') } finally { lock.current = false; setBusy(false) } }
  const create = async () => {
    if (!name.trim()) { setError('给这段楼梯起个名字吧。'); return }
    await guarded(async () => {
      const now = Date.now(), id = savedId.current ?? uid('route')
      if (!savedId.current) await saveRoute({ id, name: name.trim(), startFloor: 1, endFloor: 1, carryMode: 'pocket', floorHeightM: 0, totalAscentM: 0,
        device: { platform: Platform.OS, model: 'unknown', system: String(Platform.Version) }, segments: [], markers: [], createdAt: now, updatedAt: now, version: 1, status: 'draft' })
      savedId.current = id
      await savePreferences({ lastTrainingRouteId: id })
      navigation.replace('Familiarize', { id })
    })
  }
  const pick = () => guarded(async () => {
    const picked = await pickRouteFile()
    if (!picked) return
    const routes = await listRoutes()
    savedId.current = undefined
    setDuplicate(routes.find(old => old.id === picked.id || old.name === picked.name))
    setPreview(picked)
  })
  const importFile = () => guarded(async () => {
    if (!preview) return
    const id = savedId.current ?? uid('route'), now = Date.now()
    if (!savedId.current) await saveRoute({ ...preview, id, name: duplicate ? `${preview.name}（导入）` : preview.name, createdAt: now, updatedAt: now })
    savedId.current = id
    await savePreferences({ lastTrainingRouteId: id })
    navigation.replace('RouteProfile', { id })
  })
  const body = { color: theme.mutedStrong, fontSize: 15, lineHeight: 24 }
  return <View style={{ flex: 1, backgroundColor: theme.paper }}>
    <Header title={preview ? '看看这条路线' : '添加路线'} back />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: theme.pagePaddingH, gap: 20, paddingBottom: insets.bottom + 24 }}>
      <FlowReveal changeKey={preview?.id ?? 'choose'} style={{ gap: 20 }}>
        <Text style={{ color: theme.ink, fontSize: 28, lineHeight: 36, fontWeight: '700' }}>{preview ? preview.name : '把常爬的楼梯记下来'}</Text>
        {preview ? <>
          <Card><Text style={body}>{preview.startFloor} 楼 → {preview.endFloor} 楼{ '\n' }{preview.location?.address ?? '没有附带地点'}{ '\n' }手机放在{preview.carryMode === 'pocket' ? '口袋' : '腰包'}</Text></Card>
          <Text style={body}>文件只带这条路线，不带对方的锻炼成绩。导入后，用你的手机按提示检查，再开始自动记录。</Text>
          {duplicate ? <Text style={body}>你已经有一条同名或相同来源的路线。添加后会单独保留，原来的路线和成绩不会覆盖。</Text> : null}
          <Button title={duplicate ? '保留原路线，另存一条' : '添加到我的路线'} loading={busy} onPress={() => void importFile()} />
          {duplicate ? <Button title="查看已有路线" variant="secondary" disabled={busy} onPress={() => navigation.replace('RouteProfile', { id: duplicate.id })} /> : null}
          <Button title="重新选择文件" variant="secondary" disabled={busy} onPress={() => void pick()} />
        </> : <>
          <Text style={body}>先确认楼在哪里，再给这段楼梯起名。有人已经记好？直接导入他分享的路线文件。</Text>
          {!route.params?.manual ? <><Button title="定位并添加路线" disabled={busy} onPress={() => navigation.navigate('LocationPicker')} /><Button title="导入路线文件" variant="secondary" loading={busy} onPress={() => void pick()} /></> : null}
          {route.params?.manual ? <><Field label="路线名称" value={name} onChangeText={setName} placeholder="例如：小区 3 栋 · 东侧楼梯" /><Button title="下一步，熟悉路线" loading={busy} onPress={() => void create()} /></> : <Disclosure title="手动填写地点和名称" summary="定位不方便时也能用"><Field label="路线名称" value={name} onChangeText={setName} placeholder="例如：小区 3 栋 · 东侧楼梯" /><Button title="下一步，熟悉路线" loading={busy} onPress={() => void create()} /></Disclosure>}
        </>}
      </FlowReveal>
      {error ? <Text accessibilityRole="alert" style={{ ...body, color: theme.redInk }}>{error}</Text> : null}
    </ScrollView>
  </View>
}
