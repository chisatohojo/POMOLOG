import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { AppDocument } from '../src/domain/model'
import { seeded } from './fixtures'

async function data(page: Page): Promise<AppDocument> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('pomolog.document')!))
}
async function manager(page: Page) {
  await page.getByRole('button', { name: '学習項目管理', exact: true }).click()
}
async function timer(page: Page) {
  await page.getByRole('button', { name: '集中タイマー', exact: true }).click()
}
async function add(page: Page, level: string, name: string) {
  await page.getByLabel(`新しい${level}`, { exact: true }).fill(name)
  await page.getByRole('button', { name: `${level}を追加`, exact: true }).click()
}
async function rename(page: Page, name: string, next: string) {
  await page.getByRole('button', { name: `${name}を改名`, exact: true }).click()
  await page.getByLabel('新しい名称', { exact: true }).fill(next)
  await page.getByRole('button', { name: '変更', exact: true }).click()
}

test('任意の3階層を管理し、学習中に選択・改名・アーカイブしても記録を保持する', async ({
  page,
}, info) => {
  await page.clock.install({ time: new Date('2026-10-11T00:00:00Z') })
  await page.clock.pauseAt(new Date('2026-10-11T00:00:00Z'))
  await page.goto('/')
  await expect(page.getByRole('button', { name: '集中をはじめる' })).toBeEnabled()
  await expect(page.getByLabel('小項目', { exact: true })).toBeDisabled()
  await manager(page)
  await add(page, '教科', '資格学習')
  await page.getByRole('button', { name: '資格学習', exact: true }).click()
  await add(page, '中項目', '基礎理論')
  await add(page, '中項目', '実践')
  await page.getByRole('button', { name: '実践を上へ', exact: true }).click()
  await expect(
    page.getByRole('region', { name: '中項目管理', exact: true }).locator('.master-name'),
  ).toHaveText(['実践', '基礎理論'])
  await page.getByRole('button', { name: '基礎理論', exact: true }).click()
  await add(page, '小項目', '用語')
  await add(page, '小項目', '計算')
  await page.getByRole('button', { name: '計算を上へ', exact: true }).click()
  await expect(
    page.getByRole('region', { name: '小項目管理', exact: true }).locator('.master-name'),
  ).toHaveText(['計算', '用語'])
  await page.getByRole('button', { name: '資格学習を上へ', exact: true }).click()
  await rename(page, '用語', '重要用語')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const boxes = await page
    .locator('.master-column')
    .evaluateAll((elements) =>
      elements.map((el) => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y })),
    )
  if (info.project.name === 'mobile') expect(boxes[1].y).toBeGreaterThan(boxes[0].y)
  else expect(boxes[1].x).toBeGreaterThan(boxes[0].x)
  await page.screenshot({ path: `test-results/${info.project.name}-master.png`, fullPage: true })
  await timer(page)
  await page.getByRole('button', { name: '集中をはじめる' }).click()
  await page.clock.fastForward(60_000)
  await page.getByLabel('教科', { exact: true }).selectOption({ label: '資格学習' })
  await page.getByLabel('中項目', { exact: true }).selectOption({ label: '基礎理論' })
  await page.getByLabel('小項目', { exact: true }).selectOption({ label: '重要用語' })
  await page.getByRole('button', { name: /^正解/ }).click()
  await page.getByLabel('学習メモ').fill('項目管理中も維持')
  const before = (await data(page)).timer!
  await manager(page)
  await page.getByRole('button', { name: '資格学習', exact: true }).click()
  await page.getByRole('button', { name: '基礎理論', exact: true }).click()
  await rename(page, '資格学習', '資格対策')
  await rename(page, '基礎理論', '基本理論')
  await rename(page, '重要用語', '必須用語')
  await page.getByRole('button', { name: '資格対策をアーカイブ', exact: true }).click()
  await timer(page)
  await expect(page.getByTestId('elapsed')).toHaveText('01:00')
  await expect(page.getByLabel('教科', { exact: true })).toContainText('資格対策（アーカイブ済み）')
  await page.getByRole('button', { name: 'このセットを終了' }).click()
  await page.getByRole('button', { name: 'この内容で保存する' }).click()
  await expect(page.locator('.session-row')).toContainText('資格学習 / 基礎理論 / 重要用語')
  expect((await data(page)).sessions[0]).toMatchObject({
    learning: before.learning,
    correct: 1,
    memo: '項目管理中も維持',
    focusMs: 60_000,
  })
  await manager(page)
  await page.getByLabel('アーカイブ済みも表示').check()
  await page.getByRole('button', { name: '資格対策を復元', exact: true }).click()
  await timer(page)
  await page.getByLabel('教科', { exact: true }).selectOption({ label: '資格対策' })
  await page.getByLabel('中項目', { exact: true }).selectOption({ label: '基本理論' })
  await page.getByLabel('小項目', { exact: true }).selectOption({ label: '必須用語' })
  await page.getByLabel('中項目', { exact: true }).selectOption({ label: '実践' })
  await expect(page.getByLabel('小項目', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('小項目', { exact: true }).locator('option')).toHaveText([
    '未選択（任意）',
  ])
  await page.getByLabel('教科', { exact: true }).selectOption({ label: '英語' })
  await expect(page.getByLabel('中項目', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('中項目', { exact: true }).locator('option')).toHaveText([
    '未選択（任意）',
  ])
  await page.reload()
  await expect(page.getByRole('button', { name: '集中をはじめる' })).toBeEnabled()
  expect((await data(page)).sessions[0].learning).toEqual(before.learning)
})

