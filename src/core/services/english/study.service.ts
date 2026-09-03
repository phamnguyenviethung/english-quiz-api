import _ from 'lodash';
import { z } from 'zod';
import {
  generateStructuredOutput,
  resolveStudyModel,
  type ModelContext,
  type StructuredOutputUsage
} from '@/configs/aiClient.config';

export type { StructuredOutputUsage };
import logger from '@/configs/logger.config';
import { buildConversationPrompt, type ConversationQuestion } from './prompt/conversation-prompt';
import { buildDifficultyInstruction } from './prompt/difficulty-prompt';
import { buildDescriptionPrompt, type DescriptionQuestion } from './prompt/description-prompt';
import { buildFillBlankPrompt, type FillBlankQuestion } from './prompt/fill-blank-prompt';
import { buildOddOneOutPrompt, type OddOneOutQuestion } from './prompt/odd-one-out-prompt';
import { buildReadingPrompt, type ReadingQuestion, VALID_TACTICS } from './prompt/reading-prompt';
import {
  buildReadingPassagePrompt,
  countPassageWords,
  READING_WORD_ACCEPT,
  type ReadingPassage
} from './prompt/reading-passage-prompt';
import {
  buildAcademicReadingPassagePrompt,
  ACADEMIC_READING_WORD_ACCEPT
} from './prompt/reading-passage-prompt-academic';
import { buildReadingQuestionPrompt, OPTIONS_PER_QUESTION, type ReadingQuestionDraft } from './prompt/reading-question';
import { READING_QUESTION_TYPES, selectQuestionTypes, type ReadingQuestionType } from './readingQuestionTypes';
import {
  DESCRIPTION_TRANSLATION_LEAKS,
  PARAGRAPH_REFERENCE_PATTERN,
  descriptionLeaksAnswer,
  descriptionLeaksKnownTranslation,
  hasAnyPhrase,
  isVagueSubjectiveDescription,
  isValidDescriptionQuestion,
  isValidReadingPassage,
  isValidReadingQuestionDraft,
  isValidReadingQuestionSet,
  looksLikeDefinitionOrQuestion,
  normalizeReadingPassage,
  normalizeReadingQuestionDraft,
  normalizeTextForHeuristic,
  normalizeTextForLeakCheck,
  shuffleReadingQuestionOptions,
  spreadCorrectAnswers
} from './study.validators';
import { buildParagraphPrompt, type ParagraphQuestion } from './prompt/paragraph-prompt';
import { buildPhrasePrompt, type PhraseQuestion } from './prompt/phrase-prompt';
import { buildSlangPrompt, type SlangQuestion } from './prompt/slang-prompt';
import { buildSynonymPrompt, type SynonymQuestion } from './prompt/synonym-prompt';
import { buildVocabPrompt, type DifficultyContext, type VocabQuestion } from './prompt/vocab-prompt';
import { buildIdiomPrompt, type IdiomQuestion } from './prompt/idiom-prompt';
import { buildVerbUseMatchPrompt, type VerbUseMatchQuestion } from './prompt/verb-use-match-prompt';
import { ENG_LEVELS, type EngLevel, type QuizType, type ReadingPassageType } from './questionTypes';
import { BusinessLogicException } from '@/core/exceptions';
import type { ProviderPreferencesJson } from '@/core/db/schema/main';

export type {
  ConversationQuestion,
  DescriptionQuestion,
  DifficultyContext,
  FillBlankQuestion,
  IdiomQuestion,
  OddOneOutQuestion,
  ParagraphQuestion,
  PhraseQuestion,
  ReadingPassage,
  ReadingQuestion,
  ReadingQuestionDraft,
  SlangQuestion,
  SynonymQuestion,
  VocabQuestion,
  VerbUseMatchQuestion
};

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const baseQuizFields = {
  explanation: z.string(),
  exampleSentence: z.string(),
  exampleTranslation: z.string()
};

export const VocabQuestionSchema = z.object({
  word: z.string(),
  partOfSpeech: z.string(),
  correctAnswer: z.string(),
  wrongAnswers: z.array(z.string()),
  wrongAnswerExplanations: z.array(z.string()),
  ...baseQuizFields
});

export const PhraseQuestionSchema = z.object({
  phrase: z.string(),
  correctAnswer: z.string(),
  wrongAnswers: z.array(z.string()),
  wrongAnswerExplanations: z.array(z.string()),
  ...baseQuizFields
});

export const FillBlankQuestionSchema = z.object({
  word: z.string(),
  sentence: z.string(),
  sentenceTranslation: z.string(),
  highlightedWord: z.string(),
  correctAnswer: z.string(),
  correctAnswerTranslation: z.string(),
  wrongAnswers: z.array(z.string()),
  optionTranslations: z.array(z.string()),
  wrongAnswerExplanations: z.array(z.string()),
  ...baseQuizFields
});

export const ConversationQuestionSchema = z.object({
  dialogueLines: z.array(z.string()),
  sentence: z.string(),
  sentenceTranslation: z.string(),
  highlightedWord: z.string(),
  correctAnswer: z.string(),
  correctAnswerTranslation: z.string(),
  wrongAnswers: z.array(z.string()),
  optionTranslations: z.array(z.string()),
  wrongAnswerExplanations: z.array(z.string()),
  ...baseQuizFields
});

export const DescriptionQuestionSchema = z.object({
  description: z.string(),
  descriptionLanguage: z.enum(['vi', 'en']),
  partOfSpeech: z.enum(['noun', 'verb', 'adjective']),
  correctAnswer: z.string(),
  wrongAnswers: z.array(z.string()),
  wrongAnswerExplanations: z.array(z.string()),
  ...baseQuizFields
});

export const SynonymQuestionSchema = z.object({
  word: z.string(),
  questionType: z.enum(['synonym', 'antonym']),
  partOfSpeech: z.string(),
  correctAnswer: z.string(),
  wrongAnswers: z.array(z.string()),
  wrongAnswerExplanations: z.array(z.string()),
  ...baseQuizFields
});

export const SlangQuestionSchema = z.object({
  slang: z.string(),
  partOfSpeech: z.string(),
  correctAnswer: z.string(),
  wrongAnswers: z.array(z.string()),
  wrongAnswerExplanations: z.array(z.string()),
  ...baseQuizFields
});

