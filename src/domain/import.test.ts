import { describe, expect, it } from 'vitest'
import { planImport } from './import'
import { documentSchema, transition } from './model'
import { seeded } from '../../e2e/fixtures'
import { learningFromIds, validateItems } from './learning'
import { emptyHistoryFilter, groupByItem, searchHistory } from './statistics'

function pair() {
  const current = structuredClone(seeded)
  const incoming = structuredClone(current)
  const id = (value: string | null) => (value === null ? null : `foreign-${value}`)
  incoming.items = incoming.items.map((item) => ({
    ...item,
    id: id(item.id)!,
    parentId: id(item.parentId),
  }))
  const learning = {
    ...incoming.sessions[0].learning,
    subjectId: id(current.items[2].id),
    middleId: id('existing-middle'),
    smallId: id('existing-small'),
    subject: '記録当時の英語',
    middle: '以前の文法',
    small: '以前の時制',
  }
  incoming.selection = learning
  incoming.sessions = [
    { ...incoming.sessions[0], learning },
    { ...incoming.sessions[0], id: 'new-session', learning, correct: 1, incorrect: 3 },
  ]
  return { current, incoming, learning }
}
const importInto = (current: typeof seeded, incoming: typeof seeded) =>
  transition(
    current,
    { type: 'import-data', document: incoming, expectedRevision: current.revision },
    9999,
  )

describe('階層と正規化名称による追加インポート', () => {
  it('異なるIDの3階層を統合し、UUID・スナップショット・履歴・加重統計を維持する', () => {
    const { current, incoming, learning } = pair()
    incoming.items[2].name = ' 英語 '
    incoming.items.find((item) => item.level === 'middle')!.name = ' 文法 '
    const before = JSON.stringify({ current, incoming })
    const plan = planImport(current, incoming)
    expect(plan).toMatchObject({
      added: 1,
      skipped: 1,
      mergedItems: 9,
      addedItems: 0,
      conflicts: [],
    })
    const result = importInto(current, incoming)
    expect(result.items).toEqual(current.items)
    expect(result.sessions[0]).toEqual(current.sessions[0])
    expect(result.sessions[1]).toMatchObject({
      id: 'new-session',
      learning: {
        ...learning,
        ...{
          subjectId: current.items[2].id,
          middleId: 'existing-middle',
          smallId: 'existing-small',
        },
      },
    })
    for (const level of ['subject', 'middle', 'small'] as const) {
      expect(groupByItem(result.sessions, result.items, level)).toEqual([
        expect.objectContaining({
          sessions: 2,
          focusMs: 2_400_000,
          sets: 2,
          questions: 10,
          correct: 6,
          rate: 60,
        }),
      ])
    }
    expect(
      searchHistory(result.sessions, result.items, {
        ...emptyHistoryFilter(),
        smallId: 'existing-small',
      }),
    ).toHaveLength(2)
    expect(importInto(result, incoming)).toBe(result)
    expect(JSON.stringify({ current, incoming })).toBe(before)
    expect(documentSchema.safeParse(result).success).toBe(true)
  })

  it('NFKCを使用し、ファイル順に依存せず親IDを変換して新規項目を追加する', () => {
    const { current, incoming } = pair()
    current.items.find((item) => item.id === 'existing-middle')!.name = 'ABC'
    incoming.items.find((item) => item.level === 'middle')!.name = 'ＡＢＣ'
    incoming.items.push({
      ...incoming.items.at(-1)!,
      id: 'new-small',
      name: '語順',
      order: 99,
    })
    incoming.sessions[1].learning.smallId = 'new-small'
    const forward = planImport(current, incoming)
    incoming.items.reverse()
    const reverse = planImport(current, incoming)
    expect(forward.document).toEqual(reverse.document)
    expect(reverse.document!.items.at(-1)).toMatchObject({ parentId: 'existing-middle', order: 1 })
    expect(reverse.document!.sessions[1].learning).toMatchObject({
      middleId: 'existing-middle',
      smallId: 'new-small',
    })
    expect(validateItems(reverse.document!.items)).toBe(true)
  })

  it('親が違う同名項目は統合せず、新規の親子関係を保持する', () => {
    const { current, incoming } = pair()
    incoming.items[2].name = '別の教科'
    const plan = planImport(current, incoming)
    expect(plan).toMatchObject({ addedItems: 3, mergedItems: 6, conflicts: [] })
    const result = importInto(current, incoming)
    expect(result.sessions[1].learning).toMatchObject({
      subjectId: 'foreign-' + current.items[2].id,
      middleId: 'foreign-existing-middle',
      smallId: 'foreign-existing-small',
    })
    expect(result.items.find((item) => item.id === 'foreign-existing-small')!.parentId).toBe(
      'foreign-existing-middle',
    )
    expect(groupByItem(result.sessions, result.items, 'middle')).toHaveLength(2)
  })

  it('同一IDの改名は既存名を優先し、異なるIDの改名は推測しない', () => {
    const { current, incoming } = pair()
    const sameId = structuredClone(current)
    sameId.items[2].name = '旧称'
    sameId.sessions[0].id = 'same-id-record'
    expect(importInto(current, sameId).items[2]).toEqual(current.items[2])
    incoming.items[2].name = '旧称'
    expect(planImport(current, incoming)).toMatchObject({ addedItems: 3, conflicts: [] })
  })

  it('アーカイブ状態・名前・順序を既存優先とし、親のアーカイブも通知する', () => {
    const { current, incoming } = pair()
    current.items[2].archived = true
    current.items[2].order = 42
    const plan = planImport(current, incoming)
    expect(plan.archivedMatches).toHaveLength(3)
    expect(plan.document!.items).toEqual(current.items)
    expect(groupByItem(plan.document!.sessions, plan.document!.items, 'subject')[0]).toMatchObject({
      archived: true,
      sessions: 2,
    })
  })

  it('既存に同名候補が複数あれば通知して全体を中止する', () => {
    const { current, incoming } = pair()
    current.items.push({ ...current.items[2], id: 'ambiguous' })
    const before = JSON.stringify(current)
    const plan = planImport(current, incoming)
    expect(plan.document).toBeNull()
    expect(plan.conflicts.map((item) => item.id)).toEqual([
      'foreign-' + current.items[2].id,
      'foreign-existing-middle',
      'foreign-existing-small',
    ])
    expect(plan.conflicts[0].reasons.join()).toContain('ambiguous')
    expect(() => importInto(current, incoming)).toThrow('同名')
    expect(JSON.stringify(current)).toBe(before)
  })

  it('新規同名項目の統合先をファイル順で決めず、安全に中止する', () => {
    const { current, incoming } = pair()
    incoming.items[2].name = '新しい教科'
    incoming.items.push({ ...incoming.items[2], id: 'ambiguous-new' })
    for (let n = 0; n < 2; n++) {
      const plan = planImport(current, incoming)
      expect(plan.document).toBeNull()
      expect(plan.conflicts.filter((item) => item.level === 'subject')).toHaveLength(2)
      expect(() => importInto(current, incoming)).toThrow('取り込み元に同名')
      incoming.items.reverse()
    }
  })

  it('同一IDの親も対応表で照合し、親だけ別IDでも関係を維持する', () => {
    const { current, incoming } = pair()
    incoming.items.find((item) => item.id === 'foreign-existing-middle')!.id = 'existing-middle'
    incoming.items.find((item) => item.id === 'foreign-existing-small')!.parentId =
      'existing-middle'
    incoming.selection.middleId = 'existing-middle'
    incoming.sessions.forEach((session) => {
      session.learning.middleId = 'existing-middle'
    })
    expect(planImport(current, incoming)).toMatchObject({
      conflicts: [],
      addedItems: 0,
      mergedItems: 8,
    })
    expect(importInto(current, incoming).sessions[1].learning.middleId).toBe('existing-middle')
  })

  it('中・小項目未選択の記録も保持する', () => {
    const { current, incoming } = pair()
    incoming.sessions[1].learning = learningFromIds(incoming.items, incoming.items[2].id)
    expect(importInto(current, incoming).sessions[1].learning).toMatchObject({
      subjectId: current.items[2].id,
      middleId: null,
      smallId: null,
    })
  })
})

