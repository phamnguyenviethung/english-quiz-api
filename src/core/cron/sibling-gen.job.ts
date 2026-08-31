import { Queue, Worker } from 'bullmq';
import { bullmqConnection, TIMEZONE } from './cron.config';
import logger from '@/configs/logger.config';
import redisClient from '@/configs/redis.config';
import { getEnglishConfigSnapshot, onEnglishConfigChanged } from '@/core/services/english/englishConfig.service';
import englishCronJobTrackingService, {
  normalizeError,
  type EnglishCronRunRef
} from '@/core/services/english/englishCronJobTracking.service';
import { scanBuckets, type RefillBucketCandidate } from '@/core/services/english/poolRefill.service';
import questionPoolService from '@/core/services/english/questionPool.service';
import siblingQuestionService from '@/core/services/english/siblingQuestion.service';
import { SIBLING_SUPPORTED_QUIZ_TYPES } from '@/core/services/english/questionTypes';
import type { QuizType } from '@/core/services/english/questionTypes';
import aiModelService, { computeCostUsd } from '@/core/services/ai/aiModel.service';

const QUEUE_NAME = 'english-sibling-gen';
const LOG_TAG = 'SiblingGen';

export let siblingGenQueue: Queue;
export let siblingGenWorker: Worker;

/** Đồng bộ BullMQ job schedulers với config `sibling_gen_schedule.items`. Giống reconcilePoolRefillSchedulers. */
export async function reconcileSiblingGenSchedulers(): Promise<void> {
  const desired = getEnglishConfigSnapshot().sibling_gen_schedule;
  const desiredByName = new Map(desired.map((s) => [s.name, s.cron]));

  const existing = await siblingGenQueue.getJobSchedulers();
  for (const scheduler of existing) {
    if (!desiredByName.has(scheduler.key)) {
      await siblingGenQueue.removeJobScheduler(scheduler.key);
      logger.info(`[${LOG_TAG}] Removed stale scheduler: ${scheduler.key}`);
    }
  }
  for (const [name, cron] of desiredByName) {
    await siblingGenQueue.upsertJobScheduler(
      name,
      { pattern: cron, tz: TIMEZONE },
      { opts: { removeOnComplete: true, removeOnFail: true } }
    );
  }
  logger.info(`[${LOG_TAG}] Reconciled schedulers: ${[...desiredByName.keys()].join(', ') || '(none)'}`);
}

function lockKeyOf(c: RefillBucketCandidate): string {
  return `question-pool:lock:${c.engLevel}:${c.topicId ?? 'null'}:${c.quizType}`;
}

async function processBucket(
  run: EnglishCronRunRef | null,
  candidate: RefillBucketCandidate,
  opts: { sourcesPerBucket: number; siblingsPerSource: number; remainingBudget: number }
): Promise<{ inserted: number }> {
  const bucket = await englishCronJobTrackingService.startBucket(run, {
    engLevel: candidate.engLevel,
    quizType: candidate.quizType,
    optionCount: candidate.optionCount,
    topicId: candidate.topicId,
    topicName: candidate.topicName,
    requestedCount: opts.sourcesPerBucket * opts.siblingsPerSource,
    metadata: { source: 'sibling_gen' }
  });
  const startedAt = new Date();

  try {
    const sourceIds = await questionPoolService.pickSiblingSourceIds(
      candidate.engLevel,
      candidate.quizType,
      candidate.topicId,
      opts.sourcesPerBucket
    );

    let generated = 0;
    let inserted = 0;
    let tokenIn = 0;
    let tokenOut = 0;
    let model = '';
    let budgetLeft = opts.remainingBudget;

    for (const sourceId of sourceIds) {
      if (budgetLeft <= 0) break;
      const count = Math.min(opts.siblingsPerSource, budgetLeft);
      try {
        const res = await siblingQuestionService.generateSiblingsForSource(sourceId, {
          count,
          context: 'schedule',
          forceInsert: false
        });
        generated += res.generated;
        inserted += res.inserted;
        tokenIn += res.tokenIn;
        tokenOut += res.tokenOut;
        model = res.model || model;
        budgetLeft -= res.inserted;
      } catch (err) {
        logger.warn(`[${LOG_TAG}] Source ${sourceId} failed: ${normalizeError(err).message}`);
      }
    }

    const costUsd = model ? computeCostUsd(await aiModelService.getModelByModelId(model), tokenIn, tokenOut) : null;
    await englishCronJobTrackingService.recordModelAttempt({
      run,
      bucket,
      model: model || '(none)',
      attemptOrder: 1,
      status: 'success',
      requestedCount: sourceIds.length * opts.siblingsPerSource,
      generatedCount: generated,
      tokenIn,
      tokenOut,
      costUsd,
      startedAt
    });
    await englishCronJobTrackingService.finishBucket(bucket, {
      status: 'success',
      requestedCount: sourceIds.length * opts.siblingsPerSource,
      generatedCount: generated,
      insertedCount: inserted,
      skippedCount: Math.max(0, generated - inserted),
      tokenIn,
      tokenOut,
      costUsd
    });
    logger.info(
      `[${LOG_TAG}] Bucket done engLevel=${candidate.engLevel} topicId=${candidate.topicId} quizType=${candidate.quizType} sources=${sourceIds.length} inserted=${inserted}`
    );
    return { inserted };
  } catch (err) {
    await englishCronJobTrackingService.finishBucket(bucket, {
      status: 'failed',
      errorPhase: 'generate_model',
      error: err
    });
    logger.error(
      `[${LOG_TAG}] Bucket failed engLevel=${candidate.engLevel} topicId=${candidate.topicId} quizType=${candidate.quizType}: ${normalizeError(err).message}`
    );
    return { inserted: 0 };
  }
}

