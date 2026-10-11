import { documentSchema, emptyDocument } from '../domain/model'
import type { AppDocument } from '../domain/model'

export const STORAGE_KEY = 'pomolog.document'
export interface StoragePort {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
export interface Repository {
  load(): AppDocument
  save(doc: AppDocument, expectedRevision: number): AppDocument
}

// Future schema versions must be handled here with an explicit migration.
export function decodeDocument(raw: string): AppDocument {
  const value: unknown = JSON.parse(raw)
  if (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion !== 1
  ) {
    throw new Error('未対応のデータ形式です。更新前のデータを保持しています。')
  }
  return documentSchema.parse(value)
}

export class LocalRepository implements Repository {
  constructor(private readonly storage: StoragePort) {}
  load(): AppDocument {
    const raw = this.storage.getItem(STORAGE_KEY)
    return raw === null ? emptyDocument() : decodeDocument(raw)
  }
  save(doc: AppDocument, expectedRevision: number): AppDocument {
    const current = this.load()
    if (current.revision !== expectedRevision)
      throw new Error('別のタブでデータが変更されました。再読み込みしてください。')
    const next = documentSchema.parse({ ...doc, revision: expectedRevision + 1 })
    this.storage.setItem(STORAGE_KEY, JSON.stringify(next))
    return next
  }
}
