const { mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const sharp = require('sharp')
const pngToIco = require('png-to-ico')
const toIco = typeof pngToIco === 'function' ? pngToIco : pngToIco.default

const root = join(__dirname, '..')
const resources = join(root, 'resources')
const svg = readFileSync(join(resources, 'spoon.svg'))

async function png(size, dest) {
  await sharp(svg)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(dest)
}

function writeBmp(width, height, rgb, dest) {
  const row = Math.ceil((width * 3) / 4) * 4
  const pixels = Buffer.alloc(row * height)
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y
    for (let x = 0; x < width; x++) {
      const i = (srcY * width + x) * 3
      const o = y * row + x * 3
      pixels[o] = rgb[i + 2]
      pixels[o + 1] = rgb[i + 1]
      pixels[o + 2] = rgb[i]
    }
  }
  const header = Buffer.alloc(54)
  header.write('BM', 0)
  header.writeUInt32LE(54 + pixels.length, 2)
  header.writeUInt32LE(54, 10)
  header.writeUInt32LE(40, 14)
  header.writeInt32LE(width, 18)
  header.writeInt32LE(height, 22)
  header.writeUInt16LE(1, 26)
  header.writeUInt16LE(24, 28)
  header.writeUInt32LE(pixels.length, 34)
  writeFileSync(dest, Buffer.concat([header, pixels]))
}

async function bmp(width, height, dest, { padTop = 0 } = {}) {
  const iconSize = Math.round(Math.min(width, height) * 0.62)
  const icon = await sharp(svg)
    .resize(iconSize, iconSize, { fit: 'contain', background: { r: 91, g: 33, b: 182, alpha: 1 } })
    .png()
    .toBuffer()
  const rgb = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 91, g: 33, b: 182 }
    }
  })
    .composite([
      {
        input: icon,
        top: padTop || Math.round((height - iconSize) / 2),
        left: Math.round((width - iconSize) / 2)
      }
    ])
    .removeAlpha()
    .raw()
    .toBuffer()
  writeBmp(width, height, rgb, dest)
}

async function main() {
  mkdirSync(resources, { recursive: true })
  await png(1024, join(resources, 'icon.png'))
  const buffers = []
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    buffers.push(await sharp(svg).resize(size, size).png({ compressionLevel: 9 }).toBuffer())
  }
  writeFileSync(join(resources, 'icon.ico'), await toIco(buffers))
  await bmp(150, 57, join(resources, 'installerHeader.bmp'))
  await bmp(164, 314, join(resources, 'installerSidebar.bmp'), { padTop: 36 })
  console.log('Wrote icon.png, icon.ico, installerHeader.bmp, installerSidebar.bmp')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
