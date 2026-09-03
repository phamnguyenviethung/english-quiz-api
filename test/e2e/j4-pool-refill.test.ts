import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { api, expectError, expectOk, waitForRun } from '../helpers/app.helper';
import { resetDb } from '../helpers/db.helper';
import { setConfig } from '../helpers/config.helper';
import { createAdminUser, type TestUser } from '../helpers/auth.helper';
import { mockLLM } from '../helpers/llm.helper';
import { createTopic } from '../helpers/seed.helper';
import { vocabQuestion } from '../fixtures/pool-question.fixture';
import { getEnglishConfigSnapshot } from '@/core/services/english/englishConfig.service';

/**
 * JOURNEY 4 — Admin refill pool thủ công (docs/question-pool.md).
 *
 * Bất biến quan trọng nhất: PREVIEW ≡ THỰC THI. Con số admin thấy trước khi bấm phải
 * bằng đúng con số endpoint refill trả về với cùng tham số — nếu trôi, admin không thể
 * ước lượng chi phí LLM.
 */

let admin: TestUser;
let topicId: number;

async function onlyVocab(): Promise<void> {
  const items = getEnglishConfigSnapshot().quiz_distribution.map((item) => ({
    ...item,
    enabled: item.quizType === 'vocab',
    weight: item.quizType === 'vocab' ? 10 : 0
  }));
  await setConfig({ 'quiz_distribution.items': items });
}

const refillQuery = { engLevels: 'A1', quizTypes: 'vocab' };

beforeAll(async () => {
  await resetDb();
  admin = await createAdminUser();
});

beforeEach(async () => {
  mockLLM.reset();
  await onlyVocab();
});

describe('J4 — refill pool', () => {
  it('bước 1: preview cho biết sẽ sinh bao nhiêu, chưa tốn LLM', async () => {
    topicId = (await createTopic(`topic-${Date.now()}`)).id;

    const preview = await expectOk<{
      buckets: Array<{ bucketKey: string; currentCount: number; deficiency: number; plannedCount: number }>;
      summary: { matchedBuckets: number; plannedBuckets: number; plannedQuestions: number; maxPerBucket: number };
    }>(
      await api.get('/admin/pool/buckets', {
        token: admin.token,
        query: { ...refillQuery, topicIds: String(topicId), scope: 'deficient' }
      })
    );

    expect(preview.summary.plannedBuckets).toBe(1);
    expect(preview.summary.plannedQuestions).toBe(3);
    expect(preview.buckets[0]?.currentCount).toBe(0);
    expect(mockLLM.callCount).toBe(0); // preview KHÔNG gọi model
  });

  it('bước 2: refill thật trả totalBuckets KHỚP preview', async () => {
    mockLLM.always({ questions: [vocabQuestion(), vocabQuestion(), vocabQuestion()] });

    const preview = await expectOk<{ summary: { plannedBuckets: number } }>(
      await api.get('/admin/pool/buckets', {
        token: admin.token,
        query: { ...refillQuery, topicIds: String(topicId), scope: 'deficient' }
      })
    );

    const result = await expectOk<{ runId: string; totalBuckets: number }>(
      await api.post('/admin/pool/refill', {
        token: admin.token,
        body: { scope: 'deficient', filter: { engLevels: ['A1'], quizTypes: ['vocab'], topicIds: [topicId] } }
      })
    );

    expect(result.totalBuckets).toBe(preview.summary.plannedBuckets);
    expect(result.runId).toBeTruthy();

    const detail = await waitForRun(result.runId, admin.token);
    expect(['success', 'partial_success']).toContain(detail.run.status);
  });

  it('bước 3: câu mới đã vào pool, không vượt maxPerBucket', async () => {
    const page = await expectOk<{ items: unknown[]; total: number }>(
      await api.get('/english/pool/questions', {
        token: admin.token,
        query: { engLevel: 'A1', quizType: 'vocab', topicId }
      })
    );

    expect(page.total).toBe(3);
    expect(page.total).toBeLessThanOrEqual(getEnglishConfigSnapshot().question_pool.maxPerBucket);
  });

  it('bước 4: run detail có bucket + model attempt + chi phí', async () => {
    const runs = await expectOk<Array<{ runId: string; jobKey: string }>>(
      await api.get('/english/cron/runs', { token: admin.token, query: { limit: 5 } })
    );
    const manualRun = runs.find((r) => r.jobKey === 'manual_fill');
    expect(manualRun).toBeDefined();

    const detail = await expectOk<{
      run: Record<string, unknown>;
      buckets: Array<Record<string, unknown>>;
      attempts: Array<Record<string, unknown>>;
    }>(await api.get(`/english/cron/runs/${manualRun!.runId}`, { token: admin.token }));

    expect(detail.buckets.length).toBeGreaterThan(0);
    expect(detail.attempts.length).toBeGreaterThan(0);
    expect(detail.run.insertedQuestions).toBe(3);
  });

  it('bước 5: thống kê chi phí gom theo model', async () => {
    const usage = await expectOk<Array<{ bucket: string; tokenIn: number }>>(
      await api.get('/english/cron/usage', { token: admin.token, query: { groupBy: 'model' } })
    );

    expect(usage.length).toBeGreaterThan(0);
    expect(usage.reduce((sum, row) => sum + row.tokenIn, 0)).toBeGreaterThan(0);
  });

  it('bucket đã đầy: scope=deficient bỏ qua, scope=all vẫn ép sinh', async () => {
    const deficient = await expectOk<{ summary: { plannedBuckets: number } }>(
      await api.get('/admin/pool/buckets', {
        token: admin.token,
        query: { ...refillQuery, topicIds: String(topicId), scope: 'deficient' }
      })
    );
    expect(deficient.summary.plannedBuckets).toBe(0);

    const all = await expectOk<{ summary: { plannedBuckets: number } }>(
      await api.get('/admin/pool/buckets', {
        token: admin.token,
        query: { ...refillQuery, topicIds: String(topicId), scope: 'all' }
      })
    );
    expect(all.summary.plannedBuckets).toBe(1);
  });
});

