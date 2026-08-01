import type { FlowProducer } from 'bullmq';
import logger from '@/configs/logger.config';
import { fillBucketDetailed, getQuestionGenQueue, type QuestionGenJobData } from '@/core/cron/question-gen.job';
import questionPoolService, { getMaxPoolSize, getPerBucketGenerationCap } from './questionPool.service';
import topicService from './topic.service';
import type { QuizType } from './questionTypes';
import type { DifficultyContext } from './study.service';
import { getEnglishConfigSnapshot } from './englishConfig.service';
import englishCronJobTrackingService, {
  normalizeError,
  type EnglishCronRunRef
} from './englishCronJobTracking.service';

// Queue name string ở đây (thay vì trong pool-refill.job.ts) vì cả job bootstrap lẫn
// module này đều cần biết tên queue — job.ts dùng để tạo Queue/Worker, module này dùng
// khi build flow children.
export const POOL_REFILL_PARENT_QUEUE = 'english-pool-refill';
export const POOL_REFILL_CHILD_QUEUE = 'english-pool-refill-child';

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

function bucketKeyOf(input: { engLevel: string; topicId: number | null; quizType: string }): string {
  return `${input.engLevel}:${input.topicId ?? 'null'}:${input.quizType}`;
}

// ─── Scan ─────────────────────────────────────────────────────────────────────

export interface RefillBucketCandidate {
  engLevel: DifficultyContext['engLevel'];
  quizType: QuizType;
  optionCount: 4 | 5;
  topicId: number | null;
  topicName: string | null;
  currentCount: number;
  deficiency: number;
}

export interface ScanBucketsOptions {
  // 'all' = mọi bucket (target/threshold không lọc, dùng cho manual force-fill).
  // 'deficient' = chỉ bucket dưới ngưỡng (target hoặc ratio, xem thresholdCheck).
  scope: 'deficient' | 'all';
  thresholdCheck?: 'target' | 'ratio';
}

/**
 * Quét toàn bộ bucket (topic × engLevel × quizType), sắp xếp theo:
 * 1. deficiency giảm dần (bucket thiếu nhiều nhất trước)
 * 2. lần refill thành công gần nhất tăng dần, null trước (bucket chưa từng được đụng tới ưu tiên)
 * 3. bucketKey tăng dần (tie-break xác định)
 *
 * (2) là điểm mấu chốt chống đói: nếu chỉ sort theo deficiency, khi 1 lần chạy bị budget-cap
 * giữa chừng, và perBucketGenerationCap không đủ làm rỗng hết deficiency trong 1 lần chạm, các
 * bucket đứng sau trong tie-break cũ (thứ tự cố định topic/level/quizType) sẽ bị đói mãi mãi.
 * lastRefillAttemptAt lấy trực tiếp từ english_cron_job_buckets (không cần bảng/cột mới).
 */
export async function scanBuckets(options: ScanBucketsOptions): Promise<RefillBucketCandidate[]> {
  const topics = await topicService.getAllActiveTopics();
  const maxPool = getMaxPoolSize();
  const quizTypes = getEnabledQuizTypes();
  const threshold = questionPoolService.getRefillThreshold();

  const all: RefillBucketCandidate[] = [];
  for (const topic of topics) {
    for (const engLevel of ENG_LEVELS) {
      for (const quizType of quizTypes) {
        const currentCount = await questionPoolService.getPoolCount(engLevel, quizType, topic.id);
        all.push({
          engLevel,
          quizType,
          optionCount: getOptionCount(engLevel),
          topicId: topic.id,
          topicName: topic.name,
          currentCount,
          deficiency: maxPool - currentCount
        });
      }
    }
  }

  const filtered =
    options.scope === 'all'
      ? all
      : all.filter((b) => (options.thresholdCheck === 'ratio' ? b.currentCount < threshold : b.currentCount < maxPool));

  if (filtered.length === 0) return filtered;

  const lastRefillMap = await englishCronJobTrackingService.getLastBucketRefillTimestamps(
    filtered.map((b) => bucketKeyOf(b))
  );

  return filtered.sort((a, b) => {
    if (b.deficiency !== a.deficiency) return b.deficiency - a.deficiency;
    const aLast = lastRefillMap.get(bucketKeyOf(a))?.getTime() ?? -Infinity;
    const bLast = lastRefillMap.get(bucketKeyOf(b))?.getTime() ?? -Infinity;
    if (aLast !== bLast) return aLast - bLast;
    return bucketKeyOf(a).localeCompare(bucketKeyOf(b));
  });
}

// ─── Plan (pure, budget-aware) ────────────────────────────────────────────────

