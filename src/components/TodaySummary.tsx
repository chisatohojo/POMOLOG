import { CheckCheck, Clock3, Target } from 'lucide-react'
import { accuracy, achieved } from '../domain/model'
import type { Session } from '../domain/model'

export function TodaySummary({ sessions, now }: { sessions: Session[]; now: number }) {
  const today = sessions.filter(
    (s) => new Date(s.startedAt).toDateString() === new Date(now).toDateString(),
  )
  const focus = today.reduce((sum, s) => sum + s.focusMs, 0)
  const correct = today.reduce((sum, s) => sum + s.correct, 0)
  const incorrect = today.reduce((sum, s) => sum + s.incorrect, 0)
  const rate = accuracy(correct, incorrect)
  return (
    <section className="stats-grid" aria-label="本日の保存済み記録">
      <div className="stat-card">
        <span>
          <Clock3 size={16} />
          今日の集中時間
        </span>
        <strong>
          {Math.floor(focus / 60_000)}
          <small>分</small>
        </strong>
        <p>保存したセットの合計</p>
      </div>
      <div className="stat-card">
        <span>
          <Target size={16} />
          達成セット
        </span>
        <strong>
          {today.filter((s) => achieved(s.focusMs)).length}
          <small>セット</small>
        </strong>
        <p>20分以上の集中</p>
      </div>
      <div className="stat-card">
        <span>
          <CheckCheck size={16} />
          解いた問題
        </span>
        <strong>
          {correct + incorrect}
          <small>問</small>
        </strong>
        <p>
          正解 {correct} 問 · 正答率 {rate === null ? '—' : `${Math.round(rate)}%`}
        </p>
      </div>
    </section>
  )
}
