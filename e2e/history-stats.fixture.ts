import { emptyDocument, transition } from '../src/domain/model'
import type { Session } from '../src/domain/model'
import { children, learningFromIds } from '../src/domain/learning'
import { applyTemplates } from '../src/domain/templates'

export function historyFixture() {
  let doc = emptyDocument()
  doc.items = applyTemplates(doc.items, ['hs-basic-math', 'hs-basic-english'], 0)
  const mathId = doc.items[1].id
  const middles = children(doc.items, 'middle', mathId)
  const mathI = middles.find((item) => item.name === '数学Ⅰ')!
  const quadratic = children(doc.items, 'small', mathI.id).find((item) => item.name === '二次関数')!
  const mathA = middles.find((item) => item.name === '数学Ａ')!
  const english = children(doc.items, 'middle', doc.items[2].id)[0]
  const learning = learningFromIds(doc.items, mathId, mathI.id, quadratic.id)
  const englishLearning = learningFromIds(
    doc.items,
    doc.items[2].id,
    english.id,
    children(doc.items, 'small', english.id)[0].id,
  )
  function record(
    id: string,
    start: string,
    minutes: number,
    correct: number,
    incorrect: number,
    memo: string,
    selected = learning,
  ): Session {
    const startedAt = Date.parse(start),
      endedAt = startedAt + minutes * 60_000
    return {
      id,
      learning: selected,
      startedAt,
      endedAt,
      focusMs: minutes * 60_000,
      correct,
      incorrect,
      memo,
      createdAt: endedAt,
      updatedAt: endedAt,
      deletedAt: null,
    }
  }
  doc.sessions = [
    record(
      'old',
      '2026-12-27T10:00:00+09:00',
      40,
      2,
      2,
      '前の週',
      learningFromIds(doc.items, mathId, mathA.id),
    ),
    record('crossing', '2026-12-31T23:50:00+09:00', 20, 9, 1, '年越し復習'),
    record('editable', '2027-01-01T08:00:00+09:00', 30, 1, 9, '基礎復習'),
    record('zero', '2027-01-02T10:00:00+09:00', 20, 0, 0, '問題なし', englishLearning),
    {
      ...record('deleted', '2027-01-02T08:00:00+09:00', 90, 100, 0, '削除済みテスト'),
      deletedAt: Date.parse('2027-01-02T11:00:00+09:00'),
      updatedAt: Date.parse('2027-01-02T11:00:00+09:00'),
    },
  ]
  doc = transition(
    doc,
    { type: 'item-rename', id: mathId, name: '数学・改名' },
    Date.parse('2027-01-02T11:30:00+09:00'),
  )
  doc = transition(
    doc,
    { type: 'item-rename', id: mathI.id, name: '数学Ⅰ・改名' },
    Date.parse('2027-01-02T11:30:00+09:00'),
  )
  doc = transition(
    doc,
    { type: 'item-archive', id: mathId, archived: true },
    Date.parse('2027-01-02T11:30:00+09:00'),
  )
  return doc
}
