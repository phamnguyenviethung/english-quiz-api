import _ from 'lodash';
import logger from '@/configs/logger.config';
import redisClient from '@/configs/redis.config';
import { runWithConcurrency } from '@/utils/concurrency';
import type { ModelContext, ResolvedStudyModel } from '@/configs/aiClient.config';
import aiModelService, { computeCostUsd } from '@/core/services/ai/aiModel.service';
import englishCronJobTrackingService, {
  normalizeError,
  type EnglishCronRunRef
} from './englishCronJobTracking.service';
import { getEnglishConfigSnapshot } from './englishConfig.service';
import { bucketKeyOf, scanBuckets, type BucketFilter, type RefillBucketCandidate } from './poolRefill.service';
import questionPoolService from './questionPool.service';
import { SIBLING_SUPPORTED_QUIZ_TYPES } from './questionTypes';
import type { QuizType } from './questionTypes';
import siblingQuestionService, { SIBLING_MAX_PER_CALL } from './siblingQuestion.service';

const LOG_TAG = 'SiblingRefill';

// ─── Shared per-bucket processing (dùng chung cho cron sibling-gen và manual bulk) ──

export interface ProcessSiblingBucketOptions {
  /** Số câu gốc tối đa lấy trong bucket để làm nguồn. */
  sourceLimit: number;
  /** Số sibling sinh cho mỗi câu gốc (1..SIBLING_MAX_PER_CALL). */
  siblingsPerSource: number;
  /** OpenRouter model id. Bỏ trống → generateSiblingsForSource tự resolve theo context. */
  model?: string;
  /** true = ghi bất kể pool cap; false = tôn trọng maxPerBucket. */
  forceInsert: boolean;
  context: ModelContext;
  /** Trần tổng sibling còn được phép ghi cho lượt xử lý bucket này (vd budget của cả run). */
  budgetLeft: number;
}

/**
 * Xử lý MỘT bucket: lấy câu gốc → sinh sibling từng câu → ghi tracking bucket + model attempt.
 * Khi `forceInsert = false`, số sibling đặt sinh được **cắt theo `candidate.deficiency`** — mỗi
 * bucket chỉ sinh vừa đủ để chạm `maxPerBucket`, không đốt token cho phần chắc chắn bị pool cap bỏ.
 * Không throw ra ngoài (lỗi từng câu gốc chỉ log), không tự khoá Redis (caller lo).
 */
