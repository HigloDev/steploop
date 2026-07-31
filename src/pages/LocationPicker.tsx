// 地图选点页：WebView 嵌入高德 JS API 2.0（原生高德地图）+ 高德逆地理编码。
// 使用高德官方 JS API key + 安全密钥，地图样式、控件、大头针均为高德原生。
// 两种模式：
//   - 新建路线（无 routeId）：确认后创建 draft 路线，直接跳转 WorkoutSetup（首次开张：边爬边建模板）。
//   - 补充旧路线地点（有 routeId）：确认后调用 updateRouteLocation 写回路线。

import React, { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView, WebViewMessageEvent } from 'react-native-webview'

import { Header } from '../components/Header'
import { Button } from '../components/ui'
import { useTheme, Theme } from '../theme'
import { RootStackScreen } from '../navigation/types'
import { RouteLocation, RouteTemplate } from '../core/types'
import { uid } from '../core/math'
import { getCurrentLocation, locationPermissionErrorMessage } from '../services/location'
import { saveRoute, updateRouteLocation } from '../services/storage'

// 高德 JS API Key + 安全密钥（Web端 JS API 类型）。
// 注意：此 key 会暴露在前端代码中，高德 JS API 个人开发者免费不限调用次数，只限 QPS。
const AMAP_JS_KEY = '86de9d2ef905545ffefa7e8559ebbfbd'
const AMAP_SECURITY_CODE = '1fc0d516d6c4a6f0fca7ee7873e9cb9d'

// 默认坐标：武夷山市（项目所在地，GCJ-02 坐标系，高德默认坐标系）
const DEFAULT_LAT = 27.7559
const DEFAULT_LNG = 118.0253
const DEFAULT_START_FLOOR = 1
const DEFAULT_CARRY_MODE = 'pocket' as const

// WebView 内嵌的 HTML：高德 JS API 2.0 原生地图 + 中心固定大头针 + 逆地理编码。
// 包含 WGS-84 → GCJ-02 坐标转换（GPS 定位返回 WGS-84，高德地图是 GCJ-02）。
function buildMapHtml(initialLat: number, initialLng: number): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { width: 100%; height: 100%; }
    #map { background: #e8e8e8; }
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
    // 高德 JS API 2.0 安全密钥配置（必须在加载 JS API 脚本前设置）
    window._AMapSecurityConfig = {
      securityJsCode: '${AMAP_SECURITY_CODE}'
    };
  </script>
  <script src="https://webapi.amap.com/maps?v=2.0&key=${AMAP_JS_KEY}"></script>
