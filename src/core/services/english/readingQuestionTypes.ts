import _ from 'lodash';

import type { EngLevel } from './questionTypes';

// Quiz type của câu hỏi đọc hiểu sinh từ reading passage. CỐ TÌNH tách khỏi QUIZ_TYPES
// ở questionTypes.ts: 11 quizType kia là các quiz độc lập có prompt riêng, phân phối
// riêng (quiz_distribution) và pool riêng. Trộn 2 tập vào nhau sẽ vỡ pickQuizType(),
// generateByType() và config phân phối.
// Nguồn: docs/question-generator-guideline.md.

export const READING_QUESTION_TYPES = [
  'detail',
  'main_idea',
  'reason',
  'cause_effect',
  'sequence',
  'inference',
  'vocabulary_context',
  'purpose',
  'result',
  'true_false',
  'negative_detail',
  'matching',
  'best_title',
  'paraphrase',
  'reference',
  'prediction',
  'attitude',
  'specific_function',
  'comparison'
] as const;

export type ReadingQuestionType = (typeof READING_QUESTION_TYPES)[number];

/**
 * Guideline mục 2.5 — allow-list theo CEFR level, chép nguyên văn danh sách của guideline.
 *
 * 6 type định nghĩa ở mục 3 nhưng KHÔNG xuất hiện ở mục 2.5 (true_false, negative_detail,
 * matching, best_title, paraphrase, reference) vẫn nằm trong READING_QUESTION_TYPES để
 * admin sửa tay được, nhưng không bao giờ được offer cho model.
 */
export const CEFR_ALLOWED_QUESTION_TYPES: Record<EngLevel, readonly ReadingQuestionType[]> = {
  A1: ['detail', 'reason', 'sequence', 'result', 'vocabulary_context'],
  A2: ['detail', 'reason', 'result', 'sequence', 'vocabulary_context', 'main_idea'],
  B1: ['detail', 'reason', 'cause_effect', 'sequence', 'main_idea', 'vocabulary_context', 'inference', 'purpose'],
  B2: [
    'detail',
    'main_idea',
    'purpose',
    'cause_effect',
    'inference',
    'vocabulary_context',
    'comparison',
    'attitude',
    'specific_function',
    'prediction'
  ]
};

/**
 * Guideline mục 7 — bộ 3 câu gợi ý theo level, dạng "slot". Server chọn ngẫu nhiên 1 type
 * trong mỗi slot rồi sinh từng câu bằng prompt riêng của type đó, nên diversity là đảm bảo
 * cứng chứ không còn phụ thuộc model tự giác.
 *
 * Slot đầu luôn là `detail`: câu neo, bài nào cũng đỡ được.
 */
export const CEFR_COMPOSITION_SLOTS: Record<EngLevel, readonly (readonly ReadingQuestionType[])[]> = {
  A1: [['detail'], ['reason', 'result'], ['vocabulary_context']],
  A2: [['detail'], ['reason', 'sequence', 'result'], ['vocabulary_context', 'main_idea']],
  B1: [['detail'], ['reason', 'cause_effect'], ['inference', 'vocabulary_context', 'main_idea']],
  B2: [
    ['detail'],
    ['inference', 'cause_effect', 'purpose'],
    ['vocabulary_context', 'main_idea', 'attitude', 'specific_function']
  ]
};

/**
 * Chọn `count` type khác nhau cho một bài. Random trong slot nên mỗi lần retry một bài
 * hỏng sẽ ra tổ hợp khác — bài mỏng được thử nhiều tổ hợp trước khi bị `questionGenAttempts`
 * loại, thay vì hỏng đi hỏng lại cùng một kiểu.
 *
 * `count` vượt số slot thì lấy thêm từ allow-list của level. Config chặn count <= 5 và
 * allow-list nhỏ nhất (A1) có đúng 5 type, nên không bao giờ phải lặp type.
 */
export function selectQuestionTypes(cefrLevel: EngLevel, count: number): ReadingQuestionType[] {
  const selected: ReadingQuestionType[] = [];

  for (const slot of CEFR_COMPOSITION_SLOTS[cefrLevel]) {
    if (selected.length >= count) break;
    const candidates = slot.filter((type) => !selected.includes(type));
    const picked = _.sample(candidates.length > 0 ? candidates : slot);
    if (picked && !selected.includes(picked)) selected.push(picked);
  }

  const fallbackPool = getAllowedQuestionTypes(cefrLevel).filter((type) => !selected.includes(type));
  const shuffled = _.shuffle([...fallbackPool]);
  while (selected.length < count && shuffled.length > 0) {
    selected.push(shuffled.pop()!);
  }

  return selected;
}

