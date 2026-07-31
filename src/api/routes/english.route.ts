import { Elysia, t } from 'elysia';
import { ok, created } from '@/api/common/response';
import { EngLevelSchema, QuizTypeSchema, OptionCountSchema, PoolOptionCountSchema } from '@/api/common/schemas';
import {
  ApiOk,
  ApiErrorSchema,
  ApiErrorZodSchema,
  COMMON_ERRORS,
  EnglishTopicSchema,
  TopicPairSchema,
  PoolQuestionSchema,
  EnglishConfigSnapshotResponseSchema,
  EnglishConfigRecordViewSchema,
  EnglishCronJobRunSchema,
  CronRunDetailSchema,
  GenerateQuestionResponseSchema,
  GenerateReadingResponseSchema
} from '@/api/common/responseSchemas';
import { SCOPES } from '@/api/common/scopes';
import { tenantAuthPlugin } from '@/api/plugins/tenantAuth.plugin';
import englishController from '@/api/controllers/english.controller';

// Mọi route /english/* yêu cầu xác thực tenant qua Bearer API key (tenantAuthPlugin).
// Scope khai báo bằng `{ auth: { scope } }`. Handler chỉ wire schema + gọi controller.
// ADMIN_API_KEY dùng được ở đây như super key: pass mọi scope và bỏ qua allow-list
// topic/quizType — xem ADMIN_TENANT trong tenantAuth.plugin.ts.
export const englishRoute = new Elysia({ prefix: '/english' })
  .use(tenantAuthPlugin)

  // ── Meta ──────────────────────────────────────────────────────────────────
  .get('/quiz-types', () => ok([...englishController.listQuizTypes()]), {
    auth: { scope: SCOPES.QUIZ_READ },
    detail: {
      tags: ['English / Meta'],
      summary: 'List quiz types',
      description: 'Danh sách toàn bộ quizType được hỗ trợ. Yêu cầu scope `quiz:read`.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(t.Array(QuizTypeSchema)),
      403: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })

  // ── Generation on-demand ────────────────────────────────────────────────────
  .post(
    '/generate/:quizType',
    async ({ params, body, tenant }) => ok(await englishController.generate(tenant, params.quizType, body)),
    {
      auth: { scope: SCOPES.QUIZ_READ },
      params: t.Object({ quizType: QuizTypeSchema }),
      body: t.Object({
        engLevel: EngLevelSchema,
        optionCount: OptionCountSchema,
        topic: t.Optional(t.String()),
        model: t.Optional(t.String()),
        excludeWords: t.Optional(t.Array(t.String()))
      }),
      detail: {
        tags: ['English / Generation'],
        summary: 'Generate a question on-demand',
        description:
          'Sinh 1 câu hỏi bằng LLM theo `:quizType`. Shape của `question` trong response phụ thuộc quizType ' +
          '— xem oneOf trong response schema. Yêu cầu scope `quiz:read`; quizType ngoài allow-list của tenant trả 403.',
        security: [{ bearerAuth: [] }]
      },
      response: {
        200: GenerateQuestionResponseSchema,
        400: ApiErrorZodSchema,
        403: ApiErrorZodSchema,
        401: ApiErrorZodSchema,
        500: ApiErrorZodSchema
      }
    }
  )

  // ── Reading (loại đặc biệt, không nằm trong quiz pool distribution) ──────────
  .post('/generate-reading', async ({ body }) => ok(await englishController.generateReading(body)), {
    auth: { scope: SCOPES.QUIZ_READ },
    body: t.Object({
      engLevel: EngLevelSchema,
      optionCount: OptionCountSchema,
      model: t.Optional(t.String())
    }),
    detail: {
      tags: ['English / Generation'],
      summary: 'Generate a reading comprehension question',
      description:
        'Sinh 1 câu hỏi đọc hiểu + mental math bằng LLM. Loại đặc biệt, không nằm trong quiz pool distribution. ' +
        'Yêu cầu scope `quiz:read`.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: GenerateReadingResponseSchema,
      400: ApiErrorZodSchema,
      403: ApiErrorZodSchema,
      401: ApiErrorZodSchema,
      500: ApiErrorZodSchema
    }
  })

  // ── Question pool ───────────────────────────────────────────────────────────
  .get(
    '/pool/pop',
    async ({ query, tenant }) => ok(await englishController.popFromPool(tenant, query.engLevel, query.topicId ?? null)),
    {
      auth: { scope: SCOPES.QUIZ_READ },
      query: t.Object({
        engLevel: EngLevelSchema,
        topicId: t.Optional(t.Numeric())
      }),
      detail: {
        tags: ['English / Question Pool'],
        summary: 'Pop a question from the pre-generated pool',
        description:
          'Lấy 1 câu hỏi random trong bucket (engLevel, topicId) — câu KHÔNG bị xoá, pool là kho dùng lại được. ' +
          'Yêu cầu scope `quiz:read`. topicId ngoài allow-list trả 403. Pool trống trả 404.',
        security: [{ bearerAuth: [] }]
      },
      response: {
        200: ApiOk(PoolQuestionSchema),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        ...COMMON_ERRORS
      }
    }
  )
  .get(
    '/pool/count',
    async ({ query, tenant }) =>
      ok(await englishController.countPool(tenant, query.engLevel, query.quizType, query.topicId ?? null)),
    {
      auth: { scope: SCOPES.QUIZ_READ },
      query: t.Object({
        engLevel: EngLevelSchema,
        quizType: QuizTypeSchema,
        topicId: t.Optional(t.Numeric())
      }),
      detail: {
        tags: ['English / Question Pool'],
        summary: 'Count questions in a pool bucket',
        description: 'Đếm số câu hỏi hiện có trong bucket (engLevel, quizType, topicId). Yêu cầu scope `quiz:read`.',
        security: [{ bearerAuth: [] }]
      },
      response: {
        200: ApiOk(
          t.Object({
            engLevel: EngLevelSchema,
            quizType: QuizTypeSchema,
            topicId: t.Nullable(t.Number()),
            count: t.Number()
          })
        ),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        ...COMMON_ERRORS
      }
    }
  )
  .post('/pool/fill', async ({ body, tenant }) => ok(await englishController.fillPool(tenant, body)), {
    auth: { scope: SCOPES.POOL_FILL },
    body: t.Object({
      engLevel: EngLevelSchema,
      quizType: QuizTypeSchema,
      optionCount: PoolOptionCountSchema,
      topicId: t.Optional(t.Nullable(t.Number())),
      topicName: t.Optional(t.Nullable(t.String()))
    }),
    detail: {
      tags: ['English / Question Pool'],
      summary: 'Trigger pool refill',
      description:
        'Enqueue job sinh thêm câu hỏi cho bucket nếu dưới ngưỡng refill. Bất đồng bộ — response chỉ xác nhận đã ' +
        'enqueue, không đợi job hoàn tất. Yêu cầu scope `pool:fill`.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(t.Object({ enqueued: t.Boolean() })),
      400: ApiErrorSchema,
      403: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .get('/pool/pick-quiz-type', () => ok(englishController.pickPoolQuizType()), {
    auth: { scope: SCOPES.QUIZ_READ },
    detail: {
      tags: ['English / Question Pool'],
      summary: 'Pick a random quiz type by weighted distribution',
      description:
        'Chọn ngẫu nhiên 1 quizType theo trọng số cấu hình trong quiz_distribution (chỉ tính type enabled, weight>0). ' +
        'Yêu cầu scope `quiz:read`.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(t.Object({ quizType: QuizTypeSchema })),
      403: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })

  // ── Config (config:write nên chỉ cấp cho tenant admin/trusted) ───────────────
  .get('/config', () => ok(englishController.getConfigSnapshot()), {
    auth: { scope: SCOPES.CONFIG_READ },
    detail: {
      tags: ['English / Config'],
      summary: 'Get current config snapshot',
      description:
        'Snapshot config runtime hiện tại (question_pool, quiz_distribution, job_flags). Yêu cầu scope `config:read`.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: EnglishConfigSnapshotResponseSchema,
      403: ApiErrorZodSchema,
      401: ApiErrorZodSchema,
      500: ApiErrorZodSchema
    }
  })
  .get('/config/records', async () => ok(await englishController.getConfigRecords()), {
    auth: { scope: SCOPES.CONFIG_READ },
    detail: {
      tags: ['English / Config'],
      summary: 'List config records',
      description:
        'Danh sách đầy đủ config record (kèm validation/uiSchema/value/defaultValue) để build admin UI. ' +
        'Yêu cầu scope `config:read`.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      // Route dùng ok() chứ không phải list() nên response KHÔNG có field total (khác
      // các list endpoint khác) — document theo hành vi thật.
      200: ApiOk(t.Array(EnglishConfigRecordViewSchema)),
      403: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .patch(
    '/config/:recordKey',
    async ({ params, body }) => ok(await englishController.updateConfig(params.recordKey, body.value)),
    {
      auth: { scope: SCOPES.CONFIG_WRITE },
      params: t.Object({ recordKey: t.String() }),
      body: t.Object({
        value: t.Unknown({
          description:
            'Shape phụ thuộc recordType (str/num/boolean/arr/obj) của recordKey — xem GET /english/config/records ' +
            'để biết validation/uiSchema cụ thể cho record này.'
        })
      }),
      detail: {
        tags: ['English / Config'],
        summary: 'Update a config record',
        description:
          'Cập nhật giá trị 1 config record. recordKey không tồn tại throw lỗi nội bộ (500), không phải 404. ' +
          'Yêu cầu scope `config:write`.',
        security: [{ bearerAuth: [] }]
      },
      response: {
        200: ApiOk(EnglishConfigRecordViewSchema),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        ...COMMON_ERRORS
      }
    }
  )
  .post('/config/:recordKey/reset', async ({ params }) => ok(await englishController.resetConfig(params.recordKey)), {
    auth: { scope: SCOPES.CONFIG_WRITE },
    params: t.Object({ recordKey: t.String() }),
    detail: {
      tags: ['English / Config'],
      summary: 'Reset config record to default',
      description: 'Reset 1 config record về giá trị mặc định. Yêu cầu scope `config:write`.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(EnglishConfigRecordViewSchema),
      403: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })

  // ── Topics ──────────────────────────────────────────────────────────────────
  .get('/topics', async () => ok(await englishController.listTopics()), {
    auth: { scope: SCOPES.QUIZ_READ },
    detail: {
      tags: ['English / Topics'],
      summary: 'List active topics',
      description: 'Danh sách toàn bộ topic đang active. Yêu cầu scope `quiz:read`.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(t.Array(EnglishTopicSchema)),
      403: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .get(
    '/topics/random-pairs',
    async ({ query }) => ok(await englishController.randomTopicPairs(query.pairCount ?? 1)),
    {
      auth: { scope: SCOPES.QUIZ_READ },
      query: t.Object({ pairCount: t.Optional(t.Numeric({ minimum: 1 })) }),
      detail: {
        tags: ['English / Topics'],
        summary: 'Get random topic pairs',
        description:
          'Lấy `pairCount` cặp topic ngẫu nhiên (mặc định 1), không lặp topic giữa các cặp. Yêu cầu scope `quiz:read`.',
        security: [{ bearerAuth: [] }]
      },
      response: {
        200: ApiOk(t.Array(TopicPairSchema)),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        ...COMMON_ERRORS
      }
    }
  )
  .post(
    '/topics',
    async ({ body, set }) => {
      set.status = 201;
      return created(await englishController.createTopic(body.name, body.description));
    },
    {
      auth: { scope: SCOPES.TOPIC_WRITE },
      body: t.Object({ name: t.String(), description: t.Optional(t.String()) }),
      detail: {
        tags: ['English / Topics'],
        summary: 'Create topic',
        description: 'Tạo topic mới. `name` unique — trùng tên trả 409. Yêu cầu scope `topic:write`.',
        security: [{ bearerAuth: [] }]
      },
      response: {
        201: ApiOk(EnglishTopicSchema),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        409: ApiErrorSchema,
        ...COMMON_ERRORS
      }
    }
  )

  // ── Cron tracking (admin/observability) ─────────────────────────────────────
  .get('/cron/runs', async ({ query }) => ok(await englishController.listCronRuns(query.limit ?? 8)), {
    auth: { scope: SCOPES.CRON_READ },
    query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1 })) }),
    detail: {
      tags: ['English / Cron Tracking'],
      summary: 'List recent cron job runs',
      description:
        'Danh sách các lần chạy cron gần nhất (question_gen/pool_refill/manual_fill), mặc định 8 run. Trả về ' +
        'FULL row (bao gồm errorStack/metadata) — không phải shape rút gọn. Yêu cầu scope `cron:read`.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(t.Array(EnglishCronJobRunSchema)),
      400: ApiErrorSchema,
      403: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .get('/cron/runs/:runId', async ({ params }) => ok(await englishController.getCronRun(params.runId)), {
    auth: { scope: SCOPES.CRON_READ },
    params: t.Object({ runId: t.String() }),
    detail: {
      tags: ['English / Cron Tracking'],
      summary: 'Get cron run detail',
      description:
        'Chi tiết 1 lần chạy cron kèm bucket + model attempt. runId không tồn tại trả 404. Yêu cầu scope `cron:read`.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(CronRunDetailSchema),
      403: ApiErrorSchema,
      404: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  });
