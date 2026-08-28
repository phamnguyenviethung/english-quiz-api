import { BusinessLogicException } from '@/core/exceptions';
import type { QuizType } from '../questionTypes';
import { buildConversationPrompt } from './conversation-prompt';
import { buildDescriptionPrompt } from './description-prompt';
import { buildDifficultyInstruction } from './difficulty-prompt';
import { buildFillBlankPrompt } from './fill-blank-prompt';
import { buildIdiomPrompt } from './idiom-prompt';
import { buildOddOneOutPrompt } from './odd-one-out-prompt';
import { buildParagraphPrompt } from './paragraph-prompt';
import { buildPhrasePrompt } from './phrase-prompt';
import { buildSlangPrompt } from './slang-prompt';
import { buildSynonymPrompt } from './synonym-prompt';
import { buildVerbUseMatchPrompt } from './verb-use-match-prompt';
import type { DifficultyContext } from './vocab-prompt';
import { buildVocabPrompt } from './vocab-prompt';

export type ReviewContext = DifficultyContext & { topicName?: string | null };

/**
 * Dựng lại đúng base prompt sinh câu hỏi của từng quizType để làm "spec" cho việc
 * review. Không truyền `count` → prompt cho một câu đơn. `reading` và các loại
 * reading-* không nằm trong english_question_pool nên không hỗ trợ.
 */
function buildBaseGenPrompt(quizType: QuizType, wrongAnswerCount: number, topic?: string): string {
  const opts = { topic };
  switch (quizType) {
    case 'vocab':
      return buildVocabPrompt(wrongAnswerCount, opts);
    case 'fillblank':
      return buildFillBlankPrompt(wrongAnswerCount, opts);
    case 'phrase':
      return buildPhrasePrompt(wrongAnswerCount, opts);
    case 'conversation':
      return buildConversationPrompt(wrongAnswerCount, opts);
    case 'description':
      return buildDescriptionPrompt(wrongAnswerCount, opts);
    case 'synonym':
      return buildSynonymPrompt(wrongAnswerCount, opts);
    case 'slang':
      return buildSlangPrompt(wrongAnswerCount, opts);
    case 'odd-one-out':
      return buildOddOneOutPrompt(wrongAnswerCount, opts);
    case 'paragraph':
      return buildParagraphPrompt(wrongAnswerCount, opts);
    case 'idiom':
      return buildIdiomPrompt(wrongAnswerCount, opts);
    case 'verb-use-match':
      return buildVerbUseMatchPrompt(wrongAnswerCount, opts);
    default:
      throw new BusinessLogicException(`quizType không hỗ trợ AI review: ${quizType}`);
  }
}

/**
 * Prompt system cho việc review một câu hỏi trong pool: nhúng spec sinh câu hỏi
 * (base prompt của quizType + difficulty instruction theo engLevel/topic) rồi yêu
 * cầu model soi lỗi và trả về bản sửa full + checklist + issues.
 */
export function buildReviewPrompt(quizType: QuizType, ctx: ReviewContext): string {
  const wrongAnswerCount = ctx.optionCount - 1;
  const topic = ctx.topicName ?? undefined;
  const spec = buildBaseGenPrompt(quizType, wrongAnswerCount, topic) + buildDifficultyInstruction(ctx);

  return `You are an expert English quiz reviewer and editor.

The quiz item in the user message ("${quizType}") was generated to follow this SPECIFICATION:
--- BEGIN SPEC ---
${spec}
--- END SPEC ---

Review the item against the SPEC. Check specifically:
- factual / grammar / spelling errors
- correctAnswer: is it truly correct and the ONLY defensible answer in the given context? is it ambiguous?
- distractors (wrongAnswers / wrongStatements / groupWords): every one unambiguously wrong in context, plausible, and at the right difficulty for CEFR ${ctx.engLevel}
- exactly ${wrongAnswerCount} wrong options and ${wrongAnswerCount} matching explanations wherever the schema has those arrays
- topic alignment with "${ctx.topicName ?? 'no specific topic'}"
- CEFR ${ctx.engLevel} difficulty fit
- explanation quality (1-2 câu tiếng Việt, no markdown), example sentence quality

Then return JSON with:
- "revisedData": the FULL corrected item, EXACT same JSON keys/shape/types as the input. If the item is already correct, return it unchanged.
- "checklist": booleans describing what you changed or found (see the schema fields)
- "issues": concrete problems, each { field, severity (low|medium|high), problem (tiếng Việt), fix (tiếng Việt) }. Empty array if none.
- "verdict": "pass" (no change needed) | "revised" (you improved it) | "reject" (fundamentally broken, recommend discarding)
- "summary": 1-3 câu tiếng Việt tóm tắt kết quả review
- "score": integer 0-100 rating the ORIGINAL item's quality

Output pure JSON only, no markdown, no commentary.`;
}
