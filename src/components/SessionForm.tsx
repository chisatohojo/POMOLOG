import { useEffect, useRef, useState } from 'react'
import { Check, Save } from 'lucide-react'
import { achieved, accuracy, formatDuration } from '../domain/model'
import type { SessionContent } from '../domain/model'
import { StudyFields } from './StudyFields'
import type { StudyItem } from '../domain/learning'

function localDateTime(time: number): string {
  const date = new Date(time)
  return new Date(time - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19)
}

export function SessionForm({
  initial,
  onSave,
  disabled,
  items,
  title,
  description,
  submitLabel,
  onCancel,
}: {
  initial: SessionContent
  onSave: (fields: SessionContent) => boolean
  disabled: boolean
  items: StudyItem[]
  title: string
  description: string
  submitLabel: string
  onCancel?: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  const [learning, setLearning] = useState(initial.learning)
  const [correct, setCorrect] = useState(initial.correct)
  const [incorrect, setIncorrect] = useState(initial.incorrect)
  const [memo, setMemo] = useState(initial.memo)
  const initialStart = localDateTime(initial.startedAt)
  const initialEnd = localDateTime(initial.endedAt!)
  const [start, setStart] = useState(initialStart)
  const [end, setEnd] = useState(initialEnd)
  const initialSeconds = Math.floor(initial.focusMs / 1000)
  const [minutes, setMinutes] = useState(Math.floor(initialSeconds / 60))
  const [seconds, setSeconds] = useState(initialSeconds % 60)
  const [error, setError] = useState('')
  const focusMs = minutes * 60_000 + seconds * 1000
  const rate = accuracy(correct, incorrect)

  return (
    <section className="card review-card" aria-labelledby="review-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">SESSION REVIEW</span>
          <h2 ref={heading} id="review-title" tabIndex={-1}>
            {title}
          </h2>
        </div>
        <span className="icon-disc">
          <Check size={22} />
        </span>
      </div>
      <p className="muted">{description}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const startedAt = start === initialStart ? initial.startedAt : new Date(start).getTime()
          const endedAt = end === initialEnd ? initial.endedAt! : new Date(end).getTime()
          const duration =
            minutes === Math.floor(initialSeconds / 60) && seconds === initialSeconds % 60
              ? initial.focusMs
              : focusMs
          if (
            !Number.isFinite(startedAt) ||
            !Number.isFinite(endedAt) ||
            endedAt < startedAt ||
            duration > endedAt - startedAt
          ) {
            setError(
              '終了時刻は開始時刻以降に、集中時間は開始から終了までの時間以内にしてください。',
            )
            return
          }
          setError('')
          if (
            !onSave({ learning, correct, incorrect, memo, startedAt, endedAt, focusMs: duration })
          )
            setError(
              '保存できませんでした。画面上の案内を確認してください。入力内容は保持しています。',
            )
        }}
      >
        <fieldset disabled={disabled}>
          <StudyFields value={learning} items={items} onChange={setLearning} />
          <div className="field-pair">
            <label>
              開始時刻
              <input
                type="datetime-local"
                step="1"
                value={start}
                required
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              終了時刻
              <input
                type="datetime-local"
                step="1"
                value={end}
                required
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
          <div className="review-metrics">
            <label>
              集中時間（分）
              <input
                type="number"
                min="0"
                max="1000000"
                required
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />
            </label>
            <label>
              秒
              <input
                type="number"
                min="0"
                max="59"
                required
                value={seconds}
                onChange={(e) => setSeconds(Number(e.target.value))}
              />
            </label>
            <label>
              正解数
              <input
                type="number"
                min="0"
                max="1000000"
                required
                value={correct}
                onChange={(e) => setCorrect(Number(e.target.value))}
              />
            </label>
            <label>
              不正解数
              <input
                type="number"
                min="0"
                max="1000000"
                required
                value={incorrect}
                onChange={(e) => setIncorrect(Number(e.target.value))}
              />
            </label>
          </div>
          <label>
            メモ
            <textarea
              aria-label="メモ"
              value={memo}
              maxLength={10000}
              rows={4}
              onChange={(e) => setMemo(e.target.value)}
            />
          </label>
          <div className="review-summary">
            <span>{achieved(focusMs) ? '達成セット' : '20分未満・達成セットへの加算なし'}</span>
            <span>
              {formatDuration(focusMs)} · {correct + incorrect}問 · 正答率{' '}
              {rate === null ? '—' : `${Math.round(rate)}%`}
            </span>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary save-button" type="submit">
            <Save size={18} />
            {submitLabel}
          </button>
        </fieldset>
        {onCancel && (
          <button className="secondary cancel-edit" type="button" onClick={onCancel}>
            編集を閉じる
          </button>
        )}
      </form>
    </section>
  )
}