export const OddOneOutQuestionSchema = z.object({
  oddWord: z.string(),
  groupTheme: z.string(),
  groupWords: z.array(z.string()),
  groupWordExplanations: z.array(z.string()),
  ...baseQuizFields
});

export const ReadingQuestionSchema = z.object({
  distractorTactic: z.enum(VALID_TACTICS),
  context: z.string(),
  questionSentence: z.string(),
  correctAnswer: z.number().int().positive(),
  wrongAnswers: z.array(z.number().int().positive()),
  translation: z.string(),
  explanation: z.string()
});

export const ReadingPassageSchema = z.object({
  title: z.string(),
  paragraphs: z.array(z.string()).min(2),
  wordCount: z.number().int().positive(),
  topic: z.string(),
  cefrLevel: z.enum(ENG_LEVELS)
});

export const ReadingQuestionDraftSchema = z.object({
  quizType: z.enum(READING_QUESTION_TYPES),
  question: z.string(),
  options: z.array(z.string()).length(OPTIONS_PER_QUESTION),
  correctAnswer: z
    .number()
    .int()
    .min(0)
    .max(OPTIONS_PER_QUESTION - 1),
  explanation: z.string()
});

// Response shape metadata dùng cho OpenAPI (src/api/common/responseSchemas.ts) — usage
// field trả về từ generateStructuredOutput, optional khi provider không trả token count.
export const UsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  model: z.string()
});

// ─── Batch Schemas ───────────────────────────────────────────────────────────

const VocabBatchSchema = z.object({ questions: z.array(VocabQuestionSchema).min(1).max(5) });
const PhraseBatchSchema = z.object({ questions: z.array(PhraseQuestionSchema).min(1).max(5) });
const FillBlankBatchSchema = z.object({ questions: z.array(FillBlankQuestionSchema).min(1).max(5) });
const ConversationBatchSchema = z.object({ questions: z.array(ConversationQuestionSchema).min(1).max(5) });
const DescriptionBatchSchema = z.object({ questions: z.array(DescriptionQuestionSchema).min(1).max(5) });
const SynonymBatchSchema = z.object({ questions: z.array(SynonymQuestionSchema).min(1).max(5) });
const SlangBatchSchema = z.object({ questions: z.array(SlangQuestionSchema).min(1).max(5) });
const OddOneOutBatchSchema = z.object({ questions: z.array(OddOneOutQuestionSchema).min(1).max(5) });
const ReadingBatchSchema = z.object({ questions: z.array(ReadingQuestionSchema).min(1).max(5) });
const ReadingPassageBatchSchema = z.object({ passages: z.array(ReadingPassageSchema).min(1).max(5) });
// KHÔNG để nullable. Schema này được đổi thành JSON Schema của tool nên `null` hợp lệ ở
// đây là một đường thoát ngay trong chữ ký hàm — đo thực tế: model yếu vin vào đó để né
// cả những type dễ như detail, đẩy tỉ lệ reject cả bộ lên 30-60%. Bỏ nullable thì model
// buộc phải trả về object.
const ReadingQuestionResponseSchema = z.object({
  question: ReadingQuestionDraftSchema
});

export const ParagraphQuestionSchema = z.object({
  paragraph: z.string(),
  correctStatement: z.string(),
  wrongStatements: z.array(z.string()),
  wrongStatementExplanations: z.array(z.string()),
  explanation: z.string(),
  translation: z.string()
});

const ParagraphBatchSchema = z.object({ questions: z.array(ParagraphQuestionSchema).min(1).max(5) });

export const IdiomQuestionSchema = z.object({
  idiom: z.string(),
  correctAnswer: z.string(),
  wrongAnswers: z.array(z.string()),
  wrongAnswerExplanations: z.array(z.string()),
  ...baseQuizFields
});
const IdiomBatchSchema = z.object({ questions: z.array(IdiomQuestionSchema).min(1).max(5) });

export const VerbUseMatchQuestionSchema = z.object({
  format: z.enum(['fill-blank', 'phrase-choice']),
  targetPhrase: z.string(),
  verb: z.string(),
  noun: z.string(),
  sentence: z.string(),
  wrongAnswers: z.array(z.string()),
  wrongAnswerExplanations: z.array(z.string()),
  explanation: z.string(),
  exampleSentence: z.string(),
  exampleTranslation: z.string()
});
const VerbUseMatchBatchSchema = z.object({ questions: z.array(VerbUseMatchQuestionSchema).min(1).max(5) });

export interface BatchGenerateOptions {
  count: number;
  topic?: string;
  excludeWords?: string[];
}

/**
 * Context sinh reading passage. Không dùng DifficultyContext vì optionCount/show5050
 * vô nghĩa với bài đọc thuần — passage không có đáp án.
 */
export interface ReadingPassageContext {
  cefrLevel: EngLevel;
  topicName: string;
  type: ReadingPassageType;
  model: string;
  provider?: ProviderPreferencesJson;
}

export interface ReadingPassageBatchOptions {
  count: number;
  excludeTitles?: string[];
}

/** Context sinh câu hỏi TỪ một passage đã lưu — mang theo nội dung bài để nhét vào prompt. */
export interface ReadingQuestionContext {
  passageId: number;
  title: string;
  paragraphs: string[];
  cefrLevel: EngLevel;
  topicName: string;
  model: string;
  provider?: ProviderPreferencesJson;
}

export interface ReadingQuestionBatchOptions {
  count: number;
  excludeQuestions?: string[];
}

/** Một lần gọi LLM cho một câu. Job dùng để ghi từng model attempt riêng. */
export interface ReadingQuestionAttempt {
  quizType: ReadingQuestionType;
  ok: boolean;
  usage?: StructuredOutputUsage;
}

export interface ReadingQuestionSetResult {
  questions: ReadingQuestionDraft[];
  /** Chưa gộp token — job cần từng attempt để ghi vào english_cron_job_model_attempts. */
  attempts: ReadingQuestionAttempt[];
}

interface BatchResult<T> {
  questions: T[];
  usage?: StructuredOutputUsage;
}

// ─── Service ──────────────────────────────────────────────────────────────────

