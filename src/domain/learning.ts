import { z } from 'zod'
import { v5 as uuidv5 } from 'uuid'

export const INITIAL_SUBJECTS = ['国語', '数学', '英語', '理科', '社会', '情報', 'その他'] as const
export const stableId = (key: string) => uuidv5(`pomolog:${key}`, uuidv5.URL)
export const normalizeName = (name: string) => name.trim().normalize('NFKC')
export const itemSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  level: z.enum(['subject', 'middle', 'small']),
  name: z.string().trim().min(1).max(100),
  order: z.number().int().nonnegative(),
  archived: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  templateKeys: z.array(z.string().min(1)),
})
export type StudyItem = z.infer<typeof itemSchema>
export const learningSchema = z.object({
  subjectId: z.string().min(1).nullable(),
  middleId: z.string().min(1).nullable(),
  smallId: z.string().min(1).nullable(),
  subject: z.string().max(100),
  middle: z.string().max(100),
  small: z.string().max(100),
})
export type Learning = z.infer<typeof learningSchema>
export const emptyLearning = (): Learning => ({
  subjectId: null,
  middleId: null,
  smallId: null,
  subject: '',
  middle: '',
  small: '',
})

export function initialItems(): StudyItem[] {
  return INITIAL_SUBJECTS.map((name, order) => ({
    id: stableId(`initial:${name}`),
    name,
    level: 'subject',
    parentId: null,
    order,
    archived: false,
    createdAt: 0,
    updatedAt: 0,
    templateKeys: [],
  }))
}

export function children(
  items: StudyItem[],
  level: StudyItem['level'],
  parentId: string | null,
  includeArchived = false,
): StudyItem[] {
  return items
    .filter(
      (item) =>
        item.level === level &&
        item.parentId === parentId &&
        (includeArchived || isAvailable(items, item.id)),
    )
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}
export function isAvailable(items: StudyItem[], id: string): boolean {
  const byId = new Map(items.map((item) => [item.id, item]))
  let item = byId.get(id)
  const visited = new Set<string>()
  while (item) {
    if (item.archived || visited.has(item.id)) return false
    visited.add(item.id)
    if (item.parentId === null) return item.level === 'subject'
    item = byId.get(item.parentId)
  }
  return false
}
export function validLearning(items: StudyItem[], learning: Learning, required = true): boolean {
  const subject = items.find((item) => item.id === learning.subjectId)
  const middle = items.find((item) => item.id === learning.middleId)
  const small = items.find((item) => item.id === learning.smallId)
  if (!subject)
    return (
      !required &&
      learning.subjectId === null &&
      learning.middleId === null &&
      learning.smallId === null
    )
  return (
    subject.level === 'subject' &&
    (learning.middleId === null
      ? learning.smallId === null
      : Boolean(middle?.level === 'middle' && middle.parentId === subject.id)) &&
    (learning.smallId === null ||
      Boolean(small?.level === 'small' && small.parentId === middle?.id))
  )
}
export function learningFromIds(
  items: StudyItem[],
  subjectId: string | null,
  middleId: string | null = null,
  smallId: string | null = null,
): Learning {
  const learning = {
    subjectId,
    middleId,
    smallId,
    subject: items.find((item) => item.id === subjectId)?.name ?? '',
    middle: items.find((item) => item.id === middleId)?.name ?? '',
    small: items.find((item) => item.id === smallId)?.name ?? '',
  }
  if (!validLearning(items, learning, false)) throw new Error('学習項目の親子関係が不正です。')
  return learning
}
export function samePath(a: Learning, b: Learning): boolean {
  return a.subjectId === b.subjectId && a.middleId === b.middleId && a.smallId === b.smallId
}
export function acceptLearning(items: StudyItem[], input: Learning, existing?: Learning): Learning {
  learningSchema.parse(input)
  if (!validLearning(items, input))
    throw new Error('教科と親項目に紐づく学習項目を選択してください。')
  if (existing && samePath(existing, input)) return { ...existing }
  if (
    [input.subjectId, input.middleId, input.smallId].some(
      (id) => id !== null && !isAvailable(items, id),
    )
  )
    throw new Error('アーカイブ済みの項目は新しく選択できません。')
  return learningFromIds(items, input.subjectId, input.middleId, input.smallId)
}
export function nextSelection(items: StudyItem[], selection: Learning): Learning {
  if (selection.subjectId && isAvailable(items, selection.subjectId)) {
    const middleId =
      selection.middleId && isAvailable(items, selection.middleId) ? selection.middleId : null
    const smallId =
      middleId && selection.smallId && isAvailable(items, selection.smallId)
        ? selection.smallId
        : null
    return learningFromIds(items, selection.subjectId, middleId, smallId)
  }
  return learningFromIds(items, children(items, 'subject', null)[0]?.id ?? null)
}

