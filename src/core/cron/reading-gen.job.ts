import { FlowProducer, Queue, Worker } from 'bullmq';
import { bullmqConnection, TIMEZONE } from './cron.config';
import logger from '@/configs/logger.config';
import { pickStudyModelForContext, type ResolvedStudyModel } from '@/configs/aiClient.config';
import type { ProviderPreferencesJson } from '@/core/db/schema/main';
import aiModelService, { computeCostUsd } from '@/core/services/ai/aiModel.service';
import studyService from '@/core/services/english/study.service';
import readingPassageService, {
  getMaxPerBucket,
  getPerBucketGenerationCap,
  getExcludeRecentTitleCount,
  type InsertReadingPassageInput
} from '@/core/services/english/readingPassage.service';
import readingRefillService, {
  READING_REFILL_CHILD_QUEUE,
  READING_REFILL_PARENT_QUEUE
} from '@/core/services/english/readingRefill.service';
import topicService from '@/core/services/english/topic.service';
import { getEnglishConfigSnapshot, onEnglishConfigChanged } from '@/core/services/english/englishConfig.service';
import englishCronJobTrackingService, {
  normalizeError,
  type EnglishCronJobErrorPhase,
  type EnglishCronRunRef
} from '@/core/services/english/englishCronJobTracking.service';
import {
  BEGINNER_READING_PASSAGE_TYPE,
  isBeginnerLevel,
  type EngLevel,
  type ReadingPassageType
} from '@/core/services/english/questionTypes';

const LOG_TAG = 'ReadingRefill';

// english_cron_job_buckets yêu cầu quizType/optionCount notNull. Reading không có 2 khái
// niệm này nên dùng sentinel cố định (kèm type) — đủ để phân biệt bucket reading (daily vs
// academic) với bucket quiz khi đọc lịch sử cron, mà không phải đổi schema bảng tracking.
function readingTrackingQuizType(type: ReadingPassageType, forBeginner: boolean): string {
  return `reading-passage-${type}${forBeginner ? '-beginner' : ''}`;
}
const READING_TRACKING_OPTION_COUNT = 0;

export interface ReadingGenJobData {
  cefrLevel: EngLevel;
  topicId: number | null;
  topicName: string | null;
  type: ReadingPassageType;
  // Job cũ trong queue (trước khi có beginner) không có field này → coi như bucket thường.
  forBeginner?: boolean;
  count: number;
  trackingRunId?: string;
}

export let readingRefillQueue: Queue;
export let readingRefillChildQueue: Queue;
export let readingRefillParentWorker: Worker;
export let readingRefillChildWorker: Worker<ReadingGenJobData>;
export let readingRefillFlowProducer: FlowProducer;

export interface FillReadingBucketParams {
  cefrLevel: EngLevel;
  topicId: number | null;
  topicName: string | null;
  type: ReadingPassageType;
  forBeginner?: boolean;
  count: number;
  logTag?: string;
  model?: string;
  provider?: ProviderPreferencesJson;
  skipCountCheck?: boolean;
  trackingRun?: EnglishCronRunRef | null;
  trackingMetadata?: Record<string, unknown>;
}

