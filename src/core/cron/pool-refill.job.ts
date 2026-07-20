import { FlowProducer, Queue, Worker } from 'bullmq';
import { bullmqConnection, TIMEZONE } from './cron.config';
import { fillBucketDetailed, type QuestionGenJobData } from './question-gen.job';
import questionPoolService, { getMaxPoolSize } from '@/core/services/english/questionPool.service';
import type { QuizType } from '@/core/services/english/questionTypes';
import topicService from '@/core/services/english/topic.service';
import logger from '@/configs/logger.config';
import { pickStudyModel, type DifficultyContext } from '@/core/services/english/study.service';
import { getEnglishConfigSnapshot } from '@/core/services/english/englishConfig.service';
import englishCronJobTrackingService, {
  normalizeError,
  type EnglishCronRunRef
} from '@/core/services/english/englishCronJobTracking.service';

const PARENT_QUEUE = 'english-pool-refill';
const CHILD_QUEUE = 'english-pool-refill-child';
const LOG_TAG = 'PoolRefill';

const ENG_LEVELS: DifficultyContext['engLevel'][] = ['A1', 'A2', 'B1', 'B2'];

function getOptionCount(engLevel: DifficultyContext['engLevel']): 4 | 5 {
  return engLevel === 'A1' || engLevel === 'A2' ? 4 : 5;
}

function getEnabledQuizTypes(): QuizType[] {
  return getEnglishConfigSnapshot()
    .quiz_distribution.filter((item) => item.enabled && item.weight > 0)
    .map((item) => item.quizType as QuizType);
}

const SCHEDULES = [
  { name: 'pool-refill-morning', cron: '0 5 * * *' },
  { name: 'pool-refill-noon', cron: '0 12 * * *' },
  { name: 'pool-refill-evening', cron: '0 20 * * *' }
] as const;

export let poolRefillQueue: Queue;
export let poolRefillChildQueue: Queue;
export let poolRefillParentWorker: Worker;
export let poolRefillChildWorker: Worker<QuestionGenJobData>;
export let poolRefillFlowProducer: FlowProducer;

interface ScanResult {
  totalBuckets: number;
  deficientBuckets: number;
}

async function scanAndCreateFlow(
  flowProducer: FlowProducer,
  trackingRun: EnglishCronRunRef | null
): Promise<ScanResult> {
  const topics = await topicService.getAllActiveTopics();
  const topicEntries = topics.map((t) => ({ id: t.id, name: t.name }));
  const maxPool = getMaxPoolSize();
  const maxPerRun = getEnglishConfigSnapshot().job_flags.poolRefillMaxQuestionsPerRun;
  const quizTypes = getEnabledQuizTypes();
  const children: Array<{
    name: string;
    queueName: string;
    data: QuestionGenJobData;
    opts: Record<string, unknown>;
  }> = [];
  let totalBuckets = 0;
  let plannedQuestions = 0;
  let cappedByLimit = false;
  for (const topic of topicEntries) {
    for (const engLevel of ENG_LEVELS) {
      for (const quizType of quizTypes) {
        totalBuckets++;
        if (plannedQuestions >= maxPerRun) {
          cappedByLimit = true;
          continue;
        }
        const currentCount = await questionPoolService.getPoolCount(engLevel, quizType, topic.id);
        if (currentCount >= maxPool) continue;
        let needed = Math.min(maxPool - currentCount, 5);
        if (plannedQuestions + needed > maxPerRun) {
          needed = maxPerRun - plannedQuestions;
          cappedByLimit = true;
        }
        if (needed <= 0) continue;
        plannedQuestions += needed;
        children.push({
          name: `fill-${engLevel}-${topic.id ?? 'null'}-${quizType}`,
          queueName: CHILD_QUEUE,
          data: {
            engLevel,
            quizType,
            optionCount: getOptionCount(engLevel),
            topicId: topic.id,
            topicName: topic.name,
            count: needed,
            trackingRunId: trackingRun?.runId
          },
          opts: {
            removeOnComplete: true,
            removeOnFail: 50
          }
        });
      }
    }
  }
  if (cappedByLimit) {
    logger.info(
      `[${LOG_TAG}] Reached max questions per run (${maxPerRun}), stopping child creation at ${children.length} buckets / ${plannedQuestions} questions`
    );
  }
  if (children.length === 0) {
    logger.info(`[${LOG_TAG}] All ${totalBuckets} buckets are full, nothing to refill`);
    await englishCronJobTrackingService.finishRun(trackingRun, {
      status: 'skipped',
      totals: {
        totalBuckets,
        deficientBuckets: 0
      }
    });
    return { totalBuckets, deficientBuckets: 0 };
  }
  logger.info(`[${LOG_TAG}] Found ${children.length}/${totalBuckets} deficient buckets, creating flow`);
  await englishCronJobTrackingService.updateRun(trackingRun, {
    totalBuckets,
    deficientBuckets: children.length
  });
  await flowProducer.add({
    name: 'pool-refill-scan',
    queueName: PARENT_QUEUE,
    data: { totalBuckets, deficientBuckets: children.length, trackingRunId: trackingRun?.runId },
    opts: {
      removeOnComplete: true,
      removeOnFail: 10
    },
    children
  });
  return { totalBuckets, deficientBuckets: children.length };
}

function createChildWorker(): Worker<QuestionGenJobData> {
  return new Worker<QuestionGenJobData>(
    CHILD_QUEUE,
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
          queueName: CHILD_QUEUE,
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
    PARENT_QUEUE,
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
      const run = await englishCronJobTrackingService.startRun({
        jobKey: 'pool_refill',
        trigger: 'schedule',
        queueName: PARENT_QUEUE,
        bullJobId: String(job.id ?? ''),
        bullJobName: job.name,
        metadata: {
          schedule: job.name,
          cron: SCHEDULES.find((s) => s.name === job.name)?.cron
        }
      });
      try {
        const result = await scanAndCreateFlow(flowProducer, run);
        logger.info(
          `[${LOG_TAG}] Scan finished: ${result.deficientBuckets}/${result.totalBuckets} buckets need refill`
        );
      } catch (err) {
        const normalized = normalizeError(err);
        await englishCronJobTrackingService.finishRun(run, {
          status: 'failed',
          errorPhase: 'scan_topics',
          error: err
        });
        logger.error(
          `[${LOG_TAG}] Scan failed runId=${run?.runId ?? '-'} job=${job.name} phase=scan_topics: ${normalized.message}`
        );
        throw err;
      }
    },
    {
      connection: bullmqConnection,
      concurrency: 1
    }
  );
}

export default async function poolRefillJob(): Promise<void> {
  poolRefillQueue = new Queue(PARENT_QUEUE, {
    connection: bullmqConnection,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: 10
    }
  });

  poolRefillChildQueue = new Queue(CHILD_QUEUE, {
    connection: bullmqConnection
  });

  poolRefillFlowProducer = new FlowProducer({ connection: bullmqConnection });

  for (const schedule of SCHEDULES) {
    await poolRefillQueue.upsertJobScheduler(
      schedule.name,
      { pattern: schedule.cron, tz: TIMEZONE },
      { opts: { removeOnComplete: true, removeOnFail: true } }
    );
  }

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

  logger.info(`[${LOG_TAG}] Queue, workers, and schedulers initialized (${SCHEDULES.map((s) => s.cron).join(', ')})`);
}
