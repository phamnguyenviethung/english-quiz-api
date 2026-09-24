import { beforeAll, describe, expect, it } from 'bun:test';
import { api, expectError, expectOk } from '../helpers/app.helper';
import { resetDb } from '../helpers/db.helper';
import { createAdminUser, type TestUser } from '../helpers/auth.helper';
import { createTopic, seedPoolQuestions } from '../helpers/seed.helper';
import { createTestTenant } from '../helpers/tenant.helper';
import apiKeyService from '@/core/services/tenant/apiKey.service';
import tenantService from '@/core/services/tenant/tenant.service';

/**
 * JOURNEY 2 — Ma trận phân quyền 2 tầng (docs/tenant-auth.md).
 *
 * Tầng 1: có phải tenant/admin hợp lệ không (401).
 * Tầng 2: tenant này có được chạm topic/quizType đó không (403).
 * Cộng thêm: phiên admin là super key trên /english/*.
 */

let admin: TestUser;
let allowedTopicId: number;
let forbiddenTopicId: number;
let restricted: Awaited<ReturnType<typeof createTestTenant>>;

beforeAll(async () => {
  await resetDb();
  admin = await createAdminUser();

  allowedTopicId = (await createTopic('allowed')).id;
  forbiddenTopicId = (await createTopic('forbidden')).id;

  await seedPoolQuestions(2, { engLevel: 'A1', quizType: 'vocab', topicId: allowedTopicId });
  await seedPoolQuestions(2, { engLevel: 'A1', quizType: 'vocab', topicId: forbiddenTopicId });
  await seedPoolQuestions(2, { engLevel: 'A1', quizType: 'idiom', topicId: allowedTopicId });
  await seedPoolQuestions(2, { engLevel: 'A1', quizType: 'vocab', topicId: null });

  restricted = await createTestTenant({ topicIds: [allowedTopicId], quizTypes: ['vocab'] });
});

describe('tầng 1 — xác thực', () => {
  it('không có header -> 401', async () => {
    expectError(await api.get('/english/pool/pop', { query: { engLevel: 'A1' } }), 401, 'UNAUTHORIZED');
  });

  it('API key không tồn tại -> 401', async () => {
    expectError(
      await api.get('/english/pool/pop', { token: 'eqk_khongtontai', query: { engLevel: 'A1' } }),
      401,
      'UNAUTHORIZED'
    );
  });

  it('token rác không phải eqk_ cũng -> 401', async () => {
    expectError(await api.get('/english/pool/pop', { token: 'rac', query: { engLevel: 'A1' } }), 401);
  });

  it('key đã bị thu hồi -> 401', async () => {
    const t = await createTestTenant({ allowAllTopics: true, allowAllQuizTypes: true });
    expectOk(await api.get('/english/quiz-types', { token: t.apiKey }));

    await apiKeyService.revokeKey(t.tenant.id, t.apiKeyId);

    expectError(await api.get('/english/quiz-types', { token: t.apiKey }), 401);
  });

  it('tenant bị vô hiệu hoá -> key còn nguyên vẫn 401', async () => {
    const t = await createTestTenant({ allowAllTopics: true, allowAllQuizTypes: true });
    await tenantService.deactivateTenant(t.tenant.id);

    expectError(await api.get('/english/quiz-types', { token: t.apiKey }), 401);
  });
});

describe('tầng 2 — allow-list topic', () => {
  it('topic được cấp -> 200', async () => {
    const data = await expectOk<{ topicId: number }>(
      await api.get('/english/pool/pop', {
        token: restricted.apiKey,
        query: { engLevel: 'A1', topicId: allowedTopicId }
      })
    );

    expect(data.topicId).toBe(allowedTopicId);
  });

  it('topic KHÔNG được cấp -> 403 FORBIDDEN (không phải 404)', async () => {
    expectError(
      await api.get('/english/pool/pop', {
        token: restricted.apiKey,
        query: { engLevel: 'A1', topicId: forbiddenTopicId }
      }),
      403,
      'FORBIDDEN'
    );
  });

  it('bucket không topic luôn được phép', async () => {
    const data = await expectOk<{ topicId: number | null }>(
      await api.get('/english/pool/pop', { token: restricted.apiKey, query: { engLevel: 'A1' } })
    );

    expect(data.topicId).toBeNull();
  });

  it('GET /english/topics chỉ trả topic trong allow-list', async () => {
    const data = await expectOk<Array<{ id: number }>>(await api.get('/english/topics', { token: restricted.apiKey }));

    expect(data.map((t) => t.id)).toEqual([allowedTopicId]);
  });

  it('allowAllTopics bỏ qua allow-list', async () => {
    const open = await createTestTenant({ allowAllTopics: true, allowAllQuizTypes: true });

    const data = await expectOk<{ topicId: number }>(
      await api.get('/english/pool/pop', { token: open.apiKey, query: { engLevel: 'A1', topicId: forbiddenTopicId } })
    );

    expect(data.topicId).toBe(forbiddenTopicId);
  });
});

