import { children, isAvailable, learningFromIds } from '../domain/learning'
import type { Learning, StudyItem } from '../domain/learning'

export function StudyFields({
  value,
  items,
  onChange,
  disabled = false,
}: {
  value: Learning
  items: StudyItem[]
  onChange: (value: Learning) => void
  disabled?: boolean
}) {
  function options(level: StudyItem['level'], parentId: string | null, selectedId: string | null) {
    const available = children(items, level, parentId)
    const current = items.find((item) => item.id === selectedId)
    return (
      <>
        <option value="" disabled={level === 'subject'}>
          {level === 'subject' ? '教科を選択' : '未選択（任意）'}
        </option>
        {current && !available.some((item) => item.id === current.id) && (
          <option value={current.id} disabled>
            {current.name}（アーカイブ済み）
          </option>
        )}
        {available.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </>
    )
  }
  return (
    <div className="study-fields">
      <label>
        教科
        <select
          aria-label="教科"
          value={value.subjectId ?? ''}
          disabled={disabled}
          onChange={(event) => onChange(learningFromIds(items, event.target.value || null))}
        >
          {options('subject', null, value.subjectId)}
        </select>
      </label>
      <div className="field-pair">
        <label>
          中項目
          <select
            aria-label="中項目"
            value={value.middleId ?? ''}
            disabled={disabled || !value.subjectId || !isAvailable(items, value.subjectId)}
            onChange={(event) =>
              onChange(learningFromIds(items, value.subjectId, event.target.value || null))
            }
          >
            {options('middle', value.subjectId, value.middleId)}
          </select>
        </label>
        <label>
          小項目
          <select
            aria-label="小項目"
            value={value.smallId ?? ''}
            disabled={disabled || !value.middleId || !isAvailable(items, value.middleId)}
            onChange={(event) =>
              onChange(
                learningFromIds(items, value.subjectId, value.middleId, event.target.value || null),
              )
            }
          >
            {options('small', value.middleId, value.smallId)}
          </select>
        </label>
      </div>
    </div>
  )
}
