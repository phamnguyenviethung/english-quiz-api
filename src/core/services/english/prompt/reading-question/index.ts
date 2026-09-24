import { type EngLevel } from '../../questionTypes';
import { CEFR_ALLOWED_QUESTION_TYPES, type ReadingQuestionType } from '../../readingQuestionTypes';
import {
  buildCommonSelfCheck,
  buildCorePrinciplesSection,
  buildDistractorSection,
  buildIndependenceBlock,
  buildLevelSection,
  buildOutputRulesSection,
  buildPassageSection,
  buildQualityConstraintsSection,
  buildSchemaBlock,
  OPTIONS_PER_QUESTION
} from './common';
import type { ReadingQuestionTypeModule } from './module';
import { buildBeginnerReadingQuestionLevelSection } from '../beginner-prompt';
import { attitudeModule } from './types/attitude';
import { causeEffectModule } from './types/cause-effect';
import { comparisonModule } from './types/comparison';
import { detailModule } from './types/detail';
import { inferenceModule } from './types/inference';
import { mainIdeaModule } from './types/main-idea';
import { predictionModule } from './types/prediction';
import { purposeModule } from './types/purpose';
import { reasonModule } from './types/reason';
import { resultModule } from './types/result';
import { sequenceModule } from './types/sequence';
import { specificFunctionModule } from './types/specific-function';
import { vocabularyContextModule } from './types/vocabulary-context';

export { OPTIONS_PER_QUESTION };
export const QUESTIONS_PER_PASSAGE = 3;

export interface ReadingQuestionDraft {
  quizType: ReadingQuestionType;
  question: string;
  options: string[];
  /** Index 0-based vào options. */
  correctAnswer: number;
  /** Một câu tiếng Việt giải thích vì sao đáp án đúng, trỏ tới đoạn chứa evidence. */
  explanation: string;
}

/**
 * Chỉ khai module cho type nằm trong CEFR_ALLOWED_QUESTION_TYPES. 6 type còn lại
 * (true_false, negative_detail, matching, best_title, paraphrase, reference) không level
 * nào cho phép nên không bao giờ được chọn — viết module cho chúng là code chết.
 */
const MODULES: Partial<Record<ReadingQuestionType, ReadingQuestionTypeModule>> = {
  detail: detailModule,
  reason: reasonModule,
  result: resultModule,
  sequence: sequenceModule,
  vocabulary_context: vocabularyContextModule,
  main_idea: mainIdeaModule,
  cause_effect: causeEffectModule,
  inference: inferenceModule,
  purpose: purposeModule,
  comparison: comparisonModule,
  attitude: attitudeModule,
  specific_function: specificFunctionModule,
  prediction: predictionModule
};

/**
 * Mở thêm type trong CEFR_ALLOWED_QUESTION_TYPES mà quên viết module thì fail ngay lúc
 * import, không phải lúc cron chạy 6h sáng.
 */
const missingModules = [...new Set(Object.values(CEFR_ALLOWED_QUESTION_TYPES).flat())].filter(
  (type) => MODULES[type] === undefined
);
if (missingModules.length > 0) {
  throw new Error(
    `[reading-question] Thiếu prompt module cho quiz type: ${missingModules.join(', ')}. ` +
      'Mọi type trong CEFR_ALLOWED_QUESTION_TYPES phải có module ở prompt/reading-question/types/.'
  );
}

export function getReadingQuestionModule(type: ReadingQuestionType): ReadingQuestionTypeModule {
  const found = MODULES[type];
  if (!found) {
    throw new Error(`[reading-question] Không có prompt module cho quiz type "${type}"`);
  }
  return found;
}

function numbered(lines: string[]): string {
  return lines.map((line, index) => `  ${index + 1}. ${line}`).join('\n');
}

function bulleted(lines: string[]): string {
  return lines.map((line) => `  - ${line}`).join('\n');
}

/** Prompt sinh ĐÚNG 1 câu hỏi theo type chỉ định: common block + đúng 1 module. */
export function buildReadingQuestionPrompt(input: {
  quizType: ReadingQuestionType;
  title: string;
  paragraphs: string[];
  cefrLevel: EngLevel;
  topicName: string;
  forBeginner?: boolean;
  previousQuestions?: string[];
}): string {
  const { quizType, cefrLevel } = input;
  const module = getReadingQuestionModule(quizType);

  return `You are a reading-comprehension question writer for Vietnamese learners of English.

${module.role}

You write exactly ONE question, of type "${quizType}". The type is already decided — do not choose a different one, and do not write more than one question.
${buildIndependenceBlock(input.previousQuestions ?? [])}
${buildPassageSection(input)}

${input.forBeginner ? buildBeginnerReadingQuestionLevelSection(cefrLevel) : buildLevelSection(cefrLevel)}

${buildSchemaBlock(quizType)}

${buildOutputRulesSection()}

─── TYPE: ${quizType} ───────────────────────────────────────────────────────────

Evidence you must find in the passage:
  ${module.evidence}

Method:
${numbered(module.method)}

Distractors for this type:
${bulleted(module.distractors)}

Common mistakes on this type — avoid all of them:
${bulleted(module.pitfalls)}

─── EXAMPLE SHAPE ──────────────────────────────────────────────────────────────

${module.example}

${buildCorePrinciplesSection()}

${buildDistractorSection()}

─── WHEN THE EVIDENCE LOOKS THIN ───────────────────────────────────────────────

The type "${quizType}" has been chosen for this passage because passages like this one
support it. If the evidence is not obvious on a first read, re-read the passage: short
passages still name actions, reasons, outcomes and useful words.

If several candidates look weak, choose the STRONGEST one available and build a careful
question around it. Do not invent facts that are not in the passage, and do not switch to
a different quiz type.

─── FINAL SELF-CHECK — do this BEFORE writing JSON ──────────────────────────────

${buildCommonSelfCheck(cefrLevel)}

For type "${quizType}" specifically:
${numbered(module.selfCheck).replace(/^ {2}(\d+)\./gm, (_match, n) => `  ${Number(n) + 7}.`)}

Only output JSON after every check passes.

${buildQualityConstraintsSection()}

Output JSON only.`;
}