export interface FillReadingBucketResult {
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

function emptyResult(status: 'skipped', requested: number): FillReadingBucketResult {
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
 * Sinh + lưu reading cho đúng 1 bucket (cefrLevel × topic), có tracking đầy đủ.
 * Song song với fillBucketDetailed của question pool, nhưng bucket 2 chiều và không có
 * quizType/optionCount.
 */
export async function fillReadingBucketDetailed(params: FillReadingBucketParams): Promise<FillReadingBucketResult> {
  const {
    cefrLevel,
    topicId,
    topicName,
    type,
    forBeginner = false,
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
    quizType: readingTrackingQuizType(type, forBeginner),
    optionCount: READING_TRACKING_OPTION_COUNT,
    topicId,
    topicName,
    requestedCount,
    metadata: trackingMetadata
  });
  let phase: EnglishCronJobErrorPhase = 'reading_count';
  let batchCount = requestedCount;

  try {
    if (!skipCountCheck) {
      phase = 'reading_count';
      const currentCount = await readingPassageService.getCount(cefrLevel, topicId, type, forBeginner);
      const maxPerBucket = getMaxPerBucket();
      const needed = maxPerBucket - currentCount;
      if (needed <= 0) {
        logger.info(
          `[${logTag}] Bucket already full (${currentCount}/${maxPerBucket}) cefrLevel=${cefrLevel} topicId=${topicId} type=${type}, skipping`
        );
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
      }
      batchCount = Math.min(Math.min(requestedCount, getPerBucketGenerationCap()), needed);
    }

    // Reading luôn gắn với 1 topic cụ thể (prompt cần topicName để lock chủ đề) — bucket
    // không topic không tồn tại ở feature này.
    if (topicId === null) {
      logger.warn(`[${logTag}] Reading bucket requires a topic, skipping cefrLevel=${cefrLevel}`);
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
    }

    const topic = await topicService.getTopicById(topicId);
    if (!topic || !topic.isActive) {
      logger.warn(`[${logTag}] Topic ${topicId} no longer exists/inactive, skipping bucket cefrLevel=${cefrLevel}`);
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
    }

    // Admin có thể tắt cờ beginner của topic giữa lúc scan và lúc job chạy.
    if (forBeginner && (!topic.forBeginner || !isBeginnerLevel(cefrLevel) || type !== BEGINNER_READING_PASSAGE_TYPE)) {
      logger.warn(
        `[${logTag}] Invalid beginner reading bucket topicId=${topicId} cefrLevel=${cefrLevel} type=${type}, skipping`
      );
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
    }

    const resolvedTopicName = topicName ?? topic.name;
    const excludeTitles = await readingPassageService.getRecentTitles(
      cefrLevel,
      topicId,
      type,
      getExcludeRecentTitleCount(),
      forBeginner
    );

    // Không chỉ định model → dùng pool model của context 'reading'.
    const resolved: ResolvedStudyModel = model ? { model, provider } : await pickStudyModelForContext('reading');

    logger.info(
      `[${logTag}] Generating batch cefrLevel=${cefrLevel} topicId=${topicId} topicName=${resolvedTopicName} type=${type} forBeginner=${forBeginner} count=${batchCount} model=${resolved.model}`
    );

    phase = 'generate_model';
    const attemptStartedAt = new Date();
    let passages;
    let usage;
    try {
      const result = await studyService.generateReadingPassageBatch(
        {
          cefrLevel,
          topicName: resolvedTopicName,
          type,
          forBeginner,
          model: resolved.model,
          provider: resolved.provider
        },
        { count: batchCount, excludeTitles }
      );
      passages = result.passages;
      usage = result.usage;
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
      throw err;
    }

    const tokenIn = usage?.inputTokens ?? 0;
    const tokenOut = usage?.outputTokens ?? 0;
    const costUsd = computeCostUsd(await aiModelService.getModelByModelId(resolved.model), tokenIn, tokenOut);
    await englishCronJobTrackingService.recordModelAttempt({
      run: trackingRun,
      bucket,
      model: resolved.model,
      attemptOrder: 1,
      status: 'success',
      requestedCount: batchCount,
      generatedCount: passages.length,
      tokenIn,
      tokenOut,
      costUsd,
      startedAt: attemptStartedAt
    });

    const rows: InsertReadingPassageInput[] = passages.map((passage) => ({
      title: passage.title,
      paragraphs: passage.paragraphs,
      wordCount: passage.wordCount,
      cefrLevel,
      topicId,
      topicName: resolvedTopicName,
      type,
      forBeginner,
      model: resolved.model,
      tokenIn,
      tokenOut
    }));

    phase = 'insert_readings';
    const inserted = rows.length > 0 ? await readingPassageService.insertPassages(rows) : 0;
    const skipped = Math.max(0, rows.length - inserted);

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
      `[${logTag}] Batch done cefrLevel=${cefrLevel} generated=${rows.length}/${batchCount} inserted=${inserted}`
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
      `[${logTag}] Bucket failed runId=${trackingRun?.runId ?? '-'} bucketId=${bucket?.id ?? '-'} cefrLevel=${cefrLevel} topicId=${topicId} phase=${phase}: ${normalized.message}`
    );
    throw err;
  }
}

/**
 * Đồng bộ BullMQ job schedulers với `reading_refill_schedule.items` hiện tại — giống
 * reconcilePoolRefillSchedulers, gọi lúc boot và mỗi khi config đổi.
 */
export async function reconcileReadingRefillSchedulers(): Promise<void> {
  const desired = getEnglishConfigSnapshot().reading_refill_schedule;
  const desiredByName = new Map(desired.map((s) => [s.name, s.cron]));

  const existing = await readingRefillQueue.getJobSchedulers();
  for (const scheduler of existing) {
    if (!desiredByName.has(scheduler.key)) {
      await readingRefillQueue.removeJobScheduler(scheduler.key);
      logger.info(`[${LOG_TAG}] Removed stale scheduler: ${scheduler.key}`);
    }
  }

  for (const [name, cron] of desiredByName) {
    await readingRefillQueue.upsertJobScheduler(
      name,
      { pattern: cron, tz: TIMEZONE },
      { opts: { removeOnComplete: true, removeOnFail: true } }
    );
  }

  logger.info(`[${LOG_TAG}] Reconciled schedulers: ${[...desiredByName.keys()].join(', ') || '(none)'}`);
}

