import { File, Paths } from 'expo-file-system'
import * as DocumentPicker from 'expo-document-picker'
import * as Sharing from 'expo-sharing'
import { decodeRouteFile, encodeRouteFile, MAX_ROUTE_FILE_BYTES } from '../core/route-file'
import { RouteTemplate } from '../core/types'

export async function shareRouteFile(route: RouteTemplate): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('这台设备暂时无法打开分享菜单。')
  const file = new File(Paths.cache, `循阶路线-${route.name.replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 40)}-${Date.now()}.json`)
  file.write(encodeRouteFile(route))
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: '分享路线', UTI: 'public.json' })
}

export async function pickRouteFile(): Promise<RouteTemplate | undefined> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'application/octet-stream', 'text/plain'], copyToCacheDirectory: true, multiple: false })
  if (result.canceled) return undefined
  const asset = result.assets[0]
  const file = new File(asset.uri)
  if ((asset.size ?? file.size) > MAX_ROUTE_FILE_BYTES) throw new Error('这个文件太大，请选择循阶路线文件。')
  return decodeRouteFile(await file.text())
}
