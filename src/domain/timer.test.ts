import { describe, expect, it } from 'vitest'
import {
  ACHIEVEMENT_MS,
  NOTIFICATION_MS,
  accuracy,
  achieved,
  elapsedMs,
  emptyDocument,
  formatDuration,
  transition,
} from './model'
import type { AppDocument, Session } from './model'
import { learningFromIds } from './learning'

const start = 1_800_000_000_000
const begin = () => transition(emptyDocument(), { type: 'start', id: 'test-session' }, start)
function finishAndSave(doc: AppDocument, now: number) {
  const ended = transition(doc, { type: 'finish' }, now)
  const timer = ended.timer!
  return transition(
    ended,
    {
      type: 'save',
      session: {
        learning: timer.learning,
        correct: timer.correct,
        incorrect: timer.incorrect,
        memo: timer.memo,
        startedAt: timer.startedAt,
        endedAt: timer.endedAt!,
        focusMs: timer.accumulatedMs,
      },
    },
    now + 1000,
  )
}

describe('時刻ベースの集中タイマー', () => {
  it.each([
    [ACHIEVEMENT_MS - 1, false],
    [ACHIEVEMENT_MS, true],
    [ACHIEVEMENT_MS + 1, true],
    [NOTIFICATION_MS, true],
    [90 * 60_000, true],
  ])('%i ms の達成判定は %s、保存後も1セットとして数える', (duration, expected) => {
    const doc = finishAndSave(begin(), start + duration)
    expect(achieved(doc.sessions[0].focusMs)).toBe(expected)
    expect(doc.sessions.filter((s) => achieved(s.focusMs))).toHaveLength(expected ? 1 : 0)
    expect(doc.timer).toBeNull()
  })
  it('20分で通知せず、25分の直前・ちょうど・直後を区別する', () => {
    const doc = begin()
    expect(transition(doc, { type: 'claim-notification' }, start + ACHIEVEMENT_MS)).toBe(doc)
    expect(transition(doc, { type: 'claim-notification' }, start + NOTIFICATION_MS - 1)).toBe(doc)
    const notified = transition(doc, { type: 'claim-notification' }, start + NOTIFICATION_MS)
    expect(notified.timer?.notificationSent).toBe(true)
    expect(notified.timer?.status).toBe('running')
    expect(transition(notified, { type: 'claim-notification' }, start + NOTIFICATION_MS + 1)).toBe(
      notified,
    )
  })
  it('25分を超えても集中を継続し、超過時間を計算できる', () => {
    const doc = begin()
    expect(elapsedMs(doc.timer, start + 31 * 60_000)).toBe(31 * 60_000)
    expect(doc.timer?.status).toBe('running')
    expect(formatDuration(elapsedMs(doc.timer, start + 31 * 60_000) - NOTIFICATION_MS)).toBe(
      '06:00',
    )
  })
  it.each(['pause', 'break'] as const)('%s中の時間を除外し、再開後だけ加算する', (type) => {
    let doc = transition(begin(), { type }, start + 10 * 60_000)
    expect(elapsedMs(doc.timer, start + 60 * 60_000)).toBe(10 * 60_000)
    doc = transition(doc, { type: 'resume' }, start + 60 * 60_000)
    expect(elapsedMs(doc.timer, start + 70 * 60_000)).toBe(20 * 60_000)
    expect(achieved(elapsedMs(doc.timer, start + 70 * 60_000))).toBe(true)
  })
  it.each(['running', 'paused', 'break'] as const)(
    '%sから手動終了し、確認中は増えず、勝手に次を始めない',
    (status) => {
      let doc = begin()
      if (status !== 'running')
        doc = transition(doc, { type: status === 'paused' ? 'pause' : 'break' }, start + 60_000)
      doc = transition(doc, { type: 'finish' }, start + 120_000)
      const duration = status === 'running' ? 120_000 : 60_000
      expect(doc.timer?.status).toBe('review')
      expect(doc.timer?.endedAt).toBe(start + 120_000)
      expect(elapsedMs(doc.timer, start + 3600_000)).toBe(duration)
      expect(transition(doc, { type: 'resume' }, start + 3600_000)).toBe(doc)
      expect(transition(doc, { type: 'start', id: 'next' }, start + 3600_000)).toBe(doc)
    },
  )
  it('二重開始・二重終了・不正な再開を無視する', () => {
    const doc = begin()
    expect(transition(doc, { type: 'start', id: 'new' }, start)).toBe(doc)
    expect(transition(doc, { type: 'resume' }, start)).toBe(doc)
    const ended = transition(doc, { type: 'finish' }, start + 1000)
    expect(transition(ended, { type: 'finish' }, start + 10_000)).toBe(ended)
  })
  it('正解・不正解を個別に数え、メモ入力後も直前のカウントを取り消せる', () => {
    let doc = transition(begin(), { type: 'count', kind: 'correct' }, start)
    doc = transition(doc, { type: 'count', kind: 'incorrect' }, start)
    doc = transition(
      doc,
      {
        type: 'edit',
        fields: { learning: doc.timer!.learning, correct: 1, incorrect: 1, memo: '見直す' },
      },
      start,
    )
    doc = transition(doc, { type: 'undo' }, start)
    expect(doc.timer?.correct).toBe(1)
    expect(doc.timer?.incorrect).toBe(0)
    expect(doc.timer?.memo).toBe('見直す')
    doc = transition(doc, { type: 'undo' }, start)
    expect(doc.timer?.correct).toBe(0)
    expect(transition(doc, { type: 'undo' }, start)).toBe(doc)
    expect(accuracy(0, 0)).toBeNull()
    expect(accuracy(3, 1)).toBe(75)
  })
  it('確認で修正した値を保存し、時間の整合性が崩れた値を拒否する', () => {
    const doc = transition(begin(), { type: 'finish' }, start + 30 * 60_000)
    const session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'> = {
      deletedAt: null,
      learning: learningFromIds(doc.items, doc.items[2].id),
      correct: 3,
      incorrect: 1,
      memo: '復習',
      startedAt: start,
      endedAt: start + 30 * 60_000,
      focusMs: ACHIEVEMENT_MS,
    }
    const saved = transition(doc, { type: 'save', session }, start + 31 * 60_000)
    expect(saved.sessions[0]).toMatchObject(session)
    expect(saved.selection).toEqual(session.learning)
    expect(() =>
      transition(doc, { type: 'save', session: { ...session, focusMs: 60 * 60_000 } }, start),
    ).toThrow()
    expect(transition(saved, { type: 'save', session }, start)).toBe(saved)
  })
  it('時計を戻しても負の集中時間を生成しない', () => {
    expect(elapsedMs(begin().timer, start - 1000)).toBe(0)
  })
})
