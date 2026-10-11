import { initialItems, normalizeName, stableId } from './learning'
import type { StudyItem } from './learning'

export interface StudyTemplate {
  id: string
  version: number
  level: 'high-school-basic' | 'middle-school' | 'certification'
  title: string
  subject: {
    key: string
    name: string
    middles: { key: string; name: string; smalls: { key: string; name: string }[] }[]
  }
}

function highSchool(
  key: string,
  name: string,
  branches: [string, string, string[]][],
): StudyTemplate {
  return {
    id: `hs-basic-${key}`,
    version: 1,
    level: 'high-school-basic',
    title: `${name} · 高校基礎`,
    subject: {
      key,
      name,
      middles: branches.map(([middleKey, middleName, smalls]) => ({
        key: middleKey,
        name: middleName,
        smalls: smalls.map((small, index) => ({ key: `${middleKey}-${index + 1}`, name: small })),
      })),
    },
  }
}

// Stable keys must never be reassigned when a template's displayed names change.
export const STUDY_TEMPLATES: readonly StudyTemplate[] = [
  highSchool('japanese', '国語', [
    ['modern', '現代の国語', ['評論読解', '要約・記述', '漢字・語彙']],
    ['culture', '言語文化', ['古文読解', '古文文法', '漢文句法']],
  ]),
  highSchool('math', '数学', [
    ['math-i', '数学Ⅰ', ['数と式', '二次関数', '図形と計量', 'データの分析']],
    ['math-a', '数学Ａ', ['場合の数と確率', '図形の性質', '数学と人間の活動']],
  ]),
  highSchool('english', '英語', [
    ['communication', '英語コミュニケーションⅠ', ['英文読解', 'リスニング', '音読・語彙']],
    ['expression', '論理・表現Ⅰ', ['文型・時制', '不定詞・動名詞・分詞', '英作文']],
  ]),
  highSchool('science', '理科', [
    ['physics', '物理基礎', ['運動と力', 'エネルギー', '波・電気']],
    ['chemistry', '化学基礎', ['物質の構成', '化学結合', '物質量と化学反応']],
    ['biology', '生物基礎', ['生物と遺伝子', '体内環境', '生態系']],
    ['earth', '地学基礎', ['地球の構造', '大気と海洋', '宇宙']],
  ]),
  highSchool('social', '社会', [
    ['geography', '地理総合', ['地図と地理情報', '国際理解', '生活圏と防災']],
    ['history', '歴史総合', ['近代化', '国際秩序の変化', 'グローバル化']],
    ['civics', '公共', ['社会のしくみ', '政治と法', '経済と社会']],
  ]),
  highSchool('information', '情報', [
    [
      'information-i',
      '情報Ⅰ',
      [
        '情報社会と問題解決',
        'コミュニケーションと情報デザイン',
        'コンピュータとプログラミング',
        '情報通信ネットワークとデータの活用',
      ],
    ],
  ]),
  highSchool('other', 'その他', [
    ['study-plan', '学習計画', ['目標設定', '学習の振り返り']],
    ['review', '予習・復習', ['授業の予習', '授業の復習', '定期試験対策']],
  ]),
]

export function applyTemplates(
  items: StudyItem[],
  templateIds: string[],
  now: number,
): StudyItem[] {
  let result = [...items]
  const ensure = (
    key: string,
    level: StudyItem['level'],
    parentId: string | null,
    name: string,
  ): string => {
    // The seed's identity remains its template anchor even after a user renames it.
    const initial =
      level === 'subject' ? initialItems().find((item) => item.name === name) : undefined
    const existing =
      result.find((item) => item.templateKeys.includes(key)) ??
      (initial && result.find((item) => item.id === initial.id)) ??
      result.find(
        (item) =>
          item.level === level &&
          item.parentId === parentId &&
          normalizeName(item.name) === normalizeName(name),
      )
    if (existing) {
      if (existing.level !== level || existing.parentId !== parentId)
        throw new Error('テンプレート項目の親子関係が一致しません。')
      if (!existing.templateKeys.includes(key))
        result = result.map((item) =>
          item.id === existing.id
            ? { ...item, templateKeys: [...item.templateKeys, key], updatedAt: now }
            : item,
        )
      return existing.id
    }
    const id = stableId(`template:${key}`)
    if (result.some((item) => item.id === id)) throw new Error('テンプレートIDが重複しています。')
    result.push({
      id,
      level,
      parentId,
      name,
      order:
        Math.max(
          -1,
          ...result.filter((item) => item.parentId === parentId).map((item) => item.order),
        ) + 1,
      archived: false,
      createdAt: now,
      updatedAt: now,
      templateKeys: [key],
    })
    return id
  }
  for (const id of [...new Set(templateIds)]) {
    const definition = STUDY_TEMPLATES.find((template) => template.id === id)
    if (!definition) throw new Error('テンプレートが見つかりません。')
    const prefix = definition.id
    const subjectId = ensure(`${prefix}:subject`, 'subject', null, definition.subject.name)
    for (const middle of definition.subject.middles) {
      const middleId = ensure(`${prefix}:middle:${middle.key}`, 'middle', subjectId, middle.name)
      for (const small of middle.smalls)
        ensure(`${prefix}:small:${middle.key}:${small.key}`, 'small', middleId, small.name)
    }
  }
  return JSON.stringify(result) === JSON.stringify(items) ? items : result
}
