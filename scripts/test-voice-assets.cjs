const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const root = path.join(__dirname, '..')
const voiceRoot = path.join(root, 'assets', 'voice')
const catalog = JSON.parse(fs.readFileSync(path.join(voiceRoot, 'catalog.json'), 'utf8'))
const manifest = JSON.parse(fs.readFileSync(path.join(voiceRoot, 'manifest.json'), 'utf8'))

test('all real recorded clips match provenance hashes and contain decodable audio', () => {
  assert.equal(manifest.version, 3)
  assert.equal(manifest.files.length, Object.keys(catalog.clips).length * 4)
  assert.equal(new Set(manifest.files.map(item => item.file)).size, manifest.files.length)
  for (const speaker of ['serena', 'vivian', 'uncle_fu', 'dylan']) {
    assert.deepEqual(manifest.files.filter(item => item.speaker === speaker).map(item => item.id).sort(), Object.keys(catalog.clips).sort())
  }
  for (const item of manifest.files) {
    const file = path.join(voiceRoot, item.file)
    const bytes = fs.readFileSync(file)
    assert.equal(bytes.length, item.bytes)
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), item.sha256)
    assert.equal(item.text, catalog.clips[item.id])
    const probe = JSON.parse(execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration:stream=sample_rate,channels,codec_name', '-of', 'json', file,
    ], { encoding: 'utf8' }))
    assert.equal(probe.streams[0].codec_name, 'mp3')
    assert.equal(probe.streams[0].channels, 1)
    assert.equal(Number(probe.streams[0].sample_rate), 24000)
    assert.ok(Number(probe.format.duration) > 0.15 && Number(probe.format.duration) < 15, item.id)
  }
})

test('config plugin packages the full clip library and registers exactly one module', async () => {
  const temp = path.join(root, 'node_modules', '.cache', 'voice-plugin-test')
  const mainDir = path.join(temp, 'app', 'src', 'main', 'java', 'com', 'zxn', 'palou')
  fs.mkdirSync(mainDir, { recursive: true })
  const mainFile = path.join(mainDir, 'MainApplication.kt')
  fs.writeFileSync(mainFile, 'package com.zxn.palou\nPackageList(this).packages.apply {\n}\n')
  const withVoice = require(path.join(root, 'plugins', 'withAndroidVoiceModule.js'))
  const config = withVoice({ name: 'voice-test', slug: 'voice-test' })
  const manifestMod = { modResults: { manifest: {} }, modRequest: {} }
  await config.mods.android.manifest({ ...manifestMod, modRequest: { ...manifestMod.modRequest, nextMod: async (data) => data } })
  const makeInput = () => ({
    modRequest: { platformProjectRoot: temp, nextMod: async (data) => data },
    modResults: {},
  })
  await config.mods.android.dangerous(makeInput())
  await config.mods.android.dangerous(makeInput())
  assert.equal((fs.readFileSync(mainFile, 'utf8').match(/AndroidVoicePackage\(\)/g) ?? []).length, 1)
  for (const item of manifest.files) {
    assert.deepEqual(fs.readFileSync(path.join(temp, 'app', 'src', 'main', 'assets', 'voice', item.file)), fs.readFileSync(path.join(voiceRoot, item.file)))
  }
  assert.ok(fs.existsSync(path.join(mainDir, 'AndroidVoiceModule.kt')))
  assert.equal(fs.existsSync(path.join(temp, 'app', 'src', 'main', 'assets', 'voice', 'workout_done.mp3')), false)
})
