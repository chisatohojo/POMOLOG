import { describe, expect, it } from 'vitest'
import {
  children,
  initialItems,
  isAvailable,
  learningFromIds,
  mutateItems,
  stableId,
} from './learning'
import type { StudyItem } from './learning'
import { documentSchema, emptyDocument, transition } from './model'
import { applyTemplates, STUDY_TEMPLATES } from './templates'

const now = 1_800_000_000_000
function tree() {
  let items = initialItems()
  const subjectId = items[1].id
  items = mutateItems(
    items,
    { type: 'item-add', id: 'm1', level: 'middle', parentId: subjectId, name: '数学Ⅰ' },
    now,
  )
  items = mutateItems(
    items,
    { type: 'item-add', id: 's1', level: 'small', parentId: 'm1', name: '二次関数' },
    now,
  )
  return { items, subjectId }
}

describe('学習項目マスター', () => {
  it('初期登録は安定したIDの7教科のみ', () => {
    expect(initialItems()).toEqual(initialItems())
    expect(initialItems()).toHaveLength(7)
    expect(new Set(initialItems().map((item) => item.id)).size).toBe(7)
    expect(initialItems().every((item) => item.level === 'subject')).toBe(true)
    expect(stableId('a')).not.toBe(stableId('b'))
  })
  it.each(['subject', 'middle', 'small'] as const)(
    '%sを追加・改名・並び替え・アーカイブ・復元する',
    (level) => {
      const { items: original, subjectId } = tree()
      const parentId = level === 'subject' ? null : level === 'middle' ? subjectId : 'm1'
      let items = mutateItems(
        original,
        { type: 'item-add', id: 'new', level, parentId, name: '  追加項目  ' },
        now,
      )
      expect(items.find((item) => item.id === 'new')?.name).toBe('追加項目')
      items = mutateItems(items, { type: 'item-rename', id: 'new', name: '改名項目' }, now + 1)
      const before = children(items, level, parentId).map((item) => item.id)
      items = mutateItems(items, { type: 'item-move', id: 'new', direction: -1 }, now + 2)
      const after = children(items, level, parentId).map((item) => item.id)
      expect(after.indexOf('new')).toBe(before.indexOf('new') - 1)
      items = mutateItems(items, { type: 'item-move', id: 'new', direction: 1 }, now + 3)
      expect(children(items, level, parentId).map((item) => item.id)).toEqual(before)
      items = mutateItems(items, { type: 'item-archive', id: 'new', archived: true }, now + 4)
      expect(isAvailable(items, 'new')).toBe(false)
      expect(children(items, level, parentId, true).some((item) => item.id === 'new')).toBe(true)
      items = mutateItems(items, { type: 'item-archive', id: 'new', archived: false }, now + 5)
      expect(items.find((item) => item.id === 'new')).toMatchObject({
        name: '改名項目',
        id: 'new',
        parentId,
        createdAt: now,
        updatedAt: now + 5,
      })
      expect(original.some((item) => item.id === 'new')).toBe(false)
    },
  )
  it('同じ親の同名・正規化後の重複を拒否し、異なる親では許可する', () => {
    const { items, subjectId } = tree()
    expect(() =>
      mutateItems(
        items,
        {
          type: 'item-add',
          id: 'duplicate',
          level: 'middle',
          parentId: subjectId,
          name: ' 数学Ⅰ ',
        },
        now,
      ),
    ).toThrow('同名')
    const a = mutateItems(
      items,
      { type: 'item-add', id: 'a', level: 'middle', parentId: subjectId, name: 'ＡＢＣ' },
      now,
    )
    expect(() => mutateItems(a, { type: 'item-rename', id: 'm1', name: 'ABC' }, now)).toThrow(
      '同名',
    )
    expect(
      mutateItems(
        items,
        { type: 'item-add', id: 'other', level: 'middle', parentId: items[2].id, name: '数学Ⅰ' },
        now,
      ),
    ).toHaveLength(items.length + 1)
    const archived = mutateItems(items, { type: 'item-archive', id: 'm1', archived: true }, now)
    expect(() =>
      mutateItems(
        archived,
        { type: 'item-add', id: 'duplicate', level: 'middle', parentId: subjectId, name: '数学Ⅰ' },
        now,
      ),
    ).toThrow('アーカイブ')
  })
  it('親の階層・存在・ID重複を検証する', () => {
    const { items } = tree()
    for (const parentId of [null, 'missing', 'm1', 's1'])
      expect(() =>
        mutateItems(
          items,
          { type: 'item-add', id: 'new', level: 'middle', parentId, name: '無効' },
          now,
        ),
      ).toThrow()
    expect(() =>
      mutateItems(
        items,
        { type: 'item-add', id: 'm1', level: 'subject', parentId: null, name: '重複' },
        now,
      ),
    ).toThrow('ID')
    expect(() =>
      mutateItems(
        items,
        { type: 'item-add', id: 'new', level: 'subject', parentId: 'm1', name: '無効' },
        now,
      ),
    ).toThrow()
  })
  it('親アーカイブで子を隠し、子自身の状態を保って復元する', () => {
    const { items: original, subjectId } = tree()
    let items = mutateItems(original, { type: 'item-archive', id: subjectId, archived: true }, now)
    expect(children(items, 'middle', subjectId)).toEqual([])
    expect(isAvailable(items, 's1')).toBe(false)
    expect(items.find((item) => item.id === 's1')?.archived).toBe(false)
    expect(() =>
      mutateItems(
        items,
        { type: 'item-add', id: 'new', level: 'small', parentId: 'm1', name: '新規' },
        now,
      ),
    ).toThrow()
    items = mutateItems(items, { type: 'item-archive', id: 'm1', archived: true }, now)
    expect(() =>
      mutateItems(items, { type: 'item-archive', id: 'm1', archived: false }, now),
    ).toThrow('親項目')
    items = mutateItems(items, { type: 'item-archive', id: subjectId, archived: false }, now)
    expect(isAvailable(items, 's1')).toBe(false)
    items = mutateItems(items, { type: 'item-archive', id: 'm1', archived: false }, now)
    expect(isAvailable(items, 's1')).toBe(true)
  })
  it('任意階層を省略でき、別の親の項目選択を拒否する', () => {
    const { items, subjectId } = tree()
    let doc = { ...emptyDocument(), items }
    doc = transition(
      doc,
      { type: 'select', learning: learningFromIds(items, subjectId, 'm1') },
      now,
    )
    expect(doc.selection.smallId).toBeNull()
    expect(() => learningFromIds(items, items[2].id, 'm1')).toThrow()
    expect(() => learningFromIds(items, subjectId, null, 's1')).toThrow()
    const invalid = { ...doc.selection, subjectId: items[2].id }
    expect(() => transition(doc, { type: 'select', learning: invalid }, now)).toThrow()
    expect(() => documentSchema.parse({ ...doc, selection: invalid })).toThrow()
    const archived = transition(doc, { type: 'item-archive', id: 'm1', archived: true }, now)
    expect(archived.selection.middleId).toBeNull()
    expect(() => transition(archived, { type: 'select', learning: doc.selection }, now)).toThrow(
      'アーカイブ',
    )
  })
  it('改名・アーカイブ後も学習中と保存済み記録のID・名称・問題数を保持する', () => {
    const { items, subjectId } = tree()
    let doc = {
      ...emptyDocument(),
      items,
      selection: learningFromIds(items, subjectId, 'm1', 's1'),
    }
    doc = transition(doc, { type: 'start', id: 'session' }, now)
    doc = transition(doc, { type: 'count', kind: 'correct' }, now)
    const original = { ...doc.timer!.learning }
    for (const id of [subjectId, 'm1', 's1'])
      doc = transition(doc, { type: 'item-rename', id, name: `新${id}` }, now)
    doc = transition(doc, { type: 'item-archive', id: subjectId, archived: true }, now)
    expect(doc.timer!.learning).toEqual(original)
    doc = transition(doc, { type: 'finish' }, now + 1200_000)
    const timer = doc.timer!
    doc = transition(
      doc,
      {
        type: 'save',
        session: { ...timer, endedAt: timer.endedAt!, focusMs: timer.accumulatedMs },
      },
      now + 1200_000,
    )
    expect(doc.sessions[0]).toMatchObject({ learning: original, correct: 1, focusMs: 1200_000 })
    expect(doc.selection.subjectId).not.toBe(subjectId)
    expect(documentSchema.parse(doc)).toEqual(doc)
    const history = doc.sessions
    doc = transition(doc, { type: 'item-archive', id: subjectId, archived: false }, now + 1200_001)
    expect(doc.sessions).toBe(history)
    doc = transition(
      doc,
      { type: 'select', learning: learningFromIds(doc.items, subjectId, 'm1', 's1') },
      now,
    )
    doc = transition(doc, { type: 'start', id: 'next' }, now)
    expect(doc.timer?.learning.subject).toBe(`新${subjectId}`)
  })
  it('全教科アーカイブ時は空選択となり、追加で復帰できる', () => {
    let doc = emptyDocument()
    for (const item of doc.items)
      doc = transition(doc, { type: 'item-archive', id: item.id, archived: true }, now)
    expect(doc.selection.subjectId).toBeNull()
    expect(() => transition(doc, { type: 'start', id: 'invalid' }, now)).toThrow()
    doc = transition(
      doc,
      { type: 'item-add', id: 'new', level: 'subject', parentId: null, name: '新教科' },
      now,
    )
    expect(doc.selection.subjectId).toBe('new')
  })
  it('不正な親参照・ID・テンプレートキーの重複を読み込まない', () => {
    const { items } = tree()
    const doc = { ...emptyDocument(), items }
    expect(() => documentSchema.parse({ ...doc, items: [...items, items[0]] })).toThrow()
    expect(() =>
      documentSchema.parse({
        ...doc,
        items: items.map((item) => (item.id === 'm1' ? { ...item, parentId: 's1' } : item)),
      }),
    ).toThrow()
    expect(() =>
      documentSchema.parse({
        ...doc,
        items: items.map((item) => ({ ...item, templateKeys: ['same'] })),
      }),
    ).toThrow()
  })
})

