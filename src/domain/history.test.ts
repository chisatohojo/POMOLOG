import { describe, expect, it, vi } from 'vitest'
import { AppStore } from '../app/store'
import { LocalRepository, STORAGE_KEY } from '../data/repository'
import { emptyDocument, transition } from './model'
import type { Session } from './model'
import { learningFromIds } from './learning'

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
    memo: '元のメモ',
    createdAt: 1201_000,
    updatedAt: 1201_000,
    deletedAt: null,
  }
  doc.sessions = [session]
  return { doc, session }
}

describe('履歴の編集・論理削除・復元', () => {
  it('同じ項目なら記録時の名称を保持し、ID・作成日時を維持して更新する', () => {
    let { doc, session } = fixture()
    doc = transition(
      doc,
      { type: 'item-rename', id: session.learning.subjectId!, name: '改名' },
      2000_000,
    )
    doc = transition(
      doc,
      { type: 'item-archive', id: session.learning.subjectId!, archived: true },
      2000_001,
    )
    const next = transition(
      doc,
      {
        type: 'session-edit',
        id: session.id,
        expectedUpdatedAt: session.updatedAt,
        fields: {
          ...session,
          learning: learningFromIds(doc.items, session.learning.subjectId),
          correct: 5,
          memo: '更新',
        },
      },
      2000_002,
    )
    expect(next.sessions[0]).toMatchObject({
      id: session.id,
      createdAt: session.createdAt,
      updatedAt: 2000_002,
      learning: session.learning,
      correct: 5,
      memo: '更新',
    })
    expect(doc.sessions[0]).toEqual(session)
  })
  it('項目変更時だけ新しいID・現在名へ変更する', () => {
    const { doc, session } = fixture()
    const learning = learningFromIds(doc.items, doc.items[2].id)
    const next = transition(
      doc,
      {
        type: 'session-edit',
        id: session.id,
        expectedUpdatedAt: session.updatedAt,
        fields: { ...session, learning },
      },
      2000_000,
    )
    expect(next.sessions[0].learning).toEqual(learning)
    const archived = transition(
      doc,
      { type: 'item-archive', id: doc.items[2].id, archived: true },
      2000_000,
    )
    expect(() =>
      transition(
        archived,
        {
          type: 'session-edit',
          id: session.id,
          expectedUpdatedAt: session.updatedAt,
          fields: { ...session, learning },
        },
        2000_000,
      ),
    ).toThrow('アーカイブ')
  })
  it.each([
    { focusMs: 1200_001 },
    { endedAt: 999 },
    { correct: -1 },
    { incorrect: 1.5 },
    { memo: 'a'.repeat(10001) },
  ])('不正な編集を拒否する %j', (fields) => {
    const { doc, session } = fixture()
    expect(() =>
      transition(
        doc,
        {
          type: 'session-edit',
          id: session.id,
          expectedUpdatedAt: session.updatedAt,
          fields: { ...session, ...fields },
        },
        2000_000,
      ),
    ).toThrow()
    expect(doc.sessions[0]).toEqual(session)
  })
  it('削除は日時の墓石だけを付け、復元で解除し、古いフォームを拒否する', () => {
    const { doc, session } = fixture()
    const deleted = transition(
      doc,
      { type: 'session-delete', id: session.id, expectedUpdatedAt: session.updatedAt },
      2000_000,
    )
    expect(deleted.sessions[0]).toEqual({ ...session, deletedAt: 2000_000, updatedAt: 2000_000 })
    expect(() =>
      transition(
        deleted,
        {
          type: 'session-edit',
          id: session.id,
          expectedUpdatedAt: session.updatedAt,
          fields: session,
        },
        2000_001,
      ),
    ).toThrow('更新されています')
    expect(() =>
      transition(
        deleted,
        { type: 'session-edit', id: session.id, expectedUpdatedAt: 2000_000, fields: session },
        2000_001,
      ),
    ).toThrow('復元')
    expect(
      transition(
        deleted,
        { type: 'session-delete', id: session.id, expectedUpdatedAt: 2000_000 },
        2000_001,
      ),
    ).toBe(deleted)
    const restored = transition(
      deleted,
      { type: 'session-restore', id: session.id, expectedUpdatedAt: 2000_000 },
      2000_001,
    )
    expect(restored.sessions[0]).toEqual({ ...session, updatedAt: 2000_001 })
    expect(
      transition(
        restored,
        { type: 'session-restore', id: session.id, expectedUpdatedAt: 2000_001 },
        2000_002,
      ),
    ).toBe(restored)
  })
  it('タイマーを変えず、時計が戻っても更新日時を単調増加させる', () => {
    const { doc, session } = fixture()
    const running = transition(doc, { type: 'start', id: 'active' }, 2000_000)
    const edited = transition(
      running,
      {
        type: 'session-edit',
        id: session.id,
        expectedUpdatedAt: session.updatedAt,
        fields: session,
      },
      0,
    )
    expect(edited.timer).toBe(running.timer)
    expect(edited.sessions[0].updatedAt).toBe(session.updatedAt + 1)
  })
  it('編集・削除・復元も所有権・保存失敗・revision競合で確定しない', () => {
    const { doc, session } = fixture()
    const data = new Map([[STORAGE_KEY, JSON.stringify(doc)]])
    let fail = false,
      owner = false
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (fail) throw new Error('容量不足')
        data.set(key, value)
      },
    }
    const repository = new LocalRepository(storage)
    const store = new AppStore(
      repository,
      vi.fn(),
      () => 2000_000,
      () => owner,
    )
    const actions = [
      {
        type: 'session-edit',
        id: session.id,
        expectedUpdatedAt: session.updatedAt,
        fields: { ...session, memo: '修正' },
      },
      { type: 'session-delete', id: session.id, expectedUpdatedAt: session.updatedAt },
      { type: 'session-restore', id: session.id, expectedUpdatedAt: session.updatedAt },
    ] as const
    for (const action of actions) expect(store.dispatch(action)).toBe(false)
    owner = true
    fail = true
    for (const action of actions.slice(0, 2)) expect(store.dispatch(action)).toBe(false)
    expect(repository.load()).toEqual(doc)
    fail = false
    const stale = new AppStore(repository, vi.fn(), () => 2000_000)
    expect(store.dispatch(actions[1])).toBe(true)
    expect(stale.dispatch(actions[0])).toBe(false)
    const restoredStore = new AppStore(repository, vi.fn(), () => 2000_001)
    expect(restoredStore.getSnapshot().document?.sessions[0].deletedAt).toBe(2000_000)
    fail = true
    const restore = {
      type: 'session-restore',
      id: session.id,
      expectedUpdatedAt: 2000_000,
    } as const
    expect(restoredStore.dispatch(restore)).toBe(false)
    expect(repository.load().sessions[0].deletedAt).toBe(2000_000)
    fail = false
    expect(restoredStore.dispatch(restore)).toBe(true)
    expect(repository.load().sessions[0].deletedAt).toBeNull()
  })
})