export type ItemAction =
  | {
      type: 'item-add'
      id: string
      level: StudyItem['level']
      parentId: string | null
      name: string
    }
  | { type: 'item-rename'; id: string; name: string }
  | { type: 'item-archive'; id: string; archived: boolean }
  | { type: 'item-move'; id: string; direction: -1 | 1 }

export function mutateItems(items: StudyItem[], action: ItemAction, now: number): StudyItem[] {
  if (action.type === 'item-add') {
    const name = itemSchema.shape.name.parse(action.name)
    if (items.some((item) => item.id === action.id)) throw new Error('項目IDが重複しています。')
    const parent = items.find((item) => item.id === action.parentId)
    if (
      action.level === 'subject'
        ? action.parentId !== null
        : !parent ||
          !isAvailable(items, parent.id) ||
          parent.level !== (action.level === 'middle' ? 'subject' : 'middle')
    )
      throw new Error('有効な親項目を選択してください。')
    if (
      items.some(
        (item) =>
          item.parentId === action.parentId && normalizeName(item.name) === normalizeName(name),
      )
    )
      throw new Error('同じ親に同名の項目があります。アーカイブ済みなら復元できます。')
    const order =
      Math.max(
        -1,
        ...items.filter((item) => item.parentId === action.parentId).map((item) => item.order),
      ) + 1
    return [
      ...items,
      itemSchema.parse({
        ...action,
        name,
        order,
        archived: false,
        createdAt: now,
        updatedAt: now,
        templateKeys: [],
      }),
    ]
  }
  const item = items.find((item) => item.id === action.id)
  if (!item) throw new Error('項目が見つかりません。')
  if (action.type === 'item-rename') {
    const name = itemSchema.shape.name.parse(action.name)
    if (
      items.some(
        (other) =>
          other.id !== item.id &&
          other.parentId === item.parentId &&
          normalizeName(other.name) === normalizeName(name),
      )
    )
      throw new Error('同じ親に同名の項目があります。')
    if (name === item.name) return items
    return items.map((other) => (other.id === item.id ? { ...other, name, updatedAt: now } : other))
  }
  if (action.type === 'item-archive') {
    if (item.archived === action.archived) return items
    if (!action.archived && item.parentId && !isAvailable(items, item.parentId))
      throw new Error('親項目を先に復元してください。')
    return items.map((other) =>
      other.id === item.id ? { ...other, archived: action.archived, updatedAt: now } : other,
    )
  }
  const siblings = children(items, item.level, item.parentId)
  const index = siblings.findIndex((other) => other.id === item.id)
  const target = index + action.direction
  if (index < 0 || target < 0 || target >= siblings.length) return items
  ;[siblings[index], siblings[target]] = [siblings[target], siblings[index]]
  // Reindex all siblings (including hidden ones) so equal ranks cannot break a swap.
  const ordered = [
    ...siblings,
    ...children(items, item.level, item.parentId, true).filter(
      (other) => !siblings.some((visible) => visible.id === other.id),
    ),
  ]
  const ranks = new Map(ordered.map((other, rank) => [other.id, rank]))
  return items.map((other) =>
    ranks.has(other.id) ? { ...other, order: ranks.get(other.id)!, updatedAt: now } : other,
  )
}

export function validateItems(items: StudyItem[]): boolean {
  const ids = new Set<string>()
  const sources = new Set<string>()
  for (const item of items) {
    if (ids.has(item.id)) return false
    ids.add(item.id)
    for (const key of item.templateKeys) {
      if (sources.has(key)) return false
      sources.add(key)
    }
    const parent = items.find((other) => other.id === item.parentId)
    if (
      item.level === 'subject'
        ? item.parentId !== null
        : !parent || parent.level !== (item.level === 'middle' ? 'subject' : 'middle')
    )
      return false
  }
  return true
}
