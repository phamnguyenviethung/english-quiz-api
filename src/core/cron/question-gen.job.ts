import { Queue, Worker } from 'bullmq';
import { bullmqConnection } from './cron.config';
import studyService, { type BatchGenerateOptions, type DifficultyContext } from '@/core/services/english/study.service';
import questionPoolService, {
  type PushQuestionInput,
  bucketKeyOf,
  getMaxPoolSize,
  getPerBucketGenerationCap,
  pickQuizType
} from '@/core/services/english/questionPool.service';
import { BEGINNER_MAX_OPTION_COUNT, isBeginnerLevel, type QuizType } from '@/core/services/english/questionTypes';
import { pickStudyModelForContext } from '@/configs/aiClient.config';
import aiModelService, { computeCostUsd } from '@/core/services/ai/aiModel.service';
import type { ProviderPreferencesJson } from '@/core/db/schema/main';
import logger from '@/configs/logger.config';
import englishCronJobTrackingService, {
  normalizeError,
  type EnglishCronBucketRef,
  type EnglishCronJobErrorPhase,
  type EnglishCronRunRef
} from '@/core/services/english/englishCronJobTracking.service';
import topicService from '@/core/services/english/topic.service';

const QUEUE_NAME = 'english-question-gen';

export interface QuestionGenJobData {
  engLevel: DifficultyContext['engLevel'];
  quizType: QuizType;
  optionCount: 4 | 5;
  topicId: number | null;
  topicName: string | null;
  // Job cũ trong queue (trước khi có beginner) không có field này → coi như bucket thường.
  forBeginner?: boolean;
  count: number;
  trackingRunId?: string;
}

export let questionGenQueue: Queue<QuestionGenJobData>;
export let questionGenWorker: Worker<QuestionGenJobData>;

export function getQuestionGenQueue(): Queue<QuestionGenJobData> {
  if (!questionGenQueue) throw new Error('[QuestionGenJob] Queue not initialized yet');
  return questionGenQueue;
}

export interface BatchGenResult {
  items: Array<{ questionData: string; model: string; tokenIn: number; tokenOut: number }>;
  model: string;
  tokenIn: number;
  tokenOut: number;
  costUsd: number | null;
}

interface BatchTrackingContext {
  run: EnglishCronRunRef | null;
  bucket: EnglishCronBucketRef | null;
}

export async function generateBatch(
  quizType: QuizType,
  ctx: DifficultyContext,
  opts: BatchGenerateOptions,
  tracking?: BatchTrackingContext
): Promise<BatchGenResult> {
  const model = ctx.model;
  const attemptStartedAt = new Date();
  try {
    const result = await generateBatchByType(quizType, ctx, opts);
    const tokenIn = result.usage?.inputTokens ?? 0;
    const tokenOut = result.usage?.outputTokens ?? 0;
    const costUsd = computeCostUsd(await aiModelService.getModelByModelId(model), tokenIn, tokenOut);
    await englishCronJobTrackingService.recordModelAttempt({
      run: tracking?.run ?? null,
      bucket: tracking?.bucket ?? null,
      model,
      attemptOrder: 1,
      status: 'success',
      requestedCount: opts.count,
      generatedCount: result.questions.length,
      tokenIn,
      tokenOut,
      costUsd,
      startedAt: attemptStartedAt
    });
    return {
      items: result.questions.map((q) => ({
        questionData: JSON.stringify(q),
        model,
        tokenIn,
        tokenOut
      })),
      model,
      tokenIn,
      tokenOut,
      costUsd
    };
  } catch (err) {
    await englishCronJobTrackingService.recordModelAttempt({
      run: tracking?.run ?? null,
      bucket: tracking?.bucket ?? null,
      model,
      attemptOrder: 1,
      status: 'failed',
      requestedCount: opts.count,
      startedAt: attemptStartedAt,
      error: err
    });
    logger.warn(`[QuestionGenJob] Batch failed quizType=${quizType} model=${model} count=${opts.count} err=${err}`);
    throw err;
  }
}

