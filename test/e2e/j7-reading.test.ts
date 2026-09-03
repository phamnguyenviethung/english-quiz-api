import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { api, expectError, expectOk, waitForRun } from '../helpers/app.helper';
import { resetDb } from '../helpers/db.helper';
import { createAdminUser, type TestUser } from '../helpers/auth.helper';
import { mockLLM } from '../helpers/llm.helper';
import { createTopic } from '../helpers/seed.helper';
import { createTestTenant } from '../helpers/tenant.helper';
import { readingPassage, readingQuestionResponder } from '../fixtures/reading.fixture';

/**
 * JOURNEY 7 — Bài đọc: sinh passage -> sinh bộ câu hỏi -> tenant lấy về
 * (docs/reading-passage.md + docs/reading-question.md).
 *
 * Bất biến trung tâm: bài NỬA VỜI (thiếu câu hỏi) không bao giờ được phục vụ.
 */

let admin: TestUser;
let apiKey: string;
let topicId: number;
let passageId: number;

/**
 * Server tự chọn loại câu hỏi (random trong CEFR slot) rồi gọi model MỘT LẦN cho MỖI câu.
 * Test không đoán trước được loại, nên mock đọc loại từ chính lời gọi và trả đúng loại đó —
 * trả sai loại là bị `isValidReadingQuestionDraft` loại và cả bộ bị bỏ (all-or-nothing).
 */
function enqueueQuestionSet(): void {
  mockLLM.respond(readingQuestionResponder());
}

beforeAll(async () => {
  await resetDb();
  admin = await createAdminUser();
  topicId = (await createTopic('daily-life')).id;
  ({ apiKey } = await createTestTenant({ allowAllTopics: true, allowAllQuizTypes: true }));
});

beforeEach(() => {
  mockLLM.reset();
});

