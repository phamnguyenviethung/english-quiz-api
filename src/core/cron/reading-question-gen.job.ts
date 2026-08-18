import { FlowProducer, Queue, Worker } from 'bullmq';
import { bullmqConnection, TIMEZONE } from './cron.config';
import logger from '@/configs/logger.config';
import { pickStudyModelForContext, type ResolvedStudyModel } from '@/configs/aiClient.config';
import type { ProviderPreferencesJson } from '@/core/db/schema/main';
import aiModelService, { computeCostUsd } from '@/core/services/ai/aiModel.service';
import studyService from '@/core/services/english/study.service';
import readingPassageService from '@/core/services/english/readingPassage.service';
import readingQuestionService, {
  getPerPassageGenerationCap,
  getQuestionsPerPassage,
  type InsertReadingQuestionInput
} from '@/core/services/english/readingQuestion.service';
import readingQuestionRefillService, {
  readingQuestionBucketKeyOf,
  READING_QUESTION_REFILL_CHILD_QUEUE,
  READING_QUESTION_REFILL_PARENT_QUEUE
} from '@/core/services/english/readingQuestionRefill.service';
import { getEnglishConfigSnapshot, onEnglishConfigChanged } from '@/core/services/english/englishConfig.service';
import englishCronJobTrackingService, {
  normalizeError,
  type EnglishCronJobErrorPhase,
  type EnglishCronRunRef
} from '@/core/services/english/englishCronJobTracking.service';
import type { EngLevel } from '@/core/services/english/questionTypes';

const LOG_TAG = 'ReadingQuestionRefill';

// english_cron_job_buckets yêu cầu quizType notNull. Một bucket ở đây chứa 3 câu thuộc
// nhiều quizType khác nhau nên dùng sentinel. optionCount thì là giá trị THẬT (4), khác
// reading passage phải ghi 0 vì bài đọc không có khái niệm đáp án.
const READING_QUESTION_TRACKING_QUIZ_TYPE = 'reading-question';
const READING_QUESTION_TRACKING_OPTION_COUNT = 4;

export interface ReadingQuestionGenJobData {
  passageId: number;
  cefrLevel: EngLevel;
  topicId: number | null;
  topicName: string | null;
  count: number;
  trackingRunId?: string;
}

export let readingQuestionRefillQueue: Queue;
export let readingQuestionRefillChildQueue: Queue;
export let readingQuestionRefillParentWorker: Worker;
export let readingQuestionRefillChildWorker: Worker<ReadingQuestionGenJobData>;
export let readingQuestionRefillFlowProducer: FlowProducer;

export interface FillReadingQuestionBucketParams {
  passageId: number;
  cefrLevel: EngLevel;
  topicId: number | null;
  topicName: string | null;
  count: number;
  logTag?: string;
  model?: string;
  provider?: ProviderPreferencesJson;
  skipCountCheck?: boolean;
  trackingRun?: EnglishCronRunRef | null;
  trackingMetadata?: Record<string, unknown>;
}

