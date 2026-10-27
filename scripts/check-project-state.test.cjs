const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { checkProjectState } = require('./check-project-state.cjs')
const source = path.resolve(__dirname, '..')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steploop-project-state-'))
  t.after(() => {
    const resolved = path.resolve(root)
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()))
    assert.ok(path.basename(resolved).startsWith('steploop-project-state-'))
    fs.rmSync(resolved, { recursive: true, force: true })
  })
  for (const file of ['project-state.json', 'package.json', 'app.json', 'package-lock.json', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'PROJECT_STATUS.md', 'docs/archive/README.md']) {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(source, file), target)
  }
  return root
}

function change(root, file, edit) {
  const target = path.join(root, file)
  const json = JSON.parse(fs.readFileSync(target, 'utf8'))
  edit(json)
  fs.writeFileSync(target, JSON.stringify(json))
}

test('consistent source snapshot passes without Git metadata and stays read-only', t => {
  const root = fixture(t)
  const before = fs.readFileSync(path.join(root, 'project-state.json'))
  assert.deepEqual(checkProjectState(root).errors, [])
  assert.deepEqual(fs.readFileSync(path.join(root, 'project-state.json')), before)
})

for (const [label, file, edit, expected] of [
  ['old package', 'package.json', json => { json.version = '1.0.7' }, /package.json version/],
  ['old app config', 'app.json', json => { json.expo.version = '1.0.7' }, /app.json version/],
  ['old lockfile', 'package-lock.json', json => { json.version = '1.0.7' }, /package-lock.json version/],
  ['old lockfile root', 'package-lock.json', json => { json.packages[''].version = '1.0.7' }, /root version/],
  ['old Android code', 'app.json', json => { json.expo.android.versionCode = 8 }, /Android versionCode/],
  ['wrong release tag', 'project-state.json', json => { json.publishedRelease.tag = 'v1.0.7-preview.1' }, /Published tag version/],
  ['lost fix commit', 'project-state.json', json => { json.pendingChanges[0].commit = '' }, /Pending changes/],
]) {
  test(`rejects ${label}`, t => {
    const root = fixture(t)
    change(root, file, edit)
    assert.match(checkProjectState(root).errors.join('\n'), expected)
  })
}

test('a newer development version can retain the previous public release', t => {
  const root = fixture(t)
  change(root, 'project-state.json', json => { json.currentVersion = '1.1.6'; json.androidVersionCode = 15 })
  change(root, 'package.json', json => { json.version = '1.1.6' })
  change(root, 'package-lock.json', json => { json.version = '1.1.6'; json.packages[''].version = '1.1.6' })
  change(root, 'app.json', json => { json.expo.version = '1.1.6'; json.expo.android.versionCode = 15 })
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'README.md', 'PROJECT_STATUS.md']) {
    const target = path.join(root, file)
    fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replaceAll('1.1.5', '1.1.6'))
  }
  const result = checkProjectState(root)
  assert.deepEqual(result.errors, [])
  assert.equal(result.publishedTag, 'v1.1.5-preview.1')
})

test('rejects an older checkout even when its version files agree', t => {
  const root = fixture(t)
  change(root, 'project-state.json', json => { json.currentVersion = '1.0.7'; json.androidVersionCode = 8 })
  change(root, 'package.json', json => { json.version = '1.0.7' })
  change(root, 'package-lock.json', json => { json.version = '1.0.7'; json.packages[''].version = '1.0.7' })
  change(root, 'app.json', json => { json.expo.version = '1.0.7'; json.expo.android.versionCode = 8 })
  assert.match(checkProjectState(root).errors.join('\n'), /older than the published release/)
})

test('rejects a missing state file and stale AI entry', t => {
  const root = fixture(t)
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Expo only\n')
  assert.match(checkProjectState(root).errors.join('\n'), /AGENTS.md/)
  fs.writeFileSync(path.join(root, 'project-state.json'), '{')
  assert.match(checkProjectState(root).errors.join('\n'), /Cannot read project version files/)
})
