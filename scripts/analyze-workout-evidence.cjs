// Read-only source analysis. Derived reports never modify the exported training evidence.
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')

function csv(values) {
  return values.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',') + '\n'
}

async function analyzeWorkoutEvidence(inputPath, outputDirectory) {
  const input = path.resolve(inputPath)
  const output = path.resolve(outputDirectory ?? path.join(path.dirname(input), path.parse(input).name + '-analysis'))
  const sensorPath = path.join(output, 'sensor-timeline.csv')
  const summaryPath = path.join(output, 'analysis.json')
  const reportPath = path.join(output, 'analysis.md')
  if ([sensorPath, summaryPath, reportPath].includes(input)) throw new Error('分析输出不能覆盖原始文件。')
  const lines = readline.createInterface({ input: fs.createReadStream(input), crlfDelay: Infinity })
  let header
  let lineNumber = 0
  let sensorFd
  const phases = new Map()
  const events = []
  const gaps = []
  const losses = []
  let voice
  let voiceError
  try {
    for await (const line of lines) {
      lineNumber += 1
      if (!line.trim()) continue
      let item
      try { item = JSON.parse(line) } catch { throw new Error(`第 ${lineNumber} 行不是完整 JSON，原文件未修改。`) }
      if (!header) {
        if (item.kind !== 'workout' || item.schemaVersion !== 1 || !item.workout?.id || !Array.isArray(item.workout.rounds)) {
          throw new Error('缺少有效的循阶训练分析文件头。')
        }
        header = item
        fs.mkdirSync(output, { recursive: true })
        sensorFd = fs.openSync(sensorPath, 'w')
        fs.writeSync(sensorFd, '\uFEFF' + csv(['timestamp_ms', 'round', 'phase', 'pressure_hpa', 'ax_g', 'ay_g', 'az_g', 'gx_rad_s', 'gy_rad_s', 'gz_rad_s', 'step_counter']))
        continue
      }
      if (item.kind === 'voice_journal') { voice = item; continue }
      if (item.kind === 'voice_error') { voiceError = item.message; continue }
      if (item.kind !== 'evidence_chunk' || item.context?.workoutId !== header.workout.id || !Array.isArray(item.records)) {
        throw new Error(`第 ${lineNumber} 行的证据不属于本次训练或格式错误。`)
      }
      const key = `${item.context.roundNumber}:${item.context.phase}`
      const phase = phases.get(key) ?? {
        roundNumber: item.context.roundNumber, phase: item.context.phase, samples: 0,
        firstAt: undefined, lastAt: undefined, minPressure: undefined, maxPressure: undefined,
        recognitionEvents: 0, detectedFloor: undefined,
      }
      phases.set(key, phase)
      for (const record of item.records) {
        if (record.kind === 'sensor') {
          const sample = record.sample
          if (!Number.isFinite(sample?.t)) throw new Error(`第 ${lineNumber} 行存在无有效时间戳的样本。`)
          phase.samples += 1
          phase.firstAt = phase.firstAt === undefined ? sample.t : Math.min(phase.firstAt, sample.t)
          phase.lastAt = phase.lastAt === undefined ? sample.t : Math.max(phase.lastAt, sample.t)
          if (Number.isFinite(sample.pressure)) {
            phase.minPressure = phase.minPressure === undefined ? sample.pressure : Math.min(phase.minPressure, sample.pressure)
            phase.maxPressure = phase.maxPressure === undefined ? sample.pressure : Math.max(phase.maxPressure, sample.pressure)
          }
          fs.writeSync(sensorFd, csv([sample.t, phase.roundNumber, phase.phase, sample.pressure,
            sample.ax, sample.ay, sample.az, sample.gx, sample.gy, sample.gz, sample.steps]))
        } else if (record.kind === 'recognition') {
          phase.recognitionEvents += 1
          phase.detectedFloor = record.snapshot?.currentFloor
        } else if (record.kind === 'event') {
          events.push({ roundNumber: phase.roundNumber, phase: phase.phase, ...record })
        } else if (record.kind === 'gap') {
          gaps.push({ roundNumber: phase.roundNumber, phase: phase.phase, ...record })
        } else if (record.kind === 'retention_loss') {
          losses.push({ roundNumber: phase.roundNumber, phase: phase.phase, ...record })
        }
      }
    }
  } finally {
    lines.close()
    if (sensorFd !== undefined) fs.closeSync(sensorFd)
  }
  if (!header) throw new Error('分析文件为空。')
  const workout = header.workout
  const rounds = workout.rounds.map(round => {
    const firstCorrection = round.corrections?.[0]
    const actualClimb = round.floorCounting === 'transitions'
      ? Math.max(0, round.finalFloor - round.startFloor) : round.floorsCompleted
    return {
      roundNumber: round.roundNumber, startFloor: round.startFloor,
      detectedFloor: firstCorrection?.before?.finalFloor ?? phases.get(`${round.roundNumber}:ascending`)?.detectedFloor ?? round.finalFloor,
      confirmedFloor: round.finalFloor, floors: actualClimb, steps: round.steps,
      climbingMs: round.durationMs, confidence: round.confidence,
      corrections: round.corrections ?? [],
    }
  })
  const voiceEntries = Array.isArray(voice?.entries) ? voice.entries : []
  const voiceOutcomes = {}
  for (const entry of voiceEntries) voiceOutcomes[entry.outcome] = (voiceOutcomes[entry.outcome] ?? 0) + 1
  const analysis = {
    schemaVersion: 1, sourceFile: input, workoutId: workout.id, sampling: header.sampling,
    evidenceAvailable: header.evidenceAvailable, missingEvidenceReason: header.missingEvidenceReason,
    totals: { floors: rounds.reduce((sum, round) => sum + (round.floors ?? 0), 0),
      steps: rounds.reduce((sum, round) => sum + (round.steps ?? 0), 0),
      climbingMs: rounds.reduce((sum, round) => sum + (round.climbingMs ?? 0), 0),
      elapsedMs: workout.endedAt === undefined ? undefined : Math.max(0, workout.endedAt - workout.startedAt) },
    rounds, phases: [...phases.values()], events, gaps, losses,
    voice: { outcomes: voiceOutcomes, entries: voiceEntries, error: voiceError ?? voice?.writeError },
  }
  fs.writeFileSync(summaryPath, JSON.stringify(analysis, null, 2) + '\n', 'utf8')
  const report = [
    '# 循阶训练分析', '',
    `训练：${workout.id}；累计爬升 ${analysis.totals.floors} 层，${analysis.totals.steps} 步。`, '',
    `原始样本：${analysis.phases.reduce((sum, phase) => sum + phase.samples, 0)} 条；声明留存频率 ${header.sampling?.retainedHz ?? '未知'} Hz。`,
    `缺段 ${gaps.length} 项；留存丢失 ${losses.length} 项。${header.missingEvidenceReason ?? ''}`, '',
    '| 轮次 | 起点 | 自动识别 | 确认终点 | 爬升层数 | 净爬楼毫秒 | 修正次数 |',
    '|---|---|---|---|---|---|---|',
    ...rounds.map(round => `| ${round.roundNumber} | ${round.startFloor} | ${round.detectedFloor ?? '未知'} | ${round.confirmedFloor} | ${round.floors} | ${round.climbingMs} | ${round.corrections.length} |`), '',
    '传感器时间线见 sensor-timeline.csv；原始识别、人工修正、语音结果与缺段详见 analysis.json。',
    '本报告整理已记录的证据，不把气压估算或模拟样本当作真实楼层准确率验收。', '',
  ].join('\n')
  fs.writeFileSync(reportPath, report, 'utf8')
  return { analysis, files: { summaryPath, reportPath, sensorPath } }
}

module.exports = { analyzeWorkoutEvidence }
if (require.main === module) {
  const args = process.argv.slice(2)
  const input = args[0]
  const outputIndex = args.indexOf('--out')
  if (!input || outputIndex >= 0 && !args[outputIndex + 1]) {
    console.error('用法：node scripts/analyze-workout-evidence.cjs <训练分析.jsonl> [--out 输出目录]')
    process.exitCode = 1
  } else {
    analyzeWorkoutEvidence(input, outputIndex >= 0 ? args[outputIndex + 1] : undefined)
      .then(result => console.log(JSON.stringify({ workoutId: result.analysis.workoutId, totals: result.analysis.totals, ...result.files }, null, 2)))
      .catch(error => { console.error(error.message); process.exitCode = 1 })
  }
}
