// 地图选点页：WebView 嵌入高德 JS API 2.0（原生高德地图）+ 高德逆地理编码。
// 使用高德官方 JS API key + 安全密钥，地图样式、控件、大头针均为高德原生。
// 两种模式：
//   - 新建路线（无 routeId）：确认后创建 draft 路线；地图不可用时可进入无地点快速开练。
//   - 补充旧路线地点（有 routeId）：确认后调用 updateRouteLocation 写回路线。

import React, { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView, WebViewMessageEvent } from 'react-native-webview'
import { Ionicons } from '@expo/vector-icons'

import { Header } from '../components/Header'
import { Button } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import { RouteLocation, RouteTemplate } from '../core/types'
import { uid } from '../core/math'
import { getCurrentLocation, locationPermissionErrorMessage } from '../services/location'
import { saveRoute, updateRouteLocation } from '../services/storage'
import { AMAP_JS_KEY, AMAP_SECURITY_CODE } from '../services/amap'

// 高德 JS API key 与安全密钥统一在 services/amap.ts 管理（含上线前说明）

// 默认坐标：武夷山市（项目所在地，GCJ-02 坐标系，高德默认坐标系）
const DEFAULT_LAT = 27.7559
const DEFAULT_LNG = 118.0253
const DEFAULT_START_FLOOR = 1
const DEFAULT_CARRY_MODE = 'pocket' as const

// WebView 内嵌的 HTML：高德 JS API 2.0 原生地图 + 中心固定大头针 + 逆地理编码。
// 包含 WGS-84 → GCJ-02 坐标转换（GPS 定位返回 WGS-84，高德地图是 GCJ-02）。
function buildMapHtml(initialLat: number, initialLng: number, palette: Pick<Theme, 'paper' | 'green' | 'onPrimary'>, generation: number): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { width: 100%; height: 100%; }
    :root { --map-background: ${palette.paper}; --map-marker: ${palette.green}; --map-marker-ink: ${palette.onPrimary}; }
    #map { background: var(--map-background); }
    #pin path { fill: var(--map-marker); }
    #pin circle { fill: var(--map-marker-ink); }
    /* 中心固定大头针（高德原生 Marker 风格） */
    #pin {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -100%);
      z-index: 1000;
      pointer-events: none;
    }
    #pin svg { display: block; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.35)); }
  </style>
  <script>
    window.__mapGeneration = ${generation};
    window._postMapMessage = function(data) {
      data.generation = window.__mapGeneration;
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(data));
    };
    window._mapLoadError = function() {
      window._postMapMessage({ type: 'map_error', message: '地图服务加载失败，请检查网络后重试。' });
    };
    window.addEventListener('error', function(event) {
      if (event.error || (event.target && event.target.tagName === 'SCRIPT')) window._mapLoadError();
    }, true);
    // 高德 JS API 2.0 安全密钥配置（必须在加载 JS API 脚本前设置）
    window._AMapSecurityConfig = {
      securityJsCode: '${AMAP_SECURITY_CODE}'
    };
  </script>
  <script src="https://webapi.amap.com/maps?v=2.0&key=${AMAP_JS_KEY}" onerror="window._mapLoadError()"></script>
