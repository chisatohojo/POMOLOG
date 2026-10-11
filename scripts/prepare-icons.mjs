import { mkdir, copyFile } from 'node:fs/promises'
import sharp from 'sharp'

await mkdir('public/icons', { recursive: true })
await copyFile('POMOLOG_icon.png', 'public/logo.png')
for (const size of [192, 512]) {
  await sharp('POMOLOG_icon.png')
    .resize(size, size, { fit: 'contain', background: '#ffffff' })
    .png()
    .toFile(`public/icons/icon-${size}.png`)
}
