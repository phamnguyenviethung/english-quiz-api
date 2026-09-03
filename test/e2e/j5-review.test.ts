import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { api, expectError, expectOk } from '../helpers/app.helper';
import { countRows, resetDb } from '../helpers/db.helper';
import { createAdminUser, type TestUser } from '../helpers/auth.helper';
import { mockLLM } from '../helpers/llm.helper';
import { createTopic, seedPoolQuestion } from '../helpers/seed.helper';
import { vocabQuestion } from '../fixtures/pool-question.fixture';
import { reviewResult } from '../fixtures/review.fixture';

/**
 * JOURNEY 5 — AI review rồi admin duyệt (docs/question-pool-review.md).
 *
 * Hai máy trạng thái song song: `verdict` là ý kiến của AI, `status` là hành động của
 * admin. Approve là ĐƯỜNG DUY NHẤT ghi đè nội dung câu trong pool.
 */

let admin: TestUser;
let topicId: number;

async function waitForReviewCount(count: number, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await countRows('english_question_pool_reviews')) >= count) return;
    await Bun.sleep(25);
  }
  throw new Error(`Hết thời gian chờ ${count} review`);
}

beforeAll(async () => {
  await resetDb();
  admin = await createAdminUser();
  topicId = (await createTopic('daily-life')).id;
});

beforeEach(() => {
  mockLLM.reset();
});

describe('J5 — vòng review và duyệt', () => {
  let poolId: number;
  let reviewId: number;

  it('bước 1: gửi câu đi review', async () => {
    poolId = await seedPoolQuestion({ topicId, dataOverrides: { explanation: 'Bản gốc.' } });
    mockLLM.always(
      reviewResult({
        verdict: 'revised',
        score: 70,
        checklist: { explanationMismatch: true },
        issues: [{ field: 'explanation', severity: 'medium', problem: 'Chưa dẫn tới đáp án.', fix: 'Viết lại.' }],
        revisedData: vocabQuestion({ overrides: { explanation: 'Bản AI viết lại.' } })
      })
    );

    const data = await expectOk<{ accepted: number; skipped: number }>(
      await api.post('/admin/pool/reviews', { token: admin.token, body: { poolQuestionIds: [poolId] } })
    );

    expect(data).toEqual({ accepted: 1, skipped: 0 });
    await waitForReviewCount(1);
  });

  it('bước 2: gửi lại ngay -> bị bỏ qua vì đã có review pending', async () => {
    const data = await expectOk<{ accepted: number; skipped: number }>(
      await api.post('/admin/pool/reviews', { token: admin.token, body: { poolQuestionIds: [poolId] } })
    );

    expect(data).toEqual({ accepted: 0, skipped: 1 });
  });

  it('bước 3: danh sách review pending', async () => {
    const page = await expectOk<{ items: Array<{ id: number; status: string; verdict: string; score: number }> }>(
      await api.get('/admin/pool/reviews', { token: admin.token, query: { status: 'pending' } })
    );

    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.verdict).toBe('revised');
    expect(page.items[0]!.score).toBe(70);
    reviewId = page.items[0]!.id;
  });

  it('bước 4: chi tiết review có diff + checklist để admin quyết định', async () => {
    const detail = await expectOk<{
      checklist: Record<string, boolean>;
      issues: unknown[];
      changedFields: string[];
      diff: Array<{ field: string; before: unknown; after: unknown }>;
    }>(await api.get(`/admin/pool/reviews/${reviewId}`, { token: admin.token }));

    expect(detail.changedFields).toContain('explanation');
    expect(detail.checklist.explanationMismatch).toBe(true);
    expect(detail.checklist.formatValid).toBe(true); // server tự tính, không lấy từ AI
    expect(detail.issues).toHaveLength(1);

    const explanationDiff = detail.diff.find((d) => d.field === 'explanation');
    expect(explanationDiff?.before).toBe('Bản gốc.');
    expect(explanationDiff?.after).toBe('Bản AI viết lại.');
  });

  it('bước 5: approve ghi đè nội dung câu trong pool', async () => {
    expectOk(await api.post(`/admin/pool/reviews/${reviewId}/approve`, { token: admin.token, body: {} }));

    const page = await expectOk<{ items: Array<{ id: number; questionData: string }> }>(
      await api.get('/english/pool/questions', { token: admin.token, query: { topicId } })
    );
    const updated = page.items.find((item) => item.id === poolId)!;

    expect(JSON.parse(updated.questionData).explanation).toBe('Bản AI viết lại.');
  });

  it('bước 6: approve lần hai -> 400 (chỉ review pending mới duyệt được)', async () => {
    expectError(
      await api.post(`/admin/pool/reviews/${reviewId}/approve`, { token: admin.token, body: {} }),
      400,
      'BUSINESS_ERROR'
    );
  });
});

