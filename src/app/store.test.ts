import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStore } from './store'
import { LocalRepository, STORAGE_KEY, decodeDocument } from '../data/repository'
import type { StoragePort } from '../data/repository'
import { NOTIFICATION_MS, elapsedMs } from '../domain/model'

class MemoryStorage implements StoragePort {
  data = new Map<string, string>()
  fail = false
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.fail) throw new Error('容量不足')
    this.data.set(key, value)
  }
}
const start = 1_800_000_000_000
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(start)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('保存・復元と通知', () => {
  it('所有権がない場合は直接の操作・通知からも保存データを書き換えない', () => {
    const storage = new MemoryStorage()
    let owner = false
    const notify = vi.fn()
    const store = new AppStore(new LocalRepository(storage), notify, Date.now, () => owner)
    expect(store.dispatch({ type: 'start', id: 'blocked' })).toBe(false)
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
    owner = true
    store.dispatch({ type: 'start', id: 'owned' })
    const raw = storage.getItem(STORAGE_KEY)
    owner = false
    vi.setSystemTime(start + NOTIFICATION_MS)
    store.checkNotification()
    expect(store.dispatch({ type: 'count', kind: 'correct' })).toBe(false)
    expect(store.dispatch({ type: 'finish' })).toBe(false)
    expect(notify).not.toHaveBeenCalled()
    expect(storage.getItem(STORAGE_KEY)).toBe(raw)
  })
  it('権限引継ぎ時の再読込は最新状態を取得し、既存データに書き込まない', () => {
    const storage = new MemoryStorage()
    const first = new AppStore(new LocalRepository(storage), vi.fn())
    const waiting = new AppStore(new LocalRepository(storage), vi.fn())
    first.dispatch({ type: 'start', id: 'handoff' })
    first.dispatch({ type: 'count', kind: 'correct' })
    const raw = storage.getItem(STORAGE_KEY)
    expect(waiting.reload()).toBe(true)
    expect(waiting.getSnapshot().document?.timer).toMatchObject({ id: 'handoff', correct: 1 })
    expect(storage.getItem(STORAGE_KEY)).toBe(raw)
    expect(waiting.dispatch({ type: 'count', kind: 'correct' })).toBe(true)
    expect(new LocalRepository(storage).load().timer?.correct).toBe(2)
  })
  it.each(['running', 'paused', 'break', 'review'] as const)(
    '%sを新しいStoreに復元して時刻から計算する',
    (status) => {
      const storage = new MemoryStorage()
      const store = new AppStore(new LocalRepository(storage), vi.fn())
      store.dispatch({ type: 'start', id: 'resume-id' })
      vi.setSystemTime(start + 60_000)
      if (status !== 'running')
        store.dispatch({
          type: status === 'paused' ? 'pause' : status === 'review' ? 'finish' : 'break',
        })
      vi.setSystemTime(start + 3600_000)
      const restored = new AppStore(new LocalRepository(storage), vi.fn())
      expect(restored.getSnapshot().document?.timer?.status).toBe(status)
      expect(elapsedMs(restored.getSnapshot().document!.timer, Date.now())).toBe(
        status === 'running' ? 3600_000 : 60_000,
      )
    },
  )
  it('25分到達を1回だけ通知し、再読み込み・再開で再通知しない', () => {
    const storage = new MemoryStorage()
    const notify = vi.fn()
    const store = new AppStore(new LocalRepository(storage), notify)
    store.dispatch({ type: 'start', id: 'notification' })
    vi.setSystemTime(start + NOTIFICATION_MS - 1)
    store.checkNotification()
    expect(notify).not.toHaveBeenCalled()
    vi.setSystemTime(start + NOTIFICATION_MS)
    store.checkNotification()
    store.checkNotification()
    expect(notify).toHaveBeenCalledTimes(1)
    const restored = new AppStore(new LocalRepository(storage), notify)
    restored.checkNotification()
    restored.dispatch({ type: 'pause' })
    restored.dispatch({ type: 'resume' })
    restored.checkNotification()
    expect(notify).toHaveBeenCalledTimes(1)
  })
  it('閉じている間に25分を超えた集中を再表示時に1回通知する', () => {
    const storage = new MemoryStorage()
    new AppStore(new LocalRepository(storage), vi.fn()).dispatch({ type: 'start', id: 'closed' })
    vi.setSystemTime(start + 45 * 60_000)
    const notify = vi.fn()
    const restored = new AppStore(new LocalRepository(storage), notify)
    restored.checkNotification()
    restored.checkNotification()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(elapsedMs(restored.getSnapshot().document!.timer, Date.now())).toBe(45 * 60_000)
  })
  it('保存失敗時に操作を確定せず、通知フラグも消費しない', () => {
    const storage = new MemoryStorage()
    const notify = vi.fn()
    const store = new AppStore(new LocalRepository(storage), notify)
    store.dispatch({ type: 'start', id: 'failure' })
    storage.fail = true
    expect(store.dispatch({ type: 'pause' })).toBe(false)
    expect(store.getSnapshot().document?.timer?.status).toBe('running')
    vi.setSystemTime(start + NOTIFICATION_MS)
    store.checkNotification()
    expect(notify).not.toHaveBeenCalled()
    expect(store.getSnapshot().document?.timer?.notificationSent).toBe(false)
    expect(store.getSnapshot().error).toContain('容量不足')
    storage.fail = false
    store.checkNotification()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().error).toBeNull()
  })
  it.each(['{invalid', '{"schemaVersion":2}', '{"schemaVersion":1}'])(
    '破損・未知スキーマを初期化して上書きしない: %s',
    (raw) => {
      const storage = new MemoryStorage()
      storage.setItem(STORAGE_KEY, raw)
      const store = new AppStore(new LocalRepository(storage), vi.fn())
      expect(store.getSnapshot().document).toBeNull()
      expect(store.getSnapshot().error).toBeTruthy()
      expect(store.dispatch({ type: 'start', id: 'overwrite' })).toBe(false)
      expect(storage.getItem(STORAGE_KEY)).toBe(raw)
      expect(() => decodeDocument(raw)).toThrow()
    },
  )
  it('古いrevisionの別タブが最新データを上書きしない', () => {
    const storage = new MemoryStorage()
    const store1 = new AppStore(new LocalRepository(storage), vi.fn())
    const store2 = new AppStore(new LocalRepository(storage), vi.fn())
    store1.dispatch({ type: 'start', id: 'first' })
    expect(store2.dispatch({ type: 'start', id: 'second' })).toBe(false)
    expect(store2.getSnapshot().error).toContain('別のタブ')
    expect(new LocalRepository(storage).load().timer?.id).toBe('first')
  })
  it('履歴保存が失敗しても確認中の記録を保持し、再試行で一度だけ保存する', () => {
    const storage = new MemoryStorage()
    const store = new AppStore(new LocalRepository(storage), vi.fn())
    store.dispatch({ type: 'start', id: 'save-retry' })
    vi.setSystemTime(start + 60_000)
    store.dispatch({ type: 'finish' })
    const timer = store.getSnapshot().document!.timer!
    const action = {
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
    } as const
    storage.fail = true
    expect(store.dispatch(action)).toBe(false)
    expect(store.getSnapshot().document?.timer?.status).toBe('review')
    expect(new LocalRepository(storage).load().sessions).toHaveLength(0)
    storage.fail = false
    expect(store.dispatch(action)).toBe(true)
    expect(store.dispatch(action)).toBe(false)
    expect(new LocalRepository(storage).load().sessions).toHaveLength(1)
    expect(new LocalRepository(storage).load().timer).toBeNull()
  })
})