export interface FillReadingQuestionBucketResult {
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

function emptyResult(status: 'skipped', requested: number): FillReadingQuestionBucketResult {
  return {
    status,
    requested,
    generated: 0,
    inserted: 0,
    skipped: requested,
    tokenIn: 0,
    tokenOut: 0,
    costUsd: null
  };
}

/**
 * Sinh + lưu câu hỏi đọc hiểu cho đúng 1 bài đọc, có tracking đầy đủ.
 * Song song với fillReadingBucketDetailed, nhưng bucket là 1 passage.
 */
export async function fillReadingQuestionBucketDetailed(
  params: FillReadingQuestionBucketParams
): Promise<FillReadingQuestionBucketResult> {
  const {
    passageId,
    cefrLevel,
    topicId,
    topicName,
    logTag = LOG_TAG,
    model,
    provider,
    skipCountCheck = false,
    trackingRun = null,
    trackingMetadata
  } = params;
  const requestedCount = Math.max(1, params.count);
  const bucket = await englishCronJobTrackingService.startBucket(trackingRun, {
    engLevel: cefrLevel,
    quizType: READING_QUESTION_TRACKING_QUIZ_TYPE,
    optionCount: READING_QUESTION_TRACKING_OPTION_COUNT,
    topicId,
    topicName,
    requestedCount,
    bucketKey: readingQuestionBucketKeyOf(passageId),
    metadata: { ...trackingMetadata, passageId }
  });
  let phase: EnglishCronJobErrorPhase = 'reading_question_count';
  let batchCount = requestedCount;

  const skip = async (reason: string): Promise<FillReadingQuestionBucketResult> => {
    logger.warn(`[${logTag}] ${reason} passageId=${passageId}, skipping`);
    await englishCronJobTrackingService.finishBucket(bucket, {
      status: 'skipped',
      requestedCount,
      generatedCount: 0,
      insertedCount: 0,
      skippedCount: requestedCount,
      tokenIn: 0,
      tokenOut: 0
    });
    return emptyResult('skipped', requestedCount);
  };

  try {
    phase = 'reading_question_count';
    const questionsPerPassage = getQuestionsPerPassage();

    if (!skipCountCheck) {
      const currentCount = await readingQuestionService.getCountByPassage(passageId);
      const needed = questionsPerPassage - currentCount;
      if (needed <= 0) {
        return await skip(`Passage already has its questions (${currentCount}/${questionsPerPassage})`);
      }
      batchCount = Math.min(Math.min(requestedCount, getPerPassageGenerationCap()), needed);
    }

    const passage = await readingPassageService.getById(passageId);
    if (!passage) return await skip('Passage no longer exists');
    if (!passage.isActive) return await skip('Passage is inactive');
    if (!passage.topicName) return await skip('Passage has no topic name (prompt needs it)');

    // Chỉ khác rỗng khi top-up (admin xoá bớt câu) — lần sinh đầu luôn rỗng.
    const excludeQuestions = await readingQuestionService.getExistingQuestionTexts(passageId);

    const resolved: ResolvedStudyModel = model ? { model, provider } : await pickStudyModelForContext('reading');

    logger.info(
      `[${logTag}] Generating batch passageId=${passageId} cefrLevel=${cefrLevel} count=${batchCount} model=${resolved.model}`
    );

    phase = 'generate_model';
    const attemptStartedAt = new Date();
    let questions;
    let attempts;
    try {
      const result = await studyService.generateReadingQuestionSet(
        {
          passageId,
          title: passage.title,
          paragraphs: passage.paragraphs,
          cefrLevel,
          topicName: passage.topicName,
          model: resolved.model,
          provider: resolved.provider
        },
        { count: batchCount, excludeQuestions }
      );
      questions = result.questions;
      attempts = result.attempts;
    } catch (err) {
      await englishCronJobTrackingService.recordModelAttempt({
        run: trackingRun,
        bucket,
        model: resolved.model,
        attemptOrder: 1,
        status: 'failed',
        requestedCount: batchCount,
        startedAt: attemptStartedAt,
        error: err
      });
      await readingPassageService.incrementQuestionGenAttempts(passageId);
      throw err;
    }

    // Mỗi câu là một lần gọi LLM riêng nên ghi thành nhiều model attempt, không gộp làm
    // một — nhờ vậy /english/cron/usage biết được type nào tốn token và type nào hay hỏng.
    const aiModel = await aiModelService.getModelByModelId(resolved.model);
    let tokenIn = 0;
    let tokenOut = 0;
    let costUsd: number | null = null;

    for (const [index, attempt] of attempts.entries()) {
      const attemptTokenIn = attempt.usage?.inputTokens ?? 0;
      const attemptTokenOut = attempt.usage?.outputTokens ?? 0;
      const attemptCost = computeCostUsd(aiModel, attemptTokenIn, attemptTokenOut);

      tokenIn += attemptTokenIn;
      tokenOut += attemptTokenOut;
      if (attemptCost !== null) costUsd = (costUsd ?? 0) + attemptCost;

      await englishCronJobTrackingService.recordModelAttempt({
        run: trackingRun,
        bucket,
        model: resolved.model,
        attemptOrder: index + 1,
        status: attempt.ok ? 'success' : 'failed',
        requestedCount: 1,
        generatedCount: attempt.ok ? 1 : 0,
        tokenIn: attemptTokenIn,
        tokenOut: attemptTokenOut,
        costUsd: attemptCost,
        startedAt: attemptStartedAt,
        ...(attempt.ok ? {} : { error: new Error(`Model không sinh được câu hỏi loại "${attempt.quizType}"`) })
      });
    }

    // Batch rỗng = generateReadingQuestionBatch đã reject cả bộ (all-or-nothing). Đây
    // chính là ca "bài này model không sinh nổi đủ câu" mà bộ đếm sinh ra để chặn.
    if (questions.length === 0) {
      await readingPassageService.incrementQuestionGenAttempts(passageId);
      logger.warn(`[${logTag}] Model returned no valid question set passageId=${passageId}, skipping`);
      await englishCronJobTrackingService.finishBucket(bucket, {
        status: 'skipped',
        requestedCount: batchCount,
        generatedCount: 0,
        insertedCount: 0,
        skippedCount: batchCount,
        tokenIn,
        tokenOut,
        costUsd
      });
      return { ...emptyResult('skipped', batchCount), tokenIn, tokenOut, costUsd, model: resolved.model };
    }

    const rows: InsertReadingQuestionInput[] = questions.map((question): InsertReadingQuestionInput => ({
      passageRefId: passageId,
      quizType: question.quizType,
      question: question.question,
      options: question.options,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      cefrLevel,
      topicId: passage.topicId,
      topicName: passage.topicName,
      model: resolved.model,
      tokenIn,
      tokenOut
    }));

    phase = 'insert_reading_questions';
    const inserted = await readingQuestionService.insertQuestions(rows);
    const skipped = Math.max(0, rows.length - inserted);
    if (inserted > 0) await readingPassageService.resetQuestionGenAttempts(passageId);

    await englishCronJobTrackingService.finishBucket(bucket, {
      status: 'success',
      requestedCount: batchCount,
      generatedCount: rows.length,
      insertedCount: inserted,
      skippedCount: skipped,
      tokenIn,
      tokenOut,
      costUsd
    });
    logger.info(
      `[${logTag}] Batch done passageId=${passageId} generated=${rows.length}/${batchCount} inserted=${inserted}`
    );

    return {
      status: 'success',
      requested: batchCount,
      generated: rows.length,
      inserted,
      skipped,
      tokenIn,
      tokenOut,
      costUsd,
      model: resolved.model
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
      `[${logTag}] Bucket failed runId=${trackingRun?.runId ?? '-'} bucketId=${bucket?.id ?? '-'} passageId=${passageId} phase=${phase}: ${normalized.message}`
    );
    throw err;
  }
}

/** Đồng bộ BullMQ job schedulers với `reading_question_refill_schedule.items` hiện tại. */
export async function reconcileReadingQuestionRefillSchedulers(): Promise<void> {
  const desired = getEnglishConfigSnapshot().reading_question_refill_schedule;
  const desiredByName = new Map(desired.map((s) => [s.name, s.cron]));

  const existing = await readingQuestionRefillQueue.getJobSchedulers();
  for (const scheduler of existing) {
    if (!desiredByName.has(scheduler.key)) {
      await readingQuestionRefillQueue.removeJobScheduler(scheduler.key);
      logger.info(`[${LOG_TAG}] Removed stale scheduler: ${scheduler.key}`);
    }
  }

  for (const [name, cron] of desiredByName) {
    await readingQuestionRefillQueue.upsertJobScheduler(
      name,
      { pattern: cron, tz: TIMEZONE },
      { opts: { removeOnComplete: true, removeOnFail: true } }
    );
  }

  logger.info(`[${LOG_TAG}] Reconciled schedulers: ${[...desiredByName.keys()].join(', ') || '(none)'}`);
}

function createChildWorker(): Worker<ReadingQuestionGenJobData> {
  return new Worker<ReadingQuestionGenJobData>(
    READING_QUESTION_REFILL_CHILD_QUEUE,
    async (job) => {
      const { passageId, cefrLevel, topicId, topicName, count } = job.data;
      const trackingRun = await englishCronJobTrackingService.getRunRefByRunId(job.data.trackingRunId);
      const { model, provider } = await pickStudyModelForContext('reading');
      logger.info(`[${LOG_TAG}] Child processing: passageId=${passageId} count=${count} model=${model}`);
      await fillReadingQuestionBucketDetailed({
        passageId,
        cefrLevel,
        topicId,
        topicName,
        count,
        model,
        provider,
        logTag: LOG_TAG,
        trackingRun,
        trackingMetadata: {
          source: 'reading_question_refill_child',
          queueName: READING_QUESTION_REFILL_CHILD_QUEUE,
          bullJobId: String(job.id ?? ''),
          attempt: job.attemptsMade + 1,
          model
        }
      });
      await englishCronJobTrackingService.finalizeRunIfBucketsComplete(job.data.trackingRunId);
    },
    {
      connection: bullmqConnection,
      concurrency: 2
    }
  );
}

function createParentWorker(flowProducer: FlowProducer): Worker {
  return new Worker(
    READING_QUESTION_REFILL_PARENT_QUEUE,
    async (job) => {
      if (job.name.startsWith('reading-question-refill-scan')) {
        const run = await englishCronJobTrackingService.getRunRefByRunId(
          (job.data as { trackingRunId?: string }).trackingRunId
        );
        await englishCronJobTrackingService.summarizeRun(run, { forceFinishRunningBuckets: true });
        logger.info(`[${LOG_TAG}] Parent scan job completed — children are processed`);
        return;
      }
      if (!getEnglishConfigSnapshot().job_flags.readingQuestionRefillEnabled) {
        logger.info(`[${LOG_TAG}] Reading-question-refill disabled, skipping run for trigger: ${job.name}`);
        return;
      }
      logger.info(`[${LOG_TAG}] Scheduled trigger: ${job.name}, starting scan...`);
      const result = await readingQuestionRefillService.runScheduledReadingQuestionRefill(flowProducer, {
        bullJobId: String(job.id ?? ''),
        bullJobName: job.name
      });
      logger.info(
        `[${LOG_TAG}] Scan finished: ${result.deficientBuckets}/${result.totalBuckets} passages need questions`
      );
    },
    {
      connection: bullmqConnection,
      concurrency: 1
    }
  );
}

export default async function readingQuestionGenJob(): Promise<void> {
  readingQuestionRefillQueue = new Queue(READING_QUESTION_REFILL_PARENT_QUEUE, {
    connection: bullmqConnection,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: 10
    }
  });

