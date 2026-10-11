import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  CircleHelp,
  Coffee,
  History,
  Pause,
  Play,
  RotateCcw,
  Square,
  Target,
  Timer as TimerIcon,
  X,
} from 'lucide-react'
import { AppStore } from './app/store'
import { EditorLockController } from './app/editorLock'
import { useEditorLock } from './app/useEditorLock'
import { LocalRepository, STORAGE_KEY } from './data/repository'
import {
  NOTIFICATION_MS,
  accuracy,
  achieved,
  elapsedMs,
  formatDuration,
  learningLabel,
} from './domain/model'
import type { Action, Learning, RecordFields, Session } from './domain/model'
import { StudyFields } from './components/StudyFields'
import { Review } from './components/Review'
import { TodaySummary } from './components/TodaySummary'

const dateFormat = new Intl.DateTimeFormat('ja-JP', {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
})
const timeFormat = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' })

function SessionList({ sessions }: { sessions: Session[] }) {
  return sessions.length === 0 ? (
    <div className="empty-history">
      <BookOpen size={26} />
      <div>
        <strong>最初の集中を、ここから。</strong>
        <p>保存した学習記録がここに並びます。</p>
      </div>
    </div>
  ) : (
    <div className="session-list">
      {sessions.map((session) => {
        const rate = accuracy(session.correct, session.incorrect)
        return (
          <article className="session-row" key={session.id}>
            <span className={`session-mark ${achieved(session.focusMs) ? 'complete' : ''}`}>
              <Check size={18} />
            </span>
            <div className="session-info">
              <strong>{learningLabel(session.learning)}</strong>
              <span>
                {new Date(session.startedAt).toLocaleDateString('ja-JP')} ·{' '}
                {timeFormat.format(session.startedAt)}–{timeFormat.format(session.endedAt)} ·{' '}
                {session.correct + session.incorrect}問
                {rate === null ? '' : ` / 正答率${Math.round(rate)}%`}
              </span>
              {session.memo && <p>{session.memo}</p>}
            </div>
            <div className="session-duration">
              <strong>{formatDuration(session.focusMs)}</strong>
              <span>{achieved(session.focusMs) ? '達成セット' : '学習記録'}</span>
            </div>
          </article>
        )
      })}
    </div>
  )
}

