// Frozen Phase 1 schema: validate before migrating, never mutate the source.
import { z } from 'zod'

const timestamp = z.number().int().nonnegative()
const count = z.number().int().min(0).max(1_000_000)
export const learningSchema = z.object({
  subject: z.string().min(1).max(100),
  middle: z.string().max(100),
  small: z.string().max(100),
})
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
export const legacyDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  selection: learningSchema,
  timer: timerSchema.nullable(),
  sessions: z.array(sessionSchema),
})
