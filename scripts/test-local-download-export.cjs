const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const fs = require('node:fs')
const Module = require('node:module')
const { execFileSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const compiled = path.join(root, 'node_modules', '.cache', 'steploop-local-export')
execFileSync(process.execPath, [
  path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--ignoreConfig', '--ignoreDeprecations', '6.0',
  '--lib', 'es2022,dom', '--rootDir', 'src', '--outDir', compiled, '--module', 'commonjs',
  '--moduleResolution', 'node', '--target', 'es2022', '--esModuleInterop', '--skipLibCheck',
  'src/services/local-download-export.ts',
], { cwd: root, stdio: 'pipe' })

const platform = { OS: 'android', Version: 36 }
const nativeModules = {}
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'react-native') return { Platform: platform, NativeModules: nativeModules }
  return originalLoad.call(this, request, parent, isMain)
}
const service = require(path.join(compiled, 'services', 'local-download-export.js'))
Module._load = originalLoad

function installBackend(run) {
  platform.OS = 'android'; platform.Version = 36
  const calls = []
  nativeModules.AndroidLocalExport = {
    async saveToDownloads(...args) {
      calls.push(args)
      return run ? run(...args) : { uri: 'content://media/external_primary/downloads/123', displayName: args[1], directory: 'Download/循阶' }
    },
  }
  return calls
}

test('availability is Android 10+ only and importing the wrapper never publishes a file', async () => {
  const calls = installBackend()
  assert.equal(service.isLocalDownloadExportAvailable(), true)
  assert.equal(calls.length, 0)
  platform.Version = 28
  assert.equal(service.isLocalDownloadExportAvailable(), false)
  await assert.rejects(service.saveLocalFileToDownloads('file:///private/data.json', 'data.json', 'application/json'), /系统分享/)
  platform.Version = 36; platform.OS = 'ios'
  assert.equal(service.isLocalDownloadExportAvailable(), false)
  platform.OS = 'android'; delete nativeModules.AndroidLocalExport
  assert.equal(service.isLocalDownloadExportAvailable(), false)
  assert.equal(calls.length, 0)
})

test('an explicit save passes the private URI and returns the provider-confirmed new display name', async () => {
  const calls = installBackend(() => ({ uri: 'content://media/external_primary/downloads/124', displayName: '训练分析 (1).jsonl', directory: 'Download/循阶' }))
  const result = await service.saveLocalFileToDownloads('file:///data/user/0/com.zxn.palou/files/report.jsonl', '训练分析.jsonl', 'Application/X-Ndjson')
  assert.deepEqual(calls[0], ['file:///data/user/0/com.zxn.palou/files/report.jsonl', '训练分析.jsonl', 'application/x-ndjson'])
  assert.deepEqual(result, { uri: 'content://media/external_primary/downloads/124', displayName: '训练分析 (1).jsonl', directory: 'Download/循阶' })
})

test('nonlocal URIs, path-like names and malformed MIME never reach native publishing', async () => {
  const calls = installBackend()
  for (const source of ['https://example.org/private.json', 'content://other-provider/file/123', '/sdcard/data.json']) {
    await assert.rejects(service.saveLocalFileToDownloads(source, 'data.json', 'application/json'), /本地文件/)
  }
  for (const name of ['../data.json', 'dir/data.json', 'dir\\data.json', 'data\u0000.json', '..', 'data.']) {
    await assert.rejects(service.saveLocalFileToDownloads('file:///private/data.json', name, 'application/json'), /文件名/)
  }
  await assert.rejects(service.saveLocalFileToDownloads('file:///private/data.json', 'data.json', 'application/json\r\nanything'), /类型/)
  assert.equal(calls.length, 0)
})

test('native copy or canonical-path denial propagates instead of claiming download success', async () => {
  installBackend(() => { throw new Error('源文件不属于应用自己的文件或缓存目录。') })
  await assert.rejects(service.saveLocalFileToDownloads('file:///sdcard/other-app.json', 'data.json', 'application/json'), /不属于应用/)
  installBackend(() => { throw new Error('设备存储空间不足') })
  await assert.rejects(service.saveLocalFileToDownloads('file:///private/data.json', 'data.json', 'application/json'), /空间不足/)
})

test('uncertain or unexpected native results cannot be reported as confirmed saved downloads', async () => {
  for (const result of [undefined, { uri: 'file:///sdcard/data.json', displayName: 'data.json', directory: 'Download/循阶' },
    { uri: 'content://media/downloads/1', displayName: '', directory: 'Download/循阶' },
    { uri: 'content://media/downloads/1', displayName: 'data.json', directory: 'Elsewhere' }]) {
    installBackend(() => result)
    await assert.rejects(service.saveLocalFileToDownloads('file:///private/data.json', 'data.json', 'application/json'), /无法确认/)
  }
})

test('prebuild plugin copies exact native sources and registers once without permission changes', async () => {
  const temp = path.join(root, 'node_modules', '.cache', 'local-export-plugin-test')
  const target = path.join(temp, 'app', 'src', 'main', 'java', 'com', 'zxn', 'palou')
  fs.mkdirSync(target, { recursive: true })
  const mainFile = path.join(target, 'MainApplication.kt')
  fs.writeFileSync(mainFile, 'package com.zxn.palou\nPackageList(this).packages.apply {\n  add(AndroidVoicePackage())\n}\n')
  const withExport = require(path.join(root, 'plugins', 'withAndroidLocalExportModule.js'))
  const config = withExport({ name: 'local-export-test', slug: 'local-export-test', android: { permissions: ['android.permission.VIBRATE'] } })
  const input = () => ({ modRequest: { platformProjectRoot: temp, nextMod: async value => value }, modResults: {} })
  await config.mods.android.dangerous(input())
  await config.mods.android.dangerous(input())
  for (const file of ['AndroidLocalExportModule.kt', 'AndroidLocalExportPackage.kt']) {
    assert.deepEqual(fs.readFileSync(path.join(target, file)), fs.readFileSync(path.join(root, 'native', 'android-local-export', file)))
  }
  const main = fs.readFileSync(mainFile, 'utf8')
  assert.equal((main.match(/AndroidLocalExportPackage\(\)/g) ?? []).length, 1)
  assert.ok(main.includes('AndroidVoicePackage()'))
  assert.deepEqual(config.android.permissions, ['android.permission.VIBRATE'])
})
