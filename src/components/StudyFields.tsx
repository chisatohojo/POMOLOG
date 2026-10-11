import { SUBJECTS } from '../domain/model'
import type { Learning } from '../domain/model'

export function StudyFields({
  value,
  onChange,
  disabled = false,
}: {
  value: Learning
  onChange: (value: Learning) => void
  disabled?: boolean
}) {
  return (
    <div className="study-fields">
      <label>
        教科
        <select
          value={value.subject}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, subject: event.target.value })}
        >
          {[...new Set([...SUBJECTS, value.subject])].map((subject) => (
            <option key={subject}>{subject}</option>
          ))}
        </select>
      </label>
      <div className="field-pair">
        <label>
          中項目
          <input
            value={value.middle}
            maxLength={100}
            placeholder="例：数学Ⅰ"
            disabled={disabled}
            onChange={(event) => onChange({ ...value, middle: event.target.value })}
          />
        </label>
        <label>
          小項目
          <input
            value={value.small}
            maxLength={100}
            placeholder="例：二次関数"
            disabled={disabled}
            onChange={(event) => onChange({ ...value, small: event.target.value })}
          />
        </label>
      </div>
    </div>
  )
}
