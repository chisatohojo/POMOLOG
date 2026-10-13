import { documentSchema, emptyDocument } from '../domain/model'
import type { AppDocument } from '../domain/model'
import { migrateV1, migrateV2 } from './migrations'
import { stableId } from '../domain/learning'

export const STORAGE_KEY = 'pomolog.document'
export interface StoragePort {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
export interface Repository {
  load(): AppDocument
  prepareForEditing(): AppDocument
  save(doc: AppDocument, expectedRevision: number, backupBeforeImport?: boolean): AppDocument
}

// Future schema versions must be handled here with an explicit migration.
export function decodeDocument(raw: string): AppDocument {
  const value: unknown = JSON.parse(raw)
  if (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion !== 1 &&
    value.schemaVersion !== 2 &&
    value.schemaVersion !== 3
  ) {
    throw new Error('未対応のデータ形式です。更新前のデータを保持しています。')
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion === 1
  )
    return migrateV2(migrateV1(value))
  if (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion === 2
  )
    return migrateV2(value)
  return documentSchema.parse(value)
}

export const migrationBackupKey = (raw: string, version: 1 | 2 = 1) =>
  `pomolog.backup.v${version}.${stableId(raw)}`
export const importBackupKey = (raw: string) => `pomolog.backup.import.${stableId(raw)}`

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
    if ((JSON.parse(raw) as { schemaVersion: number }).schemaVersion === 3) return doc
    return this.save(doc, doc.revision)
  }
  save(doc: AppDocument, expectedRevision: number, backupBeforeImport = false): AppDocument {
    const raw = this.storage.getItem(STORAGE_KEY)
    const current = raw === null ? emptyDocument() : decodeDocument(raw)
    if (current.revision !== expectedRevision)
      throw new Error('別のタブでデータが変更されました。再読み込みしてください。')
    const next = documentSchema.parse({ ...doc, revision: expectedRevision + 1 })
    if (backupBeforeImport) {
      const backupRaw = raw ?? JSON.stringify(current)
      const key = importBackupKey(backupRaw)
      const existing = this.storage.getItem(key)
      if (existing !== null && existing !== backupRaw)
        throw new Error('取り込み前バックアップの保存先が競合しました。元データを保持しています。')
      if (existing === null) this.storage.setItem(key, backupRaw)
      if (this.storage.getItem(key) !== backupRaw)
        throw new Error('取り込み前バックアップを保存できませんでした。元データを保持しています。')
    }
    const version = raw === null ? 3 : (JSON.parse(raw) as { schemaVersion: number }).schemaVersion
    if (raw !== null && (version === 1 || version === 2)) {
      const key = migrationBackupKey(raw, version)
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