describe('J5 — nhánh admin tự sửa và nhánh từ chối', () => {
  it('approve kèm data admin -> bản admin thắng bản AI', async () => {
    const poolId = await seedPoolQuestion({ topicId, dataOverrides: { explanation: 'Gốc.' } });
    mockLLM.always(reviewResult({ revisedData: vocabQuestion({ overrides: { explanation: 'Bản AI.' } }) }));
    await api.post('/admin/pool/reviews', { token: admin.token, body: { poolQuestionIds: [poolId] } });
    await waitForReviewCount(2);

    const page = await expectOk<{ items: Array<{ id: number; poolQuestionRefId: number }> }>(
      await api.get('/admin/pool/reviews', { token: admin.token, query: { poolQuestionRefId: poolId } })
    );
    const reviewId = page.items[0]!.id;

    expectOk(
      await api.post(`/admin/pool/reviews/${reviewId}/approve`, {
        token: admin.token,
        body: { data: vocabQuestion({ overrides: { explanation: 'Bản admin tự viết.' } }) }
      })
    );

    const pool = await expectOk<{ items: Array<{ id: number; questionData: string }> }>(
      await api.get('/english/pool/questions', { token: admin.token, query: { topicId } })
    );
    const updated = pool.items.find((item) => item.id === poolId)!;
    expect(JSON.parse(updated.questionData).explanation).toBe('Bản admin tự viết.');
  });

  it('approve với data sai schema -> 400, pool giữ nguyên', async () => {
    const poolId = await seedPoolQuestion({ topicId, dataOverrides: { explanation: 'Giữ nguyên.' } });
    mockLLM.always(reviewResult());
    await api.post('/admin/pool/reviews', { token: admin.token, body: { poolQuestionIds: [poolId] } });
    await waitForReviewCount(3);

    const page = await expectOk<{ items: Array<{ id: number }> }>(
      await api.get('/admin/pool/reviews', { token: admin.token, query: { poolQuestionRefId: poolId } })
    );

    expectError(
      await api.post(`/admin/pool/reviews/${page.items[0]!.id}/approve`, {
        token: admin.token,
        body: { data: { rac: true } }
      }),
      400
    );

    const pool = await expectOk<{ items: Array<{ id: number; questionData: string }> }>(
      await api.get('/english/pool/questions', { token: admin.token, query: { topicId } })
    );
    const unchanged = pool.items.find((item) => item.id === poolId)!;
    expect(JSON.parse(unchanged.questionData).explanation).toBe('Giữ nguyên.');
  });

  it('reject KHÔNG đụng pool và chuyển review sang rejected', async () => {
    const poolId = await seedPoolQuestion({ topicId, dataOverrides: { explanation: 'Không bị sửa.' } });
    mockLLM.always(reviewResult({ revisedData: vocabQuestion({ overrides: { explanation: 'AI muốn sửa.' } }) }));
    await api.post('/admin/pool/reviews', { token: admin.token, body: { poolQuestionIds: [poolId] } });
    await waitForReviewCount(4);

    const page = await expectOk<{ items: Array<{ id: number }> }>(
      await api.get('/admin/pool/reviews', { token: admin.token, query: { poolQuestionRefId: poolId } })
    );
    const reviewId = page.items[0]!.id;

    expectOk(
      await api.post(`/admin/pool/reviews/${reviewId}/reject`, { token: admin.token, body: { note: 'không đạt' } })
    );

    const pool = await expectOk<{ items: Array<{ id: number; questionData: string }> }>(
      await api.get('/english/pool/questions', { token: admin.token, query: { topicId } })
    );
    expect(JSON.parse(pool.items.find((i) => i.id === poolId)!.questionData).explanation).toBe('Không bị sửa.');

    const detail = await expectOk<{ status: string }>(
      await api.get(`/admin/pool/reviews/${reviewId}`, { token: admin.token })
    );
    expect(detail.status).toBe('rejected');
  });

  it('LLM lỗi -> review status=failed, endpoint vẫn 200', async () => {
    const poolId = await seedPoolQuestion({ topicId });
    mockLLM.fail(new Error('OpenRouter timeout'));

    expectOk(await api.post('/admin/pool/reviews', { token: admin.token, body: { poolQuestionIds: [poolId] } }));
    await waitForReviewCount(5);

    const page = await expectOk<{ items: Array<{ status: string }> }>(
      await api.get('/admin/pool/reviews', { token: admin.token, query: { poolQuestionRefId: poolId } })
    );
    expect(page.items[0]!.status).toBe('failed');
  });
});

describe('J5 — validate đầu vào', () => {
  it('quá 30 id -> 400 VALIDATION', async () => {
    const ids = Array.from({ length: 31 }, (_, i) => i + 1);
    expectError(
      await api.post('/admin/pool/reviews', { token: admin.token, body: { poolQuestionIds: ids } }),
      400,
      'VALIDATION'
    );
  });

  it('danh sách rỗng -> 400 VALIDATION', async () => {
    expectError(await api.post('/admin/pool/reviews', { token: admin.token, body: { poolQuestionIds: [] } }), 400);
  });

  it('review không tồn tại -> 404', async () => {
    expectError(await api.get('/admin/pool/reviews/999999', { token: admin.token }), 404);
  });

  it('xoá review', async () => {
    const page = await expectOk<{ items: Array<{ id: number }> }>(
      await api.get('/admin/pool/reviews', { token: admin.token, query: { status: 'failed' } })
    );
    const id = page.items[0]!.id;

    expectOk(await api.delete(`/admin/pool/reviews/${id}`, { token: admin.token }));
    expectError(await api.get(`/admin/pool/reviews/${id}`, { token: admin.token }), 404);
  });
});
