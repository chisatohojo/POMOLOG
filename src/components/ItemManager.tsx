import { useState } from 'react'
import { Archive, ArrowDown, ArrowUp, ChevronRight, Pencil, Plus, RotateCcw } from 'lucide-react'
import { children, isAvailable } from '../domain/learning'
import type { StudyItem } from '../domain/learning'
import type { Action, AppDocument } from '../domain/model'
import { STUDY_TEMPLATES } from '../domain/templates'

const levelNames = { subject: '教科', middle: '中項目', small: '小項目' }

function ItemRow({
  item,
  selected,
  onSelect,
  dispatch,
  canMove,
  first,
  last,
}: {
  item: StudyItem
  selected: boolean
  onSelect: () => void
  dispatch: (action: Action) => boolean
  canMove: boolean
  first: boolean
  last: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.name)
  return (
    <li className={`master-row ${selected ? 'selected' : ''} ${item.archived ? 'archived' : ''}`}>
      {editing ? (
        <form
          className="rename-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (name.trim() === item.name || dispatch({ type: 'item-rename', id: item.id, name }))
              setEditing(false)
          }}
        >
          <label className="sr-only" htmlFor={`rename-${item.id}`}>
            新しい名称
          </label>
          <input
            id={`rename-${item.id}`}
            value={name}
            maxLength={100}
            required
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
          <button className="text-button" type="submit">
            変更
          </button>
          <button className="text-button" type="button" onClick={() => setEditing(false)}>
            取消
          </button>
        </form>
      ) : (
        <>
          <button type="button" className="master-name" onClick={onSelect} aria-pressed={selected}>
            <span>
              {item.name}
              {item.archived && <small>アーカイブ済み</small>}
            </span>
            {item.level !== 'small' && <ChevronRight size={14} />}
          </button>
          <div className="master-actions">
            <button
              className="icon-button"
              type="button"
              aria-label={`${item.name}を上へ`}
              disabled={!canMove || first}
              onClick={() => dispatch({ type: 'item-move', id: item.id, direction: -1 })}
            >
              <ArrowUp size={14} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={`${item.name}を下へ`}
              disabled={!canMove || last}
              onClick={() => dispatch({ type: 'item-move', id: item.id, direction: 1 })}
            >
              <ArrowDown size={14} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={`${item.name}を改名`}
              onClick={() => {
                setName(item.name)
                setEditing(true)
              }}
            >
              <Pencil size={14} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={`${item.name}を${item.archived ? '復元' : 'アーカイブ'}`}
              onClick={() =>
                dispatch({ type: 'item-archive', id: item.id, archived: !item.archived })
              }
            >
              {item.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
            </button>
          </div>
        </>
      )}
    </li>
  )
}

function ItemColumn({
  level,
  parentId,
  items,
  selectedId,
  onSelect,
  showArchived,
  dispatch,
}: {
  level: StudyItem['level']
  parentId: string | null
  items: StudyItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  showArchived: boolean
  dispatch: (action: Action) => boolean
}) {
  const [name, setName] = useState('')
  const validParent = level === 'subject' || Boolean(parentId && isAvailable(items, parentId))
  const list =
    level !== 'subject' && !parentId ? [] : children(items, level, parentId, showArchived)
  const active = children(items, level, parentId)
  return (
    <section className="master-column" aria-label={`${levelNames[level]}管理`}>
      <h3>
        {levelNames[level]}
        <span>{list.length}</span>
      </h3>
      <ul className="master-list">
        {list.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            selected={selectedId === item.id}
            onSelect={() => onSelect(item.id)}
            dispatch={dispatch}
            canMove={isAvailable(items, item.id)}
            first={active[0]?.id === item.id}
            last={active.at(-1)?.id === item.id}
          />
        ))}
      </ul>
      {list.length === 0 && (
        <p className="master-empty">
          {level !== 'subject' && !parentId
            ? '左（上）の親項目を選択してください。'
            : '登録された項目はありません。'}
        </p>
      )}
      <form
        className="add-item-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (dispatch({ type: 'item-add', id: crypto.randomUUID(), level, parentId, name }))
            setName('')
        }}
      >
        <label className="sr-only" htmlFor={`add-${level}`}>
          新しい{levelNames[level]}
        </label>
        <input
          id={`add-${level}`}
          value={name}
          maxLength={100}
          required
          disabled={!validParent}
          placeholder={`${levelNames[level]}を追加`}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="submit"
          className="secondary"
          aria-label={`${levelNames[level]}を追加`}
          disabled={!validParent || !name.trim()}
        >
          <Plus size={17} />
        </button>
      </form>
    </section>
  )
}

