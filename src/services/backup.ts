// 数据备份/恢复：将路线与会话原始数据序列化为 JSON 文件并分享/导入。
//
// 导出：写入 Paths.document 临时文件，调用 Sharing.shareAsync
//      弹出系统分享菜单（用户可选择保存到云盘/发送到其他应用/邮件等）。
// 导入：DocumentPicker.getDocumentAsync 选择 JSON 文件，读取后调用 storage.importRawData。

import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import * as DocumentPicker from 'expo-document-picker'
import { BackupPayload, exportRawData, importRawData } from './storage'

const FILE_NAME = 'palou-backup.json'

function buildPayloadJson(payload: BackupPayload): string {
  return JSON.stringify(payload, null, 2)
}

export interface ExportResult {
  mode: 'file' | 'share' | 'clipboard'
  filePath?: string
  message: string
}

/** 导出备份，优先分享，分享不可用时退回写入文档目录返回路径。 */
export async function exportBackup(): Promise<ExportResult> {
  const payload = await exportRawData()
  const json = buildPayloadJson(payload)
  const file = new File(Paths.document, FILE_NAME)

  try {
    file.write(json)
  } catch (err) {
    return {
      mode: 'clipboard',
      message: `写入备份文件失败：${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const filePath = file.uri

  if (await Sharing.isAvailableAsync()) {
    try {
      await Sharing.shareAsync(filePath, {
        mimeType: 'application/json',
        dialogTitle: '爬楼备份 - 保存或发送',
        UTI: 'public.json',
      })
      return {
        mode: 'share',
        filePath,
        message: '已通过系统分享导出，请选择保存位置',
      }
    } catch (err) {
      // 分享被取消时仍返回文件路径，便于用户手动操作
      if (err instanceof Error && err.message.toLowerCase().includes('cancel')) {
        return {
          mode: 'file',
          filePath,
          message: '已生成备份文件，可稍后从应用文档目录取出',
        }
      }
      return {
        mode: 'file',
        filePath,
        message: `分享失败，文件已保存到 ${filePath}`,
      }
    }
  }

  return {
    mode: 'file',
    filePath,
    message: `分享不可用，文件已保存到 ${filePath}`,
  }
}

export interface ImportResult {
  routesCount: number
  sessionsCount: number
  workoutsCount: number
  exportedAt: number
}

/** 从系统文件选择器选择 JSON 备份并导入，导入前由调用方做用户确认。 */
export async function importBackup(): Promise<ImportResult> {
  const picker = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
    multiple: false,
  })

  if (picker.canceled) {
    throw new Error('CANCEL')
  }

  const asset = picker.assets?.[0]
  if (!asset || !asset.uri) {
    throw new Error('未选择有效文件')
  }

  let content: string
  try {
    content = await new File(asset.uri).text()
  } catch (err) {
    throw new Error(
      `文件读取失败：${err instanceof Error ? err.message : String(err)}`,
    )
  }

  let payload: BackupPayload
  try {
    payload = JSON.parse(content) as BackupPayload
  } catch (err) {
    throw new Error('备份文件解析失败')
  }

  const result = await importRawData(payload)
  return {
    routesCount: result.routesCount,
    sessionsCount: result.sessionsCount,
    workoutsCount: result.workoutsCount,
    exportedAt: payload.exportedAt || 0,
  }
}

/** 仅做格式校验，不写入。用于导入预览。 */
export function peekBackupPayload(json: string): BackupPayload | null {
  try {
    const parsed = JSON.parse(json) as BackupPayload
    if (parsed.version !== 1) return null
    if (!Array.isArray(parsed.routes) || !Array.isArray(parsed.sessions)) return null
    return parsed
  } catch {
    return null
  }
}
