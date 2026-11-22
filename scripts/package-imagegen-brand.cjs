const fs = require('node:fs')
const path = require('node:path')
const Jimp = require('jimp-compact')

const root = path.resolve(__dirname, '..')
const brand = 'assets/brand/steploop'
const ui = 'assets/icons/ui'
const source = 'assets/icons/sources'
const website = 'docs/assets/site-icons'
const config = require('../app.json').expo

// Separators follow the empty gutters in each ImageGen sheet. Slots with a
// later revision are skipped so the final icon has a single source.
const sheets = [
  {
    name: 'training',
    columns: [0, 314, 624, 944, 1254],
    rows: [0, 346, 655, 952, 1254],
    icons: [
      'climb', 'coach', 'records', 'settings',
      'stairs', 'building', 'elevator-down', 'rounds',
      'target', 'compass', 'activity', 'book-open',
      'user', 'group', 'walk', 'run',
    ],
  },
  {
    name: 'controls',
    columns: [0, 330, 625, 920, 1254],
    rows: [0, 329, 641, 938, 1254],
    icons: [
      'chevron-right', 'arrow-right', 'arrow-up-right', 'plus',
      'minus', 'close', 'close-circle', 'check',
      'check-circle', 'checkbox', 'checkbox-checked', 'pencil',
      'trash', 'more', 'undo', 'replay',
    ],
  },
  {
    name: 'status',
    columns: [0, 320, 626, 932, 1254],
    rows: [0, 344, 661, 964, 1254],
    icons: [
      'alert', 'info', 'help', 'pause-circle',
      'play-circle', 'play', 'smartphone', 'display',
      'shield', 'shield-check', 'lock', 'bell',
      null, 'vibrate', 'sound', 'clock',
    ],
  },
  {
    name: 'data',
    columns: [0, 314, 626, 934, 1254],
    rows: [0, 334, 656, 970, 1254],
    icons: [
      'accessibility', 'search', 'download', 'upload',
      'share', 'file-text', 'table', 'database',
      'chart', 'speedometer', 'fire', 'shoe-print',
      'lightning', 'terrain', null, null,
    ],
  },
  {
    name: 'badges',
    columns: [0, 444, 888, 1330, 1774],
    rows: [0, 444, 887],
    icons: [
      'flag', 'flag-checkered', 'layers', 'zap',
      'sun', 'feather', 'music', 'droplet',
    ],
  },
  {
    name: 'reference-corrections',
    columns: [0, 635, 1254],
    rows: [0, 675, 1254],
    icons: ['moon', 'basketball', 'soccer', 'battery'],
  },
]

