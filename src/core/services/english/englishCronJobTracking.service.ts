import { and, desc, eq, gte, inArray, lt, lte, ne } from 'drizzle-orm';
import db from '@/configs/orm.config';
import logger from '@/configs/logger.config';
import {
  englishCronJobBucket,
  englishCronJobModelAttempt,
  englishCronJobRun,
  type EnglishCronJobBucket,
  type EnglishCronJobModelAttempt,
  type EnglishCronJobRun
} from '@/core/db/schema/main';

export type EnglishCronJobStatus = 'running' | 'success' | 'partial_success' | 'failed' | 'skipped';
export type EnglishCronJobKey = 'question_gen' | 'pool_refill' | 'manual_fill';
export type EnglishCronJobTrigger = 'bullmq' | 'schedule' | 'manual' | 'manual_retry';
export type EnglishCronJobErrorPhase =
  | 'scan_topics'
  | 'pool_count'
  | 'generate_model'
  | 'push_questions'
  | 'flow_create'
  | 'manual_retry'
  | 'lock_cleanup'
  | 'unknown';

export interface EnglishCronRunRef {
  id: number;
  runId: string;
}

export interface EnglishCronBucketRef {
  id: number;
}

export interface EnglishRetryBucket {
  id: number;
  runRefId: number;
  engLevel: string;
  quizType: string;
  optionCount: number;
  topicId: number | null;
  topicName: string | null;
  requestedCount: number;
}

export type EnglishCronJobRunListItem = Pick<
  EnglishCronJobRun,
  | 'id'
  | 'runId'
  | 'jobKey'
  | 'trigger'
  | 'status'
  | 'succeededBuckets'
  | 'failedBuckets'
  | 'skippedBuckets'
  | 'generatedQuestions'
  | 'insertedQuestions'
  | 'tokenIn'
  | 'tokenOut'
  | 'durationMs'
  | 'startedAt'
>;

export type EnglishCronJobBucketDetailItem = Pick<
  EnglishCronJobBucket,
  | 'id'
  | 'status'
  | 'engLevel'
  | 'quizType'
  | 'topicId'
  | 'topicName'
  | 'requestedCount'
  | 'generatedCount'
  | 'insertedCount'
  | 'errorPhase'
  | 'errorMessage'
  | 'errorStack'
>;

export type EnglishCronJobModelAttemptDetailItem = Pick<
  EnglishCronJobModelAttempt,
  | 'id'
  | 'bucketRefId'
  | 'model'
  | 'attemptOrder'
  | 'status'
  | 'generatedCount'
  | 'tokenIn'
  | 'tokenOut'
  | 'errorMessage'
>;

type RunPatch = Partial<{
  status: EnglishCronJobStatus;
  totalBuckets: number;
  deficientBuckets: number;
  succeededBuckets: number;
  failedBuckets: number;
  skippedBuckets: number;
  requestedQuestions: number;
  generatedQuestions: number;
  insertedQuestions: number;
  tokenIn: number;
  tokenOut: number;
  errorPhase: EnglishCronJobErrorPhase;
  errorMessage: string;
  errorStack: string;
  metadata: Record<string, unknown>;
  finishedAt: Date | null;
  durationMs: number | null;
}>;

export function normalizeError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  return { message: String(err) };
}

function nowDuration(startedAt: Date | null): number | null {
  if (!startedAt) return null;
  return Math.max(0, Date.now() - startedAt.getTime());
}

function bucketKey(input: { engLevel: string; topicId: number | null; quizType: string }): string {
  return `${input.engLevel}:${input.topicId ?? 'null'}:${input.quizType}`;
}

async function safeWrite<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const normalized = normalizeError(err);
    logger.warn(`[EnglishCronTracking] ${label} failed: ${normalized.message}`);
    return fallback;
  }
}

async function getRunByRef(run: EnglishCronRunRef): Promise<EnglishCronJobRun | null> {
  const [row] = await db.select().from(englishCronJobRun).where(eq(englishCronJobRun.id, run.id)).limit(1);
  return row ?? null;
}

async function updateRun(run: EnglishCronRunRef | null, patch: RunPatch): Promise<void> {
  if (!run) return;
  await safeWrite('updateRun', undefined, async () => {
    await db
      .update(englishCronJobRun)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(englishCronJobRun.id, run.id));
  });
}

