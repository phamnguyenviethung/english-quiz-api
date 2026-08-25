import { Elysia, t } from 'elysia';
import { ok, created } from '@/api/common/response';
import {
  EngLevelSchema,
  QuizTypeSchema,
  OptionCountSchema,
  PoolOptionCountSchema,
  ReadingPassageTypeSchema
} from '@/api/common/schemas';
import {
  ApiOk,
  ApiErrorSchema,
  ApiErrorZodSchema,
  COMMON_ERRORS,
  EnglishTopicSchema,
  TopicPairSchema,
  PoolQuestionSchema,
  PoolQuestionPageSchema,
  PoolModelStatSchema,
  EnglishConfigSnapshotResponseSchema,
  EnglishConfigRecordViewSchema,
  EnglishCronJobRunSchema,
  CronRunDetailSchema,
  CronUsageAnalyticsItemSchema,
  GenerateQuestionResponseSchema,
  GenerateReadingResponseSchema,
  ReadingWithQuestionsSchema
} from '@/api/common/responseSchemas';
import { tenantAuthPlugin } from '@/api/plugins/tenantAuth.plugin';
import englishController from '@/api/controllers/english.controller';

// Mọi route /english/* yêu cầu xác thực qua tenantAuthPlugin: tenant API key Bearer
// (`eqk_...`) hoặc session admin của Better Auth.
// Tenant key chỉ đọc quiz → `auth: true`. Endpoint quản trị (nạp pool, sửa config,
// tạo topic, xem cron) chỉ chấp nhận tài khoản admin → `auth: { admin: true }`.
// Session admin dùng được ở đây như super key: qua mọi guard admin và bỏ qua
// allow-list topic/quizType — xem ADMIN_TENANT trong tenantAuth.plugin.ts.
export const englishRoute = new Elysia({ prefix: '/english' })
  .use(tenantAuthPlugin)

  // ── Meta ──────────────────────────────────────────────────────────────────
  .get('/quiz-types', () => ok([...englishController.listQuizTypes()]), {
    auth: true,
    detail: {
      tags: ['English / Meta'],
      summary: 'List quiz types',
      description: 'Danh sách toàn bộ quizType được hỗ trợ.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(t.Array(QuizTypeSchema)),
      ...COMMON_ERRORS
    }
  })

  // ── Generation on-demand ────────────────────────────────────────────────────
  .post(
    '/generate/:quizType',
    async ({ params, body, tenant }) => ok(await englishController.generate(tenant, params.quizType, body)),
    {
      auth: true,
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
          '— xem oneOf trong response schema. quizType ngoài allow-list của tenant trả 403.',
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
    auth: true,
    body: t.Object({
      engLevel: EngLevelSchema,
      optionCount: OptionCountSchema,
      model: t.Optional(t.String())
    }),
    detail: {
      tags: ['English / Generation'],
      summary: 'Generate a reading comprehension question',
      description:
        'Sinh 1 câu hỏi đọc hiểu + mental math bằng LLM. Loại đặc biệt, không nằm trong quiz pool distribution.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: GenerateReadingResponseSchema,
      400: ApiErrorZodSchema,
      401: ApiErrorZodSchema,
      500: ApiErrorZodSchema
    }
  })

  // ── Question pool ───────────────────────────────────────────────────────────
  .get(
    '/pool/pop',
    async ({ query, tenant }) =>
      ok(
        await englishController.popFromPool(
          tenant,
          query.engLevel,
          query.topicId ?? null,
          englishController.parseExcludeIds(query.excludeIds)
        )
      ),
    {
      auth: true,
      query: t.Object({
        engLevel: EngLevelSchema,
        topicId: t.Optional(t.Numeric()),
        excludeIds: t.Optional(
          t.String({
            description:
              'CSV id câu hỏi cần loại, vd "12,88,301". Tối đa 200 id (dư bị cắt), phần tử không phải ' +
              'số nguyên dương bị bỏ qua. Dùng để client tự chống lặp câu theo từng end-user.'
          })
        )
      }),
      detail: {
        tags: ['English / Question Pool'],
        summary: 'Pop a question from the pre-generated pool',
        description:
          'Lấy 1 câu hỏi random trong bucket (engLevel, topicId) — câu KHÔNG bị xoá, pool là kho dùng lại được. ' +
          '`excludeIds` loại thêm các câu client đã phục vụ rồi. topicId ngoài allow-list trả 403. ' +
          'Bucket trống (hoặc mọi câu đều bị loại bởi `excludeIds`) trả 404.',
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
      auth: true,
      query: t.Object({
        engLevel: EngLevelSchema,
        quizType: QuizTypeSchema,
        topicId: t.Optional(t.Numeric())
      }),
      detail: {
        tags: ['English / Question Pool'],
        summary: 'Count questions in a pool bucket',
        description: 'Đếm số câu hỏi hiện có trong bucket (engLevel, quizType, topicId).',
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
  .get('/pool/questions', async ({ query, tenant }) => ok(await englishController.listPoolQuestions(tenant, query)), {
    auth: true,
    query: t.Object({
      engLevel: t.Optional(EngLevelSchema),
      quizType: t.Optional(QuizTypeSchema),
      topicId: t.Optional(t.Numeric()),
      withoutTopic: t.Optional(t.BooleanString()),
      model: t.Optional(t.String()),
      optionCount: t.Optional(t.Numeric({ minimum: 1, maximum: 10 })),
      createdFrom: t.Optional(t.String({ format: 'date-time' })),
      createdTo: t.Optional(t.String({ format: 'date-time' })),
      q: t.Optional(t.String({ maxLength: 100 })),
      sort: t.Optional(
        t.Union([
          t.Literal('id_asc'),
          t.Literal('id_desc'),
          t.Literal('created_asc'),
          t.Literal('created_desc'),
          t.Literal('token_asc'),
          t.Literal('token_desc')
        ])
      ),
      page: t.Optional(t.Numeric({ minimum: 1 })),
      pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100 }))
    }),
    detail: {
      tags: ['English / Question Pool'],
      summary: 'List pool questions',
      description:
        'Danh sách câu hỏi trong pool, có filter + phân trang (mặc định pageSize 20, tối đa 100, sort id_asc). ' +
        'Mọi filter đều optional — không truyền gì là lấy toàn bộ pool. `withoutTopic=true` lọc riêng bucket ' +
        'không có topic (topicId IS NULL) và thắng `topicId` nếu truyền cả hai. `q` tìm ILIKE trên nội dung câu ' +
        'hỏi + tên model; nếu `q` toàn số thì thêm điều kiện khớp chính xác `id`. `createdFrom`/`createdTo` là ' +
        'ISO date-time, lọc theo `createdAt` — câu cũ không có `createdAt` sẽ bị loại khi dùng filter này. ' +
        '`sort` theo `token_*` sắp xếp trên tổng `tokenIn + tokenOut`. topicId/quizType ngoài allow-list của ' +
        'tenant trả 403.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(PoolQuestionPageSchema),
      400: ApiErrorSchema,
      403: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .get('/pool/models', async () => ok(await englishController.listPoolModels()), {
    auth: true,
    detail: {
      tags: ['English / Question Pool'],
      summary: 'List distinct models in pool',
      description:
        'Danh sách model đang có câu hỏi trong pool kèm số lượng câu, sắp xếp giảm dần theo số lượng. ' +
        'Dùng để đổ dropdown filter model ở admin UI.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(t.Array(PoolModelStatSchema)),
      ...COMMON_ERRORS
    }
  })
  .post('/pool/fill', async ({ body, tenant }) => ok(await englishController.fillPool(tenant, body)), {
    auth: { admin: true },
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
        'enqueue, không đợi job hoàn tất. Chỉ dùng được với tài khoản admin.',
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
    auth: true,
    detail: {
      tags: ['English / Question Pool'],
      summary: 'Pick a random quiz type by weighted distribution',
      description:
        'Chọn ngẫu nhiên 1 quizType theo trọng số cấu hình trong quiz_distribution (chỉ tính type enabled, weight>0).',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(t.Object({ quizType: QuizTypeSchema })),
      ...COMMON_ERRORS
    }
  })

  // ── Config (chỉ dùng được với tài khoản admin) ──────────────────────────────────
  .get('/config', () => ok(englishController.getConfigSnapshot()), {
    auth: { admin: true },
    detail: {
      tags: ['English / Config'],
      summary: 'Get current config snapshot',
      description:
        'Snapshot config runtime hiện tại (question_pool, quiz_distribution, job_flags). Chỉ dùng được với tài khoản admin.',
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
    auth: { admin: true },
    detail: {
      tags: ['English / Config'],
      summary: 'List config records',
      description:
        'Danh sách đầy đủ config record (kèm validation/uiSchema/value/defaultValue) để build admin UI. ' +
        'Chỉ dùng được với tài khoản admin.',
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
  // Phải khai TRƯỚC '/config/:recordKey', nếu không '/records' sẽ bị match làm recordKey.
  .patch('/config/records', async ({ body }) => ok(await englishController.updateConfigBulk(body.changes)), {
    auth: { admin: true },
    body: t.Object({
      changes: t.Array(
        t.Object({
          recordKey: t.String(),
          value: t.Unknown({ description: 'Shape phụ thuộc recordType của recordKey tương ứng.' })
        }),
        { minItems: 1, description: 'Danh sách thay đổi, không được trùng recordKey.' }
      )
    }),
    detail: {
      tags: ['English / Config'],
      summary: 'Update multiple config records',
      description:
        'Cập nhật nhiều config record trong 1 transaction: áp hết thay đổi rồi mới validate snapshot một lần. ' +
        'Dùng khi sửa các field ràng buộc lẫn nhau (vd manualFillMinCount + manualFillDefaultCount) — ' +
        'gọi PATCH lần lượt sẽ fail ở request đầu. Sai 1 record thì rollback toàn bộ. ' +
        'Chỉ dùng được với tài khoản admin.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(t.Array(EnglishConfigRecordViewSchema)),
      400: ApiErrorSchema,
      403: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .patch(
    '/config/:recordKey',
    async ({ params, body }) => ok(await englishController.updateConfig(params.recordKey, body.value)),
    {
      auth: { admin: true },
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
          'Chỉ dùng được với tài khoản admin.',
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
    auth: { admin: true },
    params: t.Object({ recordKey: t.String() }),
    detail: {
      tags: ['English / Config'],
      summary: 'Reset config record to default',
      description: 'Reset 1 config record về giá trị mặc định. Chỉ dùng được với tài khoản admin.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(EnglishConfigRecordViewSchema),
      403: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })

  // ── Readings (bài đọc kèm câu hỏi) ──────────────────────────────────────────
  .get(
    '/readings/pop',
    async ({ query, tenant }) =>
      ok(
        await englishController.popReading(tenant, {
          cefrLevel: query.cefrLevel,
          topicId: query.topicId,
          type: query.type,
          excludeIds: englishController.parseExcludeIds(query.excludeIds)
        })
      ),
    {
      auth: true,
      query: t.Object({
        cefrLevel: t.Optional(EngLevelSchema),
        topicId: t.Optional(t.Numeric()),
        type: t.Optional(ReadingPassageTypeSchema),
        excludeIds: t.Optional(
          t.String({
            description:
              'CSV id BÀI ĐỌC cần loại, vd "12,88". Tối đa 200 id. Dùng để client tự chống lặp bài theo end-user.'
          })
        )
      }),
      detail: {
        tags: ['English / Readings'],
        summary: 'Pop a reading passage with its questions',
        description:
          'Lấy 1 bài đọc random kèm trọn bộ câu hỏi đọc hiểu. Chỉ trả bài đã **đủ** ' +
          '`reading_question.questionsPerPassage` câu đang active — bài nửa vời không bao giờ được phục vụ. ' +
          'Bài KHÔNG bị xoá, kho dùng lại được. Bỏ trống `topicId` = mọi topic tenant được cấp (bài đọc luôn ' +
          'gắn topic nên tenant bị giới hạn sẽ chỉ thấy topic trong allow-list). `topicId` ngoài allow-list ' +
          'trả 403. Bỏ trống `type` = "daily" (không đổi hành vi với client cũ). `type` là hard filter xuyên ' +
          'suốt fallback (topicId → cefrLevel → excludeIds) — không bao giờ trả nhầm content style. ' +
          'Không có bài nào sẵn sàng trả 404.',
        security: [{ bearerAuth: [] }]
      },
      response: {
        200: ApiOk(ReadingWithQuestionsSchema),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        ...COMMON_ERRORS
      }
    }
  )
  .get(
    '/readings/count',
    async ({ query, tenant }) =>
      ok(
        await englishController.countReadings(tenant, {
          cefrLevel: query.cefrLevel,
          topicId: query.topicId,
          type: query.type
        })
      ),
    {
      auth: true,
      query: t.Object({
        cefrLevel: t.Optional(EngLevelSchema),
        topicId: t.Optional(t.Numeric()),
        type: t.Optional(ReadingPassageTypeSchema)
      }),
      detail: {
        tags: ['English / Readings'],
        summary: 'Count ready reading passages',
        description:
          'Số bài đọc đã sẵn sàng phục vụ (active và đủ câu hỏi) trong phạm vi filter. Áp dụng cùng allow-list ' +
          'topic như /readings/pop. Bỏ trống `type` = "daily".',
        security: [{ bearerAuth: [] }]
      },
      response: {
        200: ApiOk(
          t.Object({
            cefrLevel: t.Nullable(t.String()),
            topicId: t.Nullable(t.Number()),
            type: t.String(),
            count: t.Number()
          })
        ),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        ...COMMON_ERRORS
      }
    }
  )

  // ── Topics ──────────────────────────────────────────────────────────────────
  .get('/topics', async () => ok(await englishController.listTopics()), {
    auth: true,
    detail: {
      tags: ['English / Topics'],
      summary: 'List active topics',
      description: 'Danh sách toàn bộ topic đang active.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(t.Array(EnglishTopicSchema)),
      ...COMMON_ERRORS
    }
  })
  .get(
    '/topics/random-pairs',
    async ({ query }) => ok(await englishController.randomTopicPairs(query.pairCount ?? 1)),
    {
      auth: true,
      query: t.Object({ pairCount: t.Optional(t.Numeric({ minimum: 1 })) }),
      detail: {
        tags: ['English / Topics'],
        summary: 'Get random topic pairs',
        description: 'Lấy `pairCount` cặp topic ngẫu nhiên (mặc định 1), không lặp topic giữa các cặp.',
        security: [{ bearerAuth: [] }]
      },
      response: {
        200: ApiOk(t.Array(TopicPairSchema)),
        400: ApiErrorSchema,
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
      auth: { admin: true },
      body: t.Object({ name: t.String(), description: t.Optional(t.String()) }),
      detail: {
        tags: ['English / Topics'],
        summary: 'Create topic',
        description: 'Tạo topic mới. `name` unique — trùng tên trả 409. Chỉ dùng được với tài khoản admin.',
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
    auth: { admin: true },
    query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1 })) }),
    detail: {
      tags: ['English / Cron Tracking'],
      summary: 'List recent cron job runs',
      description:
        'Danh sách các lần chạy cron gần nhất (question_gen/pool_refill/manual_fill), mặc định 8 run. Trả về ' +
        'FULL row (bao gồm errorStack/metadata) — không phải shape rút gọn. Chỉ dùng được với tài khoản admin.',
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
    auth: { admin: true },
    params: t.Object({ runId: t.String() }),
    detail: {
      tags: ['English / Cron Tracking'],
      summary: 'Get cron run detail',
      description:
        'Chi tiết 1 lần chạy cron kèm bucket + model attempt. runId không tồn tại trả 404. Chỉ dùng được với tài khoản admin.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(CronRunDetailSchema),
      403: ApiErrorSchema,
      404: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .get('/cron/usage', async ({ query }) => ok(await englishController.getCronUsage(query)), {
    auth: { admin: true },
    query: t.Object({
      from: t.Optional(t.String({ description: 'ISO 8601. Mặc định 30 ngày trước `to`.' })),
      to: t.Optional(t.String({ description: 'ISO 8601. Mặc định thời điểm hiện tại.' })),
      groupBy: t.Optional(t.Union([t.Literal('day'), t.Literal('model')], { description: 'Mặc định "day".' }))
    }),
    detail: {
      tags: ['English / Cron Tracking'],
      summary: 'Get AI usage & cost analytics',
      description:
        'Tổng hợp token + chi phí USD từ các lần gọi AI (english_cron_job_model_attempts), gộp theo ngày ' +
        '(`groupBy=day`, mặc định) hoặc theo model (`groupBy=model`). `costUsd` chỉ cộng các lần gọi bằng model ' +
        'đã có giá cache — model chưa sync giá đóng góp 0. Chỉ dùng được với tài khoản admin.',
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(t.Array(CronUsageAnalyticsItemSchema)),
      400: ApiErrorSchema,
      403: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  });
