import type { FlowProducer } from 'bullmq';
import _ from 'lodash';
import logger from '@/configs/logger.config';
import { runWithConcurrency } from '@/utils/concurrency';
import type { ResolvedStudyModel } from '@/configs/aiClient.config';
import {
  fillReadingQuestionBucketDetailed,
  type ReadingQuestionGenJobData
} from '@/core/cron/reading-question-gen.job';
import readingPassageService from './readingPassage.service';
import readingQuestionService, {
  getMaxGenerationAttempts,
  getPerPassageGenerationCap,
  getQuestionsPerPassage
} from './readingQuestion.service';
import { buildRefillPlan, type RefillPlanResult } from './poolRefill.service';
import { getEnglishConfigSnapshot } from './englishConfig.service';
import type { EngLevel } from './questionTypes';
import englishCronJobTrackingService, {
  normalizeError,
  type EnglishCronRunRef
} from './englishCronJobTracking.service';

export const READING_QUESTION_REFILL_PARENT_QUEUE = 'english-reading-question-refill';
export const READING_QUESTION_REFILL_CHILD_QUEUE = 'english-reading-question-refill-child';

const LOG_TAG = 'ReadingQuestionRefill';

/**
 * Bucket của pipeline này là MỘT BÀI ĐỌC, không phải tổ hợp (cefrLevel, topicId) như
 * reading passage hay (engLevel, quizType, topicId) như question pool. Một bài hoặc đã
 * đủ câu hỏi, hoặc chưa — nên key phải mang passageId.
 */
export function readingQuestionBucketKeyOf(passageId: number): string {
  return `rq:${passageId}`;
}

// ─── Scan ─────────────────────────────────────────────────────────────────────

export interface ReadingQuestionBucketCandidate {
  passageId: number;
  title: string;
  cefrLevel: EngLevel;
  topicId: number | null;
  topicName: string | null;
  currentCount: number;
  deficiency: number;
}

export interface ReadingQuestionBucketFilter {
  cefrLevels?: EngLevel[];
  topicIds?: number[];
  passageIds?: number[];
}

export interface ScanReadingQuestionBucketsOptions {
  mode: 'deficient' | 'all';
  filter?: ReadingQuestionBucketFilter;
  bucketKeys?: string[];
}

function hasFilterValues<T>(values: T[] | undefined): values is T[] {
  return values !== undefined && values.length > 0;
}

/**
 * Quét các bài đọc còn thiếu câu hỏi.
 *
 * Khác scanReadingBuckets/scanBuckets: KHÔNG dùng getLastBucketRefillTimestamps làm
 * tie-break. Tie-break đó tồn tại để chống đói khi một bucket cần refill vĩnh viễn
 * (pool bị pop liên tục). Một passage thì fill đúng một lần rồi biến mất khỏi scan, nên
 * chỉ cần thứ tự xác định: deficiency giảm dần → passageId tăng dần (bài cũ trước).
 */
export async function scanReadingQuestionBuckets(
  options: ScanReadingQuestionBucketsOptions
): Promise<ReadingQuestionBucketCandidate[]> {
  const questionsPerPassage = getQuestionsPerPassage();
  const filter = options.filter;

  const passages = await readingPassageService.listQuestionGenCandidates({
    cefrLevels: hasFilterValues(filter?.cefrLevels) ? filter.cefrLevels : undefined,
    topicIds: hasFilterValues(filter?.topicIds) ? filter.topicIds : undefined,
    passageIds: hasFilterValues(filter?.passageIds) ? filter.passageIds : undefined,
    maxAttempts: getMaxGenerationAttempts()
  });

  const countsByPassage = await readingQuestionService.getCountsByPassage();
  const bucketKeyFilter = hasFilterValues(options.bucketKeys) ? new Set(options.bucketKeys) : null;

  const all: ReadingQuestionBucketCandidate[] = [];
  for (const passage of passages) {
    if (bucketKeyFilter && !bucketKeyFilter.has(readingQuestionBucketKeyOf(passage.id))) continue;

    const currentCount = countsByPassage.get(passage.id) ?? 0;
    all.push({
      passageId: passage.id,
      title: passage.title,
      cefrLevel: passage.cefrLevel as EngLevel,
      topicId: passage.topicId,
      topicName: passage.topicName,
      currentCount,
      deficiency: questionsPerPassage - currentCount
    });
  }

  const filtered = options.mode === 'all' ? all : all.filter((b) => b.deficiency > 0);

  return filtered.sort((a, b) => {
    if (b.deficiency !== a.deficiency) return b.deficiency - a.deficiency;
    return a.passageId - b.passageId;
  });
}

