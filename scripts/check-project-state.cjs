// Read-only check: distinguish the current checkout from the published release.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

function checkProjectState(root = path.resolve(__dirname, '..')) {
  const errors = []
  const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
  let state, pkg, lock, app
  try {
    state = read('project-state.json')
    pkg = read('package.json')
    lock = read('package-lock.json')
    app = read('app.json').expo
  } catch (error) {
    return { errors: [`Cannot read project version files: ${error.message}`] }
  }
  const equal = (label, actual, expected) => {
    if (actual !== expected) errors.push(`${label}: expected ${expected}, found ${actual}`)
  }
  equal('state schema', state.schemaVersion, 1)
  equal('project name', pkg.name, state.project)
  equal('package.json version', pkg.version, state.currentVersion)
  equal('app.json version', app?.version, state.currentVersion)
  equal('package-lock.json version', lock.version, state.currentVersion)
  equal('package-lock.json root version', lock.packages?.['']?.version, state.currentVersion)
  equal('Android versionCode', app?.android?.versionCode, state.androidVersionCode)
  if (!Number.isInteger(state.androidVersionCode) || state.androidVersionCode < 1) {
    errors.push('androidVersionCode must be a positive integer')
  }
  const release = state.publishedRelease
  const numericVersion = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value)
  if (!numericVersion(state.currentVersion) || !numericVersion(release?.version)) {
    errors.push('Current and published versions must use x.y.z')
  } else {
    const current = state.currentVersion.split('.').map(Number)
    const published = release.version.split('.').map(Number)
    const firstDifference = current.findIndex((value, index) => value !== published[index])
    if (firstDifference >= 0 && current[firstDifference] < published[firstDifference]) {
      errors.push('Current checkout is older than the published release')
    }
    const tagVersion = release.tag?.match(/^v(\d+\.\d+\.\d+)(?:-[\w.-]+)?$/)?.[1]
    equal('Published tag version', tagVersion, release.version)
  }
  if (!Number.isInteger(release?.androidVersionCode) || state.androidVersionCode < release.androidVersionCode) {
    errors.push('Current Android versionCode must not precede the published release')
  }
  if (!/^[a-f0-9]{40}$/.test(release?.sourceCommit ?? '')) {
    errors.push('Published sourceCommit must be a full Git commit SHA')
  }
  if (!Array.isArray(state.pendingChanges)) errors.push('pendingChanges must be an array')
  for (const pending of Array.isArray(state.pendingChanges) ? state.pendingChanges : []) {
    if (!pending.branch?.startsWith('codex/') || !/^[a-f0-9]{40}$/.test(pending.commit ?? '') || pending.status !== 'preserved-not-merged') {
      errors.push('Pending changes must identify a preserved branch and full commit SHA')
    }
  }
  for (const entry of ['AGENTS.md', 'CLAUDE.md', 'README.md', 'PROJECT_STATUS.md']) {
    try {
      const text = fs.readFileSync(path.join(root, entry), 'utf8')
      if (!text.includes(state.currentVersion) || !text.includes('project-state.json')) {
        errors.push(`${entry} must point to project-state.json and the current version`)
      }
    } catch {
      errors.push(`Missing project entry: ${entry}`)
    }
  }
  if (typeof state.archives?.documentationIndex !== 'string' || !fs.existsSync(path.join(root, state.archives.documentationIndex))) {
    errors.push('Missing historical documentation index')
  }
  if (fs.existsSync(path.join(root, '.git'))) {
    const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const canonical = value => value.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git\/?$/, '').replace(/\/$/, '').toLowerCase()
    try {
      if (canonical(git(['config', '--get', 'remote.origin.url'])) !== canonical(state.repository)) {
        errors.push('origin does not match the canonical repository in project-state.json')
      }
    } catch {
      errors.push('Cannot verify the origin remote')
    }
    try {
      equal('Published tag commit', git(['rev-parse', '--verify', `refs/tags/${release.tag}^{commit}`]), release.sourceCommit)
    } catch {
      errors.push('Published release tag is unavailable; use a full clone or fetch its tags')
    }
    try {
      git(['merge-base', '--is-ancestor', release.sourceCommit, 'HEAD'])
    } catch {
      errors.push('Checkout does not descend from the published source; changing version numbers is insufficient')
    }
    for (const pending of Array.isArray(state.pendingChanges) ? state.pendingChanges : []) {
      try {
        git(['merge-base', '--is-ancestor', pending.commit, 'HEAD'])
        errors.push(`Pending branch ${pending.branch} is already included; update its recorded status`)
      } catch {
        // A preserved pending commit need not be present in a source-only clone.
      }
    }
  }
  return { version: state.currentVersion, androidVersionCode: state.androidVersionCode, publishedTag: release?.tag, pendingChanges: state.pendingChanges?.length, errors }
}

module.exports = { checkProjectState }
if (require.main === module) {
  const result = checkProjectState()
  if (result.errors.length) {
    console.error(result.errors.map(error => `Project state error: ${error}`).join('\n'))
    process.exitCode = 1
  } else {
    console.log(`Project state OK: ${result.version} / Android ${result.androidVersionCode}; published ${result.publishedTag}; ${result.pendingChanges} preserved pending branch(es).`)
  }
}
