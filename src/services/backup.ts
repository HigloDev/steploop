// 数据备份/恢复：将路线与会话原始数据序列化为 JSON 文件并分享/导入。
//
// 导出：写入 Paths.document 临时文件，调用 Sharing.shareAsync
//      弹出系统分享菜单（用户可选择保存到云盘/发送到其他应用/邮件等）。
// 导入：DocumentPicker.getDocumentAsync 选择 JSON 文件，读取后调用 storage.importRawData。

import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import * as DocumentPicker from 'expo-document-picker'
import { saveLocalFileToDownloads } from './local-download-export'
import {
  BackupPayload,
  exportRawData,
  importRawData,
  previewImportFromBackup,
  type ImportPreview,
  ImportMode,
  restorePreImportSnapshot,
} from './storage'

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
export async function exportBackup(options: { destination?: 'share' | 'downloads' } = {}): Promise<ExportResult> {
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

  if (options.destination === 'downloads') {
    const saved = await saveLocalFileToDownloads(filePath, `palou-backup-${Date.now()}.json`, 'application/json')
    return { mode: 'file', filePath: saved.uri, message: `备份已保存到 ${saved.directory}/${saved.displayName}。请妥善保管其中的路线与训练数据。` }
  }

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
        message: '备份文件已生成，可分享给其他应用',
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
  mode: ImportMode
  snapshotCreated: boolean
  /** F16：导入时按容量上限裁掉的条数（已归档为统计，UI 应如实告知）。 */
  sessionsTruncated?: number
  workoutsTruncated?: number
  /** F16：备份携带的归档统计未被认领时的原因（为空表示正常或未携带）。 */
  archiveAggregateNote?: string
}

/**
 * 选择并解析备份文件（不写入任何数据）。
 * 取消时抛 `CANCEL`，与旧 importBackup 的行为保持一致。
 */
export async function pickBackupPayload(): Promise<BackupPayload> {
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

  try {
    return JSON.parse(content) as BackupPayload
  } catch {
    throw new Error('备份文件解析失败')
  }
}

/**
 * F16：导入**预览**。UI 必须在用户确认之前调用它：
 * 只读本机现状，算出会保留多少条、会裁掉多少条、归档统计是否会被认领。
 */
export async function previewBackupImport(
  payload: BackupPayload,
  options?: { mode?: ImportMode },
): Promise<ImportPreview> {
  return previewImportFromBackup(payload, options)
}

/** 导入已经解析好的备份（不再弹文件选择器）。 */
export async function importBackupPayload(
  payload: BackupPayload,
  options?: { mode?: ImportMode },
): Promise<ImportResult> {
  const result = await importRawData(payload, options)
  return {
    routesCount: result.routesCount,
    sessionsCount: result.sessionsCount,
    workoutsCount: result.workoutsCount,
    exportedAt: payload.exportedAt || 0,
    mode: result.mode,
    snapshotCreated: result.snapshotCreated,
    sessionsTruncated: result.sessionsTruncated,
    workoutsTruncated: result.workoutsTruncated,
    archiveAggregateNote: result.archiveAggregateNote,
  }
}

/** 从系统文件选择器选择 JSON 备份并导入；默认 merge，覆盖导入需调用方二次确认。 */
export async function importBackup(options?: {
  mode?: ImportMode
}): Promise<ImportResult> {
  const payload = await pickBackupPayload()
  return importBackupPayload(payload, options)
}

export { restorePreImportSnapshot }

/** 仅做格式校验，不写入。用于导入预览。 */
export function peekBackupPayload(json: string): BackupPayload | null {
  try {
    const parsed = JSON.parse(json) as BackupPayload
    if (parsed.version !== 1 && parsed.version !== 2) return null
    if (!Array.isArray(parsed.routes) || !Array.isArray(parsed.sessions)) return null
    return parsed
  } catch {
    return null
  }
}
