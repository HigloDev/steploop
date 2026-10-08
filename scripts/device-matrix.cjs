// D13 真机发布矩阵工具：把「需要设备」这件事变成可执行、可核对的证据文件。
//
// 与 D12 的 dataset-kit 同一个思路：外部输入（设备）仍然缺，但**拿到设备后不需要任何手工整理**，
// 而且矩阵不达标时工具会明确说缺什么，避免「装了几台就以为够了」。
//
// 用法：
//   node scripts/device-matrix.cjs plan --out matrix.csv          # 生成矩阵骨架与要求
//   node scripts/device-matrix.cjs collect --out matrix.csv       # 用 adb 采集（需 adb 在 PATH）
//   node scripts/device-matrix.cjs validate matrix.csv            # 覆盖率核对（缺什么逐条列出）
//   node scripts/device-matrix.cjs report matrix.csv --apk app.apk --out release-matrix.md
//
// 退出码：0 = 达标/成功；1 = 未达标（逐条列出缺口）；2 = 用法/adb/IO 错误。
//
// 诚实边界：
// - 本工具**不能**证明真机通过：`smokeResult` 必须由人在真机上跑完 D13 清单后填写。
// - 气压计有无无法用 getprop 判断：必须由应用内诊断采集的 `barometerAvailable` 或人工确认填写。
// - 没有 adb 或没有设备时，collect 退出码 2，并提示用 plan 先准备矩阵，绝不伪造行。

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

// D13 门槛：与 docs/dsh-handoff/07_QA_AND_RELEASE.md「真机验收」和 BOUNDARIES §1 对齐。
const REQUIREMENTS = Object.freeze({
  minimumDevices: 5,
  minimumBrands: 3,
  minimumAndroidReleases: 2,
  requireNoBarometerDevice: true,
  requireSmokeResult: true,
})

const COLUMNS = [
  'serial',
  'brand',
  'model',
  'androidRelease',
  'sdk',
  'barometer',
  'carryModesTested',
  'smokeResult',
  'notes',
]

function usage() {
  console.error(
    [
      '用法：',
      '  node scripts/device-matrix.cjs plan --out matrix.csv',
      '  node scripts/device-matrix.cjs collect --out matrix.csv [--barometer yes|no]',
      '  node scripts/device-matrix.cjs validate matrix.csv',
      '  node scripts/device-matrix.cjs report matrix.csv --apk <apk路径> --out release-matrix.md',
    ].join('\n'),
  )
}

function parseArgs(argv) {
  const flags = {}
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        flags[key] = true
      } else {
        flags[key] = value
        index += 1
      }
    } else {
      positional.push(token)
    }
  }
  return { flags, positional }
}

// === 纯解析函数（可离线测试）===

/** 解析 `adb devices -l` 输出：只取 state=device 的机器，忽略表头与离线设备。 */
function parseAdbDevices(text) {
  const devices = []
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^List of devices attached/i.test(line)) continue
    const cells = line.split(/\s+/)
    if (cells.length < 2) continue
    const serial = cells[0]
    const state = cells[1]
    if (!serial || serial.startsWith('*')) continue
    const fields = {}
    for (const cell of cells.slice(2)) {
      const match = /^([a-z_]+):(.+)$/i.exec(cell)
      if (match) fields[match[1]] = match[2]
    }
    devices.push({
      serial,
      state,
      model: fields.model ?? '',
      device: fields.device ?? '',
      product: fields.product ?? '',
    })
  }
  return devices
}

/** 解析 `adb shell getprop` 输出（形如 `[ro.product.brand]: [xiaomi]`）。 */
function parseGetprop(text) {
  const props = {}
  for (const rawLine of String(text).split(/\r?\n/)) {
    const match = /^\[([^\]]+)\]:\s*\[(.*)\]$/.exec(rawLine.trim())
    if (match) props[match[1]] = match[2]
  }
  return {
    brand: props['ro.product.brand'] ?? props['ro.product.manufacturer'] ?? '',
    model: props['ro.product.model'] ?? '',
    androidRelease: props['ro.build.version.release'] ?? '',
    sdk: props['ro.build.version.sdk'] ?? '',
  }
}