async function startRun(input: {
  jobKey: EnglishCronJobKey;
  trigger: EnglishCronJobTrigger;
  queueName?: string;
  bullJobId?: string;
  bullJobName?: string;
  totalBuckets?: number;
  deficientBuckets?: number;
  metadata?: Record<string, unknown>;
}): Promise<EnglishCronRunRef | null> {
  return safeWrite('startRun', null, async () => {
    const [row] = await db
      .insert(englishCronJobRun)
      .values({
        runId: crypto.randomUUID(),
        jobKey: input.jobKey,
        trigger: input.trigger,
        status: 'running',
        queueName: input.queueName,
        bullJobId: input.bullJobId,
        bullJobName: input.bullJobName,
        totalBuckets: input.totalBuckets ?? 0,
        deficientBuckets: input.deficientBuckets ?? 0,
        metadata: input.metadata
      })
      .returning({ id: englishCronJobRun.id, runId: englishCronJobRun.runId });
    return row ?? null;
  });
}

async function getRunRefByRunId(runId: string | null | undefined): Promise<EnglishCronRunRef | null> {
  if (!runId) return null;
  try {
    const [row] = await db
      .select({ id: englishCronJobRun.id, runId: englishCronJobRun.runId })
      .from(englishCronJobRun)
      .where(eq(englishCronJobRun.runId, runId))
      .limit(1);
    return row ?? null;
  } catch (err) {
    const normalized = normalizeError(err);
    logger.warn(`[EnglishCronTracking] getRunRefByRunId failed: ${normalized.message}`);
    return null;
  }
}

async function finishRun(
  run: EnglishCronRunRef | null,
  input: {
    status: EnglishCronJobStatus;
    errorPhase?: EnglishCronJobErrorPhase;
    error?: unknown;
    totals?: Partial<RunPatch>;
  }
): Promise<void> {
  if (!run) return;
  await safeWrite('finishRun', undefined, async () => {
    const existing = await getRunByRef(run);
    const finishedAt = new Date();
    const normalized = input.error === undefined ? undefined : normalizeError(input.error);
    await db
      .update(englishCronJobRun)
      .set({
        ...input.totals,
        status: input.status,
        errorPhase: input.errorPhase,
        errorMessage: normalized?.message,
        errorStack: normalized?.stack,
        finishedAt,
        durationMs: nowDuration(existing?.startedAt ?? null),
        updatedAt: finishedAt
      })
      .where(eq(englishCronJobRun.id, run.id));
  });
}

async function startBucket(
  run: EnglishCronRunRef | null,
  input: {
    engLevel: string;
    quizType: string;
    optionCount: number;
    topicId: number | null;
    topicName: string | null;
    requestedCount: number;
    metadata?: Record<string, unknown>;
  }
): Promise<EnglishCronBucketRef | null> {
  if (!run) return null;
  return safeWrite('startBucket', null, async () => {
    const [row] = await db
      .insert(englishCronJobBucket)
      .values({
        runRefId: run.id,
        bucketKey: bucketKey(input),
        status: 'running',
        engLevel: input.engLevel,
        quizType: input.quizType,
        optionCount: input.optionCount,
        topicId: input.topicId,
        topicName: input.topicName,
        requestedCount: input.requestedCount,
        metadata: input.metadata
      })
      .returning({ id: englishCronJobBucket.id });
    return row ?? null;
  });
}

async function finishBucket(
  bucket: EnglishCronBucketRef | null,
  input: {
    status: EnglishCronJobStatus;
    requestedCount?: number;
    generatedCount?: number;
    insertedCount?: number;
    skippedCount?: number;
    tokenIn?: number;
    tokenOut?: number;
    errorPhase?: EnglishCronJobErrorPhase;
    error?: unknown;
  }
): Promise<void> {
  if (!bucket) return;
  await safeWrite('finishBucket', undefined, async () => {
    const [existing] = await db
      .select({ startedAt: englishCronJobBucket.startedAt })
      .from(englishCronJobBucket)
      .where(eq(englishCronJobBucket.id, bucket.id))
      .limit(1);
    const finishedAt = new Date();
    const normalized = input.error === undefined ? undefined : normalizeError(input.error);
    await db
      .update(englishCronJobBucket)
      .set({
        status: input.status,
        requestedCount: input.requestedCount,
        generatedCount: input.generatedCount,
        insertedCount: input.insertedCount,
        skippedCount: input.skippedCount,
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        errorPhase: input.errorPhase,
        errorMessage: normalized?.message,
        errorStack: normalized?.stack,
        finishedAt,
        durationMs: nowDuration(existing?.startedAt ?? null),
        updatedAt: finishedAt
      })
      .where(eq(englishCronJobBucket.id, bucket.id));
  });
}

