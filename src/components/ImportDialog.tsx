import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import type { AppDocument } from '../domain/model'
import { planImport } from '../domain/import'
import { dateKey } from '../domain/statistics'
import { MAX_IMPORT_BYTES, parseImportFile } from '../data/importFile'
import { downloadJson } from '../data/download'

export function ImportDialog({
  doc,
  disabled,
  close,
  importData,
}: {
  doc: AppDocument
  disabled: boolean
  close: () => void
  importData: (incoming: AppDocument, revision: number) => string | null
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const request = useRef(0)
  const [source, setSource] = useState<ReturnType<typeof parseImportFile> | null>(null)
  const [filename, setFilename] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [backupRevision, setBackupRevision] = useState<number | null>(null)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => {
      request.current++
      element.close()
    }
  }, [])
  const preview = useMemo(() => {
    if (!source) return null
    try {
      return { plan: planImport(doc, source.document), error: '' }
    } catch (error) {
      return {
        plan: null,
        error: error instanceof Error ? error.message : '取り込みを確認できません。',
      }
    }
  }, [doc, source])
  const sessions = source?.document.sessions ?? []
  const dates = sessions.map((session) => session.startedAt)
  const plan = preview?.plan
  const canImport =
    !disabled && Boolean(plan && (plan.added || plan.addedItems)) && backupRevision === doc.revision
  return (
    <dialog
      ref={dialog}
      className="confirm-dialog import-dialog"
      aria-labelledby="import-title"
      onCancel={close}
    >
      <h2 id="import-title">データを読み込む</h2>
      <p className="muted">
        POMOLOGのJSONを選択し、内容を確認して追加します。バックアップの復元にも利用できます。
      </p>
      <label className="import-file">
        JSONファイル（5MB以下）
        <input
          type="file"
          accept=".json,application/json"
          disabled={disabled}
          onChange={async (event) => {
            const file = event.target.files?.[0]
            const id = ++request.current
            setSource(null)
            setError('')
            setBackupRevision(null)
            setFilename(file?.name ?? '')
            setLoading(false)
            event.target.value = ''
            if (!file) return
            if (file.size > MAX_IMPORT_BYTES) {
              setError('ファイルは5MB以下にしてください。')
              setLoading(false)
              return
            }
            setLoading(true)
            try {
              const raw = await file.text()
              if (id === request.current) setSource(parseImportFile(raw))
            } catch (error) {
              if (id === request.current)
                setError(
                  error instanceof Error
                    ? error.message
                    : 'ファイルを読み込めませんでした。もう一度選択してください。',
                )
            } finally {
              if (id === request.current) setLoading(false)
            }
          }}
        />
      </label>
      {loading && <p role="status">ファイルを確認しています…</p>}
      {source && (
        <div className="import-preview" aria-label="取り込みプレビュー">
          <h3>取り込み前の確認</h3>
          <p className="import-filename">
            {filename} · 保存形式 v{source.version}
            {source.version < 3 && ' → v3に変換'}
          </p>
          <dl className="session-details">
            <div>
              <dt>ファイル内の記録</dt>
              <dd>
                {sessions.length}件（削除済み{' '}
                {sessions.filter((session) => session.deletedAt !== null).length}件）
              </dd>
            </div>
            <div>
              <dt>開始日の期間</dt>
              <dd>
                {dates.length
                  ? `${dateKey(Math.min(...dates))} ～ ${dateKey(Math.max(...dates))}`
                  : '記録なし'}
              </dd>
            </div>
            <div>
              <dt>学習項目</dt>
              <dd>
                {(['subject', 'middle', 'small'] as const)
                  .map(
                    (level, i) =>
                      `${['教科', '中項目', '小項目'][i]} ${source.document.items.filter((item) => item.level === level).length}`,
                  )
                  .join(' / ')}
              </dd>
            </div>
            <div>
              <dt>教科</dt>
              <dd>
                {source.document.items
                  .filter((item) => item.level === 'subject')
                  .map((item) => item.name)
                  .join('、') || 'なし'}
              </dd>
            </div>
          </dl>
          <p>
            <strong>方式：追加取り込み（同じ記録IDはスキップ）</strong>
          </p>
          {plan && (
            <>
              <p data-testid="import-counts">
                追加 {plan.added}件（削除済み {plan.addedDeleted}件） / 重複スキップ {plan.skipped}
                件 / 学習項目追加 {plan.addedItems}件
              </p>
              {plan.changedDuplicates > 0 && (
                <p className="import-warning">
                  同じIDで内容が異なる記録が{plan.changedDuplicates}
                  件あります。更新日時にかかわらず現在の内容を保持し、上書きしません。
                </p>
              )}
              {plan.sameNames > 0 && (
                <p className="import-warning">
                  異なるIDの同名項目が{plan.sameNames}件あります。別項目として追加します。
                </p>
              )}
              {plan.added === 0 && plan.addedItems === 0 && (
                <p role="status">追加できるデータはありません。</p>
              )}
            </>
          )}
          <p className="history-note">
            削除状態と記録当時の名称を保持します。同じ項目IDは現在のマスターを使用します。ファイル内の進行中セット・選択状態は取り込まず、現在のタイマーと選択を維持します。
          </p>
          {source.document.timer && (
            <p className="import-warning">
              ファイル内の進行中セット1件は取り込み対象外です。元ファイルは保管してください。
            </p>
          )}
        </div>
      )}
      {(error || preview?.error) && (
        <p className="error" role="alert">
          {error || preview?.error}
        </p>
      )}
      {plan && (
        <div className="import-backup">
          <h3>現在データのバックアップ</h3>
          <p className="history-note">
            先にJSONを書き出し、端末に保存されたことを確認してください。取り込み時にはブラウザ内にも自動退避します。
          </p>
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => {
              try {
                downloadJson(JSON.stringify(doc), `pomolog-backup-before-import-${Date.now()}.json`)
                setBackupRevision(doc.revision)
                setError('')
              } catch {
                setBackupRevision(null)
                setError(
                  'バックアップを書き出せませんでした。ブラウザのダウンロード設定を確認してください。',
                )
              }
            }}
          >
            <ArrowDownToLine size={16} />
            バックアップを書き出す
          </button>
          {backupRevision === doc.revision && (
            <p role="status">
              バックアップの書き出しを要求しました。保存先を確認してから取り込んでください。
            </p>
          )}
          {backupRevision !== null && backupRevision !== doc.revision && (
            <p className="import-warning" role="alert">
              プレビュー後に現在データが更新されました。内容を再確認し、バックアップをもう一度書き出してください。
            </p>
          )}
        </div>
      )}
      {disabled && (
        <p className="import-warning" role="alert">
          編集権限がありません。権限を取得してから操作してください。
        </p>
      )}
      <div className="dialog-actions">
        <button className="secondary" onClick={close}>
          キャンセル
        </button>
        <button
          className="primary"
          disabled={!canImport}
          onClick={() => {
            if (!source || backupRevision === null) return
            const message = importData(source.document, backupRevision)
            if (message) setError(message)
            else close()
          }}
        >
          <ArrowUpFromLine size={16} />
          確認して取り込む
        </button>
      </div>
    </dialog>
  )
}
