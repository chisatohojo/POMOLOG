import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyDocument } from './model'
import type { Session } from './model'
import { learningFromIds } from './learning'
import {
  activeSessions,
  addDays,
  dailySeries,
  dateKey,
  emptyHistoryFilter,
  emptyItemFilter,
  groupByItem,
  inPeriod,
  parseDate,
  periodBounds,
  searchHistory,
  totals,
} from './statistics'

const previousTZ = process.env.TZ
beforeEach(() => {
  process.env.TZ = 'Asia/Tokyo'
})
afterEach(() => {
  if (previousTZ === undefined) delete process.env.TZ
  else process.env.TZ = previousTZ
})
const at = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime()
const doc = emptyDocument()
function session(id: string, startedAt: number, overrides: Partial<Session> = {}): Session {
  return {
    id,
    startedAt,
    endedAt: startedAt + 1200_000,
    focusMs: 1200_000,
    correct: 0,
    incorrect: 0,
    memo: '',
    learning: doc.selection,
    createdAt: startedAt,
    updatedAt: startedAt,
    deletedAt: null,
    ...overrides,
  }
}

describe('ローカルカレンダーの期間境界', () => {
  it('今日の開始を含み、翌日の開始を含まない', () => {
    const today = at(2026, 10, 11)
    const next = at(2026, 10, 12)
    const sessions = [
      session('before', today - 1),
      session('start', today),
      session('last', next - 1),
      session('next', next),
    ]
    expect(inPeriod(sessions, 'today', today + 12345).map((s) => s.id)).toEqual(['last', 'start'])
    expect(periodBounds('today', today + 12345)).toEqual({ start: today, end: next })
  })
  it('日曜日も月曜開始の週に含め、次の月曜は除外する', () => {
    const sunday = at(2026, 10, 11, 23, 59)
    const monday = at(2026, 10, 5)
    const nextMonday = at(2026, 10, 12)
    expect(periodBounds('week', sunday)).toEqual({ start: monday, end: nextMonday })
    expect(
      inPeriod(
        [
          session('before', monday - 1),
          session('start', monday),
          session('sunday', sunday),
          session('next', nextMonday),
        ],
        'week',
        sunday,
      ).map((s) => s.id),
    ).toEqual(['sunday', 'start'])
  })
  it.each([
    [2026, 12, 2027, 1],
    [2027, 1, 2027, 2],
    [2028, 2, 2028, 3],
  ])('月末・年末・うるう年 %i/%i を暦で判定する', (year, month, nextYear, nextMonth) => {
    const start = at(year, month, 1),
      end = at(nextYear, nextMonth, 1)
    expect(periodBounds('month', end - 1)).toEqual({ start, end })
    expect(
      inPeriod(
        [
          session('before', start - 1),
          session('start', start),
          session('last', end - 1),
          session('end', end),
        ],
        'month',
        end - 1,
      ).map((s) => s.id),
    ).toEqual(['last', 'start'])
  })
  it('年をまたぐ週と全期間を扱う', () => {
    expect(periodBounds('week', at(2027, 1, 1))).toEqual({
      start: at(2026, 12, 28),
      end: at(2027, 1, 4),
    })
    expect(
      inPeriod(
        [session('old', at(2020, 1, 1)), session('new', at(2027, 1, 1))],
        'all',
        at(2026, 1, 1),
      ),
    ).toHaveLength(2)
  })
  it('日付またぎは全時間を開始日に帰属させる', () => {
    const crossing = session('crossing', at(2026, 12, 31, 23, 50), {
      endedAt: at(2027, 1, 1, 0, 30),
      focusMs: 2400_000,
    })
    expect(totals(inPeriod([crossing], 'today', at(2026, 12, 31))).focusMs).toBe(2400_000)
    expect(totals(inPeriod([crossing], 'today', at(2027, 1, 1))).focusMs).toBe(0)
  })
  it('タイムゾーンにより所属日が変わる', () => {
    const time = Date.parse('2026-10-10T16:00:00Z')
    expect(dateKey(time)).toBe('2026-10-11')
    process.env.TZ = 'UTC'
    expect(dateKey(time)).toBe('2026-10-10')
  })
  it('夏時間の23時間・25時間の日と週を固定ミリ秒で区切らない', () => {
    process.env.TZ = 'America/New_York'
    const spring = periodBounds('today', at(2026, 3, 8, 12))
    const fall = periodBounds('today', at(2026, 11, 1, 12))
    expect((spring.end! - spring.start!) / 3600_000).toBe(23)
    expect((fall.end! - fall.start!) / 3600_000).toBe(25)
    const week = periodBounds('week', at(2026, 3, 8))
    expect((week.end! - week.start!) / 3600_000).toBe(167)
    expect(dateKey(addDays(spring.start!, 1))).toBe('2026-03-09')
  })
  it('日付入力を検証し、終了日はその日の終わりまで含む', () => {
    expect(() => parseDate('2026-02-30')).toThrow()
    expect(() => parseDate('invalid')).toThrow()
    const filter = { ...emptyHistoryFilter(), from: '2026-12-31', to: '2026-12-31' }
    const result = searchHistory(
      [
        session('start', at(2026, 12, 31)),
        session('last', at(2027, 1, 1) - 1),
        session('next', at(2027, 1, 1)),
      ],
      doc.items,
      filter,
    )
    expect(result.map((s) => s.id)).toEqual(['last', 'start'])
    expect(() => searchHistory([], doc.items, { ...filter, from: '2027-01-01' })).toThrow('開始日')
  })
})