async function recordModelAttempt(input: {
  run: EnglishCronRunRef | null;
  bucket: EnglishCronBucketRef | null;
  model: string;
  attemptOrder: number;
  status: 'success' | 'failed';
  requestedCount: number;
  generatedCount?: number;
  tokenIn?: number;
  tokenOut?: number;
  startedAt: Date;
  error?: unknown;
}): Promise<void> {
  if (!input.run || !input.bucket) return;
  await safeWrite('recordModelAttempt', undefined, async () => {
    const finishedAt = new Date();
    const normalized = input.error === undefined ? undefined : normalizeError(input.error);
    await db.insert(englishCronJobModelAttempt).values({
      runRefId: input.run!.id,
      bucketRefId: input.bucket!.id,
      model: input.model,
      attemptOrder: input.attemptOrder,
      status: input.status,
      requestedCount: input.requestedCount,
      generatedCount: input.generatedCount ?? 0,
      tokenIn: input.tokenIn ?? 0,
      tokenOut: input.tokenOut ?? 0,
      errorMessage: normalized?.message,
      errorStack: normalized?.stack,
      startedAt: input.startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - input.startedAt.getTime())
    });
  });
}

async function summarizeRun(
  run: EnglishCronRunRef | null,
  opts?: { forceFinishRunningBuckets?: boolean }
): Promise<void> {
  if (!run) return;
  await safeWrite('summarizeRun', undefined, async () => {
    const [existing, buckets] = await Promise.all([
      getRunByRef(run),
      db.select().from(englishCronJobBucket).where(eq(englishCronJobBucket.runRefId, run.id))
    ]);
    if (!existing) return;

    // Force-close any orphaned running buckets (e.g. safeWrite DB failure left them stuck)
    if (opts?.forceFinishRunningBuckets) {
      const stuckIds = buckets.filter((b) => b.status === 'running').map((b) => b.id);
      if (stuckIds.length > 0) {
        const finishedAt = new Date();
        await db
          .update(englishCronJobBucket)
          .set({
            status: 'failed',
            errorPhase: 'unknown',
            errorMessage: 'Bucket stuck in running state, force-closed by parent',
            finishedAt,
            durationMs: 0,
            updatedAt: finishedAt
          })
          .where(inArray(englishCronJobBucket.id, stuckIds));
        for (const b of buckets) {
          if (stuckIds.includes(b.id)) b.status = 'failed';
        }
      }
    }

    const succeededBuckets = buckets.filter((b) => b.status === 'success').length;
    const failedBuckets = buckets.filter((b) => b.status === 'failed').length;
    const skippedBuckets = buckets.filter((b) => b.status === 'skipped').length;
    const runningBuckets = buckets.filter((b) => b.status === 'running').length;
    const totalBuckets = buckets.length || existing.totalBuckets;
    const requestedQuestions = buckets.reduce((sum, b) => sum + b.requestedCount, 0);
    const generatedQuestions = buckets.reduce((sum, b) => sum + b.generatedCount, 0);
    const insertedQuestions = buckets.reduce((sum, b) => sum + b.insertedCount, 0);
    const tokenIn = buckets.reduce((sum, b) => sum + b.tokenIn, 0);
    const tokenOut = buckets.reduce((sum, b) => sum + b.tokenOut, 0);

    let status: EnglishCronJobStatus = 'success';
    if (runningBuckets > 0) status = 'running';
    else if (failedBuckets > 0 && succeededBuckets + skippedBuckets > 0) status = 'partial_success';
    else if (failedBuckets > 0) status = 'failed';
    else if (succeededBuckets === 0 && skippedBuckets > 0) status = 'skipped';
    else if (totalBuckets === 0) status = existing.deficientBuckets === 0 ? 'skipped' : 'success';

    const finishedAt = status === 'running' ? null : new Date();
    await db
      .update(englishCronJobRun)
      .set({
        status,
        totalBuckets,
        succeededBuckets,
        failedBuckets,
        skippedBuckets,
        requestedQuestions,
        generatedQuestions,
        insertedQuestions,
        tokenIn,
        tokenOut,
        finishedAt,
        durationMs: finishedAt ? nowDuration(existing.startedAt) : null,
        updatedAt: new Date()
      })
      .where(eq(englishCronJobRun.id, run.id));
  });
}

