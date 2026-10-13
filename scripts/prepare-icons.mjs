import { mkdir, copyFile } from 'node:fs/promises'
import sharp from 'sharp'

await mkdir('public/icons', { recursive: true })
await copyFile('POMOLOG_icon.png', 'public/logo.png')
// Original is 1254 square. Keep the existing clock/P symbol; exclude the wordmark.
const symbol = await sharp('POMOLOG_icon.png')
  .extract({ left: 420, top: 270, width: 454, height: 526 })
  .png()
  .toBuffer()
for (const size of [16, 32, 180, 192, 512]) {
  const padding = size <= 32 ? 1 : Math.round(size * 0.04)
  await sharp(symbol)
    .resize(size - 2 * padding, size - 2 * padding, { fit: 'contain', background: '#ffffff' })
    .extend({ top: padding, bottom: padding, left: padding, right: padding, background: '#ffffff' })
    .png()
    .toFile(`public/icons/icon-${size}.png`)
}
// Entire 288px square fits within the 80%-diameter safe circle of a 512px mask.
await sharp(symbol)
  .resize(288, 288, { fit: 'contain', background: '#ffffff' })
  .extend({ top: 112, bottom: 112, left: 112, right: 112, background: '#ffffff' })
  .png()
  .toFile('public/icons/icon-maskable-512.png')
