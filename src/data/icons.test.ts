import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

describe('文字なしシンボルアイコン', () => {
  it.each([16, 32, 180, 192, 512])('%ipxで枠内に大きくシンボルを表示する', async (size) => {
    const icon = sharp(`public/icons/icon-${size}.png`)
    const metadata = await icon.metadata()
    expect(metadata.width).toBe(size)
    expect(metadata.height).toBe(size)
    const { data, info } = await icon.removeAlpha().raw().toBuffer({ resolveWithObject: true })
    let colored = 0
    for (let i = 0; i < data.length; i += info.channels)
      if (data[i] < 180 || data[i + 1] < 180) colored++
    expect(colored / (size * size)).toBeGreaterThan(0.25)
    // Outer border is free of clipping, even at favicon size.
    for (let x = 0; x < size; x++) {
      expect(data[x * info.channels]).toBeGreaterThan(240)
      expect(data[((size - 1) * size + x) * info.channels]).toBeGreaterThan(240)
    }
  })
  it('maskableアイコンは80%の安全円内に収まる', async () => {
    const { data, info } = await sharp('public/icons/icon-maskable-512.png')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([512, 512])
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++) {
        if (Math.hypot(x - 255.5, y - 255.5) > 204.8) {
          const i = (y * 512 + x) * info.channels
          if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240)
            throw new Error('Symbol outside mask safe area')
        }
      }
  })
  it('アプリ本体のロゴは原本を維持する', async () => {
    const [logo, original] = await Promise.all([
      readFile('public/logo.png'),
      readFile('POMOLOG_icon.png'),
    ])
    expect(logo.equals(original)).toBe(true)
  })
})
