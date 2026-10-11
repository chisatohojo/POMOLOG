import type { Action, Timer } from '../domain/model'
import type { StudyItem } from '../domain/learning'
import { SessionForm } from './SessionForm'

export function Review({
  timer,
  items,
  save,
  disabled,
}: {
  timer: Timer
  items: StudyItem[]
  save: (action: Action) => boolean
  disabled: boolean
}) {
  return (
    <SessionForm
      initial={{ ...timer, endedAt: timer.endedAt!, focusMs: timer.accumulatedMs }}
      items={items}
      disabled={disabled}
      title="おつかれさまでした。"
      description="内容を確認して、このセットを記録しましょう。保存するまで次のセットは始まりません。"
      submitLabel="この内容で保存する"
      onSave={(session) => save({ type: 'save', session })}
    />
  )
}
