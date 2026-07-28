// 地图选点页：WebView 嵌入高德 JS API 2.0（原生高德地图）+ 高德逆地理编码。
// 使用高德官方 JS API key + 安全密钥，地图样式、控件、大头针均为高德原生。
// 两种模式：
//   - 新建路线（无 routeId）：确认后跳转 Calibrate。
//   - 补充旧路线地点（有 routeId）：确认后调用 updateRouteLocation 写回路线。

import React, { useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
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
import { RouteLocation } from '../core/types'
import { getCurrentLocation, locationPermissionErrorMessage } from '../services/location'
import { updateRouteLocation } from '../services/storage'

// 高德 JS API Key + 安全密钥（Web端 JS API 类型）。
// 注意：此 key 会暴露在前端代码中，高德 JS API 个人开发者免费不限调用次数，只限 QPS。
const AMAP_JS_KEY = '86de9d2ef905545ffefa7e8559ebbfbd'
const AMAP_SECURITY_CODE = '1fc0d516d6c4a6f0fca7ee7873e9cb9d'

// 默认坐标：武夷山市（项目所在地，GCJ-02 坐标系，高德默认坐标系）
const DEFAULT_LAT = 27.7559
const DEFAULT_LNG = 118.0253

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
    /* 定位按钮 */
    #locate-btn {
      position: absolute;
      bottom: 24px; right: 16px;
      z-index: 1000;
      width: 44px; height: 44px;
      background: #fff;
      border: none;
      border-radius: 8px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
      font-size: 22px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
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
  <button id="locate-btn" title="定位到当前位置">◎</button>

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
          var name = '';
          if (status === 'complete' && result.info === 'OK' && result.regeocode) {
            addr = result.regeocode.formattedAddress || '';
            var ac = result.regeocode.addressComponent || {};
            // 高德 API 部分字段可能返回数组，需取第一项
            function pickStr(v) {
              if (Array.isArray(v)) return v.length > 0 ? String(v[0]) : '';
              return v ? String(v) : '';
            }
            name = pickStr(ac.building)
              || pickStr(ac.township)
              || pickStr(ac.street)
              || pickStr(ac.district);
          }
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'reverse_done', address: addr, name: name, raw: null
          }));
        });
      }

      // 地图移动停止时通知 RN
      map.on('mapmove', function() {
        // 节流：拖动过程中频繁触发，只在 moveend 发送
      });
      map.on('moveend', sendCenter);
      map.on('zoomend', sendCenter);

      // 定位按钮
      document.getElementById('locate-btn').addEventListener('click', function() {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'locate_request' }));
      });

      // RN 调用：移动地图到指定 GCJ-02 坐标
      window._setCenter = function(lat, lng, zoom) {
        map.setZoomAndCenter(zoom || 16, [lng, lat]);
      };

      // RN 调用：接收 WGS-84 GPS 坐标，转换为 GCJ-02 后移动地图
      window._setCenterFromGps = function(wgsLat, wgsLng, zoom) {
        var g = wgs84ToGcj02(wgsLng, wgsLat);
        map.setZoomAndCenter(zoom || 17, [g.lng, g.lat]);
      };

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
  const routeId = route.params?.routeId
  const isSupplementMode = Boolean(routeId)

  const [mapReady, setMapReady] = useState(false)
  const [coords, setCoords] = useState({
    latitude: DEFAULT_LAT,
    longitude: DEFAULT_LNG,
  })
  const [address, setAddress] = useState('')
  const [shortName, setShortName] = useState('')
  const [name, setName] = useState('')
  const [resolving, setResolving] = useState(false)
  const [locating, setLocating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [html] = useState(() => buildMapHtml(DEFAULT_LAT, DEFAULT_LNG))

  // 获取 GPS 定位，移动地图到当前位置。
  // GPS 返回 WGS-84 坐标，通过 _setCenterFromGps 在 WebView 内转换为 GCJ-02。
  const handleLocate = async () => {
    setLocating(true)
    try {
      const result = await getCurrentLocation({ highAccuracy: true, expireMs: 5000 })
      webviewRef.current?.injectJavaScript(
        `window._setCenterFromGps && window._setCenterFromGps(${result.latitude}, ${result.longitude}, 17); true;`,
      )
    } catch (err) {
      Alert.alert('定位失败', locationPermissionErrorMessage(err))
    } finally {
      setLocating(false)
    }
  }

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data)
      if (data.type === 'center') {
        setCoords({ latitude: data.lat, longitude: data.lng })
      } else if (data.type === 'reverse_start') {
        setResolving(true)
      } else if (data.type === 'reverse_done') {
        setResolving(false)
        setAddress(data.address || '')
        setShortName(data.name || '')
      } else if (data.type === 'reverse_error') {
        setResolving(false)
        setAddress('')
      } else if (data.type === 'locate_request') {
        handleLocate()
      }
    } catch (err) {
      // 忽略解析错误
    }
  }

  const handleConfirm = async () => {
    Keyboard.dismiss()
    const coordText = `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`
    const finalName = name.trim() || shortName || address.split(',')[0] || `位置(${coordText})`
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

    // 新建路线模式：跳转 Calibrate
    navigation.replace('Calibrate', {
      seed: {
        name: finalName,
        location,
      },
    })
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
          onLoadEnd={() => setMapReady(true)}
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
      </View>

      {/* 底部信息卡片 */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.addressRow}>
          <Text style={styles.fieldLabel}>起点位置</Text>
          {resolving ? (
            <View style={styles.resolvingRow}>
              <ActivityIndicator size="small" color={theme.muted} />
              <Text style={styles.resolvingText}>解析地址中…</Text>
            </View>
          ) : (
            <Text style={styles.addressText} numberOfLines={2}>
              {address || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}（可手动输入名称）`}
            </Text>
          )}
        </View>

        <Text style={styles.fieldLabel}>地点名称（可选）</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder={typeof shortName === 'string' && shortName ? shortName : '如：上海中心大厦'}
          placeholderTextColor={theme.muted}
          returnKeyType="done"
          blurOnSubmit
        />

        <Button
          title={
            saving
              ? '保存中…'
              : locating
                ? '定位中…'
                : isSupplementMode
                  ? '保存地点'
                  : '确认起点，开始标定'
          }
          onPress={handleConfirm}
          loading={saving || locating}
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
    sheet: {
      backgroundColor: theme.card,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: 16,
      paddingTop: 16,
      ...(Platform.OS === 'ios'
        ? {
            shadowColor: '#000',
            shadowOpacity: 0.1,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: -2 },
          }
        : { elevation: 8 }),
    },
    addressRow: {
      marginBottom: 12,
    },
    fieldLabel: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '700',
      marginBottom: 4,
    },
    resolvingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    resolvingText: {
      color: theme.muted,
      fontSize: 13,
    },
    addressText: {
      color: theme.inkSoft,
      fontSize: 13,
      lineHeight: 19,
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
