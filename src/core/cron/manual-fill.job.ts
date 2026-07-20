import { fillBucketDetailed } from './question-gen.job';
import topicService from '@/core/services/english/topic.service';
import logger from '@/configs/logger.config';
import type { DifficultyContext } from '@/core/services/english/study.service';
import type { QuizType } from '@/core/services/english/questionTypes';
import type { ModelName } from '@/configs/aiClient.config';
import { getEnglishConfigSnapshot } from '@/core/services/english/englishConfig.service';
import englishCronJobTrackingService, {
  normalizeError,
  type EnglishCronRunRef
} from '@/core/services/english/englishCronJobTracking.service';

const LOG_TAG = 'ManualFill';

const ENG_LEVELS: DifficultyContext['engLevel'][] = ['A1', 'A2', 'B1', 'B2'];
const activeManualRuns = new Set<string>();

export interface ManualFillTriggerParams {
  model: ModelName;
  countPerBucket: number;
}

interface ManualBucketParams {
  engLevel: DifficultyContext['engLevel'];
  quizType: QuizType;
  optionCount: 4 | 5;
  topicId: number | null;
  topicName: string | null;
  count: number;
  sourceBucketId?: number;
}

function getOptionCount(engLevel: DifficultyContext['engLevel']): 4 | 5 {
  return engLevel === 'A1' || engLevel === 'A2' ? 4 : 5;
}

function getEnabledQuizTypes(): QuizType[] {
  return getEnglishConfigSnapshot()
    .quiz_distribution.filter((item) => item.enabled && item.weight > 0)
    .map((item) => item.quizType as QuizType);
}

async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  let index = 0;

  async function runNext(): Promise<void> {
    const taskIndex = index++;
    if (taskIndex >= tasks.length) return;
    const task = tasks[taskIndex]!;
    try {
      const value = await task();
      results[taskIndex] = { status: 'fulfilled', value };
    } catch (reason) {
      results[taskIndex] = { status: 'rejected', reason };
    }
    await runNext();
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, runNext));
  return results;
}

async function runManualBuckets(params: {
  run: EnglishCronRunRef | null;
  buckets: ManualBucketParams[];
  model: ModelName;
  trigger: 'manual';
}): Promise<void> {
  const { run, buckets, model, trigger } = params;
  const runKey = run?.runId ?? `untracked-${Date.now()}`;
  if (activeManualRuns.has(runKey)) {
    logger.warn(`[${LOG_TAG}] Run already active runId=${runKey}`);
    return;
  }
  activeManualRuns.add(runKey);

  if (buckets.length === 0) {
    await englishCronJobTrackingService.finishRun(run, { status: 'skipped' });
    logger.info(`[${LOG_TAG}] No buckets to process runId=${runKey}`);
    activeManualRuns.delete(runKey);
    return;
  }

  try {
    logger.info(
      `[${LOG_TAG}] Background start runId=${runKey} trigger=${trigger} model=${model} buckets=${buckets.length}`
    );
    const tasks = buckets.map((b) => async () => {
      logger.info(
        `[${LOG_TAG}] Processing runId=${runKey} engLevel=${b.engLevel} topicId=${b.topicId} quizType=${b.quizType}`
      );
      await fillBucketDetailed({
        engLevel: b.engLevel,
        quizType: b.quizType,
        optionCount: b.optionCount,
        topicId: b.topicId,
        topicName: b.topicName,
        count: b.count,
        model,
        skipPoolCheck: true,
        logTag: LOG_TAG,
        trackingRun: run,
        trackingMetadata: {
          source: trigger,
          sourceBucketId: b.sourceBucketId,
          model
        }
      });
    });

    const results = await runWithConcurrency(tasks, getEnglishConfigSnapshot().question_pool.manualFillConcurrency);

    let succeeded = 0;
    let failed = 0;
    for (const [i, result] of results.entries()) {
      const b = buckets[i]!;
      if (result.status === 'fulfilled') {
        succeeded++;
      } else {
        failed++;
        const normalized = normalizeError(result.reason);
        logger.error(
          `[${LOG_TAG}] Failed runId=${runKey} sourceBucketId=${b.sourceBucketId ?? '-'} engLevel=${b.engLevel} topicId=${b.topicId} quizType=${b.quizType}: ${normalized.message}`
        );
      }
    }

    logger.info(`[${LOG_TAG}] Done runId=${runKey}: succeeded=${succeeded} failed=${failed} total=${buckets.length}`);
  } finally {
    await englishCronJobTrackingService.summarizeRun(run);
    activeManualRuns.delete(runKey);
  }
}

export async function triggerManualFill(
  params: ManualFillTriggerParams
): Promise<{ runId: string | null; totalBuckets: number }> {
  const { model, countPerBucket } = params;
  const topics = await topicService.getAllActiveTopics();
  const quizTypes = getEnabledQuizTypes();
  const buckets: ManualBucketParams[] = [];

  for (const topic of topics) {
    for (const engLevel of ENG_LEVELS) {
      for (const quizType of quizTypes) {
        buckets.push({
          engLevel,
          quizType,
          optionCount: getOptionCount(engLevel),
          topicId: topic.id,
          topicName: topic.name,
          count: countPerBucket
        });
      }
    }
  }

  const run = await englishCronJobTrackingService.startRun({
    jobKey: 'manual_fill',
    trigger: 'manual',
    totalBuckets: buckets.length,
    deficientBuckets: buckets.length,
    metadata: {
      model,
      countPerBucket
    }
  });

  void runManualBuckets({ run, buckets, model, trigger: 'manual' });
  return { runId: run?.runId ?? null, totalBuckets: buckets.length };
}

export default async function manualFillJob(): Promise<void> {
  logger.info(`[${LOG_TAG}] Initialized`);
}
