// 发布前本地检查：串联测试、类型、导出与诊断链路冒烟。
// 用法：npm run release:check
// 不包含：真机矩阵、高德轮换、签名与真实验证集门禁（见 PROJECT_STATUS.md）。

const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.join(__dirname, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const steps = [
  { name: '核心测试', args: ['test'] },
  { name: 'TypeScript', args: ['exec', 'tsc', '--', '--noEmit'] },
  { name: '依赖版本窗口', args: ['run', 'deps:check'] },
  { name: '存储恢复演练', args: ['run', 'drill'] },
  {
    name: '诊断链路冒烟',
    args: ['run', 'diagnostics:smoke'],
  },
  {
    name: 'Android 导出',
    args: [
      'exec',
      'expo',
      '--',
      'export',
      '--platform',
      'android',
      '--output-dir',
      '.expo-export-check/release-android-export',
    ],
  },
]

let failed = 0
for (const step of steps) {
  console.log(`\n=== ${step.name} ===`)
  const result = spawnSync(npm, step.args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    console.error(`[release:check] 失败：${step.name}`)
    failed += 1
    break
  }
  console.log(`[release:check] 通过：${step.name}`)
}

if (failed) {
  console.error('\n发布检查未通过。')
  process.exit(1)
}

console.log(`
[release:check] 本地检查全部通过。
仍需人工完成：
  - 真实诊断数据集 diagnostics:gate
  - 真机回归矩阵 / smoke:android
  - 高德 Key 轮换与来源限制
  - Release 签名、断 Metro 独立启动与升级不丢数据
详见 PROJECT_STATUS.md 与 docs/trusted-release-baseline.md
`)
