/**
 * Payload `questionData` hợp lệ theo QUESTION_SCHEMA_BY_TYPE.
 *
 * Mặc định dựng cho optionCount = 4 → mọi mảng distractor có đúng 3 phần tử
 * (bất biến `wrongAnswerCount = optionCount - 1`). Truyền optionCount khác để đổi độ dài.
 */

function distractors(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);
}

export interface FixtureOptions {
  optionCount?: number;
  /** Ghi đè field bất kỳ — dùng để tạo biến thể sai lệch trong test. */
  overrides?: Record<string, unknown>;
}

function withBase(data: Record<string, unknown>, options: FixtureOptions): Record<string, unknown> {
  return {
    explanation: 'Giải thích vì sao đáp án đúng.',
    exampleSentence: 'This is an example sentence.',
    exampleTranslation: 'Đây là câu ví dụ.',
    ...data,
    ...options.overrides
  };
}

export function vocabQuestion(options: FixtureOptions = {}): Record<string, unknown> {
  const wrongCount = (options.optionCount ?? 4) - 1;
  return withBase(
    {
      word: 'diligent',
      partOfSpeech: 'adjective',
      correctAnswer: 'chăm chỉ',
      wrongAnswers: distractors('nghĩa sai', wrongCount),
      wrongAnswerExplanations: distractors('vì sao sai', wrongCount)
    },
    options
  );
}

export function phraseQuestion(options: FixtureOptions = {}): Record<string, unknown> {
  const wrongCount = (options.optionCount ?? 4) - 1;
  return withBase(
    {
      phrase: 'give up',
      correctAnswer: 'từ bỏ',
      wrongAnswers: distractors('nghĩa sai', wrongCount),
      wrongAnswerExplanations: distractors('vì sao sai', wrongCount)
    },
    options
  );
}

export function idiomQuestion(options: FixtureOptions = {}): Record<string, unknown> {
  const wrongCount = (options.optionCount ?? 4) - 1;
  return withBase(
    {
      idiom: 'break the ice',
      correctAnswer: 'phá vỡ bầu không khí ngượng ngập',
      wrongAnswers: distractors('nghĩa sai', wrongCount),
      wrongAnswerExplanations: distractors('vì sao sai', wrongCount)
    },
    options
  );
}

export function fillblankQuestion(options: FixtureOptions = {}): Record<string, unknown> {
  const wrongCount = (options.optionCount ?? 4) - 1;
  return withBase(
    {
      word: 'commute',
      sentence: 'She has to ____ two hours every day.',
      sentenceTranslation: 'Cô ấy phải đi lại hai tiếng mỗi ngày.',
      highlightedWord: 'commute',
      correctAnswer: 'commute',
      correctAnswerTranslation: 'đi lại (giữa nhà và nơi làm việc)',
      wrongAnswers: distractors('wrong', wrongCount),
      optionTranslations: distractors('nghĩa', wrongCount),
      wrongAnswerExplanations: distractors('vì sao sai', wrongCount)
    },
    options
  );
}

export function conversationQuestion(options: FixtureOptions = {}): Record<string, unknown> {
  const wrongCount = (options.optionCount ?? 4) - 1;
  return withBase(
    {
      dialogueLines: ['A: Are you free tonight?', 'B: Sorry, I have to ____.'],
      sentence: 'B: Sorry, I have to ____.',
      sentenceTranslation: 'B: Xin lỗi, tôi phải ____.',
      highlightedWord: 'work late',
      correctAnswer: 'work late',
      correctAnswerTranslation: 'làm muộn',
      wrongAnswers: distractors('wrong', wrongCount),
      optionTranslations: distractors('nghĩa', wrongCount),
      wrongAnswerExplanations: distractors('vì sao sai', wrongCount)
    },
    options
  );
}

export function descriptionQuestion(options: FixtureOptions = {}): Record<string, unknown> {
  const wrongCount = (options.optionCount ?? 4) - 1;
  return withBase(
    {
      description: 'Người này sửa ống nước trong nhà.',
      descriptionLanguage: 'vi',
      partOfSpeech: 'noun',
      correctAnswer: 'plumber',
      wrongAnswers: distractors('wrong', wrongCount),
      wrongAnswerExplanations: distractors('vì sao sai', wrongCount)
    },
    options
  );
}

export function synonymQuestion(options: FixtureOptions = {}): Record<string, unknown> {
  const wrongCount = (options.optionCount ?? 4) - 1;
  return withBase(
    {
      word: 'happy',
      questionType: 'synonym',
      partOfSpeech: 'adjective',
      correctAnswer: 'joyful',
      wrongAnswers: distractors('wrong', wrongCount),
      wrongAnswerExplanations: distractors('vì sao sai', wrongCount)
    },
    options
  );
}

export function slangQuestion(options: FixtureOptions = {}): Record<string, unknown> {
  const wrongCount = (options.optionCount ?? 4) - 1;
  return withBase(
    {
      slang: 'ghost',
      partOfSpeech: 'verb',
      correctAnswer: 'biến mất không báo trước',
      wrongAnswers: distractors('nghĩa sai', wrongCount),
      wrongAnswerExplanations: distractors('vì sao sai', wrongCount)
    },
    options
  );
}

export function verbUseMatchQuestion(options: FixtureOptions = {}): Record<string, unknown> {
  const wrongCount = (options.optionCount ?? 4) - 1;
  return withBase(
    {
      format: 'fill-blank',
      targetPhrase: 'make a decision',
      verb: 'make',
      noun: 'decision',
      sentence: 'We need to ____ before Friday.',
      wrongAnswers: distractors('wrong', wrongCount),
      wrongAnswerExplanations: distractors('vì sao sai', wrongCount)
    },
    options
  );
}

/** quizType -> factory, tiện cho test chạy vòng qua nhiều loại. */
export const QUESTION_FIXTURE_BY_TYPE = {
  vocab: vocabQuestion,
  phrase: phraseQuestion,
  idiom: idiomQuestion,
  fillblank: fillblankQuestion,
  conversation: conversationQuestion,
  description: descriptionQuestion,
  synonym: synonymQuestion,
  slang: slangQuestion,
  'verb-use-match': verbUseMatchQuestion
} as const;

export type FixtureQuizType = keyof typeof QUESTION_FIXTURE_BY_TYPE;
