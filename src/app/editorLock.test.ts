import { describe, expect, it, vi } from 'vitest'
import { EditorLockController, EDITOR_LOCK_NAME } from './editorLock'
import type { LockPort } from './editorLock'

type Request = {
  callback: Parameters<LockPort['request']>[2]
  signal: AbortSignal
  onAbort: () => void
  resolve: () => void
  reject: (error: Error) => void
}

// Browser-style exclusive queue: abort only cancels ungranted requests, and a
// granted lock is held until its callback's promise settles (not until stop()).
class ExclusiveLocks implements LockPort {
  held: Request | null = null
  queue: Request[] = []
  request: LockPort['request'] = (_name, options, callback) =>
    new Promise<void>((resolve, reject) => {
      const request: Request = {
        callback,
        resolve,
        reject,
        signal: options.signal,
        onAbort: () => {
          if (this.held === request) return
          this.queue = this.queue.filter((item) => item !== request)
          reject(new DOMException('Cancelled', 'AbortError'))
        },
      }
      if (options.signal.aborted) {
        request.onAbort()
        return
      }
      options.signal.addEventListener('abort', request.onAbort, { once: true })
      this.queue.push(request)
      queueMicrotask(() => this.pump())
    })
  private pump() {
    if (this.held) return
    const request = this.queue.shift()
    if (!request) return
    this.held = request
    request.signal.removeEventListener('abort', request.onAbort)
    void Promise.resolve()
      .then(() => request.callback({ name: EDITOR_LOCK_NAME, mode: 'exclusive' }))
      .then(request.resolve, request.reject)
      .finally(() => {
        this.held = null
        this.pump()
      })
  }
}

// Drain the finite promise chain without wall-clock sleeps.
async function settle() {
  for (let index = 0; index < 20; index++) await Promise.resolve()
}

describe('編集ロックの所有権と復旧', () => {
  it('取得コールバックと最新データの読込が完了するまで所有者にしない', async () => {
    const locks = new ExclusiveLocks()
    const controller = new EditorLockController(locks)
    const refresh = vi.fn(() => {
      expect(controller.isOwner()).toBe(false)
      return true
    })
    controller.start(refresh)
    expect(controller.isOwner()).toBe(false)
    await settle()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', ownerId: expect.any(String) })
    expect(controller.isOwner()).toBe(true)
    controller.stop()
    await settle()
    expect(locks.held).toBeNull()
  })

  it('StrictModeのsetup→cleanup→setupで古い待機要求を取消し、単一タブで取得する', async () => {
    const locks = new ExclusiveLocks()
    const controller = new EditorLockController(locks)
    const staleRefresh = vi.fn(() => true)
    const refresh = vi.fn(() => true)
    controller.start(staleRefresh)
    controller.stop()
    controller.start(refresh)
    await settle()
    expect(staleRefresh).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(controller.isOwner()).toBe(true)
    expect(locks.queue).toHaveLength(0)
    controller.stop()
    await settle()
  })

  it('解放処理がまだ完了していなくても、再取得をキューで待ち、新しい所有者として復旧する', async () => {
    const locks = new ExclusiveLocks()
    const controller = new EditorLockController(locks)
    controller.start(() => true)
    await settle()
    const previous = controller.getSnapshot().ownerId
    controller.stop()
    expect(controller.isOwner()).toBe(false)
    controller.start(() => true)
    await settle()
    expect(controller.isOwner()).toBe(true)
    expect(controller.getSnapshot().ownerId).not.toBe(previous)
    controller.stop()
    await settle()
  })

  it('複数タブの所有権を排他し、解放後は最新データを読み直して自動取得する', async () => {
    const locks = new ExclusiveLocks()
    const first = new EditorLockController(locks)
    const second = new EditorLockController(locks)
    let revision = 1
    first.start(() => true)
    await settle()
    const refresh = vi.fn(() => {
      expect(revision).toBe(2)
      return true
    })
    second.start(refresh)
    await settle()
    expect(first.isOwner()).toBe(true)
    expect(second.isOwner()).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
    revision = 2
    first.stop()
    await settle()
    expect(second.isOwner()).toBe(true)
    expect(first.isOwner()).toBe(false)
    expect(refresh).toHaveBeenCalledTimes(1)
    second.stop()
    await settle()
  })

  it('閉じた待機タブの要求を除去し、後続の待機タブを妨げない', async () => {
    const locks = new ExclusiveLocks()
    const first = new EditorLockController(locks)
    const cancelled = new EditorLockController(locks)
    const third = new EditorLockController(locks)
    first.start(() => true)
    await settle()
    cancelled.start(() => true)
    third.start(() => true)
    cancelled.stop()
    first.stop()
    await settle()
    expect(cancelled.isOwner()).toBe(false)
    expect(third.isOwner()).toBe(true)
    third.stop()
    await settle()
  })

  it('古いコールバックが遅れて届いても、新しい要求の所有者判定を変更しない', async () => {
    const callbacks: Parameters<LockPort['request']>[2][] = []
    const controller = new EditorLockController({
      request: async (_name, _options, callback) => {
        callbacks.push(callback)
      },
    })
    const staleRefresh = vi.fn(() => true)
    controller.start(staleRefresh)
    controller.stop()
    controller.start(() => true)
    await callbacks[0]({ name: EDITOR_LOCK_NAME, mode: 'exclusive' })
    expect(staleRefresh).not.toHaveBeenCalled()
    expect(controller.isOwner()).toBe(false)
    const held = callbacks[1]({ name: EDITOR_LOCK_NAME, mode: 'exclusive' })
    expect(controller.isOwner()).toBe(true)
    controller.stop()
    await held
  })

  it('ロックAPI失敗を競合と区別し、安全に再試行できる', async () => {
    const locks = new ExclusiveLocks()
    let fail = true
    const controller = new EditorLockController({
      request: (...args) => {
        if (fail) return Promise.reject(new DOMException('not allowed', 'SecurityError'))
        return locks.request(...args)
      },
    })
    controller.start(() => true)
    await settle()
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', ownerId: null })
    expect(controller.isOwner()).toBe(false)
    fail = false
    controller.start(() => true)
    await settle()
    expect(controller.isOwner()).toBe(true)
    controller.stop()
    await settle()
  })

  it('未対応環境・読込失敗・別名ロックでは編集を許可しない', async () => {
    const unavailable = new EditorLockController(undefined)
    unavailable.start(() => true)
    expect(unavailable.getSnapshot().status).toBe('error')
    expect(unavailable.isOwner()).toBe(false)
    const locks = new ExclusiveLocks()
    const invalidData = new EditorLockController(locks)
    invalidData.start(() => false)
    await settle()
    expect(invalidData.isOwner()).toBe(false)
    expect(invalidData.getSnapshot().status).toBe('error')
    expect(locks.held).toBeNull()
    const wrongLock = new EditorLockController({
      request: async (_name, _options, callback) => {
        await callback({ name: 'unrelated', mode: 'exclusive' })
      },
    })
    wrongLock.start(() => true)
    await settle()
    expect(wrongLock.isOwner()).toBe(false)
    expect(wrongLock.getSnapshot().status).toBe('error')
  })
})
