// D15b：Expo SDK 依赖窗口守卫。
//
// 为什么需要它：`npx expo install --check` 需要网络，且**只在有人手动跑的时候**才生效。
// 一旦某次 `npm install <pkg>@latest` 把 Expo 管理的原生依赖顶出版本窗口，
// 构建可能在真机上以原生崩溃的形式出现——那时才发现就太晚了。
//
// 这里用 Expo 自己发布的权威清单 `node_modules/expo/bundledNativeModules.json`
// 做离线比对（无需网络），对 package.json 的**声明范围**与**实际安装版本**各查一遍：
//   - 声明范围与期望范围必须有交集；
//   - 实际安装版本必须落在期望范围内；
//   - 无法判定的范围写法（npm: / workspace: / git 等）一律 fail closed，不猜。
//
// 用法：
//   node scripts/check-dependency-window.cjs                 # 人读报告
//   node scripts/check-dependency-window.cjs --json <file>    # 机器可读
// 退出码：0 = 全部在窗口内；1 = 有依赖越界或无法判定；2 = 环境问题（缺清单/缺 node_modules）。

const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
// 允许测试用环境变量指向替身文件，从而能真实验证「越界时必须失败」。
const packageJsonPath = process.env.D15B_PACKAGE_JSON
  ? path.resolve(process.env.D15B_PACKAGE_JSON)
  : path.join(root, 'package.json')
const bundledPath = process.env.D15B_BUNDLED_JSON
  ? path.resolve(process.env.D15B_BUNDLED_JSON)
  : path.join(root, 'node_modules', 'expo', 'bundledNativeModules.json')
/** 安装版本的解析基准目录（替身 package.json 时仍应指向真实 node_modules）。 */
const modulesRoot = process.env.D15B_MODULES_ROOT
  ? path.resolve(process.env.D15B_MODULES_ROOT)
  : path.join(root, 'node_modules')

/** 已知的、不属于 Expo 托管清单的依赖：它们各自独立发布，需要单独人工跟踪。 */
const KNOWN_UNMANAGED = new Set([
  '@react-navigation/bottom-tabs',
  '@react-navigation/native',
  '@react-navigation/native-stack',
  'typescript',
  '@types/react',
  // expo 本体不在托管清单里，由下面的 SDK 一致性检查单独负责
  'expo',
])

/** 已在待办里计划引入、但当前未声明的 Expo 模块：显式列出来，避免「悄悄依赖」。 */
const PLANNED = ['expo-sqlite']

// === 极简 semver：只支持 Expo 实际会写出的范围形式，遇到别的写法一律「无法判定」 ===

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(value).trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compare(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1
  }
  return 0
}

/**
 * 判断某个版本是否满足范围。
 * 支持：`1.2.3`（精确）、`~1.2.3`（补丁级）、`^1.2.3`（次版本级）、`>=1.2.3`。
 * 其它形式返回 null（= 无法判定，调用方必须 fail closed）。
 */
function satisfies(version, range) {
  const target = parseVersion(version)
  if (!target) return null
  const trimmed = String(range).trim()
  if (trimmed.startsWith('~')) {
    const base = parseVersion(trimmed.slice(1))
    if (!base) return null
    return target[0] === base[0] && target[1] === base[1] && target[2] >= base[2]
  }
  if (trimmed.startsWith('^')) {
    const base = parseVersion(trimmed.slice(1))
    if (!base) return null
    if (base[0] > 0) return target[0] === base[0] && compare(target, base) >= 0
    if (base[1] > 0) return target[0] === 0 && target[1] === base[1] && target[2] >= base[2]
    return compare(target, base) === 0
  }
  if (trimmed.startsWith('>=')) {
    const base = parseVersion(trimmed.slice(2))
    if (!base) return null
    return compare(target, base) >= 0
  }
  const exact = parseVersion(trimmed)
  if (!exact) return null
  return compare(target, exact) === 0
}

/** 声明范围之间是否可能相交：只做保守判断，无法判定返回 null。 */
function rangesIntersect(a, b) {
  const parseBound = (range) => {
    const trimmed = String(range).trim()
    if (/^[~^]/.test(trimmed)) {
      const base = parseVersion(trimmed.slice(1))
      return base ? { base, kind: trimmed[0] } : null
    }
    const exact = parseVersion(trimmed)
    return exact ? { base: exact, kind: '=' } : null
  }
  const left = parseBound(a)
  const right = parseBound(b)
  if (!left || !right) return null
  // 用两端的下界/上界近似判断：同一主次版本视为相交（Expo 的 ~x.y.z 语义）
  const sameMinor = (x, y) => x[0] === y[0] && x[1] === y[1]
  if (left.kind === '=' && right.kind === '=') return compare(left.base, right.base) === 0
  if (left.kind === '=') return satisfies(left.base.join('.'), b) === true
  if (right.kind === '=') return satisfies(right.base.join('.'), a) === true
  return sameMinor(left.base, right.base)
}

function readInstalledVersion(name) {
  const candidate = path.join(modulesRoot, ...name.split('/'), 'package.json')
  if (!fs.existsSync(candidate)) return null
  try {
    return JSON.parse(fs.readFileSync(candidate, 'utf8')).version ?? null
  } catch {
    return null
  }
}