describe('J7 — dựng kho bài đọc', () => {
  it('bước 1: chưa có gì thì /english/readings/count = 0 và pop -> 404', async () => {
    const count = await expectOk<{ count: number }>(
      await api.get('/english/readings/count', { token: apiKey, query: { cefrLevel: 'A1', topicId } })
    );
    expect(count.count).toBe(0);

    expectError(
      await api.get('/english/readings/pop', { token: apiKey, query: { cefrLevel: 'A1', topicId } }),
      404,
      'NOT_FOUND'
    );
  });

  it('bước 2: refill sinh passage', async () => {
    mockLLM.always({ passages: [readingPassage(1)] });

    const result = await expectOk<{ runId: string; totalBuckets: number }>(
      await api.post('/admin/readings/refill', {
        token: admin.token,
        body: {
          scope: 'deficient',
          countPerBucket: 1,
          filter: { cefrLevels: ['A1'], topicIds: [topicId], types: ['daily'] }
        }
      })
    );

    expect(result.totalBuckets).toBe(1);
    const detail = await waitForRun(result.runId, admin.token);
    expect(['success', 'partial_success']).toContain(detail.run.status);

    const list = await expectOk<{
      items: Array<{ id: number; wordCount: number; paragraphs: string[] }>;
      total: number;
    }>(await api.get('/admin/readings', { token: admin.token, query: { cefrLevel: 'A1', topicId } }));
    expect(list.total).toBe(1);
    expect(list.items[0]!.paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(list.items[0]!.wordCount).toBeGreaterThanOrEqual(140);
    passageId = list.items[0]!.id;
  });

  it('bước 3: có passage nhưng CHƯA có câu hỏi -> vẫn không được phục vụ', async () => {
    expectError(
      await api.get('/english/readings/pop', { token: apiKey, query: { cefrLevel: 'A1', topicId } }),
      404,
      'NOT_FOUND'
    );

    const count = await expectOk<{ count: number }>(
      await api.get('/english/readings/count', { token: apiKey, query: { cefrLevel: 'A1', topicId } })
    );
    expect(count.count).toBe(0);
  });

  it('bước 4: sinh bộ câu hỏi cho passage', async () => {
    enqueueQuestionSet();

    const result = await expectOk<{ runId: string; totalBuckets: number }>(
      await api.post('/admin/reading-questions/refill', {
        token: admin.token,
        body: { mode: 'deficient', filter: { passageIds: [passageId] } }
      })
    );

    expect(result.totalBuckets).toBe(1);
    const detail = await waitForRun(result.runId, admin.token);
    expect(['success', 'partial_success']).toContain(detail.run.status);

    const list = await expectOk<{ total: number }>(
      await api.get('/admin/reading-questions', { token: admin.token, query: { passageId } })
    );
    expect(list.total).toBe(3);
  });

  it('bước 5: tenant lấy được bài KÈM đủ bộ câu hỏi', async () => {
    const data = await expectOk<{
      passage: { id: number; title: string; paragraphs: string[] };
      questions: Array<{ question: string; options: string[]; correctAnswer: number; explanation: string }>;
    }>(await api.get('/english/readings/pop', { token: apiKey, query: { cefrLevel: 'A1', topicId } }));

    expect(data.passage.id).toBe(passageId);
    expect(data.questions).toHaveLength(3);
    for (const q of data.questions) {
      expect(q.options).toHaveLength(4);
      expect(q.correctAnswer).toBeGreaterThanOrEqual(0);
      expect(q.correctAnswer).toBeLessThan(q.options.length);
      expect(q.explanation).toBeTruthy();
    }

    const count = await expectOk<{ count: number }>(
      await api.get('/english/readings/count', { token: apiKey, query: { cefrLevel: 'A1', topicId } })
    );
    expect(count.count).toBe(1);
  });

  it('bước 6: admin sửa nội dung bài -> câu hỏi cũ hết hiệu lực, bài ngừng được phục vụ', async () => {
    expectOk(
      await api.patch(`/admin/readings/${passageId}`, {
        token: admin.token,
        body: {
          paragraphs: [
            'Completely new content for this passage in the first paragraph here.',
            'And a second paragraph so the passage still has at least two blocks.'
          ]
        }
      })
    );

    expectError(
      await api.get('/english/readings/pop', { token: apiKey, query: { cefrLevel: 'A1', topicId } }),
      404,
      'NOT_FOUND'
    );
  });

  it('bước 7: sinh lại câu hỏi thì bài được phục vụ trở lại', async () => {
    enqueueQuestionSet();

    const result = await expectOk<{ runId: string }>(
      await api.post('/admin/reading-questions/refill', {
        token: admin.token,
        body: { mode: 'deficient', filter: { passageIds: [passageId] } }
      })
    );
    await waitForRun(result.runId, admin.token);

    const data = await expectOk<{ questions: unknown[] }>(
      await api.get('/english/readings/pop', { token: apiKey, query: { cefrLevel: 'A1', topicId } })
    );
    expect(data.questions).toHaveLength(3);
  });

  it('bước 8: xoá bài kéo theo câu hỏi (cascade)', async () => {
    expectOk(await api.delete(`/admin/readings/${passageId}`, { token: admin.token }));

    const questions = await expectOk<{ total: number }>(
      await api.get('/admin/reading-questions', { token: admin.token, query: { passageId } })
    );
    expect(questions.total).toBe(0);

    expectError(await api.get(`/admin/readings/${passageId}`, { token: admin.token }), 404);
  });
});

describe('J7 — filter type là ràng buộc cứng', () => {
  it('bài academic không phục vụ cho yêu cầu daily', async () => {
    const t = (await createTopic(`aca-${Date.now()}`)).id;
    mockLLM.always({ passages: [readingPassage(2)] });

    const passageRun = await expectOk<{ runId: string }>(
      await api.post('/admin/readings/refill', {
        token: admin.token,
        body: {
          scope: 'deficient',
          countPerBucket: 1,
          filter: { cefrLevels: ['A1'], topicIds: [t], types: ['academic'] }
        }
      })
    );
    await waitForRun(passageRun.runId, admin.token);

    const list = await expectOk<{ items: Array<{ id: number }> }>(
      await api.get('/admin/readings', { token: admin.token, query: { topicId: t, type: 'academic' } })
    );
    const academicId = list.items[0]!.id;

    mockLLM.reset();
    enqueueQuestionSet();
    const questionRun = await expectOk<{ runId: string }>(
      await api.post('/admin/reading-questions/refill', {
        token: admin.token,
        body: { mode: 'deficient', filter: { passageIds: [academicId] } }
      })
    );
    await waitForRun(questionRun.runId, admin.token);

    expectError(
      await api.get('/english/readings/pop', { token: apiKey, query: { cefrLevel: 'A1', topicId: t, type: 'daily' } }),
      404
    );
    expectOk(
      await api.get('/english/readings/pop', {
        token: apiKey,
        query: { cefrLevel: 'A1', topicId: t, type: 'academic' }
      })
    );
  });
});

describe('J7 — nhánh lỗi', () => {
  it('POST /admin/readings/generate với output model méo -> 400, không lưu gì', async () => {
    // Bài chỉ 1 đoạn + quá ngắn -> isValidReadingPassage loại.
    mockLLM.enqueueRaw({
      passages: [{ title: 'Quá ngắn', paragraphs: ['Chỉ một đoạn ngắn.'], wordCount: 4, topic: 'x', cefrLevel: 'A1' }]
    });

    const res = await api.post('/admin/readings/generate', {
      token: admin.token,
      body: { cefrLevel: 'A1', topicId, type: 'daily' }
    });

    expect(res.status).toBe(400);
  });

  it('reading question refill cho passage không tồn tại -> 0 bucket', async () => {
    const result = await expectOk<{ totalBuckets: number }>(
      await api.post('/admin/reading-questions/refill', {
        token: admin.token,
        body: { mode: 'deficient', filter: { passageIds: [999999] } }
      })
    );

    expect(result.totalBuckets).toBe(0);
    expect(mockLLM.callCount).toBe(0);
  });

  it('tenant không có topic nào -> pop 404 và count 0', async () => {
    const blind = await createTestTenant({ topicIds: [] });

    expectError(await api.get('/english/readings/pop', { token: blind.apiKey, query: { cefrLevel: 'A1' } }), 404);
    const count = await expectOk<{ count: number }>(
      await api.get('/english/readings/count', { token: blind.apiKey, query: { cefrLevel: 'A1' } })
    );
    expect(count.count).toBe(0);
  });
});
