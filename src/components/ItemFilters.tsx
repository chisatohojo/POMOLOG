import { children } from '../domain/learning'
import type { StudyItem } from '../domain/learning'
import type { ItemFilter } from '../domain/statistics'

export function ItemFilters({
  items,
  value,
  onChange,
}: {
  items: StudyItem[]
  value: ItemFilter
  onChange: (value: ItemFilter) => void
}) {
  function options(level: StudyItem['level'], parentId: string | null) {
    return children(items, level, parentId, true).map((item) => (
      <option key={item.id} value={item.id}>
        {item.name}
        {item.archived ? '（アーカイブ済み）' : ''}
      </option>
    ))
  }
  return (
    <div className="item-filters">
      <label>
        教科
        <select
          aria-label="絞り込み教科"
          value={value.subjectId ?? ''}
          onChange={(event) =>
            onChange({ subjectId: event.target.value || null, middleId: null, smallId: null })
          }
        >
          <option value="">すべての教科</option>
          {options('subject', null)}
        </select>
      </label>
      <label>
        中項目
        <select
          aria-label="絞り込み中項目"
          value={value.middleId ?? ''}
          disabled={!value.subjectId}
          onChange={(event) =>
            onChange({ ...value, middleId: event.target.value || null, smallId: null })
          }
        >
          <option value="">すべての中項目</option>
          {value.subjectId && options('middle', value.subjectId)}
        </select>
      </label>
      <label>
        小項目
        <select
          aria-label="絞り込み小項目"
          value={value.smallId ?? ''}
          disabled={!value.middleId}
          onChange={(event) => onChange({ ...value, smallId: event.target.value || null })}
        >
          <option value="">すべての小項目</option>
          {value.middleId && options('small', value.middleId)}
        </select>
      </label>
    </div>
  )
}
