import { beforeAll, describe, expect, it } from 'bun:test';
import { api, expectError, expectOk } from '../helpers/app.helper';
import { resetDb } from '../helpers/db.helper';
import { createAdminUser, type TestUser } from '../helpers/auth.helper';
import { createTopic, seedPoolQuestions } from '../helpers/seed.helper';

/**
 * JOURNEY 3 — Admin chỉnh config runtime (docs/english-config.md).
 *
 * Điểm mấu chốt: PATCH từng record bị ràng buộc chéo chặn, PATCH bulk thì qua —
 * đây chính là lý do endpoint bulk tồn tại. Và config phải thật sự lái hành vi
 * (đổi maxPerBucket -> plan refill đổi theo), chứ không chỉ nằm trong DB.
 */

let admin: TestUser;
let topicId: number;

beforeAll(async () => {
  await resetDb();
  admin = await createAdminUser();
  topicId = (await createTopic('daily-life')).id;
});

describe('J3 — admin chỉnh config', () => {
  it('bước 1: đọc danh sách record kèm metadata cho UI', async () => {
    const data = await expectOk<Array<Record<string, unknown>>>(
      await api.get('/english/config/records', { token: admin.token })
    );

    expect(data.length).toBeGreaterThan(0);
    const row = data.find((r) => r.recordKey === 'question_pool.maxPerBucket');
    expect(row).toBeDefined();
    expect(row!.value).toBe(3);
    expect(row!.defaultValue).toBe(3);
    expect(row!.validation).toBeDefined();
    expect(row!.uiSchema).toBeDefined();
  });

  it('bước 2: PATCH một record thường thì được', async () => {
    const data = await expectOk<{ value: unknown }>(
      await api.patch('/english/config/question_pool.maxPerBucket', { token: admin.token, body: { value: 5 } })
    );

    expect(data.value).toBe(5);

    const snapshot = await expectOk<{ question_pool: { maxPerBucket: number } }>(
      await api.get('/english/config', { token: admin.token })
    );
    expect(snapshot.question_pool.maxPerBucket).toBe(5);
  });

  it('bước 3: config thật sự lái hành vi — refill plan đổi theo maxPerBucket', async () => {
    await seedPoolQuestions(2, { engLevel: 'A1', quizType: 'vocab', topicId });

    // maxPerBucket đang là 5 -> bucket có 2 câu còn thiếu 3.
    const withFive = await expectOk<{ buckets: Array<Record<string, number>> }>(
      await api.get('/admin/pool/buckets', {
        token: admin.token,
        query: { engLevels: 'A1', quizTypes: 'vocab', topicIds: String(topicId), scope: 'deficient' }
      })
    );
    expect(withFive.buckets[0]?.deficiency).toBe(3);

    await api.patch('/english/config/question_pool.maxPerBucket', { token: admin.token, body: { value: 3 } });

    const withThree = await expectOk<{ buckets: Array<Record<string, number>> }>(
      await api.get('/admin/pool/buckets', {
        token: admin.token,
        query: { engLevels: 'A1', quizTypes: 'vocab', topicIds: String(topicId), scope: 'deficient' }
      })
    );
    expect(withThree.buckets[0]?.deficiency).toBe(1);
  });

  it('bước 4: PATCH lẻ field có ràng buộc chéo -> 400 BUSINESS_ERROR', async () => {
    // min=1, default=3 -> đặt min=5 một mình là trạng thái không hợp lệ.
    expectError(
      await api.patch('/english/config/question_pool.manualFillMinCount', { token: admin.token, body: { value: 5 } }),
      400,
      'BUSINESS_ERROR'
    );
  });

  it('bước 5: PATCH bulk cùng lúc 2 field -> 200 (lý do bulk tồn tại)', async () => {
    expectOk(
      await api.patch('/english/config/records', {
        token: admin.token,
        body: {
          changes: [
            { recordKey: 'question_pool.manualFillMinCount', value: 5 },
            { recordKey: 'question_pool.manualFillDefaultCount', value: 6 }
          ]
        }
      })
    );

    const snapshot = await expectOk<{ question_pool: { manualFillMinCount: number; manualFillDefaultCount: number } }>(
      await api.get('/english/config', { token: admin.token })
    );
    expect(snapshot.question_pool.manualFillMinCount).toBe(5);
    expect(snapshot.question_pool.manualFillDefaultCount).toBe(6);
  });

  it('bước 6: bulk có trạng thái cuối sai -> 400 và KHÔNG ghi một nửa', async () => {
    expectError(
      await api.patch('/english/config/records', {
        token: admin.token,
        body: {
          changes: [
            { recordKey: 'question_pool.manualFillMinCount', value: 9 },
            { recordKey: 'question_pool.manualFillDefaultCount', value: 7 }
          ]
        }
      }),
      400,
      'BUSINESS_ERROR'
    );

    const snapshot = await expectOk<{ question_pool: { manualFillMinCount: number } }>(
      await api.get('/english/config', { token: admin.token })
    );
    expect(snapshot.question_pool.manualFillMinCount).toBe(5); // giá trị ở bước 5
  });

  it('bước 7: reset cũng chịu ràng buộc chéo — reset SAI THỨ TỰ thì 400', async () => {
    // Đang là min=5, default=6. Reset default (6 -> 3) trước sẽ tạo trạng thái min(5) > default(3).
    expectError(
      await api.post('/english/config/question_pool.manualFillDefaultCount/reset', { token: admin.token }),
      400,
      'BUSINESS_ERROR'
    );

    const snapshot = await expectOk<{ question_pool: { manualFillDefaultCount: number } }>(
      await api.get('/english/config', { token: admin.token })
    );
    expect(snapshot.question_pool.manualFillDefaultCount).toBe(6); // không đổi
  });

  it('bước 8: reset ĐÚNG THỨ TỰ (nới ràng buộc trước) thì về mặc định', async () => {
    expectOk(await api.post('/english/config/question_pool.manualFillMinCount/reset', { token: admin.token }));
    expectOk(await api.post('/english/config/question_pool.manualFillDefaultCount/reset', { token: admin.token }));

    const snapshot = await expectOk<{ question_pool: { manualFillMinCount: number; manualFillDefaultCount: number } }>(
      await api.get('/english/config', { token: admin.token })
    );
    expect(snapshot.question_pool.manualFillMinCount).toBe(1);
    expect(snapshot.question_pool.manualFillDefaultCount).toBe(3);
  });
});

