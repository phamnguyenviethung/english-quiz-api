import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { api, expectError, expectOk } from '../helpers/app.helper';
import { resetDb } from '../helpers/db.helper';
import { createAdminUser, type TestUser } from '../helpers/auth.helper';
import { mockLLM } from '../helpers/llm.helper';
import { createTopic, seedPoolQuestion, seedPoolQuestions, seedReadyPassage } from '../helpers/seed.helper';
import { createTestTenant } from '../helpers/tenant.helper';

/**
 * JOURNEY 9 — Nội dung cho người mới học (docs/beginner.md).
 *
 * Admin bật cờ beginner cho topic → xem trước bucket beginner → bot gọi `beginner=true` để
 * chỉ nhận câu/bài beginner (≤ B1, ≤ 4 đáp án). Bất biến trung tâm: bot không truyền
 * `beginner` thì KHÔNG BAO GIỜ nhận nội dung beginner, và ngược lại.
 */

let admin: TestUser;
let apiKey: string;
let familyTopicId: number;
let businessTopicId: number;
let beginnerIds: number[];
let standardIds: number[];

beforeAll(async () => {
  await resetDb();
  admin = await createAdminUser();
  familyTopicId = (await createTopic('family')).id;
  businessTopicId = (await createTopic('business')).id;
  ({ apiKey } = await createTestTenant({ allowAllTopics: true, allowAllQuizTypes: true }));

  beginnerIds = await seedPoolQuestions(2, {
    engLevel: 'A1',
    quizType: 'vocab',
    topicId: familyTopicId,
    forBeginner: true
  });
  standardIds = await seedPoolQuestions(2, { engLevel: 'A1', quizType: 'vocab', topicId: familyTopicId });
});

beforeEach(() => {
  mockLLM.reset();
});

describe('J9 — admin bật beginner cho topic', () => {
  it('bước 1: topic mới tạo chưa dành cho beginner', async () => {
    const topics = await expectOk<Array<{ id: number }>>(
      await api.get('/english/topics', { token: apiKey, query: { beginner: 'true' } })
    );
    expect(topics).toHaveLength(0);
  });

  it('bước 2: admin bật cờ beginner cho topic family', async () => {
    const topic = await expectOk<{ id: number; forBeginner: boolean }>(
      await api.patch(`/english/topics/${familyTopicId}`, { token: admin.token, body: { forBeginner: true } })
    );
    expect(topic.forBeginner).toBe(true);
  });

  it('bước 3: bot lấy danh sách topic beginner chỉ thấy family', async () => {
    const topics = await expectOk<Array<{ id: number; forBeginner: boolean }>>(
      await api.get('/english/topics', { token: apiKey, query: { beginner: 'true' } })
    );
    expect(topics.map((t) => t.id)).toEqual([familyTopicId]);

    const all = await expectOk<Array<{ id: number }>>(await api.get('/english/topics', { token: apiKey }));
    expect(all.map((t) => t.id).sort()).toEqual([familyTopicId, businessTopicId].sort());
  });

  it('bước 4: preview bucket beginner chỉ gồm topic family, A1–B1, 4 đáp án', async () => {
    const preview = await expectOk<{
      buckets: Array<{
        bucketKey: string;
        topicId: number;
        engLevel: string;
        optionCount: number;
        forBeginner: boolean;
      }>;
    }>(
      await api.get('/admin/pool/buckets', { token: admin.token, query: { audience: 'beginner', quizTypes: 'vocab' } })
    );

    expect(preview.buckets).toHaveLength(3);
    for (const bucket of preview.buckets) {
      expect(bucket.forBeginner).toBe(true);
      expect(bucket.topicId).toBe(familyTopicId);
      expect(bucket.optionCount).toBe(4);
      expect(bucket.bucketKey.endsWith(':beginner')).toBe(true);
    }
    expect(preview.buckets.map((b) => b.engLevel).sort()).toEqual(['A1', 'A2', 'B1']);
    expect(mockLLM.callCount).toBe(0);
  });

  it('audience không hợp lệ bị từ chối', async () => {
    expectError(await api.get('/admin/pool/buckets', { token: admin.token, query: { audience: 'kids' } }), 400);
  });
});