// ─── Execute: queue-based (scheduled) ─────────────────────────────────────────

type ReadingQuestionRefillPlanItem = ReadingQuestionBucketCandidate & { count: number };

function toReadingQuestionGenJobData(
  item: ReadingQuestionRefillPlanItem,
  trackingRunId?: string
): ReadingQuestionGenJobData {
  return {
    passageId: item.passageId,
    cefrLevel: item.cefrLevel,
    topicId: item.topicId,
    topicName: item.topicName,
    count: item.count,
    trackingRunId
  };
}

async function executeScheduledPlanAsFlow(
  flowProducer: FlowProducer,
  plan: RefillPlanResult<ReadingQuestionBucketCandidate>,
  trackingRun: EnglishCronRunRef | null
): Promise<void> {
  const children = plan.planned.map((item) => ({
    name: `reading-question-${item.passageId}`,
    queueName: READING_QUESTION_REFILL_CHILD_QUEUE,
    data: toReadingQuestionGenJobData(item, trackingRun?.runId),
    opts: { removeOnComplete: true, removeOnFail: 50 }
  }));

  await flowProducer.add({
    name: 'reading-question-refill-scan',
    queueName: READING_QUESTION_REFILL_PARENT_QUEUE,
    data: { totalBuckets: plan.totalBuckets, deficientBuckets: children.length, trackingRunId: trackingRun?.runId },
    opts: { removeOnComplete: true, removeOnFail: 10 },
    children
  });
}

// ─── Execute: in-process (manual/admin) ───────────────────────────────────────

const activeManualRuns = new Set<string>();

