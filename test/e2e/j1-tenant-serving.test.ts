import { beforeAll, describe, expect, it } from 'bun:test';
import { api, expectError, expectOk } from '../helpers/app.helper';
import { resetDb } from '../helpers/db.helper';
import { createTopic, seedPoolQuestions } from '../helpers/seed.helper';
import { createTestTenant } from '../helpers/tenant.helper';

/**
 * JOURNEY 1 — Bot lấy câu hỏi phục vụ người chơi.
 *
 * Đi đúng đường bot thật đi: xác thực bằng API key -> lấy metadata -> pop câu hỏi ->
 * tự chống lặp bằng excludeIds -> đụng đáy pool -> đi thang nới lỏng của
 * docs/question-pool.md. Chạy tuần tự, các bước phụ thuộc nhau nên dùng beforeAll.
 */

let apiKey: string;
let topicId: number;
let otherTopicId: number;
let poolIds: number[];

beforeAll(async () => {
  await resetDb();
  topicId = (await createTopic('daily-life')).id;
  otherTopicId = (await createTopic('travel')).id;

  poolIds = await seedPoolQuestions(3, { engLevel: 'A1', quizType: 'vocab', topicId });
  await seedPoolQuestions(2, { engLevel: 'A1', quizType: 'vocab', topicId: otherTopicId });

  ({ apiKey } = await createTestTenant({ allowAllTopics: true, allowAllQuizTypes: true }));
});

describe('J1 — bot lấy câu hỏi', () => {
  it('bước 1: lấy danh sách quiz type', async () => {
    const data = await expectOk<string[]>(await api.get('/english/quiz-types', { token: apiKey }));

    expect(data).toHaveLength(11);
    expect(data).toContain('vocab');
    expect(data).toContain('verb-use-match');
  });

  it('bước 2: lấy danh sách topic được cấp quyền', async () => {
    const data = await expectOk<Array<{ id: number; name: string }>>(
      await api.get('/english/topics', { token: apiKey })
    );

    expect(data.map((t) => t.id).sort()).toEqual([topicId, otherTopicId].sort());
  });

  it('bước 3: chọn quiz type theo phân phối trọng số', async () => {
    const data = await expectOk<{ quizType: string }>(await api.get('/english/pool/pick-quiz-type', { token: apiKey }));

    expect(typeof data.quizType).toBe('string');
  });

  it('bước 4: đếm câu trong bucket khớp số đã seed', async () => {
    const data = await expectOk<{ count: number }>(
      await api.get('/english/pool/count', {
        token: apiKey,
        query: { engLevel: 'A1', quizType: 'vocab', topicId }
      })
    );

    expect(data.count).toBe(3);
  });

  it('bước 5: pop ra một câu hỏi dùng được', async () => {
    const data = await expectOk<{ id: number; quizType: string; questionData: string }>(
      await api.get('/english/pool/pop', { token: apiKey, query: { engLevel: 'A1', topicId } })
    );

    expect(poolIds).toContain(data.id);
    expect(data.quizType).toBe('vocab');
    expect(() => JSON.parse(data.questionData)).not.toThrow();
  });

  it('bước 6: excludeIds cho ra câu KHÁC (chống lặp phía client)', async () => {
    const first = await expectOk<{ id: number }>(
      await api.get('/english/pool/pop', { token: apiKey, query: { engLevel: 'A1', topicId } })
    );

    const second = await expectOk<{ id: number }>(
      await api.get('/english/pool/pop', {
        token: apiKey,
        query: { engLevel: 'A1', topicId, excludeIds: String(first.id) }
      })
    );

    expect(second.id).not.toBe(first.id);
  });

  it('bước 7: pop không phá huỷ — số câu trong bucket không đổi sau nhiều lần pop', async () => {
    for (let i = 0; i < 5; i += 1) {
      await api.get('/english/pool/pop', { token: apiKey, query: { engLevel: 'A1', topicId } });
    }

    const data = await expectOk<{ count: number }>(
      await api.get('/english/pool/count', {
        token: apiKey,
        query: { engLevel: 'A1', quizType: 'vocab', topicId }
      })
    );

    expect(data.count).toBe(3);
  });

  it('bước 8: loại hết câu trong bucket -> 404 NOT_FOUND', async () => {
    const res = await api.get('/english/pool/pop', {
      token: apiKey,
      query: { engLevel: 'A1', topicId, excludeIds: poolIds.join(',') }
    });

    expectError(res, 404, 'NOT_FOUND');
  });

  it('bước 9 (thang nới lỏng): đổi sang topic khác thì vẫn có câu mới', async () => {
    const data = await expectOk<{ id: number; topicId: number }>(
      await api.get('/english/pool/pop', {
        token: apiKey,
        query: { engLevel: 'A1', topicId: otherTopicId, excludeIds: poolIds.join(',') }
      })
    );

    expect(data.topicId).toBe(otherTopicId);
  });

  it('bước 10 (thang nới lỏng): bỏ excludeIds thì chấp nhận lặp, vẫn phục vụ được', async () => {
    const data = await expectOk<{ id: number }>(
      await api.get('/english/pool/pop', { token: apiKey, query: { engLevel: 'A1', topicId } })
    );

    expect(poolIds).toContain(data.id);
  });

  it('bucket rỗng (level chưa có câu) -> 404, không phân biệt với "đã loại hết"', async () => {
    expectError(await api.get('/english/pool/pop', { token: apiKey, query: { engLevel: 'B2', topicId } }), 404);
  });

  it('excludeIds có rác vẫn phục vụ bình thường (filter best-effort)', async () => {
    const data = await expectOk<{ id: number }>(
      await api.get('/english/pool/pop', {
        token: apiKey,
        query: { engLevel: 'A1', topicId, excludeIds: 'abc,,-5,0,1.5' }
      })
    );

    expect(poolIds).toContain(data.id);
  });

  it('engLevel không hợp lệ -> 400 VALIDATION', async () => {
    expectError(
      await api.get('/english/pool/pop', { token: apiKey, query: { engLevel: 'C2', topicId } }),
      400,
      'VALIDATION'
    );
  });

  it('cặp topic ngẫu nhiên không lặp topic', async () => {
    const data = await expectOk<Array<Array<{ id: number }>>>(
      await api.get('/english/topics/random-pairs', { token: apiKey, query: { pairCount: 1 } })
    );

    expect(data).toHaveLength(1);
    expect(data[0]![0]!.id).not.toBe(data[0]![1]!.id);
  });
});
