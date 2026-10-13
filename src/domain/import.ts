import type { AppDocument } from './model'
import { isAvailable, normalizeName, validateItems, validLearning } from './learning'
import type { Learning, StudyItem } from './learning'

export interface ImportConflict {
  id: string
  name: string
  level: StudyItem['level']
  reasons: string[]
}

// Resolve parents before children. UUID identity wins over names after a rename.
// All changes are staged; an ambiguous match aborts the entire import.
export function planImport(current: AppDocument, incoming: AppDocument) {
  const items = [...current.items]
  const byId = new Map(items.map((item) => [item.id, item]))
  const currentIds = new Set(byId.keys())
  const idMap = new Map<string, string>()
  const conflicts = new Map<string, ImportConflict>()
  const conflict = (item: StudyItem, reason: string) => {
    const entry = conflicts.get(item.id) ?? {
      id: item.id,
      name: item.name,
      level: item.level,
      reasons: [],
    }
    entry.reasons.push(reason)
    conflicts.set(item.id, entry)
  }
  let mergedItems = 0
  for (const level of ['subject', 'middle', 'small'] as const) {
    const layer = incoming.items.filter((item) => item.level === level)
    const ordered = [
      ...layer.filter((item) => currentIds.has(item.id)),
      ...layer.filter((item) => !currentIds.has(item.id)),
    ]
    for (const item of ordered) {
      const parentId = item.parentId === null ? null : idMap.get(item.parentId)
      if (parentId === undefined) {
        conflict(item, `親項目「${item.parentId}」の統合先を確定できません。`)
        continue
      }
      const existing = byId.get(item.id)
      if (existing) {
        if (existing.level !== item.level || existing.parentId !== parentId) {
          conflict(item, '同じ学習項目IDの階層・親が異なります。')
          continue
        }
        idMap.set(item.id, existing.id)
        continue
      }
      const candidates = items.filter(
        (other) =>
          other.level === level &&
          other.parentId === parentId &&
          normalizeName(other.name) === normalizeName(item.name),
      )
      if (candidates.length > 1) {
        conflict(
          item,
          `同名の統合候補が複数あります（${candidates.map((other) => other.id).join('、')}）。`,
        )
        continue
      }
      if (candidates.length === 1) {
        idMap.set(item.id, candidates[0].id)
        mergedItems++
        continue
      }
      const aliases = layer.filter(
        (other) =>
          !currentIds.has(other.id) &&
          normalizeName(other.name) === normalizeName(item.name) &&
          (other.parentId === null ? null : idMap.get(other.parentId)) === parentId,
      )
      if (aliases.length > 1) {
        conflict(
          item,
          `取り込み元に同名項目が複数あり、統合先IDを決められません（${aliases.map((other) => other.id).join('、')}）。`,
        )
        continue
      }
      const siblings = items.filter((other) => other.parentId === parentId)
      const next = {
        ...item,
        parentId,
        templateKeys: [],
        order: Math.max(-1, ...siblings.map((other) => other.order)) + 1,
      }
      items.push(next)
      byId.set(next.id, next)
      idMap.set(item.id, next.id)
    }
  }
  // Transfer provenance only after resolution; existing keys never move owners.
  const templateOwners = new Map(
    current.items.flatMap((item) => item.templateKeys.map((key) => [key, item.id])),
  )
  const updatedIds = new Set<string>()
  for (const item of incoming.items) {
    const targetId = idMap.get(item.id)
    if (!targetId) continue
    for (const key of item.templateKeys) {
      const owner = templateOwners.get(key)
      if (owner && owner !== targetId) {
        conflict(item, `テンプレート識別子「${key}」が別の項目「${owner}」と競合しています。`)
        continue
      }
      templateOwners.set(key, targetId)
      const target = byId.get(targetId)!
      if (!target.templateKeys.includes(key)) {
        const next = {
          ...target,
          templateKeys: [...target.templateKeys, key],
          updatedAt: currentIds.has(targetId)
            ? Math.max(target.updatedAt + 1, item.updatedAt)
            : target.updatedAt,
        }
        items[items.findIndex((other) => other.id === targetId)] = next
        byId.set(targetId, next)
        if (currentIds.has(targetId)) updatedIds.add(targetId)
      }
    }
  }
  const remap = (learning: Learning): Learning => ({
    ...learning,
    subjectId: learning.subjectId === null ? null : idMap.get(learning.subjectId)!,
    middleId: learning.middleId === null ? null : idMap.get(learning.middleId)!,
    smallId: learning.smallId === null ? null : idMap.get(learning.smallId)!,
  })
  const records = new Map(current.sessions.map((session) => [session.id, session]))
  const ids = new Set(records.keys())
  if (current.timer) ids.add(current.timer.id)
  const added = incoming.sessions.filter((session) => !ids.has(session.id))
  const duplicates = incoming.sessions.filter((session) => ids.has(session.id))
  const mapped = added.map((session) => ({ ...session, learning: remap(session.learning) }))
  const archivedMatches = incoming.items
    .filter((item) => {
      const targetId = idMap.get(item.id)
      return targetId && currentIds.has(targetId) && !isAvailable(items, targetId)
    })
    .map((item) => ({
      sourceId: item.id,
      targetId: idMap.get(item.id)!,
      name: byId.get(idMap.get(item.id)!)!.name,
    }))
  const document = { ...current, items, sessions: [...current.sessions, ...mapped] }
  if (
    !conflicts.size &&
    (!validateItems(items) ||
      document.sessions.some((session) => !validLearning(items, session.learning)))
  )
    throw new Error('統合後の学習項目参照・親子関係を検証できません。取り込みを中止しました。')
  return {
    document: conflicts.size ? null : document,
    idMap,
    conflicts: [...conflicts.values()],
    mergedItems,
    archivedMatches,
    updatedItems: updatedIds.size,
    hasChanges: added.length > 0 || items.length > current.items.length || updatedIds.size > 0,
    added: added.length,
    addedDeleted: added.filter((session) => session.deletedAt !== null).length,
    skipped: duplicates.length,
    changedDuplicates: duplicates.filter((session) => {
      const existing = records.get(session.id)
      return (
        !existing ||
        JSON.stringify(existing) !==
          JSON.stringify({ ...session, learning: remap(session.learning) })
      )
    }).length,
    addedItems: items.length - current.items.length,
  }
}