class StudyService {
  async generatePhraseQuestion(
    ctx: DifficultyContext,
    excludeWords?: string[]
  ): Promise<{ question: PhraseQuestion; usage?: StructuredOutputUsage }> {
    const wrongAnswerCount = ctx.optionCount - 1;
    const systemInstruction =
      buildPhrasePrompt(wrongAnswerCount, { excludePhrases: excludeWords }) + buildDifficultyInstruction(ctx);

    logger.info(`[StudyService] Generating phrase question (engLevel=${ctx.engLevel})`);

    const { data: object, usage } = await generateStructuredOutput(PhraseQuestionSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: 'Generate a phrase meaning quiz question.',
      maxOutputTokens: 2000,
      temperature: 0.9
    });

    logger.info(`[StudyService] Phrase question generated: "${object.phrase}"`);

    if (object.wrongAnswers.length !== wrongAnswerCount || object.wrongAnswerExplanations.length !== wrongAnswerCount) {
      throw new Error('[StudyService] Invalid phrase question format: wrong array counts');
    }

    return { question: object as PhraseQuestion, usage };
  }

  async generateFillBlankQuestion(
    ctx: DifficultyContext,
    excludeWords?: string[]
  ): Promise<{ question: FillBlankQuestion; usage?: StructuredOutputUsage }> {
    logger.info(`[StudyService] Generating fill-blank question (engLevel=${ctx.engLevel})`);

    const wrongAnswerCount = ctx.optionCount - 1;
    const systemInstruction =
      buildFillBlankPrompt(wrongAnswerCount, { excludeWords }) + buildDifficultyInstruction(ctx);

    const { data: object, usage } = await generateStructuredOutput(FillBlankQuestionSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: 'Generate a fill-in-the-blank quiz question.',
      maxOutputTokens: 3000,
      temperature: 0.7
    });

    logger.info(`[StudyService] Fill-blank question generated for word: "${object.word}"`);

    if (
      !object.sentence.includes('___') ||
      object.wrongAnswers.length !== wrongAnswerCount ||
      object.optionTranslations.length !== wrongAnswerCount ||
      object.wrongAnswerExplanations.length !== wrongAnswerCount
    ) {
      throw new Error('[StudyService] Invalid fill-blank format: sentence missing ___ or wrong array counts');
    }

    return { question: object as FillBlankQuestion, usage };
  }

  async generateConversationQuestion(
    ctx: DifficultyContext,
    excludeWords?: string[]
  ): Promise<{ question: ConversationQuestion; usage?: StructuredOutputUsage }> {
    logger.info(`[StudyService] Generating conversation question (engLevel=${ctx.engLevel})`);

    const wrongAnswerCount = ctx.optionCount - 1;
    const systemInstruction = buildConversationPrompt(wrongAnswerCount) + buildDifficultyInstruction(ctx);

    // Pass excludeWords hint in input if provided
    const input =
      excludeWords && excludeWords.length > 0
        ? `Generate a conversation fill-in-the-blank quiz question. Avoid these recently used words: ${excludeWords.join(', ')}.`
        : 'Generate a conversation fill-in-the-blank quiz question.';

    const { data: object, usage } = await generateStructuredOutput(ConversationQuestionSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input,
      maxOutputTokens: 3500,
      temperature: 0.85
    });

    logger.info('[StudyService] Conversation question generated');

    if (
      object.dialogueLines.length !== 4 ||
      !object.sentence.includes('___') ||
      object.wrongAnswers.length !== wrongAnswerCount ||
      object.optionTranslations.length !== wrongAnswerCount ||
      object.wrongAnswerExplanations.length !== wrongAnswerCount
    ) {
      throw new Error('[StudyService] Invalid conversation question format');
    }

    // Rebuild sentence from dialogueLines to normalize any \n escaping inconsistency from the model
    object.sentence = object.dialogueLines.join('\n');
    return { question: object as ConversationQuestion, usage };
  }

  async generateDescriptionQuestion(
    ctx: DifficultyContext,
    excludeWords?: string[]
  ): Promise<{ question: DescriptionQuestion; usage?: StructuredOutputUsage }> {
    logger.info(`[StudyService] Generating description question (engLevel=${ctx.engLevel})`);

    const wrongAnswerCount = ctx.optionCount - 1;
    const systemInstruction =
      buildDescriptionPrompt(wrongAnswerCount, {
        topic: ctx.topicName ?? undefined,
        excludeWords,
        engLevel: ctx.engLevel
      }) + buildDifficultyInstruction(ctx);

    const { data: object, usage } = await generateStructuredOutput(DescriptionQuestionSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: 'Generate a real-life description-to-vocab quiz question.',
      maxOutputTokens: 2500,
      temperature: 0.85
    });

    logger.info(`[StudyService] Description question generated for word: "${object.correctAnswer}"`);

    if (!isValidDescriptionQuestion(object, wrongAnswerCount, ctx.engLevel)) {
      throw new Error('[StudyService] Invalid description question format');
    }

    return { question: object as DescriptionQuestion, usage };
  }

  async generateSynonymQuestion(
    ctx: DifficultyContext,
    excludeWords?: string[]
  ): Promise<{ question: SynonymQuestion; usage?: StructuredOutputUsage }> {
    logger.info(`[StudyService] Generating synonym question (engLevel=${ctx.engLevel})`);

    const wrongAnswerCount = ctx.optionCount - 1;
    const systemInstruction = buildSynonymPrompt(wrongAnswerCount, { excludeWords }) + buildDifficultyInstruction(ctx);

    const { data: object, usage } = await generateStructuredOutput(SynonymQuestionSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: 'Generate a synonym/antonym quiz question.',
      maxOutputTokens: 2000,
      temperature: 0.8
    });

    logger.info('[StudyService] Synonym question generated');

    if (object.wrongAnswers.length !== wrongAnswerCount || object.wrongAnswerExplanations.length !== wrongAnswerCount) {
      throw new Error('[StudyService] Invalid synonym question format: wrong array counts');
    }

    return { question: object as SynonymQuestion, usage };
  }

  async generateSlangQuestion(
    ctx: DifficultyContext,
    excludeWords?: string[]
  ): Promise<{ question: SlangQuestion; usage?: StructuredOutputUsage }> {
    logger.info(`[StudyService] Generating slang question (engLevel=${ctx.engLevel})`);

    const wrongAnswerCount = ctx.optionCount - 1;
    const systemInstruction = buildSlangPrompt(wrongAnswerCount, { excludeWords }) + buildDifficultyInstruction(ctx);

    const { data: object, usage } = await generateStructuredOutput(SlangQuestionSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: 'Generate a slang quiz question.',
      maxOutputTokens: 2000,
      temperature: 0.9
    });

    logger.info('[StudyService] Slang question generated');

    if (object.wrongAnswers.length !== wrongAnswerCount || object.wrongAnswerExplanations.length !== wrongAnswerCount) {
      throw new Error('[StudyService] Invalid slang question format: wrong array counts');
    }

    return { question: object as SlangQuestion, usage };
  }

  async generateOddOneOutQuestion(
    ctx: DifficultyContext,
    excludeWords?: string[]
  ): Promise<{ question: OddOneOutQuestion; usage?: StructuredOutputUsage }> {
    logger.info(`[StudyService] Generating odd-one-out question (engLevel=${ctx.engLevel})`);

    const wrongAnswerCount = ctx.optionCount - 1;
    const systemInstruction =
      buildOddOneOutPrompt(wrongAnswerCount, { excludeWords }) + buildDifficultyInstruction(ctx);

    const { data: object, usage } = await generateStructuredOutput(OddOneOutQuestionSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: 'Generate an odd-one-out quiz question.',
      maxOutputTokens: 2500,
      temperature: 0.9
    });

    logger.info('[StudyService] Odd-one-out question generated');

    if (object.groupWords.length !== wrongAnswerCount || object.groupWordExplanations.length !== wrongAnswerCount) {
      throw new Error('[StudyService] Invalid odd-one-out question format: wrong array counts');
    }

    const oddWordLower = object.oddWord.toLowerCase().trim();
    const hasConflict = object.groupWords.some((w: string) => {
      const wLower = w.toLowerCase().trim();
      return wLower === oddWordLower || wLower.startsWith(oddWordLower) || oddWordLower.startsWith(wLower);
    });
    if (hasConflict) {
      throw new Error('[StudyService] Invalid odd-one-out question: oddWord overlaps with groupWords');
    }

    return { question: object as OddOneOutQuestion, usage };
  }

  async generateReadingQuestion(
    ctx: DifficultyContext
  ): Promise<{ question: ReadingQuestion; usage?: StructuredOutputUsage }> {
    logger.info(`[StudyService] Generating reading question (engLevel=${ctx.engLevel})`);

    const wrongAnswerCount = ctx.optionCount - 1;
    const systemInstruction = buildReadingPrompt(wrongAnswerCount, ctx.engLevel);

    const { data: object, usage } = await generateStructuredOutput(ReadingQuestionSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: 'Generate a reading comprehension + mental math quiz question.',
      maxOutputTokens: 4000,
      temperature: 0.85
    });

    logger.info('[StudyService] Reading question generated');

    // Normalize newlines trong translation
    object.translation = object.translation.replace(/\n/g, ' ').trim();

    if (
      object.wrongAnswers.length !== wrongAnswerCount ||
      object.wrongAnswers.includes(object.correctAnswer) ||
      new Set(object.wrongAnswers).size !== object.wrongAnswers.length
    ) {
      throw new Error('[StudyService] Invalid reading question format: wrong answer count or duplicates');
    }

    return { question: object as ReadingQuestion, usage };
  }

  async generateQuestion(
    ctx: DifficultyContext,
    excludeWords?: string[]
  ): Promise<{ question: VocabQuestion; usage?: StructuredOutputUsage }> {
    logger.info(`[StudyService] Generating vocab question (engLevel=${ctx.engLevel})`);

    const wrongAnswerCount = ctx.optionCount - 1;
    const systemInstruction = buildVocabPrompt(wrongAnswerCount, { excludeWords }) + buildDifficultyInstruction(ctx);

    const { data: object, usage } = await generateStructuredOutput(VocabQuestionSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: 'Generate a vocabulary quiz question.',
      maxOutputTokens: 2000,
      temperature: 0.7
    });

    logger.info(`[StudyService] Vocab question generated for word: "${object.word}"`);

    if (object.wrongAnswers.length !== wrongAnswerCount || object.wrongAnswerExplanations.length !== wrongAnswerCount) {
      throw new Error('[StudyService] Invalid question format: wrong array counts');
    }

    return { question: object as VocabQuestion, usage };
  }

  // ─── Batch Generation Methods ──────────────────────────────────────────────

  async generateVocabBatch(ctx: DifficultyContext, opts: BatchGenerateOptions): Promise<BatchResult<VocabQuestion>> {
    const { count, topic, excludeWords } = opts;
    const wrongAnswerCount = ctx.optionCount - 1;
    logger.info(`[StudyService] Batch generating ${count} vocab question(s) (engLevel=${ctx.engLevel} topic=${topic})`);

    const systemInstruction =
      buildVocabPrompt(wrongAnswerCount, { count, topic, excludeWords }) + buildDifficultyInstruction(ctx);
    const { data, usage } = await generateStructuredOutput(VocabBatchSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: `Generate exactly ${count} vocabulary quiz question(s).`,
      maxOutputTokens: 2500 * count,
      temperature: 0.7
    });

    const valid = data.questions.filter(
      (q) => q.wrongAnswers.length === wrongAnswerCount && q.wrongAnswerExplanations.length === wrongAnswerCount
    );
    logger.info(`[StudyService] Vocab batch: ${valid.length}/${count} valid`);
    return { questions: valid as VocabQuestion[], usage };
  }

  async generatePhraseBatch(ctx: DifficultyContext, opts: BatchGenerateOptions): Promise<BatchResult<PhraseQuestion>> {
    const { count, topic, excludeWords } = opts;
    const wrongAnswerCount = ctx.optionCount - 1;
    logger.info(
      `[StudyService] Batch generating ${count} phrase question(s) (engLevel=${ctx.engLevel} topic=${topic})`
    );

    const systemInstruction =
      buildPhrasePrompt(wrongAnswerCount, { count, topic, excludePhrases: excludeWords }) +
      buildDifficultyInstruction(ctx);
    const { data, usage } = await generateStructuredOutput(PhraseBatchSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: `Generate exactly ${count} phrase meaning quiz question(s).`,
      maxOutputTokens: 2500 * count,
      temperature: 0.9
    });

    const valid = data.questions.filter(
      (q) => q.wrongAnswers.length === wrongAnswerCount && q.wrongAnswerExplanations.length === wrongAnswerCount
    );
    logger.info(`[StudyService] Phrase batch: ${valid.length}/${count} valid`);
    return { questions: valid as PhraseQuestion[], usage };
  }

  async generateFillBlankBatch(
    ctx: DifficultyContext,
    opts: BatchGenerateOptions
  ): Promise<BatchResult<FillBlankQuestion>> {
    const { count, topic, excludeWords } = opts;
    const wrongAnswerCount = ctx.optionCount - 1;
    logger.info(
      `[StudyService] Batch generating ${count} fill-blank question(s) (engLevel=${ctx.engLevel} topic=${topic})`
    );

    const systemInstruction =
      buildFillBlankPrompt(wrongAnswerCount, { count, topic, excludeWords }) + buildDifficultyInstruction(ctx);
    const { data, usage } = await generateStructuredOutput(FillBlankBatchSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: `Generate exactly ${count} fill-in-the-blank quiz question(s).`,
      maxOutputTokens: 3500 * count,
      temperature: 0.7
    });

    const valid = data.questions.filter(
      (q) =>
        q.sentence.includes('___') &&
        q.wrongAnswers.length === wrongAnswerCount &&
        q.optionTranslations.length === wrongAnswerCount &&
        q.wrongAnswerExplanations.length === wrongAnswerCount
    );
    logger.info(`[StudyService] Fill-blank batch: ${valid.length}/${count} valid`);
    return { questions: valid as FillBlankQuestion[], usage };
  }

  async generateConversationBatch(
    ctx: DifficultyContext,
    opts: BatchGenerateOptions
  ): Promise<BatchResult<ConversationQuestion>> {
    const { count, topic } = opts;
    const wrongAnswerCount = ctx.optionCount - 1;
    logger.info(
      `[StudyService] Batch generating ${count} conversation question(s) (engLevel=${ctx.engLevel} topic=${topic})`
    );

    const systemInstruction =
      buildConversationPrompt(wrongAnswerCount, { count, topic }) + buildDifficultyInstruction(ctx);
    const { data, usage } = await generateStructuredOutput(ConversationBatchSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: `Generate exactly ${count} conversation fill-in-the-blank quiz question(s).`,
      maxOutputTokens: 4000 * count,
      temperature: 0.85
    });

    const valid = data.questions.filter((q) => {
      if (
        q.dialogueLines.length !== 4 ||
        !q.sentence.includes('___') ||
        q.wrongAnswers.length !== wrongAnswerCount ||
        q.optionTranslations.length !== wrongAnswerCount ||
        q.wrongAnswerExplanations.length !== wrongAnswerCount
      )
        return false;
      q.sentence = q.dialogueLines.join('\n');
      return true;
    });
    logger.info(`[StudyService] Conversation batch: ${valid.length}/${count} valid`);
    return { questions: valid as ConversationQuestion[], usage };
  }

  async generateDescriptionBatch(
    ctx: DifficultyContext,
    opts: BatchGenerateOptions
  ): Promise<BatchResult<DescriptionQuestion>> {
    const { count, topic, excludeWords } = opts;
    const wrongAnswerCount = ctx.optionCount - 1;
    logger.info(
      `[StudyService] Batch generating ${count} description question(s) (engLevel=${ctx.engLevel} topic=${topic})`
    );

    const systemInstruction =
      buildDescriptionPrompt(wrongAnswerCount, { count, topic, excludeWords, engLevel: ctx.engLevel }) +
      buildDifficultyInstruction(ctx);
    const { data, usage } = await generateStructuredOutput(DescriptionBatchSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: `Generate exactly ${count} real-life description-to-vocab quiz question(s).`,
      maxOutputTokens: 3000 * count,
      temperature: 0.85
    });

    const valid = data.questions.filter((q) => isValidDescriptionQuestion(q, wrongAnswerCount, ctx.engLevel));
    logger.info(`[StudyService] Description batch: ${valid.length}/${count} valid`);
    return { questions: valid as DescriptionQuestion[], usage };
  }

  async generateSynonymBatch(
    ctx: DifficultyContext,
    opts: BatchGenerateOptions
  ): Promise<BatchResult<SynonymQuestion>> {
    const { count, topic, excludeWords } = opts;
    const wrongAnswerCount = ctx.optionCount - 1;
    logger.info(
      `[StudyService] Batch generating ${count} synonym question(s) (engLevel=${ctx.engLevel} topic=${topic})`
    );

    const systemInstruction =
      buildSynonymPrompt(wrongAnswerCount, { count, topic, excludeWords }) + buildDifficultyInstruction(ctx);
    const { data, usage } = await generateStructuredOutput(SynonymBatchSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: `Generate exactly ${count} synonym/antonym quiz question(s).`,
      maxOutputTokens: 2500 * count,
      temperature: 0.8
    });

    const valid = data.questions.filter(
      (q) => q.wrongAnswers.length === wrongAnswerCount && q.wrongAnswerExplanations.length === wrongAnswerCount
    );
    logger.info(`[StudyService] Synonym batch: ${valid.length}/${count} valid`);
    return { questions: valid as SynonymQuestion[], usage };
  }

  async generateSlangBatch(ctx: DifficultyContext, opts: BatchGenerateOptions): Promise<BatchResult<SlangQuestion>> {
    const { count, topic, excludeWords } = opts;
    const wrongAnswerCount = ctx.optionCount - 1;
    logger.info(`[StudyService] Batch generating ${count} slang question(s) (engLevel=${ctx.engLevel} topic=${topic})`);

    const systemInstruction =
      buildSlangPrompt(wrongAnswerCount, { count, topic, excludeWords }) + buildDifficultyInstruction(ctx);
    const { data, usage } = await generateStructuredOutput(SlangBatchSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: `Generate exactly ${count} slang quiz question(s).`,
      maxOutputTokens: 2500 * count,
      temperature: 0.9
    });

    const valid = data.questions.filter(
      (q) => q.wrongAnswers.length === wrongAnswerCount && q.wrongAnswerExplanations.length === wrongAnswerCount
    );
    logger.info(`[StudyService] Slang batch: ${valid.length}/${count} valid`);
    return { questions: valid as SlangQuestion[], usage };
  }

  async generateOddOneOutBatch(
    ctx: DifficultyContext,
    opts: BatchGenerateOptions
  ): Promise<BatchResult<OddOneOutQuestion>> {
    const { count, topic, excludeWords } = opts;
    const wrongAnswerCount = ctx.optionCount - 1;
    logger.info(
      `[StudyService] Batch generating ${count} odd-one-out question(s) (engLevel=${ctx.engLevel} topic=${topic})`
    );

    const systemInstruction =
      buildOddOneOutPrompt(wrongAnswerCount, { count, topic, excludeWords }) + buildDifficultyInstruction(ctx);
    const { data, usage } = await generateStructuredOutput(OddOneOutBatchSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: `Generate exactly ${count} odd-one-out quiz question(s).`,
      maxOutputTokens: 3000 * count,
      temperature: 0.9
    });

    const valid = data.questions.filter((q) => {
      if (q.groupWords.length !== wrongAnswerCount || q.groupWordExplanations.length !== wrongAnswerCount) return false;
      const oddWordLower = q.oddWord.toLowerCase().trim();
      return !q.groupWords.some((w: string) => {
        const wLower = w.toLowerCase().trim();
        return wLower === oddWordLower || wLower.startsWith(oddWordLower) || oddWordLower.startsWith(wLower);
      });
    });
    logger.info(`[StudyService] Odd-one-out batch: ${valid.length}/${count} valid`);
    return { questions: valid as OddOneOutQuestion[], usage };
  }

  async generateReadingBatch(
    ctx: DifficultyContext,
    opts: BatchGenerateOptions
  ): Promise<BatchResult<ReadingQuestion>> {
    const { count, topic } = opts;
    const wrongAnswerCount = ctx.optionCount - 1;
    logger.info(
      `[StudyService] Batch generating ${count} reading question(s) (engLevel=${ctx.engLevel} topic=${topic})`
    );

    const systemInstruction = buildReadingPrompt(wrongAnswerCount, ctx.engLevel, { count, topic });
    const { data, usage } = await generateStructuredOutput(ReadingBatchSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: `Generate exactly ${count} reading comprehension + mental math quiz question(s).`,
      maxOutputTokens: 4500 * count,
      temperature: 0.85
    });

    const valid = data.questions.filter((q) => {
      q.translation = q.translation.replace(/\n/g, ' ').trim();
      return (
        q.wrongAnswers.length === wrongAnswerCount &&
        !q.wrongAnswers.includes(q.correctAnswer) &&
        new Set(q.wrongAnswers).size === q.wrongAnswers.length
      );
    });
    logger.info(`[StudyService] Reading batch: ${valid.length}/${count} valid`);
    return { questions: valid as ReadingQuestion[], usage };
  }

  async generateParagraphQuestion(
    ctx: DifficultyContext,
    excludeWords?: string[]
  ): Promise<{ question: ParagraphQuestion; usage?: StructuredOutputUsage }> {
    logger.info(`[StudyService] Generating paragraph question (engLevel=${ctx.engLevel})`);

    const wrongAnswerCount = ctx.optionCount - 1;
    const systemInstruction = buildParagraphPrompt(wrongAnswerCount, { excludeWords });

    const { data: object, usage } = await generateStructuredOutput(ParagraphQuestionSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: 'Generate a reading comprehension paragraph quiz question.',
      maxOutputTokens: 3000,
      temperature: 0.85
    });

    logger.info('[StudyService] Paragraph question generated');

    object.translation = object.translation.replace(/\n/g, ' ').trim();

    if (
      object.wrongStatements.length !== wrongAnswerCount ||
      object.wrongStatementExplanations.length !== wrongAnswerCount
    ) {
      throw new Error('[StudyService] Invalid paragraph question format: wrong array counts');
    }

    return { question: object as ParagraphQuestion, usage };
  }

  async generateIdiomQuestion(
    ctx: DifficultyContext,
    excludeWords?: string[]
  ): Promise<{ question: IdiomQuestion; usage?: StructuredOutputUsage }> {
    logger.info(`[StudyService] Generating idiom question (engLevel=${ctx.engLevel})`);

    const wrongAnswerCount = ctx.optionCount - 1;
    const systemInstruction = buildIdiomPrompt(wrongAnswerCount, { excludeWords }) + buildDifficultyInstruction(ctx);

    const { data: object, usage } = await generateStructuredOutput(IdiomQuestionSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: 'Generate an idiom meaning quiz question.',
      maxOutputTokens: 2000,
      temperature: 0.9
    });

    logger.info(`[StudyService] Idiom question generated: "${object.idiom}"`);

    if (object.wrongAnswers.length !== wrongAnswerCount || object.wrongAnswerExplanations.length !== wrongAnswerCount) {
      throw new Error('[StudyService] Invalid idiom question format: wrong array counts');
    }

    return { question: object as IdiomQuestion, usage };
  }

  async generateIdiomBatch(ctx: DifficultyContext, opts: BatchGenerateOptions): Promise<BatchResult<IdiomQuestion>> {
    const { count, topic, excludeWords } = opts;
    const wrongAnswerCount = ctx.optionCount - 1;
    logger.info(`[StudyService] Batch generating ${count} idiom question(s) (engLevel=${ctx.engLevel} topic=${topic})`);

    const systemInstruction =
      buildIdiomPrompt(wrongAnswerCount, { count, topic, excludeWords }) + buildDifficultyInstruction(ctx);
    const { data, usage } = await generateStructuredOutput(IdiomBatchSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: `Generate exactly ${count} idiom meaning quiz question(s).`,
      maxOutputTokens: 2500 * count,
      temperature: 0.9
    });

    const valid = data.questions.filter(
      (q) => q.wrongAnswers.length === wrongAnswerCount && q.wrongAnswerExplanations.length === wrongAnswerCount
    );
    logger.info(`[StudyService] Idiom batch: ${valid.length}/${count} valid`);
    return { questions: valid as IdiomQuestion[], usage };
  }

  async generateParagraphBatch(
    ctx: DifficultyContext,
    opts: BatchGenerateOptions
  ): Promise<BatchResult<ParagraphQuestion>> {
    const { count, topic, excludeWords } = opts;
    const wrongAnswerCount = ctx.optionCount - 1;
    logger.info(
      `[StudyService] Batch generating ${count} paragraph question(s) (engLevel=${ctx.engLevel} topic=${topic})`
    );

    const systemInstruction = buildParagraphPrompt(wrongAnswerCount, { count, topic, excludeWords });
    const { data, usage } = await generateStructuredOutput(ParagraphBatchSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: `Generate exactly ${count} reading comprehension paragraph quiz question(s).`,
      maxOutputTokens: 3500 * count,
      temperature: 0.85
    });

    const valid = data.questions.filter((q) => {
      q.translation = q.translation.replace(/\n/g, ' ').trim();
      return q.wrongStatements.length === wrongAnswerCount && q.wrongStatementExplanations.length === wrongAnswerCount;
    });
    logger.info(`[StudyService] Paragraph batch: ${valid.length}/${count} valid`);
    return { questions: valid as ParagraphQuestion[], usage };
  }

  async generateVerbUseMatchQuestion(
    ctx: DifficultyContext,
    excludeWords?: string[]
  ): Promise<{ question: VerbUseMatchQuestion; usage?: StructuredOutputUsage }> {
    logger.info(`[StudyService] Generating verb-use-match question (engLevel=${ctx.engLevel})`);

    const wrongAnswerCount = ctx.optionCount - 1;
    const systemInstruction =
      buildVerbUseMatchPrompt(wrongAnswerCount, { excludeWords }) + buildDifficultyInstruction(ctx);

    const { data: object, usage } = await generateStructuredOutput(VerbUseMatchQuestionSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: 'Generate a verb collocation quiz question.',
      maxOutputTokens: 2000,
      temperature: 0.85
    });

    logger.info(`[StudyService] Verb-use-match question generated: "${object.targetPhrase}"`);

    if (object.wrongAnswers.length !== wrongAnswerCount || object.wrongAnswerExplanations.length !== wrongAnswerCount) {
      throw new Error('[StudyService] Invalid verb-use-match question format: wrong array counts');
    }

    if (object.format === 'fill-blank' && !object.sentence.includes('___')) {
      throw new Error('[StudyService] Invalid verb-use-match question: fill-blank sentence missing ___');
    }

    return { question: object as VerbUseMatchQuestion, usage };
  }

  async generateVerbUseMatchBatch(
    ctx: DifficultyContext,
    opts: BatchGenerateOptions
  ): Promise<BatchResult<VerbUseMatchQuestion>> {
    const { count, topic, excludeWords } = opts;
    const wrongAnswerCount = ctx.optionCount - 1;
    logger.info(
      `[StudyService] Batch generating ${count} verb-use-match question(s) (engLevel=${ctx.engLevel} topic=${topic})`
    );

    const systemInstruction =
      buildVerbUseMatchPrompt(wrongAnswerCount, { count, topic, excludeWords }) + buildDifficultyInstruction(ctx);
    const { data, usage } = await generateStructuredOutput(VerbUseMatchBatchSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: `Generate exactly ${count} verb collocation quiz question(s).`,
      maxOutputTokens: 2500 * count,
      temperature: 0.85
    });

    const valid = data.questions.filter((q) => {
      if (q.wrongAnswers.length !== wrongAnswerCount || q.wrongAnswerExplanations.length !== wrongAnswerCount)
        return false;
      if (q.format === 'fill-blank' && !q.sentence.includes('___')) return false;
      return true;
    });
    logger.info(`[StudyService] Verb-use-match batch: ${valid.length}/${count} valid`);
    return { questions: valid as VerbUseMatchQuestion[], usage };
  }

  // ─── Reading passage (nội dung thuần, không kèm câu hỏi) ───────────────────

  async generateReadingPassageBatch(
    ctx: ReadingPassageContext,
    opts: ReadingPassageBatchOptions
  ): Promise<{ passages: ReadingPassage[]; usage?: StructuredOutputUsage }> {
    const { count, excludeTitles = [] } = opts;
    logger.info(
      `[StudyService] Batch generating ${count} reading passage(s) (cefrLevel=${ctx.cefrLevel} topic=${ctx.topicName} type=${ctx.type})`
    );

    const systemInstruction =
      ctx.type === 'academic'
        ? buildAcademicReadingPassagePrompt({
            topicName: ctx.topicName,
            cefrLevel: ctx.cefrLevel,
            count,
            excludeTitles
          })
        : buildReadingPassagePrompt({
            topicName: ctx.topicName,
            cefrLevel: ctx.cefrLevel,
            count,
            excludeTitles
          });
    const acceptBand = ctx.type === 'academic' ? ACADEMIC_READING_WORD_ACCEPT : READING_WORD_ACCEPT;

    const { data, usage } = await generateStructuredOutput(ReadingPassageBatchSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: `Write exactly ${count} reading passage(s) about "${ctx.topicName}" at ${ctx.cefrLevel} level.`,
      // Band mới (150-220 từ mọi level) dài hơn hẳn band cũ ở A1/A2 — trần 1200 cũ dễ
      // bị cắt giữa JSON khi batch nhiều bài.
      maxOutputTokens: 1600 * count,
      // Cao hơn các quizType khác: guideline đặt "variety" thành yêu cầu cứng, lặp plot
      // giữa các lần sinh là lỗi chất lượng chứ không phải chuyện nhỏ.
      temperature: 0.95
    });

    const valid = data.passages
      .map((passage) => normalizeReadingPassage(passage, ctx))
      .filter((passage) => isValidReadingPassage(passage, excludeTitles, acceptBand));

    logger.info(`[StudyService] Reading passage batch: ${valid.length}/${count} valid`);
    return { passages: valid, usage };
  }

  // ─── Reading question (câu hỏi sinh từ passage đã lưu) ─────────────────────

  /**
   * Sinh ĐÚNG 1 câu theo type được chỉ định. Trả `null` khi model từ chối (bài không đủ
   * evidence cho type đó) hoặc khi câu trả về không qua validate.
   */
  async generateReadingQuestionOfType(
    ctx: ReadingQuestionContext,
    input: { quizType: ReadingQuestionType; previousQuestions: string[] }
  ): Promise<{ question: ReadingQuestionDraft | null; usage?: StructuredOutputUsage }> {
    const { quizType, previousQuestions } = input;

    const systemInstruction = buildReadingQuestionPrompt({
      quizType,
      title: ctx.title,
      paragraphs: ctx.paragraphs,
      cefrLevel: ctx.cefrLevel,
      topicName: ctx.topicName,
      previousQuestions
    });

    const { data, usage } = await generateStructuredOutput(ReadingQuestionResponseSchema, {
      model: ctx.model,
      provider: ctx.provider,
      instructions: systemInstruction,
      input: `Write exactly one "${quizType}" question about the passage "${ctx.title}" at ${ctx.cefrLevel} level.`,
      maxOutputTokens: 450,
      // Thấp hơn reading passage (0.95) có chủ ý: ở đây cần đúng đáp án và đúng evidence,
      // phần variety đã do bài đọc gánh.
      temperature: 0.7
    });

    const draft = normalizeReadingQuestionDraft(data.question);
    if (!isValidReadingQuestionDraft(draft, quizType, previousQuestions)) {
      logger.warn(`[StudyService] Invalid "${quizType}" draft rejected (passageId=${ctx.passageId})`);
      return { question: null, usage };
    }

    return { question: draft, usage };
  }

  /**
   * Sinh trọn bộ câu hỏi cho 1 bài: server chọn type trước, rồi gọi TUẦN TỰ từng câu.
   *
   * Chạy tuần tự chứ không song song là có chủ ý — mỗi câu nhận các câu trước làm
   * exclusions, đây là cơ chế duy nhất giữ tính độc lập khi mỗi câu là một lần gọi riêng.
   *
   * All-or-nothing: thiếu dù 1 câu là trả mảng rỗng. Guideline mục 2.3 (3 câu độc lập)
   * là thuộc tính của CẢ BỘ — nhận 1-2 câu lẻ là nhận một bộ đã vi phạm spec.
   */
  async generateReadingQuestionSet(
    ctx: ReadingQuestionContext,
    opts: ReadingQuestionBatchOptions
  ): Promise<ReadingQuestionSetResult> {
    const { count, excludeQuestions = [] } = opts;
    const quizTypes = selectQuestionTypes(ctx.cefrLevel, count);

    logger.info(
      `[StudyService] Generating ${count} reading question(s) one-by-one ` +
        `(passageId=${ctx.passageId} cefrLevel=${ctx.cefrLevel} types=${quizTypes.join(',')})`
    );

    const questions: ReadingQuestionDraft[] = [];
    const attempts: ReadingQuestionAttempt[] = [];
    const previousQuestions = [...excludeQuestions];

    for (const quizType of quizTypes) {
      const { question, usage } = await this.generateReadingQuestionOfType(ctx, {
        quizType,
        previousQuestions
      });

      attempts.push({ quizType, ok: question !== null, usage });

      if (!question) {
        logger.warn(`[StudyService] Reading question set rejected: "${quizType}" failed (passageId=${ctx.passageId})`);
        return { questions: [], attempts };
      }

      questions.push(question);
      previousQuestions.push(question.question);
    }

    if (!isValidReadingQuestionSet(questions)) {
      logger.warn(
        `[StudyService] Reading question set rejected: two questions share the same answer (passageId=${ctx.passageId})`
      );
      return { questions: [], attempts };
    }

    logger.info(`[StudyService] Reading question set ok: ${questions.map((q) => q.quizType).join(', ')}`);
    return { questions: spreadCorrectAnswers(questions), attempts };
  }

  // ─── Dispatch & Context ────────────────────────────────────────────────────

  /**
   * Build DifficultyContext cho một lần sinh câu hỏi. Không truyền model → chọn
   * tự động theo context (mặc định 'schedule', vì đây là đường serving tự động);
   * show5050 mặc định true.
   */
  async buildContext(input: {
    engLevel: EngLevel;
    optionCount: 3 | 4 | 5;
    topicName?: string | null;
    model?: string;
    context?: ModelContext;
  }): Promise<DifficultyContext> {
    const resolved = await resolveStudyModel(input.context ?? 'schedule', input.model);
    return {
      engLevel: input.engLevel,
      optionCount: input.optionCount,
      show5050: true,
      model: resolved.model,
      provider: resolved.provider,
      topicName: input.topicName ?? null
    };
  }

  /** Như buildContext nhưng cho reading passage — luôn resolve model theo context 'reading'. */
  async buildReadingPassageContext(input: {
    cefrLevel: EngLevel;
    topicName: string;
    type: ReadingPassageType;
    model?: string;
  }): Promise<ReadingPassageContext> {
    const resolved = await resolveStudyModel('reading', input.model);
    return {
      cefrLevel: input.cefrLevel,
      topicName: input.topicName,
      type: input.type,
      model: resolved.model,
      provider: resolved.provider
    };
  }

  /**
   * Như buildReadingPassageContext nhưng cho câu hỏi đọc hiểu — dùng chung model context
   * 'reading'. Nhận thẳng record passage thay vì passageId để study.service không phải
   * chạm DB (cả file này đang thuần LLM).
   */
  async buildReadingQuestionContext(input: {
    passage: { id: number; title: string; paragraphs: string[]; cefrLevel: string; topicName: string | null };
    model?: string;
  }): Promise<ReadingQuestionContext> {
    const resolved = await resolveStudyModel('reading', input.model);
    return {
      passageId: input.passage.id,
      title: input.passage.title,
      paragraphs: input.passage.paragraphs,
      cefrLevel: input.passage.cefrLevel as EngLevel,
      topicName: input.passage.topicName ?? '',
      model: resolved.model,
      provider: resolved.provider
    };
  }

  /**
   * Dispatch quizType → method sinh câu hỏi (single) tương ứng.
   * `vocab` dùng generateQuestion; các loại còn lại theo tên generateXQuestion.
   * `reading` không nằm ở đây — dùng generateReadingQuestion trực tiếp.
   */
  async generateByType(quizType: QuizType, ctx: DifficultyContext, excludeWords?: string[]) {
    switch (quizType) {
      case 'vocab':
        return this.generateQuestion(ctx, excludeWords);
      case 'fillblank':
        return this.generateFillBlankQuestion(ctx, excludeWords);
      case 'phrase':
        return this.generatePhraseQuestion(ctx, excludeWords);
      case 'conversation':
        return this.generateConversationQuestion(ctx, excludeWords);
      case 'description':
        return this.generateDescriptionQuestion(ctx, excludeWords);
      case 'synonym':
        return this.generateSynonymQuestion(ctx, excludeWords);
      case 'slang':
        return this.generateSlangQuestion(ctx, excludeWords);
      case 'odd-one-out':
        return this.generateOddOneOutQuestion(ctx, excludeWords);
      case 'paragraph':
        return this.generateParagraphQuestion(ctx, excludeWords);
      case 'idiom':
        return this.generateIdiomQuestion(ctx, excludeWords);
      case 'verb-use-match':
        return this.generateVerbUseMatchQuestion(ctx, excludeWords);
      default:
        throw new BusinessLogicException(`Unsupported quizType: ${quizType}`);
    }
  }
}

export default new StudyService();
