import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { api, expectError, expectOk, waitForRun } from '../helpers/app.helper';
import { resetDb } from '../helpers/db.helper';
import { setConfig } from '../helpers/config.helper';
import { createAdminUser, type TestUser } from '../helpers/auth.helper';
import { mockLLM } from '../helpers/llm.helper';
import { createTopic, seedPoolQuestion } from '../helpers/seed.helper';
import { vocabQuestion } from '../fixtures/pool-question.fixture';
import { getEnglishConfigSnapshot } from '@/core/services/english/englishConfig.service';
import db from '@/configs/orm.config';
import { englishQuestionPool } from '@/core/db/schema/main';
import { eq } from 'drizzle-orm';

/**
 * JOURNEY 6 — Sinh câu tương tự (docs/sibling-question.md).
 *
 * Khác review: KHÔNG có bước duyệt, câu đạt validate là vào pool luôn. Nên các cổng
 * validate chính là hàng rào chất lượng duy nhất.
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

function sibling(index: number): Record<string, unknown> {
  return vocabQuestion({
    overrides: {
      wrongAnswers: [`sai ${index}a`, `sai ${index}b`, `sai ${index}c`],
      wrongAnswerExplanations: [`vì ${index}a`, `vì ${index}b`, `vì ${index}c`],
      exampleSentence: `A distinct new example sentence ${index}.`
    }
  });
}

beforeAll(async () => {
  await resetDb();
  admin = await createAdminUser();
  topicId = (await createTopic('daily-life')).id;
  await onlyVocab();
});

beforeEach(() => {
  mockLLM.reset();
});

describe('J6 — sinh sibling cho một câu', () => {
  it('bước 1: xem loại nào hỗ trợ và field nào bị khoá', async () => {
    const data = await expectOk<Array<{ quizType: string; lockFields: string[] }>>(
      await api.get('/admin/pool/siblings/supported-types', { token: admin.token })
    );

    expect(data).toHaveLength(9);
    expect(data.map((t) => t.quizType)).not.toContain('odd-one-out');
    expect(data.find((t) => t.quizType === 'vocab')?.lockFields).toEqual(['word', 'partOfSpeech']);
  });

  it('bước 2: loại không hỗ trợ -> 400', async () => {
    const id = await seedPoolQuestion({ topicId });
    await db.update(englishQuestionPool).set({ quizType: 'odd-one-out' }).where(eq(englishQuestionPool.id, id));

    expectError(
      await api.post(`/admin/pool/siblings/${id}`, { token: admin.token, body: { count: 1 } }),
      400,
      'BUSINESS_ERROR'
    );
    expect(mockLLM.callCount).toBe(0);
  });

  it('bước 3: sinh 2 sibling, ghi thẳng vào pool với sourceQuestionId', async () => {
    await setConfig({ 'question_pool.maxPerBucket': 10 });
    const sourceId = await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId });
    mockLLM.enqueue({ questions: [sibling(1), sibling(2)] });

    const result = await expectOk<{
      requested: number;
      generated: number;
      inserted: number;
      failed: number;
      poolQuestionIds: number[];
      warnings: string[];
    }>(await api.post(`/admin/pool/siblings/${sourceId}`, { token: admin.token, body: { count: 2 } }));

    expect(result.requested).toBe(2);
    expect(result.generated).toBe(2);
    expect(result.inserted).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.poolQuestionIds).toHaveLength(2);

    const page = await expectOk<{ items: Array<{ id: number; sourceQuestionId: number }>; total: number }>(
      await api.get('/english/pool/questions', { token: admin.token, query: { sourceQuestionId: sourceId } })
    );
    expect(page.total).toBe(2);
    expect(page.items.every((item) => item.sourceQuestionId === sourceId)).toBe(true);
  });

  it('bước 4: lọc onlySiblings thấy đúng các câu vừa sinh', async () => {
    const page = await expectOk<{ total: number; items: Array<{ sourceQuestionId: number | null }> }>(
      await api.get('/english/pool/questions', { token: admin.token, query: { onlySiblings: true } })
    );

    expect(page.total).toBeGreaterThanOrEqual(2);
    expect(page.items.every((item) => item.sourceQuestionId !== null)).toBe(true);
  });

  it('count > 5 -> 400 VALIDATION (trần batch schema của LLM)', async () => {
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', topicId });
    expectError(
      await api.post(`/admin/pool/siblings/${sourceId}`, { token: admin.token, body: { count: 6 } }),
      400,
      'VALIDATION'
    );
  });

  it('câu gốc không tồn tại -> 404', async () => {
    expectError(await api.post('/admin/pool/siblings/999999', { token: admin.token, body: { count: 1 } }), 404);
  });

  it('candidate trùng ngữ cảnh câu gốc bị loại, báo rõ trong warnings', async () => {
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', topicId });
    mockLLM.enqueue({ questions: [vocabQuestion(), sibling(9)] });

    const result = await expectOk<{ generated: number; inserted: number; failed: number; warnings: string[] }>(
      await api.post(`/admin/pool/siblings/${sourceId}`, { token: admin.token, body: { count: 2 } })
    );

    expect(result.generated).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.warnings.some((w) => w.includes('Ngữ cảnh trùng câu gốc'))).toBe(true);
  });

  it('model đổi field khoá -> tự khôi phục, câu vẫn được nhận', async () => {
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', topicId });
    mockLLM.enqueue({ questions: [{ ...sibling(11), word: 'lazy' }] });

    const result = await expectOk<{ inserted: number; warnings: string[]; poolQuestionIds: number[] }>(
      await api.post(`/admin/pool/siblings/${sourceId}`, { token: admin.token, body: { count: 1 } })
    );

    expect(result.inserted).toBe(1);
    expect(result.warnings.some((w) => w.includes('word'))).toBe(true);

    const page = await expectOk<{ items: Array<{ questionData: string }> }>(
      await api.get('/english/pool/questions', { token: admin.token, query: { sourceQuestionId: sourceId } })
    );
    expect(JSON.parse(page.items[0]!.questionData).word).toBe('diligent');
  });
});

describe('J6 — refill sibling hàng loạt', () => {
  it('preview cho biết số nguồn và số sibling sẽ sinh', async () => {
    const freshTopic = (await createTopic(`bulk-${Date.now()}`)).id;
    await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId: freshTopic });

    const data = await expectOk<{
      buckets: Array<{ sourceCount: number; plannedSources: number; plannedCount: number }>;
      summary: Record<string, number>;
    }>(
      await api.get('/admin/pool/siblings/buckets', {
        token: admin.token,
        query: {
          engLevels: 'A1',
          quizTypes: 'vocab',
          topicIds: String(freshTopic),
          scope: 'all',
          sourcesPerBucket: 1,
          siblingsPerSource: 2
        }
      })
    );

    const bucket = data.buckets.find((b) => b.sourceCount > 0)!;
    expect(bucket.sourceCount).toBe(1);
    expect(bucket.plannedSources).toBe(1);
    expect(bucket.plannedCount).toBe(2);
    expect(mockLLM.callCount).toBe(0);
  });

  it('refill hàng loạt chạy nền rồi poll được tiến độ', async () => {
    const freshTopic = (await createTopic(`bulk2-${Date.now()}`)).id;
    const sourceId = await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId: freshTopic });
    mockLLM.always({ questions: [sibling(21), sibling(22)] });

    const result = await expectOk<{ runId: string; totalBuckets: number }>(
      await api.post('/admin/pool/siblings/refill', {
        token: admin.token,
        body: {
          scope: 'all',
          sourcesPerBucket: 1,
          siblingsPerSource: 2,
          filter: { engLevels: ['A1'], quizTypes: ['vocab'], topicIds: [freshTopic] }
        }
      })
    );

    expect(result.totalBuckets).toBe(1);
    const detail = await waitForRun(result.runId, admin.token);
    expect(['success', 'partial_success']).toContain(detail.run.status);

    const page = await expectOk<{ total: number }>(
      await api.get('/english/pool/questions', { token: admin.token, query: { sourceQuestionId: sourceId } })
    );
    expect(page.total).toBe(2);
  });

  it('quizType không hỗ trợ trong filter -> 400 ngay ở controller', async () => {
    expectError(
      await api.post('/admin/pool/siblings/refill', {
        token: admin.token,
        body: { scope: 'all', filter: { quizTypes: ['odd-one-out'] } }
      }),
      400,
      'BUSINESS_ERROR'
    );
  });

  it('siblingsPerSource > 5 -> 400 VALIDATION', async () => {
    expectError(
      await api.post('/admin/pool/siblings/refill', { token: admin.token, body: { siblingsPerSource: 6 } }),
      400,
      'VALIDATION'
    );
  });

  it("scope 'deficient' tôn trọng maxPerBucket", async () => {
    const freshTopic = (await createTopic(`cap-${Date.now()}`)).id;
    await setConfig({ 'question_pool.maxPerBucket': 2 });
    await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId: freshTopic });
    mockLLM.always({ questions: [sibling(31), sibling(32), sibling(33)] });

    const result = await expectOk<{ runId: string }>(
      await api.post('/admin/pool/siblings/refill', {
        token: admin.token,
        body: {
          scope: 'deficient',
          sourcesPerBucket: 1,
          siblingsPerSource: 3,
          filter: { engLevels: ['A1'], quizTypes: ['vocab'], topicIds: [freshTopic] }
        }
      })
    );
    await waitForRun(result.runId, admin.token);

    const count = await expectOk<{ count: number }>(
      await api.get('/english/pool/count', {
        token: admin.token,
        query: { engLevel: 'A1', quizType: 'vocab', topicId: freshTopic }
      })
    );
    expect(count.count).toBe(2); // 1 câu gốc + 1 sibling, đúng trần

    await setConfig({ 'question_pool.maxPerBucket': 10 });
  });
});
