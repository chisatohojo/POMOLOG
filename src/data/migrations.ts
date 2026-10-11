import { legacyDocumentSchema } from './legacyV1'
import { documentSchema } from '../domain/model'
import type { AppDocument } from '../domain/model'
import { initialItems, normalizeName, stableId } from '../domain/learning'
import type { StudyItem, Learning } from '../domain/learning'
import { legacyV2Schema } from './legacyV2'
import type { z } from 'zod'

// Pure and deterministic: reading in a waiting tab never writes or generates new IDs.
export function migrateV1(value: unknown): z.infer<typeof legacyV2Schema> {
  const old = legacyDocumentSchema.parse(value)
  const items = initialItems()
  function ensure(name: string, level: StudyItem['level'], parentId: string | null): string {
    const canonical = normalizeName(name)
    const existing = items.find(
      (item) => item.parentId === parentId && normalizeName(item.name) === canonical,
    )
    if (existing) return existing.id
    const id = stableId(`legacy:${JSON.stringify([parentId, canonical])}`)
    items.push({
      id,
      parentId,
      level,
      name: name.trim(),
      order: items.filter((item) => item.parentId === parentId).length,
      archived: false,
      createdAt: 0,
      updatedAt: 0,
      templateKeys: [],
    })
    return id
  }
  function learning(input: { subject: string; middle: string; small: string }): Learning {
    const subjectId = ensure(input.subject.trim() || '未分類（旧データ）', 'subject', null)
    const middleId =
      input.middle.trim() || input.small.trim()
        ? ensure(input.middle.trim() || '未分類（旧データ）', 'middle', subjectId)
        : null
    const smallId = input.small.trim() ? ensure(input.small, 'small', middleId) : null
    // Keep exact historical labels; only item master names are canonicalized.
    return { ...input, subjectId, middleId, smallId }
  }
  const selection = learning(old.selection)
  const timer = old.timer ? { ...old.timer, learning: learning(old.timer.learning) } : null
  const sessions = old.sessions.map((session) => ({
    ...session,
    learning: learning(session.learning),
  }))
  return legacyV2Schema.parse({ ...old, schemaVersion: 2, items, selection, timer, sessions })
}

export function migrateV2(value: unknown): AppDocument {
  const old = legacyV2Schema.parse(value)
  return documentSchema.parse({
    ...old,
    schemaVersion: 3,
    sessions: old.sessions.map((session) => ({ ...session, deletedAt: null })),
  })
}