async function save(image, file) {
  const target = path.join(root, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  await image.writeAsync(target)
}

function trim(image, name, monochrome = false) {
  const { width, height, data } = image.bitmap
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  image.scan(0, 0, width, height, (x, y, index) => {
    if (monochrome) {
      const luminance = (data[index] + data[index + 1] + data[index + 2]) / 3
      const opacity = Math.max(0, Math.min(1, (239 - luminance) / 186))
      data[index + 3] = Math.round(data[index + 3] * opacity)
      data[index] = data[index + 1] = data[index + 2] = 255
    }
    if (data[index + 3] <= 8) {
      data[index + 3] = 0
      return
    }
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  })
  if (left >= right || top >= bottom || left < 4 || top < 4 || right >= width - 4 || bottom >= height - 4) {
    throw new Error('Missing artwork or insufficient space around ' + name)
  }
  return image.crop(left, top, right - left + 1, bottom - top + 1)
}

function tile(mark, size, fraction, background = 0x00000000) {
  const maximum = Math.round(size * fraction)
  const glyph = mark.clone().scaleToFit(maximum, maximum, Jimp.RESIZE_BICUBIC)
  const left = Math.round((size - glyph.bitmap.width) / 2)
  const top = Math.round((size - glyph.bitmap.height) / 2)
  return new Jimp(size, size, background).composite(glyph, left, top)
}

const smallSymbols = new Set([
  'chevron-right', 'arrow-right', 'arrow-up-right', 'plus', 'minus',
  'close', 'check', 'more', 'play',
])
const largeSymbols = new Set(['smartphone', 'shield-check'])
const rotations = {
  'chevron-left': ['chevron-right', 180],
  'chevron-up': ['chevron-right', 90],
  'chevron-down': ['chevron-right', -90],
  'arrow-up': ['arrow-right', 90],
  'arrow-down': ['arrow-right', -90],
}

async function buildIcons() {
  const icons = new Map()
  for (const sheet of sheets) {
    const image = await Jimp.read(path.join(root, source, sheet.name + '.png'))
    const columnCount = sheet.columns.length - 1
    const rowCount = sheet.rows.length - 1
    if (image.bitmap.width !== sheet.columns[columnCount] ||
        image.bitmap.height !== sheet.rows[rowCount] ||
        sheet.icons.length !== columnCount * rowCount) {
      throw new Error('Source dimensions do not match the crop grid for ' + sheet.name)
    }
    for (const [index, name] of sheet.icons.entries()) {
      if (!name) continue
      if (icons.has(name)) throw new Error('Duplicate icon ' + name)
      const column = index % columnCount
      const row = Math.floor(index / columnCount)
      const left = sheet.columns[column]
      const top = sheet.rows[row]
      const cell = image.clone().crop(left, top, sheet.columns[column + 1] - left, sheet.rows[row + 1] - top)
      const glyph = trim(cell, name, true)
      const size = largeSymbols.has(name) ? 320 : 128
      const fraction = smallSymbols.has(name) ? 0.64 : 0.82
      icons.set(name, tile(glyph, size, fraction))
    }
  }
  for (const [name, [origin, degrees]] of Object.entries(rotations)) {
    icons.set(name, icons.get(origin).clone().rotate(degrees, false))
  }
  await Promise.all([...icons].filter(([name]) => name !== 'moon')
    .map(([name, image]) => save(image, ui + '/' + name + '.png')))
  await Promise.all(['arrow-right', 'arrow-up-right', 'arrow-down', 'download', 'shield-check', 'sun', 'moon', 'plus', 'close']
    .map(name => save(icons.get(name), website + '/' + name + '.png')))
  return icons.size - 1
}

async function buildBrand() {
  const mark = trim(await Jimp.read(path.join(root, brand, 'master.png')), 'app mark')
  const silhouette = mark.clone()
  silhouette.scan(0, 0, silhouette.bitmap.width, silhouette.bitmap.height, (x, y, index) => {
    const { data } = silhouette.bitmap
    data[index] = data[index + 1] = data[index + 2] = 255
  })
  const background = Number.parseInt(config.android.adaptiveIcon.backgroundColor.slice(1) + 'ff', 16)
  await Promise.all([
    save(tile(mark, 1024, 0.72, background), brand + '/icon.png'),
    save(tile(mark, 1024, 0.52), brand + '/adaptive-foreground.png'),
    save(tile(silhouette, 1024, 0.52), brand + '/adaptive-monochrome.png'),
    save(tile(mark, 512, 0.52), brand + '/splash.png'),
    save(tile(mark, 64, 0.78, background), brand + '/favicon.png'),
    save(tile(silhouette, 512, 0.89), brand + '/mark.png'),
    save(tile(mark, 192, 0.72, background), website + '/steploop.png'),
  ])
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
  await Promise.all(Object.entries(densities).map(([density, scale]) =>
    save(tile(silhouette, 24 * scale, 0.9), 'native/android-training/res/drawable-' + density + '/ic_stat_steploop.png')))
}

async function main() {
  const count = await buildIcons()
  await buildBrand()
  console.log('Packaged ' + count + ' app icons, website icons and all Steploop brand resources.')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
