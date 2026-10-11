import type { AppDocument } from './model'
import { normalizeName } from './learning'

// IDs are identities, not names. Existing records (including tombstones) always win.
export function planImport(current: AppDocument, incoming: AppDocument) {
  const items = [...current.items]
  const byId = new Map(items.map((item) => [item.id, item]))
  const templateOwners = new Map(
    items.flatMap((item) => item.templateKeys.map((key) => [key, item.id])),
  )
  let sameNames = 0
  for (const level of ['subject', 'middle', 'small'] as const) {
    for (const item of incoming.items.filter((item) => item.level === level)) {
      const existing = byId.get(item.id)
      if (existing) {
        if (existing.level !== item.level || existing.parentId !== item.parentId)
          throw new Error('同じ学習項目IDの階層・親が異なります。取り込みを中止しました。')
        continue
      }
      if (item.templateKeys.some((key) => templateOwners.has(key)))
        throw new Error(
          'テンプレートの識別子が別の項目IDと競合しています。取り込みを中止しました。',
        )
      const siblings = items.filter((other) => other.parentId === item.parentId)
      if (siblings.some((other) => normalizeName(other.name) === normalizeName(item.name)))
        sameNames++
      const next = { ...item, order: Math.max(-1, ...siblings.map((other) => other.order)) + 1 }
      items.push(next)
      byId.set(next.id, next)
      next.templateKeys.forEach((key) => templateOwners.set(key, next.id))
    }
  }
  const records = new Map(current.sessions.map((session) => [session.id, session]))
  const ids = new Set(records.keys())
  if (current.timer) ids.add(current.timer.id)
  const added = incoming.sessions.filter((session) => !ids.has(session.id))
  const duplicates = incoming.sessions.filter((session) => ids.has(session.id))
  return {
    document: { ...current, items, sessions: [...current.sessions, ...added] },
    added: added.length,
    addedDeleted: added.filter((session) => session.deletedAt !== null).length,
    skipped: duplicates.length,
    changedDuplicates: duplicates.filter((session) => {
      const existing = records.get(session.id)
      return !existing || JSON.stringify(existing) !== JSON.stringify(session)
    }).length,
    addedItems: items.length - current.items.length,
    sameNames,
  }
}
