import _ from 'lodash';
import { countPassageWords, READING_WORD_ACCEPT, type ReadingPassage } from './prompt/reading-passage-prompt';
import { ACADEMIC_READING_WORD_ACCEPT } from './prompt/reading-passage-prompt-academic';
import { OPTIONS_PER_QUESTION, type ReadingQuestionDraft } from './prompt/reading-question';
import type { ReadingQuestionType } from './readingQuestionTypes';
import type { DescriptionQuestion } from './prompt/description-prompt';
import type { DifficultyContext } from './prompt/vocab-prompt';
// Type-only nên bị xoá hoàn toàn khi build (verbatimModuleSyntax) — không tạo vòng import runtime.
import type { ReadingPassageContext } from './study.service';

/**
 * Phần thuần của study.service: chuẩn hoá text, heuristic chống lộ đáp án, và các gate
 * validate cho description question / reading passage / reading question.
 *
 * Tách ra để test trực tiếp từng luật mà không phải giả lập một lượt gọi model, và để
 * study.service chỉ còn phần điều phối prompt + LLM.
 */

export function normalizeTextForLeakCheck(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

export function normalizeTextForHeuristic(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function descriptionLeaksAnswer(description: string, correctAnswer: string): boolean {
  const normalizedDescription = ` ${normalizeTextForLeakCheck(description)} `;
  const normalizedAnswer = normalizeTextForLeakCheck(correctAnswer);
  if (!normalizedAnswer || normalizedAnswer.includes(' ')) return true;

  const forms = new Set([
    normalizedAnswer,
    `${normalizedAnswer}s`,
    `${normalizedAnswer}es`,
    `${normalizedAnswer}ed`,
    `${normalizedAnswer}ing`
  ]);
  if (normalizedAnswer.endsWith('y')) {
    forms.add(`${normalizedAnswer.slice(0, -1)}ies`);
    forms.add(`${normalizedAnswer.slice(0, -1)}ied`);
  }

  return [...forms].some((form) => normalizedDescription.includes(` ${form} `));
}

export const DESCRIPTION_TRANSLATION_LEAKS: Record<string, string[]> = {
  stadium: ['san van dong', 'khan dai san van dong'],
  field: ['san co', 'tren san', 'mat san', 'khu vuc san'],
  court: ['san dau', 'san choi', 'san bong ro', 'san tennis'],
  gym: ['phong tap', 'phong gym', 'phong tap the duc'],
  referee: ['trong tai'],
  coach: ['huan luyen vien'],
  goalkeeper: ['thu mon'],
  striker: ['tien dao'],
  defender: ['hau ve'],
  teammate: ['dong doi'],
  opponent: ['doi thu'],
  fan: ['nguoi ham mo', 'co dong vien'],
  crowd: ['dam dong'],
  ticket: ['ve vao cong', 've xem'],
  whistle: ['coi'],
  trophy: ['cup', 'chiec cup', 'cúp'],
  scoreboard: ['bang ti so', 'bang ty so', 'bang diem']
};

export function descriptionLeaksKnownTranslation(description: string, correctAnswer: string): boolean {
  const normalizedDescription = ` ${normalizeTextForHeuristic(description)} `;
  const normalizedAnswer = normalizeTextForLeakCheck(correctAnswer);
  const forbiddenTerms = DESCRIPTION_TRANSLATION_LEAKS[normalizedAnswer] ?? [];
  return forbiddenTerms.some((term) => normalizedDescription.includes(` ${normalizeTextForHeuristic(term)} `));
}

export function hasAnyPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

export function looksLikeDefinitionOrQuestion(description: string): boolean {
  const normalized = normalizeTextForHeuristic(description);
  return hasAnyPhrase(normalized, [
    'nghia la',
    'co nghia la',
    'tuc la',
    'dich la',
    'trong tieng anh la',
    'la mot',
    'la nguoi',
    'la noi',
    'la vat',
    'duoc dung de',
    'duoc su dung de',
    'a device used for',
    'a person who',
    'an object that',
    'the act of',
    'the quality of',
    'which word',
    'which english word',
    'choose the word',
    'tu nao',
    'tu tieng anh nao',
    'chon tu'
  ]);
}

export function isVagueSubjectiveDescription(description: string): boolean {
  const normalized = normalizeTextForHeuristic(description);
  const genericSubjectiveStems = [
    'ban cam thay the nao khi',
    'ban thay the nao khi',
    'ban se cam thay gi khi',
    'ban cam thay gi khi',
    'how do you feel when',
    'how would you feel when',
    'what do you feel when',
    'you feel this when'
  ];

  if (!hasAnyPhrase(normalized, genericSubjectiveStems)) return false;

  const disambiguatingCues = [
    'reo ho',
    'cuoi lon',
    'mim cuoi',
    'phan khich',
    'qua vui',
    'tu hao',
    'bat day',
    'nhay len',
    'an mung',
    'cheer',
    'celebrate',
    'smile',
    'grin',
    'proud',
    'thrilled',
    'excited',
    'lo lang',
    'bon chon',
    'bat an',
    'tay run',
    'tim dap',
    'khong the thu gian',
    'khong chac',
    'so rang',
    'worry',
    'nervous',
    'heart races',
    'hands shake',
    'uncertain',
    'met moi',
    'kiet suc',
    'khong con suc',
    'muon ngu',
    'tho doc',
    'no energy',
    'worn out',
    'want to sleep',
    'boi roi',
    'khong hieu',
    'khong biet chuyen gi',
    'roi len',
    'confused',
    'do not understand',
    'dont understand',
    'mixed up',
    'not sure what is happening'
  ];

  return !hasAnyPhrase(normalized, disambiguatingCues);
}

export function isValidDescriptionQuestion(
  q: DescriptionQuestion,
  wrongAnswerCount: number,
  engLevel: DifficultyContext['engLevel']
): boolean {
  if (q.wrongAnswers.length !== wrongAnswerCount || q.wrongAnswerExplanations.length !== wrongAnswerCount) {
    return false;
  }
  if (engLevel === 'B1' || engLevel === 'B2') {
    if (q.descriptionLanguage !== 'en') return false;
  }
  const correct = q.correctAnswer.toLowerCase().trim();
  if (!correct || /\s/.test(correct)) return false;
  if (descriptionLeaksAnswer(q.description, correct)) return false;
  if (descriptionLeaksKnownTranslation(q.description, correct)) return false;
  if (looksLikeDefinitionOrQuestion(q.description)) return false;
  if (isVagueSubjectiveDescription(q.description)) return false;

  const wrongs = q.wrongAnswers.map((w) => w.toLowerCase().trim());
  if (wrongs.includes(correct) || new Set(wrongs).size !== wrongs.length) return false;
  return true;
}

// Model hay lệch word count và đôi khi tự đổi cefrLevel/topic — chuẩn hoá về đúng
// input rồi mới lọc, thay vì loại thẳng bài chỉ vì model điền sai metadata. Ngưỡng
// accept (READING_WORD_ACCEPT) rộng hơn band mục tiêu một chút, xem prompt file.
export function normalizeReadingPassage(raw: ReadingPassage, ctx: ReadingPassageContext): ReadingPassage {
  const paragraphs = raw.paragraphs.map((paragraph) => paragraph.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return {
    title: raw.title.trim(),
    paragraphs,
    wordCount: countPassageWords(paragraphs),
    topic: ctx.topicName,
    cefrLevel: ctx.cefrLevel
  };
}

export function isValidReadingPassage(
  passage: ReadingPassage,
  excludeTitles: string[],
  acceptBand: { min: number; max: number }
): boolean {
  if (!passage.title || passage.paragraphs.length < 2) return false;

  if (passage.wordCount < acceptBand.min || passage.wordCount > acceptBand.max) return false;

  const normalizedTitle = passage.title.toLowerCase();
  return !excludeTitles.some((title) => title.trim().toLowerCase() === normalizedTitle);
}

export function normalizeReadingQuestionDraft(raw: ReadingQuestionDraft): ReadingQuestionDraft {
  const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
  return {
    quizType: raw.quizType,
    question: collapse(raw.question),
    options: raw.options.map(collapse),
    correctAnswer: raw.correctAnswer,
    explanation: collapse(raw.explanation)
  };
}

// Prompt đánh số đoạn ([1], [2]...) để model neo explanation vào đúng đoạn, nhưng người
// học đọc bài dạng văn xuôi không có số. Câu hỏi/đáp án nhắc "paragraph 2" là lộ scaffold
// của prompt và làm người học rối. Explanation thì được phép — field đó cho admin review.
export const PARAGRAPH_REFERENCE_PATTERN =
  /\b(?:paragraph|para\.?)\s*\d|\bthe\s+(?:first|second|third|fourth|last)\s+paragraph\b/i;

/**
 * Zod đã chặn shape (đủ 4 option, correctAnswer trong [0,3]). Tầng này bắt các lỗi ngữ
 * nghĩa mà schema không thấy: option trùng nhau, quizType ngoài allow-list của level,
 * lộ số thứ tự đoạn, hoặc hỏi lại đúng câu đã có sẵn trên passage.
 */
export function isValidReadingQuestionDraft(
  draft: ReadingQuestionDraft,
  expectedType: ReadingQuestionType,
  excludeQuestions: string[]
): boolean {
  if (!draft.question || !draft.explanation) return false;
  if (draft.options.some((option) => !option)) return false;

  if (PARAGRAPH_REFERENCE_PATTERN.test(draft.question)) return false;
  if (draft.options.some((option) => PARAGRAPH_REFERENCE_PATTERN.test(option))) return false;

  const normalizedOptions = draft.options.map((option) => option.toLowerCase());
  if (new Set(normalizedOptions).size !== normalizedOptions.length) return false;

  // Type do server chỉ định. Model được giao inference mà trả về detail là đã không làm
  // đúng việc — loại, chứ không nhận rồi coi như bộ vẫn hợp lệ.
  if (draft.quizType !== expectedType) return false;

  const normalizedQuestion = draft.question.toLowerCase();
  return !excludeQuestions.some((question) => question.trim().toLowerCase() === normalizedQuestion);
}

/**
 * Xáo vị trí đáp án ở server. Mỗi câu là một lần gọi riêng nên model không thể "rải vị trí
 * đáp án đúng" giữa các câu như prompt cũ yêu cầu — có lần cả 3 câu cùng rơi vào B. Xáo ở
 * đây biến việc đó từ nhờ model thành chắc chắn, và không tốn token.
 */
export function shuffleReadingQuestionOptions(question: ReadingQuestionDraft): ReadingQuestionDraft {
  const correct = question.options[question.correctAnswer];
  const shuffled = _.shuffle(question.options);
  return {
    ...question,
    options: shuffled,
    correctAnswer: shuffled.findIndex((option) => option === correct)
  };
}

/** Xáo cả bộ, đảm bảo không phải mọi câu đều cùng một vị trí đáp án. */
export function spreadCorrectAnswers(questions: ReadingQuestionDraft[]): ReadingQuestionDraft[] {
  let result = questions.map(shuffleReadingQuestionOptions);
  const optionCount = result[0]?.options.length ?? OPTIONS_PER_QUESTION;

  // Chỉ có thể rải khi số câu <= số đáp án; nhiều hơn thì trùng vị trí là tất yếu.
  for (let i = 0; i < 8 && result.length > 1 && result.length <= optionCount; i += 1) {
    if (new Set(result.map((question) => question.correctAnswer)).size > 1) break;
    result = result.map(shuffleReadingQuestionOptions);
  }

  return result;
}

/**
 * Kiểm ở tầng BỘ, bù cho việc mỗi câu sinh riêng nên model không thấy các câu khác.
 * Hai câu cùng đáp án đúng gần như chắc chắn đang hỏi cùng một thông tin — rẻ và bắt
 * được ca trùng information point hay gặp nhất.
 */
export function isValidReadingQuestionSet(questions: ReadingQuestionDraft[]): boolean {
  const answers = questions.map((question) => (question.options[question.correctAnswer] ?? '').trim().toLowerCase());
  return new Set(answers).size === answers.length;
}