export interface ReadingQuestionTypePlaybook {
  label: string;
  evidence: string;
  method: string;
  validation: string;
}

/**
 * Guideline mục 3 — Evidence / Method / Validation của từng type. Dùng để dựng section
 * QUIZ TYPE PLAYBOOK trong prompt: chỉ render các type được phép ở level đang sinh, nên
 * prompt không phình vì những type model không được dùng.
 */
export const QUESTION_TYPE_PLAYBOOK: Record<ReadingQuestionType, ReadingQuestionTypePlaybook> = {
  detail: {
    label: 'Explicit Information Retrieval',
    evidence: 'one meaningful factual detail: person, place, time, object, action, or event',
    method:
      'Select a detail, convert it into a Who/What/Where/When/How question, paraphrase the passage wording, and make the correct answer directly supported. Draw distractors from other passage details or from the same detail with one attribute changed.',
    validation: 'No inference required. Exactly one option is supported by the text.'
  },
  main_idea: {
    label: 'Global Understanding',
    evidence: 'the central topic plus the central situation or development',
    method:
      'Understand the whole passage, identify the central idea, ignore minor details, and ask what the passage is mainly about. Distractors should be too broad, too narrow, or a minor detail.',
    validation: 'The answer summarises the whole passage, not one detail.'
  },
  reason: {
    label: 'Action → Reason',
    evidence: 'an action or decision together with its explicit reason',
    method:
      'Find an action or decision, find the reason the text gives for it, and ask "Why did X ...?". Use other passage details as distractors.',
    validation: 'The reason must be stated in the text. No speculation.'
  },
  cause_effect: {
    label: 'Causal Relationship',
    evidence: 'a real cause → effect link',
    method:
      'Extract the events, identify a genuine causal relationship, and ask either "What caused X?" or "What happened because of X?". Use unrelated or incorrect events as distractors.',
    validation: 'Do not confuse sequence with causation — A happening before B does not mean A caused B.'
  },
  sequence: {
    label: 'Temporal Ordering',
    evidence: 'at least 3 clearly distinguishable events',
    method:
      'Extract the events, build the timeline, use the temporal markers in the text (first, then, after, before, later, finally), and ask what happened first / next / after X.',
    validation: 'The order must be unambiguous in the text.'
  },
  inference: {
    label: 'Evidence-Based Inference',
    evidence: 'preferably at least TWO separate supporting clues',
    method:
      'Find clue A, find clue B, combine them, derive the smallest reasonable conclusion, and ask what can be inferred or concluded. Distractors must be unsupported or contradicted by the text.',
    validation:
      'No external knowledge, no speculative leap, and only one option is logically defensible. Infer, do not speculate.'
  },
  vocabulary_context: {
    label: 'Contextual Meaning',
    evidence: 'a useful target word plus sufficient surrounding context clues',
    method:
      'Select a CEFR-appropriate useful word, read its sentence and the surrounding context, identify the clues, work out the meaning in THIS context, and ask what the word most likely means. Distractors are plausible but contextually wrong meanings.',
    validation: 'The meaning must be recoverable from the passage without a dictionary.'
  },
  purpose: {
    label: 'Intent / Purpose',
    evidence: 'an action together with its intended goal',
    method:
      'Identify the action and who performs it, identify the intended goal, and ask why X did it or what X was trying to achieve. Distractors are related actions, consequences, or wrong intentions.',
    validation:
      'Distinguish purpose from reason — reason is why something happened, purpose is what someone wanted to achieve.'
  },
  result: {
    label: 'Outcome Identification',
    evidence: 'a situation → problem → action → outcome chain',
    method:
      'Identify the situation or problem, follow the actions, find the actual final outcome, and ask what happened in the end. Use earlier actions or merely intended outcomes as distractors.',
    validation: 'The answer must be the actual outcome, not a plan or an intention.'
  },
  true_false: {
    label: 'Statement Verification',
    evidence: 'passage-supported statements',
    method:
      'Create statements from passage evidence, check each option against the passage, make exactly one statement correct, and make the others false by changing person, time, place, action, quantity, or relationship.',
    validation: '"Not mentioned" is not automatically false.'
  },
  negative_detail: {
    label: 'NOT Mentioned / NOT True',
    evidence: '3 supported options plus 1 unsupported or contradicted option',
    method:
      'Create three options supported by the passage and one option that is unsupported or contradicted, then ask which is NOT mentioned or NOT true.',
    validation: 'Exactly one option fails to match the passage.'
  },
  matching: {
    label: 'Entity → Information Mapping',
    evidence: 'multiple clearly distinguishable entities',
    method:
      'Extract the entities, map each to an action, detail or property, and ask which entity matches a given information point. Use the other entities as distractors.',
    validation: 'Only use this type when the passage really has multiple distinct entities.'
  },
  best_title: {
    label: 'Central Idea → Title',
    evidence: 'the central idea plus the central situation',
    method:
      'Identify the main idea and the central event, then create the best concise title. Distractors are too broad, too narrow, minor-detail focused, or inconsistent with the passage.',
    validation: 'The title must represent the whole passage.'
  },
  paraphrase: {
    label: 'Meaning Preservation',
    evidence: 'one important sentence',
    method:
      'Select a sentence, extract its semantic components (subject, action, time, cause, condition, quantity, negation), rewrite it with different wording, and build distractors by changing exactly one component.',
    validation: 'Meaning must be preserved exactly — especially negation, tense, quantity, condition and cause/effect.'
  },
  reference: {
    label: 'Antecedent Resolution',
    evidence: 'a pronoun or reference with one clear antecedent',
    method:
      'Select a clear pronoun, list the possible antecedents, check grammatical and semantic compatibility, and ask what the pronoun refers to.',
    validation: 'Never use an ambiguous reference.'
  },
  prediction: {
    label: 'Evidence-Based Future Prediction',
    evidence: 'the current situation, an unresolved goal or problem, and a clear direction',
    method:
      'Identify the current state, identify the unresolved problem or goal, determine the likely direction, and ask what will most likely happen next. Distractors are less-supported alternatives.',
    validation: 'The prediction must be evidence-based and probabilistic, never arbitrary.'
  },
  attitude: {
    label: 'Evidence-Based Attitude',
    evidence: "words, actions, reactions, dialogue and context showing someone's stance",
    method:
      "Collect several clues, infer the character's or writer's attitude, and ask how X felt about something or what X's attitude was. Distractors are plausible but unsupported emotions.",
    validation: 'Never infer an attitude from a single isolated clue.'
  },
  specific_function: {
    label: 'Detail Function',
    evidence: 'a meaningful detail plus its surrounding context',
    method:
      'Select a detail with a clear role, read the context before and after it, identify its function (introduce a problem, explain a reason, show a consequence, provide evidence, create contrast), and ask why the writer mentions it.',
    validation: 'The detail must have a genuinely meaningful role in the passage.'
  },
  comparison: {
    label: 'Attribute-Based Comparison',
    evidence: 'two entities or events sharing a meaningful comparison dimension',
    method:
      'Identify entity A, identify entity B, find the same attribute described for both, compare them, and ask how they are similar or different.',
    validation: 'Both sides must have sufficient textual evidence.'
  }
};