type BatchGenerateResult = {
  questions: unknown[];
  usage?: import('@/configs/aiClient.config').StructuredOutputUsage;
};

async function generateBatchByType(
  quizType: QuizType,
  ctx: DifficultyContext,
  opts: BatchGenerateOptions
): Promise<BatchGenerateResult> {
  switch (quizType) {
    case 'vocab':
      return studyService.generateVocabBatch(ctx, opts);
    case 'fillblank':
      return studyService.generateFillBlankBatch(ctx, opts);
    case 'phrase':
      return studyService.generatePhraseBatch(ctx, opts);
    case 'conversation':
      return studyService.generateConversationBatch(ctx, opts);
    case 'description':
      return studyService.generateDescriptionBatch(ctx, opts);
    case 'synonym':
      return studyService.generateSynonymBatch(ctx, opts);
    case 'slang':
      return studyService.generateSlangBatch(ctx, opts);
    case 'odd-one-out':
      return studyService.generateOddOneOutBatch(ctx, opts);
    case 'paragraph':
      return studyService.generateParagraphBatch(ctx, opts);
    case 'idiom':
      return studyService.generateIdiomBatch(ctx, opts);
    case 'verb-use-match':
      return studyService.generateVerbUseMatchBatch(ctx, opts);
  }
}

export interface FillBucketParams {
  engLevel: DifficultyContext['engLevel'];
  quizType: QuizType;
  optionCount: 4 | 5;
  topicId: number | null;
  topicName: string | null;
  forBeginner?: boolean;
  count: number;
  logTag?: string;
  model?: string;
  provider?: ProviderPreferencesJson;
  skipPoolCheck?: boolean;
  trackingRun?: EnglishCronRunRef | null;
  trackingMetadata?: Record<string, unknown>;
}

export interface FillBucketDetailedResult {
  status: 'success' | 'skipped';
  requested: number;
  generated: number;
  inserted: number;
  skipped: number;
  tokenIn: number;
  tokenOut: number;
  costUsd: number | null;
  model?: string;
}

