import { installPausedClock } from './clock'
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { historyFixture } from './history-stats.fixture'
import type { AppDocument } from '../src/domain/model'

async function data(page: Page): Promise<AppDocument> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('pomolog.document')!))
}
async function history(page: Page) {
  await page.getByRole('button', { name: /^学習履歴/ }).click()
}
async function stats(page: Page) {
  await page.getByRole('button', { name: '学習統計', exact: true }).click()
}
const entry = (page: Page, id: string) => page.locator(`.history-entry[data-session-id="${id}"]`)

test.beforeEach(async ({ page }) => {
  await installPausedClock(page, new Date('2027-01-02T12:00:00+09:00'))
  await page.addInitScript((doc) => {
    if (!localStorage.getItem('pomolog.document'))
      localStorage.setItem('pomolog.document', JSON.stringify(doc))
  }, historyFixture())
  await page.goto('/')
  await expect(page.getByRole('button', { name: '集中をはじめる' })).toBeEnabled()
})

test('履歴を開始日時順に表示し、期間・階層・キーワード・達成で複合検索できる', async ({ page }) => {
  await history(page)
  await expect(page.locator('.history-entry')).toHaveCount(4)
  expect(
    await page
      .locator('.history-entry')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-session-id'))),
  ).toEqual(['zero', 'editable', 'crossing', 'old'])
  await page.getByLabel('期間の開始日').fill('2027-01-01')
  await page.getByLabel('期間の終了日').fill('2027-01-01')
  await page.getByLabel('絞り込み教科').selectOption({ label: '数学・改名（アーカイブ済み）' })
  await page.getByLabel('絞り込み中項目').selectOption({ label: '数学Ⅰ・改名' })
  await page.getByLabel('絞り込み小項目').selectOption({ label: '二次関数' })
  await page.getByLabel('キーワード').fill('基礎 復習')
  await page.getByLabel('達成判定', { exact: true }).selectOption('achieved')
  await expect(page.locator('.history-entry')).toHaveCount(1)
  await expect(entry(page, 'editable')).toContainText('数学 / 数学Ⅰ / 二次関数')
  await entry(page, 'editable').getByText('詳細を見る', { exact: true }).click()
  await expect(entry(page, 'editable')).toContainText('1 / 9 / 10 問')
  await expect(entry(page, 'editable')).toContainText('基礎復習')
  await page.getByLabel('達成判定', { exact: true }).selectOption('unachieved')
  await expect(page.locator('.history-entry')).toHaveCount(0)
  await page.getByRole('button', { name: '絞り込みを解除' }).click()
  await expect(page.locator('.history-entry')).toHaveCount(4)
  await page.getByLabel('期間の開始日').fill('2027-01-03')
  await page.getByLabel('期間の終了日').fill('2027-01-01')
  await expect(page.getByRole('alert')).toContainText('開始日')
})

