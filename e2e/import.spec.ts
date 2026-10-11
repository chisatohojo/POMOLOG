import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { seeded } from './fixtures'
import { installPausedClock } from './clock'
import { learningFromIds, mutateItems } from '../src/domain/learning'
import { importBackupKey } from '../src/data/repository'
import { transition } from '../src/domain/model'
import type { AppDocument } from '../src/domain/model'

const data = (page: Page): Promise<AppDocument> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('pomolog.document')!))
const rawData = (page: Page) => page.evaluate(() => localStorage.getItem('pomolog.document'))
const dialog = (page: Page) => page.getByRole('dialog', { name: 'データを読み込む', exact: true })
const confirm = (page: Page) => dialog(page).getByRole('button', { name: '確認して取り込む' })
function source() {
  const doc = structuredClone(seeded)
  for (const [id, level, parentId, name] of [
    ['import-subject', 'subject', null, '資格学習'],
    ['import-middle', 'middle', 'import-subject', '基礎知識'],
    ['import-small', 'small', 'import-middle', '練習問題'],
  ] as const)
    doc.items = mutateItems(doc.items, { type: 'item-add', id, level, parentId, name }, 0)
  doc.sessions[0].memo = '同じIDの異なるメモは上書き禁止'
  const learning = learningFromIds(doc.items, 'import-subject', 'import-middle', 'import-small')
  doc.sessions.push(
    { ...doc.sessions[0], id: 'import-new', learning, memo: 'バックアップから復元' },
    { ...doc.sessions[0], id: 'import-deleted', learning, deletedAt: 1_800_001_200_001 },
  )
  return doc
}
async function choose(page: Page, value: unknown, name = 'backup.json') {
  await dialog(page)
    .getByLabel('JSONファイル（5MB以下）')
    .setInputFiles({
      name,
      mimeType: 'application/json',
      buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
    })
}
async function backup(page: Page) {
  const pending = page.waitForEvent('download')
  await dialog(page).getByRole('button', { name: 'バックアップを書き出す', exact: true }).click()
  const download = await pending
  return JSON.parse(await readFile((await download.path())!, 'utf8')) as AppDocument
}
test.beforeEach(async ({ page }) => {
  await installPausedClock(page, new Date('2027-01-02T12:00:00+09:00'))
  await page.addInitScript((doc) => {
    if (!localStorage.getItem('pomolog.document'))
      localStorage.setItem('pomolog.document', JSON.stringify(doc))
  }, seeded)
  await page.goto('/')
  await expect(page.getByRole('button', { name: '集中をはじめる' })).toBeEnabled()
})
async function open(page: Page) {
  await page
    .getByRole('button', { name: 'データを読み込む', exact: true })
    .filter({ visible: true })
    .click()
}