async function markStaleRunsFailed(olderThanMs: number): Promise<void> {
  await safeWrite('markStaleRunsFailed', undefined, async () => {
    const cutoff = new Date(Date.now() - olderThanMs);
    const staleRuns = await db
      .select({ id: englishCronJobRun.id, runId: englishCronJobRun.runId })
      .from(englishCronJobRun)
      .where(and(eq(englishCronJobRun.status, 'running'), lt(englishCronJobRun.startedAt, cutoff)));
    if (staleRuns.length === 0) return;
    const staleIds = staleRuns.map((r) => r.id);
    const finishedAt = new Date();
    await db
      .update(englishCronJobBucket)
      .set({
        status: 'failed',
        errorPhase: 'unknown',
        errorMessage: 'Stale bucket: process may have crashed',
        finishedAt,
        durationMs: 0,
        updatedAt: finishedAt
      })
      .where(and(inArray(englishCronJobBucket.runRefId, staleIds), eq(englishCronJobBucket.status, 'running')));
    await db
      .update(englishCronJobRun)
      .set({
        status: 'failed',
        errorPhase: 'unknown',
        errorMessage: 'Stale run: process may have crashed',
        finishedAt,
        durationMs: null,
        updatedAt: finishedAt
      })
      .where(inArray(englishCronJobRun.id, staleIds));
    logger.warn(
      `[EnglishCronTracking] Marked ${staleRuns.length} stale run(s) as failed: ${staleRuns.map((r) => r.runId).join(', ')}`
    );
  });
}

async function finalizeRunIfBucketsComplete(runId: string | null | undefined): Promise<void> {
  const run = await getRunRefByRunId(runId);
  if (!run) return;
  await safeWrite('finalizeRunIfBucketsComplete', undefined, async () => {
    const existing = await getRunByRef(run);
    if (!existing || existing.status !== 'running' || existing.deficientBuckets <= 0) return;
    const buckets = await db
      .select({ status: englishCronJobBucket.status })
      .from(englishCronJobBucket)
      .where(eq(englishCronJobBucket.runRefId, run.id));
    const terminalCount = buckets.filter((b) => b.status !== 'running').length;
    if (terminalCount >= existing.deficientBuckets) await summarizeRun(run);
  });
}

