import { useMemo, useState } from 'react'
import { BarChart3, Clock3, Target } from 'lucide-react'
import type { AppDocument } from '../domain/model'
import { formatDuration } from '../domain/model'
import {
  DATE_RULE,
  dailySeries,
  dayStart,
  emptyItemFilter,
  groupByItem,
  inPeriod,
  rateLabel,
  totals,
  periodBounds,
  dateKey,
} from '../domain/statistics'
import type { DailyTotals, Period } from '../domain/statistics'
import { ItemFilters } from './ItemFilters'

const periods: { id: Period; name: string }[] = [
  { id: 'today', name: '今日' },
  { id: 'week', name: '今週' },
  { id: 'month', name: '今月' },
  { id: 'all', name: '全期間' },
]

function DailyChart({
  days,
  mode,
  title,
}: {
  days: DailyTotals[]
  mode: 'bar' | 'cumulative' | 'accuracy'
  title: string
}) {
  let accumulated = 0
  const points = days.map((day) => {
    accumulated += day.focusMs
    return {
      ...day,
      value:
        mode === 'accuracy'
          ? day.rate
          : mode === 'cumulative'
            ? accumulated / 60_000
            : day.focusMs / 60_000,
    }
  })
  const maximum =
    mode === 'accuracy' ? 100 : Math.max(1, ...points.map((point) => point.value ?? 0))
  const axisNumber = new Intl.NumberFormat('ja-JP', {
    notation: 'compact',
    maximumFractionDigits: 1,
  })
  const x = (index: number) => 52 + ((index + 0.5) * 568) / points.length
  const y = (value: number) => 180 - (value / maximum) * 145
  const segments: string[][] = [[]]
  points.forEach((point, index) => {
    if (point.value === null) segments.push([])
    else segments.at(-1)!.push(`${x(index)},${y(point.value)}`)
  })
  const hasValues = points.some((point) => point.value !== null)
  return (
    <section className="card chart-card" aria-label={title}>
      <h2>{title}</h2>
      {!hasValues ? (
        <p className="chart-empty">解答のある記録を保存すると表示されます。</p>
      ) : (
        <svg viewBox="0 0 640 220" role="img" aria-label={title}>
          {[0, 0.5, 1].map((ratio) => (
            <g key={ratio}>
              <line
                x1="52"
                x2="620"
                y1={y(maximum * ratio)}
                y2={y(maximum * ratio)}
                className="chart-grid-line"
              />
              <text x="45" y={y(maximum * ratio) + 4} textAnchor="end">
                {axisNumber.format(maximum * ratio)}
                {mode === 'accuracy' ? '%' : '分'}
              </text>
            </g>
          ))}
          {mode !== 'bar' &&
            segments
              .filter((segment) => segment.length)
              .map((segment, index) => (
                <polyline key={index} points={segment.join(' ')} className="chart-line" />
              ))}
          {points.map((point, index) => (
            <g key={point.label}>
              {point.value !== null &&
                (mode === 'bar' ? (
                  <rect
                    x={x(index) - Math.min(11, 200 / points.length)}
                    y={y(point.value)}
                    width={Math.min(22, 400 / points.length)}
                    height={180 - y(point.value)}
                    rx="3"
                    className="chart-bar"
                  >
                    <title>
                      {point.label}: {point.value.toFixed(1)}分
                    </title>
                  </rect>
                ) : (
                  <circle cx={x(index)} cy={y(point.value)} r="3" className="chart-point">
                    <title>
                      {point.label}: {point.value.toFixed(1)}
                      {mode === 'accuracy' ? '%' : '分'}
                    </title>
                  </circle>
                ))}
              {(index === 0 ||
                index === points.length - 1 ||
                (points.length > 1 && index % Math.ceil(points.length / 5) === 0)) && (
                <text x={x(index)} y="203" textAnchor="middle">
                  {new Date(point.day).getMonth() + 1}/{new Date(point.day).getDate()}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
      {mode === 'accuracy' && (
        <p className="history-note">日ごとの合計正解数 ÷ 合計問題数。解答のない日は未表示です。</p>
      )}
      {mode === 'cumulative' && (
        <p className="history-note">グラフ表示期間内の集中時間を日ごとに累積しています。</p>
      )}
      <details className="chart-data">
        <summary>グラフの数値を見る</summary>
        <div className="table-scroll">
          <table>
            <caption>{title}の数値</caption>
            <thead>
              <tr>
                <th>日付</th>
                <th>{mode === 'accuracy' ? '正答率' : '集中時間'}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.label}>
                  <th>{point.label}</th>
                  <td>
                    {mode === 'accuracy' ? rateLabel(point.value) : `${point.value!.toFixed(1)}分`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

export function StatisticsView({ doc, now }: { doc: AppDocument; now: number }) {
  const [period, setPeriod] = useState<Period>('today')
  const [filter, setFilter] = useState(emptyItemFilter)
  const today = dayStart(now)
  const bounds = periodBounds(period, today)
  const sessions = useMemo(
    () => inPeriod(doc.sessions, period, today, filter),
    [doc.sessions, period, today, filter],
  )
  const summary = useMemo(() => totals(sessions), [sessions])
  const days = useMemo(() => dailySeries(sessions, period, today), [sessions, period, today])
  const level = filter.middleId ? 'small' : filter.subjectId ? 'middle' : 'subject'
  const groups = useMemo(
    () => groupByItem(sessions, doc.items, level),
    [sessions, doc.items, level],
  )
  const subjects = useMemo(() => groupByItem(sessions, doc.items, 'subject'), [sessions, doc.items])
  const maxSubject = Math.max(1, ...subjects.map((subject) => subject.focusMs))
  return (
    <div className="statistics-view">
      <section className="card statistics-controls">
        <div className="section-heading">
          <h2>
            <BarChart3 size={18} />
            学習の積み重ね
          </h2>
          <span className="subtle-label">
            {bounds.start === null
              ? 'すべての保存済み記録'
              : `${dateKey(bounds.start)} ～ ${dateKey(bounds.end! - 1)}`}
          </span>
        </div>
        <div className="segmented period-selector" aria-label="集計期間">
          {periods.map((option) => (
            <button
              key={option.id}
              aria-pressed={period === option.id}
              onClick={() => setPeriod(option.id)}
            >
              {option.name}
            </button>
          ))}
        </div>
        <ItemFilters items={doc.items} value={filter} onChange={setFilter} />
        <p className="history-note">{DATE_RULE}</p>
        {period === 'all' && (
          <p className="history-note">
            集計と項目別比較は全履歴、日別グラフは今日を含む直近30日を表示します。
          </p>
        )}
      </section>
      <section className="stats-grid statistics-summary" aria-label="期間の集計">
        <div className="stat-card" data-testid="stats-focus">
          <span>
            <Clock3 size={16} />
            実集中時間
          </span>
          <strong>
            {Math.floor(summary.focusMs / 60_000)}
            <small>分</small>
          </strong>
          <p>{formatDuration(summary.focusMs)} · 保存済みの合計</p>
        </div>
        <div className="stat-card" data-testid="stats-sets">
          <span>
            <Target size={16} />
            達成セット
          </span>
          <strong>
            {summary.sets}
            <small>セット</small>
          </strong>
          <p>{summary.sessions}セッション</p>
        </div>
        <div className="stat-card" data-testid="stats-questions">
          <span>合計問題数 / 正答率</span>
          <strong>
            {summary.questions}
            <small>問</small>
          </strong>
          <p>
            正解 {summary.correct} / 不正解 {summary.incorrect} · {rateLabel(summary.rate)}
          </p>
        </div>
      </section>
      {summary.sessions === 0 && <p className="history-empty">この条件の学習記録はありません。</p>}
      <section className="card item-statistics" aria-label="学習項目別集計">
        <p className="table-hint">横にスクロールして全項目を確認できます。</p>
        <div className="section-heading">
          <h2>{level === 'subject' ? '教科' : level === 'middle' ? '中項目' : '小項目'}別の学習</h2>
          <span className="subtle-label">現在の項目名で表示</span>
        </div>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">学習項目別集計</caption>
            <thead>
              <tr>
                <th>学習項目</th>
                <th>集中時間</th>
                <th>達成セット</th>
                <th>問題数</th>
                <th>正解数</th>
                <th>正答率</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id ?? 'unselected'} data-item-id={group.id ?? 'unselected'}>
                  <th>
                    {group.name}
                    {group.archived && <small>アーカイブ済み</small>}
                  </th>
                  <td>{formatDuration(group.focusMs)}</td>
                  <td>{group.sets}</td>
                  <td>{group.questions}</td>
                  <td>{group.correct}</td>
                  <td>{rateLabel(group.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {groups.length === 0 && <p className="history-empty">集計できる記録はありません。</p>}
        <p className="history-note">
          同じ項目IDは改名・アーカイブ後もまとめて集計します。未選択の階層は「未選択」に含めます。
        </p>
      </section>
      <div className="charts-grid">
        <DailyChart days={days} mode="bar" title="日別集中時間" />
        <DailyChart days={days} mode="cumulative" title="学習時間の推移" />
        <section className="card chart-card" aria-label="教科別の学習時間比較">
          <h2>教科別の学習時間比較</h2>
          <ul className="subject-bars">
            {subjects.map((subject) => (
              <li key={subject.id}>
                <div>
                  <span>{subject.name}</span>
                  <strong>{formatDuration(subject.focusMs)}</strong>
                </div>
                <div className="subject-track">
                  <span style={{ width: `${(subject.focusMs / maxSubject) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
          {subjects.length === 0 && (
            <p className="chart-empty">学習記録を保存すると表示されます。</p>
          )}
        </section>
        <DailyChart days={days} mode="accuracy" title="正答率の推移" />
      </div>
    </div>
  )
}
