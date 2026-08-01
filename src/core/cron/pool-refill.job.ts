import { FlowProducer, Queue, Worker } from 'bullmq';
import { bullmqConnection, TIMEZONE } from './cron.config';
import { fillBucketDetailed, type QuestionGenJobData } from './question-gen.job';
import poolRefillService, {
  POOL_REFILL_PARENT_QUEUE,
  POOL_REFILL_CHILD_QUEUE
} from '@/core/services/english/poolRefill.service';
import logger from '@/configs/logger.config';
import { pickStudyModel } from '@/core/services/english/study.service';
import { getEnglishConfigSnapshot, onEnglishConfigChanged } from '@/core/services/english/englishConfig.service';
import englishCronJobTrackingService from '@/core/services/english/englishCronJobTracking.service';

const LOG_TAG = 'PoolRefill';

export let poolRefillQueue: Queue;
export let poolRefillChildQueue: Queue;
export let poolRefillParentWorker: Worker;
export let poolRefillChildWorker: Worker<QuestionGenJobData>;
export let poolRefillFlowProducer: FlowProducer;

/**
 * Đồng bộ BullMQ job schedulers với config `pool_refill_schedule.items` hiện tại:
 * xoá scheduler không còn trong config, upsert phần còn lại. upsertJobScheduler tự
 * diff pattern nội bộ nên an toàn gọi lại cho entry không đổi. Gọi lúc boot và mỗi
 * khi config đổi (xem onEnglishConfigChanged bên dưới) — không cần restart process.
 */
export async function reconcilePoolRefillSchedulers(): Promise<void> {
  const desired = getEnglishConfigSnapshot().pool_refill_schedule;
  const desiredByName = new Map(desired.map((s) => [s.name, s.cron]));

  const existing = await poolRefillQueue.getJobSchedulers();
  for (const scheduler of existing) {
    if (!desiredByName.has(scheduler.key)) {
      await poolRefillQueue.removeJobScheduler(scheduler.key);
      logger.info(`[${LOG_TAG}] Removed stale scheduler: ${scheduler.key}`);
    }
  }

  for (const [name, cron] of desiredByName) {
    await poolRefillQueue.upsertJobScheduler(
      name,
      { pattern: cron, tz: TIMEZONE },
      { opts: { removeOnComplete: true, removeOnFail: true } }
    );
  }

  logger.info(`[${LOG_TAG}] Reconciled schedulers: ${[...desiredByName.keys()].join(', ') || '(none)'}`);
}

function createChildWorker(): Worker<QuestionGenJobData> {
  return new Worker<QuestionGenJobData>(
    POOL_REFILL_CHILD_QUEUE,
    async (job) => {
      const { engLevel, quizType, topicId, topicName, optionCount, count } = job.data;
      const trackingRun = await englishCronJobTrackingService.getRunRefByRunId(job.data.trackingRunId);
      const model = await pickStudyModel(engLevel);
      logger.info(
        `[${LOG_TAG}] Child processing: engLevel=${engLevel} topicId=${topicId} quizType=${quizType} count=${count} model=${model}`
      );
      await fillBucketDetailed({
        engLevel,
        quizType,
        optionCount,
        topicId,
        topicName,
        count,
        model,
        logTag: LOG_TAG,
        trackingRun,
        trackingMetadata: {
          source: 'pool_refill_child',
          queueName: POOL_REFILL_CHILD_QUEUE,
          bullJobId: String(job.id ?? ''),
          attempt: job.attemptsMade + 1,
          model
        }
      });
      await englishCronJobTrackingService.finalizeRunIfBucketsComplete(job.data.trackingRunId);
    },
    {
      connection: bullmqConnection,
      concurrency: 3
    }
  );
}

function createParentWorker(flowProducer: FlowProducer): Worker {
  return new Worker(
    POOL_REFILL_PARENT_QUEUE,
    async (job) => {
      if (job.name.startsWith('pool-refill-scan')) {
        const run = await englishCronJobTrackingService.getRunRefByRunId(
          (job.data as { trackingRunId?: string }).trackingRunId
        );
        // Force-close any buckets still stuck in running (e.g. DB write failure during finishBucket)
        await englishCronJobTrackingService.summarizeRun(run, { forceFinishRunningBuckets: true });
        logger.info(`[${LOG_TAG}] Parent scan job completed — children are processed`);
        return;
      }
      if (!getEnglishConfigSnapshot().job_flags.poolRefillEnabled) {
        logger.info(`[${LOG_TAG}] Pool-refill disabled, skipping run for trigger: ${job.name}`);
        return;
      }
      logger.info(`[${LOG_TAG}] Scheduled trigger: ${job.name}, starting scan...`);
      const result = await poolRefillService.runScheduledRefill(flowProducer, {
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

export default async function poolRefillJob(): Promise<void> {
  poolRefillQueue = new Queue(POOL_REFILL_PARENT_QUEUE, {
    connection: bullmqConnection,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: 10
    }
  });

  poolRefillChildQueue = new Queue(POOL_REFILL_CHILD_QUEUE, {
    connection: bullmqConnection
  });

  poolRefillFlowProducer = new FlowProducer({ connection: bullmqConnection });

  await reconcilePoolRefillSchedulers();
  onEnglishConfigChanged('pool_refill_schedule.items', () => reconcilePoolRefillSchedulers());

  poolRefillParentWorker = createParentWorker(poolRefillFlowProducer);
  poolRefillChildWorker = createChildWorker();

  poolRefillParentWorker.on('failed', (job, err) => {
    logger.error(`[${LOG_TAG}] Parent job ${job?.id} (${job?.name}) failed: ${err.message}`);
  });

  poolRefillParentWorker.on('completed', (job) => {
    logger.info(`[${LOG_TAG}] Parent job ${job.id} (${job.name}) completed`);
  });

  poolRefillChildWorker.on('failed', (job, err) => {
    logger.error(
      `[${LOG_TAG}] Child job ${job?.id} failed engLevel=${job?.data.engLevel} topicId=${job?.data.topicId} quizType=${job?.data.quizType}: ${err.message}`
    );
    void englishCronJobTrackingService.finalizeRunIfBucketsComplete(job?.data.trackingRunId);
  });

  poolRefillChildWorker.on('completed', (job) => {
    logger.info(
      `[${LOG_TAG}] Child job ${job.id} completed engLevel=${job.data.engLevel} topicId=${job.data.topicId} quizType=${job.data.quizType}`
    );
    void englishCronJobTrackingService.finalizeRunIfBucketsComplete(job.data.trackingRunId);
  });

  logger.info(`[${LOG_TAG}] Queue, workers, and schedulers initialized`);
}
