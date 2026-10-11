// Frozen Phase 2 schema: validate the complete original before upgrading.
import { z } from 'zod'
import { learningSchema, itemSchema, validateItems, validLearning } from '../domain/learning'
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
  })
  .refine(
    (s) => s.endedAt >= s.startedAt && s.focusMs <= s.endedAt - s.startedAt,
    '集中時間または開始・終了時刻が不正です',
  )
export const legacyV2Schema = z
  .object({
    schemaVersion: z.literal(2),
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
