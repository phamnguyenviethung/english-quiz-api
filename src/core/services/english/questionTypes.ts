export const ENG_LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;

export type EngLevel = (typeof ENG_LEVELS)[number];

export const QUIZ_TYPES = [
  'vocab',
  'fillblank',
  'phrase',
  'conversation',
  'description',
  'synonym',
  'slang',
  'odd-one-out',
  'paragraph',
  'idiom',
  'verb-use-match'
] as const;

export type QuizType = (typeof QUIZ_TYPES)[number];

export interface QuizTypeDefinition {
  value: QuizType;
  label: string;
  title: string;
}

export const QUIZ_TYPE_DEFINITIONS: QuizTypeDefinition[] = [
  { value: 'vocab', label: 'Vocab', title: '📚 Quiz Từ Vựng' },
  { value: 'fillblank', label: 'Fill Blank', title: '📝 Quiz Điền Từ' },
  { value: 'phrase', label: 'Phrase', title: '💬 Quiz Cụm Từ' },
  { value: 'conversation', label: 'Conversation', title: '🗣️ Quiz Hội Thoại' },
  { value: 'description', label: 'Description', title: 'Quiz Ngữ Cảnh' },
  { value: 'synonym', label: 'Synonym', title: '🔄 Quiz Đồng/Trái Nghĩa' },
  { value: 'slang', label: 'Slang', title: '🤙 Quiz Slang' },
  { value: 'odd-one-out', label: 'Odd One Out', title: '🧩 Quiz Odd One Out' },
  { value: 'paragraph', label: 'Paragraph', title: '📖 Quiz Đọc Hiểu' },
  { value: 'idiom', label: 'Idiom', title: '💬 Quiz Idiom' },
  { value: 'verb-use-match', label: 'Verb Use Match', title: '🔤 Quiz Collocation' }
];

const QUIZ_TYPE_DEFINITION_MAP = new Map(QUIZ_TYPE_DEFINITIONS.map((definition) => [definition.value, definition]));

export function isQuizType(value: string): value is QuizType {
  return (QUIZ_TYPES as readonly string[]).includes(value);
}

export function getQuizTypeLabel(value: string): string {
  return isQuizType(value) ? QUIZ_TYPE_DEFINITION_MAP.get(value)!.label : value;
}

export function getQuizTypeTitle(value: string): string {
  return isQuizType(value) ? QUIZ_TYPE_DEFINITION_MAP.get(value)!.title : `Quiz ${value}`;
}

export const QUIZ_TYPE_SELECT_OPTIONS = QUIZ_TYPE_DEFINITIONS.map(({ value, label }) => ({ value, label }));
