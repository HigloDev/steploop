// Package the approved ImageGen master into platform sizes; no geometry is redrawn.
const fs = require('node:fs')
const path = require('node:path')
const Jimp = require('jimp-compact')
const root = path.resolve(__dirname, '..')
const output = p => path.join(root, p)
async function save(img, p) {
  fs.mkdirSync(path.dirname(output(p)), { recursive: true })
  await img.writeAsync(output(p))
}
async function main() {
  const master = await Jimp.read(output('assets/brand/master.png'))
  let left = master.bitmap.width, top = master.bitmap.height, right = 0, bottom = 0
  master.scan(0, 0, master.bitmap.width, master.bitmap.height, function(x, y, i) {
    if (this.bitmap.data[i + 3] > 0) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y) }
  })
  const mark = master.clone().crop(left, top, right - left + 1, bottom - top + 1)
  mark.scan(0, 0, mark.bitmap.width, mark.bitmap.height, function(x, y, i) {
    this.bitmap.data[i] = this.bitmap.data[i + 1] = this.bitmap.data[i + 2] = 255
  })
  await save(mark, 'assets/brand/mark.png')
  function tile(size, fraction, background = 0x00000000) {
    const glyph = mark.clone().scaleToFit(Math.round(size * fraction), Math.round(size * fraction))
    return new Jimp(size, size, background).composite(glyph, Math.round((size - glyph.bitmap.width) / 2), Math.round((size - glyph.bitmap.height) / 2))
  }
  await save(tile(1024, 0.72, 0x3560e4ff), 'assets/icon.png')
  await save(tile(1024, 0.52), 'assets/android-icon-foreground.png')
  await save(tile(1024, 0.52), 'assets/android-icon-monochrome.png')
  await save(new Jimp(1024, 1024, 0x3560e4ff), 'assets/android-icon-background.png')
  await save(tile(512, 0.9), 'assets/splash-icon.png')
  await save(tile(512, 0.9), 'assets/splash-icon-v2.png')
  await save(tile(64, 0.8, 0x3560e4ff), 'assets/favicon.png')
  for (const [density, scale] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
    const dir = `android/app/src/main/res/mipmap-${density}`
    for (const [name, image] of [
      ['ic_launcher', tile(48 * scale, 0.72, 0x3560e4ff)],
      ['ic_launcher_round', tile(48 * scale, 0.72, 0x3560e4ff)],
      ['ic_launcher_foreground', tile(108 * scale, 0.52)],
      ['ic_launcher_monochrome', tile(108 * scale, 0.52)],
      ['ic_launcher_background', new Jimp(108 * scale, 108 * scale, 0x3560e4ff)],
    ]) {
      await save(image, `${dir}/${name}.png`)
      // Remove only the replaced same-name WebP to avoid duplicate Android resources.
      const old = output(`${dir}/${name}.webp`)
      if (fs.existsSync(old)) fs.unlinkSync(old)
    }
    await save(tile(288 * scale, 180 / 288 * 0.9), `android/app/src/main/res/drawable-${density}/splashscreen_logo.png`)
    for (const dir of ['native/android-training/res', 'android/app/src/main/res']) {
      await save(tile(24 * scale, 0.9), `${dir}/drawable-${density}/ic_stat_steploop.png`)
    }
  }
  console.log('Packaged approved master into launcher, adaptive, monochrome, splash, favicon, app and notification assets.')
}
if (process.argv.includes('--legacy')) {
  main().catch(error => { console.error(error); process.exitCode = 1 })
} else {
  require('./package-audit-assets.cjs')
}