test('テンプレートは選択分だけ登録し、改名・アーカイブ・再追加でも重複しない', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '集中をはじめる' })).toBeEnabled()
  await manager(page)
  await expect(page.getByRole('button', { name: '選択したテンプレートを追加' })).toBeDisabled()
  await page.getByLabel('数学 · 高校基礎', { exact: false }).check()
  await page.getByRole('button', { name: '選択したテンプレートを追加' }).click()
  const original = await data(page)
  expect(original.items.filter((item) => item.level === 'middle')).toHaveLength(2)
  await page.getByRole('button', { name: '数学Ⅰ', exact: true }).click()
  await rename(page, '数学Ⅰ', '自分の数学Ⅰ')
  await page.getByRole('button', { name: '二次関数をアーカイブ', exact: true }).click()
  const edited = await data(page)
  await page.getByRole('button', { name: '選択したテンプレートを追加' }).click()
  expect((await data(page)).items).toEqual(edited.items)
  await timer(page)
  await page.getByLabel('中項目', { exact: true }).selectOption({ label: '自分の数学Ⅰ' })
  await expect(page.getByLabel('小項目', { exact: true }).locator('option')).not.toContainText([
    '二次関数',
  ])
  await page.getByLabel('教科', { exact: true }).selectOption({ label: '英語' })
  await expect(page.getByLabel('中項目', { exact: true }).locator('option')).toHaveText([
    '未選択（任意）',
  ])
})

test('旧データを原文退避して移行し、再読込・権限引継ぎで複製や履歴変更をしない', async ({
  page,
  context,
}) => {
  const legacy = {
    schemaVersion: 1,
    revision: 17,
    selection: { subject: '英語', middle: '文法', small: '時制' },
    timer: null,
    sessions: seeded.sessions.map((session) => ({
      ...session,
      learning: {
        subject: session.learning.subject,
        middle: session.learning.middle,
        small: session.learning.small,
      },
    })),
  }
  const raw = JSON.stringify(legacy, null, 2)
  await page.addInitScript((raw) => {
    if (!localStorage.getItem('pomolog.document')) localStorage.setItem('pomolog.document', raw)
  }, raw)
  await page.goto('/')
  await expect(page.getByRole('button', { name: '集中をはじめる' })).toBeEnabled()
  const migrated = await data(page)
  expect(migrated.schemaVersion).toBe(2)
  expect(migrated.revision).toBe(18)
  expect(migrated.sessions[0]).toMatchObject(legacy.sessions[0])
  const backups = () =>
    page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith('pomolog.backup.v1.'))
        .map((key) => localStorage.getItem(key)),
    )
  expect(await backups()).toEqual([raw])
  await page.reload()
  await expect(page.getByRole('button', { name: '集中をはじめる' })).toBeEnabled()
  expect(await data(page)).toEqual(migrated)
  const waiting = await context.newPage()
  await waiting.goto('/')
  await expect(waiting.getByRole('alert')).toContainText('編集権限を待っています')
  await page.close()
  await expect(waiting.getByRole('button', { name: '集中をはじめる' })).toBeEnabled()
  expect(await data(waiting)).toEqual(migrated)
  await waiting.getByRole('button', { name: '集中をはじめる' }).click()
  expect((await data(waiting)).timer?.learning).toEqual(migrated.selection)
  expect(
    await waiting.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith('pomolog.backup.v1.'))
        .map((key) => localStorage.getItem(key)),
    ),
  ).toEqual([raw])
})