export async function fillBucketDetailed(params: FillBucketParams): Promise<FillBucketDetailedResult> {
  const {
    engLevel,
    quizType,
    optionCount,
    topicId,
    topicName,
    forBeginner = false,
    logTag = 'QuestionGen',
    model,
    provider,
    skipPoolCheck = false,
    trackingRun = null,
    trackingMetadata
  } = params;
  const requestedCount = Math.max(1, params.count);
  const bucket = await englishCronJobTrackingService.startBucket(trackingRun, {
    engLevel,
    quizType,
    optionCount,
    topicId,
    topicName,
    requestedCount,
    metadata: forBeginner ? { ...trackingMetadata, forBeginner } : trackingMetadata,
    bucketKey: bucketKeyOf({ engLevel, topicId, quizType, forBeginner })
  });
  const skipBucket = async (): Promise<FillBucketDetailedResult> => {
    await englishCronJobTrackingService.finishBucket(bucket, {
      status: 'skipped',
      requestedCount,
      generatedCount: 0,
      insertedCount: 0,
      skippedCount: requestedCount,
      tokenIn: 0,
      tokenOut: 0
    });
    return {
      status: 'skipped',
      requested: requestedCount,
      generated: 0,
      inserted: 0,
      skipped: requestedCount,
      tokenIn: 0,
      tokenOut: 0,
      costUsd: null
    };
  };
  let phase: EnglishCronJobErrorPhase = 'pool_count';
  let batchCount = requestedCount;

  try {
    if (!skipPoolCheck) {
      phase = 'pool_count';
      const currentCount = await questionPoolService.getPoolCount(engLevel, quizType, topicId, forBeginner);
      const maxPool = getMaxPoolSize();
      const needed = maxPool - currentCount;
      if (needed <= 0) {
        logger.info(
          `[${logTag}] Bucket already full (${currentCount}/${maxPool}) engLevel=${engLevel} topicId=${topicId} quizType=${quizType} forBeginner=${forBeginner}, skipping`
        );
        return await skipBucket();
      }
      batchCount = Math.min(Math.min(requestedCount, getPerBucketGenerationCap()), needed);
    }

    if (topicId !== null) {
      const topic = await topicService.getTopicById(topicId);
      if (!topic || !topic.isActive) {
        logger.warn(
          `[${logTag}] Topic ${topicId} no longer exists/inactive, skipping bucket engLevel=${engLevel} quizType=${quizType}`
        );
        return await skipBucket();
      }
      // Admin có thể tắt cờ beginner của topic giữa lúc scan và lúc job chạy.
      if (forBeginner && !topic.forBeginner) {
        logger.warn(
          `[${logTag}] Topic ${topicId} is no longer marked for beginner, skipping beginner bucket engLevel=${engLevel} quizType=${quizType}`
        );
        return await skipBucket();
      }
    }

    if (forBeginner && (!isBeginnerLevel(engLevel) || optionCount > BEGINNER_MAX_OPTION_COUNT)) {
      logger.warn(
        `[${logTag}] Invalid beginner bucket engLevel=${engLevel} optionCount=${optionCount} quizType=${quizType}, skipping`
      );
      return await skipBucket();
    }

    // Không chỉ định model (đường on-demand backstop) → dùng đúng pool model của
    // context 'schedule' như cron refill, thay vì ghim cứng 1 model rẻ.
    const resolved = model ? { model, provider } : await pickStudyModelForContext('schedule');
    const ctx: DifficultyContext = {
      engLevel,
      optionCount,
      show5050: true,
      model: resolved.model,
      provider: resolved.provider,
      forBeginner
    };
    const batchOpts: BatchGenerateOptions = { count: batchCount, topic: topicName ?? undefined };
    logger.info(
      `[${logTag}] Generating batch engLevel=${engLevel} topicId=${topicId} topicName=${topicName} quizType=${quizType} forBeginner=${forBeginner} count=${batchCount}`
    );
    phase = 'generate_model';
    const result = await generateBatch(quizType, ctx, batchOpts, {
      run: trackingRun,
      bucket
    });
    const generated: PushQuestionInput[] = result.items.map((item) => ({
      quizType,
      engLevel,
      optionCount,
      topicId,
      forBeginner,
      ...item
    }));
    phase = 'push_questions';
    const inserted = generated.length > 0 ? await questionPoolService.pushQuestions(generated) : 0;
    const skipped = Math.max(0, generated.length - inserted);
    await englishCronJobTrackingService.finishBucket(bucket, {
      status: 'success',
      requestedCount: batchCount,
      generatedCount: generated.length,
      insertedCount: inserted,
      skippedCount: skipped,
      tokenIn: result.tokenIn,
      tokenOut: result.tokenOut,
      costUsd: result.costUsd
    });
    logger.info(
      `[${logTag}] Batch done quizType=${quizType} generated=${generated.length}/${batchCount} inserted=${inserted}`
    );
    return {
      status: 'success',
      requested: batchCount,
      generated: generated.length,
      inserted,
      skipped,
      tokenIn: result.tokenIn,
      tokenOut: result.tokenOut,
      costUsd: result.costUsd,
      model: result.model
    };
  } catch (err) {
    const normalized = normalizeError(err);
    await englishCronJobTrackingService.finishBucket(bucket, {
      status: 'failed',
      requestedCount: batchCount,
      generatedCount: 0,
      insertedCount: 0,
      skippedCount: 0,
      tokenIn: 0,
      tokenOut: 0,
      errorPhase: phase,
      error: err
    });
    logger.error(
      `[${logTag}] Bucket failed runId=${trackingRun?.runId ?? '-'} bucketId=${bucket?.id ?? '-'} engLevel=${engLevel} topicId=${topicId} quizType=${quizType} phase=${phase}: ${normalized.message}`
    );
    throw err;
  }
}