export async function processSiblingBucket(
  run: EnglishCronRunRef | null,
  candidate: RefillBucketCandidate,
  opts: ProcessSiblingBucketOptions
): Promise<{ inserted: number; generated: number }> {
  // Với deficient (forceInsert=false): trần thực = min(trần caller đưa, số câu bucket còn thiếu).
  const effectiveBudget = opts.forceInsert
    ? Math.max(0, opts.budgetLeft)
    : Math.max(0, Math.min(opts.budgetLeft, candidate.deficiency));
  if (effectiveBudget <= 0) return { inserted: 0, generated: 0 };

  // Chỉ lấy đủ số câu gốc cần để phủ effectiveBudget — cần ít sibling thì khỏi bốc thừa nguồn.
  const sourceLimit = Math.min(opts.sourceLimit, Math.max(1, Math.ceil(effectiveBudget / opts.siblingsPerSource)));
  const requestedCount = effectiveBudget;

  const bucket = await englishCronJobTrackingService.startBucket(run, {
    engLevel: candidate.engLevel,
    quizType: candidate.quizType,
    optionCount: candidate.optionCount,
    topicId: candidate.topicId,
    topicName: candidate.topicName,
    requestedCount,
    bucketKey: bucketKeyOf(candidate),
    metadata: { source: opts.context === 'schedule' ? 'sibling_gen' : 'sibling_manual' }
  });
  const startedAt = new Date();

  try {
    const sourceIds = await questionPoolService.pickSiblingSourceIds(
      candidate.engLevel,
      candidate.quizType,
      candidate.topicId,
      sourceLimit
    );

    let generated = 0;
    let inserted = 0;
    let tokenIn = 0;
    let tokenOut = 0;
    let model = opts.model ?? '';
    let budgetLeft = effectiveBudget;

    for (const sourceId of sourceIds) {
      if (budgetLeft <= 0) break;
      const count = Math.min(opts.siblingsPerSource, budgetLeft);
      try {
        const res = await siblingQuestionService.generateSiblingsForSource(sourceId, {
          count,
          model: opts.model,
          context: opts.context,
          forceInsert: opts.forceInsert
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
      requestedCount,
      generatedCount: generated,
      tokenIn,
      tokenOut,
      costUsd,
      startedAt
    });
    await englishCronJobTrackingService.finishBucket(bucket, {
      status: 'success',
      requestedCount,
      generatedCount: generated,
      insertedCount: inserted,
      skippedCount: Math.max(0, generated - inserted),
      tokenIn,
      tokenOut,
      costUsd
    });
    logger.info(
      `[${LOG_TAG}] Bucket done engLevel=${candidate.engLevel} topicId=${candidate.topicId} ` +
        `quizType=${candidate.quizType} sources=${sourceIds.length} inserted=${inserted}`
    );
    return { inserted, generated };
  } catch (err) {
    await englishCronJobTrackingService.finishBucket(bucket, {
      status: 'failed',
      errorPhase: 'generate_model',
      error: err
    });
    logger.error(
      `[${LOG_TAG}] Bucket failed engLevel=${candidate.engLevel} topicId=${candidate.topicId} ` +
        `quizType=${candidate.quizType}: ${normalizeError(err).message}`
    );
    return { inserted: 0, generated: 0 };
  }
}

// ─── Manual bulk sibling refill (admin trigger, giống poolRefill.runManualRefill) ──

export interface SiblingRefillScopeParams {
  scope?: 'all' | 'deficient';
  sourcesPerBucket?: number;
  siblingsPerSource?: number;
  /** quizTypes đã được validate ⊆ SIBLING_SUPPORTED_QUIZ_TYPES ở controller. */
  filter?: BucketFilter;
  bucketKeys?: string[];
}

export interface SiblingRefillParams extends SiblingRefillScopeParams {
  models: ResolvedStudyModel[];
}

export interface SiblingPlanItem extends RefillBucketCandidate {
  sourceCount: number;
  plannedSources: number;
  plannedCount: number;
}

export interface SiblingRefillPlan {
  matched: SiblingPlanItem[];
  planned: SiblingPlanItem[];
  totalPlannedSiblings: number;
}

const SIBLING_SUPPORTED_SET = new Set<string>(SIBLING_SUPPORTED_QUIZ_TYPES);

function resolveKnobs(params: SiblingRefillScopeParams): { sourcesPerBucket: number; siblingsPerSource: number } {
  const cfg = getEnglishConfigSnapshot().sibling_gen;
  const sourcesPerBucket = Math.max(1, Math.trunc(params.sourcesPerBucket ?? cfg.sourcesPerBucketPerRun));
  const siblingsPerSource = Math.min(
    SIBLING_MAX_PER_CALL,
    Math.max(1, Math.trunc(params.siblingsPerSource ?? cfg.siblingsPerSource))
  );
  return { sourcesPerBucket, siblingsPerSource };
}

/**
 * Plan mà một lần manual sibling refill sẽ chạy. Dùng chung cho endpoint preview và endpoint
 * chạy thật (`GET /admin/pool/siblings/buckets` & `POST /admin/pool/siblings/refill`).
 */
export async function buildManualSiblingPlan(params: SiblingRefillScopeParams): Promise<SiblingRefillPlan> {
  const scope = params.scope ?? 'deficient';
  const { sourcesPerBucket, siblingsPerSource } = resolveKnobs(params);

  const quizTypes = (params.filter?.quizTypes ?? SIBLING_SUPPORTED_QUIZ_TYPES).filter((q) =>
    SIBLING_SUPPORTED_SET.has(q)
  ) as QuizType[];

  const [candidates, sourceCounts] = await Promise.all([
    scanBuckets({
      scope: 'all',
      thresholdCheck: 'target',
      filter: { ...params.filter, quizTypes },
      bucketKeys: params.bucketKeys
    }),
    questionPoolService.getSiblingSourceCountsByBucket()
  ]);

  const matched: SiblingPlanItem[] = candidates.map((candidate) => {
    const sourceCount = sourceCounts.get(bucketKeyOf(candidate)) ?? 0;
    const maxSiblings = Math.min(sourcesPerBucket, sourceCount) * siblingsPerSource;
    const plannedCount = scope === 'deficient' ? Math.min(maxSiblings, Math.max(0, candidate.deficiency)) : maxSiblings;
    const plannedSources = siblingsPerSource > 0 ? Math.ceil(plannedCount / siblingsPerSource) : 0;
    return { ...candidate, sourceCount, plannedSources, plannedCount };
  });

  const planned = matched.filter((item) => item.plannedCount > 0);
  const totalPlannedSiblings = planned.reduce((sum, item) => sum + item.plannedCount, 0);
  return { matched, planned, totalPlannedSiblings };
}

const activeManualRuns = new Set<string>();

async function executeManualSiblingPlanInProcess(
  planned: SiblingPlanItem[],
  run: EnglishCronRunRef | null,
  opts: { models: ResolvedStudyModel[]; scope: 'all' | 'deficient'; siblingsPerSource: number; concurrency: number }
): Promise<void> {
  const runKey = run?.runId ?? `untracked-${Date.now()}`;
  if (activeManualRuns.has(runKey)) {
    logger.warn(`[${LOG_TAG}] Manual run already active runId=${runKey}`);
    return;
  }
  activeManualRuns.add(runKey);

  if (planned.length === 0) {
    await englishCronJobTrackingService.finishRun(run, { status: 'skipped' });
    activeManualRuns.delete(runKey);
    return;
  }

  try {
    logger.info(
      `[${LOG_TAG}] Manual sibling refill start runId=${runKey} scope=${opts.scope} ` +
        `models=${opts.models.map((m) => m.model).join(',') || '(all manual)'} buckets=${planned.length}`
    );

    const tasks = planned.map((item) => async () => {
      const lockKey = `question-pool:lock:${item.engLevel}:${item.topicId ?? 'null'}:${item.quizType}`;
      const locked = await redisClient.set(lockKey, '1', 'EX', 300, 'NX');
      if (locked !== 'OK') {
        logger.info(`[${LOG_TAG}] Bucket locked, skip ${lockKey}`);
        return;
      }
      try {
        const picked = _.sample(opts.models);
        await processSiblingBucket(run, item, {
          sourceLimit: item.plannedSources,
          siblingsPerSource: opts.siblingsPerSource,
          model: picked?.model,
          forceInsert: opts.scope === 'all',
          context: 'manual',
          budgetLeft: item.plannedCount
        });
      } finally {
        try {
          await redisClient.del(lockKey);
        } catch (err) {
          logger.warn(`[${LOG_TAG}] Failed to release lock ${lockKey}: ${err}`);
        }
      }
    });

    await runWithConcurrency(tasks, opts.concurrency);
  } finally {
    await englishCronJobTrackingService.summarizeRun(run, { forceFinishRunningBuckets: true });
    activeManualRuns.delete(runKey);
    logger.info(`[${LOG_TAG}] Manual sibling refill done runId=${runKey}`);
  }
}

export async function runManualSiblingRefill(
  params: SiblingRefillParams
): Promise<{ runId: string | null; totalBuckets: number }> {
  const scope = params.scope ?? 'deficient';
  const { sourcesPerBucket, siblingsPerSource } = resolveKnobs(params);
  const { matched, planned } = await buildManualSiblingPlan(params);

  const run = await englishCronJobTrackingService.startRun({
    jobKey: 'sibling_gen_manual',
    trigger: 'manual',
    totalBuckets: matched.length,
    deficientBuckets: planned.length,
    metadata: {
      models: params.models.map((m) => m.model),
      scope,
      sourcesPerBucket,
      siblingsPerSource,
      filter: params.filter,
      selectedBuckets: params.bucketKeys?.length
    }
  });

  void executeManualSiblingPlanInProcess(planned, run, {
    models: params.models,
    scope,
    siblingsPerSource,
    concurrency: getEnglishConfigSnapshot().question_pool.manualFillConcurrency
  });

  return { runId: run?.runId ?? null, totalBuckets: planned.length };
}

export default {
  buildManualSiblingPlan,
  runManualSiblingRefill,
  processSiblingBucket
};