test('履歴を編集・再読込し、同じIDの名称スナップショットと作成日時を維持する', async ({ page }) => {
  const original = (await data(page)).sessions.find((session) => session.id === 'editable')!
  await history(page)
  await entry(page, 'editable').getByRole('button', { name: '編集', exact: true }).click()
  await page.getByLabel('開始時刻').fill('2027-01-01T07:00')
  await page.getByLabel('終了時刻').fill('2027-01-01T07:40')
  await page.getByLabel('集中時間（分）').fill('41')
  await page.getByRole('button', { name: '変更を保存する' }).click()
  await expect(page.getByRole('alert')).toContainText('時間以内')
  await page.getByLabel('集中時間（分）').fill('25')
  await page.getByLabel('正解数', { exact: true }).fill('8')
  await page.getByLabel('不正解数', { exact: true }).fill('2')
  await page.getByLabel('メモ', { exact: true }).fill('編集して保存')
  await page.getByRole('button', { name: '変更を保存する' }).click()
  const edited = (await data(page)).sessions.find((session) => session.id === 'editable')!
  expect(edited).toMatchObject({
    id: original.id,
    createdAt: original.createdAt,
    learning: original.learning,
    focusMs: 1500_000,
    correct: 8,
    incorrect: 2,
    memo: '編集して保存',
  })
  expect(edited.updatedAt).toBeGreaterThan(original.updatedAt)
  expect(edited.startedAt).toBe(Date.parse('2027-01-01T07:00:00+09:00'))
  await page.reload()
  await history(page)
  await expect(entry(page, 'editable')).toContainText('25:00')
  await entry(page, 'editable').getByRole('button', { name: '編集', exact: true }).click()
  await page.getByLabel('教科', { exact: true }).selectOption({ label: '英語' })
  await page
    .getByLabel('中項目', { exact: true })
    .selectOption({ label: '英語コミュニケーションⅠ' })
  await page.getByLabel('小項目', { exact: true }).selectOption({ label: '英文読解' })
  await page.getByRole('button', { name: '変更を保存する' }).click()
  expect(
    (await data(page)).sessions.find((session) => session.id === 'editable')?.learning,
  ).toMatchObject({ subject: '英語', middle: '英語コミュニケーションⅠ', small: '英文読解' })
})

test('削除確認の取消・論理削除・復元・全記録のJSON書き出しができる', async ({ page }) => {
  await history(page)
  await entry(page, 'zero').getByRole('button', { name: '削除', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click()
  expect((await data(page)).sessions.find((session) => session.id === 'zero')?.deletedAt).toBeNull()
  await entry(page, 'zero').getByRole('button', { name: '削除', exact: true }).click()
  await page.getByRole('button', { name: '削除する', exact: true }).click()
  await expect(entry(page, 'zero')).toHaveCount(0)
  const deleted = (await data(page)).sessions.find((session) => session.id === 'zero')!
  expect(deleted.deletedAt).not.toBeNull()
  await stats(page)
  await expect(page.getByTestId('stats-focus')).toContainText('0分')
  await page.reload()
  await history(page)
  await page.getByRole('button', { name: '削除済み', exact: true }).click()
  await expect(page.locator('.history-entry')).toHaveCount(2)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'データを書き出す' }).filter({ visible: true }).click(),
  ])
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8')) as AppDocument
  expect(exported.schemaVersion).toBe(3)
  expect(exported.sessions).toHaveLength(5)
  expect(exported.items).toEqual((await data(page)).items)
  expect(exported.sessions.find((session) => session.id === 'zero')?.deletedAt).toBe(
    deleted.deletedAt,
  )
  await entry(page, 'zero').getByRole('button', { name: '復元', exact: true }).click()
  await expect(entry(page, 'zero')).toHaveCount(0)
  await stats(page)
  await expect(page.getByTestId('stats-focus')).toContainText('20分')
  await page.getByRole('button', { name: '集中タイマー', exact: true }).click()
  await expect(page.getByRole('region', { name: '本日の保存済み記録' })).toContainText('20分')
})

