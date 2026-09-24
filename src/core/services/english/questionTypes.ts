export const ENG_LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;

export type EngLevel = (typeof ENG_LEVELS)[number];

// Nội dung beginner (xem docs/beginner.md): độ khó tối đa B1, tối đa 4 đáp án.
export const BEGINNER_ENG_LEVELS = ['A1', 'A2', 'B1'] as const;

export type BeginnerEngLevel = (typeof BEGINNER_ENG_LEVELS)[number];

export const BEGINNER_MAX_OPTION_COUNT = 4;

export function isBeginnerLevel(value: string): value is BeginnerEngLevel {
  return (BEGINNER_ENG_LEVELS as readonly string[]).includes(value);
}

export const READING_PASSAGE_TYPES = ['daily', 'academic'] as const;

export type ReadingPassageType = (typeof READING_PASSAGE_TYPES)[number];

// Beginner chỉ đọc bài 'daily' — bài 'academic' (expository) không dành cho người mới.
export const BEGINNER_READING_PASSAGE_TYPE: ReadingPassageType = 'daily';

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

// Loại câu có một "term trung tâm" (từ/cụm/idiom/slang…) rõ ràng để khóa nguyên văn khi
// sinh câu tương tự (sibling). `odd-one-out` (không có 1 term), `paragraph` (đọc hiểu, không
// có term) và reading-* (không nằm trong pool) không hỗ trợ.
export const SIBLING_SUPPORTED_QUIZ_TYPES = [
  'vocab',
  'phrase',
  'idiom',
  'slang',
  'synonym',
  'fillblank',
  'conversation',
  'description',
  'verb-use-match'
] as const;

export type SiblingQuizType = (typeof SIBLING_SUPPORTED_QUIZ_TYPES)[number];

export function isSiblingSupported(value: string): value is SiblingQuizType {
  return (SIBLING_SUPPORTED_QUIZ_TYPES as readonly string[]).includes(value);
}

export function isQuizType(value: string): value is QuizType {
  return (QUIZ_TYPES as readonly string[]).includes(value);
}

export function getQuizTypeLabel(value: string): string {
  return isQuizType(value) ? QUIZ_TYPE_DEFINITION_MAP.get(value)!.label : value;
}

export function getQuizTypeTitle(value: string): string {
  return isQuizType(value) ? QUIZ_TYPE_DEFINITION_MAP.get(value)!.title : `Quiz ${value}`;
}

// Lọc bucket theo đối tượng khi scan/refill: 'standard' = bucket thường, 'beginner' = bucket beginner.
export const BUCKET_AUDIENCES = ['standard', 'beginner'] as const;

export type BucketAudience = (typeof BUCKET_AUDIENCES)[number];

export function isBucketAudience(value: string): value is BucketAudience {
  return (BUCKET_AUDIENCES as readonly string[]).includes(value);
}

export const QUIZ_TYPE_SELECT_OPTIONS = QUIZ_TYPE_DEFINITIONS.map(({ value, label }) => ({ value, label }));
