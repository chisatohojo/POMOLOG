import { chromium, expect, test } from '@playwright/test'
import { seeded } from './fixtures'
import { STORAGE_KEY } from '../src/data/repository'

test('通常版Chromeのブラウザ全体がクラッシュしても同じプロファイルで編集を再開できる', async ({
  baseURL,
}, testInfo) => {
  test.setTimeout(60000)
  // This generated profile is isolated from the user's real Chrome profile.
  const profile = testInfo.outputPath('isolated-chrome-profile')
  const options = { channel: 'chrome', headless: true }
  const initial = await chromium.launchPersistentContext(profile, options)
  try {
    const page = await initial.newPage()
    await page.goto(baseURL!)
    await expect(page.locator('.start-button')).toBeEnabled()
    await page.evaluate(({ key, data }) => localStorage.setItem(key, data), {
      key: STORAGE_KEY,
      data: JSON.stringify(seeded),
    })
  } finally {
    await initial.close()
  }

  const crashing = await chromium.launchPersistentContext(profile, options)
  try {
    const page = await crashing.newPage()
    await page.goto(baseURL!)
    await expect(page.locator('.start-button')).toBeEnabled()
    const browser = crashing.browser()!
    const disconnected = new Promise<void>((resolve) =>
      browser.once('disconnected', () => resolve()),
    )
    const cdp = await browser.newBrowserCDPSession()
    void cdp.send('Browser.crash').catch(() => {})
    await disconnected
  } finally {
    await crashing.close().catch(() => {})
  }

  const recovered = await chromium.launchPersistentContext(profile, options)
  try {
    const page = await recovered.newPage()
    await page.goto(baseURL!)
    await expect(page.locator('.start-button')).toBeEnabled()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY),
    ).toEqual(seeded)
    await page.getByRole('button', { name: '集中をはじめる' }).click()
    await expect(page.getByRole('button', { name: '一時停止' })).toBeEnabled()
  } finally {
    await recovered.close()
  }
})
