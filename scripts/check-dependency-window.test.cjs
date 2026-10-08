// D15b 依赖窗口守卫的测试。
// 运行：node --test scripts/check-dependency-window.test.cjs
//
// 分两层：
//  1) 单元：semver 范围判定的语义（含「无法判定」必须返回 null，不能猜）；
//  2) 集成：真实仓库必须通过；用替身 package.json 注入越界时必须**退出 1**（fail closed 验证）。

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

const script = path.join(__dirname, 'check-dependency-window.cjs')
const root = path.join(__dirname, '..')
const { satisfies, rangesIntersect, parseVersion } = require(script)

test('D15b semver：~ 只允许同主次版本的更高补丁', () => {
  assert.equal(satisfies('57.0.3', '~57.0.3'), true)
  assert.equal(satisfies('57.0.4', '~57.0.3'), true)
  assert.equal(satisfies('57.0.2', '~57.0.3'), false, '低于期望补丁必须失败')
  assert.equal(satisfies('57.1.0', '~57.0.3'), false, '跨次版本必须失败')
  assert.equal(satisfies('58.0.0', '~57.0.3'), false, '跨主版本必须失败')
})

test('D15b semver：精确 / ^ / >= / 未知写法', () => {
  assert.equal(satisfies('2.2.0', '2.2.0'), true)
  assert.equal(satisfies('2.2.1', '2.2.0'), false)
  assert.equal(satisfies('15.1.1', '^15.0.2'), true)
  assert.equal(satisfies('14.9.9', '^15.0.2'), false)
  assert.equal(satisfies('1.5.0', '>=1.2.3'), true)
  // 无法判定的写法必须返回 null（调用方 fail closed），绝不能默认通过
  assert.equal(satisfies('1.0.0', 'workspace:*'), null)
  assert.equal(satisfies('1.0.0', 'npm:other@1.0.0'), null)
  assert.equal(satisfies('not-a-version', '~1.0.0'), null)
  assert.equal(parseVersion('1.2'), null)
})

test('D15b 范围相交：同主次版本视为相交，跨主次/主版本不相交', () => {
  assert.equal(rangesIntersect('~57.0.2', '~57.0.3'), true)
  assert.equal(rangesIntersect('~57.0.3', '~57.0.3'), true)
  assert.equal(rangesIntersect('~56.0.0', '~57.0.3'), false)
  assert.equal(rangesIntersect('2.2.0', '2.2.0'), true)
  assert.equal(rangesIntersect('2.1.0', '2.2.0'), false)
  assert.equal(rangesIntersect('workspace:*', '~1.0.0'), null, '无法判定必须是 null')
})

function runWith(env) {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    cwd: root,
    env: { ...process.env, ...env },
  })
}

test('D15b 真实仓库：所有 Expo 托管依赖都在窗口内（退出 0）', () => {
  const result = runWith({})
  assert.equal(result.status, 0, `守卫必须通过\n${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /全部在窗口内/)
  assert.match(result.stdout, /expo-sqlite/, '必须提示 D08b 计划引入的 expo-sqlite 期望版本')
})

test('D15b fail closed：声明范围越界时必须退出 1 并指出包名', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'palou-d15b-'))
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  // 把 expo-sensors 顶出一个次版本（模拟手写 npm install 造成漂移）
  pkg.dependencies['expo-sensors'] = '~57.9.9'
  const fakePkg = path.join(dir, 'package.json')
  fs.writeFileSync(fakePkg, JSON.stringify(pkg, null, 2), 'utf8')

  const result = runWith({ D15B_PACKAGE_JSON: fakePkg })
  assert.equal(result.status, 1, '越界必须退出 1，不得放行')
  assert.match(result.stdout, /expo-sensors/)
  assert.match(result.stdout, /越界明细|不相交/)
})

test('D15b fail closed：无法判定的范围写法必须退出 1（不猜、不放行）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'palou-d15b-'))
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  pkg.dependencies['expo-haptics'] = 'workspace:*'
  const fakePkg = path.join(dir, 'package.json')
  fs.writeFileSync(fakePkg, JSON.stringify(pkg, null, 2), 'utf8')

  const result = runWith({ D15B_PACKAGE_JSON: fakePkg })
  assert.equal(result.status, 1, '无法判定必须失败，而不是当作通过')
  assert.match(result.stdout, /无法判定/)
})
