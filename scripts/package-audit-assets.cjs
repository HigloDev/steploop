// Platform exports from ImageGen masters. The generated geometry stays intact.
const fs = require('node:fs')
const path = require('node:path')
const Jimp = require('jimp-compact')
const root = path.resolve(__dirname, '..')
const file = p => path.join(root, p)
const ORANGE = [255, 122, 46]
async function save(img, p) {
  fs.mkdirSync(path.dirname(file(p)), { recursive: true })
  await img.writeAsync(file(p))
}
async function mask(p) {
  const img = await Jimp.read(file(p))
  let l = img.bitmap.width, t = img.bitmap.height, r = 0, b = 0
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function(x, y, i) {
    // Alpha below 8 is transparent export noise, not part of the generated mark.
    const a = this.bitmap.data[i + 3]
    this.bitmap.data[i + 3] = a <= 8 ? 0 : a >= 200 ? 255 : a
    this.bitmap.data[i] = this.bitmap.data[i + 1] = this.bitmap.data[i + 2] = 255
    if (a > 8) { l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x); b = Math.max(b, y) }
  })
  return img.crop(l, t, r - l + 1, b - t + 1)
}
function tint(img, color) {
  const result = img.clone()
  result.scan(0, 0, result.bitmap.width, result.bitmap.height, function(x, y, i) {
    color.forEach((v, c) => { this.bitmap.data[i + c] = v })
  })
  return result
}
async function main() {
  const mark = await mask('assets/brand/audit-master.png')
  await save(mark, 'assets/brand/mark-audit.png')
  function tile(size, fraction, background = 0x00000000, color = ORANGE) {
    const glyph = tint(mark, color).scaleToFit(Math.round(size * fraction), Math.round(size * fraction))
    return new Jimp(size, size, background).composite(glyph, Math.round((size - glyph.bitmap.width) / 2), Math.round((size - glyph.bitmap.height) / 2))
  }
  await save(tile(1024, 0.72, 0x11100fff), 'assets/brand/audit-icon.png')
  await save(tile(1024, 0.48), 'assets/brand/audit-adaptive.png')
  await save(tile(1024, 0.48, 0x00000000, [255, 255, 255]), 'assets/brand/audit-monochrome.png')
  await save(tile(512, 0.86), 'assets/brand/audit-splash.png')
  await save(tile(64, 0.78, 0x11100fff), 'assets/brand/audit-favicon.png')
  await save(await mask('assets/icons/building-master.png'), 'assets/icons/building.png')
  for (const [density, scale] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
    await save(tile(24 * scale, 0.9, 0x00000000, [255, 255, 255]), `native/android-training/res/drawable-${density}/ic_stat_steploop.png`)
  }
  console.log('Exported warm orange identity, adaptive/monochrome icons, splash, favicon and notification masks.')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