function createChildWorker(): Worker<ReadingGenJobData> {
  return new Worker<ReadingGenJobData>(
    READING_REFILL_CHILD_QUEUE,
    async (job) => {
      const { cefrLevel, topicId, topicName, type, count } = job.data;
      const trackingRun = await englishCronJobTrackingService.getRunRefByRunId(job.data.trackingRunId);
      const { model, provider } = await pickStudyModelForContext('reading');
      logger.info(
        `[${LOG_TAG}] Child processing: cefrLevel=${cefrLevel} topicId=${topicId} type=${type} count=${count} model=${model}`
      );
      await fillReadingBucketDetailed({
        cefrLevel,
        topicId,
        topicName,
        type,
        forBeginner: job.data.forBeginner ?? false,
        count,
        model,
        provider,
        logTag: LOG_TAG,
        trackingRun,
        trackingMetadata: {
          source: 'reading_refill_child',
          queueName: READING_REFILL_CHILD_QUEUE,
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
    READING_REFILL_PARENT_QUEUE,
    async (job) => {
      if (job.name.startsWith('reading-refill-scan')) {
        const run = await englishCronJobTrackingService.getRunRefByRunId(
          (job.data as { trackingRunId?: string }).trackingRunId
        );
        await englishCronJobTrackingService.summarizeRun(run, { forceFinishRunningBuckets: true });
        logger.info(`[${LOG_TAG}] Parent scan job completed — children are processed`);
        return;
      }
      if (!getEnglishConfigSnapshot().job_flags.readingRefillEnabled) {
        logger.info(`[${LOG_TAG}] Reading-refill disabled, skipping run for trigger: ${job.name}`);
        return;
      }
      logger.info(`[${LOG_TAG}] Scheduled trigger: ${job.name}, starting scan...`);
      const result = await readingRefillService.runScheduledReadingRefill(flowProducer, {
        bullJobId: String(job.id ?? ''),
        bullJobName: job.name
      });
      logger.info(`[${LOG_TAG}] Scan finished: ${result.deficientBuckets}/${result.totalBuckets} buckets need refill`);
    },
    {
      connection: bullmqConnection,
      concurrency: 1
    }
  );
}

export default async function readingGenJob(): Promise<void> {
  readingRefillQueue = new Queue(READING_REFILL_PARENT_QUEUE, {
    connection: bullmqConnection,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: 10
    }
  });

  readingRefillChildQueue = new Queue(READING_REFILL_CHILD_QUEUE, {
    connection: bullmqConnection
  });

  readingRefillFlowProducer = new FlowProducer({ connection: bullmqConnection });

  await reconcileReadingRefillSchedulers();
  onEnglishConfigChanged('reading_refill_schedule.items', () => reconcileReadingRefillSchedulers());

  readingRefillParentWorker = createParentWorker(readingRefillFlowProducer);
  readingRefillChildWorker = createChildWorker();

  readingRefillParentWorker.on('failed', (job, err) => {
    logger.error(`[${LOG_TAG}] Parent job ${job?.id} (${job?.name}) failed: ${err.message}`);
  });

  readingRefillParentWorker.on('completed', (job) => {
    logger.info(`[${LOG_TAG}] Parent job ${job.id} (${job.name}) completed`);
  });

  readingRefillChildWorker.on('failed', (job, err) => {
    logger.error(
      `[${LOG_TAG}] Child job ${job?.id} failed cefrLevel=${job?.data.cefrLevel} topicId=${job?.data.topicId}: ${err.message}`
    );
    void englishCronJobTrackingService.finalizeRunIfBucketsComplete(job?.data.trackingRunId);
  });

  readingRefillChildWorker.on('completed', (job) => {
    logger.info(
      `[${LOG_TAG}] Child job ${job.id} completed cefrLevel=${job.data.cefrLevel} topicId=${job.data.topicId}`
    );
    void englishCronJobTrackingService.finalizeRunIfBucketsComplete(job.data.trackingRunId);
  });

  logger.info(`[${LOG_TAG}] Queue, workers, and schedulers initialized`);
}
