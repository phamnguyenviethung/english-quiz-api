import { vocabQuestion } from './pool-question.fixture';

/**
 * Output của model cho `PoolReviewResultSchema`. 14 cờ checklist do AI trả
 * (`formatValid` là cờ thứ 15, do SERVER tự tính — cố ý không có ở đây).
 */

export const CLEAN_CHECKLIST: Record<string, boolean> = {
  notSolvable: false,
  insufficientContext: false,
  multipleDefensibleAnswers: false,
  answerIncorrect: false,
  optionsFormInconsistent: false,
  requiresOutsideKnowledge: false,
  solvedAnswerMismatch: false,
  explanationMismatch: false,
  explanationDoesNotDeriveAnswer: false,
  distractorExplanationMismatch: false,
  translationMismatch: false,
  spellingOrGrammarError: false,
  offTopic: false,
  levelMismatch: false
};

export interface ReviewResultOptions {
  verdict?: 'pass' | 'revised' | 'reject';
  score?: number;
  revisedData?: Record<string, unknown>;
  checklist?: Record<string, boolean>;
  issues?: Array<{ field: string; severity: 'low' | 'medium' | 'high'; problem: string; fix: string }>;
  summary?: string;
}

export function reviewResult(options: ReviewResultOptions = {}): Record<string, unknown> {
  return {
    verdict: options.verdict ?? 'pass',
    summary: options.summary ?? 'Câu hỏi đạt yêu cầu.',
    score: options.score ?? 90,
    selfSolve: { pickedLetter: 'A', confidence: 'high', reasoning: 'Đáp án rõ ràng.' },
    checklist: { ...CLEAN_CHECKLIST, ...options.checklist },
    issues: options.issues ?? [],
    revisedData: options.revisedData ?? vocabQuestion()
  };
}

/** Model sửa nội dung: đổi correctAnswer + explanation so với câu gốc. */
export function revisedReviewResult(): Record<string, unknown> {
  return reviewResult({
    verdict: 'revised',
    score: 65,
    checklist: { explanationMismatch: true },
    issues: [
      { field: 'explanation', severity: 'medium', problem: 'Giải thích không dẫn tới đáp án.', fix: 'Viết lại.' }
    ],
    revisedData: vocabQuestion({
      overrides: { explanation: 'Giải thích đã được viết lại cho rõ ràng.' }
    })
  });
}
