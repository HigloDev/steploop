// Exercise the consumers of the narrowly scoped security overrides.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { getAssetSize } = require('metro/private/Assets')

for (const file of ['assets/icon.png', 'docs/assets/cover.jpg', 'docs/assets/site/download-qr.svg']) {
  test(`Metro reads the ${path.extname(file)} project asset through patched image-size`, () => {
    const size = getAssetSize(path.extname(file).slice(1), fs.readFileSync(path.join(__dirname, '..', file)), file)
    assert.ok(Number.isFinite(size.width) && size.width > 0)
    assert.ok(Number.isFinite(size.height) && size.height > 0)
  })
}

test('xcode generates valid unique project identifiers with patched uuid', () => {
  const project = require('xcode').project('compatibility-only.pbxproj')
  project.hash = { project: { objects: {} } }
  const ids = new Set(Array.from({ length: 1000 }, () => project.generateUuid()))
  assert.equal(ids.size, 1000)
  assert.ok([...ids].every(id => /^[A-F0-9]{24}$/.test(id)))
})