describe('テンプレート識別子の引継ぎ', () => {
  it('キーを同じ統合先へ合併し、項目属性と一意所有を維持し再実行しない', () => {
    const { current, incoming } = pair()
    current.items[2].templateKeys = ['existing-key']
    incoming.items[2].templateKeys = ['additional-key']
    incoming.sessions = []
    const plan = planImport(current, incoming)
    expect(plan).toMatchObject({ added: 0, updatedItems: 1, hasChanges: true, conflicts: [] })
    const result = importInto(current, incoming)
    expect(result.items[2]).toEqual({
      ...current.items[2],
      templateKeys: ['existing-key', 'additional-key'],
      updatedAt: current.items[2].updatedAt + 1,
    })
    expect(importInto(result, incoming)).toBe(result)
    expect(documentSchema.safeParse(result).success).toBe(true)
  })

  it('同じキーを持つ同名別IDは、所有者が同じなら安全に統合する', () => {
    const { current, incoming } = pair()
    current.items[2].templateKeys = ['shared']
    incoming.items[2].templateKeys = ['shared']
    expect(importInto(current, incoming).items).toEqual(current.items)
  })

  it('異なる統合先が同じキーを所有する衝突は、改名でも推測せず中止する', () => {
    const { current, incoming } = pair()
    current.items[2].templateKeys = ['conflicting-key']
    for (const name of ['英語', '改名後']) {
      incoming.items[2].name = name
      incoming.items[1].templateKeys = ['conflicting-key']
      const plan = planImport(current, incoming)
      expect(plan.document).toBeNull()
      expect(plan.conflicts.some((item) => item.reasons.join().includes('conflicting-key'))).toBe(
        true,
      )
      expect(() => importInto(current, incoming)).toThrow('テンプレート識別子')
    }
  })
})