describe('高校基礎テンプレート', () => {
  it('7教科を独立定義し、選択した分だけ追加する', () => {
    const definitions = JSON.stringify(STUDY_TEMPLATES)
    expect(STUDY_TEMPLATES).toHaveLength(7)
    const items = applyTemplates(initialItems(), ['hs-basic-math'], now)
    expect(children(items, 'middle', initialItems()[1].id).map((item) => item.name)).toEqual([
      '数学Ⅰ',
      '数学Ａ',
    ])
    expect(children(items, 'middle', initialItems()[2].id)).toEqual([])
    expect(JSON.stringify(STUDY_TEMPLATES)).toBe(definitions)
    const all = applyTemplates(
      initialItems(),
      STUDY_TEMPLATES.map((template) => template.id),
      now,
    )
    expect(documentSchema.parse({ ...emptyDocument(), items: all }).items).toHaveLength(all.length)
  })
  it('重複指定・再適用・改名・アーカイブ後も複製しない', () => {
    let items = applyTemplates(initialItems(), ['hs-basic-math', 'hs-basic-math'], now)
    expect(applyTemplates(items, ['hs-basic-math'], now + 1)).toBe(items)
    const middle = children(items, 'middle', initialItems()[1].id)[0]
    const small = children(items, 'small', middle.id)[0]
    for (const item of [items[1], middle, small])
      items = mutateItems(
        items,
        { type: 'item-rename', id: item.id, name: `変更${item.name}` },
        now + 1,
      )
    items = mutateItems(items, { type: 'item-archive', id: middle.id, archived: true }, now + 2)
    expect(applyTemplates(items, ['hs-basic-math'], now + 3)).toBe(items)
    expect(items.find((item) => item.id === middle.id)?.archived).toBe(true)
  })
  it('旧項目と同じ親・同名の項目を再利用する', () => {
    const { items, subjectId } = tree()
    const next = applyTemplates(items, ['hs-basic-math'], now)
    expect(children(next, 'middle', subjectId).find((item) => item.name === '数学Ⅰ')?.id).toBe('m1')
    expect(children(next, 'small', 'm1').find((item) => item.name === '二次関数')?.id).toBe('s1')
    expect(applyTemplates(next, ['hs-basic-math'], now + 1)).toBe(next)
  })
  it('初期教科の改名・アーカイブを尊重し、不明な定義を拒否する', () => {
    let items: StudyItem[] = mutateItems(
      initialItems(),
      { type: 'item-rename', id: initialItems()[1].id, name: '自分の数学' },
      now,
    )
    items = mutateItems(items, { type: 'item-archive', id: items[1].id, archived: true }, now)
    items = mutateItems(
      items,
      { type: 'item-add', id: 'separate', level: 'subject', parentId: null, name: '数学' },
      now,
    )
    const next = applyTemplates(items, ['hs-basic-math'], now)
    expect(next.filter((item) => item.level === 'subject')).toHaveLength(8)
    expect(next[1]).toMatchObject({ name: '自分の数学', archived: true })
    expect(children(next, 'middle', 'separate', true)).toHaveLength(0)
    expect(() => applyTemplates(items, ['missing'], now)).toThrow()
  })
})