  readingQuestionRefillChildQueue = new Queue(READING_QUESTION_REFILL_CHILD_QUEUE, {
    connection: bullmqConnection
  });

  readingQuestionRefillFlowProducer = new FlowProducer({ connection: bullmqConnection });

  await reconcileReadingQuestionRefillSchedulers();
  onEnglishConfigChanged('reading_question_refill_schedule.items', () => reconcileReadingQuestionRefillSchedulers());

  readingQuestionRefillParentWorker = createParentWorker(readingQuestionRefillFlowProducer);
  readingQuestionRefillChildWorker = createChildWorker();

  readingQuestionRefillParentWorker.on('failed', (job, err) => {
    logger.error(`[${LOG_TAG}] Parent job ${job?.id} (${job?.name}) failed: ${err.message}`);
  });

  readingQuestionRefillParentWorker.on('completed', (job) => {
    logger.info(`[${LOG_TAG}] Parent job ${job.id} (${job.name}) completed`);
  });

  readingQuestionRefillChildWorker.on('failed', (job, err) => {
    logger.error(`[${LOG_TAG}] Child job ${job?.id} failed passageId=${job?.data.passageId}: ${err.message}`);
    void englishCronJobTrackingService.finalizeRunIfBucketsComplete(job?.data.trackingRunId);
  });

  readingQuestionRefillChildWorker.on('completed', (job) => {
    logger.info(`[${LOG_TAG}] Child job ${job.id} completed passageId=${job.data.passageId}`);
    void englishCronJobTrackingService.finalizeRunIfBucketsComplete(job.data.trackingRunId);
  });

  logger.info(`[${LOG_TAG}] Queue, workers, and schedulers initialized`);
}