test('期間・階層別の加重集計と問題数0を表示し、グラフが画面内に収まる', async ({ page }, info) => {
  await page.getByRole('button', { name: '集中をはじめる' }).click()
  await page.clock.fastForward(60_000)
  await stats(page)
  await expect(page.getByTestId('stats-focus')).toContainText('20分')
  await expect(page.getByTestId('stats-sets')).toContainText('1セッション')
  await expect(page.getByTestId('stats-questions')).toContainText('0問')
  await expect(page.getByTestId('stats-questions')).toContainText('—')
  await page.getByRole('button', { name: '今週', exact: true }).click()
  await expect(page.getByTestId('stats-focus')).toContainText('70分')
  await expect(page.getByTestId('stats-sets')).toContainText('3セッション')
  await expect(page.getByTestId('stats-questions')).toContainText('50%')
  await page.getByRole('button', { name: '今月', exact: true }).click()
  await expect(page.getByTestId('stats-focus')).toContainText('50分')
  await expect(page.getByTestId('stats-questions')).toContainText('10%')
  await page.getByRole('button', { name: '全期間', exact: true }).click()
  await expect(page.getByTestId('stats-focus')).toContainText('110分')
  await expect(page.getByRole('region', { name: '学習項目別集計' })).toContainText('数学・改名')
  await expect(page.getByRole('region', { name: '学習項目別集計' })).toContainText('アーカイブ済み')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  for (const box of await page.locator('.chart-card').evaluateAll((nodes) =>
    nodes.map((node) => ({
      left: node.getBoundingClientRect().left,
      right: node.getBoundingClientRect().right,
      viewport: innerWidth,
    })),
  )) {
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(box.viewport)
  }
  await page.screenshot({
    path: `test-results/${info.project.name}-statistics.png`,
    fullPage: true,
  })
  await page.getByLabel('絞り込み教科').selectOption({ label: '数学・改名（アーカイブ済み）' })
  await expect(page.getByTestId('stats-focus')).toContainText('90分')
  await page.getByLabel('絞り込み中項目').selectOption({ label: '数学Ⅰ・改名' })
  await expect(page.getByTestId('stats-focus')).toContainText('50分')
  await page.getByLabel('絞り込み小項目').selectOption({ label: '二次関数' })
  await expect(page.getByTestId('stats-focus')).toContainText('50分')
  await page.getByRole('button', { name: '集中タイマー', exact: true }).click()
  await expect(page.getByTestId('elapsed')).toHaveText('01:00')
})

test('別タブの更新・削除・復元を防止し、引継ぎ後の古い編集フォームも拒否する', async ({
  page,
  context,
}) => {
  await history(page)
  await entry(page, 'editable').getByRole('button', { name: '編集', exact: true }).click()
  await page.getByLabel('メモ', { exact: true }).fill('古いフォーム')
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  const owner = await context.newPage()
  await owner.goto('/')
  await history(owner)
  await expect(
    entry(owner, 'editable').getByRole('button', { name: '編集', exact: true }),
  ).toBeEnabled()
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  )
  await expect(page.getByRole('button', { name: '変更を保存する' })).toBeDisabled()
  await entry(owner, 'editable').getByRole('button', { name: '編集', exact: true }).click()
  await owner.getByLabel('メモ', { exact: true }).fill('最新のフォーム')
  await owner.getByRole('button', { name: '変更を保存する' }).click()
  await owner.close()
  await expect(page.getByRole('button', { name: '変更を保存する' })).toBeEnabled()
  await page.getByRole('button', { name: '変更を保存する' }).click()
  await expect(page.getByRole('alert').filter({ hasText: '更新されています' })).toBeVisible()
  expect((await data(page)).sessions.find((session) => session.id === 'editable')?.memo).toBe(
    '最新のフォーム',
  )
  await page.getByRole('button', { name: '編集を閉じる' }).click()
  const waiting = await context.newPage()
  await waiting.goto('/')
  await history(waiting)
  await expect(
    entry(waiting, 'editable').getByRole('button', { name: '削除', exact: true }),
  ).toBeDisabled()
  await waiting.getByRole('button', { name: '削除済み', exact: true }).click()
  await expect(
    entry(waiting, 'deleted').getByRole('button', { name: '復元', exact: true }),
  ).toBeDisabled()
})

