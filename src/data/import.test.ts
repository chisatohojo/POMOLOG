import { describe, expect, it, vi } from 'vitest'
import { emptyDocument, transition } from '../domain/model'
import type { AppDocument, Session } from '../domain/model'
import { planImport } from '../domain/import'
import { learningFromIds, mutateItems } from '../domain/learning'
import { AppStore } from '../app/store'
import { LocalRepository, STORAGE_KEY, importBackupKey } from './repository'
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ITEMS,
  MAX_IMPORT_SESSIONS,
  parseImportFile,
} from './importFile'

function fixture() {
  const doc = emptyDocument()
  const session: Session = {
    id: 'saved',
    learning: doc.selection,
    startedAt: 1000,
    endedAt: 1201_000,
    focusMs: 1200_000,
    correct: 3,
    incorrect: 1,
    memo: '保全する記録',
    createdAt: 1201_000,
    updatedAt: 1201_000,
    deletedAt: null,
  }
  doc.sessions = [session]
  doc.revision = 12
  return doc
}
function file(doc: AppDocument, version: number) {
  const record = (value: { learning: Session['learning'] }) =>
    version === 1
      ? {
          ...value,
          learning: {
            subject: value.learning.subject,
            middle: value.learning.middle,
            small: value.learning.small,
          },
        }
      : value
  return JSON.stringify({
    ...doc,
    schemaVersion: version,
    selection: record({ learning: doc.selection }).learning,
    timer: doc.timer && record(doc.timer),
    sessions: doc.sessions.map((session) => {
      if (version === 3) return session
      const { deletedAt: _deletedAt, ...rest } = session
      return record(rest)
    }),
  })
}
function memory(doc: AppDocument | null = fixture()) {
  const raw = doc && JSON.stringify(doc, null, 2)
  const data = new Map<string, string>(raw ? [[STORAGE_KEY, raw]] : [])
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value)
    }),
  }
  const repository = new LocalRepository(storage)
  const store = new AppStore(
    repository,
    () => {},
    () => 9999,
    () => true,
  )
  return { raw, data, storage, repository, store }
}
const action = (document: AppDocument, expectedRevision = 12) => ({
  type: 'import-data' as const,
  document,
  expectedRevision,
})

describe('JSONファイルの検証・旧形式対応', () => {
  it.each([1, 2, 3])('v%iを安全に検証しv3へ変換する', (version) => {
    const raw = file(fixture(), version)
    const result = parseImportFile(raw)
    expect(result.version).toBe(version)
    expect(result.document.schemaVersion).toBe(3)
    expect(result.document.sessions[0]).toMatchObject({
      id: 'saved',
      memo: '保全する記録',
      focusMs: 1200_000,
      deletedAt: null,
    })
    expect(parseImportFile(raw)).toEqual(result)
    expect(JSON.parse(raw).schemaVersion).toBe(version)
  })
  it('UTF-8 BOM付きファイルを読める', () => {
    expect(parseImportFile('\uFEFF' + JSON.stringify(fixture())).document).toEqual(fixture())
  })
  it.each(['{', 'null', '[]', '{}', '{"schemaVersion":4}', '{"schemaVersion":3,"sessions":[]}'])(
    '破損・未対応・不正schemaを拒否する: %s',
    (raw) => {
      expect(() => parseImportFile(raw)).toThrow()
    },
  )
  it('不正な参照・時間・重複IDを拒否する', () => {
    const doc = fixture()
    for (const changed of [
      {
        ...doc,
        sessions: [{ ...doc.sessions[0], learning: { ...doc.selection, subjectId: 'missing' } }],
      },
      { ...doc, sessions: [{ ...doc.sessions[0], focusMs: 9999_000 }] },
      { ...doc, sessions: [{ ...doc.sessions[0], createdAt: 1e20 }] },
      { ...doc, sessions: [doc.sessions[0], doc.sessions[0]] },
    ])
      expect(() => parseImportFile(JSON.stringify(changed))).toThrow('不正')
  })
  it('サイズ・記録数・項目数の上限を検証する', () => {
    expect(() => parseImportFile(' '.repeat(MAX_IMPORT_BYTES + 1))).toThrow('5MB')
    expect(() =>
      parseImportFile(
        JSON.stringify({ schemaVersion: 3, sessions: Array(MAX_IMPORT_SESSIONS + 1).fill(null) }),
      ),
    ).toThrow('10,000')
    expect(() =>
      parseImportFile(
        JSON.stringify({
          schemaVersion: 3,
          sessions: [],
          items: Array(MAX_IMPORT_ITEMS + 1).fill(null),
        }),
      ),
    ).toThrow('2,000')
  })
})