/** CSV 读取：表头驱动，容忍缺列（缺列当空串）。 */
function readMatrix(file) {
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  if (!lines.length) return { rows: [], error: '矩阵文件是空的' }
  const header = lines[0].split(',').map((cell) => cell.trim())
  for (const required of ['serial', 'brand', 'model', 'androidRelease', 'barometer']) {
    if (!header.includes(required)) {
      return { rows: [], error: `表头缺少 ${required}` }
    }
  }
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(',')
    const row = {}
    header.forEach((key, index) => {
      row[key] = (cells[index] ?? '').trim()
    })
    return row
  })
  return { rows, error: null }
}

function writeMatrix(file, rows) {
  const lines = [COLUMNS.join(',')]
  for (const row of rows) {
    lines.push(COLUMNS.map((key) => row[key] ?? '').join(','))
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
}

/** 覆盖率判定：返回缺口清单（空数组 = 达标）。 */
function evaluateMatrix(rows) {
  const gaps = []
  const filled = rows.filter((row) => row.serial && row.brand)
  const brands = new Set(filled.map((row) => row.brand.toLowerCase()).filter(Boolean))
  const releases = new Set(filled.map((row) => row.androidRelease).filter(Boolean))

  if (filled.length < REQUIREMENTS.minimumDevices) {
    gaps.push(`设备数：${filled.length} < 门槛 ${REQUIREMENTS.minimumDevices}`)
  }
  if (brands.size < REQUIREMENTS.minimumBrands) {
    gaps.push(`品牌数：${brands.size} < 门槛 ${REQUIREMENTS.minimumBrands}`)
  }
  if (releases.size < REQUIREMENTS.minimumAndroidReleases) {
    gaps.push(
      `Android 版本数：${releases.size} < 门槛 ${REQUIREMENTS.minimumAndroidReleases}`,
    )
  }
  if (
    REQUIREMENTS.requireNoBarometerDevice &&
    !filled.some((row) => row.barometer === 'no')
  ) {
    gaps.push('缺少「无气压计」机型的真机证据（barometer 列必须有一行 no）')
  }
  if (REQUIREMENTS.requireSmokeResult) {
    const missingSmoke = filled.filter((row) => !row.smokeResult)
    if (missingSmoke.length) {
      gaps.push(
        `smoke 结果缺失：${missingSmoke.length} 台设备还没填 smokeResult（${missingSmoke
          .map((row) => row.serial)
          .slice(0, 3)
          .join('、')}…）`,
      )
    }
  }
  const carryMissing = filled.filter(
    (row) =>
      !row.carryModesTested ||
      !/pocket/.test(row.carryModesTested) ||
      !/waist/.test(row.carryModesTested),
  )
  if (carryMissing.length) {
    gaps.push(
      `携带方式未覆盖 pocket+waist：${carryMissing.length} 台设备待补（carryModesTested 列）`,
    )
  }
  const emptyBarometer = filled.filter(
    (row) => row.barometer !== 'yes' && row.barometer !== 'no',
  )
  if (emptyBarometer.length) {
    gaps.push(
      `barometer 列未填（必须 yes/no）：${emptyBarometer
        .map((row) => row.serial)
        .slice(0, 3)
        .join('、')}…`,
    )
  }
  return { gaps, filled, brands, releases }
}

// === 子命令 ===

function commandPlan(flags) {
  const out = flags.out
  if (!out || out === true) {
    console.error('plan 需要 --out <matrix.csv>')
    return 2
  }
  const rows = []
  for (let index = 0; index < REQUIREMENTS.minimumDevices; index += 1) {
    rows.push({
      serial: `device-0${index + 1}`,
      brand: '',
      model: '',
      androidRelease: '',
      sdk: '',
      barometer: index === REQUIREMENTS.minimumDevices - 1 ? 'no' : 'yes',
      carryModesTested: '',
      smokeResult: '',
      notes: '',
    })
  }
  writeMatrix(path.resolve(out), rows)
  console.log(`已生成真机矩阵骨架：${path.resolve(out)}`)
  console.log('门槛：')
  console.log(`- 设备 ≥ ${REQUIREMENTS.minimumDevices} 台，品牌 ≥ ${REQUIREMENTS.minimumBrands} 个`)
  console.log(`- Android 版本 ≥ ${REQUIREMENTS.minimumAndroidReleases} 种（覆盖最低/主流）`)
  console.log('- 至少 1 台**无气压计**机型（barometer=no）')
  console.log('- 每台都要填 carryModesTested（pocket、waist）与 smokeResult')
  console.log(
    '提示：serial/brand/model 可用 `node scripts/device-matrix.cjs collect --out matrix.csv` 自动填。',
  )
  return 0
}

function commandCollect(flags) {
  const out = flags.out
  if (!out || out === true) {
    console.error('collect 需要 --out <matrix.csv>')
    return 2
  }
  const adbCheck = spawnSync('adb', ['version'], { encoding: 'utf8' })
  if (adbCheck.error || adbCheck.status !== 0) {
    console.error('⛔ 找不到可用的 adb（PATH 里没有）。')
    console.error('   Windows：确认 platform-tools 在 PATH；WSL：用 Windows 侧 adb 或先 `adb devices` 验证。')
    console.error('   没有设备时先用 plan 准备矩阵骨架，拿到设备后再 collect。')
    return 2
  }
  const listed = spawnSync('adb', ['devices', '-l'], { encoding: 'utf8' })
  if (listed.status !== 0) {
    console.error(`adb devices 失败：${listed.stderr || listed.status}`)
    return 2
  }
  const devices = parseAdbDevices(listed.stdout).filter(
    (device) => device.state === 'device',
  )
  if (!devices.length) {
    console.error('⛔ adb 未发现处于 device 状态的设备（授权/连接问题请先解决）。')
    console.error(listed.stdout.trim())
    return 2
  }

  const existing = fs.existsSync(path.resolve(out))
    ? readMatrix(path.resolve(out)).rows
    : []
  const bySerial = new Map(existing.map((row) => [row.serial, row]))
  const barometer = ['yes', 'no'].includes(flags.barometer) ? flags.barometer : ''

  for (const device of devices) {
    const props = spawnSync(
      'adb',
      ['-s', device.serial, 'shell', 'getprop'],
      { encoding: 'utf8' },
    )
    const parsed = props.status === 0 ? parseGetprop(props.stdout) : {}
    const previous = bySerial.get(device.serial) ?? {}
    bySerial.set(device.serial, {
      serial: device.serial,
      brand: parsed.brand || previous.brand || '',
      model: parsed.model || device.model || previous.model || '',
      androidRelease: parsed.androidRelease || previous.androidRelease || '',
      sdk: parsed.sdk || previous.sdk || '',
      // 气压计无法用 getprop 判断：必须由人工/诊断包填写，这里只写显式传入的值。
      barometer: previous.barometer || barometer,
      carryModesTested: previous.carryModesTested || '',
      smokeResult: previous.smokeResult || '',
      notes: previous.notes || '',
    })
  }

  const rows = [...bySerial.values()]
  writeMatrix(path.resolve(out), rows)
  console.log(`已更新矩阵：${path.resolve(out)}（${rows.length} 台设备）`)
  console.log(
    '仍需人工填写：barometer（气压计有无）、carryModesTested（pocket/waist）、smokeResult（D13 清单结果）。',
  )
  console.log('下一步：node scripts/device-matrix.cjs validate ' + out)
  return 0
}

function commandValidate(positional) {
  const file = positional[0]
  if (!file) {
    usage()
    return 2
  }
  const resolved = path.resolve(file)
  if (!fs.existsSync(resolved)) {
    console.error(`矩阵文件不存在：${resolved}`)
    return 2
  }
  const { rows, error } = readMatrix(resolved)
  if (error) {
    console.error(error)
    return 2
  }
  const { gaps, filled, brands, releases } = evaluateMatrix(rows)
  console.log(`[device-matrix] 文件：${resolved}`)
  console.log(`设备行：${rows.length}（有效 ${filled.length}）`)
  console.log(`品牌：${[...brands].join('、') || '（无）'}`)
  console.log(`Android 版本：${[...releases].join('、') || '（无）'}`)
  if (gaps.length) {
    console.error(`\n⛔ 真机矩阵未达标（${gaps.length} 项）：`)
    for (const gap of gaps) console.error(`- ${gap}`)
    console.error(
      '\n提示：自动化测试不能替代真机验收；矩阵未达标时不得声称 D13 完成。',
    )
    return 1
  }
  console.log('\n✅ 真机矩阵覆盖率达标。下一步：')
  console.log('  1) 逐台按 07_QA_AND_RELEASE.md「真机验收」1–7 跑完并填 smokeResult')
  console.log(
    '  2) node scripts/device-matrix.cjs report ' +
      file +
      ' --apk <签名包> --out release-matrix.md',
  )
  return 0
}

function commandReport(flags, positional) {
  const file = positional[0]
  if (!file) {
    usage()
    return 2
  }
  const resolved = path.resolve(file)
  if (!fs.existsSync(resolved)) {
    console.error(`矩阵文件不存在：${resolved}`)
    return 2
  }
  const { rows, error } = readMatrix(resolved)
  if (error) {
    console.error(error)
    return 2
  }
  const { gaps, filled, brands, releases } = evaluateMatrix(rows)
  if (gaps.length) {
    console.error('⛔ 矩阵未达标，拒绝生成发布矩阵报告（避免出现「看起来很完整」的假证据）：')
    for (const gap of gaps) console.error(`- ${gap}`)
    return 1
  }

  let apk = null
  if (flags.apk && flags.apk !== true) {
    const apkPath = path.resolve(flags.apk)
    if (!fs.existsSync(apkPath)) {
      console.error(`APK 不存在：${apkPath}`)
      return 2
    }
    const bytes = fs.readFileSync(apkPath)
    apk = {
      file: path.basename(apkPath),
      sizeBytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    }
  }

  const appJsonPath = path.join(__dirname, '..', 'app.json')
  let appVersion = null
  let androidPackage = null
  if (fs.existsSync(appJsonPath)) {
    try {
      const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'))
      appVersion = appJson?.expo?.version ?? null
      androidPackage = appJson?.expo?.android?.package ?? null
    } catch {
      // app.json 不可读不影响矩阵结论，留空即可
    }
  }

  const lines = []
  lines.push('# 真机发布矩阵（D13 证据）')
  lines.push('')
  lines.push(`生成时间：${new Date().toISOString()}`)
  lines.push(`包名：${androidPackage ?? '（未读到）'}`)
  lines.push(`应用版本（app.json）：${appVersion ?? '（未读到）'}`)
  lines.push(
    `APK：${apk ? `${apk.file}（${apk.sizeBytes} 字节，sha256 ${apk.sha256}）` : '**未提供**（签名包出来后用 --apk 重新生成）'}`,
  )
  lines.push('')
  lines.push(`设备数：${filled.length}；品牌数：${brands.size}；Android 版本：${releases.size}`)
  lines.push('')
  lines.push(
    `| ${COLUMNS.join(' | ')} |`,
  )
  lines.push(`| ${COLUMNS.map(() => '---').join(' | ')} |`)
  for (const row of filled) {
    lines.push(`| ${COLUMNS.map((key) => row[key] ?? '').join(' | ')} |`)
  }
  lines.push('')
  lines.push('## 结论')
  lines.push('')
  lines.push(
    '- 覆盖率达标：满足设备/品牌/系统版本/无气压计机型门槛（由 `device-matrix validate` 判定）。',
  )
  lines.push(
    '- **仍需人工确认**：每台设备的 smokeResult 是否真的跑过 D13 清单 1–7（工具无法验证人是否真的走了楼梯）。',
  )
  lines.push(
    '- 能耗、温升、30 分钟锁屏采样属于 D11，需单独记录（见 `docs/dsh-handoff/D11_BACKGROUND_DECISION.md`）。',
  )

  const markdown = `${lines.join('\n')}\n`
  if (flags.out && flags.out !== true) {
    const outPath = path.resolve(flags.out)
    fs.writeFileSync(outPath, markdown, 'utf8')
    console.log(`已写入发布矩阵报告：${outPath}`)
    if (!apk) {
      console.log('注意：未提供 --apk，报告里的 APK 字段标记为「未提供」，不得当作包 hash 证据。')
    }
  } else {
    process.stdout.write(markdown)
  }
  return 0
}

function main(argv) {
  const { flags, positional } = parseArgs(argv)
  const command = positional.shift()
  if (command === 'plan') return commandPlan(flags)
  if (command === 'collect') return commandCollect(flags)
  if (command === 'validate') return commandValidate(positional)
  if (command === 'report') return commandReport(flags, positional)
  usage()
  return 2
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2))
}

module.exports = {
  main,
  parseAdbDevices,
  parseGetprop,
  readMatrix,
  evaluateMatrix,
  REQUIREMENTS,
  COLUMNS,
}
