import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import {
  DiagnosticBundle,
  parseDiagnosticBundle,
  sanitizeDiagnosticBundleForExport,
} from '../core/diagnostics'

export interface DiagnosticExportResult {
  filePath: string
  shared: boolean
  message: string
}

function fileName(bundle: DiagnosticBundle): string {
  const cohort = bundle.capture.deviceCohortId.replace(/[^a-zA-Z0-9_-]/g, '-')
  const duration = Math.max(0, Math.round(bundle.durationMs))
  return `palou-diagnostic-${cohort}-${bundle.activity}-${duration}ms.json`
}

export function serializeDiagnosticBundle(bundle: DiagnosticBundle): string {
  const normalized = parseDiagnosticBundle(bundle)
  return JSON.stringify(sanitizeDiagnosticBundleForExport(normalized))
}

/** 诊断包只在用户点击导出后写入本机文件，并交给系统分享面板。落盘前无条件脱敏。 */
export async function exportDiagnosticBundle(
  bundle: DiagnosticBundle,
): Promise<DiagnosticExportResult> {
  const safe = sanitizeDiagnosticBundleForExport(bundle)
  const file = new File(Paths.document, fileName(safe))
  file.write(serializeDiagnosticBundle(safe))

  if (!(await Sharing.isAvailableAsync())) {
    return {
      filePath: file.uri,
      shared: false,
      message: '系统分享不可用，诊断文件已保存在应用文档目录。',
    }
  }

  try {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: '导出循阶传感器诊断包',
      UTI: 'public.json',
    })
    return {
      filePath: file.uri,
      shared: true,
      message: '诊断文件已交给系统分享。',
    }
  } catch (error) {
    const canceled =
      error instanceof Error && error.message.toLowerCase().includes('cancel')
    return {
      filePath: file.uri,
      shared: false,
      message: canceled
        ? '已取消分享，诊断文件仍保存在应用文档目录。'
        : `分享失败，诊断文件已保存在应用文档目录：${
            error instanceof Error ? error.message : String(error)
          }`,
    }
  }
}
