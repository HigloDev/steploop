const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { analyzeWorkoutEvidence } = require('./analyze-workout-evidence.cjs')

test('computer analysis preserves user correction, raw timestamps and voice failures without changing its source', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'palou-analysis-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'training.jsonl')
  const records = [
    { kind: 'workout', schemaVersion: 1, evidenceAvailable: true, sampling: { retainedHz: 10, interpolated: false }, workout: {
      id: 'w', startedAt: 1000, endedAt: 5000, rounds: [{ roundNumber: 1, floorCounting: 'transitions', startFloor: 1,
        finalFloor: 15, steps: 100, durationMs: 2000, confidence: 0.4, corrections: [{ before: { finalFloor: 12 }, after: { finalFloor: 15 } }] }],
    } },
    { kind: 'evidence_chunk', context: { workoutId: 'w', roundNumber: 1, phase: 'ascending' }, records: [
      { kind: 'sensor', sample: { t: 1000, pressure: 1008, ax: 0.1 } },
      { kind: 'sensor', sample: { t: 1100, pressure: 1007, ax: 0.2 } },
      { kind: 'recognition', at: 1100, snapshot: { currentFloor: 12 } },
      { kind: 'gap', startAt: 1200, endAt: 2000, reason: 'disconnected' },
      { kind: 'retention_loss', at: 2000, omittedRecords: 3, reason: 'storage_full' },
    ] },
    { kind: 'voice_journal', entries: [{ outcome: 'failed', detail: 'tts_unavailable' }] },
  ].map(item => JSON.stringify(item)).join('\n') + '\n'
  fs.writeFileSync(source, records)
  const result = await analyzeWorkoutEvidence(source)
  assert.equal(fs.readFileSync(source, 'utf8'), records)
  assert.equal(result.analysis.totals.floors, 14)
  assert.equal(result.analysis.rounds[0].detectedFloor, 12)
  assert.equal(result.analysis.rounds[0].confirmedFloor, 15)
  assert.equal(result.analysis.phases[0].samples, 2)
  assert.equal(result.analysis.gaps.length, 1)
  assert.equal(result.analysis.losses.length, 1)
  assert.equal(result.analysis.voice.outcomes.failed, 1)
  assert.match(fs.readFileSync(result.files.sensorPath, 'utf8'), /"1100","1","ascending","1007"/)
})

test('malformed export returns an explicit error while its original bytes remain intact', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'palou-analysis-invalid-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'invalid.jsonl')
  fs.writeFileSync(source, '{"partial":')
  await assert.rejects(analyzeWorkoutEvidence(source), /不是完整 JSON/)
  assert.equal(fs.readFileSync(source, 'utf8'), '{"partial":')
})