/** Nhãn tiếng Việt cho admin UI. */
export const READING_QUESTION_TYPE_LABELS: Record<ReadingQuestionType, string> = {
  detail: 'Chi tiết',
  main_idea: 'Ý chính',
  reason: 'Lý do',
  cause_effect: 'Nhân quả',
  sequence: 'Trình tự',
  inference: 'Suy luận',
  vocabulary_context: 'Từ vựng theo ngữ cảnh',
  purpose: 'Mục đích',
  result: 'Kết quả',
  true_false: 'Đúng/Sai',
  negative_detail: 'Chi tiết phủ định',
  matching: 'Ghép thông tin',
  best_title: 'Tiêu đề phù hợp',
  paraphrase: 'Diễn đạt lại',
  reference: 'Đại từ thay thế',
  prediction: 'Dự đoán',
  attitude: 'Thái độ',
  specific_function: 'Vai trò chi tiết',
  comparison: 'So sánh'
};

export function isReadingQuestionType(value: string): value is ReadingQuestionType {
  return (READING_QUESTION_TYPES as readonly string[]).includes(value);
}

export function getAllowedQuestionTypes(cefrLevel: EngLevel): readonly ReadingQuestionType[] {
  return CEFR_ALLOWED_QUESTION_TYPES[cefrLevel];
}

export function isQuestionTypeAllowedForLevel(value: string, cefrLevel: EngLevel): value is ReadingQuestionType {
  return (getAllowedQuestionTypes(cefrLevel) as readonly string[]).includes(value);
}

export function getReadingQuestionTypeLabel(value: string): string {
  return isReadingQuestionType(value) ? READING_QUESTION_TYPE_LABELS[value] : value;
}

export const READING_QUESTION_TYPE_SELECT_OPTIONS = READING_QUESTION_TYPES.map((value) => ({
  value,
  label: READING_QUESTION_TYPE_LABELS[value]
}));
