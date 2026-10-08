// D13 真机矩阵工具的自动化验收。
//
// 这些用例证明的是「矩阵流程与判定逻辑可用」，**不是**真机证据：
// 真正的 smoke/能耗/锁屏结论必须由人在真机上跑出来（见 docs/dsh-handoff/07_QA_AND_RELEASE.md）。
//
// 用法：node --test scripts/device-matrix.test.cjs

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

const toolPath = path.join(__dirname, 'device-matrix.cjs')
const tool = require('./device-matrix.cjs')

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd13-matrix-'))

function run(args, options = {}) {
  return spawnSync(process.execPath, [toolPath, ...args], { encoding: 'utf8', ...options })
}

const GOOD_CSV = `serial,brand,model,androidRelease,sdk,barometer,carryModesTested,smokeResult,notes
R1,xiaomi,redmi-note,13,33,yes,pocket;waist,pass,
R2,xiaomi,mi-11,14,34,yes,pocket;waist,pass,
R3,samsung,sm-g991,12,31,yes,pocket;waist,pass,
R4,oneplus,le2110,14,34,no,pocket;waist,pass,无气压计机型
R5,oneplus,le2120,11,30,yes,pocket;waist,pass,最低支持版本
`

test('device-matrix parseAdbDevices：解析 device 状态、忽略表头与 unauthorized', () => {
  const text = [
    'List of devices attached',
    'R58M12345            device product:beyond1lte model:SM_G973F device:beyond1 transport_id:1',
    'emulator-5554        unauthorized transport_id:2',
    'ABC123               offline transport_id:3',
    '',
  ].join('\n')
  const devices = tool.parseAdbDevices(text)
  assert.equal(devices.length, 3)
  assert.equal(devices[0].serial, 'R58M12345')
  assert.equal(devices[0].state, 'device')
  assert.equal(devices[0].model, 'SM_G973F')
  assert.equal(devices[1].state, 'unauthorized')
  assert.equal(devices[2].state, 'offline')
})

test('device-matrix parseGetprop：取出品牌/型号/系统版本/SDK', () => {
  const text = [
    '[ro.product.brand]: [xiaomi]',
    '[ro.product.model]: [M2101K9C]',
    '[ro.build.version.release]: [13]',
    '[ro.build.version.sdk]: [33]',
    '[persist.sys.timezone]: [Asia/Shanghai]',
  ].join('\n')
  const props = tool.parseGetprop(text)
  assert.equal(props.brand, 'xiaomi')
  assert.equal(props.model, 'M2101K9C')
  assert.equal(props.androidRelease, '13')
  assert.equal(props.sdk, '33')
})

test('device-matrix plan：生成矩阵骨架并要求无气压计机型', () => {
  const target = path.join(outDir, 'plan.csv')
  const result = run(['plan', '--out', target])
  assert.equal(result.status, 0, result.stderr)
  const text = fs.readFileSync(target, 'utf8')
  const lines = text.trim().split('\n')
  assert.equal(lines.length, tool.REQUIREMENTS.minimumDevices + 1)
  assert.match(lines[0], /^serial,brand,model/)
  assert.match(text, /,no,/) // 骨架里预置一台「无气压计」机型
})

test('device-matrix validate：空骨架 → 退出码 1 并逐条列出缺口', () => {
  const target = path.join(outDir, 'empty.csv')
  run(['plan', '--out', target])
  const result = run(['validate', target])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /设备数：0 < 门槛 5/)
  assert.match(result.stderr, /缺少「无气压计」机型/)
  assert.match(result.stderr, /自动化测试不能替代真机验收/)
})

test('device-matrix validate：达标的合成矩阵 → 退出码 0', () => {
  const target = path.join(outDir, 'good.csv')
  fs.writeFileSync(target, GOOD_CSV, 'utf8')
  const result = run(['validate', target])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /真机矩阵覆盖率达标/)
  assert.match(result.stdout, /品牌：xiaomi、samsung、oneplus/)
})

test('device-matrix validate：缺 smokeResult / 携带方式 / barometer → 逐条列出', () => {
  const target = path.join(outDir, 'deficient.csv')
  fs.writeFileSync(
    target,
    `serial,brand,model,androidRelease,sdk,barometer,carryModesTested,smokeResult,notes
R1,xiaomi,a,13,33,,pocket,,未填气压计与 smoke
R2,xiaomi,b,13,33,yes,,pass,缺 waist
R3,samsung,c,12,31,yes,pocket;waist,pass,
R4,oneplus,d,11,30,yes,pocket;waist,pass,
R5,oneplus,e,14,34,no,pocket;waist,pass,
`,
    'utf8',
  )
  const result = run(['validate', target])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /smoke 结果缺失：1 台设备/)
  assert.match(result.stderr, /携带方式未覆盖 pocket\+waist/)
  assert.match(result.stderr, /barometer 列未填/)
})

test('device-matrix report：未达标时拒绝生成（不产出看起来完整的假证据）', () => {
  const target = path.join(outDir, 'report-bad.csv')
  run(['plan', '--out', target])
  const outPath = path.join(outDir, 'bad.md')
  const result = run(['report', target, '--out', outPath])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /拒绝生成发布矩阵报告/)
  assert.ok(!fs.existsSync(outPath), '未达标时不得写出报告文件')
})

test('device-matrix report：达标矩阵 + APK → 报告含包 hash 与矩阵表', () => {
  const target = path.join(outDir, 'report-good.csv')
  fs.writeFileSync(target, GOOD_CSV, 'utf8')
  const apkPath = path.join(outDir, 'fake.apk')
  fs.writeFileSync(apkPath, 'not-a-real-apk', 'utf8')
  const outPath = path.join(outDir, 'release-matrix.md')
  const result = run(['report', target, '--apk', apkPath, '--out', outPath])
  assert.equal(result.status, 0, result.stderr)
  const markdown = fs.readFileSync(outPath, 'utf8')
  const expected = require('node:crypto')
    .createHash('sha256')
    .update('not-a-real-apk')
    .digest('hex')
  assert.match(markdown, new RegExp(expected))
  assert.match(markdown, /包名：com\.zxn\.palou/)
  assert.match(markdown, /无气压计机型/)
  assert.match(markdown, /仍需人工确认/)
})

test('device-matrix collect：没有 adb 时退出码 2 且不伪造矩阵行', () => {
  const target = path.join(outDir, 'collect.csv')
  // Make the missing-adb case independent of whether the host has a real phone attached.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'))
  env.PATH = outDir
  const result = run(['collect', '--out', target], { env, cwd: outDir })
  assert.ok(
    result.status === 2,
    `期望退出码 2（缺 adb 或无设备），实际 ${result.status}\n${result.stderr}`,
  )
  if (result.status === 2) {
    assert.match(result.stderr, /adb|设备/)
    assert.ok(
      !fs.existsSync(target),
      '采集失败时不得写出只有表头的「看起来有设备」的矩阵',
    )
  }
})
