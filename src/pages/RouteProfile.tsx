import React, { useEffect, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'
import { RootStackScreen } from '../navigation/types'
import { Header } from '../components/Header'
import { Button, Notice } from '../components/ui'
import { useTheme } from '../theme'
import { getRoute, saveRoute } from '../services/storage'
import { RouteTemplate } from '../core/types'
import { buildingFromRoute } from '../core/building-model'

export default function RouteProfileScreen({ navigation, route }: RootStackScreen<'RouteProfile'>) {
  const theme = useTheme()
  const [template, setTemplate] = useState<RouteTemplate>()
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    const load = () => { void getRoute(route.params.id).then(t => { setTemplate(t); setName(t?.name ?? '') }).catch(e => setMessage(String(e))) }
    load(); return navigation.addListener('focus', load)
  }, [route.params.id, navigation])
  const building = template ? buildingFromRoute(template) : undefined
  return <View style={{ flex: 1, backgroundColor: theme.paper }}><Header title="楼宇模板" back />
    <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
      {!!message && <Notice>{message}</Notice>}
      {template && <>
        <TextInput accessibilityLabel="楼名" value={name} onChangeText={setName} maxLength={40} style={{ color: theme.ink, fontSize: 24, padding: 12, borderColor: theme.line, borderWidth: 1 }} />
        <Text style={{ color: theme.ink }}>{template.startFloor} 楼出发 · {building ? `${building.floors.length} 个爬升段，可直接训练` : '没有高度资料，下次需要逐层标定'}</Text>
        <Text style={{ color: theme.mutedStrong }}>{template.location?.name ?? '未附带定位，不影响训练'}</Text>
        <Button title="保存楼名" onPress={() => { void saveRoute({ ...template, name: name.trim() || template.name, updatedAt: Date.now() }).then(() => setMessage('已保存')).catch(e => setMessage(String(e))) }} />
        <Button title="编辑地点" variant="secondary" onPress={() => navigation.navigate('LocationPicker', { routeId: template.id })} />
        <Button title="开始爬楼" onPress={() => navigation.navigate('ClimbWorkout', { id: template.id, goal: { type: 'open' }, returnConfirmationMode: 'assisted', trackingMode: 'full_auto' })} />
      </>}
    </ScrollView>
  </View>
}