</head>
<body>
  <div id="map"></div>
  <div id="pin">
    <svg width="32" height="42" viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 0 C7.16 0 0 7.16 0 16 C0 28 16 42 16 42 C16 42 32 28 32 16 C32 7.16 24.84 0 16 0 Z"/>
      <circle cx="16" cy="16" r="6"/>
    </svg>
  </div>
  <script>
    (function() {
      // WGS-84 → GCJ-02 坐标转换（GPS 返回 WGS-84，高德地图是 GCJ-02）
      function wgs84ToGcj02(lng, lat) {
        var a = 6378245.0;
        var ee = 0.00669342162296594323;
        function tLat(x, y) {
          var r = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
          r += (20*Math.sin(6*x*Math.PI) + 20*Math.sin(2*x*Math.PI)) * 2/3;
          r += (20*Math.sin(y*Math.PI) + 40*Math.sin(y/3*Math.PI)) * 2/3;
          r += (160*Math.sin(y/12*Math.PI) + 320*Math.sin(y*Math.PI/30)) * 2/3;
          return r;
        }
        function tLng(x, y) {
          var r = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
          r += (20*Math.sin(6*x*Math.PI) + 20*Math.sin(2*x*Math.PI)) * 2/3;
          r += (20*Math.sin(x*Math.PI) + 40*Math.sin(x/3*Math.PI)) * 2/3;
          r += (150*Math.sin(x/12*Math.PI) + 300*Math.sin(x/30*Math.PI)) * 2/3;
          return r;
        }
        var dLat = tLat(lng - 105, lat - 35);
        var dLng = tLng(lng - 105, lat - 35);
        var radLat = lat * Math.PI / 180;
        var magic = Math.sin(radLat);
        magic = 1 - ee * magic * magic;
        var s = Math.sqrt(magic);
        dLat = (dLat * 180) / ((a * (1 - ee)) / (magic * s) * Math.PI);
        dLng = (dLng * 180) / (a / s * Math.cos(radLat) * Math.PI);
        return { lat: lat + dLat, lng: lng + dLng };
      }

      try {
      if (typeof AMap === 'undefined') { window._mapLoadError(); return; }
      var map = new AMap.Map('map', {
        center: [${initialLng}, ${initialLat}],
        zoom: 16,
        resizeEnable: true,
        viewMode: '2D'
      });

      var geocoder = null;
      var mapComplete = false, readySent = false;
      var draftRevision = 0, selectionId = 0, searchEpoch = 0;
      var activeSearch = null;
      var reverseTimer = null;
      var reverseTimeout = null;
      function post(data) { window._postMapMessage(data); }
      function valid(lat, lng) { return typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180; }
      function clearReverse() {
        if (reverseTimer) clearTimeout(reverseTimer);
        if (reverseTimeout) clearTimeout(reverseTimeout);
        reverseTimer = reverseTimeout = null;
      }
      function cancelSearch() {
        searchEpoch++;
        if (activeSearch) clearTimeout(activeSearch.timeout);
        activeSearch = null;
      }
      function ready() {
        if (!mapComplete || !geocoder || readySent) return;
        readySent = true;
        post({ type: 'map_ready' });
        sendCenter();
      }
      map.on('complete', function() { mapComplete = true; ready(); });
      AMap.plugin(['AMap.ToolBar', 'AMap.Scale', 'AMap.Geocoder'], function() {
        try {
          map.addControl(new AMap.ToolBar({ position: 'RB', locate: false }));
          map.addControl(new AMap.Scale());
          geocoder = new AMap.Geocoder({ extensions: 'base' });
          ready();
        } catch (error) { window._mapLoadError(); }
      });

      window._invalidateSelection = function(revision) {
        draftRevision = revision;
        selectionId++;
        clearReverse();
        cancelSearch();
      };

      function sendCenter() {
        if (!readySent) return;
        var c = map.getCenter();
        var lat = c.getLat(), lng = c.getLng();
        if (!valid(lat, lng)) return;
        if (activeSearch) post({ type: 'search_error', requestId: activeSearch.requestId, draftRevision: activeSearch.revision, message: '地图位置已改变，请重新搜索。' });
        cancelSearch();
        clearReverse();
        var id = ++selectionId, revision = draftRevision;
        post({ type: 'center', lat: lat, lng: lng, selectionId: id, draftRevision: revision });
        reverseTimer = setTimeout(function() { doReverse(lat, lng, id, revision); }, 400);
      }

      function doReverse(lat, lng, id, revision) {
        if (!geocoder || id !== selectionId || revision !== draftRevision) return;
        var completed = false;
        function finish(type, address) {
          if (completed || id !== selectionId || revision !== draftRevision) return;
          completed = true;
          if (reverseTimeout) clearTimeout(reverseTimeout);
          post({ type: type, lat: lat, lng: lng, selectionId: id, draftRevision: revision, address: address || '' });
        }
        post({ type: 'reverse_start', lat: lat, lng: lng, selectionId: id, draftRevision: revision });
        reverseTimeout = setTimeout(function() { finish('reverse_error'); }, 10000);
        try {
          geocoder.getAddress([lng, lat], function(status, result) {
            var address = status === 'complete' && result && result.info === 'OK' && result.regeocode ? result.regeocode.formattedAddress : '';
            finish(address ? 'reverse_done' : 'reverse_error', address);
          });
        } catch (error) { finish('reverse_error'); }
      }

      // 移动刚开始就撤销地址匹配，避免拖动期间确认旧坐标。
      map.on('movestart', function() {
        clearReverse();
        selectionId++;
        post({ type: 'selection_invalidated', draftRevision: draftRevision, selectionId: selectionId });
      });
      map.on('moveend', sendCenter);
      map.on('zoomend', sendCenter);

      window._searchAddress = function(query, requestId, revision) {
        if (!readySent || !geocoder || !query || !query.trim()) return;
        clearReverse(); cancelSearch(); selectionId++;
        draftRevision = revision;
        var epoch = searchEpoch;
        var request = { requestId: requestId, revision: revision, timeout: null };
        activeSearch = request;
        function fail(message) {
          if (activeSearch !== request || epoch !== searchEpoch || revision !== draftRevision) return;
          cancelSearch();
          post({ type: 'search_error', requestId: requestId, draftRevision: revision, message: message });
        }
        request.timeout = setTimeout(function() { fail('地址搜索超时，请检查网络后重试。'); }, 10000);
        post({ type: 'search_start', requestId: requestId, draftRevision: revision });
        try { geocoder.getLocation(query.trim(), function(status, result) {
          if (activeSearch !== request || epoch !== searchEpoch || revision !== draftRevision) return;
          var matches = result && result.geocodes, match = matches && matches[0], point = match && match.location;
          if (status !== 'complete' || !point || !valid(point.lat, point.lng) || !match.formattedAddress) { fail('没有找到这个地址，请补充城市或门牌号。'); return; }
          clearTimeout(request.timeout); activeSearch = null;
          map.setZoomAndCenter(17, [point.lng, point.lat]);
          clearReverse();
          var id = ++selectionId;
          post({ type: 'search_done', requestId: requestId, draftRevision: revision, selectionId: id,
            lat: point.lat, lng: point.lng, address: match.formattedAddress });
        }); } catch (error) { fail('地址搜索失败，请检查网络后重试。'); }
      };

      window._setCenterFromGps = function(wgsLat, wgsLng, zoom, revision, requestId) {
        try {
          if (!readySent || !valid(wgsLat, wgsLng)) throw new Error('Invalid location');
          window._invalidateSelection(revision);
          var g = wgs84ToGcj02(wgsLng, wgsLat);
          map.setZoomAndCenter(zoom || 17, [g.lng, g.lat]);
          sendCenter();
          post({ type: 'locate_applied', requestId: requestId });
        } catch (error) {
          post({ type: 'locate_error', requestId: requestId });
        }
      };
      } catch (error) { window._mapLoadError(); }
    })();
  </script>
