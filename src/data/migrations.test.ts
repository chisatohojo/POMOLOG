import { describe, expect, it, vi } from 'vitest'
import { LocalRepository, STORAGE_KEY, decodeDocument, migrationBackupKey } from './repository'
import { migrateV1, migrateV2 } from './migrations'
import { AppStore } from '../app/store'
import { elapsedMs } from '../domain/model'

function legacy() {
  const learning = { subject: '独自教科', middle: '  基礎  ', small: 'ＡＢＣ' }
  const record = { learning, correct: 3, incorrect: 2, memo: '消してはいけないメモ' }
  return {
    schemaVersion: 1,
    revision: 42,
    selection: learning,
    timer: {
      ...record,
      id: 'active',
      status: 'paused',
      startedAt: 1000,
      endedAt: null,
      activeSince: null,
      accumulatedMs: 1200_000,
      notificationSent: true,
      undo: ['correct', 'incorrect'],
    },
    sessions: [
      {
        ...record,
        id: 'history',
        startedAt: 1000,
        endedAt: 1201_000,
        focusMs: 1200_000,
        createdAt: 1201_000,
        updatedAt: 1201_000,
      },
      {
        ...record,
        id: 'same-path',
        learning: { ...learning, middle: '基礎', small: 'ABC' },
        startedAt: 2000,
        endedAt: 3000,
        focusMs: 500,
        createdAt: 3000,
        updatedAt: 3000,
      },
    ],
  }
}
function memory(raw: string) {
  const data = new Map([[STORAGE_KEY, raw]])
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value)
    }),
  }
  return { data, storage, repository: new LocalRepository(storage) }
}

describe('v1からv2への移行・原文保全', () => {
  it('全記録の名称・時刻・問題数・メモ・タイマー状態を保持し、決定的IDで再実行できる', () => {
    const old = legacy()
    const raw = JSON.stringify(old)
    const next = migrateV1(old)
    expect(JSON.stringify(old)).toBe(raw)
    expect(migrateV1(old)).toEqual(next)
    expect(decodeDocument(JSON.stringify(next))).toEqual(migrateV2(next))
    expect(next.schemaVersion).toBe(2)
    expect(next.revision).toBe(42)
    expect(next.timer).toMatchObject(old.timer)
    next.sessions.forEach((session, i) => expect(session).toMatchObject(old.sessions[i]))
    expect(next.sessions[0].learning.smallId).toBe(next.sessions[1].learning.smallId)
    expect(next.selection.subjectId).toBe(next.sessions[0].learning.subjectId)
    expect(next.items.filter((item) => item.name === '基礎')).toHaveLength(1)
    expect(elapsedMs(next.timer, 9999_000)).toBe(1200_000)
  })
  it('同名でも親が違えば別IDとし、小項目だけの旧記録には中項目を補う', () => {
    const old = legacy()
    old.selection = { subject: '別教科', middle: '基礎', small: 'ABC' }
    old.sessions[1].learning = { subject: '独自教科', middle: '', small: '小項目だけ' }
    const next = migrateV1(old)
    expect(next.selection.middleId).not.toBe(next.sessions[0].learning.middleId)
    const migrated = next.sessions[1].learning
    expect(migrated.middle).toBe('')
    expect(next.items.find((item) => item.id === migrated.middleId)?.name).toBe(
      '未分類（旧データ）',
    )
    expect(next.items.find((item) => item.id === migrated.smallId)?.parentId).toBe(
      migrated.middleId,
    )
  })
  it('すべてのタイマー状態を保持する', () => {
    for (const status of ['running', 'paused', 'break', 'review']) {
      const old = legacy()
      const timer = {
        ...old.timer,
        status,
        activeSince: status === 'running' ? 1000 : null,
        endedAt: status === 'review' ? 1201_000 : null,
      }
      expect(migrateV1({ ...old, timer }).timer).toMatchObject(timer)
    }
  })
  it('読み込みでは書かず、編集準備で原文を退避して一度だけ保存する', () => {
    const raw = JSON.stringify(legacy(), null, 2)
    const { repository, storage, data } = memory(raw)
    const read = repository.load()
    expect(storage.setItem).not.toHaveBeenCalled()
    const next = repository.prepareForEditing()
    expect(next).toEqual({ ...read, revision: 43 })
    expect(storage.setItem.mock.calls.map((call) => call[0])).toEqual([
      migrationBackupKey(raw),
      STORAGE_KEY,
    ])
    expect(data.get(migrationBackupKey(raw))).toBe(raw)
    const persisted = data.get(STORAGE_KEY)
    expect(repository.prepareForEditing()).toEqual(next)
    expect(storage.setItem).toHaveBeenCalledTimes(2)
    expect(data.get(STORAGE_KEY)).toBe(persisted)
  })
  it.each(['backup', 'main'])('%s保存の失敗で旧データを上書きせず、再試行できる', (failure) => {
    const raw = JSON.stringify(legacy())
    const { storage, data, repository } = memory(raw)
    storage.setItem.mockImplementation((key, value) => {
      if ((failure === 'main') === (key === STORAGE_KEY)) throw new Error('容量不足')
      data.set(key, value)
    })
    expect(() => repository.prepareForEditing()).toThrow('容量不足')
    expect(data.get(STORAGE_KEY)).toBe(raw)
    if (failure === 'main') expect(data.get(migrationBackupKey(raw))).toBe(raw)
    storage.setItem.mockImplementation((key, value) => {
      data.set(key, value)
    })
    const next = repository.prepareForEditing()
    expect(next.sessions).toHaveLength(2)
    expect(next.revision).toBe(43)
    expect(data.get(migrationBackupKey(raw))).toBe(raw)
  })
  it('退避先の異なる内容を上書きしない', () => {
    const raw = JSON.stringify(legacy())
    const { data, repository } = memory(raw)
    data.set(migrationBackupKey(raw), '別の原文')
    expect(() => repository.prepareForEditing()).toThrow('競合')
    expect(data.get(STORAGE_KEY)).toBe(raw)
    expect(data.get(migrationBackupKey(raw))).toBe('別の原文')
  })
  it('退避中に主データが変更された場合は競合として拒否する', () => {
    const raw = JSON.stringify(legacy())
    const { storage, data, repository } = memory(raw)
    const other = JSON.stringify({ ...legacy(), revision: 43 })
    storage.setItem.mockImplementation((key, value) => {
      data.set(key, value)
      if (key !== STORAGE_KEY) data.set(STORAGE_KEY, other)
    })
    expect(() => repository.prepareForEditing()).toThrow('別のタブ')
    expect(data.get(STORAGE_KEY)).toBe(other)
    expect(data.get(migrationBackupKey(raw))).toBe(raw)
  })
  it.each([
    '{invalid',
    '{"schemaVersion":3}',
    JSON.stringify({ ...legacy(), sessions: [{ bad: true }] }),
  ])('不正データを初期化・退避・上書きしない', (raw) => {
    const { repository, storage, data } = memory(raw)
    expect(() => repository.prepareForEditing()).toThrow()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(data.get(STORAGE_KEY)).toBe(raw)
  })
  it('Storeは読取りのみで開始し、移行失敗時は編集を止め、再試行で復旧する', () => {
    const raw = JSON.stringify(legacy())
    const { storage, data, repository } = memory(raw)
    const store = new AppStore(
      repository,
      vi.fn(),
      () => 1300_000,
      () => false,
    )
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(store.dispatch({ type: 'count', kind: 'correct' })).toBe(false)
    storage.setItem.mockImplementation(() => {
      throw new Error('容量不足')
    })
    expect(store.prepareForEditing()).toBe(false)
    expect(store.getSnapshot().document).toBeNull()
    expect(data.get(STORAGE_KEY)).toBe(raw)
    storage.setItem.mockImplementation((key, value) => {
      data.set(key, value)
    })
    expect(store.prepareForEditing()).toBe(true)
    expect(store.getSnapshot().document?.sessions).toHaveLength(2)
  })
})

