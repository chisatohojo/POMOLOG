import { accuracy, achieved, learningLabel } from './model'
import type { Session } from './model'
import { normalizeName } from './learning'
import type { StudyItem } from './learning'

export type Period = 'today' | 'week' | 'month' | 'all'
export interface ItemFilter {
  subjectId: string | null
  middleId: string | null
  smallId: string | null
}
export const emptyItemFilter = (): ItemFilter => ({
  subjectId: null,
  middleId: null,
  smallId: null,
})
export interface HistoryFilter extends ItemFilter {
  from: string
  to: string
  keyword: string
  achievement: 'all' | 'achieved' | 'unachieved'
  deleted: boolean
}
export const emptyHistoryFilter = (): HistoryFilter => ({
  ...emptyItemFilter(),
  from: '',
  to: '',
  keyword: '',
  achievement: 'all',
  deleted: false,
})
export interface Totals {
  focusMs: number
  sets: number
  sessions: number
  correct: number
  incorrect: number
  questions: number
  rate: number | null
}

export function dayStart(time: number): number {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}
export function addDays(time: number, days: number): number {
  const date = new Date(time)
  date.setDate(date.getDate() + days)
  return date.getTime()
}
export function dateKey(time: number): string {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function parseDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('期間の日付を確認してください。')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  date.setHours(0, 0, 0, 0)
  if (!Number.isFinite(date.getTime()) || dateKey(date.getTime()) !== value)
    throw new Error('期間の日付を確認してください。')
  return date.getTime()
}
export function periodBounds(
  period: Period,
  now: number,
): { start: number | null; end: number | null } {
  const today = dayStart(now)
  if (period === 'all') return { start: null, end: null }
  if (period === 'today') return { start: today, end: addDays(today, 1) }
  if (period === 'week') {
    const start = addDays(today, -((new Date(today).getDay() + 6) % 7))
    return { start, end: addDays(start, 7) }
  }
  const date = new Date(today)
  date.setDate(1)
  const start = date.getTime()
  date.setMonth(date.getMonth() + 1)
  return { start, end: date.getTime() }
}

// A validated document already guarantees unique IDs. This also guards merged inputs.
export function uniqueSessions(sessions: Session[]): Session[] {
  const byId = new Map<string, Session>()
  for (const session of sessions) {
    const previous = byId.get(session.id)
    if (
      !previous ||
      session.updatedAt > previous.updatedAt ||
      (session.updatedAt === previous.updatedAt && session.deletedAt !== null)
    )
      byId.set(session.id, session)
  }
  return [...byId.values()]
}
export function activeSessions(sessions: Session[]): Session[] {
  return uniqueSessions(sessions)
    .filter((session) => session.deletedAt === null)
    .sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id))
}
export function matchesItems(session: Session, filter: ItemFilter): boolean {
  return (
    (!filter.subjectId || session.learning.subjectId === filter.subjectId) &&
    (!filter.middleId || session.learning.middleId === filter.middleId) &&
    (!filter.smallId || session.learning.smallId === filter.smallId)
  )
}
export function inPeriod(
  sessions: Session[],
  period: Period,
  now: number,
  filter: ItemFilter = emptyItemFilter(),
): Session[] {
  const { start, end } = periodBounds(period, now)
  return activeSessions(sessions).filter(
    (session) =>
      (start === null || session.startedAt >= start) &&
      (end === null || session.startedAt < end) &&
      matchesItems(session, filter),
  )
}
export function totals(sessions: Session[]): Totals {
  const active = activeSessions(sessions)
  const correct = active.reduce((sum, session) => sum + session.correct, 0)
  const incorrect = active.reduce((sum, session) => sum + session.incorrect, 0)
  return {
    focusMs: active.reduce((sum, session) => sum + session.focusMs, 0),
    sets: active.filter((session) => achieved(session.focusMs)).length,
    sessions: active.length,
    correct,
    incorrect,
    questions: correct + incorrect,
    rate: accuracy(correct, incorrect),
  }
}
export function searchHistory(
  sessions: Session[],
  items: StudyItem[],
  filter: HistoryFilter,
): Session[] {
  const start = filter.from ? parseDate(filter.from) : null
  const end = filter.to ? addDays(parseDate(filter.to), 1) : null
  if (start !== null && end !== null && start >= end)
    throw new Error('期間の開始日は終了日以前にしてください。')
  const terms = normalizeName(filter.keyword).toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return uniqueSessions(sessions)
    .filter((session) => {
      if (
        (session.deletedAt !== null) !== filter.deleted ||
        !matchesItems(session, filter) ||
        (start !== null && session.startedAt < start) ||
        (end !== null && session.startedAt >= end) ||
        (filter.achievement === 'achieved' && !achieved(session.focusMs)) ||
        (filter.achievement === 'unachieved' && achieved(session.focusMs))
      )
        return false
      const currentNames = [
        session.learning.subjectId,
        session.learning.middleId,
        session.learning.smallId,
      ]
        .map((id) => items.find((item) => item.id === id)?.name ?? '')
        .join(' ')
      const haystack = normalizeName(
        `${learningLabel(session.learning)} ${currentNames} ${session.memo}`,
      ).toLocaleLowerCase()
      return terms.every((term) => haystack.includes(term))
    })
    .sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id))
}
export interface ItemTotals extends Totals {
  id: string | null
  name: string
  archived: boolean
}
export function groupByItem(
  sessions: Session[],
  items: StudyItem[],
  level: StudyItem['level'],
): ItemTotals[] {
  const groups = new Map<string | null, Session[]>()
  for (const session of activeSessions(sessions)) {
    const id = session.learning[`${level}Id`]
    groups.set(id, [...(groups.get(id) ?? []), session])
  }
  return [...groups.entries()]
    .map(([id, records]) => {
      const item = items.find((item) => item.id === id)
      return {
        id,
        name: item?.name ?? (id ? records[0].learning[level] : '未選択'),
        archived: item?.archived ?? false,
        ...totals(records),
      }
    })
    .sort((a, b) => b.focusMs - a.focusMs || (a.id ?? '').localeCompare(b.id ?? ''))
}
export interface DailyTotals extends Totals {
  day: number
  label: string
}
export function dailySeries(sessions: Session[], period: Period, now: number): DailyTotals[] {
  const bounds = periodBounds(period, now)
  const start = bounds.start ?? addDays(dayStart(now), -29)
  const end = bounds.end ?? addDays(dayStart(now), 1)
  const groups = new Map<string, Session[]>()
  for (const session of activeSessions(sessions)) {
    const key = dateKey(session.startedAt)
    groups.set(key, [...(groups.get(key) ?? []), session])
  }
  const days: DailyTotals[] = []
  for (let day = start; day < end; day = addDays(day, 1))
    days.push({ day, label: dateKey(day), ...totals(groups.get(dateKey(day)) ?? []) })
  return days
}
export const rateLabel = (rate: number | null) =>
  rate === null ? '—' : `${Math.round(rate * 10) / 10}%`
export const DATE_RULE =
  '端末のローカル時間・開始日で集計。週は月曜日始まり。日付をまたぐ学習も集中時間全体を開始日に含めます。進行中・削除済みの記録は含みません。'
