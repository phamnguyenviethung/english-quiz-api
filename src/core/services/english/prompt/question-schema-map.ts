import type { z } from 'zod';
import type { QuizType } from '../questionTypes';
import {
  ConversationQuestionSchema,
  DescriptionQuestionSchema,
  FillBlankQuestionSchema,
  IdiomQuestionSchema,
  OddOneOutQuestionSchema,
  ParagraphQuestionSchema,
  PhraseQuestionSchema,
  SlangQuestionSchema,
  SynonymQuestionSchema,
  VerbUseMatchQuestionSchema,
  VocabQuestionSchema
} from '../study.service';

/**
 * quizType → Zod schema của payload câu hỏi trong `english_question_pool`. Nguồn schema
 * duy nhất là `study.service.ts` để không lệch định nghĩa giữa các luồng (generate / review /
 * sibling). `reading` và reading-* không nằm trong pool nên không có mặt ở đây.
 */
export const QUESTION_SCHEMA_BY_TYPE: Partial<Record<QuizType, z.ZodTypeAny>> = {
  vocab: VocabQuestionSchema,
  fillblank: FillBlankQuestionSchema,
  phrase: PhraseQuestionSchema,
  conversation: ConversationQuestionSchema,
  description: DescriptionQuestionSchema,
  synonym: SynonymQuestionSchema,
  slang: SlangQuestionSchema,
  'odd-one-out': OddOneOutQuestionSchema,
  paragraph: ParagraphQuestionSchema,
  idiom: IdiomQuestionSchema,
  'verb-use-match': VerbUseMatchQuestionSchema
};