export function ItemManager({
  doc,
  dispatch,
  disabled,
}: {
  doc: AppDocument
  dispatch: (action: Action) => boolean
  disabled: boolean
}) {
  const [subjectId, setSubjectId] = useState<string | null>(doc.selection.subjectId)
  const [middleId, setMiddleId] = useState<string | null>(doc.selection.middleId)
  const [smallId, setSmallId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [templates, setTemplates] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const subject =
    doc.items.find(
      (item) => item.id === subjectId && (showArchived || isAvailable(doc.items, item.id)),
    ) ?? children(doc.items, 'subject', null, showArchived)[0]
  const middle = doc.items.find(
    (item) =>
      item.id === middleId &&
      item.parentId === subject?.id &&
      (showArchived || isAvailable(doc.items, item.id)),
  )
  return (
    <div className="item-manager">
      <section className="card master-card">
        <div className="section-heading">
          <h2>学習項目を整える</h2>
        </div>
        <p className="muted">
          教科から順に選んで、あなたの学習に合わせて編集できます。中項目・小項目は未選択でも記録できます。
        </p>
        <fieldset disabled={disabled}>
          <label className="checkbox-label archive-toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            アーカイブ済みも表示
          </label>
          <div className="master-grid">
            <ItemColumn
              level="subject"
              parentId={null}
              items={doc.items}
              selectedId={subject?.id ?? null}
              showArchived={showArchived}
              dispatch={dispatch}
              onSelect={(id) => {
                setSubjectId(id)
                setMiddleId(null)
                setSmallId(null)
              }}
            />
            <ItemColumn
              key={`middle-${subject?.id}`}
              level="middle"
              parentId={subject?.id ?? null}
              items={doc.items}
              selectedId={middle?.id ?? null}
              showArchived={showArchived}
              dispatch={dispatch}
              onSelect={(id) => {
                setMiddleId(id)
                setSmallId(null)
              }}
            />
            <ItemColumn
              key={`small-${middle?.id}`}
              level="small"
              parentId={middle?.id ?? null}
              items={doc.items}
              selectedId={smallId}
              showArchived={showArchived}
              dispatch={dispatch}
              onSelect={setSmallId}
            />
          </div>
        </fieldset>
        <p className="history-note">
          改名後も過去の記録には当時の名称が残ります。アーカイブすると子項目も選択肢から隠れますが、記録は保持されます。復元は親項目から順に行えます。
        </p>
      </section>
      <section className="card template-card">
        <div className="section-heading">
          <h2>テンプレートから追加</h2>
          <span className="subtle-label">高校基礎</span>
        </div>
        <p className="muted">
          必要な教科だけ選んで一括追加。追加後は自由に編集できます。同じテンプレートを再度追加しても重複しません。
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const added = dispatch({ type: 'apply-templates', ids: templates })
            setMessage(
              added
                ? '選択したテンプレートを追加しました。'
                : '新しい項目は追加されませんでした。登録済み項目や画面上の案内をご確認ください。',
            )
          }}
        >
          <fieldset disabled={disabled}>
            <div className="template-grid">
              {STUDY_TEMPLATES.map((template) => (
                <label className="template-option" key={template.id}>
                  <input
                    type="checkbox"
                    checked={templates.includes(template.id)}
                    onChange={(event) =>
                      setTemplates((current) =>
                        event.target.checked
                          ? [...current, template.id]
                          : current.filter((id) => id !== template.id),
                      )
                    }
                  />
                  <span>
                    <strong>{template.title}</strong>
                    <small>{template.subject.middles.map((item) => item.name).join('・')}</small>
                    <small>
                      中項目 {template.subject.middles.length} / 小項目{' '}
                      {template.subject.middles.reduce((sum, item) => sum + item.smalls.length, 0)}
                    </small>
                  </span>
                </label>
              ))}
            </div>
            <button className="primary" type="submit" disabled={templates.length === 0}>
              <Plus size={17} />
              選択したテンプレートを追加
            </button>
          </fieldset>
        </form>
        <p className="template-message" role="status">
          {message}
        </p>
      </section>
    </div>
  )
}