export async function fillBucket(params: FillBucketParams): Promise<number> {
  const result = await fillBucketDetailed(params);
  return result.inserted;
}

export async function processQuestionGenJob(
  data: QuestionGenJobData,
  trackingRun: EnglishCronRunRef | null
): Promise<void> {
  const { engLevel, optionCount, topicId, topicName } = data;
  const forBeginner = data.forBeginner ?? false;
  const consumedType: QuizType = data.quizType ?? pickQuizType({ forBeginner });
  // Không đụng tới lock `question-pool:lock:*`: lock đó thuộc luồng sibling, job này không giữ
  // nó. Chống vượt maxPerBucket đã có pushQuestions re-check trong transaction.
  const filled = await fillBucket({
    engLevel,
    quizType: consumedType,
    optionCount,
    topicId,
    topicName,
    forBeginner,
    count: data.count,
    logTag: 'QuestionGenJob',
    trackingRun,
    trackingMetadata: {
      source: 'question_gen',
      bullTrackingRunId: data.trackingRunId
    }
  });
  const currentCount = await questionPoolService.getPoolCount(engLevel, consumedType, topicId, forBeginner);
  const maxPool = getMaxPoolSize();
  if (currentCount < maxPool && filled > 0) {
    const remaining = Math.min(maxPool - currentCount, 2);
    const quizType2 = pickQuizType({ forBeginner });
    logger.info(`[QuestionGenJob] Filling remaining ${remaining} with quizType=${quizType2}`);
    try {
      await fillBucket({
        engLevel,
        quizType: quizType2,
        optionCount,
        topicId,
        topicName,
        forBeginner,
        count: remaining,
        logTag: 'QuestionGenJob',
        trackingRun,
        trackingMetadata: {
          source: 'question_gen_supplemental',
          originalQuizType: consumedType
        }
      });
    } catch (err) {
      logger.warn(`[QuestionGenJob] Supplemental batch failed quizType=${quizType2}: ${err}`);
    }
  }
}

function createQuestionGenWorker(): Worker<QuestionGenJobData> {
  return new Worker<QuestionGenJobData>(
    QUEUE_NAME,
    async (job) => {
      logger.info(
        `[QuestionGenJob] Processing job id=${job.id} engLevel=${job.data.engLevel} topicId=${job.data.topicId} quizType=${job.data.quizType} count=${job.data.count}`
      );
      const run = await englishCronJobTrackingService.startRun({
        jobKey: 'question_gen',
        trigger: 'bullmq',
        queueName: QUEUE_NAME,
        bullJobId: String(job.id ?? ''),
        bullJobName: job.name,
        totalBuckets: 1,
        deficientBuckets: 1,
        metadata: {
          attempt: job.attemptsMade + 1,
          data: job.data
        }
      });
      try {
        await processQuestionGenJob(job.data, run);
        await englishCronJobTrackingService.summarizeRun(run);
      } catch (err) {
        await englishCronJobTrackingService.finishRun(run, {
          status: 'failed',
          errorPhase: 'unknown',
          error: err
        });
        throw err;
      }
    },
    {
      connection: bullmqConnection,
      concurrency: 2
    }
  );
}

export default async function questionGenJob(): Promise<void> {
  questionGenQueue = new Queue<QuestionGenJobData>(QUEUE_NAME, {
    connection: bullmqConnection,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: 100
    }
  });

  questionGenWorker = createQuestionGenWorker();

  questionGenWorker.on('failed', (job, err) => {
    logger.error(
      `[QuestionGenJob] Job ${job?.id} failed engLevel=${job?.data.engLevel} topicId=${job?.data.topicId} quizType=${job?.data.quizType}: ${err.message}`
    );
  });

  questionGenWorker.on('completed', (job) => {
    logger.info(
      `[QuestionGenJob] Job ${job.id} completed engLevel=${job.data.engLevel} topicId=${job.data.topicId} quizType=${job.data.quizType}`
    );
  });

  logger.info('[QuestionGenJob] Queue and worker initialized');
}
