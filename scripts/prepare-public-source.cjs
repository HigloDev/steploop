// Produce a reviewable local source snapshot, never upload or change the Git index.
// Only explicitly selected product/source files enter the snapshot.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const selected = [
  'src', 'native', 'plugins', 'scripts', 'assets', '.github',
  'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', '.gitignore', '.env.example',
  'App.tsx', 'index.ts', 'app.json', 'package.json', 'package-lock.json',
  'tsconfig.json', 'metro.config.js',
  'docs/USER_GUIDE.md', 'docs/BUILDING.md', 'docs/FIRST_RELEASE.md',
  'docs/RELEASE_1.0.4.md',
  'docs/RELEASE_1.0.5.md', 'docs/VOICE_FEEDBACK.md',
  'docs/release-notes-draft.md',
]
const files = []
function visit(relative) {
  const full = path.join(root, relative)
  const stat = fs.lstatSync(full)
  if (stat.isSymbolicLink()) throw new Error(`Refusing symlink: ${relative}`)
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(full).sort()) visit(`${relative}/${name}`)
  } else {
    if (!stat.isFile()) throw new Error(`Not a regular file: ${relative}`)
    if (/\.(?:apk|jks|p12|keystore|log|pyc|jsonl)$|(?:^|\/)\.env(?!\.example$)|signing\.properties$/i.test(relative)) {
      throw new Error(`Private/generated file in selected tree: ${relative}`)
    }
    files.push(relative)
  }
}
for (const entry of selected) visit(entry)
// Check known local map credentials without displaying their values.
const localEnv = path.join(root, '.env.local')
const secrets = fs.existsSync(localEnv) ? fs.readFileSync(localEnv, 'utf8').split(/\r?\n/)
  .map(line => /^\s*EXPO_PUBLIC_AMAP_[A-Z_]+\s*=\s*(.*?)\s*$/.exec(line)?.[1]?.replace(/^['"]|['"]$/g, ''))
  .filter(value => value && value.length >= 12) : []
const records = files.sort().map(relative => {
  const bytes = fs.readFileSync(path.join(root, relative))
  if (secrets.some(secret => bytes.includes(Buffer.from(secret)))) throw new Error(`Local map credential in ${relative}`)
  const textFile = /\.(?:ts|tsx|js|cjs|json|md|txt|properties|xml|yml|yaml|py)$/.test(relative)
  if (textFile && /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(bytes.toString('utf8'))) {
    throw new Error(`Private key material in ${relative}`)
  }
  return { path: relative, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
})
const output = path.join(root, 'output', `public-source-${new Date().toISOString().replace(/[:.]/g, '-')}`)
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.mkdirSync(output, { recursive: false })
for (const file of records) {
  const target = path.join(output, file.path)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(path.join(root, file.path), target, fs.constants.COPYFILE_EXCL)
  if (crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== file.sha256) {
    throw new Error(`Source changed during copy: ${file.path}`)
  }
}
fs.writeFileSync(path.join(output, 'SOURCE_MANIFEST.json'), JSON.stringify({
  schemaVersion: 1, createdAt: new Date().toISOString(), version: require('../package.json').version,
  status: 'LOCAL_CANDIDATE_NOT_PUBLISHED',
  limitations: ['No Git history included', 'Known-secret matching is not a full security audit',
    'Real-motion and background acceptance remain pending; this is an Android experimental preview; see docs/FIRST_RELEASE.md'],
  files: records,
}, null, 2) + '\n')
console.log(JSON.stringify({ output, files: records.length, status: 'local_candidate' }, null, 2))