</head>
<body>
  <div id="map"></div>
  <div id="pin">
    <svg width="32" height="42" viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 0 C7.16 0 0 7.16 0 16 C0 28 16 42 16 42 C16 42 32 28 32 16 C32 7.16 24.84 0 16 0 Z" fill="#2e7d32"/>
      <circle cx="16" cy="16" r="6" fill="#fff"/>
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

      var map = new AMap.Map('map', {
        center: [${initialLng}, ${initialLat}],
        zoom: 16,
        resizeEnable: true,
        viewMode: '2D'
      });

      // 高德原生控件
      AMap.plugin(['AMap.ToolBar', 'AMap.Scale', 'AMap.Geocoder'], function() {
        map.addControl(new AMap.ToolBar({ position: 'RB', locate: false }));
        map.addControl(new AMap.Scale());
      });

      var geocoder = null;
      AMap.plugin('AMap.Geocoder', function() {
        geocoder = new AMap.Geocoder({ extensions: 'base' });
      });

      var reverseTimer = null;

      function sendCenter() {
        var c = map.getCenter();
        var lat = c.getLat();
        var lng = c.getLng();
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'center', lat: lat, lng: lng, zoom: map.getZoom()
        }));
        // 逆地理编码（高德原生，使用 GCJ-02 坐标，无需转换）
        if (reverseTimer) clearTimeout(reverseTimer);
        reverseTimer = setTimeout(function() {
          doReverse(lat, lng);
        }, 500);
      }

      function doReverse(lat, lng) {
        if (!geocoder) {
          // 插件尚未加载完成，稍后重试
          setTimeout(function() { doReverse(lat, lng); }, 300);
          return;
        }
        try {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'reverse_start' }));
        } catch(e) {}
        geocoder.getAddress([lng, lat], function(status, result) {
          var addr = '';
          if (status === 'complete' && result.info === 'OK' && result.regeocode) {
            addr = result.regeocode.formattedAddress || '';
          }
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'reverse_done', address: addr, raw: null
          }));
        });
      }

      // 地图移动停止时通知 RN
      map.on('mapmove', function() {
        // 节流：拖动过程中频繁触发，只在 moveend 发送
      });
      map.on('moveend', sendCenter);
      map.on('zoomend', sendCenter);

      // RN 调用：移动地图到指定 GCJ-02 坐标
      window._setCenter = function(lat, lng, zoom) {
        map.setZoomAndCenter(zoom || 16, [lng, lat]);
      };

      // RN 调用：把输入的地址解析为地图坐标，并移动到第一个匹配地点。
      window._searchAddress = function(query) {
        if (!query || !query.trim()) return;
        if (!geocoder) {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'search_error', message: '地图服务尚未准备好，请稍后再试'
          }));
          return;
        }
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'search_start'
        }));
        var completed = false;
        var timeout = setTimeout(function() {
          if (completed) return;
          completed = true;
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'search_error', message: '地址搜索超时，请检查网络后重试'
          }));
        }, 10000);
        geocoder.getLocation(query.trim(), function(status, result) {
          if (completed) return;
          completed = true;
          clearTimeout(timeout);
          var matches = result && result.geocodes;
          if (status !== 'complete' || !matches || !matches.length || !matches[0].location) {
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'search_error', message: '没有找到这个地址，请补充城市、区县或门牌号'
            }));
            return;
          }
          var match = matches[0];
          var location = match.location;
          map.setZoomAndCenter(17, [location.lng, location.lat]);
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'search_done',
            address: match.formattedAddress || query.trim()
          }));
          setTimeout(sendCenter, 250);
        });
      };

      // RN 调用：接收 WGS-84 GPS 坐标，转换为 GCJ-02 后移动地图
      window._setCenterFromGps = function(wgsLat, wgsLng, zoom) {
        try {
          var g = wgs84ToGcj02(wgsLng, wgsLat);
          map.setZoomAndCenter(zoom || 17, [g.lng, g.lat]);
          setTimeout(sendCenter, 250);
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'locate_applied'
          }));
        } catch (error) {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'locate_error',
            message: error && error.message ? error.message : '地图定位失败'
          }));
        }
      };

      // 必须等地图对象和接收 GPS 的函数都建好后，再通知 RN。
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'map_ready'
      }));

      // 初始发送一次中心点
      setTimeout(sendCenter, 500);
    })();
  </script>