describe('J4 — nhánh lỗi', () => {
  it('LLM hỏng -> run failed nhưng endpoint vẫn 200 (fire-and-forget)', async () => {
    const freshTopic = (await createTopic(`fail-${Date.now()}`)).id;
    mockLLM.fail(new Error('OpenRouter 503'));

    const result = await expectOk<{ runId: string }>(
      await api.post('/admin/pool/refill', {
        token: admin.token,
        body: { scope: 'deficient', filter: { engLevels: ['A1'], quizTypes: ['vocab'], topicIds: [freshTopic] } }
      })
    );

    const detail = await waitForRun(result.runId, admin.token);
    expect(detail.run.status).toBe('failed');
    expect(detail.run.insertedQuestions).toBe(0);
  });

  it('model id không tồn tại -> 400 ngay, không tạo run', async () => {
    expectError(
      await api.post('/admin/pool/refill', {
        token: admin.token,
        body: { models: ['khong/ton-tai'], scope: 'deficient' }
      }),
      400
    );
  });

  it('countPerBucket < 1 -> 400 VALIDATION', async () => {
    expectError(
      await api.post('/admin/pool/refill', { token: admin.token, body: { countPerBucket: 0 } }),
      400,
      'VALIDATION'
    );
  });

  it('không có topic nào khớp filter -> 0 bucket, không gọi LLM', async () => {
    const result = await expectOk<{ totalBuckets: number }>(
      await api.post('/admin/pool/refill', {
        token: admin.token,
        body: { scope: 'deficient', filter: { topicIds: [999999] } }
      })
    );

    expect(result.totalBuckets).toBe(0);
    expect(mockLLM.callCount).toBe(0);
  });

  it('cron run không tồn tại -> 404', async () => {
    expectError(await api.get('/english/cron/runs/khong-ton-tai', { token: admin.token }), 404);
  });
});
