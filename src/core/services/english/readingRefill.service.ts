import type { FlowProducer } from 'bullmq';
import _ from 'lodash';
import logger from '@/configs/logger.config';
import { runWithConcurrency } from '@/utils/concurrency';
import type { ResolvedStudyModel } from '@/configs/aiClient.config';
import { fillReadingBucketDetailed, type ReadingGenJobData } from '@/core/cron/reading-gen.job';
import readingPassageService, {
  getMaxPerBucket,
  getPerBucketGenerationCap,
  getRefillThreshold
} from './readingPassage.service';
import topicService from './topic.service';
import { buildRefillPlan, type RefillPlanResult } from './poolRefill.service';
import { getEnglishConfigSnapshot } from './englishConfig.service';
import { ENG_LEVELS, type EngLevel } from './questionTypes';
import englishCronJobTrackingService, {
  normalizeError,
  type EnglishCronRunRef
} from './englishCronJobTracking.service';

// Cùng lý do với POOL_REFILL_*_QUEUE ở poolRefill.service: cả job bootstrap lẫn module
// này đều cần tên queue nên khai ở đây thay vì trong file job.
export const READING_REFILL_PARENT_QUEUE = 'english-reading-refill';
export const READING_REFILL_CHILD_QUEUE = 'english-reading-refill-child';

const LOG_TAG = 'ReadingRefill';

// Bucket reading chỉ 2 chiều (cefrLevel × topic) — không có quizType/optionCount như pool.
export function readingBucketKeyOf(input: { cefrLevel: string; topicId: number | null }): string {
  return `${input.cefrLevel}:${input.topicId ?? 'null'}`;
}

// ─── Scan ─────────────────────────────────────────────────────────────────────

export interface ReadingBucketCandidate {
  cefrLevel: EngLevel;
  topicId: number | null;
  topicName: string | null;
  currentCount: number;
  deficiency: number;
}

export interface ReadingBucketFilter {
  cefrLevels?: EngLevel[];
  topicIds?: number[];
}

export interface ScanReadingBucketsOptions {
  scope: 'deficient' | 'all';
  thresholdCheck?: 'target' | 'ratio';
  filter?: ReadingBucketFilter;
  bucketKeys?: string[];
}

function hasFilterValues<T>(values: T[] | undefined): values is T[] {
  return values !== undefined && values.length > 0;
}

export function isReadingBucketDeficient(
  candidate: Pick<ReadingBucketCandidate, 'currentCount'>,
  thresholdCheck?: 'target' | 'ratio'
): boolean {
  return thresholdCheck === 'ratio'
    ? candidate.currentCount < getRefillThreshold()
    : candidate.currentCount < getMaxPerBucket();
}

/**
 * Quét toàn bộ bucket (topic × cefrLevel), sắp xếp giống scanBuckets của pool:
 * deficiency giảm dần → lần refill thành công gần nhất tăng dần (null trước) → bucketKey.
 * Tiêu chí (2) là phần chống đói: khi 1 lần chạy bị budget-cap giữa chừng, bucket đứng
 * sau trong thứ tự cố định sẽ không bị bỏ quên mãi.
 */
export async function scanReadingBuckets(options: ScanReadingBucketsOptions): Promise<ReadingBucketCandidate[]> {
  const topics = await topicService.getAllActiveTopics();
  const maxPerBucket = getMaxPerBucket();
  const countsByBucket = await readingPassageService.getCountsByBucket();

  const filter = options.filter;
  const cefrLevelFilter = hasFilterValues(filter?.cefrLevels) ? new Set(filter.cefrLevels) : null;
  const topicIdFilter = hasFilterValues(filter?.topicIds) ? new Set(filter.topicIds) : null;
  const bucketKeyFilter = hasFilterValues(options.bucketKeys) ? new Set(options.bucketKeys) : null;

  const all: ReadingBucketCandidate[] = [];
  for (const topic of topics) {
    if (topicIdFilter && !topicIdFilter.has(topic.id)) continue;
    for (const cefrLevel of ENG_LEVELS) {
      if (cefrLevelFilter && !cefrLevelFilter.has(cefrLevel)) continue;
      const bucketKey = readingBucketKeyOf({ cefrLevel, topicId: topic.id });
      if (bucketKeyFilter && !bucketKeyFilter.has(bucketKey)) continue;

      const currentCount = countsByBucket.get(bucketKey) ?? 0;
      all.push({
        cefrLevel,
        topicId: topic.id,
        topicName: topic.name,
        currentCount,
        deficiency: maxPerBucket - currentCount
      });
    }
  }

  const filtered =
    options.scope === 'all' ? all : all.filter((b) => isReadingBucketDeficient(b, options.thresholdCheck));

  if (filtered.length === 0) return filtered;

  const lastRefillMap = await englishCronJobTrackingService.getLastBucketRefillTimestamps(
    filtered.map((b) => readingBucketKeyOf(b))
  );

  return filtered.sort((a, b) => {
    if (b.deficiency !== a.deficiency) return b.deficiency - a.deficiency;
    const aLast = lastRefillMap.get(readingBucketKeyOf(a))?.getTime() ?? -Infinity;
    const bLast = lastRefillMap.get(readingBucketKeyOf(b))?.getTime() ?? -Infinity;
    if (aLast !== bLast) return aLast - bLast;
    return readingBucketKeyOf(a).localeCompare(readingBucketKeyOf(b));
  });
}

