import { useEffect, useRef, useState } from 'react'
import { Check, Save } from 'lucide-react'
import { achieved, accuracy, formatDuration } from '../domain/model'
import type { Action, Timer } from '../domain/model'
import { StudyFields } from './StudyFields'

function localDateTime(time: number): string {
  const date = new Date(time)
  return new Date(time - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19)
}

export function Review({
  timer,
  save,
  disabled,
}: {
  timer: Timer
  save: (action: Action) => boolean
  disabled: boolean
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  const [learning, setLearning] = useState(timer.learning)
  const [correct, setCorrect] = useState(timer.correct)
  const [incorrect, setIncorrect] = useState(timer.incorrect)
  const [memo, setMemo] = useState(timer.memo)
  const initialStart = localDateTime(timer.startedAt)
  const initialEnd = localDateTime(timer.endedAt!)
  const [start, setStart] = useState(initialStart)
  const [end, setEnd] = useState(initialEnd)
  const initialSeconds = Math.floor(timer.accumulatedMs / 1000)
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
            おつかれさまでした。
          </h2>
        </div>
        <span className="icon-disc">
          <Check size={22} />
        </span>
      </div>
      <p className="muted">
        内容を確認して、このセットを記録しましょう。保存するまで次のセットは始まりません。
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const startedAt = start === initialStart ? timer.startedAt : new Date(start).getTime()
          const endedAt = end === initialEnd ? timer.endedAt! : new Date(end).getTime()
          const duration =
            minutes === Math.floor(initialSeconds / 60) && seconds === initialSeconds % 60
              ? timer.accumulatedMs
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
          save({
            type: 'save',
            session: { learning, correct, incorrect, memo, startedAt, endedAt, focusMs: duration },
          })
        }}
      >
        <fieldset disabled={disabled}>
          <StudyFields value={learning} onChange={setLearning} />
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
              value={memo}
              maxLength={10000}
              rows={4}
              onChange={(e) => setMemo(e.target.value)}
            />
          </label>
          <div className="review-summary">
            <span>{achieved(focusMs) ? '達成セット +1' : '20分未満・達成セットへの加算なし'}</span>
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
            この内容で保存する
          </button>
        </fieldset>
      </form>
    </section>
  )
}