test('プレビュー・バックアップ・追加取り込み・再読込で既存記録と進行中タイマーを保全する', async ({
  page,
}, info) => {
  await page.getByRole('button', { name: '集中をはじめる' }).click()
  await page.getByRole('button', { name: /^正解/ }).click()
  const before = await data(page)
  const raw = await rawData(page)
  await open(page)
  const incoming = transition(source(), { type: 'start', id: 'file-timer' }, Date.now())
  await choose(page, incoming)
  await expect(dialog(page).getByTestId('import-counts')).toHaveText(
    '追加 2件（削除済み 1件） / 重複スキップ 1件 / 学習項目追加 3件',
  )
  await expect(dialog(page)).toContainText('ファイル内の進行中セット1件は取り込み対象外')
  await expect(dialog(page)).toContainText('資格学習')
  await expect(confirm(page)).toBeDisabled()
  expect(await rawData(page)).toBe(raw)
  expect(await backup(page)).toEqual(before)
  await expect(confirm(page)).toBeEnabled()
  await expect(confirm(page)).toBeInViewport()
  expect(await dialog(page).evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  await page.screenshot({ path: `test-results/${info.project.name}-import.png` })
  await confirm(page).click()
  await expect(dialog(page)).toHaveCount(0)
  const after = await data(page)
  expect(after.revision).toBe(before.revision + 1)
  expect(after.sessions).toHaveLength(3)
  expect(after.sessions[0]).toEqual(before.sessions[0])
  expect(after.timer).toEqual(before.timer)
  expect(after.selection).toEqual(before.selection)
  expect(after.sessions.find((record) => record.id === 'import-new')).toEqual(incoming.sessions[1])
  expect(await page.evaluate((key) => localStorage.getItem(key), importBackupKey(raw!))).toBe(raw)
  await page.reload()
  await expect(page.getByRole('button', { name: '一時停止', exact: true })).toBeEnabled()
  expect((await data(page)).sessions).toEqual(after.sessions)
  await page.getByRole('button', { name: /^学習履歴/ }).click()
  await expect(page.locator('.history-entry')).toHaveCount(2)
  await page.getByLabel('絞り込み教科').selectOption('import-subject')
  await page.getByLabel('絞り込み中項目').selectOption('import-middle')
  await page.getByLabel('絞り込み小項目').selectOption('import-small')
  await expect(page.locator('.history-entry')).toHaveCount(1)
  await page.getByRole('button', { name: '削除済み', exact: true }).click()
  await expect(page.locator('.history-entry')).toHaveCount(1)
})

test('全件重複では確定できず、取消でも元データを変更しない', async ({ page }) => {
  const raw = await rawData(page)
  await open(page)
  await choose(page, seeded)
  await expect(dialog(page)).toContainText('追加できるデータはありません')
  await expect(confirm(page)).toBeDisabled()
  await dialog(page).getByRole('button', { name: 'キャンセル', exact: true }).click()
  expect(await rawData(page)).toBe(raw)
})

for (const version of [1, 2])
  test(`v${version}のバックアップを検証・変換して取り込める`, async ({ page }) => {
    const original = source()
    const learning = (value: typeof original.selection) =>
      version === 1 ? { subject: value.subject, middle: value.middle, small: value.small } : value
    const old = {
      ...original,
      schemaVersion: version,
      selection: learning(original.selection),
      sessions: original.sessions.map(({ deletedAt: _deletedAt, ...session }) => ({
        ...session,
        learning: learning(session.learning),
      })),
    }
    await open(page)
    await choose(page, '\uFEFF' + JSON.stringify(old), `v${version}.json`)
    await expect(dialog(page)).toContainText(`保存形式 v${version} → v3に変換`)
    await backup(page)
    await confirm(page).click()
    await expect(dialog(page)).toHaveCount(0)
    const after = await data(page)
    expect(after.schemaVersion).toBe(3)
    expect(after.sessions).toHaveLength(3)
    expect(after.sessions[0]).toEqual(seeded.sessions[0])
    expect(after.sessions.find((session) => session.id === 'import-new')?.memo).toBe(
      'バックアップから復元',
    )
  })

test('破損・不正schema・項目競合・容量超過で既存データを書き換えず、古いプレビューを残さない', async ({
  page,
}) => {
  const raw = await rawData(page)
  await open(page)
  await choose(page, source())
  await expect(dialog(page).getByTestId('import-counts')).toBeVisible()
  const invalid = source()
  invalid.sessions[1].learning.subjectId = 'missing'
  const conflict = source()
  conflict.items.find((item) => item.id === 'existing-middle')!.parentId = conflict.items[1].id
  // Keep incoming hierarchy valid while colliding with the current master.
  conflict.sessions[0].learning = learningFromIds(
    conflict.items,
    conflict.items[1].id,
    'existing-middle',
    'existing-small',
  )
  for (const [payload, message] of [
    ['{"schemaVersion":', 'JSONを読み取れません'],
    [{ schemaVersion: 99 }, '未対応'],
    [invalid, '不正'],
    [conflict, '階層・親'],
    [' '.repeat(5 * 1024 * 1024 + 1), '5MB'],
  ] as const) {
    await choose(page, payload)
    await expect(dialog(page).getByRole('alert')).toContainText(message)
    await expect(confirm(page)).toBeDisabled()
    expect(await rawData(page)).toBe(raw)
  }
})

test('ダウンロード・内部バックアップ・本体保存の失敗時も保持し、再試行できる', async ({ page }) => {
  const raw = await rawData(page)
  await open(page)
  await choose(page, source())
  await page.evaluate(() => {
    const original = URL.createObjectURL
    URL.createObjectURL = () => {
      throw new Error('download blocked')
    }
    ;(window as unknown as { restoreDownload: () => void }).restoreDownload = () => {
      URL.createObjectURL = original
    }
  })
  await dialog(page).getByRole('button', { name: 'バックアップを書き出す', exact: true }).click()
  await expect(dialog(page).getByRole('alert')).toContainText('書き出せませんでした')
  await expect(confirm(page)).toBeDisabled()
  await page.evaluate(() =>
    (window as unknown as { restoreDownload: () => void }).restoreDownload(),
  )
  expect(await backup(page)).toEqual(JSON.parse(raw!))
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    const flags = { mode: 'backup' }
    ;(window as unknown as { importFailure: typeof flags }).importFailure = flags
    Storage.prototype.setItem = function (key, value) {
      if (
        (flags.mode === 'backup' && key.startsWith('pomolog.backup.import.')) ||
        (flags.mode === 'main' && key === 'pomolog.document')
      )
        throw new Error('容量不足テスト')
      original.call(this, key, value)
    }
  })
  for (const mode of ['backup', 'main']) {
    await page.evaluate((mode) => {
      ;(window as unknown as { importFailure: { mode: string } }).importFailure.mode = mode
    }, mode)
    await confirm(page).click()
    await expect(dialog(page).getByRole('alert')).toContainText('容量不足テスト')
    expect(await rawData(page)).toBe(raw)
    await expect(confirm(page)).toBeEnabled()
  }
  await page.evaluate(() => {
    ;(window as unknown as { importFailure: { mode: string } }).importFailure.mode = 'none'
  })
  await confirm(page).click()
  await expect(dialog(page)).toHaveCount(0)
  expect((await data(page)).sessions).toHaveLength(3)
})

