// Read-only replay of exported measured samples. Never fills missing samples or overwrites a workout.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ts = require('typescript')
const { RouteRecognizer } = require('../node_modules/.cache/steploop-core/recognizer.js')
const { FreeRecognizer } = require('../node_modules/.cache/steploop-core/free-recognizer.js')
const analysis = require('../node_modules/.cache/steploop-core/analysis.js')

// Old exports retain only sparse sensor samples. Reprocess those using the current
// phone pipeline; new exports replay the exact inputs without rebuilding frames.
const pumpModule = { exports: {} }
const pumpSource = fs.readFileSync(path.join(__dirname, '../src/services/live-feature-pump.ts'), 'utf8')
const pumpCode = ts.transpileModule(pumpSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
new Function('require', 'module', 'exports', pumpCode)(dependency => {
  if (dependency === '../core/analysis') return analysis
  if (dependency === '../core/motion-signal') return require('../node_modules/.cache/steploop-core/motion-signal.js')
  throw Error(`Unsupported replay dependency: ${dependency}`)
}, pumpModule, pumpModule.exports)
const { LiveFeaturePump } = pumpModule.exports

function replayExactInputs(records) {
  const references = records.filter(row => row.kind === 'event' && row.name === 'recognition_reference')
  if (!references.length) return undefined
  if (references.length !== 1 || references[0].detail?.format !== 1) throw Error('识别参考缺失或重复，不能声称完整重算。')
  const reference = references[0].detail
  const inputs = records.filter(row => row.kind === 'event' && row.name === 'recognition_input').map(row => row.detail)
  const checkpoint = records.filter(row => row.kind === 'event' && row.name === 'recognition_checkpoint').at(-1)?.detail
  const complete = !records.some(row => row.kind === 'retention_loss') && checkpoint?.inputCount === inputs.length &&
    records.some(row => row.kind === 'event' && row.name === 'phase_end') &&
    inputs.every((input, index) => input.sequence === index + 1)
  if (!complete) throw Error('识别过程有缺失，不能声称完整重算。')
  const rec = reference.mode === 'free' ? new FreeRecognizer(reference.template, reference.startedAt)
    : new RouteRecognizer(reference.template, reference.startedAt)
  const unassisted = reference.mode === 'free' ? new FreeRecognizer(reference.template, reference.startedAt)
    : new RouteRecognizer(reference.template, reference.startedAt)
  const anchorChecks = []
  let frames = 0, manualAnchors = 0
  for (const input of inputs) {
    switch (input.type) {
      case 'frame': rec.pushFrame(input.frame); unassisted.pushFrame(input.frame); frames++; break
      case 'pressure': rec.pushBarometer(input.pressure, input.atMs); unassisted.pushBarometer(input.pressure, input.atMs); break
      case 'pause': rec.pause(input.atMs); unassisted.pause(input.atMs); break
      case 'resume': rec.resume(input.atMs); unassisted.resume(input.atMs); break
      case 'confirm_floor':
        anchorChecks.push({ atMs: input.atMs, actualFloor: input.floor,
          estimatedBeforeAnchor: rec.snapshot().currentFloor, unassistedEstimatedFloor: unassisted.snapshot().currentFloor })
        rec.confirmFloor(input.floor, input.atMs); manualAnchors++; break
      default: throw Error('遇到不能识别的过程记录，已停止重算。')
    }
  }
  return { state: rec.snapshot(), unassistedState: unassisted.snapshot(), anchorChecks, frames, manualAnchors, reference,
    matchesSavedSnapshot: JSON.stringify(rec.snapshot()) === JSON.stringify(checkpoint.snapshot) }
}

function replayMotionEvidence(evidence, template) {
  const header = evidence.find(row => row.kind === 'workout')
  if (!header?.workout || header.workout.templateId !== template.id) throw Error('原始记录与路线不对应。')
  const chunks = evidence.filter(row => row.kind === 'evidence_chunk' && row.context?.phase === 'ascending')
  const results = []
  for (const round of header.workout.rounds) {
    const roundChunks = chunks.filter(chunk => chunk.context.roundNumber === round.roundNumber)
    const referenceChunks = roundChunks.filter(chunk => chunk.records.some(row => row.kind === 'event' && row.name === 'recognition_reference'))
    if (referenceChunks.length) {
      if (referenceChunks.length !== 1) throw Error('同一轮有多份识别参考，需先核对记录。')
      const records = roundChunks.filter(chunk => chunk.evidenceId === referenceChunks[0].evidenceId)
        .sort((a, b) => a.sequence - b.sequence).flatMap(chunk => chunk.records)
      const exact = replayExactInputs(records)
      results.push({ roundNumber: round.roundNumber, processing: 'exact_recorded_recognition_inputs',
        savedFinalFloor: round.finalFloor, newEstimatedFloor: exact.state.currentFloor,
        newEstimatedFloors: exact.state.floorsCompleted, replayedSteps: exact.state.steps,
        replayedFrames: exact.frames, manualAnchors: exact.manualAnchors,
        unassistedEstimatedFloor: exact.unassistedState.currentFloor, anchorChecks: exact.anchorChecks,
        independentOfManualAnchors: exact.manualAnchors === 0, matchesSavedSnapshot: exact.matchesSavedSnapshot,
        needsHumanConfirmation: !exact.state.canAutoComplete,
        sourceProcessingVersion: exact.reference.processingVersion, usesFrozenReference: true })
      continue
    }
    const records = roundChunks.flatMap(chunk => chunk.records)
    if (records.some(row => row.kind === 'event' && ['recognition_input', 'recognition_checkpoint'].includes(row.name))) {
      throw Error('缺少本轮识别参考，不能当作完整记录重算。')
    }
    const samples = records.filter(row => row.kind === 'sensor').map(row => row.sample).sort((a, b) => a.t - b.t)
    const gaps = records.filter(row => row.kind === 'gap' || row.kind === 'retention_loss')
    const originalFloor = round.corrections?.[0]?.before?.finalFloor ?? round.finalFloor
    if (!samples.length) { results.push({ roundNumber: round.roundNumber, sampleCount: 0, originalFloor, unavailable: '没有原始记录，不能重新计算。' }); continue }
    const origin = samples[0].t
    const rec = new RouteRecognizer(template, origin)
    let gapCursor = 0, pump, frameCount = 0
    const orderedGaps = gaps.filter(gap => gap.kind === 'gap').sort((a, b) => a.startAt - b.startAt)
    for (const sample of samples) {
      while (gapCursor < orderedGaps.length && orderedGaps[gapCursor].endAt <= sample.t) {
        const gap = orderedGaps[gapCursor++]
        rec.pause(Math.max(0, gap.startAt - origin)); rec.resume(Math.max(0, gap.endAt - origin))
        pump = undefined
      }
      if (gapCursor < orderedGaps.length && sample.t >= orderedGaps[gapCursor].startAt) {
        rec.pause(Math.max(0, orderedGaps[gapCursor].startAt - origin))
        pump = undefined
        continue
      }
      if (!pump) {
        const offset = sample.t - origin
        pump = new LiveFeaturePump(frame => {
          frameCount++
          rec.pushFrame({ ...frame, startMs: frame.startMs + offset, endMs: frame.endMs + offset })
        })
      }
      if (sample.pressure !== undefined) rec.pushBarometer(sample.pressure, sample.t - origin)
      pump.push(sample)
    }
    const state = rec.snapshot()
    results.push({ roundNumber: round.roundNumber, sampleCount: samples.length, gaps: gaps.length,
      processing: 'retained_samples_current_live_pipeline',
      originalFloor, savedFinalFloor: round.finalFloor, savedCorrections: round.corrections?.length ?? 0,
      newEstimatedFloor: state.currentFloor, newEstimatedFloors: state.floorsCompleted,
      savedLiveSteps: round.steps, replayedSteps: state.steps, replayedFrames: frameCount,
      needsHumanConfirmation: !state.canAutoComplete || gaps.length > 0,
      referenceVersionChanged: header.workout.templateVersion !== template.version })
  }
  return { algorithmVersion: 'motion-v3', processingVersion: 'continuous-motion-1', sampling: header.sampling, workoutId: header.workout.id, results,
    notice: '这是用已经留存的记录重新计算。留存频率、缺段和路线改动都可能影响结果，不能代替拿着手机实际爬楼核对。' }
}
module.exports = { replayMotionEvidence, replayExactInputs }
if (require.main === module) {
  const [input, templateFile, output] = process.argv.slice(2)
  if (!input || !templateFile || !output) { console.error('用法：node scripts/replay-motion-evidence.cjs 原始记录.jsonl 路线.json 新报告.json'); process.exit(2) }
  if ([input, templateFile].some(file => path.resolve(file) === path.resolve(output))) throw Error('报告不能覆盖原始文件。')
  const data = fs.readFileSync(input)
  const rows = data.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map(JSON.parse)
  const report = replayMotionEvidence(rows, JSON.parse(fs.readFileSync(templateFile, 'utf8')))
  report.sourceSha256 = crypto.createHash('sha256').update(data).digest('hex')
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(report, null, 2))
}
