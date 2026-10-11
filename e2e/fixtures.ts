import { emptyDocument } from '../src/domain/model'
import { mutateItems, learningFromIds } from '../src/domain/learning'

export const seeded = emptyDocument()
seeded.items = mutateItems(
  seeded.items,
  {
    type: 'item-add',
    id: 'existing-middle',
    level: 'middle',
    parentId: seeded.items[2].id,
    name: '文法',
  },
  0,
)
seeded.items = mutateItems(
  seeded.items,
  {
    type: 'item-add',
    id: 'existing-small',
    level: 'small',
    parentId: 'existing-middle',
    name: '時制',
  },
  0,
)
seeded.sessions.push({
  id: 'existing-history',
  deletedAt: null,
  learning: learningFromIds(seeded.items, seeded.items[2].id, 'existing-middle', 'existing-small'),
  startedAt: 1_800_000_000_000,
  endedAt: 1_800_001_200_000,
  focusMs: 1_200_000,
  correct: 5,
  incorrect: 1,
  memo: '削除してはいけない記録',
  createdAt: 1_800_001_200_000,
  updatedAt: 1_800_001_200_000,
})
