export const EDITOR_LOCK_NAME = 'pomolog-editor'

export interface LockPort {
  request(
    name: string,
    options: { mode: 'exclusive'; signal: AbortSignal },
    callback: (lock: Pick<Lock, 'name' | 'mode'> | null) => Promise<void>,
  ): Promise<void>
}

export interface EditorAccess {
  status: 'pending' | 'ready' | 'error'
  ownerId: string | null
  message: string | null
}

interface RequestOwner {
  id: string
  active: boolean
  abort: AbortController
  release?: () => void
}

// Ownership is granted by the browser, never inferred from a timestamp or storage key.
// A queued, abortable request survives contention and is safe under StrictMode cleanup.
export class EditorLockController {
  private owner: RequestOwner | null = null
  private snapshot: EditorAccess = { status: 'pending', ownerId: null, message: null }
  private listeners = new Set<() => void>()

  constructor(private readonly locks: LockPort | undefined) {}

  getSnapshot = (): EditorAccess => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish(snapshot: EditorAccess) {
    this.snapshot = snapshot
    this.listeners.forEach((listener) => listener())
  }
  isOwner = (): boolean =>
    Boolean(
      this.owner?.active &&
      this.snapshot.status === 'ready' &&
      this.snapshot.ownerId === this.owner.id,
    )

  start(refresh: () => boolean): void {
    this.stop()
    if (!this.locks) {
      this.publish({
        status: 'error',
        ownerId: null,
        message:
          'この環境では安全な編集ロックを利用できません。対応ブラウザでHTTPSまたはlocalhostから開いてください。',
      })
      return
    }
    const owner: RequestOwner = {
      id: crypto.randomUUID(),
      active: true,
      abort: new AbortController(),
    }
    this.owner = owner
    void this.acquire(owner, refresh)
  }

  private async acquire(owner: RequestOwner, refresh: () => boolean): Promise<void> {
    try {
      await this.locks!.request(
        EDITOR_LOCK_NAME,
        { mode: 'exclusive', signal: owner.abort.signal },
        async (lock) => {
          if (this.owner !== owner || !owner.active) return
          if (!lock || lock.name !== EDITOR_LOCK_NAME || lock.mode !== 'exclusive') {
            throw new Error('ロックの所有権を確認できませんでした。')
          }
          const held = new Promise<void>((resolve) => {
            owner.release = resolve
          })
          try {
            // A waiting tab's document may be stale. Refresh while holding the lock,
            // before exposing any writable controls or dispatching notifications.
            if (!refresh()) throw new Error('最新の保存データを読み込めませんでした。')
            this.publish({ status: 'ready', ownerId: owner.id, message: null })
            await held
          } finally {
            owner.release?.()
          }
        },
      )
    } catch (error) {
      if (this.owner !== owner || !owner.active) return
      owner.active = false
      this.publish({
        status: 'error',
        ownerId: null,
        message: `編集権限を確認できませんでした。${error instanceof Error ? error.message : 'ブラウザの設定を確認してください。'}`,
      })
    }
  }

  stop = (): void => {
    const owner = this.owner
    this.owner = null
    if (owner) {
      // Revoke local writes immediately, before the browser finishes releasing.
      owner.active = false
      owner.abort.abort()
      owner.release?.()
    }
    this.publish({ status: 'pending', ownerId: null, message: null })
  }
}