describe('追加取り込みの併合方針', () => {
  it('追加・改名済み項目・当時名・タイマー・選択・削除状態を維持し、入力を変更しない', () => {
    const current = transition(fixture(), { type: 'start', id: 'active' }, 2000_000)
    const incoming = fixture()
    incoming.items = mutateItems(
      incoming.items,
      {
        type: 'item-add',
        id: 'new-middle',
        parentId: incoming.selection.subjectId,
        level: 'middle',
        name: '追加項目',
      },
      3000,
    )
    incoming.sessions.push({
      ...incoming.sessions[0],
      id: 'new',
      learning: learningFromIds(incoming.items, incoming.selection.subjectId, 'new-middle'),
      deletedAt: 2222,
    })
    incoming.items[1].name = '別名'
    incoming.items[1].archived = true
    incoming.timer = { ...current.timer!, id: 'incoming-active' }
    const before = JSON.stringify({ current, incoming })
    const plan = planImport(current, incoming)
    expect(plan).toMatchObject({ added: 1, addedDeleted: 1, addedItems: 1, skipped: 1 })
    expect(plan.document!.items[1]).toEqual(current.items[1])
    expect(plan.document!.sessions[1]).toEqual(incoming.sessions[1])
    expect(plan.document!.timer).toEqual(current.timer)
    expect(plan.document!.selection).toEqual(current.selection)
    expect(JSON.stringify({ current, incoming })).toBe(before)
  })
  it('同じ記録IDは内容や更新日時・削除状態にかかわらずスキップする', () => {
    const current = fixture()
    current.sessions[0].deletedAt = 5555
    const incoming = fixture()
    incoming.sessions[0].updatedAt = 9999_000
    incoming.sessions[0].memo = '古いバックアップ'
    const plan = planImport(current, incoming)
    expect(plan).toMatchObject({ skipped: 1, changedDuplicates: 1, added: 0 })
    expect(plan.document!.sessions).toEqual(current.sessions)
    expect(transition(current, action(incoming), 9999)).toBe(current)
  })
  it('現在のタイマーIDに衝突する保存記録もスキップする', () => {
    const current = transition(fixture(), { type: 'start', id: 'collision' }, 2000_000)
    const incoming = fixture()
    incoming.sessions[0].id = 'collision'
    expect(planImport(current, incoming)).toMatchObject({
      added: 0,
      skipped: 1,
      changedDuplicates: 1,
    })
  })
  it('異なるIDの同名項目は既存項目に統合する', () => {
    const current = fixture()
    const incoming = fixture()
    const item = { ...incoming.items[1], id: 'independent', order: 0 }
    incoming.items.push(item)
    const plan = planImport(current, incoming)
    expect(plan).toMatchObject({ mergedItems: 1, addedItems: 0 })
    expect(plan.idMap.get('independent')).toBe(current.items[1].id)
    expect(plan.document!.items).toEqual(current.items)
  })
  it('同じ項目IDの親が異なる場合は全体を拒否する', () => {
    const current = fixture()
    current.items = mutateItems(
      current.items,
      {
        type: 'item-add',
        id: 'middle',
        name: '基礎',
        level: 'middle',
        parentId: current.items[1].id,
      },
      0,
    )
    const incoming = structuredClone(current)
    incoming.items.at(-1)!.parentId = incoming.items[2].id
    expect(() => transition(current, action(incoming), 9999)).toThrow('階層・親')
  })
  it('異なるIDのテンプレートキー競合は全体を拒否する', () => {
    const current = fixture()
    current.items[1].templateKeys = ['template:key']
    const incoming = fixture()
    incoming.items.push({ ...incoming.items[2], id: 'another', templateKeys: ['template:key'] })
    expect(() => transition(current, action(incoming), 9999)).toThrow('テンプレート')
  })
  it('プレビュー後のrevision変更を拒否する', () => {
    expect(() => transition(fixture(), action(fixture(), 11), 9999)).toThrow('再確認')
  })
})