async function listRuns(input: {
  from: Date;
  to: Date;
  jobKey?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ runs: EnglishCronJobRunListItem[]; hasNext: boolean }> {
  try {
    const conditions = [gte(englishCronJobRun.startedAt, input.from), lte(englishCronJobRun.startedAt, input.to)];
    if (input.jobKey) conditions.push(eq(englishCronJobRun.jobKey, input.jobKey));
    if (input.status) conditions.push(eq(englishCronJobRun.status, input.status));
    const limit = Math.max(1, input.limit ?? 50);
    const rows = await db
      .select({
        id: englishCronJobRun.id,
        runId: englishCronJobRun.runId,
        jobKey: englishCronJobRun.jobKey,
        trigger: englishCronJobRun.trigger,
        status: englishCronJobRun.status,
        succeededBuckets: englishCronJobRun.succeededBuckets,
        failedBuckets: englishCronJobRun.failedBuckets,
        skippedBuckets: englishCronJobRun.skippedBuckets,
        generatedQuestions: englishCronJobRun.generatedQuestions,
        insertedQuestions: englishCronJobRun.insertedQuestions,
        tokenIn: englishCronJobRun.tokenIn,
        tokenOut: englishCronJobRun.tokenOut,
        durationMs: englishCronJobRun.durationMs,
        startedAt: englishCronJobRun.startedAt
      })
      .from(englishCronJobRun)
      .where(and(...conditions))
      .orderBy(desc(englishCronJobRun.startedAt), desc(englishCronJobRun.id))
      .limit(limit + 1)
      .offset(Math.max(0, input.offset ?? 0));
    return { runs: rows.slice(0, limit), hasNext: rows.length > limit };
  } catch (err) {
    const normalized = normalizeError(err);
    logger.warn(`[EnglishCronTracking] listRuns failed: ${normalized.message}`);
    return { runs: [], hasNext: false };
  }
}

async function getRunDetail(
  externalRunId: string,
  input: { bucketLimit?: number; bucketOffset?: number } = {}
): Promise<{
  run: EnglishCronJobRun;
  buckets: EnglishCronJobBucketDetailItem[];
  attempts: EnglishCronJobModelAttemptDetailItem[];
  hasNextBuckets: boolean;
} | null> {
  try {
    const [run] = await db.select().from(englishCronJobRun).where(eq(englishCronJobRun.runId, externalRunId)).limit(1);
    if (!run) return null;
    const bucketLimit = Math.max(1, input.bucketLimit ?? 100);
    const bucketRows = await db
      .select({
        id: englishCronJobBucket.id,
        status: englishCronJobBucket.status,
        engLevel: englishCronJobBucket.engLevel,
        quizType: englishCronJobBucket.quizType,
        topicId: englishCronJobBucket.topicId,
        topicName: englishCronJobBucket.topicName,
        requestedCount: englishCronJobBucket.requestedCount,
        generatedCount: englishCronJobBucket.generatedCount,
        insertedCount: englishCronJobBucket.insertedCount,
        errorPhase: englishCronJobBucket.errorPhase,
        errorMessage: englishCronJobBucket.errorMessage,
        errorStack: englishCronJobBucket.errorStack
      })
      .from(englishCronJobBucket)
      .where(eq(englishCronJobBucket.runRefId, run.id))
      .orderBy(desc(englishCronJobBucket.id))
      .limit(bucketLimit + 1)
      .offset(Math.max(0, input.bucketOffset ?? 0));
    const buckets = bucketRows.slice(0, bucketLimit);
    const bucketIds = buckets.map((bucket) => bucket.id);
    const attempts =
      bucketIds.length === 0
        ? []
        : await db
            .select({
              id: englishCronJobModelAttempt.id,
              bucketRefId: englishCronJobModelAttempt.bucketRefId,
              model: englishCronJobModelAttempt.model,
              attemptOrder: englishCronJobModelAttempt.attemptOrder,
              status: englishCronJobModelAttempt.status,
              generatedCount: englishCronJobModelAttempt.generatedCount,
              tokenIn: englishCronJobModelAttempt.tokenIn,
              tokenOut: englishCronJobModelAttempt.tokenOut,
              errorMessage: englishCronJobModelAttempt.errorMessage
            })
            .from(englishCronJobModelAttempt)
            .where(inArray(englishCronJobModelAttempt.bucketRefId, bucketIds))
            .orderBy(desc(englishCronJobModelAttempt.id));
    return { run, buckets, attempts, hasNextBuckets: bucketRows.length > bucketLimit };
  } catch (err) {
    const normalized = normalizeError(err);
    logger.warn(`[EnglishCronTracking] getRunDetail failed: ${normalized.message}`);
    return null;
  }
}

async function getRecentRuns(limit = 8): Promise<EnglishCronJobRun[]> {
  try {
    return db
      .select()
      .from(englishCronJobRun)
      .orderBy(desc(englishCronJobRun.startedAt), desc(englishCronJobRun.id))
      .limit(limit);
  } catch (err) {
    const normalized = normalizeError(err);
    logger.warn(`[EnglishCronTracking] getRecentRuns failed: ${normalized.message}`);
    return [];
  }
}

async function getRecentFailedBuckets(
  limit = 12
): Promise<
  Array<EnglishRetryBucket & { sourceRunId: string; jobKey: string; trigger: string; errorMessage: string | null }>
> {
  try {
    const rows = await db
      .select({
        id: englishCronJobBucket.id,
        runRefId: englishCronJobBucket.runRefId,
        sourceRunId: englishCronJobRun.runId,
        jobKey: englishCronJobRun.jobKey,
        trigger: englishCronJobRun.trigger,
        engLevel: englishCronJobBucket.engLevel,
        quizType: englishCronJobBucket.quizType,
        optionCount: englishCronJobBucket.optionCount,
        topicId: englishCronJobBucket.topicId,
        topicName: englishCronJobBucket.topicName,
        requestedCount: englishCronJobBucket.requestedCount,
        errorMessage: englishCronJobBucket.errorMessage
      })
      .from(englishCronJobBucket)
      .innerJoin(englishCronJobRun, eq(englishCronJobBucket.runRefId, englishCronJobRun.id))
      .where(eq(englishCronJobBucket.status, 'failed'))
      .orderBy(desc(englishCronJobBucket.id))
      .limit(limit);
    return rows;
  } catch (err) {
    const normalized = normalizeError(err);
    logger.warn(`[EnglishCronTracking] getRecentFailedBuckets failed: ${normalized.message}`);
    return [];
  }
}

async function getRetryBuckets(sourceRunId: string, bucketIds?: number[]): Promise<EnglishRetryBucket[]> {
  const run = await getRunRefByRunId(sourceRunId);
  if (!run) return [];
  const conditions = [eq(englishCronJobBucket.runRefId, run.id), eq(englishCronJobBucket.status, 'failed')];
  if (bucketIds && bucketIds.length > 0) conditions.push(inArray(englishCronJobBucket.id, bucketIds));
  try {
    return db
      .select({
        id: englishCronJobBucket.id,
        runRefId: englishCronJobBucket.runRefId,
        engLevel: englishCronJobBucket.engLevel,
        quizType: englishCronJobBucket.quizType,
        optionCount: englishCronJobBucket.optionCount,
        topicId: englishCronJobBucket.topicId,
        topicName: englishCronJobBucket.topicName,
        requestedCount: englishCronJobBucket.requestedCount
      })
      .from(englishCronJobBucket)
      .where(and(...conditions))
      .orderBy(desc(englishCronJobBucket.id));
  } catch (err) {
    const normalized = normalizeError(err);
    logger.warn(`[EnglishCronTracking] getRetryBuckets failed: ${normalized.message}`);
    return [];
  }
}

async function clearRun(externalRunId: string): Promise<{ deleted: number; skipped: number }> {
  try {
    const [run] = await db.select().from(englishCronJobRun).where(eq(englishCronJobRun.runId, externalRunId)).limit(1);
    if (!run) return { deleted: 0, skipped: 0 };
    if (run.status === 'running') return { deleted: 0, skipped: 1 };
    await db.delete(englishCronJobModelAttempt).where(eq(englishCronJobModelAttempt.runRefId, run.id));
    await db.delete(englishCronJobBucket).where(eq(englishCronJobBucket.runRefId, run.id));
    await db.delete(englishCronJobRun).where(eq(englishCronJobRun.id, run.id));
    return { deleted: 1, skipped: 0 };
  } catch (err) {
    const normalized = normalizeError(err);
    logger.warn(`[EnglishCronTracking] clearRun failed: ${normalized.message}`);
    return { deleted: 0, skipped: 0 };
  }
}

async function clearRunsBefore(cutoff: Date): Promise<{ deleted: number; skipped: number }> {
  try {
    const [terminalRuns, runningRuns] = await Promise.all([
      db
        .select({ id: englishCronJobRun.id })
        .from(englishCronJobRun)
        .where(and(lt(englishCronJobRun.finishedAt, cutoff), ne(englishCronJobRun.status, 'running'))),
      db
        .select({ id: englishCronJobRun.id })
        .from(englishCronJobRun)
        .where(and(lt(englishCronJobRun.startedAt, cutoff), eq(englishCronJobRun.status, 'running')))
    ]);
    const ids = terminalRuns.map((r) => r.id);
    if (ids.length > 0) {
      await db.delete(englishCronJobModelAttempt).where(inArray(englishCronJobModelAttempt.runRefId, ids));
      await db.delete(englishCronJobBucket).where(inArray(englishCronJobBucket.runRefId, ids));
      await db.delete(englishCronJobRun).where(inArray(englishCronJobRun.id, ids));
    }
    return { deleted: ids.length, skipped: runningRuns.length };
  } catch (err) {
    const normalized = normalizeError(err);
    logger.warn(`[EnglishCronTracking] clearRunsBefore failed: ${normalized.message}`);
    return { deleted: 0, skipped: 0 };
  }
}

export default {
  normalizeError,
  startRun,
  updateRun,
  finishRun,
  summarizeRun,
  finalizeRunIfBucketsComplete,
  markStaleRunsFailed,
  getRunRefByRunId,
  startBucket,
  finishBucket,
  recordModelAttempt,
  listRuns,
  getRunDetail,
  getRecentRuns,
  getRecentFailedBuckets,
  getRetryBuckets,
  clearRun,
  clearRunsBefore
};
