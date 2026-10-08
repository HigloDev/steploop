import { Directory, File, Paths } from 'expo-file-system'
import { RouteTemplate, SensorSample } from '../core/types'
import { PreparationRun } from '../core/route-preparation'

const safe = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_')
const rootDirectory = () => new Directory(Paths.document, 'palou-route-recordings')
const pointerFile = (routeId: string) => new File(rootDirectory(), `active-${safe(routeId)}.json`)

export async function pendingPreparationRecording(route: RouteTemplate): Promise<{ interrupted: boolean; run?: PreparationRun }> {
  const file = pointerFile(route.id)
  if (!file.exists) return { interrupted: false }
  const pointer = JSON.parse(await file.text())
  if (pointer.saved || pointer.revision !== route.preparation?.referenceRevision ||
    pointer.deviceKey !== route.preparation?.deviceKey) return { interrupted: false }
  const result = new File(rootDirectory(), safe(pointer.id), 'result.json')
  if (!result.exists) return { interrupted: true }
  const run = JSON.parse(await result.text()) as PreparationRun
  if (run.id !== pointer.id) throw new Error('上次的记录没有读完整，原文件已保留。')
  return { interrupted: false, run }
}

export async function acknowledgePreparationRecording(routeId: string, id: string): Promise<void> {
  const file = pointerFile(routeId)
  if (!file.exists) return
  const pointer = JSON.parse(await file.text())
  if (pointer.id === id) file.write(JSON.stringify({ ...pointer, saved: true }))
}

/** Full-rate original measurements stay local; immutable chunks bound memory usage. */
export class PreparationRecording {
  private directory: Directory
  private buffer: unknown[] = []
  private sequence = 0
  constructor(id: string, route: RouteTemplate) {
    this.directory = new Directory(Paths.document, 'palou-route-recordings', id.replace(/[^a-zA-Z0-9_-]/g, '_'))
    this.directory.create({ intermediates: true, idempotent: false })
    new File(this.directory, 'reference.json').write(JSON.stringify({ version: 1, route, startedAt: Date.now() }))
    pointerFile(route.id).write(JSON.stringify({ id, revision: route.preparation?.referenceRevision, deviceKey: route.preparation?.deviceKey, saved: false }))
  }
  sample(sample: SensorSample): void {
    if (this.buffer.length >= 500) throw new Error('记录没有存下，请结束这一段后重试。')
    this.buffer.push({ sample }); if (this.buffer.length >= 250) this.flush()
  }
  event(event: unknown): void { this.buffer.push({ event }); this.flush() }
  flush(): void {
    if (!this.buffer.length) return
    const file = new File(this.directory, `${String(this.sequence).padStart(6, '0')}.json`)
    if (file.exists) throw new Error('已有记录受到保护，请重新打开路线后继续。')
    file.write(JSON.stringify(this.buffer))
    this.sequence++
    this.buffer = []
  }
  finish(run: PreparationRun): void {
    this.flush()
    new File(this.directory, 'result.json').write(JSON.stringify(run))
  }
}