describe('v1/v2からv3への移行', () => {
  it.each([1, 2] as const)('v%i原文と既存バックアップを保全し、一度だけv3へ確定する', (version) => {
    const old = version === 1 ? legacy() : migrateV1(legacy())
    const raw = JSON.stringify(old, null, 2)
    const { repository, storage, data } = memory(raw)
    data.set('pomolog.backup.v1.previous', '以前の退避')
    const read = repository.load()
    expect(read.schemaVersion).toBe(3)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(read.sessions.every((session) => session.deletedAt === null)).toBe(true)
    expect(read.timer).toMatchObject(old.timer!)
    const next = repository.prepareForEditing()
    expect(next).toEqual({ ...read, revision: 43 })
    expect(data.get(migrationBackupKey(raw, version))).toBe(raw)
    expect(data.get('pomolog.backup.v1.previous')).toBe('以前の退避')
    expect(repository.prepareForEditing()).toEqual(next)
    expect(storage.setItem).toHaveBeenCalledTimes(2)
    expect(decodeDocument(JSON.stringify(next))).toEqual(next)
  })
  it.each(['backup', 'main'])(
    'v2の%s書込み失敗で旧主データを保持し、再試行で同じIDへ移行する',
    (failure) => {
      const v2 = migrateV1(legacy())
      const raw = JSON.stringify(v2)
      const { repository, storage, data } = memory(raw)
      storage.setItem.mockImplementation((key, value) => {
        if ((failure === 'main') === (key === STORAGE_KEY)) throw new Error('容量不足')
        data.set(key, value)
      })
      expect(() => repository.prepareForEditing()).toThrow()
      expect(data.get(STORAGE_KEY)).toBe(raw)
      storage.setItem.mockImplementation((key, value) => {
        data.set(key, value)
      })
      const next = repository.prepareForEditing()
      expect(next.items).toEqual(v2.items)
      expect(next.sessions.map((session) => session.learning)).toEqual(
        v2.sessions.map((session) => session.learning),
      )
      expect(data.get(migrationBackupKey(raw, 2))).toBe(raw)
    },
  )
  it('不正なv2参照と未知バージョンを退避・上書きしない', () => {
    const v2 = migrateV1(legacy())
    v2.sessions[0].learning.subjectId = 'missing'
    for (const raw of [JSON.stringify(v2), '{"schemaVersion":4}']) {
      const { repository, storage, data } = memory(raw)
      expect(() => repository.prepareForEditing()).toThrow()
      expect(storage.setItem).not.toHaveBeenCalled()
      expect(data.get(STORAGE_KEY)).toBe(raw)
    }
  })
})