export interface RefillPlanItem extends RefillBucketCandidate {
  count: number;
}

export interface RefillPlanResult {
  totalBuckets: number;
  candidates: RefillBucketCandidate[];
  planned: RefillPlanItem[];
  cappedByBudget: boolean;
}

export interface BuildRefillPlanOptions {
  // null = không giới hạn tổng số câu/lần chạy (dùng cho admin manual force-fill).
  maxQuestionsPerRun: number | null;
  perBucketCap: number;
  // Có giá trị → mọi bucket được plan đúng forceCount câu (bỏ qua deficiency sống,
  // tương đương skipPoolCheck cũ). Không có → dùng deficiency thực tế.
  forceCount?: number;
}

export function buildRefillPlan(candidates: RefillBucketCandidate[], opts: BuildRefillPlanOptions): RefillPlanResult {
  const planned: RefillPlanItem[] = [];
  let plannedQuestions = 0;
  let cappedByBudget = false;

  for (const candidate of candidates) {
    if (opts.maxQuestionsPerRun !== null && plannedQuestions >= opts.maxQuestionsPerRun) {
      cappedByBudget = true;
      break;
    }

    let count = opts.forceCount !== undefined ? opts.forceCount : Math.max(0, candidate.deficiency);
    count = Math.min(count, opts.perBucketCap);

    if (opts.maxQuestionsPerRun !== null && plannedQuestions + count > opts.maxQuestionsPerRun) {
      count = opts.maxQuestionsPerRun - plannedQuestions;
      cappedByBudget = true;
    }

    if (count <= 0) continue;
    plannedQuestions += count;
    planned.push({ ...candidate, count });
  }

  return { totalBuckets: candidates.length, candidates, planned, cappedByBudget };
}

// ─── Execute: queue-based (scheduled + on-demand) ──────────────────────────────

function toQuestionGenJobData(item: RefillPlanItem, trackingRunId?: string): QuestionGenJobData {
  return {
    engLevel: item.engLevel,
    quizType: item.quizType,
    optionCount: item.optionCount,
    topicId: item.topicId,
    topicName: item.topicName,
    count: item.count,
    trackingRunId
  };
}

async function executeScheduledPlanAsFlow(
  flowProducer: FlowProducer,
  plan: RefillPlanResult,
  trackingRun: EnglishCronRunRef | null
): Promise<void> {
  const children = plan.planned.map((item) => ({
    name: `fill-${item.engLevel}-${item.topicId ?? 'null'}-${item.quizType}`,
    queueName: POOL_REFILL_CHILD_QUEUE,
    data: toQuestionGenJobData(item, trackingRun?.runId),
    opts: { removeOnComplete: true, removeOnFail: 50 }
  }));

  await flowProducer.add({
    name: 'pool-refill-scan',
    queueName: POOL_REFILL_PARENT_QUEUE,
    data: { totalBuckets: plan.totalBuckets, deficientBuckets: children.length, trackingRunId: trackingRun?.runId },
    opts: { removeOnComplete: true, removeOnFail: 10 },
    children
  });
}

// ─── Execute: in-process (manual/admin) ────────────────────────────────────────

const activeManualRuns = new Set<string>();

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