describe('取り込み時の排他・原文バックアップ・原子保存', () => {
  function incoming() {
    const doc = fixture()
    doc.sessions[0].id = 'new'
    return doc
  }
  function foreign() {
    const doc = incoming()
    const sourceId = doc.selection.subjectId!
    const targetId = 'foreign-subject'
    doc.items.find((item) => item.id === sourceId)!.id = targetId
    doc.selection.subjectId = targetId
    doc.sessions[0].learning.subjectId = targetId
    return doc
  }
  it('統合保存・再読込・同じJSONの再実行でIDと原文を保全する', () => {
    const { store, data, raw, repository } = memory()
    const source = foreign()
    const original = JSON.stringify(source)
    expect(store.dispatch(action(source))).toBe(true)
    expect(repository.load().items).toEqual(fixture().items)
    expect(repository.load().sessions.map((record) => record.learning.subjectId)).toEqual([
      fixture().selection.subjectId,
      fixture().selection.subjectId,
    ])
    expect(data.get(importBackupKey(raw!))).toBe(raw)
    expect(store.dispatch(action(source, 13))).toBe(false)
    expect(repository.load().revision).toBe(13)
    expect(JSON.stringify(source)).toBe(original)
  })
  it.each(['backup', 'main'])(
    '統合時の%s保存失敗でも項目ID・記録・revisionを変更しない',
    (failure) => {
      const { store, storage, data, raw, repository } = memory()
      storage.setItem.mockImplementation((key, value) => {
        if ((failure === 'main') === (key === STORAGE_KEY)) throw new Error('quota')
        data.set(key, value)
      })
      expect(store.dispatch(action(foreign()))).toBe(false)
      expect(data.get(STORAGE_KEY)).toBe(raw)
      expect(repository.load()).toEqual(fixture())
      expect(store.getSnapshot().document).toEqual(fixture())
    },
  )
  it('テンプレート識別子だけの取り込みも退避・revision更新を経由する', () => {
    const { store, repository, data, raw } = memory()
    const source = foreign()
    source.sessions = []
    source.items[1].templateKeys = ['new-template-key']
    expect(store.dispatch(action(source))).toBe(true)
    expect(repository.load()).toMatchObject({ revision: 13, sessions: fixture().sessions })
    expect(repository.load().items[1].templateKeys).toEqual(['new-template-key'])
    expect(data.get(importBackupKey(raw!))).toBe(raw)
    expect(store.dispatch(action(source, 13))).toBe(false)
  })
  it('統合先が曖昧な場合やテンプレートキー競合ではバックアップも本体も保存しない', () => {
    const current = fixture()
    current.items[1].templateKeys = ['taken']
    current.items.push({ ...current.items[1], id: 'duplicate', templateKeys: [] })
    const { store, data, storage, raw } = memory(current)
    expect(store.dispatch(action(foreign()))).toBe(false)
    const conflict = fixture()
    conflict.items[2].templateKeys = ['taken']
    expect(store.dispatch(action(conflict))).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(data.size).toBe(1)
    expect(data.get(STORAGE_KEY)).toBe(raw)
  })
  it('現在のJSON原文を退避し、revisionを一度だけ増やして保存・再読込する', () => {
    const { store, data, raw, repository } = memory()
    expect(store.dispatch(action(incoming()))).toBe(true)
    expect(data.get(importBackupKey(raw!))).toBe(raw)
    expect(repository.load().revision).toBe(13)
    expect(repository.load().sessions.map((session) => session.id)).toEqual(['saved', 'new'])
    expect(store.dispatch(action(incoming(), 13))).toBe(false)
    expect(repository.load().revision).toBe(13)
  })
  it.each(['backup', 'main'])('%s保存失敗時は元記録を保持し、再試行で複製しない', (failure) => {
    const { store, storage, data, raw, repository } = memory()
    storage.setItem.mockImplementation((key, value) => {
      if ((failure === 'main') === (key === STORAGE_KEY)) throw new Error('quota')
      data.set(key, value)
    })
    expect(store.dispatch(action(incoming()))).toBe(false)
    expect(data.get(STORAGE_KEY)).toBe(raw)
    expect(store.getSnapshot().document?.sessions).toHaveLength(1)
    storage.setItem.mockImplementation((key, value) => {
      data.set(key, value)
    })
    expect(store.dispatch(action(incoming()))).toBe(true)
    expect(repository.load().sessions).toHaveLength(2)
    expect(data.get(importBackupKey(raw!))).toBe(raw)
  })
  it('退避先競合・書き込み無反映を検出して本体を更新しない', () => {
    const first = memory()
    first.data.set(importBackupKey(first.raw!), 'different')
    expect(first.store.dispatch(action(incoming()))).toBe(false)
    expect(first.data.get(STORAGE_KEY)).toBe(first.raw)
    const second = memory()
    second.storage.setItem.mockImplementation(() => {})
    expect(second.store.dispatch(action(incoming()))).toBe(false)
    expect(second.data.get(STORAGE_KEY)).toBe(second.raw)
  })
  it('ロック非所有・外部revision更新では書き込まない', () => {
    const { repository, data, raw, storage } = memory()
    const waiter = new AppStore(
      repository,
      () => {},
      () => 9999,
      () => false,
    )
    expect(waiter.dispatch(action(incoming()))).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
    const owner = new AppStore(repository, () => {})
    data.set(STORAGE_KEY, JSON.stringify({ ...fixture(), revision: 13 }))
    expect(owner.dispatch(action(incoming()))).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(data.get(STORAGE_KEY)).not.toBe(raw)
  })
  it('バックアップ作成中に本体が変わった場合も上書きを拒否する', () => {
    const { store, data, storage } = memory()
    const external = JSON.stringify({ ...fixture(), revision: 99 })
    storage.setItem.mockImplementation((key, value) => {
      data.set(key, value)
      if (key !== STORAGE_KEY) data.set(STORAGE_KEY, external)
    })
    expect(store.dispatch(action(incoming()))).toBe(false)
    expect(data.get(STORAGE_KEY)).toBe(external)
  })
  it('新規環境でも空の現行データを退避して追加できる', () => {
    const { store, data, repository } = memory(null)
    expect(store.dispatch(action(incoming(), 0))).toBe(true)
    expect(data.get(importBackupKey(JSON.stringify(emptyDocument())))).toBe(
      JSON.stringify(emptyDocument()),
    )
    expect(repository.load().sessions).toHaveLength(1)
  })
})
