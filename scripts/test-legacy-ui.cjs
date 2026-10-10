// Archived route-screen checks remain runnable on a checkout that has those
// screens. fusion-v1 removed them; its current flow has separate coverage.
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const suites = [
  { file: 'test-location-picker.cjs', pages: ['LocationPicker.tsx'], cases: 24 },
  { file: 'test-route-review.cjs', pages: ['Review.tsx'], cases: 9 },
  { file: 'test-workout-mode-entry.cjs', pages: ['TrainHome.tsx', 'WorkoutSetup.tsx'], cases: 4 },
  { file: 'test-calibrate-live.cjs', pages: ['Calibrate.tsx'], cases: 6 },
]
for (const suite of suites) {
  const present = suite.pages.every(page => fs.existsSync(path.join(root, 'src/pages', page)))
  test(`archived ${suite.file} (${suite.cases} route-screen checks)`, {
    skip: present ? false : 'Retired route screens; fusion-v1 is covered by test-fusion-flow.cjs and native UI audits',
  }, () => execFileSync(process.execPath, ['--test', path.join(__dirname, suite.file)], { cwd: root, stdio: 'inherit' }))
}