</body>
</html>`
}

type MapCoords = { latitude: number; longitude: number }
type MatchedPlace = MapCoords & { name: string; draftRevision: number; generation: number }
const MAP_LOAD_TIMEOUT_MS = 15000
const REQUEST_TIMEOUT_MS = 12000

function validCoords(lat: unknown, lng: unknown): lat is number {
  return typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}
function sameCoords(coords: MapCoords | null, lat: unknown, lng: unknown) {
  return validCoords(lat, lng) && coords !== null &&
    Math.abs(coords.latitude - lat) < 0.0000001 && Math.abs(coords.longitude - (lng as number)) < 0.0000001
}

export default function LocationPickerScreen({ navigation, route }: RootStackScreen<'LocationPicker'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const webviewRef = useRef<WebView>(null)
  const scrollRef = useRef<ScrollView>(null)
  const mountedRef = useRef(true)
  const generationRef = useRef(0)
  const mapReadyRef = useRef(false)
  const mapErrorRef = useRef('')
  const draftRevisionRef = useRef(0)
  const userDraftRef = useRef(false)
  const selectionIdRef = useRef(0)
  const coordsRef = useRef<MapCoords | null>(null)
  const matchedRef = useRef<MatchedPlace | null>(null)
  const searchIdRef = useRef(0)
  const currentSearchRef = useRef<{ id: number; draftRevision: number } | null>(null)
  const locateIdRef = useRef(0)
  const savingRef = useRef(false)
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reverseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const locateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const routeId = route.params?.routeId
  const isSupplementMode = Boolean(routeId)

  const [generation, setGeneration] = useState(0)
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState('')
  const [placeText, setPlaceText] = useState('')
  const [placeMatchesMap, setPlaceMatchesMap] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [searching, setSearching] = useState(false)
  const [locating, setLocating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [html, setHtml] = useState(() => buildMapHtml(DEFAULT_LAT, DEFAULT_LNG, theme, 0))

  const clearTimer = (ref: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) => {
    if (ref.current !== null) clearTimeout(ref.current)
    ref.current = null
  }
  const invalidateMatch = () => {
    matchedRef.current = null
    setPlaceMatchesMap(false)
  }
  const clearRequests = () => {
    clearTimer(searchTimeoutRef)
    clearTimer(reverseTimeoutRef)
    clearTimer(locateTimeoutRef)
    currentSearchRef.current = null
    locateIdRef.current++
    setSearching(false)
    setResolving(false)
    setLocating(false)
    invalidateMatch()
  }
  const failMap = (message: string, expectedGeneration: number) => {
    if (!mountedRef.current || generationRef.current !== expectedGeneration || savingRef.current) return
    mapReadyRef.current = false
    mapErrorRef.current = message
    clearTimer(loadTimeoutRef)
    clearRequests()
    setMapReady(false)
    setMapError(message)
    webviewRef.current?.stopLoading()
  }

  useEffect(() => {
    mountedRef.current = true
    const show = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardOpen(true)
      scrollRef.current?.scrollToEnd({ animated: true })
    })
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false))
    return () => {
      mountedRef.current = false
      generationRef.current++
      ;[loadTimeoutRef, searchTimeoutRef, reverseTimeoutRef, locateTimeoutRef].forEach(clearTimer)
      show.remove()
      hide.remove()
    }
  }, [])

  useEffect(() => {
    const expected = generation
    loadTimeoutRef.current = setTimeout(() => {
      if (!mapReadyRef.current) failMap('地图加载超时，请检查网络后重新加载。', expected)
    }, MAP_LOAD_TIMEOUT_MS)
    return () => clearTimer(loadTimeoutRef)
  }, [generation])

  useEffect(() => {
    if (!mapReady) return
    webviewRef.current?.injectJavaScript(
      'document.documentElement.style.setProperty("--map-background", ' + JSON.stringify(theme.paper) +
      '); document.documentElement.style.setProperty("--map-marker", ' + JSON.stringify(theme.green) +
      '); document.documentElement.style.setProperty("--map-marker-ink", ' + JSON.stringify(theme.onPrimary) + '); true;',
    )
  }, [mapReady, theme.paper, theme.green, theme.onPrimary])

  const retryMap = () => {
    if (savingRef.current) return
    const nextGeneration = ++generationRef.current
    mapReadyRef.current = false
    mapErrorRef.current = ''
    clearTimer(loadTimeoutRef)
    clearRequests()
    coordsRef.current = null
    selectionIdRef.current = 0
    setRequestError('')
    setMapReady(false)
    setMapError('')
    setHtml(buildMapHtml(DEFAULT_LAT, DEFAULT_LNG, theme, nextGeneration))
    setGeneration(nextGeneration)
  }

  const handleDraftChange = (text: string) => {
    setPlaceText(text)
    userDraftRef.current = true
    draftRevisionRef.current++
    clearTimer(searchTimeoutRef)
    clearTimer(reverseTimeoutRef)
    clearTimer(locateTimeoutRef)
    locateIdRef.current++
    currentSearchRef.current = null
    setSearching(false)
    setResolving(false)
    setLocating(false)
    setRequestError('')
    invalidateMatch()
    if (mapReadyRef.current && !mapErrorRef.current) {
      webviewRef.current?.injectJavaScript('window._invalidateSelection(' + draftRevisionRef.current + '); true;')
    }
  }

  const handleLocate = async () => {
    if (!mapReadyRef.current || mapErrorRef.current || locating || savingRef.current) return
    const expected = generationRef.current
    const requestId = ++locateIdRef.current
    const draftRevision = ++draftRevisionRef.current
    userDraftRef.current = false
    clearRequests()
    locateIdRef.current = requestId
    setLocating(true)
    setRequestError('')
    locateTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current || expected !== generationRef.current || requestId !== locateIdRef.current) return
      locateIdRef.current++
      setLocating(false)
      setRequestError('定位超时，请重试或搜索地点。')
    }, REQUEST_TIMEOUT_MS)
    try {
      const result = await getCurrentLocation({ highAccuracy: true, expireMs: 10000 })
      if (!mountedRef.current || expected !== generationRef.current || requestId !== locateIdRef.current || !mapReadyRef.current) return
      if (!validCoords(result.latitude, result.longitude)) throw new Error('定位服务未返回有效坐标')
      webviewRef.current?.injectJavaScript(
        'window._setCenterFromGps(' + result.latitude + ', ' + result.longitude + ', 17, ' + draftRevision + ', ' + requestId + '); true;',
      )
    } catch (error) {
      if (!mountedRef.current || expected !== generationRef.current || requestId !== locateIdRef.current) return
      clearTimer(locateTimeoutRef)
      setLocating(false)
      setRequestError(locationPermissionErrorMessage(error))
    }
  }

  const handleMessage = (event: WebViewMessageEvent, expectedGeneration: number) => {
    if (!mountedRef.current || expectedGeneration !== generationRef.current || mapErrorRef.current || savingRef.current) return
    try {
      const data = JSON.parse(event.nativeEvent.data)
      if (data.generation !== expectedGeneration) return
      if (data.type === 'map_error') {
        failMap('地图服务加载失败，请检查网络后重新加载。', expectedGeneration)
        return
      }
      if (data.type === 'map_ready') {
        mapReadyRef.current = true
        clearTimer(loadTimeoutRef)
        setMapReady(true)
        // A retry keeps the text draft; synchronize its revision before further map interaction.
        webviewRef.current?.injectJavaScript('window._invalidateSelection(' + draftRevisionRef.current + '); true;')
        return
      }
      if (!mapReadyRef.current) return
      if (data.type === 'locate_applied' || data.type === 'locate_error') {
        if (data.requestId !== locateIdRef.current) return
        clearTimer(locateTimeoutRef)
        setLocating(false)
        if (data.type === 'locate_error') setRequestError('地图移动失败，请重试定位或搜索地点。')
        return
      }
      if (data.draftRevision !== draftRevisionRef.current) return
      const matchesCenter = () => data.selectionId === selectionIdRef.current && sameCoords(coordsRef.current, data.lat, data.lng)
      const completeMatch = () => {
        if (!validCoords(data.lat, data.lng) || typeof data.address !== 'string' || !data.address.trim()) return false
        const coords = { latitude: data.lat as number, longitude: data.lng as number }
        coordsRef.current = coords
        matchedRef.current = { ...coords, name: data.address.trim(), draftRevision: draftRevisionRef.current, generation: expectedGeneration }
        setPlaceText(data.address.trim())
        userDraftRef.current = false
        setPlaceMatchesMap(true)
        setRequestError('')
        return true
      }
      if (data.type === 'selection_invalidated') {
        clearTimer(reverseTimeoutRef)
        if (Number.isInteger(data.selectionId)) selectionIdRef.current = Math.max(selectionIdRef.current, data.selectionId)
        coordsRef.current = null
        setResolving(false)
        invalidateMatch()
      } else if (data.type === 'center') {
        if (!validCoords(data.lat, data.lng) || !Number.isInteger(data.selectionId) || data.selectionId <= selectionIdRef.current) return
        clearTimer(reverseTimeoutRef)
        selectionIdRef.current = data.selectionId
        coordsRef.current = { latitude: data.lat, longitude: data.lng }
        setResolving(false)
        invalidateMatch()
      } else if (data.type === 'reverse_start' && matchesCenter() && !userDraftRef.current) {
        setResolving(true)
        invalidateMatch()
        clearTimer(reverseTimeoutRef)
        const selection = data.selectionId, revision = data.draftRevision
        reverseTimeoutRef.current = setTimeout(() => {
          if (!mountedRef.current || expectedGeneration !== generationRef.current || selection !== selectionIdRef.current || revision !== draftRevisionRef.current) return
          setResolving(false)
          setRequestError('地点识别超时，请搜索地点或重新移动地图。')
        }, REQUEST_TIMEOUT_MS)
      } else if (data.type === 'reverse_done' && matchesCenter()) {
        clearTimer(reverseTimeoutRef)
        setResolving(false)
        if (userDraftRef.current) return
        if (!completeMatch()) { invalidateMatch(); setRequestError('未识别到地点，请输入名称搜索。') }
      } else if (data.type === 'reverse_error' && matchesCenter()) {
        clearTimer(reverseTimeoutRef)
        setResolving(false)
        invalidateMatch()
        if (!userDraftRef.current) setRequestError('未识别到地点，请输入名称搜索。')
      } else if (data.type === 'search_done' || data.type === 'search_error') {
        const search = currentSearchRef.current
        if (!search || data.requestId !== search.id || data.draftRevision !== search.draftRevision) return
        clearTimer(searchTimeoutRef)
        currentSearchRef.current = null
        setSearching(false)
        if (data.type === 'search_done' && Number.isInteger(data.selectionId) && data.selectionId > selectionIdRef.current && completeMatch()) {
          selectionIdRef.current = data.selectionId
        } else {
          invalidateMatch()
          setRequestError(data.type === 'search_error' && typeof data.message === 'string' ? data.message : '未取得有效地点，请重新搜索。')
        }
      }
    } catch {
      // 非本页协议、损坏或过期消息均不能改变已确认坐标。
    }
  }

  const handleAddressSearch = () => {
    if (!mapReadyRef.current || mapErrorRef.current || searching || locating || savingRef.current) return
    const query = placeText.trim()
    if (!query) { setRequestError('请输入地点名称或地址。'); return }
    Keyboard.dismiss()
    const expected = generationRef.current
    const requestId = ++searchIdRef.current
    const draftRevision = draftRevisionRef.current
    clearRequests()
    currentSearchRef.current = { id: requestId, draftRevision }
    setSearching(true)
    setRequestError('')
    searchTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current || expected !== generationRef.current || currentSearchRef.current?.id !== requestId) return
      currentSearchRef.current = null
      setSearching(false)
      setRequestError('地址搜索超时，请检查网络后重试。')
    }, REQUEST_TIMEOUT_MS)
    webviewRef.current?.injectJavaScript('window._searchAddress(' + JSON.stringify(query) + ', ' + requestId + ', ' + draftRevision + '); true;')
  }

  const handleConfirm = async () => {
    if (savingRef.current) return
    Keyboard.dismiss()
    const match = matchedRef.current
    if (!mapReadyRef.current || mapErrorRef.current || !match || searching || locating || resolving ||
      match.generation !== generationRef.current || match.draftRevision !== draftRevisionRef.current ||
      !sameCoords(coordsRef.current, match.latitude, match.longitude)) {
      setRequestError(mapReadyRef.current ? '请先搜索地点，或移动地图并等待地址匹配。' : '地图尚不可用，请重新加载或选择不记录地点。')
      return
    }
    const location: RouteLocation = { name: match.name, address: match.name, latitude: match.latitude, longitude: match.longitude,
      accuracy: 0, source: 'map', confirmedAt: Date.now() }
    savingRef.current = true
    setSaving(true)
    try {
      if (routeId) {
        const ok = await updateRouteLocation(routeId, location)
        if (!mountedRef.current) return
        if (!ok) { setRequestError('地点保存失败，原路线可能已删除。'); return }
        navigation.replace('RouteProfile', { id: routeId })
      } else {
        const now = Date.now()
        const template: RouteTemplate = {
          id: uid('route'), name: match.name, startFloor: DEFAULT_START_FLOOR, endFloor: DEFAULT_START_FLOOR,
          carryMode: DEFAULT_CARRY_MODE, floorHeightM: 0, totalAscentM: 0,
          device: { platform: Platform.OS || 'unknown', model: 'unknown', system: Platform.Version?.toString() || 'unknown' },
          segments: [], markers: [], createdAt: now, updatedAt: now, version: 1, status: 'draft', location,
          learningProvenance: 'training_rounds',
        }
        await saveRoute(template)
        if (mountedRef.current) navigation.replace('RouteProfile', { id: template.id })
      }
    } catch (error) {
      if (mountedRef.current) setRequestError(error instanceof Error ? error.message : '保存失败，请重试。')
    } finally {
      savingRef.current = false
      if (mountedRef.current) setSaving(false)
    }
  }

  const handleCancel = () => {
    if (savingRef.current) return
    Keyboard.dismiss()
    if (routeId) navigation.replace('RouteProfile', { id: routeId })
    else navigation.goBack()
  }
  const handleWithoutLocation = () => {
    if (savingRef.current) return
    Keyboard.dismiss()
    if (routeId) navigation.replace('RouteProfile', { id: routeId })
    else navigation.replace('QuickStart')
  }
  const searchDisabled = !mapReady || Boolean(mapError) || searching || locating || saving
  const confirmDisabled = searchDisabled || resolving || !placeMatchesMap

  return (
    <View style={styles.page}>
      <Header title={isSupplementMode ? '补充起点位置' : '选择起点'} back />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView ref={scrollRef} style={styles.flex} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
          contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.scrollContent}>
          <View style={[styles.mapWrap, keyboardOpen && styles.mapCompact]} onTouchStart={() => { userDraftRef.current = false }}>
            <WebView key={generation} ref={webviewRef} source={{ html }} style={styles.webview}
              onMessage={event => handleMessage(event, generation)}
              onError={() => failMap('地图服务加载失败，请检查网络后重新加载。', generation)}
              onHttpError={() => failMap('地图服务响应失败，请稍后重新加载。', generation)}
              onRenderProcessGone={() => failMap('地图已停止运行，请重新加载。', generation)}
              onContentProcessDidTerminate={() => failMap('地图已停止运行，请重新加载。', generation)}
              androidLayerType="hardware" originWhitelist={['*']} />
            {!mapReady && !mapError ? (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color={theme.green} />
                <Text style={styles.mapBody}>地图加载中…</Text>
              </View>
            ) : null}
            {mapError ? (
              <View style={styles.errorOverlay}>
                <Ionicons name="cloud-offline-outline" size={32} color={theme.mutedStrong} />
                <Text style={styles.errorTitle}>暂时无法加载地图</Text>
                <Text style={styles.mapBody}>{mapError}</Text>
                <Button title="重新加载地图" variant="secondary" onPress={retryMap} />
              </View>
            ) : null}
            {mapReady ? (
              <Pressable accessibilityRole="button" accessibilityLabel="定位到当前位置" disabled={locating || saving}
                onPress={handleLocate} style={({ pressed }) => [styles.locateButton, pressed && styles.pressed]}>
                {locating ? <ActivityIndicator size="small" color={theme.green} /> : <Ionicons name="locate-outline" size={24} color={theme.green} />}
              </Pressable>
            ) : null}
          </View>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>楼梯从哪里开始</Text>
            <Text style={styles.sheetHint}>{mapError ? '输入已保留。可重试地图，或继续不记录地点。' : resolving ? '正在匹配地图上的地点…' :
              placeMatchesMap ? '地点已匹配，确认后保存这处起点。' : mapReady ? '移动地图选点，或输入地点搜索。' : '地图准备好后可以搜索地点。'}</Text>
            {mapError ? <Button title={routeId ? '返回原路线' : '不记录地点，快速开练'} variant="secondary" onPress={handleWithoutLocation} /> : null}
            {mapError && keyboardOpen ? <Button title="重新加载地图" variant="secondary" onPress={retryMap} /> : null}
            <TextInput accessibilityLabel="输入地点名称或地址" style={styles.input} value={placeText} editable={!saving}
              onChangeText={handleDraftChange} placeholder="地点名称或地址" placeholderTextColor={theme.mutedStrong}
              returnKeyType="search" onSubmitEditing={handleAddressSearch} autoCorrect={false} />
            {requestError ? <Text accessibilityRole="alert" style={styles.inlineError}>{requestError}</Text> : null}
          </View>
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: (keyboardOpen ? 0 : insets.bottom) + 12 }]}>
          <View style={styles.actionRow}>
            <Button title="搜索地点" onPress={handleAddressSearch} loading={searching} disabled={searchDisabled} style={styles.action} />
            <Button title="取消" variant="secondary" onPress={handleCancel} disabled={saving} style={styles.action} />
          </View>
          <Button title={isSupplementMode ? '保存地点' : '确认并建路线'} onPress={handleConfirm} loading={saving} disabled={confirmDisabled} />
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.paper },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  mapWrap: { flexGrow: 1, minHeight: 260, position: 'relative', overflow: 'hidden' },
  mapCompact: { flexGrow: 0, height: 0, minHeight: 0 },
  webview: { ...StyleSheet.absoluteFill, backgroundColor: theme.paper },
  loadingOverlay: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.paper, gap: 12 },
  errorOverlay: { backgroundColor: theme.paper, paddingHorizontal: 20, paddingVertical: 24, alignItems: 'stretch', gap: 12 },
  errorTitle: { color: theme.ink, fontSize: 17, lineHeight: 24, fontWeight: '600' },
  mapBody: { color: theme.mutedStrong, fontSize: 14, lineHeight: 21 },
  locateButton: { position: 'absolute', right: 20, bottom: 16, width: 48, height: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', backgroundColor: theme.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.line },
  pressed: { opacity: 0.75 },
  sheet: { backgroundColor: theme.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, gap: 12 },
  sheetTitle: { color: theme.ink, fontSize: 17, lineHeight: 24, fontWeight: '600' },
  sheetHint: { color: theme.mutedStrong, fontSize: 14, lineHeight: 21 },
  input: { borderWidth: 1, borderColor: theme.line, borderRadius: 10, minHeight: 56, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 15, lineHeight: 22, color: theme.ink, backgroundColor: theme.cardSoft },
  inlineError: { color: theme.redInk, fontSize: 14, lineHeight: 21 },
  footer: { backgroundColor: theme.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line,
    paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  actionRow: { flexDirection: 'row', gap: 12 },
  action: { flex: 1 },
})
