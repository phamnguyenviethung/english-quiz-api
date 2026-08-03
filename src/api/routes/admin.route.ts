import { Elysia, t } from 'elysia';
import { ok, created, list } from '@/api/common/response';
import { IdParam } from '@/api/common/schemas';
import {
  ApiOk,
  ApiList,
  ApiErrorSchema,
  COMMON_ERRORS,
  TenantSchema,
  PublicApiKeySchema,
  IssuedApiKeySchema,
  TenantTopicAccessSchema,
  TenantQuizTypeAccessSchema
} from '@/api/common/responseSchemas';
import { adminAuthPlugin } from '@/api/plugins/adminAuth.plugin';
import adminController from '@/api/controllers/admin.controller';

const ADMIN_AUTH_DESCRIPTION =
  'Yêu cầu ADMIN_API_KEY qua header `x-admin-key: <ADMIN_API_KEY>` (hoặc `Authorization: Bearer <ADMIN_API_KEY>`).';

// Toàn bộ /admin/* yêu cầu ADMIN_API_KEY (adminAuthPlugin). Dùng để tạo tenant,
// cấp/thu hồi API key, và gán allow-list topic/quizType. Handler chỉ wire schema +
// gọi controller.
export const adminRoute = new Elysia({ prefix: '/admin' })
  .use(adminAuthPlugin)

  // ── Tenants ─────────────────────────────────────────────────────────────────
  .get('/tenants', async () => list(await adminController.listTenants()), {
    detail: {
      tags: ['Admin / Tenants'],
      summary: 'List tenants',
      description: `Danh sách toàn bộ tenant. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiList(TenantSchema),
      ...COMMON_ERRORS
    }
  })
  .get('/tenants/:id', async ({ params }) => ok(await adminController.getTenant(params.id)), {
    params: IdParam,
    detail: {
      tags: ['Admin / Tenants'],
      summary: 'Get tenant by id',
      description: `Chi tiết 1 tenant. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(TenantSchema),
      404: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .post(
    '/tenants',
    async ({ body, set }) => {
      set.status = 201;
      return created(await adminController.createTenant(body));
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.Nullable(t.String())),
        scopes: t.Optional(t.Array(t.String())),
        allowAllTopics: t.Optional(t.Boolean()),
        allowAllQuizTypes: t.Optional(t.Boolean())
      }),
      detail: {
        tags: ['Admin / Tenants'],
        summary: 'Create tenant',
        description: `Tạo tenant mới. \`name\` phải unique — trùng tên trả 409. ${ADMIN_AUTH_DESCRIPTION}`,
        security: [{ bearerAuth: [] }]
      },
      response: {
        201: ApiOk(TenantSchema),
        400: ApiErrorSchema,
        409: ApiErrorSchema,
        ...COMMON_ERRORS
      }
    }
  )
  // deactivate được gộp vào PATCH: gửi { isActive: false }.
  .patch('/tenants/:id', async ({ params, body }) => ok(await adminController.updateTenant(params.id, body)), {
    params: IdParam,
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1 })),
      description: t.Optional(t.Nullable(t.String())),
      scopes: t.Optional(t.Array(t.String())),
      allowAllTopics: t.Optional(t.Boolean()),
      allowAllQuizTypes: t.Optional(t.Boolean()),
      isActive: t.Optional(t.Boolean())
    }),
    detail: {
      tags: ['Admin / Tenants'],
      summary: 'Update tenant',
      description:
        `Partial update (name/description/scopes/allowAll*/isActive). Soft-deactivate bằng { isActive: false } ` +
        `— không có endpoint delete riêng. Đổi \`name\` trùng tenant khác trả 409. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(TenantSchema),
      400: ApiErrorSchema,
      404: ApiErrorSchema,
      409: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })

  // ── API keys ─────────────────────────────────────────────────────────────────
  .post(
    '/tenants/:id/keys',
    async ({ params, body, set }) => {
      set.status = 201;
      return created(await adminController.issueKey(params.id, body.label ?? null));
    },
    {
      params: IdParam,
      body: t.Object({ label: t.Optional(t.Nullable(t.String())) }),
      detail: {
        tags: ['Admin / API Keys'],
        summary: 'Issue API key',
        description:
          `Cấp API key mới cho tenant. Response chứa \`apiKey\` dạng plaintext — CHỈ trả về đúng 1 lần này, ` +
          `client phải lưu lại ngay. ${ADMIN_AUTH_DESCRIPTION}`,
        security: [{ bearerAuth: [] }]
      },
      response: {
        201: ApiOk(IssuedApiKeySchema),
        400: ApiErrorSchema,
        404: ApiErrorSchema,
        ...COMMON_ERRORS
      }
    }
  )
  .get('/tenants/:id/keys', async ({ params }) => list(await adminController.listKeys(params.id)), {
    params: IdParam,
    detail: {
      tags: ['Admin / API Keys'],
      summary: 'List API keys',
      description: `Danh sách API key của tenant (ẩn cột \`key\` plaintext). ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiList(PublicApiKeySchema),
      ...COMMON_ERRORS
    }
  })
  .delete(
    '/tenants/:id/keys/:apiKeyId',
    async ({ params }) => ok(await adminController.revokeKey(params.id, params.apiKeyId)),
    {
      params: t.Object({ id: t.Numeric(), apiKeyId: t.Numeric() }),
      detail: {
        tags: ['Admin / API Keys'],
        summary: 'Revoke API key',
        description:
          `Thu hồi key (set isActive=false). Key phải thuộc đúng tenant \`:id\`, ` +
          `không thì trả 404. ${ADMIN_AUTH_DESCRIPTION}`,
        security: [{ bearerAuth: [] }]
      },
      response: {
        200: ApiOk(t.Object({ apiKeyId: t.Number(), revoked: t.Boolean() })),
        404: ApiErrorSchema,
        ...COMMON_ERRORS
      }
    }
  )

  // ── Grants (allow-list) ──────────────────────────────────────────────────────
  .get('/tenants/:id/topics', async ({ params }) => ok(await adminController.getTopicAccess(params.id)), {
    params: IdParam,
    detail: {
      tags: ['Admin / Grants'],
      summary: 'Get topic allow-list',
      description:
        `Allow-list topic hiện tại của tenant. Mảng rỗng nghĩa là chưa cấp topic cụ thể nào — ` +
        `quyền thực tế còn phụ thuộc cờ \`allowAllTopics\` trên tenant. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(TenantTopicAccessSchema),
      404: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .get('/tenants/:id/quiz-types', async ({ params }) => ok(await adminController.getQuizTypeAccess(params.id)), {
    params: IdParam,
    detail: {
      tags: ['Admin / Grants'],
      summary: 'Get quizType allow-list',
      description:
        `Allow-list quizType hiện tại của tenant. Mảng rỗng nghĩa là chưa cấp quizType cụ thể nào — ` +
        `quyền thực tế còn phụ thuộc cờ \`allowAllQuizTypes\` trên tenant. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(TenantQuizTypeAccessSchema),
      404: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .put(
    '/tenants/:id/topics',
    async ({ params, body }) => ok(await adminController.setTopicAccess(params.id, body.topicIds)),
    {
      params: IdParam,
      body: t.Object({ topicIds: t.Array(t.Number()) }),
      detail: {
        tags: ['Admin / Grants'],
        summary: 'Set topic allow-list',
        description:
          `Thay thế toàn bộ allow-list topic của tenant (replace, không merge). ` +
          `topicId không tồn tại trả 400. ${ADMIN_AUTH_DESCRIPTION}`,
        security: [{ bearerAuth: [] }]
      },
      response: {
        200: ApiOk(TenantTopicAccessSchema),
        400: ApiErrorSchema,
        404: ApiErrorSchema,
        ...COMMON_ERRORS
      }
    }
  )
  .put(
    '/tenants/:id/quiz-types',
    async ({ params, body }) => ok(await adminController.setQuizTypeAccess(params.id, body.quizTypes)),
    {
      params: IdParam,
      body: t.Object({ quizTypes: t.Array(t.String()) }),
      detail: {
        tags: ['Admin / Grants'],
        summary: 'Set quizType allow-list',
        description:
          `Thay thế toàn bộ allow-list quizType của tenant (replace, không merge). ` +
          `quizType không hợp lệ trả 400. ${ADMIN_AUTH_DESCRIPTION}`,
        security: [{ bearerAuth: [] }]
      },
      response: {
        200: ApiOk(TenantQuizTypeAccessSchema),
        400: ApiErrorSchema,
        404: ApiErrorSchema,
        ...COMMON_ERRORS
      }
    }
  )

  // ── Pool ─────────────────────────────────────────────────────────────────────
  .post('/pool/refill', async ({ body }) => ok(await adminController.triggerManualPoolRefill(body)), {
    body: t.Object({
      model: t.Optional(t.String({ description: 'OpenRouter model id, mặc định model rẻ nhất (Gemini Flash Lite).' })),
      countPerBucket: t.Optional(
        t.Integer({
          minimum: 1,
          description: 'Số câu ép sinh cho mỗi bucket. Mặc định question_pool.manualFillDefaultCount.'
        })
      ),
      scope: t.Optional(t.Union([t.Literal('all'), t.Literal('deficient')]))
    }),
    detail: {
      tags: ['Admin / Pool'],
      summary: 'Trigger full manual pool refill',
      description:
        'Fill toàn bộ bucket (engLevel × topic × quizType) bất kể pool đã đầy hay chưa (`scope=all`, mặc định — ' +
        'ép đúng `countPerBucket` câu mỗi bucket) hoặc chỉ bucket thiếu (`scope=deficient` — top-up phần còn ' +
        'thiếu tới `question_pool.maxPerBucket`, hoặc đúng `countPerBucket` nếu truyền). Chạy in-process ' +
        '(không qua BullMQ), bounded concurrency theo `question_pool.manualFillConcurrency`. Bỏ qua ' +
        '`job_flags.poolRefillMaxQuestionsPerRun` — đây là hành động admin chủ động, không bị budget tự động ' +
        'giới hạn. Trả ngay `{ runId, totalBuckets }`, theo dõi tiến độ qua GET /english/cron/runs/:runId ' +
        `(admin key cũng gọi được route đó). ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(t.Object({ runId: t.Nullable(t.String()), totalBuckets: t.Number() })),
      400: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  });
