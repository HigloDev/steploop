// 生成本机 CSV 备份（训练 + 旧单轮会话）。
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { buildWorkoutCsv } from '../core/export-csv'
import { listSessions } from './storage'
import { listWorkouts } from './workout-storage'

export interface CsvExportResult {
  filePath: string
  shared: boolean
  message: string
}

export async function exportWorkoutCsv(): Promise<CsvExportResult> {
  const [workouts, sessions] = await Promise.all([
    listWorkouts(),
    listSessions(),
  ])
  const csv = buildWorkoutCsv({ workouts, sessions })
  const file = new File(Paths.document, 'palou-workouts.csv')
  file.write(csv)

  if (!(await Sharing.isAvailableAsync())) {
    return {
      filePath: file.uri,
      shared: false,
      message: `CSV 已保存到 ${file.uri}`,
    }
  }

  try {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/csv',
      dialogTitle: '导出训练记录 CSV',
      UTI: 'public.comma-separated-values-text',
    })
    return {
      filePath: file.uri,
      shared: true,
      message: '已通过系统分享导出 CSV',
    }
  } catch (error) {
    const canceled =
      error instanceof Error && error.message.toLowerCase().includes('cancel')
    return {
      filePath: file.uri,
      shared: false,
      message: canceled
        ? '已取消分享，CSV 仍保存在应用文档目录。'
        : `分享失败，CSV 已保存：${
            error instanceof Error ? error.message : String(error)
          }`,
    }
  }
}