describe('tầng 2 — allow-list quizType', () => {
  it('quizType được cấp -> 200', async () => {
    const data = await expectOk<{ count: number }>(
      await api.get('/english/pool/count', {
        token: restricted.apiKey,
        query: { engLevel: 'A1', quizType: 'vocab', topicId: allowedTopicId }
      })
    );

    expect(data.count).toBe(2);
  });

  it('quizType KHÔNG được cấp -> 403', async () => {
    expectError(
      await api.get('/english/pool/count', {
        token: restricted.apiKey,
        query: { engLevel: 'A1', quizType: 'idiom', topicId: allowedTopicId }
      }),
      403,
      'FORBIDDEN'
    );
  });

  // /pool/pop không nhận quizType cụ thể nên không assert 403 được — phải LỌC kết quả theo
  // allow-list (giống /topics). Bucket allowedTopic có cả vocab lẫn idiom, tenant chỉ được vocab.
  it('pop chỉ trả câu thuộc quizType được cấp', async () => {
    const quizTypes = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const data = await expectOk<{ quizType: string }>(
        await api.get('/english/pool/pop', {
          token: restricted.apiKey,
          query: { engLevel: 'A1', topicId: allowedTopicId }
        })
      );
      quizTypes.add(data.quizType);
    }

    expect([...quizTypes]).toEqual(['vocab']);
  });

  it('tenant chưa được cấp quizType nào -> pop không trả câu nào (404)', async () => {
    const noTypes = await createTestTenant({ topicIds: [allowedTopicId] });

    expectError(
      await api.get('/english/pool/pop', { token: noTypes.apiKey, query: { engLevel: 'A1', topicId: allowedTopicId } }),
      404,
      'NOT_FOUND'
    );
  });

  it('allowAllQuizTypes -> pop ra được mọi quizType', async () => {
    const allTypes = await createTestTenant({ topicIds: [allowedTopicId], allowAllQuizTypes: true });
    const quizTypes = new Set<string>();
    for (let i = 0; i < 30; i += 1) {
      const data = await expectOk<{ quizType: string }>(
        await api.get('/english/pool/pop', {
          token: allTypes.apiKey,
          query: { engLevel: 'A1', topicId: allowedTopicId }
        })
      );
      quizTypes.add(data.quizType);
    }

    expect([...quizTypes].sort()).toEqual(['idiom', 'vocab']);
  });
});

describe('endpoint admin-only nằm dưới /english/*', () => {
  it('tenant gọi POST /english/pool/fill -> 403', async () => {
    expectError(
      await api.post('/english/pool/fill', {
        token: restricted.apiKey,
        body: { engLevel: 'A1', quizType: 'vocab', optionCount: 4, topicId: allowedTopicId }
      }),
      403,
      'FORBIDDEN'
    );
  });

  it('body sai schema bị chặn TRƯỚC cả check quyền admin (validation chạy trước)', async () => {
    // Ghi nhận thứ tự thật của Elysia: thiếu field bắt buộc cho 400 VALIDATION, không phải 403.
    expectError(
      await api.post('/english/pool/fill', {
        token: restricted.apiKey,
        body: { engLevel: 'A1', quizType: 'vocab', topicId: allowedTopicId }
      }),
      400,
      'VALIDATION'
    );
  });

  it('tenant gọi POST /english/topics -> 403', async () => {
    expectError(await api.post('/english/topics', { token: restricted.apiKey, body: { name: 'x' } }), 403);
  });

  it('tenant gọi GET /english/config -> 403', async () => {
    expectError(await api.get('/english/config', { token: restricted.apiKey }), 403);
  });

  it('tenant gọi /english/cron/runs -> 403', async () => {
    expectError(await api.get('/english/cron/runs', { token: restricted.apiKey }), 403);
  });
});

describe('/admin/* từ chối API key tenant', () => {
  it('key tenant (kể cả allow-all) -> 401 chứ không phải 403', async () => {
    const open = await createTestTenant({ allowAllTopics: true, allowAllQuizTypes: true });
    expectError(await api.get('/admin/tenants', { token: open.apiKey }), 401, 'UNAUTHORIZED');
  });
});

describe('phiên admin là SUPER KEY trên /english/*', () => {
  it('pop được cả topic mà không tenant nào được cấp', async () => {
    const data = await expectOk<{ topicId: number }>(
      await api.get('/english/pool/pop', { token: admin.token, query: { engLevel: 'A1', topicId: forbiddenTopicId } })
    );

    expect(data.topicId).toBe(forbiddenTopicId);
  });

  it('gọi được endpoint admin-only của /english/*', async () => {
    expectOk(await api.get('/english/config', { token: admin.token }));
    expectOk(await api.get('/english/cron/runs', { token: admin.token }));
  });

  it('thấy TẤT CẢ topic, không bị lọc theo allow-list', async () => {
    const data = await expectOk<Array<{ id: number }>>(await api.get('/english/topics', { token: admin.token }));

    expect(data.map((t) => t.id).sort()).toEqual([allowedTopicId, forbiddenTopicId].sort());
  });

  it('mọi quizType đều dùng được', async () => {
    expectOk(
      await api.get('/english/pool/count', {
        token: admin.token,
        query: { engLevel: 'A1', quizType: 'idiom', topicId: allowedTopicId }
      })
    );
  });
});
