import { decodeDocument } from './repository'

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
export const MAX_IMPORT_SESSIONS = 10_000
export const MAX_IMPORT_ITEMS = 2_000

export function parseImportFile(raw: string) {
  if (new TextEncoder().encode(raw).length > MAX_IMPORT_BYTES)
    throw new Error('ファイルは5MB以下にしてください。')
  let value: unknown
  try {
    value = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('JSONを読み取れません。ファイルが途中で切れていないか確認してください。')
  }
  if (!value || typeof value !== 'object' || !('schemaVersion' in value))
    throw new Error('POMOLOGのエクスポートJSONを選択してください。')
  const version = value.schemaVersion
  if (version !== 1 && version !== 2 && version !== 3)
    throw new Error('未対応の保存形式です。対応している形式はv1・v2・v3です。')
  if (
    !('sessions' in value) ||
    !Array.isArray(value.sessions) ||
    value.sessions.length > MAX_IMPORT_SESSIONS ||
    ('items' in value && Array.isArray(value.items) && value.items.length > MAX_IMPORT_ITEMS)
  )
    throw new Error('記録は10,000件、学習項目は2,000件以内のJSONを選択してください。')
  try {
    const document = decodeDocument(JSON.stringify(value))
    if (document.items.length > MAX_IMPORT_ITEMS) throw new Error('too many migrated items')
    const times = [
      ...document.items.flatMap((item) => [item.createdAt, item.updatedAt]),
      ...document.sessions.flatMap((session) => [
        session.startedAt,
        session.endedAt,
        session.createdAt,
        session.updatedAt,
        session.deletedAt,
      ]),
      ...(document.timer
        ? [document.timer.startedAt, document.timer.endedAt, document.timer.activeSince]
        : []),
    ]
    if (times.some((time) => time !== null && !Number.isFinite(new Date(time).getTime())))
      throw new Error('invalid calendar date')
    return { document, version }
  } catch {
    throw new Error('記録・学習項目・時刻などの形式が不正です。データは取り込んでいません。')
  }
}
