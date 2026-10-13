import { z } from 'zod'
import {
  learningSchema,
  itemSchema,
  initialItems,
  learningFromIds,
  acceptLearning,
  nextSelection,
  mutateItems,
  validateItems,
  validLearning,
} from './learning'
import type { ItemAction } from './learning'
import { applyTemplates } from './templates'
import { planImport } from './import'
export { learningSchema } from './learning'

export const ACHIEVEMENT_MS = 20 * 60_000
export const NOTIFICATION_MS = 25 * 60_000

const timestamp = z.number().int().nonnegative()
const count = z.number().int().min(0).max(1_000_000)
export const recordSchema = z.object({
  learning: learningSchema,
  correct: count,
  incorrect: count,
  memo: z.string().max(10_000),
})
export const timerSchema = recordSchema
  .extend({
    id: z.string().min(1),
    status: z.enum(['running', 'paused', 'break', 'review']),
    startedAt: timestamp,
    endedAt: timestamp.nullable(),
    activeSince: timestamp.nullable(),
    accumulatedMs: timestamp,
    notificationSent: z.boolean(),
    undo: z.array(z.enum(['correct', 'incorrect'])).max(1000),
  })
  .superRefine((timer, ctx) => {
    if ((timer.status === 'running') !== (timer.activeSince !== null)) {
      ctx.addIssue({ code: 'custom', message: '集中状態と計測開始時刻が一致しません' })
    }
    if ((timer.status === 'review') !== (timer.endedAt !== null)) {
      ctx.addIssue({ code: 'custom', message: '確認状態と終了時刻が一致しません' })
    }
    if (timer.endedAt !== null && timer.endedAt < timer.startedAt) {
      ctx.addIssue({ code: 'custom', message: '終了時刻が開始時刻より前です' })
    }
  })
export const sessionSchema = recordSchema
  .extend({
    id: z.string().min(1),
    startedAt: timestamp,
    endedAt: timestamp,
    focusMs: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: timestamp.nullable(),
  })
  .refine(
    (s) => s.endedAt >= s.startedAt && s.focusMs <= s.endedAt - s.startedAt,
    '集中時間または開始・終了時刻が不正です',
  )
export const documentSchema = z
  .object({
    schemaVersion: z.literal(3),
    items: z.array(itemSchema),
    revision: z.number().int().nonnegative(),
    selection: learningSchema,
    timer: timerSchema.nullable(),
    sessions: z.array(sessionSchema),
  })
  .superRefine((doc, ctx) => {
    if (
      !validateItems(doc.items) ||
      !validLearning(doc.items, doc.selection, false) ||
      (doc.timer && !validLearning(doc.items, doc.timer.learning)) ||
      doc.sessions.some((session) => !validLearning(doc.items, session.learning))
    )
      ctx.addIssue({ code: 'custom', message: '学習項目のIDまたは親子関係が不正です。' })
    if (new Set(doc.sessions.map((session) => session.id)).size !== doc.sessions.length)
      ctx.addIssue({ code: 'custom', message: '学習記録のIDが重複しています。' })
  })

export type Learning = z.infer<typeof learningSchema>
export type RecordFields = z.infer<typeof recordSchema>
export type Timer = z.infer<typeof timerSchema>
export type Session = z.infer<typeof sessionSchema>
export type AppDocument = z.infer<typeof documentSchema>

export function emptyDocument(): AppDocument {
  const items = initialItems()
  return {
    schemaVersion: 3,
    items,
    revision: 0,
    selection: learningFromIds(items, items[1].id),
    timer: null,
    sessions: [],
  }
}

export function elapsedMs(timer: Timer | null, now: number): number {
  if (!timer) return 0
  return (
    timer.accumulatedMs + (timer.activeSince === null ? 0 : Math.max(0, now - timer.activeSince))
  )
}

export function achieved(focusMs: number): boolean {
  return focusMs >= ACHIEVEMENT_MS
}
export function accuracy(correct: number, incorrect: number): number | null {
  return correct + incorrect === 0 ? null : (correct / (correct + incorrect)) * 100
}
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
export function learningLabel(learning: Learning): string {
  return [learning.subject, learning.middle, learning.small].filter(Boolean).join(' / ')
}

export type Action =
  | { type: 'import-data'; document: AppDocument; expectedRevision: number }
  | { type: 'session-edit'; id: string; expectedUpdatedAt: number; fields: SessionContent }
  | { type: 'session-delete' | 'session-restore'; id: string; expectedUpdatedAt: number }
  | ItemAction
  | { type: 'apply-templates'; ids: string[] }
  | { type: 'start'; id: string }
  | { type: 'pause' | 'break' | 'resume' | 'finish' | 'claim-notification' | 'undo' }
  | { type: 'select'; learning: Learning }
  | { type: 'edit'; fields: RecordFields }
  | { type: 'count'; kind: 'correct' | 'incorrect' }
  | {
      type: 'save'
      session: Pick<
        Session,
        'learning' | 'correct' | 'incorrect' | 'memo' | 'startedAt' | 'endedAt' | 'focusMs'
      >
    }

export type SessionContent = Pick<
  Session,
  'learning' | 'correct' | 'incorrect' | 'memo' | 'startedAt' | 'endedAt' | 'focusMs'
>