async function executeManualPlanInProcess(
  plan: RefillPlanResult<ReadingQuestionBucketCandidate>,
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
      `[${LOG_TAG}] Manual refill start runId=${runKey} models=${opts.models.map((m) => m.model).join(',')} passages=${plan.planned.length}`
    );
    const tasks = plan.planned.map((item) => async () => {
      // Random từng bucket (không phải từng run) để trải đều trên các model admin chọn.
      const picked = _.sample(opts.models)!;
      await fillReadingQuestionBucketDetailed({
        passageId: item.passageId,
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
          `[${LOG_TAG}] Manual bucket failed runId=${runKey} passageId=${item.passageId}: ${normalized.message}`
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

export async function runScheduledReadingQuestionRefill(
  flowProducer: FlowProducer,
  trigger: { bullJobId: string; bullJobName: string; cron?: string }
): Promise<{ totalBuckets: number; deficientBuckets: number }> {
  const run = await englishCronJobTrackingService.startRun({
    jobKey: 'reading_question_refill',
    trigger: 'schedule',
    queueName: READING_QUESTION_REFILL_PARENT_QUEUE,
    bullJobId: trigger.bullJobId,
    bullJobName: trigger.bullJobName,
    metadata: { schedule: trigger.bullJobName, cron: trigger.cron }
  });

  try {
    const candidates = await scanReadingQuestionBuckets({ mode: 'deficient' });
    const plan = buildRefillPlan(candidates, {
      // Đơn vị budget ở đây là CÂU HỎI, mỗi passage ăn tối đa perPassageGenerationCap câu.
      maxQuestionsPerRun: getEnglishConfigSnapshot().job_flags.readingQuestionRefillMaxPerRun,
      perBucketCap: getPerPassageGenerationCap()
    });

    if (plan.cappedByBudget) {
      logger.info(
        `[${LOG_TAG}] Reached max questions per run, planned ${plan.planned.length}/${plan.candidates.length} deficient passages`
      );
    }

    if (plan.planned.length === 0) {
      logger.info(`[${LOG_TAG}] All ${plan.totalBuckets} passages have their questions, nothing to refill`);
      await englishCronJobTrackingService.finishRun(run, {
        status: 'skipped',
        totals: { totalBuckets: plan.totalBuckets, deficientBuckets: 0 }
      });
      return { totalBuckets: plan.totalBuckets, deficientBuckets: 0 };
    }

    logger.info(
      `[${LOG_TAG}] Found ${plan.planned.length}/${plan.totalBuckets} passages needing questions, creating flow`
    );
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
      errorPhase: 'scan_passages',
      error: err
    });
    logger.error(
      `[${LOG_TAG}] Scan failed runId=${run?.runId ?? '-'} job=${trigger.bullJobName} phase=scan_passages: ${normalized.message}`
    );
    throw err;
  }
}

export interface ManualReadingQuestionRefillModeParams {
  mode?: 'all' | 'deficient';
  filter?: ReadingQuestionBucketFilter;
  bucketKeys?: string[];
}

export interface ManualReadingQuestionRefillParams extends ManualReadingQuestionRefillModeParams {
  models: ResolvedStudyModel[];
}

export interface ManualReadingQuestionRefillPlanResult {
  matched: ReadingQuestionBucketCandidate[];
  plan: RefillPlanResult<ReadingQuestionBucketCandidate>;
}

/**
 * Plan mà một lần manual refill sẽ chạy với đúng bộ tham số này — endpoint preview và
 * endpoint chạy thật dùng chung hàm này nên số liệu không lệch.
 *
 * Không có countPerBucket như 2 pipeline kia: số câu mỗi bài là hằng số nghiệp vụ
 * (questionsPerPassage), admin không chọn từng lần.
 */
export async function buildManualReadingQuestionRefillPlan(
  params: ManualReadingQuestionRefillModeParams
): Promise<ManualReadingQuestionRefillPlanResult> {
  const mode = params.mode ?? 'deficient';

  const matched = await scanReadingQuestionBuckets({
    mode: 'all',
    filter: params.filter,
    bucketKeys: params.bucketKeys
  });

  const candidates = mode === 'all' ? matched : matched.filter((b) => b.deficiency > 0);

  const plan = buildRefillPlan(candidates, {
    maxQuestionsPerRun: null,
    perBucketCap: getPerPassageGenerationCap()
  });

  return { matched, plan };
}

/**
 * Sinh câu hỏi in-process, chạy nền — dùng cho /admin/reading-questions/refill.
 * Bỏ qua job_flags.readingQuestionRefillMaxPerRun: đây là hành động admin chủ động.
 */
export async function runManualReadingQuestionRefill(
  params: ManualReadingQuestionRefillParams
): Promise<{ runId: string | null; totalBuckets: number }> {
  const mode = params.mode ?? 'deficient';
  const { plan } = await buildManualReadingQuestionRefillPlan(params);

  const run = await englishCronJobTrackingService.startRun({
    jobKey: 'reading_question_manual_fill',
    trigger: 'manual',
    totalBuckets: plan.totalBuckets,
    deficientBuckets: plan.planned.length,
    metadata: {
      models: params.models.map((m) => m.model),
      mode,
      filter: params.filter,
      selectedBuckets: params.bucketKeys?.length
    }
  });

  void executeManualPlanInProcess(plan, run, {
    models: params.models,
    concurrency: getEnglishConfigSnapshot().reading_question.manualFillConcurrency
  });

  return { runId: run?.runId ?? null, totalBuckets: plan.planned.length };
}

export default {
  scanReadingQuestionBuckets,
  buildManualReadingQuestionRefillPlan,
  runScheduledReadingQuestionRefill,
  runManualReadingQuestionRefill
};
