import { NativeModules, Platform } from 'react-native'

export interface LocalDownloadExportResult {
  uri: string
  displayName: string
  directory: string
}

interface AndroidLocalExportModule {
  saveToDownloads(sourceUri: string, filename: string, mimeType: string): Promise<LocalDownloadExportResult>
}

function nativeExport(): AndroidLocalExportModule | undefined {
  return Platform.OS === 'android' && Number(Platform.Version) >= 29
    ? NativeModules?.AndroidLocalExport as AndroidLocalExportModule | undefined
    : undefined
}

export function isLocalDownloadExportAvailable(): boolean {
  return typeof nativeExport()?.saveToDownloads === 'function'
}

/** Call only from a user-selected save action; system sharing remains a separate destination. */
export async function saveLocalFileToDownloads(
  sourceUri: string,
  fileName: string,
  mimeType: string,
): Promise<LocalDownloadExportResult> {
  const module = nativeExport()
  if (!module?.saveToDownloads) throw new Error('此版本不支持直接保存到下载，请使用系统分享。')
  if (!/^file:\/\//.test(sourceUri)) throw new Error('只能保存应用自己生成的本地文件。')
  if (!fileName.trim() || fileName.length > 120 || fileName === '.' || fileName === '..' ||
      /[\u0000-\u001f/\\<>:"|?*]/.test(fileName) || /[. ]$/.test(fileName)) throw new Error('导出文件名无效。')
  if (!/^[a-z0-9][a-z0-9!#$&^_.+\-]*\/[a-z0-9][a-z0-9!#$&^_.+\-]*$/i.test(mimeType)) throw new Error('导出文件类型无效。')
  const result = await module.saveToDownloads(sourceUri, fileName, mimeType.toLowerCase())
  if (!result || typeof result.uri !== 'string' || !result.uri.startsWith('content://') ||
      typeof result.displayName !== 'string' || !result.displayName || result.directory !== 'Download/循阶') {
    throw new Error('下载保存结果无法确认；请检查系统下载目录后重试。')
  }
  return { uri: result.uri, displayName: result.displayName, directory: result.directory }
}
