// 迁移/恢复演练的守护测试：确保演练脚本本身不会腐烂。
// 运行：node --test scripts/recovery-drill.test.cjs
//
// 为什么需要它：演练是「证据」而不是「测试」，如果它悄悄变成恒真（或恒假），
// 交接材料里就会带着一份假的 ✅。这里用子进程真实执行一遍，并检查：
//  1) 退出码为 0；
//  2) 每个场景都真的出现在输出里（防止场景被删/被跳过却仍显示「全部通过」）；
//  3) --json 结果里每个场景 passed 都为 true，且场景数与预期一致；
//  4) 报告文件确实写出来了。

const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

const script = path.join(__dirname, 'recovery-drill.cjs')
const EXPECTED_SCENARIOS = ['S1', 'S2', 'S2b', 'S3', 'S4', 'S5']

function runDrill(args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
  })
}

test('演练脚本本身可运行且全部通过（防止证据腐烂）', () => {
  const result = runDrill([])
  assert.equal(result.status, 0, `演练必须退出 0，实际 ${result.status}\n${result.stderr}`)
  for (const id of EXPECTED_SCENARIOS) {
    assert.match(
      result.stdout,
      new RegExp(`^✅ ${id} `, 'm'),
      `场景 ${id} 必须出现且通过`,
    )
  }
  assert.match(result.stdout, /全部|结果：\*\*6\/6 通过\*\*/)
})

test('演练 --json 结果自洽：场景齐全、全部 passed、计数一致', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'palou-drill-'))
  const jsonPath = path.join(dir, 'result.json')
  const reportPath = path.join(dir, 'report.md')
  const result = runDrill(['--out', reportPath, '--json', jsonPath])
  assert.equal(result.status, 0, `演练必须退出 0，实际 ${result.status}`)

  const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  assert.equal(parsed.total, EXPECTED_SCENARIOS.length, '场景数必须与预期一致')
  assert.equal(parsed.passed, EXPECTED_SCENARIOS.length, '所有场景必须通过')
  assert.deepEqual(
    parsed.results.map((item) => item.id),
    EXPECTED_SCENARIOS,
    '场景顺序与 id 必须稳定（报告可对比）',
  )
  for (const item of parsed.results) {
    assert.equal(item.passed, true, `${item.id} 必须通过`)
    assert.ok(item.evidence && item.evidence.length > 0, `${item.id} 必须带实测证据`)
  }

  const report = fs.readFileSync(reportPath, 'utf8')
  assert.match(report, /迁移\/恢复演练报告/)
  assert.match(report, /不是真机/, '报告必须写明它不是真机证据')
  assert.match(report, /6\/6 通过/)
})
