import { beforeEach, describe, expect, it } from 'bun:test';
import tracking from '@/core/services/english/englishCronJobTracking.service';
import { resetDb } from '../helpers/db.helper';
import { createTopic } from '../helpers/seed.helper';

let topicId: number;

const dayAgo = () => new Date(Date.now() - 24 * 60 * 60 * 1000);
const dayAhead = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

beforeEach(async () => {
  await resetDb();
  topicId = (await createTopic('daily-life')).id;
});

async function startRun(overrides: Record<string, unknown> = {}) {
  const run = await tracking.startRun({
    jobKey: 'manual_fill',
    trigger: 'manual',
    totalBuckets: 2,
    deficientBuckets: 2,
    ...overrides
  });
  if (!run) throw new Error('không tạo được run');
  return run;
}

async function startBucket(run: { id: number; runId: string }, overrides: Record<string, unknown> = {}) {
  const bucket = await tracking.startBucket(run, {
    engLevel: 'A1',
    quizType: 'vocab',
    optionCount: 4,
    topicId,
    topicName: 'daily-life',
    requestedCount: 3,
    ...overrides
  });
  if (!bucket) throw new Error('không tạo được bucket');
  return bucket;
}

describe('vòng đời run -> bucket -> model attempt', () => {
  it('cộng dồn đúng counter và token từ các bucket', async () => {
    const run = await startRun();

    const b1 = await startBucket(run);
    await tracking.finishBucket(b1, {
      status: 'success',
      requestedCount: 3,
      generatedCount: 3,
      insertedCount: 2,
      skippedCount: 1,
      tokenIn: 100,
      tokenOut: 40,
      costUsd: 0.001
    });

    const b2 = await startBucket(run, { engLevel: 'A2' });
    await tracking.finishBucket(b2, {
      status: 'success',
      requestedCount: 2,
      generatedCount: 2,
      insertedCount: 2,
      tokenIn: 50,
      tokenOut: 10,
      costUsd: 0.002
    });

    await tracking.summarizeRun(run);
    const detail = await tracking.getRunDetail(run.runId);

    expect(detail?.run.status).toBe('success');
    expect(detail?.run.requestedQuestions).toBe(5);
    expect(detail?.run.generatedQuestions).toBe(5);
    expect(detail?.run.insertedQuestions).toBe(4);
    expect(detail?.run.tokenIn).toBe(150);
    expect(detail?.run.tokenOut).toBe(50);
    expect(detail?.run.costUsd).toBeCloseTo(0.003, 10);
    expect(detail?.buckets).toHaveLength(2);
  });

  it('model attempt gắn được vào đúng bucket', async () => {
    const run = await startRun();
    const bucket = await startBucket(run);

    await tracking.recordModelAttempt({
      run,
      bucket,
      model: 'test/model',
      attemptOrder: 1,
      status: 'success',
      requestedCount: 3,
      generatedCount: 3,
      tokenIn: 100,
      tokenOut: 40,
      costUsd: 0.001,
      startedAt: new Date()
    });
    await tracking.finishBucket(bucket, { status: 'success' });
    await tracking.summarizeRun(run);

    const detail = await tracking.getRunDetail(run.runId);

    // attempts là mảng phẳng ở cấp run, gắn với bucket qua bucketRefId.
    expect(detail?.attempts).toHaveLength(1);
    expect(detail?.attempts[0]).toMatchObject({
      model: 'test/model',
      attemptOrder: 1,
      status: 'success',
      bucketRefId: bucket.id
    });
  });

  it('nhiều attempt cho một bucket (pipeline reading question gọi model N lần)', async () => {
    const run = await startRun();
    const bucket = await startBucket(run);

    for (let i = 1; i <= 3; i += 1) {
      await tracking.recordModelAttempt({
        run,
        bucket,
        model: 'test/model',
        attemptOrder: i,
        status: 'success',
        requestedCount: 1,
        generatedCount: 1,
        startedAt: new Date()
      });
    }
    await tracking.finishBucket(bucket, { status: 'success' });

    const detail = await tracking.getRunDetail(run.runId);
    expect(detail?.attempts).toHaveLength(3);
    expect(detail?.attempts.map((a) => a.attemptOrder).sort()).toEqual([1, 2, 3]);
  });
});

