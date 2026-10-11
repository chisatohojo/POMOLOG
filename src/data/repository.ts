import { documentSchema, emptyDocument } from '../domain/model'
import type { AppDocument } from '../domain/model'
import { migrateV1 } from './migrations'
import { stableId } from '../domain/learning'

export const STORAGE_KEY = 'pomolog.document'
export interface StoragePort {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
export interface Repository {
  load(): AppDocument
  prepareForEditing(): AppDocument
  save(doc: AppDocument, expectedRevision: number): AppDocument
}

// Future schema versions must be handled here with an explicit migration.
export function decodeDocument(raw: string): AppDocument {
  const value: unknown = JSON.parse(raw)
  if (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion !== 1 &&
    value.schemaVersion !== 2
  ) {
    throw new Error('未対応のデータ形式です。更新前のデータを保持しています。')
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion === 1
  )
    return migrateV1(value)
  return documentSchema.parse(value)
}

export const migrationBackupKey = (raw: string) => `pomolog.backup.v1.${stableId(raw)}`

export class LocalRepository implements Repository {
  constructor(private readonly storage: StoragePort) {}
  load(): AppDocument {
    const raw = this.storage.getItem(STORAGE_KEY)
    return raw === null ? emptyDocument() : decodeDocument(raw)
  }
  // Called only inside the exclusive Web Lock, before enabling any editor controls.
  prepareForEditing(): AppDocument {
    const raw = this.storage.getItem(STORAGE_KEY)
    if (raw === null) return emptyDocument()
    const doc = decodeDocument(raw)
    if ((JSON.parse(raw) as { schemaVersion: number }).schemaVersion === 2) return doc
    return this.save(doc, doc.revision)
  }
  save(doc: AppDocument, expectedRevision: number): AppDocument {
    const raw = this.storage.getItem(STORAGE_KEY)
    const current = raw === null ? emptyDocument() : decodeDocument(raw)
    if (current.revision !== expectedRevision)
      throw new Error('別のタブでデータが変更されました。再読み込みしてください。')
    const next = documentSchema.parse({ ...doc, revision: expectedRevision + 1 })
    if (raw !== null && (JSON.parse(raw) as { schemaVersion: number }).schemaVersion === 1) {
      const key = migrationBackupKey(raw)
      const existing = this.storage.getItem(key)
      if (existing !== null && existing !== raw)
        throw new Error('移行前データの退避先が競合しました。元データは保持しています。')
      if (existing === null) this.storage.setItem(key, raw)
      if (this.storage.getItem(key) !== raw) throw new Error('移行前データを退避できませんでした。')
    }
    if (this.storage.getItem(STORAGE_KEY) !== raw)
      throw new Error('別のタブでデータが変更されました。再読み込みしてください。')
    this.storage.setItem(STORAGE_KEY, JSON.stringify(next))
    return next
  }
}