// ─── Execute: queue-based (scheduled) ─────────────────────────────────────────

type ReadingRefillPlanItem = ReadingBucketCandidate & { count: number };

function toReadingGenJobData(item: ReadingRefillPlanItem, trackingRunId?: string): ReadingGenJobData {
  return {
    cefrLevel: item.cefrLevel,
    topicId: item.topicId,
    topicName: item.topicName,
    count: item.count,
    trackingRunId
  };
}

async function executeScheduledPlanAsFlow(
  flowProducer: FlowProducer,
  plan: RefillPlanResult<ReadingBucketCandidate>,
  trackingRun: EnglishCronRunRef | null
): Promise<void> {
  const children = plan.planned.map((item) => ({
    name: `reading-${item.cefrLevel}-${item.topicId ?? 'null'}`,
    queueName: READING_REFILL_CHILD_QUEUE,
    data: toReadingGenJobData(item, trackingRun?.runId),
    opts: { removeOnComplete: true, removeOnFail: 50 }
  }));

  await flowProducer.add({
    name: 'reading-refill-scan',
    queueName: READING_REFILL_PARENT_QUEUE,
    data: { totalBuckets: plan.totalBuckets, deficientBuckets: children.length, trackingRunId: trackingRun?.runId },
    opts: { removeOnComplete: true, removeOnFail: 10 },
    children
  });
}

// ─── Execute: in-process (manual/admin) ───────────────────────────────────────

const activeManualRuns = new Set<string>();

async function executeManualPlanInProcess(
  plan: RefillPlanResult<ReadingBucketCandidate>,
  run: EnglishCronRunRef | null,
  opts: { models: ResolvedStudyModel[]; concurrency: number }
): Promise<void> {
  const runKey = run?.runId ?? `untracked-${Date.now()}`;
  if (activeManualRuns.has(runKey)) {
    logger.warn(`[${LOG_TAG}] Manual run already active runId=${runKey}`);
    return;
  }
  activeManualRuns.add(runKey);

  if (plan.planned.length === 0) {
    await englishCronJobTrackingService.finishRun(run, { status: 'skipped' });
    activeManualRuns.delete(runKey);
    return;
  }

  try {
    logger.info(
      `[${LOG_TAG}] Manual refill start runId=${runKey} models=${opts.models.map((m) => m.model).join(',')} buckets=${plan.planned.length}`
    );
    const tasks = plan.planned.map((item) => async () => {
      // Random từng bucket (không phải từng run) để trải đều trên các model admin chọn.
      const picked = _.sample(opts.models)!;
      await fillReadingBucketDetailed({
        cefrLevel: item.cefrLevel,
        topicId: item.topicId,
        topicName: item.topicName,
        count: item.count,
        model: picked.model,
        provider: picked.provider,
        skipCountCheck: true,
        logTag: LOG_TAG,
        trackingRun: run,
        trackingMetadata: { source: 'admin_manual', model: picked.model }
      });
    });

    const results = await runWithConcurrency(tasks, opts.concurrency);
    let succeeded = 0;
    let failed = 0;
    for (const [i, result] of results.entries()) {
      const item = plan.planned[i]!;
      if (result.status === 'fulfilled') {
        succeeded++;
      } else {
        failed++;
        const normalized = normalizeError(result.reason);
        logger.error(
          `[${LOG_TAG}] Manual bucket failed runId=${runKey} cefrLevel=${item.cefrLevel} topicId=${item.topicId}: ${normalized.message}`
        );
      }
    }
    logger.info(
      `[${LOG_TAG}] Manual refill done runId=${runKey}: succeeded=${succeeded} failed=${failed} total=${plan.planned.length}`
    );
  } finally {
    await englishCronJobTrackingService.summarizeRun(run);
    activeManualRuns.delete(runKey);
  }
}

// ─── Orchestration ────────────────────────────────────────────────────────────