// Time is supplied explicitly: a rendering interval never mutates elapsed time.
export function transition(doc: AppDocument, action: Action, now: number): AppDocument {
  if (action.type === 'import-data') {
    if (doc.revision !== action.expectedRevision)
      throw new Error('プレビュー後にデータが更新されました。最新データで再確認してください。')
    const plan = planImport(doc, documentSchema.parse(action.document))
    if (!plan.document)
      throw new Error(
        `学習項目を統合できません。${plan.conflicts.map((item) => `「${item.name}」（${item.id}）: ${item.reasons.join(' ')}`).join(' ')}`,
      )
    if (!plan.hasChanges) return doc
    return documentSchema.parse(plan.document)
  }
  if (
    action.type === 'session-edit' ||
    action.type === 'session-delete' ||
    action.type === 'session-restore'
  ) {
    const existing = doc.sessions.find((session) => session.id === action.id)
    if (!existing) throw new Error('学習記録が見つかりません。')
    if (existing.updatedAt !== action.expectedUpdatedAt)
      throw new Error('この記録は更新されています。編集を閉じ、最新の内容を確認してください。')
    if (
      (action.type === 'session-delete' && existing.deletedAt !== null) ||
      (action.type === 'session-restore' && existing.deletedAt === null)
    )
      return doc
    if (action.type === 'session-edit' && existing.deletedAt !== null)
      throw new Error('削除済みの記録は復元してから編集してください。')
    const updatedAt = Math.max(now, existing.updatedAt + 1)
    const next = sessionSchema.parse(
      action.type === 'session-edit'
        ? {
            ...existing,
            ...action.fields,
            id: existing.id,
            createdAt: existing.createdAt,
            deletedAt: null,
            updatedAt,
            learning: acceptLearning(doc.items, action.fields.learning, existing.learning),
          }
        : {
            ...existing,
            updatedAt,
            deletedAt: action.type === 'session-delete' ? updatedAt : null,
          },
    )
    return {
      ...doc,
      sessions: doc.sessions.map((session) => (session.id === existing.id ? next : session)),
    }
  }
  if (
    action.type === 'item-add' ||
    action.type === 'item-rename' ||
    action.type === 'item-archive' ||
    action.type === 'item-move' ||
    action.type === 'apply-templates'
  ) {
    const items =
      action.type === 'apply-templates'
        ? applyTemplates(doc.items, action.ids, now)
        : mutateItems(doc.items, action, now)
    return items === doc.items
      ? doc
      : { ...doc, items, selection: nextSelection(items, doc.selection) }
  }
  const timer = doc.timer
  switch (action.type) {
    case 'start':
      if (timer) return doc
      return {
        ...doc,
        timer: {
          id: action.id,
          status: 'running',
          startedAt: now,
          activeSince: now,
          accumulatedMs: 0,
          endedAt: null,
          notificationSent: false,
          learning: acceptLearning(doc.items, doc.selection),
          correct: 0,
          incorrect: 0,
          memo: '',
          undo: [],
        },
      }
    case 'select':
      if (timer) return doc
      return { ...doc, selection: acceptLearning(doc.items, action.learning) }
    case 'pause':
    case 'break':
      if (!timer || timer.status !== 'running') return doc
      return {
        ...doc,
        timer: {
          ...timer,
          status: action.type === 'pause' ? 'paused' : 'break',
          accumulatedMs: elapsedMs(timer, now),
          activeSince: null,
        },
      }
    case 'resume':
      if (!timer || !['paused', 'break'].includes(timer.status)) return doc
      return { ...doc, timer: { ...timer, status: 'running', activeSince: now } }
    case 'finish':
      if (!timer || timer.status === 'review') return doc
      return {
        ...doc,
        timer: {
          ...timer,
          status: 'review',
          accumulatedMs: elapsedMs(timer, now),
          activeSince: null,
          endedAt: Math.max(now, timer.startedAt),
        },
      }
    case 'claim-notification':
      if (
        !timer ||
        timer.status === 'review' ||
        timer.notificationSent ||
        elapsedMs(timer, now) < NOTIFICATION_MS
      )
        return doc
      return { ...doc, timer: { ...timer, notificationSent: true } }
    case 'edit':
      if (!timer) return doc
      return {
        ...doc,
        timer: {
          ...timer,
          ...recordSchema.parse(action.fields),
          learning: acceptLearning(doc.items, action.fields.learning, timer.learning),
          undo:
            action.fields.correct !== timer.correct || action.fields.incorrect !== timer.incorrect
              ? []
              : timer.undo,
        },
      }
    case 'count':
      if (!timer || timer.status === 'review' || timer[action.kind] >= 1_000_000) return doc
      return {
        ...doc,
        timer: {
          ...timer,
          [action.kind]: timer[action.kind] + 1,
          undo: [...timer.undo.slice(-999), action.kind],
        },
      }
    case 'undo': {
      const kind = timer?.undo.at(-1)
      if (!timer || timer.status === 'review' || !kind) return doc
      return {
        ...doc,
        timer: { ...timer, [kind]: Math.max(0, timer[kind] - 1), undo: timer.undo.slice(0, -1) },
      }
    }
    case 'save': {
      if (!timer || timer.status !== 'review') return doc
      const session = sessionSchema.parse({
        ...action.session,
        learning: acceptLearning(doc.items, action.session.learning, timer.learning),
        id: timer.id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      if (doc.sessions.some((s) => s.id === timer.id))
        throw new Error('この記録はすでに保存されています')
      return {
        ...doc,
        selection: nextSelection(doc.items, session.learning),
        timer: null,
        sessions: [...doc.sessions, session],
      }
    }
  }
}