describe('J9 — bot phục vụ người mới học', () => {
  it('bot lấy danh sách loại câu beginner (không có slang, idiom)', async () => {
    const types = await expectOk<string[]>(
      await api.get('/english/quiz-types', { token: apiKey, query: { beginner: 'true' } })
    );
    expect(types).toContain('vocab');
    expect(types).not.toContain('slang');
    expect(types).not.toContain('idiom');
  });

  it('pop beginner chỉ trả câu beginner', async () => {
    for (let i = 0; i < 6; i += 1) {
      const question = await expectOk<{ id: number; forBeginner: boolean }>(
        await api.get('/english/pool/pop', {
          token: apiKey,
          query: { engLevel: 'A1', topicId: familyTopicId, beginner: 'true' }
        })
      );
      expect(beginnerIds).toContain(question.id);
      expect(question.forBeginner).toBe(true);
    }
  });

  it('pop không truyền beginner không bao giờ trả câu beginner', async () => {
    for (let i = 0; i < 6; i += 1) {
      const question = await expectOk<{ id: number; forBeginner: boolean }>(
        await api.get('/english/pool/pop', { token: apiKey, query: { engLevel: 'A1', topicId: familyTopicId } })
      );
      expect(standardIds).toContain(question.id);
      expect(question.forBeginner).toBe(false);
    }
  });

  it('đếm bucket beginner tách khỏi bucket thường', async () => {
    const beginner = await expectOk<{ count: number; forBeginner: boolean }>(
      await api.get('/english/pool/count', {
        token: apiKey,
        query: { engLevel: 'A1', quizType: 'vocab', topicId: familyTopicId, beginner: 'true' }
      })
    );
    expect(beginner).toMatchObject({ count: 2, forBeginner: true });
  });

  it('beginner ở level B2 bị từ chối vì trần beginner là B1', async () => {
    expectError(
      await api.get('/english/pool/pop', {
        token: apiKey,
        query: { engLevel: 'B2', topicId: familyTopicId, beginner: 'true' }
      }),
      400
    );
  });

  it('sinh realtime câu beginner 5 đáp án bị từ chối trước khi gọi model', async () => {
    expectError(
      await api.post('/english/generate/vocab', {
        token: apiKey,
        body: { engLevel: 'A2', optionCount: 5, forBeginner: true }
      }),
      400
    );
    expect(mockLLM.callCount).toBe(0);
  });

  it('bot đọc bài beginner, bài thường không lẫn vào', async () => {
    const beginnerPassageId = await seedReadyPassage({ cefrLevel: 'A2', topicId: familyTopicId, forBeginner: true });
    await seedReadyPassage({ cefrLevel: 'A2', topicId: familyTopicId });

    const reading = await expectOk<{ passage: { id: number; forBeginner: boolean }; questions: unknown[] }>(
      await api.get('/english/readings/pop', { token: apiKey, query: { cefrLevel: 'A2', beginner: 'true' } })
    );
    expect(reading.passage.id).toBe(beginnerPassageId);
    expect(reading.passage.forBeginner).toBe(true);
    expect(reading.questions).toHaveLength(3);
  });

  it('bài đọc beginner không có type academic', async () => {
    expectError(
      await api.get('/english/readings/pop', { token: apiKey, query: { type: 'academic', beginner: 'true' } }),
      400
    );
  });
});

describe('J9 — admin chỉnh cờ beginner cho từng câu', () => {
  it('đánh dấu câu A2 bốn đáp án thành beginner', async () => {
    const id = await seedPoolQuestion({ engLevel: 'A2', quizType: 'vocab', topicId: familyTopicId });

    const updated = await expectOk<{ id: number; forBeginner: boolean }>(
      await api.patch(`/admin/pool/questions/${id}`, { token: admin.token, body: { forBeginner: true } })
    );
    expect(updated.forBeginner).toBe(true);

    const popped = await expectOk<{ id: number }>(
      await api.get('/english/pool/pop', {
        token: apiKey,
        query: { engLevel: 'A2', topicId: familyTopicId, beginner: 'true' }
      })
    );
    expect(popped.id).toBe(id);
  });

  it('câu B2 không được đánh dấu beginner', async () => {
    const id = await seedPoolQuestion({ engLevel: 'B2', quizType: 'vocab', optionCount: 5, topicId: familyTopicId });

    expectError(
      await api.patch(`/admin/pool/questions/${id}`, { token: admin.token, body: { forBeginner: true } }),
      400
    );
  });

  it('câu không tồn tại trả 404', async () => {
    expectError(
      await api.patch('/admin/pool/questions/999999', { token: admin.token, body: { forBeginner: true } }),
      404
    );
  });

  it('tenant không sửa được cờ topic', async () => {
    const res = await api.patch(`/english/topics/${familyTopicId}`, { token: apiKey, body: { forBeginner: false } });
    expect(res.status).toBe(403);
  });
});
