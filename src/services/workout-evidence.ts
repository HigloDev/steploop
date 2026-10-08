import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { ClimbWorkout } from '../core/types'
import { loadVoiceJournal } from './voice-journal'
import { saveLocalFileToDownloads } from './local-download-export'
import {
  WorkoutEvidenceBackend,
  WorkoutEvidenceChunk,
  WorkoutEvidenceContext,
  WorkoutEvidenceJournal,
} from './workout-evidence-store'

export { RetainedSampleWindow, WorkoutEvidenceJournal } from './workout-evidence-store'
export type { WorkoutEvidenceContext } from './workout-evidence-store'

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function evidenceDirectory(workoutId: string): Directory {
  return new Directory(Paths.document, 'palou-workout-evidence', safeId(workoutId))
}

export function createWorkoutEvidenceJournal(
  context: WorkoutEvidenceContext,
  onError?: (message: string) => void,
): WorkoutEvidenceJournal {
  const directory = evidenceDirectory(context.workoutId)
  const backend: WorkoutEvidenceBackend = {
    write: (name, content) => {
      if (!directory.exists) directory.create({ intermediates: true, idempotent: true })
      const file = new File(directory, name.replace(/[^a-zA-Z0-9_.-]/g, '_'))
      // Each immutable numbered chunk is created once. Do not overwrite earlier evidence.
      if (file.exists) throw new Error('证据分片已存在，已保留原文件')
      const pending = new File(directory, file.name + '.pending')
      pending.write(content)
      pending.moveSync(file)
    },
  }
  return new WorkoutEvidenceJournal(context, backend, onError)
}

export function recordWorkoutEvidenceEvent(
  context: WorkoutEvidenceContext,
  name: string,
  at: number,
  detail?: unknown,
  onError?: (message: string) => void,
): void {
  const journal = createWorkoutEvidenceJournal(context, onError)
  journal.event(name, at, detail)
  journal.close(at)
}

function evidenceFiles(workoutId: string): File[] {
  const directory = evidenceDirectory(workoutId)
  if (!directory.exists) return []
  return directory.list().filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function loadWorkoutEvidence(workoutId: string): Promise<WorkoutEvidenceChunk[]> {
  const result: WorkoutEvidenceChunk[] = []
  for (const file of evidenceFiles(workoutId)) {
    const chunk = JSON.parse(await file.text()) as WorkoutEvidenceChunk
    if (chunk.schemaVersion !== 1 || chunk.context?.workoutId !== workoutId || !Array.isArray(chunk.records)) {
      throw new Error(`原始数据分片格式无效：${file.name}`)
    }
    result.push(chunk)
  }
  return result
}

export interface WorkoutEvidenceExportResult {
  filePath: string
  shared: boolean
  message: string
}

/** JSONL preserves original records/corrections; writes one chunk at a time for long workouts. */
export async function exportWorkoutEvidence(workout: ClimbWorkout, options: { destination?: 'share' | 'downloads' } = {}): Promise<WorkoutEvidenceExportResult> {
  const files = evidenceFiles(workout.id)
  const file = new File(Paths.document, `palou-workout-evidence-${safeId(workout.id)}.jsonl`)
  file.write(JSON.stringify({
    kind: 'workout', schemaVersion: 1, exportedAt: Date.now(),
    timebase: 'unix_epoch_milliseconds',
    sampling: { source: 'measured_sensor_values', retainedHz: 10, interpolated: false },
    workout, evidenceAvailable: files.length > 0,
    missingEvidenceReason: files.length ? undefined : '这条历史训练没有留存原始传感器数据',
  }) + '\n')
  for (const source of files) {
    const content = await source.text()
    const chunk = JSON.parse(content) as WorkoutEvidenceChunk
    if (chunk.schemaVersion !== 1 || chunk.context?.workoutId !== workout.id || !Array.isArray(chunk.records)) {
      throw new Error(`原始数据分片格式无效：${source.name}`)
    }
    file.write(JSON.stringify({ kind: 'evidence_chunk', ...chunk }) + '\n', { append: true })
  }
  try {
    file.write(JSON.stringify({ kind: 'voice_journal', ...(await loadVoiceJournal(workout.id)) }) + '\n', { append: true })
  } catch (error) {
    file.write(JSON.stringify({ kind: 'voice_error', message: error instanceof Error ? error.message : String(error) }) + '\n', { append: true })
  }
  if (options.destination === 'downloads') {
    const saved = await saveLocalFileToDownloads(file.uri, `palou-workout-evidence-${safeId(workout.id)}-${Date.now()}.jsonl`, 'application/x-ndjson')
    return { filePath: saved.uri, shared: false, message: `训练分析文件已保存到 ${saved.directory}/${saved.displayName}，可连接电脑读取。文件含原始运动数据，请妥善保管。` }
  }
  if (!(await Sharing.isAvailableAsync())) {
    return { filePath: file.uri, shared: false, message: '系统分享不可用，完整训练分析文件已保存在应用文档目录。' }
  }
  try {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/x-ndjson', dialogTitle: '导出训练原始数据与修正记录' })
    return { filePath: file.uri, shared: true, message: '训练分析文件已交给系统分享，可在电脑按时间线分析。' }
  } catch (error) {
    return { filePath: file.uri, shared: false,
      message: `分享未完成，分析文件仍保存在应用文档目录：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Called only when the user explicitly deletes the corresponding workout. */
export function removeWorkoutEvidence(workoutId: string): void {
  const directory = evidenceDirectory(workoutId)
  if (directory.exists) directory.delete()
}
