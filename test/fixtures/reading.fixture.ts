import type { ReadingQuestionType } from '@/core/services/english/readingQuestionTypes';

/**
 * Output model cho pipeline reading.
 *
 * Passage phải nằm trong band chấp nhận (READING_WORD_ACCEPT = 140..235 từ) và có >= 2 đoạn,
 * nếu không `isValidReadingPassage` sẽ loại và test hoá ra đang đo nhánh reject.
 */

function sentence(index: number): string {
  return (
    `Anna wakes up early on day ${index} and walks to the small park near her house before the city becomes busy. ` +
    `She likes the quiet air there and often meets the same neighbours along the way every single morning.`
  );
}

/** ~160 từ, 2 đoạn — nằm giữa band 140..235. */
export function readingPassage(index = 1): Record<string, unknown> {
  const paragraphs = [`${sentence(index)} ${sentence(index + 1)}`, `${sentence(index + 2)} ${sentence(index + 3)}`];
  const wordCount = paragraphs.join(' ').split(/\s+/).filter(Boolean).length;

  return {
    title: `A Quiet Morning ${index}`,
    paragraphs,
    wordCount,
    topic: 'daily-life',
    cefrLevel: 'A1'
  };
}

export function readingPassageBatch(count: number): Record<string, unknown> {
  return { passages: Array.from({ length: count }, (_, i) => readingPassage(i + 1)) };
}

/**
 * Một câu hỏi đọc hiểu. `quizType` PHẢI khớp loại server giao, nếu không
 * `isValidReadingQuestionDraft` loại cả bộ (all-or-nothing).
 */
export function readingQuestion(quizType: ReadingQuestionType, index: number): Record<string, unknown> {
  return {
    question: {
      quizType,
      question: `What does Anna do in the morning, version ${index}?`,
      options: [
        `She walks to the park ${index}`,
        `She drives to work ${index}`,
        `She sleeps late ${index}`,
        `She cooks dinner ${index}`
      ],
      correctAnswer: 0,
      explanation: `Đoạn [1] nói rõ Anna đi bộ tới công viên (biến thể ${index}).`
    }
  };
}

/**
 * Đọc loại câu hỏi mà server vừa giao, từ `input` của lời gọi:
 *   Write exactly one "detail" question about the passage "..." at A1 level.
 * Trả `null` nếu không phải lời gọi sinh câu hỏi đọc hiểu.
 */
export function assignedQuestionType(input: string): ReadingQuestionType | null {
  const match = /Write exactly one "([a-z_]+)" question/.exec(input);
  return (match?.[1] as ReadingQuestionType | undefined) ?? null;
}

/**
 * Responder cho `mockLLM.respond`: luôn trả về câu hỏi ĐÚNG LOẠI server vừa giao, nội dung
 * khác nhau giữa các lần gọi (tránh bị loại vì trùng câu hoặc trùng đáp án trong cùng bộ).
 */
export function readingQuestionResponder(): (call: { input: string }) => Record<string, unknown> {
  let counter = 0;
  return (call) => {
    const type = assignedQuestionType(call.input);
    if (!type) throw new Error(`readingQuestionResponder: không đọc được loại câu hỏi từ input: ${call.input}`);
    counter += 1;
    return readingQuestion(type, counter);
  };
}