export default function App() {
  const [editorLock] = useState(() => new EditorLockController(navigator.locks))
  const [notice, setNotice] = useState('')
  const [notificationPermission, setNotificationPermission] = useState(() =>
    'Notification' in window ? Notification.permission : 'unsupported',
  )
  const [store] = useState(
    () =>
      new AppStore(
        new LocalRepository({
          getItem: (key) => localStorage.getItem(key),
          setItem: (key, value) => localStorage.setItem(key, value),
        }),
        () => {
          setNotice('25分に到達しました。おつかれさまです！ 集中はそのまま続けられます。')
          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification('POMOLOG · 25分に到達', {
                body: '集中は継続中です。区切りのよいところでセットを終了しましょう。',
                icon: '/icons/icon-192.png',
                tag: 'pomolog-25-minutes',
              })
            } catch {
              /* In-app notification remains available on unsupported mobile browsers. */
            }
          }
        },
        Date.now,
        editorLock.isOwner,
      ),
  )
  const { document: doc, error } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [now, setNow] = useState(Date.now)
  const [tab, setTab] = useState<'timer' | 'history'>('timer')
  const access = useEditorLock(editorLock, store)
  const disabled = access.status !== 'ready' || doc === null
  useEffect(() => {
    const tick = () => {
      setNow(Date.now())
      if (editorLock.isOwner()) store.checkNotification()
    }
    tick()
    const interval = window.setInterval(tick, 250)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [store, editorLock])

  const dispatch = (action: Action) => {
    if (disabled) return false
    store.checkNotification()
    return store.dispatch(action)
  }
  function exportData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? JSON.stringify(doc)
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `pomolog-${new Date().toLocaleDateString('sv-SE')}.json`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setNotice('データを書き出せませんでした。ブラウザの保存設定を確認してください。')
    }
  }
  const timer = doc?.timer ?? null
  const elapsed = elapsedMs(timer, now)
  const goalReached = achieved(elapsed)
  const running = timer?.status === 'running'
  const reviewing = timer?.status === 'review'
  const learning = timer?.learning ?? doc?.selection ?? { subject: '数学', middle: '', small: '' }
  const count = (timer?.correct ?? 0) + (timer?.incorrect ?? 0)
  const rate = accuracy(timer?.correct ?? 0, timer?.incorrect ?? 0)
  const sessions = doc?.sessions ?? []
  const editFields = (fields: Partial<RecordFields>) => {
    if (timer)
      dispatch({
        type: 'edit',
        fields: {
          learning: timer.learning,
          correct: timer.correct,
          incorrect: timer.incorrect,
          memo: timer.memo,
          ...fields,
        },
      })
  }
  const changeLearning = (value: Learning) => {
    if (timer) editFields({ learning: value })
    else dispatch({ type: 'select', learning: value })
  }
  const progress = Math.min(elapsed / NOTIFICATION_MS, 1)
  const statusText = !timer
    ? '開始する準備ができています'
    : running
      ? '集中しています'
      : timer.status === 'paused'
        ? '一時停止中'
        : timer.status === 'break'
          ? '休憩中'
          : '記録を確認中'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault()
            setTab('timer')
          }}
          aria-label="POMOLOG ホーム"
        >
          <span className="brand-mark" aria-hidden="true">
            <img src="/logo.png" alt="" />
          </span>
          <span className="brand-wordmark">
            POMOLOG<small>集中を、積み重ねよう。</small>
          </span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="メインナビゲーション">
          <button
            className={tab === 'timer' ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab('timer')}
            aria-current={tab === 'timer' ? 'page' : undefined}
          >
            <TimerIcon size={20} />
            集中タイマー
          </button>
          <button
            className={tab === 'history' ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab('history')}
            aria-current={tab === 'history' ? 'page' : undefined}
          >
            <History size={20} />
            学習履歴<span className="nav-count">{sessions.length}</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span />
            この端末に保存
          </div>
          <p>
            あなたのペースで、
            <br />
            今日もひとつずつ。
          </p>
          <button className="text-button export-button" onClick={exportData}>
            <ArrowDownToLine size={16} />
            データを書き出す
          </button>
          <span className="version">A LITTLE, EVERY DAY.</span>
        </div>
      </aside>
      <main>
        <header className="page-heading">
          <div>
            <span className="eyebrow">YOUR STUDY, YOUR PACE</span>
            <h1>{tab === 'timer' ? '集中タイマー' : '学習履歴'}</h1>
            <p>
              {tab === 'timer'
                ? '目の前のひとつに、集中しよう。'
                : '積み重ねた時間を、振り返ろう。'}
            </p>
          </div>
          <div className="date-label">
            <span className="date-dot" />
            {dateFormat.format(now)}
          </div>
        </header>
        {access.status === 'pending' && (
          <div className="banner" role="alert">
            編集権限を待っています。別のタブが編集中の場合、そのタブを閉じると自動で引き継ぎます。
          </div>
        )}
        {access.status === 'error' && (
          <div className="banner error" role="alert">
            {access.message} データを保護するため編集を停止しています。
            <button className="text-button" onClick={() => editorLock.start(() => store.reload())}>
              再試行
            </button>
          </div>
        )}
        {error && (
          <div className="banner error" role="alert">
            {error}
            <button className="text-button" onClick={() => location.reload()}>
              再読み込み
            </button>
          </div>
        )}
        {notice && (
          <div className="banner notification" role="status">
            <Bell size={18} />
            <span>{notice}</span>
            <button className="icon-button" aria-label="通知を閉じる" onClick={() => setNotice('')}>
              <X size={18} />
            </button>
          </div>
        )}
        {tab === 'history' && <TodaySummary sessions={sessions} now={now} />}
        {tab === 'timer' ? (
          reviewing && timer ? (
            <Review key={timer.id} timer={timer} save={dispatch} disabled={disabled} />
          ) : (
            <div className="workspace">
              <section className="card timer-card" aria-labelledby="timer-title">
                <div className="section-heading">
                  <h2 id="timer-title">
                    <TimerIcon size={18} />
                    FOCUS TIMER
                  </h2>
                  <span className={`status-pill ${running ? 'is-running' : ''}`}>
                    <span />
                    {!timer
                      ? 'READY'
                      : running
                        ? 'FOCUS'
                        : timer.status === 'break'
                          ? 'BREAK'
                          : 'PAUSED'}
                  </span>
                </div>
                <div className="timer-dial">
                  <svg viewBox="0 0 320 320" aria-hidden="true">
                    <circle className="dial-track" cx="160" cy="160" r="145" />
                    <circle
                      className="dial-progress"
                      cx="160"
                      cy="160"
                      r="145"
                      pathLength="100"
                      strokeDasharray={`${progress * 100} 100`}
                    />
                    <circle className="goal-dot" cx="22.1" cy="115.2" r="5" />
                  </svg>
                  <div className="timer-value">
                    <span className="timer-caption">集中時間</span>
                    <strong role="timer" aria-label="集中経過時間" data-testid="elapsed">
                      {formatDuration(elapsed)}
                    </strong>
                    <span className="timer-state">{statusText}</span>
                    {elapsed >= NOTIFICATION_MS && (
                      <span className="overtime">
                        +{formatDuration(elapsed - NOTIFICATION_MS)} 延長中
                      </span>
                    )}
                  </div>
                </div>
                <div className={`goal-status ${goalReached ? 'achieved' : ''}`}>
                  {goalReached ? <Check size={16} /> : <Target size={16} />}
                  <span>
                    {goalReached
                      ? '20分達成 · このセットは達成として記録されます'
                      : '20分の集中で、1セット達成'}
                  </span>
                </div>
                <fieldset className="timer-controls" disabled={disabled}>
                  {!timer ? (
                    <button
                      className="primary start-button"
                      onClick={() => dispatch({ type: 'start', id: crypto.randomUUID() })}
                    >
                      <Play size={19} fill="currentColor" />
                      集中をはじめる
                    </button>
                  ) : (
                    <>
                      <div className="control-pair">
                        {running ? (
                          <>
                            <button
                              className="secondary"
                              onClick={() => dispatch({ type: 'pause' })}
                            >
                              <Pause size={18} />
                              一時停止
                            </button>
                            <button
                              className="secondary"
                              onClick={() => dispatch({ type: 'break' })}
                            >
                              <Coffee size={18} />
                              休憩する
                            </button>
                          </>
                        ) : (
                          <button className="primary" onClick={() => dispatch({ type: 'resume' })}>
                            <Play size={18} />
                            集中を再開する
                          </button>
                        )}
                      </div>
                      <button
                        className="finish-button"
                        onClick={() => dispatch({ type: 'finish' })}
                      >
                        <Square size={13} fill="currentColor" />
                        このセットを終了
                      </button>
                    </>
                  )}
                </fieldset>
                <div className="timer-note">
                  <CircleHelp size={15} />
                  <p>
                    25分でお知らせ。その後も自由に続けられます。
                    <br />
                    終了・休憩への切り替えは、あなたのタイミングで。
                  </p>
                </div>
              </section>
              <div className="record-column">
                <section className="card study-card">
                  <div className="section-heading">
                    <h2>
                      <BookOpen size={18} />
                      学習内容
                    </h2>
                    <span className="subtle-label">このセットの記録</span>
                  </div>
                  <fieldset disabled={disabled}>
                    <StudyFields value={learning} onChange={changeLearning} />
                  </fieldset>
                </section>
                <section className="card problem-card">
                  <div className="section-heading">
                    <h2>
                      <CheckCheck size={18} />
                      問題数
                    </h2>
                    <button
                      className="text-button undo-button"
                      disabled={disabled || !timer?.undo.length}
                      onClick={() => dispatch({ type: 'undo' })}
                    >
                      <RotateCcw size={14} />
                      取り消す
                    </button>
                  </div>
                  <div className="counter-grid">
                    <button
                      className="counter correct"
                      disabled={disabled || !timer}
                      onClick={() => dispatch({ type: 'count', kind: 'correct' })}
                    >
                      <span>
                        正解 <Check size={15} />
                      </span>
                      <strong>{timer?.correct ?? 0}</strong>
                      <span className="counter-plus">＋1</span>
                    </button>
                    <button
                      className="counter incorrect"
                      disabled={disabled || !timer}
                      onClick={() => dispatch({ type: 'count', kind: 'incorrect' })}
                    >
                      <span>
                        不正解 <X size={15} />
                      </span>
                      <strong>{timer?.incorrect ?? 0}</strong>
                      <span className="counter-plus">＋1</span>
                    </button>
                  </div>
                  <div className="problem-summary">
                    <span>
                      合計 <strong>{count}</strong> 問
                    </span>
                    <span>
                      正答率 <strong>{rate === null ? '—' : `${Math.round(rate)}%`}</strong>
                    </span>
                  </div>
                </section>
              </div>
            </div>
          )
        ) : (
          <section className="card history-card">
            <div className="section-heading">
              <h2>
                <History size={18} />
                すべての学習記録
              </h2>
              <span className="subtle-label">{sessions.length} 件</span>
            </div>
            <SessionList sessions={[...sessions].reverse()} />
            <p className="history-note">
              定期的にデータを書き出して、積み重ねた記録を保管しましょう。
            </p>
          </section>
        )}
        {tab === 'timer' && <TodaySummary sessions={sessions} now={now} />}
        {tab === 'timer' && !reviewing && (
          <section className="card memo-card">
            <div className="section-heading">
              <h2>
                <BookOpen size={18} />
                メモ
              </h2>
              <span className="subtle-label">気づきを残そう</span>
            </div>
            <label className="sr-only" htmlFor="session-memo">
              学習メモ
            </label>
            <textarea
              id="session-memo"
              value={timer?.memo ?? ''}
              disabled={disabled || !timer}
              maxLength={10000}
              placeholder={
                timer
                  ? '学んだこと、つまずいたこと、次にやること…'
                  : '集中をはじめると、メモを入力できます。'
              }
              onChange={(event) => editFields({ memo: event.target.value })}
            />
            <span className="memo-length">{timer?.memo.length ?? 0} / 10,000</span>
          </section>
        )}
        {tab === 'timer' && !reviewing && (
          <section className="card history-card recent-history">
            <div className="section-heading">
              <h2>
                <History size={18} />
                最近の学習
              </h2>
              <button className="text-button" onClick={() => setTab('history')}>
                すべて見る
                <ArrowRight size={15} />
              </button>
            </div>
            <SessionList sessions={[...sessions].reverse().slice(0, 3)} />
          </section>
        )}
        <footer className="page-footer">
          <span>
            <span className="footer-dot" />
            {timer && !error
              ? 'セットの状態は自動保存されます'
              : '記録はこのブラウザに保存されます'}
          </span>
          <div className="footer-actions">
            <button className="text-button mobile-export" onClick={exportData}>
              <ArrowDownToLine size={14} />
              データを書き出す
            </button>
            <button
              className="text-button"
              disabled={
                notificationPermission === 'unsupported' ||
                notificationPermission === 'granted' ||
                notificationPermission === 'denied'
              }
              onClick={async () => {
                try {
                  setNotificationPermission(await Notification.requestPermission())
                } catch {
                  setNotice('ブラウザ通知を許可できませんでした。画面内でお知らせします。')
                }
              }}
            >
              <Bell size={14} />
              {notificationPermission === 'granted'
                ? 'ブラウザ通知 ON'
                : notificationPermission === 'denied'
                  ? '画面内で通知（ブラウザ設定で変更可）'
                  : notificationPermission === 'unsupported'
                    ? '画面内で通知'
                    : 'ブラウザ通知を許可'}
            </button>
          </div>
        </footer>
      </main>
    </div>
  )
}