describe('summarizeRun — roll-up trạng thái', () => {
  it('mọi bucket success -> success', async () => {
    const run = await startRun();
    const b = await startBucket(run);
    await tracking.finishBucket(b, { status: 'success' });

    await tracking.summarizeRun(run);

    expect((await tracking.getRunDetail(run.runId))?.run.status).toBe('success');
  });

  it('có fail + có success -> partial_success', async () => {
    const run = await startRun();
    const ok = await startBucket(run);
    const bad = await startBucket(run, { engLevel: 'A2' });
    await tracking.finishBucket(ok, { status: 'success' });
    await tracking.finishBucket(bad, { status: 'failed', errorPhase: 'generate_model', error: new Error('boom') });

    await tracking.summarizeRun(run);

    expect((await tracking.getRunDetail(run.runId))?.run.status).toBe('partial_success');
  });

  it('toàn fail -> failed và giữ lại thông tin lỗi', async () => {
    const run = await startRun();
    const b = await startBucket(run);
    await tracking.finishBucket(b, { status: 'failed', errorPhase: 'generate_model', error: new Error('model sập') });

    await tracking.summarizeRun(run);
    const detail = await tracking.getRunDetail(run.runId);

    expect(detail?.run.status).toBe('failed');
    expect(detail?.buckets[0]?.errorMessage).toContain('model sập');
    expect(detail?.buckets[0]?.errorPhase).toBe('generate_model');
  });

  it('còn bucket running -> run vẫn running, chưa gán finishedAt', async () => {
    const run = await startRun();
    await startBucket(run);

    await tracking.summarizeRun(run);
    const detail = await tracking.getRunDetail(run.runId);

    expect(detail?.run.status).toBe('running');
    expect(detail?.run.finishedAt).toBeNull();
  });

  it('forceFinishRunningBuckets đóng bucket treo và kết luận được run', async () => {
    const run = await startRun();
    const ok = await startBucket(run);
    await tracking.finishBucket(ok, { status: 'success' });
    await startBucket(run, { engLevel: 'A2' }); // để treo

    await tracking.summarizeRun(run, { forceFinishRunningBuckets: true });
    const detail = await tracking.getRunDetail(run.runId);

    expect(detail?.run.status).toBe('partial_success');
    expect(detail?.buckets.some((b) => b.status === 'failed')).toBe(true);
  });

  it('run không có bucket nào và không thiếu bucket -> skipped', async () => {
    // totalBuckets phải là 0: summarizeRun dùng `buckets.length || existing.totalBuckets`,
    // nên khai totalBuckets > 0 mà không có bucket con sẽ ra 'success', không phải 'skipped'.
    const run = await startRun({ totalBuckets: 0, deficientBuckets: 0 });

    await tracking.summarizeRun(run);

    expect((await tracking.getRunDetail(run.runId))?.run.status).toBe('skipped');
  });

  it('khai có bucket thiếu nhưng không bucket con nào chạy -> success', async () => {
    const run = await startRun({ totalBuckets: 0, deficientBuckets: 5 });

    await tracking.summarizeRun(run);

    expect((await tracking.getRunDetail(run.runId))?.run.status).toBe('success');
  });

  it('costUsd giữ null khi không bucket nào tính được giá (khác 0 = chạy free)', async () => {
    const run = await startRun();
    const b = await startBucket(run);
    await tracking.finishBucket(b, { status: 'success', costUsd: null });

    await tracking.summarizeRun(run);

    expect((await tracking.getRunDetail(run.runId))?.run.costUsd).toBeNull();
  });

  it('chỉ cộng những bucket có giá, bỏ qua bucket null', async () => {
    const run = await startRun();
    const priced = await startBucket(run);
    const unpriced = await startBucket(run, { engLevel: 'A2' });
    await tracking.finishBucket(priced, { status: 'success', costUsd: 0.005 });
    await tracking.finishBucket(unpriced, { status: 'success', costUsd: null });

    await tracking.summarizeRun(run);

    expect((await tracking.getRunDetail(run.runId))?.run.costUsd).toBeCloseTo(0.005, 10);
  });
});

describe('markStaleRunsFailed', () => {
  it('run cũ hơn ngưỡng bị đánh dấu hỏng, run mới không bị đụng', async () => {
    const db = (await import('@/configs/orm.config')).default;
    const { englishCronJobRun } = await import('@/core/db/schema/main');
    const { eq } = await import('drizzle-orm');

    const stale = await startRun();
    await startBucket(stale);
    await db
      .update(englishCronJobRun)
      .set({ startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) })
      .where(eq(englishCronJobRun.id, stale.id));

    const fresh = await startRun();
    await startBucket(fresh);

    await tracking.markStaleRunsFailed(2 * 60 * 60 * 1000);

    const staleDetail = await tracking.getRunDetail(stale.runId);
    const freshDetail = await tracking.getRunDetail(fresh.runId);

    expect(staleDetail?.run.status).not.toBe('running');
    expect(staleDetail?.buckets[0]?.status).toBe('failed');
    expect(freshDetail?.run.status).toBe('running');
  });

  it('không có run treo -> không lỗi', async () => {
    expect(tracking.markStaleRunsFailed(1000)).resolves.toBeUndefined();
  });
});

