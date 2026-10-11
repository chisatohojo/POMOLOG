import { test, expect } from '@playwright/test'
import { STORAGE_KEY } from '../src/data/repository'
import { seeded } from './fixtures'
import type { Page } from '@playwright/test'

async function expectOwned(page: Page) {
  await expect(page.locator('.timer-controls button').first()).toBeEnabled()
  await expect
    .poll(async () =>
      page.evaluate(
        async () =>
          (await navigator.locks.query()).held?.filter((lock) => lock.name === 'pomolog-editor')
            .length ?? 0,
      ),
    )
    .toBe(1)
  await expect(page.getByRole('alert')).toHaveCount(0)
}

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(
    ({ key, data }) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, data)
      localStorage.setItem('unrelated-data', 'keep-me')
    },
    { key: STORAGE_KEY, data: JSON.stringify(seeded) },
  )
  await page.goto('/')
  await expectOwned(page)
})

test('単一タブの再読込とStrictModeで自己競合せず、既存データを維持する', async ({ page }) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.reload()
    await expectOwned(page)
  }
  const data = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY)
  expect(data).toEqual(seeded)
  expect(await page.evaluate(() => localStorage.getItem('unrelated-data'))).toBe('keep-me')
})

test('所有タブを閉じると待機タブが自動取得し、最新の学習記録を引き継ぐ', async ({
  page,
  context,
}) => {
  const waiting = await context.newPage()
  await waiting.goto('/')
  await expect(waiting.getByRole('alert')).toContainText('編集権限を待っています')
  await expect(waiting.locator('.timer-controls button').first()).toBeDisabled()
  await page.getByRole('button', { name: '集中をはじめる' }).click()
  await page.getByRole('button', { name: /^正解/ }).click()
  await page.getByLabel('学習メモ').fill('引き継ぐメモ')
  await page.close()
  await expectOwned(waiting)
  await expect(waiting.getByLabel('学習メモ')).toHaveValue('引き継ぐメモ')
  await expect(waiting.locator('.counter.correct strong')).toHaveText('1')
  await waiting.getByRole('button', { name: /^正解/ }).click()
  const data = await waiting.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY)
  expect(data.sessions).toEqual(seeded.sessions)
  expect(data.timer.correct).toBe(2)
})

test('取得待ちタブの終了で古い要求を残さず、次の待機タブを所有者にする', async ({
  page,
  context,
}) => {
  const cancelled = await context.newPage()
  await cancelled.goto('/')
  await expect(cancelled.locator('.timer-controls button').first()).toBeDisabled()
  const third = await context.newPage()
  await third.goto('/')
  await expect(third.locator('.timer-controls button').first()).toBeDisabled()
  await cancelled.close()
  await page.close()
  await expectOwned(third)
})

test('所有タブのレンダラークラッシュ後も自動復旧し、保存内容を保持する', async ({
  page,
  context,
}) => {
  await page.getByRole('button', { name: '集中をはじめる' }).click()
  await page.getByLabel('学習メモ').fill('クラッシュ前のメモ')
  const waiting = await context.newPage()
  await waiting.goto('/')
  await expect(waiting.locator('.timer-controls button').first()).toBeDisabled()
  const cdp = await context.newCDPSession(page)
  const crashed = page.waitForEvent('crash')
  void cdp.send('Page.crash').catch(() => {})
  await crashed
  await expectOwned(waiting)
  await expect(waiting.getByLabel('学習メモ')).toHaveValue('クラッシュ前のメモ')
  expect(
    (await waiting.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY)).sessions,
  ).toEqual(seeded.sessions)
  await page.close()
})

test('API障害を競合と誤表示せず、編集停止のままデータを保持する', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.locks.request = () =>
      Promise.reject(new DOMException('Policy blocked', 'SecurityError'))
  })
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('編集権限を確認できませんでした')
  await expect(page.locator('.timer-controls button').first()).toBeDisabled()
  await expect(page.getByRole('alert')).not.toContainText('別のタブが編集中')
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY)).toEqual(
    seeded,
  )
})

test('ページ離脱で即座に書込権限を失い、復帰時に再取得して最新データを読み込む', async ({
  page,
  context,
}) => {
  await page.getByRole('button', { name: '集中をはじめる' }).click()
  const waiting = await context.newPage()
  await waiting.goto('/')
  await expect(waiting.locator('.timer-controls button').first()).toBeDisabled()
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
  )
  await expect(page.locator('.timer-controls button').first()).toBeDisabled()
  await expectOwned(waiting)
  await waiting.getByLabel('学習メモ').fill('復帰時の最新メモ')
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  )
  await expect(page.locator('.timer-controls button').first()).toBeDisabled()
  await waiting.close()
  await expectOwned(page)
  await expect(page.getByLabel('学習メモ')).toHaveValue('復帰時の最新メモ')
})

test('ノートPCの主要操作を画面内に収め、タイマー→集計→メモの順に配置する', async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  if (!mobile) await page.setViewportSize({ width: 1366, height: 768 })
  await page.getByRole('button', { name: '集中をはじめる' }).click()
  const timer = (await page.locator('.timer-card').boundingBox())!
  const study = (await page.locator('.study-card').boundingBox())!
  const counter = (await page.locator('.problem-card').boundingBox())!
  const summary = (await page.locator('.stats-grid').boundingBox())!
  const memo = (await page.locator('.memo-card').boundingBox())!
  expect(summary.y).toBeGreaterThan(counter.y + counter.height)
  expect(summary.y).toBeGreaterThan(timer.y + timer.height)
  expect(memo.y).toBeGreaterThan(summary.y + summary.height)
  if (mobile) expect(study.y).toBeGreaterThan(timer.y + timer.height)
  else {
    expect(study.x).toBeGreaterThan(timer.x + timer.width)
    await expect(page.getByRole('button', { name: '一時停止' })).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('button', { name: '休憩する' })).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('button', { name: 'このセットを終了' })).toBeInViewport({
      ratio: 1,
    })
    await page.setViewportSize({ width: 1280, height: 720 })
    await expect(page.getByRole('button', { name: '一時停止' })).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('button', { name: '休憩する' })).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('button', { name: 'このセットを終了' })).toBeInViewport({
      ratio: 1,
    })
    await page.setViewportSize({ width: 1366, height: 768 })
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-phase1.1.png`,
    fullPage: true,
  })
})
