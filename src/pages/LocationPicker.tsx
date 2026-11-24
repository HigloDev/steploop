import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, NativeModules, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { Header } from '../components/Header'
import { GlassBackdrop, getGlassSurfaceStyle } from '../components/glass-material'
import { SportButton } from '../components/sport-ui'
import { UIIcon } from '../components/ui-icon'
import type { RouteLocation } from '../core/types'
import type { RootStackScreen } from '../navigation/types'
import { buildingMapHtml, buildingMapPreviewUrl, hasBuildingMap, isBuildingMapPreviewUrl } from '../services/building-map-html'
import { isLargeText, sport, typography, useTheme, useThemeStyles, type Theme } from '../theme'

type MapPoint = Omit<RouteLocation, 'confirmedAt'>

function validPoint(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
    typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180
}

export default function LocationPicker({ navigation, route }: RootStackScreen<'LocationPicker'>) {
  const theme = useTheme()
  const styles = useThemeStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const { height, width, fontScale } = useWindowDimensions()
  const savedLocation = route.params?.initialLocation
  const initial = savedLocation && validPoint(savedLocation.latitude, savedLocation.longitude) ? savedLocation : undefined
  const webView = useRef<WebView>(null)
  const nextRequest = useRef(0)
  const searchRequest = useRef(0)
  const locateRequest = useRef(0)
  const locateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mapGeneration = useRef(0)
  const [generation, setGeneration] = useState(0)
  const [preview, setPreview] = useState(!hasBuildingMap)
  const [previewQuery, setPreviewQuery] = useState('')
  const [ready, setReady] = useState(false)
  const [searchReady, setSearchReady] = useState(false)
  const [mapError, setMapError] = useState('')
  const [query, setQuery] = useState('')
  const [point, setPoint] = useState<MapPoint | null>(initial ?? null)
  const [searching, setSearching] = useState(false)
  const [locating, setLocating] = useState(false)
  const [message, setMessage] = useState('')
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const compact = width < 360 || isLargeText(fontScale)
  const mapHeight = keyboardOpen ? 180 : Math.min(560, Math.max(200, height * (compact ? 0.48 : 0.59)))
  const source = useMemo(() => preview
    ? { uri: buildingMapPreviewUrl(previewQuery, initial) }
    : { html: buildingMapHtml(theme, initial) }, [preview, previewQuery, theme, initial])

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false))
    return () => {
      show.remove()
      hide.remove()
      clearTimeout(locateTimer.current)
      locateRequest.current = 0
    }
  }, [])

  const inject = (script: string) => webView.current?.injectJavaScript(script + '; true;')

  const stopLocate = () => {
    clearTimeout(locateTimer.current)
    locateRequest.current = 0
    setLocating(false)
  }

  const reloadMap = (usePreview: boolean) => {
    const next = ++mapGeneration.current
    setGeneration(next)
    setPreview(usePreview)
    setReady(false)
    setSearchReady(false)
    searchRequest.current = 0
    setSearching(false)
    stopLocate()
    setMapError('')
    setMessage('')
  }

  const failMap = (message = '暂时无法加载地图，请检查网络后重试。') => {
    if (generation !== mapGeneration.current) return
    if (preview) setMapError(message)
    else reloadMap(true)
  }

  useEffect(() => {
    if (ready || mapError) return
    const timer = setTimeout(() => failMap('地图加载超时，请检查网络后重试。'), 16000)
    return () => clearTimeout(timer)
  }, [generation, ready, mapError])

  const handleMessage = (event: WebViewMessageEvent) => {
    if (mapError || generation !== mapGeneration.current) return
    try {
      const data = JSON.parse(event.nativeEvent.data)
      if (!data || typeof data.type !== 'string') return
      if (data.type === 'map-error') failMap()
      if (data.type === 'map-ready') setReady(true)
      if (data.type === 'search-ready') setSearchReady(true)
      if (data.type === 'moving') {
        setPoint(null)
        setMessage('')
      }
      if (data.type === 'point' && validPoint(data.latitude, data.longitude)) {
        const address = typeof data.address === 'string' ? data.address.trim().slice(0, 160) : ''
        setPoint({ latitude: data.latitude, longitude: data.longitude, address, name: address || '地图选点', accuracy: 0, source: 'map' })
      }
      if ((data.type === 'search-done' || data.type === 'search-error') && data.id === searchRequest.current) {
        searchRequest.current = 0
        setSearching(false)
        if (data.type === 'search-error' && typeof data.message === 'string') setMessage(data.message.slice(0, 120))
      }
      if ((data.type === 'locate-done' || data.type === 'locate-error') && data.id === locateRequest.current) {
        stopLocate()
        if (data.type === 'locate-error') setMessage('暂时无法在地图上定位，可以搜索地址或在地图上选点。')
      }
    } catch {
      // The provider's messages can be ignored unless they match the picker protocol.
    }
  }

  const handleSearch = () => {
    const address = query.trim()
    if (!address || (!preview && (!ready || !searchReady)) || searching || locating) return
    Keyboard.dismiss()
    if (preview) {
      setPreviewQuery(address)
      reloadMap(true)
      return
    }
    const request = ++nextRequest.current
    searchRequest.current = request
    setMessage('')
    setSearching(true)
    inject('window.searchBuildingAddress(' + JSON.stringify(address) + ',' + request + ')')
  }

  const handleLocate = async () => {
    if ((!preview && !ready) || locating || searching) return
    const request = ++nextRequest.current
    locateRequest.current = request
    setLocating(true)
    setMessage('')
    locateTimer.current = setTimeout(() => {
      if (locateRequest.current !== request) return
      if (!preview) inject('window.cancelBuildingLocate()')
      stopLocate()
      setMessage('定位超时，可以重试或搜索地点。')
    }, 16000)
    try {
      const permission = await Location.requestForegroundPermissionsAsync()
      if (locateRequest.current !== request) return
      if (!permission.granted) {
        stopLocate()
        setMessage(preview ? '定位权限未开启。你仍可浏览地图。' : '定位权限未开启。你仍可搜索地址或在地图上选点。')
        return
      }
      const androidLocation = NativeModules.AndroidSystemLocation
      const current = Platform.OS === 'android' && androidLocation
        ? await androidLocation.getCurrentLocation(9000)
        : (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })).coords
      if (locateRequest.current !== request) return
      if (!validPoint(current.latitude, current.longitude)) throw new Error('Invalid location coordinates')
      if (preview) {
        const accuracy = Number.isFinite(current.accuracy) && current.accuracy >= 0 ? current.accuracy : 0
        setPoint({ latitude: current.latitude, longitude: current.longitude, accuracy, name: '当前位置', address: '', source: 'gps' })
        stopLocate()
        return
      }
      inject('window.locateBuildingMap(' + current.longitude + ',' + current.latitude + ',' + request + ')')
    } catch {
      if (locateRequest.current !== request) return
      stopLocate()
      setMessage('未能获取当前位置，请检查手机定位设置，或直接搜索地点。')
    }
  }

  const finish = (location: RouteLocation | null) => {
    Keyboard.dismiss()
    navigation.popTo('Main', { screen: 'Train', params: { pickedBuildingLocation: location } })
  }

  const confirm = () => {
    if (!point || searching || locating) return
    finish({ ...point, confirmedAt: Date.now() })
  }

  return <View style={styles.page}>
    <GlassBackdrop />
    <Header title="选择地点" />
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.searchRow}>
          <TextInput value={query} onChangeText={value => {
            setQuery(value)
            if (searchRequest.current) {
              searchRequest.current = 0
              setSearching(false)
              inject('window.cancelLocationSearch()')
            }
          }} accessibilityLabel="地点名称或地址" placeholder="地点名称或地址" placeholderTextColor={theme.mutedStrong}
            style={[getGlassSurfaceStyle(theme, 'card'), styles.searchInput]} maxLength={100} returnKeyType="search" onSubmitEditing={handleSearch} />
          <SportButton title="搜索" icon={compact ? undefined : 'search'} secondary onPress={handleSearch}
            disabled={(!preview && (!ready || !searchReady)) || !query.trim() || locating} loading={searching} style={styles.searchAction} />
        </View>
        <View style={[styles.map, { height: mapHeight }]}>
          {!mapError ? <WebView key={generation} ref={webView} source={source} style={styles.webview}
            accessibilityLabel={preview ? '高德地图预览' : '楼栋选点地图'} originWhitelist={['*']}
            onShouldStartLoadWithRequest={request => preview ? isBuildingMapPreviewUrl(request.url)
              : request.url === 'about:blank' || request.url.startsWith('data:text/html')}
            setSupportMultipleWindows={false} onMessage={preview ? undefined : handleMessage}
            onLoad={event => {
              if (preview && generation === mapGeneration.current && isBuildingMapPreviewUrl(event.nativeEvent.url)) setReady(true)
            }}
            onError={() => failMap()} onHttpError={() => failMap()}
            onRenderProcessGone={() => failMap()} onContentProcessDidTerminate={() => failMap()}
            androidLayerType="hardware" nestedScrollEnabled /> : null}
          {mapError || !ready ? <View style={styles.mapStatus} accessibilityLiveRegion="polite">
            {!mapError ? <ActivityIndicator color={theme.brandText} /> : null}
            <Text style={styles.statusText}>{mapError || '地图加载中'}</Text>
            {mapError ? <SportButton title="重新加载" secondary onPress={() => reloadMap(preview)} /> : null}
          </View> : null}
          {ready || preview ? <Pressable accessibilityRole="button" accessibilityLabel={preview ? '选择当前位置' : '定位到当前位置'}
            disabled={locating || searching} accessibilityState={{ disabled: locating || searching, busy: locating }}
            onPress={() => void handleLocate()} style={[getGlassSurfaceStyle(theme, 'overlay'), styles.locate]}>
            {locating ? <ActivityIndicator color={theme.brandInk} /> : <UIIcon name="compass" size={24} color={theme.brandInk} />}
          </Pressable> : null}
        </View>
        {preview ? <Text style={styles.statusText}>高德地图预览 · 可浏览和搜索。点定位可选用当前位置。</Text> : null}
        {preview && hasBuildingMap ? <SportButton title="重试地图选点" secondary disabled={locating}
          onPress={() => reloadMap(false)} /> : null}
        <View style={[getGlassSurfaceStyle(theme, 'card'), styles.result]} accessibilityLiveRegion="polite">
          {point ? <>
            <Text style={styles.resultTitle}>{point.address || point.name}</Text>
            {!point.address ? <Text style={styles.statusText}>纬度 {point.latitude.toFixed(5)} · 经度 {point.longitude.toFixed(5)}</Text> : null}
          </> : <Text style={styles.statusText}>{mapError || preview ? '你可以使用当前位置，也可以直接标定楼层。'
            : searching ? '正在搜索地点' : '拖动地图对准图钉，或搜索楼栋地址。'}</Text>}
          {message ? <Text accessibilityRole="alert" style={[styles.statusText, { color: theme.redInk }]}>{message}</Text> : null}
        </View>
      </ScrollView>
      {!keyboardOpen ? <View style={[getGlassSurfaceStyle(theme, 'overlay'), styles.footer, { paddingBottom: insets.bottom + sport.space.sm }]}>
        <SportButton title="不选地点" secondary onPress={() => finish(null)}
          style={[styles.footerButton, compact && styles.compactFooterButton]} />
        <SportButton title="使用此地点" onPress={confirm} disabled={!point || searching || locating}
          style={[styles.footerButton, compact && styles.compactFooterButton]} />
      </View> : null}
    </KeyboardAvoidingView>
  </View>
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.paper },
  flex: { flex: 1 },
  content: { paddingHorizontal: theme.pagePaddingH, paddingTop: sport.space.md, paddingBottom: sport.space.lg, gap: sport.space.md },
  searchRow: { flexDirection: 'row', alignItems: 'stretch', gap: sport.space.sm },
  searchInput: { ...typography.body, flex: 1, minHeight: theme.tapMin, minWidth: 0, paddingHorizontal: sport.space.md,
    paddingVertical: sport.space.sm, backgroundColor: theme.card, borderRadius: sport.radius.control,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.line, color: theme.ink },
  searchAction: { alignSelf: 'stretch', minWidth: 62, paddingHorizontal: sport.space.md },
  map: { backgroundColor: theme.cardSoft, overflow: 'hidden', borderRadius: sport.radius.panel,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.line },
  webview: { flex: 1, backgroundColor: theme.paper },
  mapStatus: { ...StyleSheet.absoluteFill, padding: sport.space.lg, backgroundColor: theme.cardSoft,
    alignItems: 'center', justifyContent: 'center', gap: sport.space.md },
  locate: { position: 'absolute', bottom: sport.space.md, right: sport.space.md, minWidth: 48, minHeight: 48,
    alignItems: 'center', justifyContent: 'center', backgroundColor: theme.card, borderRadius: sport.radius.control,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.line },
  result: { gap: sport.space.xs, padding: sport.space.md, borderRadius: sport.radius.panel },
  resultTitle: { ...typography.control, color: theme.ink },
  statusText: { ...typography.secondary, color: theme.mutedStrong },
  footer: { flexDirection: 'row', gap: sport.space.sm, paddingHorizontal: theme.pagePaddingH, paddingTop: sport.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, borderRadius: 0 },
  footerButton: { flex: 1 },
  compactFooterButton: { paddingHorizontal: sport.space.sm },
})