test('非所有タブは取り込めず、引継ぎ後のrevision変更で再バックアップを要求する', async ({
  page,
  context,
}) => {
  await page.getByRole('button', { name: '集中をはじめる' }).click()
  await open(page)
  await choose(page, source())
  await backup(page)
  const waiter = await context.newPage()
  await waiter.goto('/')
  await expect(
    waiter.getByRole('button', { name: 'データを読み込む', exact: true }).filter({ visible: true }),
  ).toBeDisabled()
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  await expect(confirm(page)).toBeDisabled()
  await expect(waiter.getByRole('button', { name: /^正解/ })).toBeEnabled()
  await waiter.getByRole('button', { name: /^正解/ }).click()
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  )
  await waiter.close()
  await expect(
    dialog(page).getByRole('button', { name: 'バックアップを書き出す', exact: true }),
  ).toBeEnabled()
  await expect(dialog(page).getByRole('alert')).toContainText('再確認')
  await expect(confirm(page)).toBeDisabled()
  const refreshed = await backup(page)
  expect(refreshed.timer?.correct).toBe(1)
  await confirm(page).click()
  await expect(dialog(page)).toHaveCount(0)
  expect((await data(page)).timer?.correct).toBe(1)
  expect((await data(page)).sessions).toHaveLength(3)
})

test('favicon・Apple・manifestが文字なしシンボルを参照する', async ({ page, request }, info) => {
  await expect(page.locator('link[rel="icon"][sizes="16x16"]')).toHaveAttribute(
    'href',
    '/icons/icon-16.png',
  )
  await expect(page.locator('link[rel="icon"][sizes="32x32"]')).toHaveAttribute(
    'href',
    '/icons/icon-32.png',
  )
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/icons/icon-180.png',
  )
  for (const file of [
    'icon-16.png',
    'icon-32.png',
    'icon-180.png',
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-512.png',
  ]) {
    const response = await request.get(`/icons/${file}`)
    expect(response.status()).toBe(200)
    expect((await response.body()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  }
  if (info.project.name !== 'dev-chrome') {
    const manifest = await (await request.get('/manifest.webmanifest')).json()
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icons/icon-192.png', purpose: 'any' }),
        expect.objectContaining({ src: '/icons/icon-512.png', purpose: 'any' }),
        expect.objectContaining({ src: '/icons/icon-maskable-512.png', purpose: 'maskable' }),
      ]),
    )
  }
  await expect(page.locator('.brand img')).toHaveAttribute('src', '/logo.png')
})