async function executeManualPlanInProcess(
  plan: RefillPlanResult,
  run: EnglishCronRunRef | null,
  opts: { model: string; concurrency: number }
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
    logger.info(`[${LOG_TAG}] Manual refill start runId=${runKey} model=${opts.model} buckets=${plan.planned.length}`);
    const tasks = plan.planned.map((item) => async () => {
      await fillBucketDetailed({
        engLevel: item.engLevel,
        quizType: item.quizType,
        optionCount: item.optionCount,
        topicId: item.topicId,
        topicName: item.topicName,
        count: item.count,
        model: opts.model,
        skipPoolCheck: true,
        logTag: LOG_TAG,
        trackingRun: run,
        trackingMetadata: { source: 'admin_manual', model: opts.model }
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
          `[${LOG_TAG}] Manual bucket failed runId=${runKey} engLevel=${item.engLevel} topicId=${item.topicId} quizType=${item.quizType}: ${normalized.message}`
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

// ─── Orchestration ──────────────────────────────────────────────────────────

export async function runScheduledRefill(
  flowProducer: FlowProducer,
  trigger: { bullJobId: string; bullJobName: string; cron?: string }
): Promise<{ totalBuckets: number; deficientBuckets: number }> {
  const run = await englishCronJobTrackingService.startRun({
    jobKey: 'pool_refill',
    trigger: 'schedule',
    queueName: POOL_REFILL_PARENT_QUEUE,
    bullJobId: trigger.bullJobId,
    bullJobName: trigger.bullJobName,
    metadata: { schedule: trigger.bullJobName, cron: trigger.cron }
  });

  try {
    const candidates = await scanBuckets({ scope: 'deficient', thresholdCheck: 'target' });
    const plan = buildRefillPlan(candidates, {
      maxQuestionsPerRun: getEnglishConfigSnapshot().job_flags.poolRefillMaxQuestionsPerRun,
      perBucketCap: getPerBucketGenerationCap()
    });

    if (plan.cappedByBudget) {
      logger.info(
        `[${LOG_TAG}] Reached max questions per run, planned ${plan.planned.length}/${plan.candidates.length} deficient buckets`
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

export interface OnDemandRefillInput {
  engLevel: DifficultyContext['engLevel'];
  topicId: number | null;
  topicName: string | null;
  quizType: QuizType;
  optionCount: 4 | 5;
}

// Backstop nhẹ cho quiz serving (pop-miss) — chỉ refill 1 bucket cụ thể, ngưỡng
// ratio (không phải target), qua BullMQ queue. KHÔNG đổi hành vi so với bản cũ
// (questionPoolTrigger.service.ts's ensurePoolFilled).
export async function runOnDemandRefill(input: OnDemandRefillInput): Promise<{ enqueued: boolean }> {
  try {
    if (!getEnglishConfigSnapshot().job_flags.questionGenEnabled) {
      logger.info(`[${LOG_TAG}] Question-gen disabled, skip on-demand refill`);
      return { enqueued: false };
    }

    const currentCount = await questionPoolService.getPoolCount(input.engLevel, input.quizType, input.topicId);
    const threshold = questionPoolService.getRefillThreshold();
    if (currentCount >= threshold) return { enqueued: false };

    const needed = getMaxPoolSize() - currentCount;
    logger.info(
      `[${LOG_TAG}] Pool low (${currentCount}/${threshold}) for engLevel=${input.engLevel} topicId=${input.topicId} quizType=${input.quizType}, adding refill job count=${needed}`
    );

    const jobId = `refill_${input.engLevel}_${input.topicId ?? 'null'}_${input.quizType}`;
    await getQuestionGenQueue().add(
      jobId,
      {
        engLevel: input.engLevel,
        quizType: input.quizType,
        optionCount: input.optionCount,
        topicId: input.topicId,
        topicName: input.topicName,
        count: needed
      },
      { jobId }
    );
    return { enqueued: true };
  } catch (err) {
    logger.warn(
      `[${LOG_TAG}] Failed to trigger on-demand refill for engLevel=${input.engLevel} topicId=${input.topicId} quizType=${input.quizType}: ${err}`
    );
    return { enqueued: false };
  }
}

export interface ManualRefillParams {
  model: string;
  countPerBucket?: number;
  scope?: 'all' | 'deficient';
}

// Refill toàn bộ (hoặc chỉ bucket thiếu) in-process, chạy nền — dùng cho admin
// endpoint /admin/pool/refill. scope='all' + không truyền countPerBucket → force
// mỗi bucket đúng question_pool.manualFillDefaultCount câu, bất kể đang đầy hay
// thiếu (tương đương skipPoolCheck cũ). scope='deficient' + không truyền
// countPerBucket → chỉ top-up đúng phần còn thiếu tới maxPerBucket.
export async function runManualRefill(
  params: ManualRefillParams
): Promise<{ runId: string | null; totalBuckets: number }> {
  const scope = params.scope ?? 'all';
  const forceCount =
    params.countPerBucket ??
    (scope === 'all' ? getEnglishConfigSnapshot().question_pool.manualFillDefaultCount : undefined);

  const candidates = await scanBuckets({ scope, thresholdCheck: 'target' });
  const plan = buildRefillPlan(candidates, {
    maxQuestionsPerRun: null,
    perBucketCap: getPerBucketGenerationCap(),
    forceCount
  });

  const run = await englishCronJobTrackingService.startRun({
    jobKey: 'manual_fill',
    trigger: 'manual',
    totalBuckets: plan.totalBuckets,
    deficientBuckets: plan.planned.length,
    metadata: { model: params.model, countPerBucket: params.countPerBucket, scope }
  });

  void executeManualPlanInProcess(plan, run, {
    model: params.model,
    concurrency: getEnglishConfigSnapshot().question_pool.manualFillConcurrency
  });

  return { runId: run?.runId ?? null, totalBuckets: plan.planned.length };
}

export default {
  scanBuckets,
  buildRefillPlan,
  runScheduledRefill,
  runOnDemandRefill,
  runManualRefill
};
