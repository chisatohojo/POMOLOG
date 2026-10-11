import { useEffect, useMemo, useRef, useState } from 'react'
import { History, Pencil, RotateCcw, Trash2, X } from 'lucide-react'
import { achieved, formatDuration, learningLabel } from '../domain/model'
import type { Action, AppDocument, Session } from '../domain/model'
import { DATE_RULE, emptyHistoryFilter, rateLabel, searchHistory } from '../domain/statistics'
import { accuracy } from '../domain/model'
import { ItemFilters } from './ItemFilters'
import { SessionForm } from './SessionForm'

const dateTime = (time: number) =>
  new Date(time).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

function DeleteDialog({
  session,
  disabled,
  dispatch,
  close,
}: {
  session: Session
  disabled: boolean
  dispatch: (action: Action) => boolean
  close: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  return (
    <dialog ref={dialog} className="confirm-dialog" aria-labelledby="delete-title" onCancel={close}>
      <h2 id="delete-title">この記録を削除しますか？</h2>
      <p>
        {dateTime(session.startedAt)}
        <br />
        {learningLabel(session.learning)}
      </p>
      <p className="muted">履歴・統計から除外します。「削除済み」からいつでも復元できます。</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="secondary" onClick={close} autoFocus>
          キャンセル
        </button>
        <button
          className="primary"
          disabled={disabled}
          onClick={() => {
            if (
              dispatch({
                type: 'session-delete',
                id: session.id,
                expectedUpdatedAt: session.updatedAt,
              })
            )
              close()
            else
              setError(
                '削除できませんでした。キャンセルして画面上の案内を確認してください。記録は保持されています。',
              )
          }}
        >
          削除する
        </button>
      </div>
    </dialog>
  )
}

export function HistoryView({
  doc,
  dispatch,
  disabled,
}: {
  doc: AppDocument
  dispatch: (action: Action) => boolean
  disabled: boolean
}) {
  const [filter, setFilter] = useState(emptyHistoryFilter)
  const [editing, setEditing] = useState<Session | null>(null)
  const [deleting, setDeleting] = useState<Session | null>(null)
  const [notice, setNotice] = useState('')
  const result = useMemo(() => {
    try {
      return { sessions: searchHistory(doc.sessions, doc.items, filter), error: '' }
    } catch (error) {
      return {
        sessions: [],
        error: error instanceof Error ? error.message : '期間を確認してください。',
      }
    }
  }, [doc.sessions, doc.items, filter])
  if (editing)
    return (
      <SessionForm
        key={editing.id}
        initial={editing}
        items={doc.items}
        disabled={disabled}
        title="学習記録を編集"
        description="項目を変更しなければ、記録当時の名称を保持します。"
        submitLabel="変更を保存する"
        onCancel={() => setEditing(null)}
        onSave={(fields) => {
          const saved = dispatch({
            type: 'session-edit',
            id: editing.id,
            expectedUpdatedAt: editing.updatedAt,
            fields,
          })
          if (saved) {
            setEditing(null)
            setNotice('学習記録を更新しました。')
          }
          return saved
        }}
      />
    )
  return (
    <section className="card history-card history-view">
      <div className="section-heading">
        <h2>
          <History size={18} />
          すべての学習記録
        </h2>
        <span className="subtle-label">{result.sessions.length} 件</span>
      </div>
      <div className="history-toolbar">
        <div className="segmented" aria-label="履歴の表示対象">
          <button
            aria-pressed={!filter.deleted}
            onClick={() => setFilter({ ...filter, deleted: false })}
          >
            学習記録
          </button>
          <button
            aria-pressed={filter.deleted}
            onClick={() => setFilter({ ...filter, deleted: true })}
          >
            削除済み
          </button>
        </div>
        <button className="text-button" onClick={() => setFilter(emptyHistoryFilter())}>
          <X size={14} />
          絞り込みを解除
        </button>
      </div>
      <div className="history-filters">
        <div className="field-pair">
          <label>
            期間の開始日
            <input
              type="date"
              value={filter.from}
              onChange={(event) => setFilter({ ...filter, from: event.target.value })}
            />
          </label>
          <label>
            期間の終了日
            <input
              type="date"
              value={filter.to}
              onChange={(event) => setFilter({ ...filter, to: event.target.value })}
            />
          </label>
        </div>
        <ItemFilters
          items={doc.items}
          value={filter}
          onChange={(value) => setFilter({ ...filter, ...value })}
        />
        <div className="search-row">
          <label>
            キーワード
            <input
              type="search"
              placeholder="学習項目・メモを検索"
              maxLength={200}
              value={filter.keyword}
              onChange={(event) => setFilter({ ...filter, keyword: event.target.value })}
            />
          </label>
          <label>
            達成判定
            <select
              aria-label="達成判定"
              value={filter.achievement}
              onChange={(event) =>
                setFilter({
                  ...filter,
                  achievement: event.target.value as typeof filter.achievement,
                })
              }
            >
              <option value="all">すべて</option>
              <option value="achieved">達成済み</option>
              <option value="unachieved">未達成</option>
            </select>
          </label>
        </div>
      </div>
      <p className="history-note">
        {DATE_RULE} 削除済み一覧では検索条件に一致する削除記録のみ表示します。
      </p>
      {result.error && (
        <p className="error" role="alert">
          {result.error}
        </p>
      )}
      {notice && (
        <p className="inline-notice" role="status">
          {notice}
        </p>
      )}
      {result.sessions.length === 0 && (
        <p className="history-empty">条件に一致する記録はありません。</p>
      )}
      <div className="history-entries">
        {result.sessions.map((session) => (
          <article className="history-entry" key={session.id} data-session-id={session.id}>
            <div className="session-row">
              <div className="session-info">
                <strong>{learningLabel(session.learning)}</strong>
                <span>
                  {dateTime(session.startedAt)} · {session.correct + session.incorrect}問 / 正答率
                  {rateLabel(accuracy(session.correct, session.incorrect))}
                </span>
              </div>
              <div className="session-duration">
                <strong>{formatDuration(session.focusMs)}</strong>
                <span>{achieved(session.focusMs) ? '達成セット' : '未達成'}</span>
              </div>
            </div>
            <details>
              <summary>詳細を見る</summary>
              <dl className="session-details">
                <div>
                  <dt>開始日時</dt>
                  <dd>{dateTime(session.startedAt)}</dd>
                </div>
                <div>
                  <dt>終了日時</dt>
                  <dd>{dateTime(session.endedAt)}</dd>
                </div>
                <div>
                  <dt>正解 / 不正解 / 合計</dt>
                  <dd>
                    {session.correct} / {session.incorrect} / {session.correct + session.incorrect}{' '}
                    問
                  </dd>
                </div>
                <div>
                  <dt>実集中時間 / 正答率</dt>
                  <dd>
                    {formatDuration(session.focusMs)} /{' '}
                    {rateLabel(accuracy(session.correct, session.incorrect))}
                  </dd>
                </div>
                <div>
                  <dt>メモ</dt>
                  <dd>{session.memo || '—'}</dd>
                </div>
                <div>
                  <dt>記録時の学習項目</dt>
                  <dd>{learningLabel(session.learning)}</dd>
                </div>
                <div>
                  <dt>作成日時</dt>
                  <dd>{dateTime(session.createdAt)}</dd>
                </div>
                <div>
                  <dt>更新日時</dt>
                  <dd>{dateTime(session.updatedAt)}</dd>
                </div>
                {session.deletedAt !== null && (
                  <div>
                    <dt>削除日時</dt>
                    <dd>{dateTime(session.deletedAt)}</dd>
                  </div>
                )}
              </dl>
            </details>
            <div className="history-actions">
              {session.deletedAt !== null ? (
                <button
                  className="text-button"
                  disabled={disabled}
                  onClick={() => {
                    if (
                      dispatch({
                        type: 'session-restore',
                        id: session.id,
                        expectedUpdatedAt: session.updatedAt,
                      })
                    )
                      setNotice('記録を復元しました。通常の履歴・統計に再び含まれます。')
                  }}
                >
                  <RotateCcw size={15} />
                  復元
                </button>
              ) : (
                <>
                  <button
                    className="text-button"
                    disabled={disabled}
                    onClick={() => setEditing(session)}
                  >
                    <Pencil size={15} />
                    編集
                  </button>
                  <button
                    className="text-button"
                    disabled={disabled}
                    onClick={() => setDeleting(session)}
                  >
                    <Trash2 size={15} />
                    削除
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {deleting && (
        <DeleteDialog
          session={deleting}
          dispatch={dispatch}
          disabled={disabled}
          close={() => setDeleting(null)}
        />
      )}
    </section>
  )
}
