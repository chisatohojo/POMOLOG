import { emptyDocument } from '../src/domain/model'

export const seeded = emptyDocument()
seeded.sessions.push({
  id: 'existing-history',
  learning: { subject: '英語', middle: '文法', small: '時制' },
  startedAt: 1_800_000_000_000,
  endedAt: 1_800_001_200_000,
  focusMs: 1_200_000,
  correct: 5,
  incorrect: 1,
  memo: '削除してはいけない記録',
  createdAt: 1_800_001_200_000,
  updatedAt: 1_800_001_200_000,
})