test('待機タブは旧形式を移行せず、ロック取得後に一度だけ移行する', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '集中をはじめる' })).toBeEnabled()
  const legacy = {
    schemaVersion: 1,
    revision: 5,
    selection: { subject: '数学', middle: '', small: '' },
    timer: null,
    sessions: [],
  }
  const raw = JSON.stringify(legacy)
  // Seed while the first tab owns the lock; the waiting tab must stay read-only.
  await page.evaluate((raw) => localStorage.setItem('pomolog.document', raw), raw)
  const waiting = await context.newPage()
  await waiting.goto('/')
  await expect(waiting.getByRole('alert')).toContainText('編集権限を待っています')
  expect(await waiting.evaluate(() => localStorage.getItem('pomolog.document'))).toBe(raw)
  expect(
    await waiting.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('pomolog.backup.')),
    ),
  ).toEqual([])
  await page.close()
  await expect(waiting.getByRole('button', { name: '集中をはじめる' })).toBeEnabled()
  expect((await data(waiting)).revision).toBe(6)
  expect((await data(waiting)).schemaVersion).toBe(2)
})

test('旧形式の進行中セットを移行し、計測・カウント・終了保存を継続できる', async ({ page }) => {
  const start = new Date('2026-10-11T00:00:00Z').getTime()
  await page.clock.install({ time: new Date(start + 60_000) })
  await page.clock.pauseAt(new Date(start + 60_000))
  const learning = { subject: '独自教科', middle: '', small: '小項目のみ' }
  const legacy = {
    schemaVersion: 1,
    revision: 7,
    selection: learning,
    sessions: [],
    timer: {
      id: 'old-active',
      status: 'running',
      startedAt: start,
      endedAt: null,
      activeSince: start,
      accumulatedMs: 0,
      notificationSent: false,
      learning,
      correct: 2,
      incorrect: 1,
      memo: '移行前のメモ',
      undo: ['correct'],
    },
  }
  const raw = JSON.stringify(legacy)
  await page.addInitScript((raw) => {
    if (!localStorage.getItem('pomolog.document')) localStorage.setItem('pomolog.document', raw)
  }, raw)
  await page.goto('/')
  await expect(page.getByRole('button', { name: '一時停止', exact: true })).toBeEnabled()
  await expect(page.getByTestId('elapsed')).toHaveText('01:00')
  await expect(page.getByLabel('学習メモ')).toHaveValue('移行前のメモ')
  expect((await data(page)).timer).toMatchObject(legacy.timer)
  await page.getByRole('button', { name: '取り消す' }).click()
  await page.clock.fastForward(60_000)
  await page.reload()
  await expect(page.getByTestId('elapsed')).toHaveText('02:00')
  await page.getByRole('button', { name: 'このセットを終了' }).click()
  await page.getByRole('button', { name: 'この内容で保存する' }).click()
  const saved = (await data(page)).sessions[0]
  expect(saved).toMatchObject({
    id: 'old-active',
    correct: 1,
    incorrect: 1,
    memo: '移行前のメモ',
    focusMs: 120_000,
    learning,
  })
  expect(saved.learning.middleId).toBeTruthy()
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith('pomolog.backup.v1.'))
        .map((key) => localStorage.getItem(key)),
    ),
  ).toEqual([raw])
})

test('移行前の退避に失敗したら編集を停止し、原文を保持して再試行できる', async ({ page }) => {
  const raw = JSON.stringify({
    schemaVersion: 1,
    revision: 9,
    selection: { subject: '数学', middle: '', small: '' },
    timer: null,
    sessions: [],
  })
  await page.addInitScript((raw) => {
    if (!localStorage.getItem('pomolog.document')) localStorage.setItem('pomolog.document', raw)
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (
        key.startsWith('pomolog.backup.v1.') &&
        !(window as unknown as { allowBackup: boolean }).allowBackup
      )
        throw new Error('退避に失敗')
      original.call(this, key, value)
    }
  }, raw)
  await page.goto('/')
  await expect(
    page.getByRole('alert').filter({ hasText: '元データは保持されています' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '集中をはじめる' })).toBeDisabled()
  expect(await page.evaluate(() => localStorage.getItem('pomolog.document'))).toBe(raw)
  await page.evaluate(() => {
    ;(window as unknown as { allowBackup: boolean }).allowBackup = true
  })
  await page.getByRole('button', { name: '再試行', exact: true }).click()
  await expect(page.getByRole('button', { name: '集中をはじめる' })).toBeEnabled()
  expect((await data(page)).revision).toBe(10)
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith('pomolog.backup.v1.'))
        .map((key) => localStorage.getItem(key)),
    ),
  ).toEqual([raw])
})