test('v2原文と旧バックアップを保持してv3へ移行し、待機タブは書き込まない', async ({
  page,
  context,
}) => {
  const current = await data(page)
  const v2 = {
    ...current,
    schemaVersion: 2,
    sessions: current.sessions
      .filter((session) => session.deletedAt === null)
      .map(({ deletedAt: _deleted, ...session }) => session),
  }
  const raw = JSON.stringify(v2, null, 2)
  await page.evaluate((raw) => {
    localStorage.setItem('pomolog.document', raw)
    localStorage.setItem('pomolog.backup.v1.previous', '古い原文')
  }, raw)
  const waiting = await context.newPage()
  await waiting.goto('/')
  await expect(waiting.getByRole('alert')).toContainText('編集権限を待っています')
  expect(await waiting.evaluate(() => localStorage.getItem('pomolog.document'))).toBe(raw)
  await page.close()
  await expect(waiting.getByRole('button', { name: '集中をはじめる' })).toBeEnabled()
  const migrated = await data(waiting)
  expect(migrated.schemaVersion).toBe(3)
  expect(migrated.sessions.every((session) => session.deletedAt === null)).toBe(true)
  expect(migrated.items).toEqual(v2.items)
  expect(migrated.sessions.map((session) => session.learning)).toEqual(
    v2.sessions.map((session) => session.learning),
  )
  expect(
    await waiting.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith('pomolog.backup.v2.'))
        .map((key) => localStorage.getItem(key)),
    ),
  ).toEqual([raw])
  expect(await waiting.evaluate(() => localStorage.getItem('pomolog.backup.v1.previous'))).toBe(
    '古い原文',
  )
  await waiting.reload()
  await expect(waiting.getByRole('button', { name: '集中をはじめる' })).toBeEnabled()
  expect(await data(waiting)).toEqual(migrated)
})

test('履歴の編集・削除・復元で保存が失敗しても元記録と入力を保持して再試行できる', async ({
  page,
}) => {
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'pomolog.document' && (window as unknown as { failWrites: boolean }).failWrites)
        throw new Error('容量不足')
      original.call(this, key, value)
    }
    ;(window as unknown as { failWrites: boolean }).failWrites = true
  })
  const original = (await data(page)).sessions.find((session) => session.id === 'editable')!
  await history(page)
  await entry(page, 'editable').getByRole('button', { name: '編集', exact: true }).click()
  await page.getByLabel('メモ', { exact: true }).fill('失敗後も残る入力')
  await page.getByRole('button', { name: '変更を保存する' }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: '入力内容は保持しています' }),
  ).toBeVisible()
  await expect(page.getByLabel('メモ', { exact: true })).toHaveValue('失敗後も残る入力')
  expect((await data(page)).sessions.find((session) => session.id === 'editable')).toEqual(original)
  await page.evaluate(() => {
    ;(window as unknown as { failWrites: boolean }).failWrites = false
  })
  await page.getByRole('button', { name: '変更を保存する' }).click()
  await entry(page, 'editable').getByRole('button', { name: '削除', exact: true }).click()
  await page.evaluate(() => {
    ;(window as unknown as { failWrites: boolean }).failWrites = true
  })
  await page.getByRole('button', { name: '削除する', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('記録は保持されています')
  expect(
    (await data(page)).sessions.find((session) => session.id === 'editable')?.deletedAt,
  ).toBeNull()
  await page.evaluate(() => {
    ;(window as unknown as { failWrites: boolean }).failWrites = false
  })
  await page.getByRole('button', { name: '削除する', exact: true }).click()
  await page.getByRole('button', { name: '削除済み', exact: true }).click()
  await page.evaluate(() => {
    ;(window as unknown as { failWrites: boolean }).failWrites = true
  })
  await entry(page, 'editable').getByRole('button', { name: '復元', exact: true }).click()
  expect(
    (await data(page)).sessions.find((session) => session.id === 'editable')?.deletedAt,
  ).not.toBeNull()
  await expect(entry(page, 'editable')).toBeVisible()
  await page.evaluate(() => {
    ;(window as unknown as { failWrites: boolean }).failWrites = false
  })
  await entry(page, 'editable').getByRole('button', { name: '復元', exact: true }).click()
  await expect(entry(page, 'editable')).toHaveCount(0)
  expect((await data(page)).sessions.find((session) => session.id === 'editable')).toMatchObject({
    id: original.id,
    createdAt: original.createdAt,
    memo: '失敗後も残る入力',
    deletedAt: null,
  })
})