describe('getLastBucketRefillTimestamps', () => {
  it('chỉ tính bucket THÀNH CÔNG', async () => {
    const run = await startRun();
    const ok = await startBucket(run, { bucketKey: 'A1:1:vocab' });
    const bad = await startBucket(run, { bucketKey: 'A2:1:vocab' });
    await tracking.finishBucket(ok, { status: 'success' });
    await tracking.finishBucket(bad, { status: 'failed' });

    const map = await tracking.getLastBucketRefillTimestamps(['A1:1:vocab', 'A2:1:vocab']);

    expect(map.has('A1:1:vocab')).toBe(true);
    expect(map.has('A2:1:vocab')).toBe(false);
  });

  it('lấy lần THÀNH CÔNG gần nhất khi bucket chạy nhiều lần', async () => {
    const run = await startRun();
    const first = await startBucket(run, { bucketKey: 'A1:1:vocab' });
    await tracking.finishBucket(first, { status: 'success' });
    await Bun.sleep(10);
    const second = await startBucket(run, { bucketKey: 'A1:1:vocab' });
    await tracking.finishBucket(second, { status: 'success' });

    const map = await tracking.getLastBucketRefillTimestamps(['A1:1:vocab']);

    const db = (await import('@/configs/orm.config')).default;
    const { englishCronJobBucket } = await import('@/core/db/schema/main');
    const { eq } = await import('drizzle-orm');
    const rows = await db
      .select({ finishedAt: englishCronJobBucket.finishedAt })
      .from(englishCronJobBucket)
      .where(eq(englishCronJobBucket.bucketKey, 'A1:1:vocab'));
    const latest = Math.max(...rows.map((r) => r.finishedAt!.getTime()));

    expect(rows).toHaveLength(2);
    expect(map.get('A1:1:vocab')!.getTime()).toBe(latest);
  });

  it('danh sách rỗng -> map rỗng, không query', async () => {
    expect((await tracking.getLastBucketRefillTimestamps([])).size).toBe(0);
  });
});

describe('tracking không được làm hỏng luồng chính', () => {
  it('run = null thì mọi API tracking đều no-op, không throw', async () => {
    expect(
      await tracking.startBucket(null, {
        engLevel: 'A1',
        quizType: 'vocab',
        optionCount: 4,
        topicId: null,
        topicName: null,
        requestedCount: 1
      })
    ).toBeNull();

    expect(tracking.finishBucket(null, { status: 'success' })).resolves.toBeUndefined();
    expect(tracking.summarizeRun(null)).resolves.toBeUndefined();
    expect(tracking.updateRun(null, { totalBuckets: 1 })).resolves.toBeUndefined();
    expect(
      tracking.recordModelAttempt({
        run: null,
        bucket: null,
        model: 'm',
        attemptOrder: 1,
        status: 'success',
        requestedCount: 1,
        startedAt: new Date()
      })
    ).resolves.toBeUndefined();
  });

  it('getRunDetail với runId không tồn tại -> null', async () => {
    expect(await tracking.getRunDetail('khong-ton-tai')).toBeNull();
  });
});

describe('listRuns / getUsageAnalytics', () => {
  it('listRuns trả run mới nhất trước', async () => {
    const first = await startRun();
    await Bun.sleep(10);
    const second = await startRun();

    const { runs } = await tracking.listRuns({ from: dayAgo(), to: dayAhead(), limit: 10 });

    expect(runs[0]?.runId).toBe(second.runId);
    expect(runs.map((r) => r.runId)).toContain(first.runId);
  });

  it('usage gom theo model', async () => {
    const run = await startRun();
    const bucket = await startBucket(run);
    await tracking.recordModelAttempt({
      run,
      bucket,
      model: 'model-a',
      attemptOrder: 1,
      status: 'success',
      requestedCount: 3,
      generatedCount: 3,
      tokenIn: 100,
      tokenOut: 40,
      costUsd: 0.001,
      startedAt: new Date()
    });
    await tracking.finishBucket(bucket, { status: 'success' });

    const usage = await tracking.getUsageAnalytics({ from: dayAgo(), to: dayAhead(), groupBy: 'model' });

    const row = usage.find((item) => item.bucket === 'model-a');
    expect(row).toBeDefined();
    expect(row?.tokenIn).toBe(100);
    expect(row?.tokenOut).toBe(40);
    expect(row?.costUsd).toBeCloseTo(0.001, 10);
    expect(row?.successCount).toBe(1);
  });
});