export async function runScheduledReadingRefill(
  flowProducer: FlowProducer,
  trigger: { bullJobId: string; bullJobName: string; cron?: string }
): Promise<{ totalBuckets: number; deficientBuckets: number }> {
  const run = await englishCronJobTrackingService.startRun({
    jobKey: 'reading_refill',
    trigger: 'schedule',
    queueName: READING_REFILL_PARENT_QUEUE,
    bullJobId: trigger.bullJobId,
    bullJobName: trigger.bullJobName,
    metadata: { schedule: trigger.bullJobName, cron: trigger.cron }
  });

  try {
    const candidates = await scanReadingBuckets({ scope: 'deficient', thresholdCheck: 'target' });
    const plan = buildRefillPlan(candidates, {
      maxQuestionsPerRun: getEnglishConfigSnapshot().job_flags.readingRefillMaxPerRun,
      perBucketCap: getPerBucketGenerationCap()
    });

    if (plan.cappedByBudget) {
      logger.info(
        `[${LOG_TAG}] Reached max passages per run, planned ${plan.planned.length}/${plan.candidates.length} deficient buckets`
      );
    }

    if (plan.planned.length === 0) {
      logger.info(`[${LOG_TAG}] All ${plan.totalBuckets} buckets are full, nothing to refill`);
      await englishCronJobTrackingService.finishRun(run, {
        status: 'skipped',
        totals: { totalBuckets: plan.totalBuckets, deficientBuckets: 0 }
      });
      return { totalBuckets: plan.totalBuckets, deficientBuckets: 0 };
    }

    logger.info(`[${LOG_TAG}] Found ${plan.planned.length}/${plan.totalBuckets} deficient buckets, creating flow`);
    await englishCronJobTrackingService.updateRun(run, {
      totalBuckets: plan.totalBuckets,
      deficientBuckets: plan.planned.length
    });

    await executeScheduledPlanAsFlow(flowProducer, plan, run);

    return { totalBuckets: plan.totalBuckets, deficientBuckets: plan.planned.length };
  } catch (err) {
    const normalized = normalizeError(err);
    await englishCronJobTrackingService.finishRun(run, {
      status: 'failed',
      errorPhase: 'scan_topics',
      error: err
    });
    logger.error(
      `[${LOG_TAG}] Scan failed runId=${run?.runId ?? '-'} job=${trigger.bullJobName} phase=scan_topics: ${normalized.message}`
    );
    throw err;
  }
}

export interface ManualReadingRefillScopeParams {
  countPerBucket?: number;
  scope?: 'all' | 'deficient';
  filter?: ReadingBucketFilter;
  bucketKeys?: string[];
}

export interface ManualReadingRefillParams extends ManualReadingRefillScopeParams {
  models: ResolvedStudyModel[];
}

export interface ManualReadingRefillPlanResult {
  // Gồm cả bucket sẽ bị scope='deficient' bỏ qua, để preview nói được "đã đủ bài, bỏ qua"
  // thay vì lặng lẽ giấu bucket đi.
  matched: ReadingBucketCandidate[];
  plan: RefillPlanResult<ReadingBucketCandidate>;
}

/**
 * Plan mà một lần manual refill sẽ chạy với đúng bộ tham số này. Endpoint preview và
 * endpoint chạy thật dùng chung hàm này nên số liệu admin thấy trước khi bấm không lệch
 * khỏi số thực tế.
 */
export async function buildManualReadingRefillPlan(
  params: ManualReadingRefillScopeParams
): Promise<ManualReadingRefillPlanResult> {
  const scope = params.scope ?? 'all';
  const forceCount =
    params.countPerBucket ??
    (scope === 'all' ? getEnglishConfigSnapshot().reading_passage.manualFillDefaultCount : undefined);

  const matched = await scanReadingBuckets({
    scope: 'all',
    thresholdCheck: 'target',
    filter: params.filter,
    bucketKeys: params.bucketKeys
  });

  const candidates = scope === 'all' ? matched : matched.filter((b) => isReadingBucketDeficient(b, 'target'));

  const plan = buildRefillPlan(candidates, {
    maxQuestionsPerRun: null,
    perBucketCap: getPerBucketGenerationCap(),
    forceCount
  });

  return { matched, plan };
}

/**
 * Sinh reading in-process, chạy nền — dùng cho admin endpoint /admin/readings/refill.
 * Bỏ qua job_flags.readingRefillMaxPerRun: đây là hành động admin chủ động, không bị
 * budget tự động giới hạn.
 */
export async function runManualReadingRefill(
  params: ManualReadingRefillParams
): Promise<{ runId: string | null; totalBuckets: number }> {
  const scope = params.scope ?? 'all';
  const { plan } = await buildManualReadingRefillPlan(params);

  const run = await englishCronJobTrackingService.startRun({
    jobKey: 'reading_manual_fill',
    trigger: 'manual',
    totalBuckets: plan.totalBuckets,
    deficientBuckets: plan.planned.length,
    metadata: {
      models: params.models.map((m) => m.model),
      countPerBucket: params.countPerBucket,
      scope,
      filter: params.filter,
      selectedBuckets: params.bucketKeys?.length
    }
  });

  void executeManualPlanInProcess(plan, run, {
    models: params.models,
    concurrency: getEnglishConfigSnapshot().reading_passage.manualFillConcurrency
  });

  return { runId: run?.runId ?? null, totalBuckets: plan.planned.length };
}

export default {
  scanReadingBuckets,
  buildManualReadingRefillPlan,
  runScheduledReadingRefill,
  runManualReadingRefill
};