describe('集計と階層・検索', () => {
  it('正答率を加重集計し、問題数0も時間・セット・セッション数へ含める', () => {
    const sessions = [
      session('a', 1000, { correct: 90, incorrect: 10 }),
      session('b', 2000, { correct: 1, incorrect: 9, focusMs: 1800_000 }),
      session('zero', 3000, { focusMs: 3600_000 }),
    ]
    expect(totals(sessions)).toEqual({
      focusMs: 6600_000,
      sets: 3,
      sessions: 3,
      questions: 110,
      correct: 91,
      incorrect: 19,
      rate: (91 / 110) * 100,
    })
    expect(totals([sessions[2]]).rate).toBeNull()
    expect(totals([]).rate).toBeNull()
  })
  it('削除済み・重複IDを二重計上せず、最新の墓石を優先する', () => {
    const a = session('a', 1000)
    const deleted = { ...a, updatedAt: 2000, deletedAt: 2000 }
    expect(totals([a, a]).sessions).toBe(1)
    expect(totals([a, deleted])).toMatchObject({ sessions: 0, focusMs: 0 })
    expect(activeSessions([deleted, { ...a, updatedAt: 3000 }])).toHaveLength(1)
    expect(totals([{ ...a, updatedAt: 2000 }, deleted]).sessions).toBe(0)
  })
  it('教科・中項目・小項目をIDでまとめ、改名・アーカイブ済みも保持する', () => {
    const items = [
      ...doc.items.map((item) =>
        item.id === doc.selection.subjectId ? { ...item, name: '改名数学', archived: true } : item,
      ),
      {
        ...doc.items[0],
        id: 'm',
        name: '基礎',
        level: 'middle' as const,
        parentId: doc.selection.subjectId,
      },
      { ...doc.items[0], id: 's', name: '単元', level: 'small' as const, parentId: 'm' },
    ]
    const learning = learningFromIds(items, doc.selection.subjectId, 'm', 's')
    const records = [
      session('a', 1000, { learning: { ...learning, subject: '旧数学' }, correct: 1 }),
      session('b', 2000, { learning, incorrect: 3 }),
      session('optional', 3000),
    ]
    expect(groupByItem(records, items, 'subject')).toHaveLength(1)
    expect(groupByItem(records, items, 'subject')[0]).toMatchObject({
      id: doc.selection.subjectId,
      name: '改名数学',
      archived: true,
      questions: 4,
      correct: 1,
      rate: 25,
      sets: 3,
    })
    expect(groupByItem(records, items, 'middle').find((group) => group.id === 'm')?.sessions).toBe(
      2,
    )
    expect(groupByItem(records, items, 'middle').find((group) => group.id === null)?.name).toBe(
      '未選択',
    )
    expect(groupByItem(records, items, 'small').find((group) => group.id === 's')?.focusMs).toBe(
      2400_000,
    )
    expect(
      inPeriod(records, 'all', 0, {
        ...emptyItemFilter(),
        subjectId: doc.selection.subjectId,
        middleId: 'm',
        smallId: 's',
      }),
    ).toHaveLength(2)
  })
  it('期間・階層・複数キーワード・達成を組み合わせて開始日時順に検索する', () => {
    const a = session('a', at(2026, 10, 1), { memo: '復習 ABC', correct: 1 })
    const b = session('b', at(2026, 10, 2), { memo: '復習 ABC', focusMs: 60_000 })
    const c = session('c', at(2026, 10, 3), { memo: '別のメモ' })
    const filter = {
      ...emptyHistoryFilter(),
      from: '2026-10-01',
      to: '2026-10-02',
      keyword: '復習 ＡＢＣ',
      subjectId: a.learning.subjectId,
      achievement: 'achieved' as const,
    }
    expect(searchHistory([c, b, a], doc.items, filter).map((s) => s.id)).toEqual(['a'])
    expect(searchHistory([a, b, c], doc.items, emptyHistoryFilter()).map((s) => s.id)).toEqual([
      'c',
      'b',
      'a',
    ])
    const items = doc.items.map((item) =>
      item.id === a.learning.subjectId ? { ...item, name: '新しい名前' } : item,
    )
    expect(
      searchHistory([a], items, { ...emptyHistoryFilter(), keyword: '新しい名前' }),
    ).toHaveLength(1)
    expect(searchHistory([a], items, { ...emptyHistoryFilter(), keyword: '数学' })).toHaveLength(1)
    expect(
      searchHistory([{ ...a, deletedAt: 9999 }], items, { ...emptyHistoryFilter(), deleted: true }),
    ).toHaveLength(1)
  })
  it('日別グラフに空の日を補い、全期間は直近30日だけ描画する', () => {
    const now = at(2026, 10, 11)
    const records = [
      session('old', at(2020, 1, 1)),
      session('today', now, { correct: 1, incorrect: 1 }),
    ]
    expect(dailySeries(records, 'today', now)[0]).toMatchObject({ sessions: 1, rate: 50 })
    expect(dailySeries(records, 'week', now)).toHaveLength(7)
    expect(dailySeries(records, 'month', now)).toHaveLength(31)
    const all = dailySeries(records, 'all', now)
    expect(all).toHaveLength(30)
    expect(all[0].label).toBe('2026-09-12')
    expect(all.at(-1)?.label).toBe('2026-10-11')
    expect(all[0].rate).toBeNull()
    expect(totals(inPeriod(records, 'all', now)).sessions).toBe(2)
  })
})