describe('validate đầu vào config', () => {
  it('recordKey lạ -> 400', async () => {
    expectError(
      await api.patch('/english/config/khong.ton.tai', { token: admin.token, body: { value: 1 } }),
      400,
      'BUSINESS_ERROR'
    );
  });

  it('sai kiểu giá trị -> 400', async () => {
    expectError(
      await api.patch('/english/config/question_pool.maxPerBucket', { token: admin.token, body: { value: 'ba' } }),
      400
    );
  });

  it('cron sai cú pháp -> 400', async () => {
    expectError(
      await api.patch('/english/config/pool_refill_schedule.items', {
        token: admin.token,
        body: { value: [{ name: 'x', cron: 'khong-phai-cron', enabled: true }] }
      }),
      400
    );
  });

  it('tắt hết quiz type -> 400 (không còn loại nào để sinh câu)', async () => {
    const snapshot = await expectOk<{ quiz_distribution: Array<Record<string, unknown>> }>(
      await api.get('/english/config', { token: admin.token })
    );
    const allDisabled = snapshot.quiz_distribution.map((item) => ({ ...item, enabled: false }));

    expectError(
      await api.patch('/english/config/quiz_distribution.items', { token: admin.token, body: { value: allDisabled } }),
      400
    );
  });

  it('bulk rỗng -> 400', async () => {
    expectError(await api.patch('/english/config/records', { token: admin.token, body: { changes: [] } }), 400);
  });
});
