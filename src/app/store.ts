import { NOTIFICATION_MS, elapsedMs, transition } from '../domain/model'
import type { Action, AppDocument } from '../domain/model'
import type { Repository } from '../data/repository'

export interface Snapshot {
  document: AppDocument | null
  error: string | null
}
export class AppStore {
  private snapshot: Snapshot = { document: null, error: null }
  private listeners = new Set<() => void>()
  constructor(
    private readonly repository: Repository,
    private readonly notify: () => void,
    private readonly clock = Date.now,
    private readonly canWrite = () => true,
  ) {
    this.reload()
  }
  reload = (): boolean => {
    return this.read(false)
  }
  prepareForEditing = (): boolean => {
    return this.read(true)
  }
  private read(migrate: boolean): boolean {
    try {
      this.snapshot = {
        document: migrate ? this.repository.prepareForEditing() : this.repository.load(),
        error: null,
      }
    } catch {
      this.snapshot = {
        document: null,
        error:
          '保存データを読み込めません。元データは保持されています。JSONを退避してからデータ形式・ブラウザ設定を確認してください。',
      }
    }
    this.emit()
    return this.snapshot.document !== null
  }
  getSnapshot = (): Snapshot => this.snapshot
  subscribe = (callback: () => void): (() => void) => {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }
  private emit() {
    this.listeners.forEach((listener) => listener())
  }
  dispatch(action: Action): boolean {
    if (!this.canWrite()) return false
    const doc = this.snapshot.document
    if (!doc) return false
    try {
      const next = transition(doc, action, this.clock())
      if (next === doc) return false
      this.snapshot = {
        document: this.repository.save(next, doc.revision, action.type === 'import-data'),
        error: null,
      }
      this.emit()
      return true
    } catch (error) {
      this.snapshot = {
        ...this.snapshot,
        error:
          error instanceof Error
            ? `保存できませんでした: ${error.message}`
            : '保存できませんでした。ブラウザの空き容量を確認してください。',
      }
      this.emit()
      return false
    }
  }
  checkNotification = (): void => {
    const timer = this.snapshot.document?.timer
    if (
      !timer ||
      timer.status === 'review' ||
      timer.notificationSent ||
      elapsedMs(timer, this.clock()) < NOTIFICATION_MS
    )
      return
    // Persist before delivery: reload/StrictMode cannot deliver the same threshold twice.
    if (this.dispatch({ type: 'claim-notification' })) this.notify()
  }
}