</body>
</html>`
}

export default function LocationPickerScreen({
  navigation,
  route,
}: RootStackScreen<'LocationPicker'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const webviewRef = useRef<WebView>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingGpsRef = useRef<{ latitude: number; longitude: number } | null>(null)
  const mapReadyRef = useRef(false)
  const routeId = route.params?.routeId
  const isSupplementMode = Boolean(routeId)

  const [mapReady, setMapReady] = useState(false)
  const [coords, setCoords] = useState({
    latitude: DEFAULT_LAT,
    longitude: DEFAULT_LNG,
  })
  const [address, setAddress] = useState('')
  const [placeText, setPlaceText] = useState('')
  const [placeMatchesMap, setPlaceMatchesMap] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [searching, setSearching] = useState(false)
  const [locating, setLocating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [html] = useState(() => buildMapHtml(DEFAULT_LAT, DEFAULT_LNG))

  useEffect(
    () => () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    },
    [],
  )

  // 获取 GPS 定位，移动地图到当前位置。
  // GPS 返回 WGS-84 坐标，通过 _setCenterFromGps 在 WebView 内转换为 GCJ-02。
  const applyGpsToMap = (latitude: number, longitude: number) => {
    webviewRef.current?.injectJavaScript(
      `window._setCenterFromGps(${latitude}, ${longitude}, 17); true;`,
    )
  }

  const handleLocate = async () => {
    if (locating) return
    setLocating(true)
    try {
      const result = await getCurrentLocation({ highAccuracy: true, expireMs: 10000 })
      pendingGpsRef.current = result
      if (mapReadyRef.current) {
        applyGpsToMap(result.latitude, result.longitude)
      }
    } catch (err) {
      pendingGpsRef.current = null
      setLocating(false)
      Alert.alert('定位失败', locationPermissionErrorMessage(err))
    }
  }

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data)
      if (data.type === 'map_ready') {
        mapReadyRef.current = true
        setMapReady(true)
        const pendingGps = pendingGpsRef.current
        if (pendingGps) applyGpsToMap(pendingGps.latitude, pendingGps.longitude)
      } else if (data.type === 'center') {
        setCoords({ latitude: data.lat, longitude: data.lng })
      } else if (data.type === 'reverse_start') {
        setResolving(true)
        setPlaceMatchesMap(false)
      } else if (data.type === 'reverse_done') {
        setResolving(false)
        const nextAddress = data.address || ''
        setAddress(nextAddress)
        setPlaceText(nextAddress)
        setPlaceMatchesMap(Boolean(nextAddress))
      } else if (data.type === 'reverse_error') {
        setResolving(false)
        setAddress('')
        setPlaceMatchesMap(false)
      } else if (data.type === 'search_start') {
        setSearching(true)
      } else if (data.type === 'search_done') {
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
        searchTimeoutRef.current = null
        setSearching(false)
        const nextAddress = data.address || ''
        if (nextAddress) setAddress(nextAddress)
        if (nextAddress) setPlaceText(nextAddress)
        setPlaceMatchesMap(Boolean(nextAddress))
      } else if (data.type === 'search_error') {
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
        searchTimeoutRef.current = null
        setSearching(false)
        Alert.alert('没有找到地点', data.message || '请检查地址后重试')
      } else if (data.type === 'locate_request') {
        handleLocate()
      } else if (data.type === 'locate_applied') {
        pendingGpsRef.current = null
        setLocating(false)
      } else if (data.type === 'locate_error') {
        pendingGpsRef.current = null
        setLocating(false)
        Alert.alert('定位失败', '已经取得手机位置，但地图移动失败，请重试。')
      }
    } catch (err) {
      // 忽略解析错误
    }
  }

  const handleAddressSearch = () => {
    const query = placeText.trim()
    if (!query) {
      Alert.alert('请输入地点名称', '可以输入小区、写字楼、商场或完整门牌地址')
      return
    }
    Keyboard.dismiss()
    setSearching(true)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      searchTimeoutRef.current = null
      setSearching(false)
      Alert.alert('地址搜索超时', '请检查网络后重试，或者直接拖动地图选择地点')
    }, 12000)
    webviewRef.current?.injectJavaScript(
      `window._searchAddress && window._searchAddress(${JSON.stringify(query)}); true;`,
    )
  }

  const handleConfirm = async () => {
    Keyboard.dismiss()
    if (!placeMatchesMap || resolving || searching) {
      Alert.alert('请先确认地点', '请先搜索输入的地点，或拖动地图让定位标记对准入口。')
      return
    }
    const coordText = `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`
    const finalName = placeText.trim() || address.split(',')[0] || `位置(${coordText})`
    const location: RouteLocation = {
      name: finalName,
      address: address || coordText,
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: 0,
      source: 'map',
      confirmedAt: Date.now(),
    }

    // 补充旧路线地点模式
    if (isSupplementMode && routeId) {
      setSaving(true)
      try {
        const ok = await updateRouteLocation(routeId, location)
        if (ok) {
          Alert.alert('已保存', '地点已更新', [
            { text: '好的', onPress: () => navigation.navigate('RouteEdit') },
          ])
        } else {
          Alert.alert('失败', '保存地点失败，路线可能已被删除')
        }
      } catch (err) {
        Alert.alert('失败', err instanceof Error ? err.message : '保存地点失败')
      } finally {
        setSaving(false)
      }
      return
    }

    // 选点页只知道地点，不知道这栋楼的真实终点。
    // 新路线先保存成“终点未知”，首次采集结束时再由用户确认实际楼层。
    const now = Date.now()

    // 创建 draft 路线（segments 为空，首次训练时边爬边建模板）
    const route: RouteTemplate = {
      id: uid('route'),
      name: finalName,
      startFloor: DEFAULT_START_FLOOR,
      endFloor: DEFAULT_START_FLOOR,
      carryMode: DEFAULT_CARRY_MODE,
      floorHeightM: 0,
      totalAscentM: 0,
      device: {
        platform: Platform.OS || 'unknown',
        model: 'unknown',
        system: Platform.Version?.toString() || 'unknown',
      },
      segments: [],
      markers: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
      status: 'draft',
      location,
    }

    setSaving(true)
    try {
      await saveRoute(route)
      navigation.replace('RouteProfile', { id: route.id })
    } catch (err) {
      Alert.alert('保存失败', err instanceof Error ? err.message : '路线保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.page}>
      <Header title={isSupplementMode ? '补充起点位置' : '选择起点'} back />
      <View style={styles.mapWrap}>
        <WebView
          ref={webviewRef}
          source={{ html }}
          style={styles.webview}
          onMessage={handleMessage}
          androidLayerType="hardware"
          allowsInlineMediaPlayback
          geolocationEnabled
          originWhitelist={['*']}
        />
        {!mapReady ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={theme.green} />
            <Text style={styles.loadingText}>地图加载中…</Text>
          </View>
        ) : null}
        {mapReady ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="定位到当前位置"
            disabled={locating}
            onPress={handleLocate}
            style={({ pressed }) => [
              styles.locateButton,
              pressed && !locating && styles.locateButtonPressed,
            ]}
          >
            {locating ? (
              <ActivityIndicator size="small" color="#111" />
            ) : (
              <Text style={styles.locateButtonText}>◎</Text>
            )}
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + 10 }]}>
        <View style={styles.searchRow}>
          <TextInput
            accessibilityLabel="输入地点名称或地址"
            style={[styles.input, styles.searchInput]}
            value={placeText}
            onChangeText={(text) => {
              setPlaceText(text)
              setPlaceMatchesMap(false)
            }}
            placeholder={resolving ? '正在识别地图位置…' : '输入建筑名称或详细地址'}
            placeholderTextColor={theme.muted}
            returnKeyType="search"
            onSubmitEditing={handleAddressSearch}
            autoCorrect={false}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="搜索地点"
            style={({ pressed }) => [
              styles.searchButton,
              pressed && styles.searchButtonPressed,
            ]}
            disabled={searching || resolving}
            onPress={handleAddressSearch}
          >
            {searching ? (
              <ActivityIndicator size="small" color={theme.paper} />
            ) : (
              <Text style={styles.searchButtonText}>搜索</Text>
            )}
          </Pressable>
        </View>

        <Button
          title={
            saving
              ? '保存中…'
              : locating
                ? '定位中…'
                : isSupplementMode
                  ? '保存地点'
                  : '确认地点，建立路线'
          }
          onPress={handleConfirm}
          loading={saving || locating}
          disabled={saving || locating || resolving || searching || !placeMatchesMap}
        />
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.paper },
    mapWrap: { flex: 1, position: 'relative' },
    webview: { flex: 1, backgroundColor: '#e8e8e8' },
    loadingOverlay: {
      ...StyleSheet.absoluteFill,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.paper,
    },
    loadingText: {
      marginTop: 8,
      color: theme.muted,
      fontSize: 14,
    },
    locateButton: {
      position: 'absolute',
      right: 16,
      bottom: 24,
      width: 44,
      height: 44,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#fff',
      elevation: 6,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
    },
    locateButtonPressed: {
      opacity: 0.75,
      transform: [{ scale: 0.96 }],
    },
    locateButtonText: {
      color: '#111',
      fontSize: 25,
      lineHeight: 28,
    },
    sheet: {
      backgroundColor: theme.card,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: 16,
      paddingTop: 12,
      ...(Platform.OS === 'ios'
        ? {
            shadowColor: '#000',
            shadowOpacity: 0.1,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: -2 },
          }
        : { elevation: 8 }),
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
    },
    searchInput: {
      flex: 1,
      marginBottom: 0,
    },
    searchButton: {
      width: 70,
      minHeight: 43,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.green,
    },
    searchButtonPressed: {
      opacity: 0.8,
    },
    searchButtonText: {
      color: theme.paper,
      fontSize: 14,
      fontWeight: '800',
    },
    input: {
      borderWidth: 1,
      borderColor: theme.line,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: theme.ink,
      marginBottom: 12,
    },
  })
