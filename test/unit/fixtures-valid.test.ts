import { describe, expect, it } from 'bun:test';
import { QUESTION_SCHEMA_BY_TYPE } from '@/core/services/english/prompt/question-schema-map';
import { QUESTION_FIXTURE_BY_TYPE, type FixtureQuizType } from '../fixtures/pool-question.fixture';

/**
 * Chốt chặn cho chính bộ fixture: nếu schema câu hỏi trong study.service đổi mà fixture không
 * đổi theo, hàng loạt test khác sẽ đỏ vì lý do khó hiểu. Test này làm nó đỏ đúng chỗ.
 */
describe('fixture câu hỏi khớp schema thật', () => {
  const types = Object.keys(QUESTION_FIXTURE_BY_TYPE) as FixtureQuizType[];

  for (const quizType of types) {
    it(`${quizType}: optionCount = 4 hợp lệ và có đúng 3 distractor`, () => {
      const schema = QUESTION_SCHEMA_BY_TYPE[quizType];
      expect(schema).toBeDefined();

      const data = QUESTION_FIXTURE_BY_TYPE[quizType]({ optionCount: 4 });
      const parsed = schema!.safeParse(data);
      if (!parsed.success) throw new Error(`${quizType} không khớp schema: ${parsed.error.message}`);

      expect((data.wrongAnswers as string[]).length).toBe(3);
      expect((data.wrongAnswerExplanations as string[]).length).toBe(3);
    });

    it(`${quizType}: optionCount = 5 cho ra 4 distractor`, () => {
      const data = QUESTION_FIXTURE_BY_TYPE[quizType]({ optionCount: 5 });
      expect(QUESTION_SCHEMA_BY_TYPE[quizType]!.safeParse(data).success).toBe(true);
      expect((data.wrongAnswers as string[]).length).toBe(4);
    });
  }
});