async function runSiblingGen(trigger: { bullJobId: string; bullJobName: string }): Promise<void> {
  if (!getEnglishConfigSnapshot().job_flags.siblingGenEnabled) {
    logger.info(`[${LOG_TAG}] Disabled (job_flags.siblingGenEnabled=false), skipping run ${trigger.bullJobName}`);
    return;
  }
  const cfg = getEnglishConfigSnapshot().sibling_gen;

  const candidates = await scanBuckets({
    scope: 'deficient',
    thresholdCheck: 'target',
    filter: { quizTypes: [...SIBLING_SUPPORTED_QUIZ_TYPES] as QuizType[] }
  });

  const run = await englishCronJobTrackingService.startRun({
    jobKey: 'sibling_gen',
    trigger: 'schedule',
    queueName: QUEUE_NAME,
    bullJobId: trigger.bullJobId,
    bullJobName: trigger.bullJobName,
    totalBuckets: candidates.length,
    deficientBuckets: candidates.length,
    metadata: { schedule: trigger.bullJobName, cfg }
  });

  try {
    if (candidates.length === 0) {
      logger.info(`[${LOG_TAG}] No deficient sibling-supported buckets`);
      await englishCronJobTrackingService.finishRun(run, { status: 'skipped' });
      return;
    }

    let produced = 0;
    let bucketsProcessed = 0;
    for (const candidate of candidates) {
      if (produced >= cfg.maxSiblingsPerRun) break;

      const lockKey = lockKeyOf(candidate);
      const locked = await redisClient.set(lockKey, '1', 'EX', 300, 'NX');
      if (locked !== 'OK') {
        logger.info(`[${LOG_TAG}] Bucket locked, skip ${lockKey}`);
        continue;
      }
      try {
        const { inserted } = await processBucket(run, candidate, {
          sourcesPerBucket: cfg.sourcesPerBucketPerRun,
          siblingsPerSource: cfg.siblingsPerSource,
          remainingBudget: cfg.maxSiblingsPerRun - produced
        });
        produced += inserted;
        bucketsProcessed++;
      } finally {
        try {
          await redisClient.del(lockKey);
        } catch (err) {
          logger.warn(`[${LOG_TAG}] Failed to release lock ${lockKey}: ${err}`);
        }
      }
    }

    await englishCronJobTrackingService.summarizeRun(run, { forceFinishRunningBuckets: true });
    logger.info(`[${LOG_TAG}] Run done: buckets=${bucketsProcessed}/${candidates.length} siblings=${produced}`);
  } catch (err) {
    await englishCronJobTrackingService.finishRun(run, { status: 'failed', errorPhase: 'unknown', error: err });
    throw err;
  }
}

function createWorker(): Worker {
  return new Worker(
    QUEUE_NAME,
    async (job) => {
      logger.info(`[${LOG_TAG}] Scheduled trigger: ${job.name}`);
      await runSiblingGen({ bullJobId: String(job.id ?? ''), bullJobName: job.name });
    },
    { connection: bullmqConnection, concurrency: 1 }
  );
}

export default async function siblingGenJob(): Promise<void> {
  siblingGenQueue = new Queue(QUEUE_NAME, {
    connection: bullmqConnection,
    defaultJobOptions: { removeOnComplete: true, removeOnFail: 10 }
  });

  await reconcileSiblingGenSchedulers();
  onEnglishConfigChanged('sibling_gen_schedule.items', () => reconcileSiblingGenSchedulers());

  siblingGenWorker = createWorker();
  siblingGenWorker.on('failed', (job, err) => {
    logger.error(`[${LOG_TAG}] Job ${job?.id} (${job?.name}) failed: ${err.message}`);
  });
  siblingGenWorker.on('completed', (job) => {
    logger.info(`[${LOG_TAG}] Job ${job.id} (${job.name}) completed`);
  });

  logger.info(`[${LOG_TAG}] Queue, worker, and schedulers initialized`);
}
