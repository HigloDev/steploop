import type { RouteLocation } from '../core/types'
import type { Theme } from '../theme'

const amapKey = process.env.EXPO_PUBLIC_AMAP_JS_KEY?.trim()
const amapSecurityCode = process.env.EXPO_PUBLIC_AMAP_SECURITY_CODE?.trim()
export const hasBuildingMap = Boolean(amapKey && amapSecurityCode)

type MapTheme = Pick<Theme, 'paper' | 'brand' | 'onBrand' | 'isDark'>

export function buildingMapHtml(theme: MapTheme, initial?: RouteLocation) {
  const center = initial ? [initial.longitude, initial.latitude] : [118.0253, 27.7559]
  const security = JSON.stringify(amapSecurityCode ?? '').replace(/</g, '\\u003c')
  const mapStyle = theme.isDark ? 'amap://styles/dark' : 'amap://styles/normal'
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body,#map{height:100%;width:100%;margin:0;background:${theme.paper}}
  #pin{position:absolute;left:50%;top:50%;transform:translate(-50%,-100%);pointer-events:none;z-index:2}
</style>
<div id="map" aria-label="楼栋选点地图"></div>
<svg id="pin" width="32" height="42" viewBox="0 0 32 42" aria-hidden="true">
  <path fill="${theme.brand}" d="M16 0C7 0 0 7 0 16C0 27 16 42 16 42S32 27 32 16C32 7 25 0 16 0Z"/>
  <circle cx="16" cy="16" r="6" fill="${theme.onBrand}"/>
</svg>
<script>
  const send = data => window.ReactNativeWebView.postMessage(JSON.stringify(data));
  const failMap = () => send({type:'map-error'});
  window._AMapSecurityConfig = {securityJsCode:${security}};
</script>
<script src="https://webapi.amap.com/maps?v=2.0&amp;key=${encodeURIComponent(amapKey ?? '')}" onerror="failMap()"></script>
<script>
(() => {
  if (typeof AMap === 'undefined') return;
  const map = new AMap.Map('map', {
    center:${JSON.stringify(center)}, zoom:16, viewMode:'2D', resizeEnable:true,
    mapStyle:${JSON.stringify(mapStyle)}
  });
  let geocoder;
  let ready = false;
  let selected = ${Boolean(initial)};
  let revision = 0;
  let addressTimer;
  let activeSearch;
  let locateId;

  function cancelSearch() {
    if (!activeSearch) return;
    clearTimeout(activeSearch.timer);
    activeSearch = undefined;
  }
  function startMoving() {
    if (activeSearch) {
      send({type:'search-error', id:activeSearch.id, message:'地图位置已改变，请重新搜索。'});
      cancelSearch();
    }
    revision++;
    clearTimeout(addressTimer);
    if (selected) send({type:'moving'});
  }
  function pick(point, address) {
    if (!ready || !point) return;
    const lng = point.getLng(), lat = point.getLat();
    const id = ++revision;
    clearTimeout(addressTimer);
    send({type:'point', latitude:lat, longitude:lng, address});
    if (address || !geocoder) return;
    addressTimer = setTimeout(() => {
      geocoder.getAddress([lng,lat], (status, result) => {
        if (id !== revision || status !== 'complete') return;
        const found = result && result.regeocode && result.regeocode.formattedAddress;
        if (found) send({type:'point', latitude:lat, longitude:lng, address:found});
      });
    }, 320);
  }
  function centerOn(point, address) {
    selected = true;
    startMoving();
    map.setZoomAndCenter(17, point, true);
    pick(map.getCenter(), address);
  }
  map.on('complete', () => {
    if (ready) return;
    ready = true;
    send({type:'map-ready'});
    if (selected) pick(map.getCenter(), ${JSON.stringify(initial?.address ?? '').replace(/</g, '\\u003c')});
  });
  AMap.plugin(['AMap.Geocoder','AMap.Scale'], () => {
    geocoder = new AMap.Geocoder({extensions:'base'});
    map.addControl(new AMap.Scale());
    send({type:'search-ready'});
  });
  map.on('dragstart', () => { selected = true; startMoving(); });
  map.on('dragend', () => pick(map.getCenter()));
  map.on('click', event => centerOn(event.lnglat));
  map.on('zoomstart', () => { if (selected) startMoving(); });
  map.on('zoomend', () => { if (selected) pick(map.getCenter()); });

  window.cancelLocationSearch = cancelSearch;
  window.searchBuildingAddress = (query, id) => {
    cancelSearch();
    if (!ready || !geocoder) return;
    const request = {id, timer:setTimeout(() => fail('搜索超时，请检查网络后重试。'), 10000)};
    activeSearch = request;
    function fail(message) {
      if (activeSearch !== request) return;
      cancelSearch();
      send({type:'search-error', id, message});
    }
    geocoder.getLocation(query, (status, result) => {
      if (activeSearch !== request) return;
      const match = result && result.geocodes && result.geocodes[0];
      if (status !== 'complete' || !match || !match.location) {
        fail('没有找到这个地址，请输入城市和更具体的地址。');
        return;
      }
      cancelSearch();
      centerOn(match.location, match.formattedAddress);
      send({type:'search-done', id});
    });
  };
  window.cancelBuildingLocate = () => { locateId = undefined; };
  window.locateBuildingMap = (lng,lat,id) => {
    locateId = id;
    AMap.convertFrom([lng,lat], 'gps', (status, result) => {
      if (locateId !== id) return;
      locateId = undefined;
      const point = result && result.locations && result.locations[0];
      if (status === 'complete' && point) {
        centerOn(point);
        send({type:'locate-done', id});
      } else send({type:'locate-error', id});
    });
  };
})();
</script>
</html>`
}