function main(argv) {
  let jsonPath = null
  const jsonFlag = argv.indexOf('--json')
  if (jsonFlag >= 0) jsonPath = argv[jsonFlag + 1]

  if (!fs.existsSync(packageJsonPath)) {
    console.error(`缺少 package.json：${packageJsonPath}`)
    return 2
  }
  if (!fs.existsSync(bundledPath)) {
    console.error(
      `缺少 Expo 托管清单：${bundledPath}\n` +
        '（需要 node_modules/expo；这是 Expo 自己发布的权威版本清单，不联网也能比对）',
    )
    return 2
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const bundled = JSON.parse(fs.readFileSync(bundledPath, 'utf8'))
  const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }

  const managed = []
  const unmanaged = []
  const violations = []

  for (const [name, range] of Object.entries(declared)) {
    const expected = bundled[name]
    if (!expected) {
      if (!KNOWN_UNMANAGED.has(name)) unmanaged.push({ name, range })
      continue
    }
    const installed = readInstalledVersion(name)
    const declaredOk = rangesIntersect(range, expected)
    const installedOk = installed === null ? null : satisfies(installed, expected)

    const problems = []
    if (declaredOk === null) problems.push(`声明范围无法判定：${range}`)
    else if (declaredOk === false) problems.push(`声明范围 ${range} 与期望 ${expected} 不相交`)
    if (installed === null) problems.push('未安装（node_modules 里找不到）')
    else if (installedOk === null) problems.push(`安装版本 ${installed} 无法判定`)
    else if (installedOk === false) problems.push(`安装版本 ${installed} 不在期望 ${expected} 内`)

    managed.push({ name, range, expected, installed, ok: problems.length === 0 })
    if (problems.length) violations.push({ name, range, expected, installed, problems })
  }

  // Expo SDK 本体与 react-native：单独核对（expo 不在托管清单里）
  const expoInstalled = readInstalledVersion('expo')
  const expoDeclared = declared.expo ?? null
  const expoExpected = expoInstalled ? `~${expoInstalled}` : null
  const expoOk =
    expoInstalled !== null &&
    expoDeclared !== null &&
    rangesIntersect(expoDeclared, `~${expoInstalled}`) === true
  if (!expoOk) {
    violations.push({
      name: 'expo',
      range: expoDeclared ?? '（未声明）',
      expected: expoExpected ?? '（未安装）',
      installed: expoInstalled,
      problems: ['expo 声明范围与已安装的 SDK 版本不一致'],
    })
  }

  const lines = []
  lines.push('# Expo SDK 依赖窗口守卫（离线）')
  lines.push('')
  lines.push(`SDK 包：expo@${expoInstalled ?? '—'}`)
  lines.push(`托管清单：node_modules/expo/bundledNativeModules.json（${Object.keys(bundled).length} 条）`)
  lines.push('')
  lines.push(`结果：**${violations.length === 0 ? '全部在窗口内' : `${violations.length} 项越界/无法判定`}**`)
  lines.push('')
  lines.push('| 包 | 声明 | 期望 | 实际安装 | 结论 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const item of managed.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(
      `| ${item.name} | ${item.range} | ${item.expected} | ${item.installed ?? '—'} | ${item.ok ? '✅' : '⛔'} |`,
    )
  }
  lines.push('')
  const plannedNotes = PLANNED.filter((name) => !declared[name] && bundled[name]).map(
    (name) => `- \`${name}\`：清单期望 \`${bundled[name]}\`，当前**未声明**（计划引入时必须用 \`npx expo install ${name}\`，不要手写版本）`,
  )
  if (plannedNotes.length) {
    lines.push('## 计划引入但尚未声明的 Expo 模块（D08b 依赖窗口提醒）')
    lines.push('')
    lines.push(...plannedNotes)
    lines.push('')
  }
  if (unmanaged.length) {
    lines.push('## 非 Expo 托管依赖（需人工跟踪，不在本守卫范围）')
    lines.push('')
    for (const item of unmanaged.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`- \`${item.name}\` ${item.range}`)
    }
    lines.push('')
  }
  if (violations.length) {
    lines.push('## 越界明细')
    lines.push('')
    for (const item of violations) {
      lines.push(`- **${item.name}**：${item.problems.join('；')}`)
    }
    lines.push('')
    lines.push('修复方式：在 Windows 侧执行 `npx expo install <包名>`（Expo 会写入正确范围）。')
  }

  const report = `${lines.join('\n')}\n`
  if (jsonPath) {
    fs.writeFileSync(
      path.resolve(jsonPath),
      `${JSON.stringify(
        {
          expo: expoInstalled,
          bundledCount: Object.keys(bundled).length,
          managed,
          unmanaged,
          violations,
          ok: violations.length === 0,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    console.log(`已写入机器可读结果：${path.resolve(jsonPath)}`)
  }
  process.stdout.write(report)
  if (violations.length) {
    console.error(`⛔ 依赖窗口守卫失败：${violations.length} 项`)
    return 1
  }
  console.log(`✅ 依赖窗口守卫通过：${managed.length} 个 Expo 托管依赖全部在窗口内`)
  return 0
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2))
}

module.exports = { main, satisfies, rangesIntersect, parseVersion, KNOWN_UNMANAGED }
