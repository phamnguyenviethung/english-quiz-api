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
import { buildParagraphPrompt, type ParagraphQuestion } from './prompt/paragraph-prompt';
import { buildPhrasePrompt, type PhraseQuestion } from './prompt/phrase-prompt';
import { buildSlangPrompt, type SlangQuestion } from './prompt/slang-prompt';
import { buildSynonymPrompt, type SynonymQuestion } from './prompt/synonym-prompt';
import { buildVocabPrompt, type DifficultyContext, type VocabQuestion } from './prompt/vocab-prompt';
import { buildIdiomPrompt, type IdiomQuestion } from './prompt/idiom-prompt';
import { buildVerbUseMatchPrompt, type VerbUseMatchQuestion } from './prompt/verb-use-match-prompt';
import { type EngLevel, type QuizType } from './questionTypes';
import { BusinessLogicException } from '@/core/exceptions';

export type {
  ConversationQuestion,
  DescriptionQuestion,
  DifficultyContext,
  FillBlankQuestion,
  IdiomQuestion,
  OddOneOutQuestion,
  ParagraphQuestion,
  PhraseQuestion,
  ReadingQuestion,
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

interface BatchResult<T> {
  questions: T[];
  usage?: StructuredOutputUsage;
}

function normalizeTextForLeakCheck(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

function normalizeTextForHeuristic(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function descriptionLeaksAnswer(description: string, correctAnswer: string): boolean {
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

const DESCRIPTION_TRANSLATION_LEAKS: Record<string, string[]> = {
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

function descriptionLeaksKnownTranslation(description: string, correctAnswer: string): boolean {
  const normalizedDescription = ` ${normalizeTextForHeuristic(description)} `;
  const normalizedAnswer = normalizeTextForLeakCheck(correctAnswer);
  const forbiddenTerms = DESCRIPTION_TRANSLATION_LEAKS[normalizedAnswer] ?? [];
  return forbiddenTerms.some((term) => normalizedDescription.includes(` ${normalizeTextForHeuristic(term)} `));
}

function hasAnyPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

function looksLikeDefinitionOrQuestion(description: string): boolean {
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

function isVagueSubjectiveDescription(description: string): boolean {
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

function isValidDescriptionQuestion(
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
