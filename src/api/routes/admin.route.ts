import { Elysia, t } from 'elysia';
import { ok, created, list } from '@/api/common/response';
import { EngLevelSchema, IdParam, ProviderPreferencesSchema, QuizTypeSchema } from '@/api/common/schemas';
import {
  ApiOk,
  ApiList,
  ApiErrorSchema,
  COMMON_ERRORS,
  TenantSchema,
  AiModelSchema,
  CatalogModelSchema,
  ModelPricingSyncResultSchema,
  PoolBucketPreviewSchema,
  PublicApiKeySchema,
  IssuedApiKeySchema,
  TenantTopicAccessSchema,
  TenantQuizTypeAccessSchema,
  ReadingPassageSchema,
  ReadingPassagePageSchema,
  ReadingPassageModelStatSchema,
  ReadingBucketPreviewSchema,
  GeneratedReadingPassageSchema,
  ReadingQuestionRecordSchema,
  ReadingQuestionPageSchema,
  ReadingQuestionModelStatSchema,
  ReadingQuestionBucketPreviewSchema,
  GeneratedReadingQuestionsSchema
} from '@/api/common/responseSchemas';
import { adminAuthPlugin } from '@/api/plugins/adminAuth.plugin';
import adminController from '@/api/controllers/admin.controller';

const ADMIN_AUTH_DESCRIPTION =
  'Yêu cầu tài khoản `role = "admin"` qua `Authorization: Bearer <session token>` (hoặc cookie phiên đăng nhập).';

// Toàn bộ /admin/* yêu cầu session admin của Better Auth (adminAuthPlugin). Dùng để
// tạo tenant, cấp/thu hồi API key, và gán allow-list topic/quizType. Handler chỉ wire
// schema + gọi controller.
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
      allowAllTopics: t.Optional(t.Boolean()),
      allowAllQuizTypes: t.Optional(t.Boolean()),
      isActive: t.Optional(t.Boolean())
    }),
    detail: {
      tags: ['Admin / Tenants'],
      summary: 'Update tenant',
      description:
        `Partial update (name/description/allowAll*/isActive). Soft-deactivate bằng { isActive: false } ` +
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

  // ── AI Models ────────────────────────────────────────────────────────────────
  .get('/models', async () => list(await adminController.listModels()), {
    detail: {
      tags: ['Admin / Models'],
      summary: 'List AI models',
      description: `Danh sách toàn bộ AI model (dùng bởi aiClient.getStudyModels khi chọn model sinh câu hỏi). ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiList(AiModelSchema),
      ...COMMON_ERRORS
    }
  })
  // Khai báo trước '/models/:id' để segment tĩnh không bị route param nuốt mất.
  .get('/models/catalog', async ({ query }) => list(await adminController.listModelCatalog(query.search)), {
    query: t.Object({
      search: t.Optional(
        t.String({ description: 'Lọc substring theo model id hoặc tên (không phân biệt hoa thường).' })
      )
    }),
    detail: {
      tags: ['Admin / Models'],
      summary: 'Browse OpenRouter model catalog',
      description:
        'Danh sách model công khai trên OpenRouter kèm giá thực tế (USD/token) — dùng để chọn trước khi thêm vào ' +
        `\`ai_models\`. Kết quả cache 5 phút trong process. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiList(CatalogModelSchema),
      ...COMMON_ERRORS
    }
  })
  .get('/models/:id', async ({ params }) => ok(await adminController.getModel(params.id)), {
    params: IdParam,
    detail: {
      tags: ['Admin / Models'],
      summary: 'Get AI model by id',
      description: `Chi tiết 1 AI model. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(AiModelSchema),
      404: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .post(
    '/models',
    async ({ body, set }) => {
      set.status = 201;
      return created(await adminController.createModel(body));
    },
    {
      body: t.Object({
        key: t.String({ minLength: 1, description: 'Nhãn ngắn gọn, unique. VD: GEMINI_FLASH_LITE' }),
        modelId: t.String({
          minLength: 1,
          description: 'OpenRouter model id, unique. VD: google/gemini-2.5-flash-lite:nitro'
        }),
        isActive: t.Optional(t.Boolean({ description: 'Mặc định true.' })),
        scheduleEnabled: t.Optional(
          t.Boolean({ description: 'Cho phép chọn model này ở đường tự động (cron + on-demand). Mặc định true.' })
        ),
        manualEnabled: t.Optional(
          t.Boolean({ description: 'Cho phép chọn model này khi admin trigger refill. Mặc định true.' })
        ),
        readingEnabled: t.Optional(
          t.Boolean({ description: 'Cho phép chọn model này khi sinh reading passage. Mặc định true.' })
        ),
        scheduleProvider: t.Optional(t.Nullable(ProviderPreferencesSchema)),
        manualProvider: t.Optional(t.Nullable(ProviderPreferencesSchema)),
        readingProvider: t.Optional(
          t.Nullable(ProviderPreferencesSchema, {
            description:
              'Provider routing cho context reading. Lưu normalize ở bảng riêng nhưng request/response ' +
              'dùng cùng shape với 2 provider kia. Gửi `null` để xoá cấu hình.'
          })
        )
      }),
      detail: {
        tags: ['Admin / Models'],
        summary: 'Create AI model',
        description:
          `Tạo AI model mới. \`key\` và \`modelId\` đều phải unique — trùng trả 409. Giá được tự động nạp từ ` +
          `OpenRouter catalog nếu \`modelId\` có trên đó (không có thì vẫn tạo, chỉ là chưa tính được cost). ` +
          `${ADMIN_AUTH_DESCRIPTION}`,
        security: [{ bearerAuth: [] }]
      },
      response: {
        201: ApiOk(AiModelSchema),
        400: ApiErrorSchema,
        409: ApiErrorSchema,
        ...COMMON_ERRORS
      }
    }
  )
  // deactivate được gộp vào PATCH: gửi { isActive: false }. Không có endpoint delete riêng.
  .patch('/models/:id', async ({ params, body }) => ok(await adminController.updateModel(params.id, body)), {
    params: IdParam,
    body: t.Object({
      key: t.Optional(t.String({ minLength: 1 })),
      modelId: t.Optional(t.String({ minLength: 1 })),
      isActive: t.Optional(t.Boolean()),
      scheduleEnabled: t.Optional(t.Boolean()),
      manualEnabled: t.Optional(t.Boolean()),
      readingEnabled: t.Optional(t.Boolean()),
      scheduleProvider: t.Optional(t.Nullable(ProviderPreferencesSchema)),
      manualProvider: t.Optional(t.Nullable(ProviderPreferencesSchema)),
      readingProvider: t.Optional(
        t.Nullable(ProviderPreferencesSchema, {
          description: 'Replace toàn bộ (không merge). Gửi `null` để xoá cấu hình reading provider của model.'
        })
      )
    }),
    detail: {
      tags: ['Admin / Models'],
      summary: 'Update AI model',
      description:
        `Partial update (key/modelId/isActive/scheduleEnabled/manualEnabled/*Provider). Soft-deactivate bằng ` +
        `{ isActive: false } — không có endpoint delete riêng. Đổi \`modelId\` sẽ nạp lại giá từ catalog. ` +
        `Đổi \`key\`/\`modelId\` trùng model khác trả 409. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(AiModelSchema),
      400: ApiErrorSchema,
      404: ApiErrorSchema,
      409: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .post('/models/sync-all', async () => ok(await adminController.syncAllModelsPricing()), {
    detail: {
      tags: ['Admin / Models'],
      summary: 'Sync pricing for all models',
      description:
        'Nạp lại giá + metadata từ OpenRouter catalog cho toàn bộ model trong `ai_models`. Model không có trên ' +
        `catalog được liệt kê ở \`notFound\` và giữ nguyên giá cũ. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(ModelPricingSyncResultSchema),
      ...COMMON_ERRORS
    }
  })
  .post('/models/:id/sync', async ({ params }) => ok(await adminController.syncModelPricing(params.id)), {
    params: IdParam,
    detail: {
      tags: ['Admin / Models'],
      summary: 'Sync pricing for one model',
      description:
        `Nạp lại giá + metadata từ OpenRouter catalog cho 1 model. Model không tồn tại hoặc không có trên ` +
        `catalog trả 404. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(AiModelSchema),
      404: ApiErrorSchema,
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
  .get('/pool/buckets', async ({ query }) => ok(await adminController.listPoolBuckets(query)), {
    query: t.Object({
      engLevels: t.Optional(t.String({ description: 'CSV, vd `A1,B2`. Bỏ trống = mọi trình độ.' })),
      topicIds: t.Optional(t.String({ description: 'CSV topic id, vd `3,7,12`. Bỏ trống = mọi topic đang bật.' })),
      quizTypes: t.Optional(t.String({ description: 'CSV quizType, vd `vocab,idiom`. Bỏ trống = mọi loại đang bật.' })),
      scope: t.Optional(t.Union([t.Literal('all'), t.Literal('deficient')])),
      countPerBucket: t.Optional(t.Numeric({ minimum: 1 }))
    }),
    detail: {
      tags: ['Admin / Pool'],
      summary: 'Preview buckets for manual refill',
      description:
        'Liệt kê bucket khớp filter kèm số câu đang có và số câu sẽ sinh, để admin xem trước chi phí ' +
        'trước khi gọi POST /admin/pool/refill. Nhận đúng bộ tham số `scope`/`countPerBucket`/filter như ' +
        'endpoint refill và chạy chung một hàm plan, nên `summary.plannedBuckets` bằng đúng `totalBuckets` ' +
        'mà refill sẽ trả về với cùng tham số. Bucket có `plannedCount = 0` là bucket đã đủ câu và sẽ bị ' +
        `bỏ qua ở scope hiện tại. Chỉ đọc, không sinh câu, không tốn chi phí LLM. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(PoolBucketPreviewSchema),
      400: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })

  .post('/pool/refill', async ({ body }) => ok(await adminController.triggerManualPoolRefill(body)), {
    body: t.Object({
      models: t.Optional(
        t.Array(t.String(), {
          description:
            'Danh sách OpenRouter model id. Mỗi bucket chọn ngẫu nhiên 1 model trong danh sách này. ' +
            'Bỏ trống → chọn ngẫu nhiên trong mọi model đang bật `manualEnabled`. Model không tồn tại ' +
            'hoặc đang tắt (`isActive=false` / `manualEnabled=false`) trả 400. Provider routing luôn ' +
            'lấy theo `manualProvider` của model được dùng.'
        })
      ),
      model: t.Optional(t.String({ description: 'DEPRECATED: dùng `models`. Tương đương `models: [model]`.' })),
      countPerBucket: t.Optional(
        t.Integer({
          minimum: 1,
          description: 'Số câu ép sinh cho mỗi bucket. Mặc định question_pool.manualFillDefaultCount.'
        })
      ),
      scope: t.Optional(t.Union([t.Literal('all'), t.Literal('deficient')])),
      filter: t.Optional(
        t.Object(
          {
            engLevels: t.Optional(t.Array(EngLevelSchema)),
            topicIds: t.Optional(t.Array(t.Integer())),
            quizTypes: t.Optional(t.Array(QuizTypeSchema))
          },
          { description: 'Thu hẹp không gian bucket. Chiều nào bỏ trống thì không lọc theo chiều đó.' }
        )
      ),
      bucketKeys: t.Optional(
        t.Array(t.String(), {
          description:
            'Chốt đúng danh sách bucketKey (lấy từ GET /admin/pool/buckets), áp dụng sau `filter`. ' +
            'Dùng khi admin bỏ tick một vài bucket trong preview.'
        })
      )
    }),
    detail: {
      tags: ['Admin / Pool'],
      summary: 'Trigger manual pool refill',
      description:
        'Fill bucket (engLevel × topic × quizType) bất kể pool đã đầy hay chưa (`scope=all`, mặc định — ' +
        'ép đúng `countPerBucket` câu mỗi bucket) hoặc chỉ bucket thiếu (`scope=deficient` — top-up phần còn ' +
        'thiếu tới `question_pool.maxPerBucket`, hoặc đúng `countPerBucket` nếu truyền). Không truyền ' +
        '`filter`/`bucketKeys` → chạy toàn bộ bucket như trước. Chạy in-process (không qua BullMQ), bounded ' +
        'concurrency theo `question_pool.manualFillConcurrency`. Bỏ qua `job_flags.poolRefillMaxQuestionsPerRun` ' +
        '— đây là hành động admin chủ động, không bị budget tự động giới hạn. Trả ngay `{ runId, totalBuckets }` ' +
        '(`totalBuckets` = số bucket thực sự được xếp lịch), theo dõi tiến độ qua GET /english/cron/runs/:runId ' +
        `(admin key cũng gọi được route đó). ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(t.Object({ runId: t.Nullable(t.String()), totalBuckets: t.Number() })),
      400: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })

  // ── Reading passages ─────────────────────────────────────────────────────────
  // Bài đọc thuần sinh từ (topicName, cefrLevel). KHÁC `quizType = 'reading'` ở
  // question pool (quiz đọc hiểu + mental math) — 2 feature độc lập.
  .get('/readings', async ({ query }) => ok(await adminController.listReadings(query)), {
    query: t.Object({
      cefrLevel: t.Optional(EngLevelSchema),
      topicId: t.Optional(t.Numeric()),
      withoutTopic: t.Optional(t.BooleanString()),
      model: t.Optional(t.String()),
      isActive: t.Optional(t.BooleanString()),
      createdFrom: t.Optional(t.String({ format: 'date-time' })),
      createdTo: t.Optional(t.String({ format: 'date-time' })),
      q: t.Optional(t.String({ maxLength: 100 })),
      sort: t.Optional(
        t.Union([
          t.Literal('id_asc'),
          t.Literal('id_desc'),
          t.Literal('created_asc'),
          t.Literal('created_desc'),
          t.Literal('words_asc'),
          t.Literal('words_desc')
        ])
      ),
      page: t.Optional(t.Numeric({ minimum: 1 })),
      pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100 }))
    }),
    detail: {
      tags: ['Admin / Readings'],
      summary: 'List reading passages',
      description:
        'Danh sách bài đọc trong kho, có filter + phân trang (mặc định pageSize 20, tối đa 100, sort id_desc). ' +
        'Mọi filter đều optional. `withoutTopic=true` lọc riêng bucket không topic và thắng `topicId` nếu truyền ' +
        'cả hai. `q` tìm ILIKE trên title, nội dung các đoạn và tên model; `q` toàn số thì thêm điều kiện khớp ' +
        `chính xác \`id\`. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(ReadingPassagePageSchema),
      400: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  // Segment tĩnh phải khai trước '/readings/:id', nếu không sẽ bị route param nuốt mất.
  .get('/readings/models', async () => list(await adminController.listReadingModels()), {
    detail: {
      tags: ['Admin / Readings'],
      summary: 'List distinct models in reading store',
      description: `Model đang có bài đọc trong kho kèm số lượng, sắp giảm dần. Dùng đổ dropdown filter ở admin UI. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiList(ReadingPassageModelStatSchema),
      ...COMMON_ERRORS
    }
  })
  .get('/readings/buckets', async ({ query }) => ok(await adminController.listReadingBuckets(query)), {
    query: t.Object({
      cefrLevels: t.Optional(t.String({ description: 'CSV, vd `A1,B2`. Bỏ trống = mọi trình độ.' })),
      topicIds: t.Optional(t.String({ description: 'CSV topic id, vd `3,7,12`. Bỏ trống = mọi topic đang bật.' })),
      scope: t.Optional(t.Union([t.Literal('all'), t.Literal('deficient')])),
      countPerBucket: t.Optional(t.Numeric({ minimum: 1 }))
    }),
    detail: {
      tags: ['Admin / Readings'],
      summary: 'Preview buckets for reading generation',
      description:
        'Liệt kê bucket (cefrLevel × topic) khớp filter kèm số bài đang có và số bài sẽ sinh, để admin xem trước ' +
        'chi phí trước khi gọi POST /admin/readings/refill. Nhận đúng bộ tham số `scope`/`countPerBucket`/filter ' +
        'như endpoint refill và chạy chung một hàm plan, nên `summary.plannedBuckets` bằng đúng `totalBuckets` mà ' +
        'refill sẽ trả về với cùng tham số. Bucket có `plannedCount = 0` là bucket đã đủ bài và sẽ bị bỏ qua ở ' +
        `scope hiện tại. Chỉ đọc, không sinh bài, không tốn chi phí LLM. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(ReadingBucketPreviewSchema),
      400: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .post('/readings/generate', async ({ body }) => ok(await adminController.generateReadingPassage(body)), {
    body: t.Object({
      topicName: t.String({ minLength: 1, description: 'Chủ đề bài đọc, đưa thẳng vào TOPIC LOCK của prompt.' }),
      cefrLevel: EngLevelSchema,
      model: t.Optional(
        t.String({ description: 'OpenRouter model id. Bỏ trống → random trong pool `readingEnabled`.' })
      )
    }),
    detail: {
      tags: ['Admin / Readings'],
      summary: 'Generate a reading passage (preview only)',
      description:
        'Sinh thử 1 bài đọc để kiểm tra prompt/model. **KHÔNG lưu vào kho** — dùng POST /admin/readings/refill nếu ' +
        'muốn sinh và lưu. Độ dài bám theo band CEFR trong reading-prompt-guideline.md; model trả bài không hợp lệ ' +
        `(sai độ dài, thiếu đoạn) trả 400. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(GeneratedReadingPassageSchema),
      400: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .post('/readings/refill', async ({ body }) => ok(await adminController.triggerReadingRefill(body)), {
    body: t.Object({
      models: t.Optional(
        t.Array(t.String(), {
          description:
            'Danh sách OpenRouter model id. Mỗi bucket chọn ngẫu nhiên 1 model trong danh sách này. ' +
            'Bỏ trống → chọn ngẫu nhiên trong mọi model đang bật `readingEnabled`. Model không tồn tại hoặc ' +
            'đang tắt trả 400. Provider routing lấy theo cấu hình reading của model được dùng.'
        })
      ),
      countPerBucket: t.Optional(
        t.Integer({
          minimum: 1,
          description: 'Số bài ép sinh cho mỗi bucket. Mặc định reading_passage.manualFillDefaultCount.'
        })
      ),
      scope: t.Optional(t.Union([t.Literal('all'), t.Literal('deficient')])),
      filter: t.Optional(
        t.Object(
          {
            cefrLevels: t.Optional(t.Array(EngLevelSchema)),
            topicIds: t.Optional(t.Array(t.Integer()))
          },
          { description: 'Thu hẹp không gian bucket. Chiều nào bỏ trống thì không lọc theo chiều đó.' }
        )
      ),
      bucketKeys: t.Optional(
        t.Array(t.String(), {
          description:
            'Chốt đúng danh sách bucketKey (lấy từ GET /admin/readings/buckets), áp dụng sau `filter`. ' +
            'Dùng khi admin bỏ tick một vài bucket trong preview.'
        })
      )
    }),
    detail: {
      tags: ['Admin / Readings'],
      summary: 'Trigger reading generation',
      description:
        'Sinh reading cho bucket (cefrLevel × topic) bất kể kho đã đủ hay chưa (`scope=all`, mặc định — ép đúng ' +
        '`countPerBucket` bài mỗi bucket) hoặc chỉ bucket thiếu (`scope=deficient` — top-up tới ' +
        '`reading_passage.maxPerBucket`). Chạy in-process (không qua BullMQ), bounded concurrency theo ' +
        '`reading_passage.manualFillConcurrency`. Bỏ qua `job_flags.readingRefillMaxPerRun` — đây là hành động ' +
        'admin chủ động. Trả ngay `{ runId, totalBuckets }`, theo dõi tiến độ qua GET /english/cron/runs/:runId. ' +
        `${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(t.Object({ runId: t.Nullable(t.String()), totalBuckets: t.Number() })),
      400: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .get('/readings/:id', async ({ params }) => ok(await adminController.getReading(params.id)), {
    params: IdParam,
    detail: {
      tags: ['Admin / Readings'],
      summary: 'Get reading passage by id',
      description: `Chi tiết 1 bài đọc kèm toàn bộ đoạn văn. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(ReadingPassageSchema),
      404: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .patch('/readings/:id', async ({ params, body }) => ok(await adminController.updateReading(params.id, body)), {
    params: IdParam,
    body: t.Object({
      title: t.Optional(t.String({ minLength: 1 })),
      paragraphs: t.Optional(
        t.Array(t.String(), { description: 'Replace toàn bộ danh sách đoạn. Tối thiểu 2 đoạn không rỗng.' })
      ),
      isActive: t.Optional(t.Boolean({ description: 'false = tắt bài, không tính vào bucket count nữa.' }))
    }),
    detail: {
      tags: ['Admin / Readings'],
      summary: 'Update reading passage',
      description:
        `Partial update (title/paragraphs/isActive). Sửa \`paragraphs\` sẽ tự tính lại \`wordCount\` — ` +
        `2 giá trị này không bao giờ lệch nhau. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(ReadingPassageSchema),
      400: ApiErrorSchema,
      404: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .delete('/readings/:id', async ({ params }) => ok(await adminController.deleteReading(params.id)), {
    params: IdParam,
    detail: {
      tags: ['Admin / Readings'],
      summary: 'Delete reading passage',
      description:
        `Xoá hẳn bài đọc khỏi kho. Muốn giữ lại để tra cứu thì dùng PATCH với { isActive: false } thay vì xoá. ` +
        `${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(t.Object({ id: t.Number(), deleted: t.Boolean() })),
      404: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })

  // ── Reading questions ───────────────────────────────────────────────────────
  .get('/reading-questions', async ({ query }) => ok(await adminController.listReadingQuestions(query)), {
    query: t.Object({
      passageId: t.Optional(t.Numeric({ description: 'Chỉ lấy câu hỏi của 1 bài đọc.' })),
      cefrLevel: t.Optional(EngLevelSchema),
      topicId: t.Optional(t.Numeric()),
      withoutTopic: t.Optional(t.BooleanString({ description: 'true = chỉ câu không gắn topic. Thắng `topicId`.' })),
      quizType: t.Optional(t.String({ description: 'detail / inference / vocabulary_context / ...' })),
      model: t.Optional(t.String()),
      isActive: t.Optional(t.BooleanString()),
      createdFrom: t.Optional(t.String({ format: 'date-time' })),
      createdTo: t.Optional(t.String({ format: 'date-time' })),
      q: t.Optional(t.String({ maxLength: 100, description: 'ILIKE trên question, options, explanation, model.' })),
      sort: t.Optional(
        t.Union([
          t.Literal('id_asc'),
          t.Literal('id_desc'),
          t.Literal('created_asc'),
          t.Literal('created_desc'),
          t.Literal('passage_asc'),
          t.Literal('passage_desc')
        ])
      ),
      page: t.Optional(t.Numeric({ minimum: 1 })),
      pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100 }))
    }),
    detail: {
      tags: ['Admin / Reading Questions'],
      summary: 'List reading questions',
      description: `Kho câu hỏi đọc hiểu sinh từ reading passage, có filter + phân trang. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(ReadingQuestionPageSchema),
      400: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  // Segment tĩnh phải khai trước '/reading-questions/:id'.
  .get('/reading-questions/models', async () => list(await adminController.listReadingQuestionModels()), {
    detail: {
      tags: ['Admin / Reading Questions'],
      summary: 'List distinct models in reading question store',
      description: `Model đang có câu hỏi trong kho kèm số lượng. Dùng đổ dropdown filter. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiList(ReadingQuestionModelStatSchema),
      ...COMMON_ERRORS
    }
  })
  .get('/reading-questions/buckets', async ({ query }) => ok(await adminController.listReadingQuestionBuckets(query)), {
    query: t.Object({
      cefrLevels: t.Optional(t.String({ description: 'CSV, vd `A1,B2`.' })),
      topicIds: t.Optional(t.String({ description: 'CSV topic id, vd `3,7,12`.' })),
      passageIds: t.Optional(t.String({ description: 'CSV passage id — chốt đúng vài bài cụ thể.' })),
      scope: t.Optional(t.Union([t.Literal('all'), t.Literal('deficient')]))
    }),
    detail: {
      tags: ['Admin / Reading Questions'],
      summary: 'Preview passages needing questions',
      description:
        'Liệt kê bài đọc khớp filter kèm số câu đang có và số câu sẽ sinh. **Bucket ở pipeline này là MỘT BÀI ĐỌC** ' +
        '(`bucketKey = rq:{passageId}`), khác bucket (cefrLevel × topic) của /admin/readings/buckets. Chạy chung ' +
        'hàm plan với endpoint refill nên `summary.plannedPassages` bằng đúng `totalBuckets` mà refill trả về. ' +
        'Bài đã đủ câu có `plannedCount = 0`. Bài vượt `reading_question.maxGenerationAttempts` bị loại khỏi danh ' +
        `sách. Chỉ đọc, không tốn chi phí LLM. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(ReadingQuestionBucketPreviewSchema),
      400: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .post('/reading-questions/generate', async ({ body }) => ok(await adminController.generateReadingQuestions(body)), {
    body: t.Object({
      passageId: t.Integer({ description: 'Bài đọc nguồn. Phải đang tồn tại và có topicName.' }),
      model: t.Optional(
        t.String({ description: 'OpenRouter model id. Bỏ trống → random trong pool `readingEnabled`.' })
      )
    }),
    detail: {
      tags: ['Admin / Reading Questions'],
      summary: 'Generate questions from a passage (preview only)',
      description:
        'Sinh thử trọn bộ `reading_question.questionsPerPassage` câu để kiểm tra prompt/model. **KHÔNG lưu** — ' +
        'dùng POST /admin/reading-questions/refill nếu muốn sinh và lưu. Quy tắc bám theo ' +
        'question-generator-guideline.md: quizType bị giới hạn theo CEFR level của bài, 4 đáp án, đúng 1 đáp án ' +
        'đúng, explanation tiếng Việt. **All-or-nothing** — thiếu dù 1 câu hợp lệ là trả 400 chứ không trả bộ ' +
        `thiếu, vì tính độc lập/đa dạng là thuộc tính của cả bộ. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(GeneratedReadingQuestionsSchema),
      400: ApiErrorSchema,
      404: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .post('/reading-questions/refill', async ({ body }) => ok(await adminController.triggerReadingQuestionRefill(body)), {
    body: t.Object({
      models: t.Optional(
        t.Array(t.String(), {
          description:
            'Danh sách OpenRouter model id. Mỗi bài chọn ngẫu nhiên 1 model. Bỏ trống → random trong mọi model ' +
            'đang bật `readingEnabled`. Model không tồn tại hoặc đang tắt trả 400.'
        })
      ),
      scope: t.Optional(
        t.Union([t.Literal('all'), t.Literal('deficient')], {
          description: 'Mặc định `deficient` — chỉ bài còn thiếu câu. `all` bỏ qua điều kiện thiếu.'
        })
      ),
      filter: t.Optional(
        t.Object(
          {
            cefrLevels: t.Optional(t.Array(EngLevelSchema)),
            topicIds: t.Optional(t.Array(t.Integer())),
            passageIds: t.Optional(t.Array(t.Integer()))
          },
          { description: 'Thu hẹp danh sách bài. Chiều nào bỏ trống thì không lọc theo chiều đó.' }
        )
      ),
      bucketKeys: t.Optional(
        t.Array(t.String(), {
          description: 'Chốt đúng danh sách bucketKey `rq:{passageId}` (lấy từ GET /reading-questions/buckets).'
        })
      )
    }),
    detail: {
      tags: ['Admin / Reading Questions'],
      summary: 'Trigger reading question generation',
      description:
        'Sinh câu hỏi cho các bài đọc còn thiếu. Chạy in-process (không qua BullMQ), bounded concurrency theo ' +
        '`reading_question.manualFillConcurrency`. Bỏ qua `job_flags.readingQuestionRefillMaxPerRun` — đây là ' +
        'hành động admin chủ động. Số câu mỗi bài luôn là `reading_question.questionsPerPassage`, không chọn được ' +
        'từng lần. Trả ngay `{ runId, totalBuckets }`, theo dõi qua GET /english/cron/runs/:runId. ' +
        `${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(t.Object({ runId: t.Nullable(t.String()), totalBuckets: t.Number() })),
      400: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .get('/reading-questions/:id', async ({ params }) => ok(await adminController.getReadingQuestion(params.id)), {
    params: IdParam,
    detail: {
      tags: ['Admin / Reading Questions'],
      summary: 'Get reading question by id',
      description: `Chi tiết 1 câu hỏi đọc hiểu. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(ReadingQuestionRecordSchema),
      404: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  })
  .patch(
    '/reading-questions/:id',
    async ({ params, body }) => ok(await adminController.updateReadingQuestion(params.id, body)),
    {
      params: IdParam,
      body: t.Object({
        question: t.Optional(t.String({ minLength: 1 })),
        options: t.Optional(t.Array(t.String(), { description: 'Replace toàn bộ. Phải đúng 4 đáp án không rỗng.' })),
        correctAnswer: t.Optional(t.Integer({ minimum: 0, description: 'Index 0-based, validate theo options mới.' })),
        explanation: t.Optional(t.String({ minLength: 1 })),
        isActive: t.Optional(t.Boolean({ description: 'false = tắt câu, bài sẽ bị coi là thiếu và được sinh lại.' }))
      }),
      detail: {
        tags: ['Admin / Reading Questions'],
        summary: 'Update reading question',
        description:
          'Partial update. Sửa `options` thì `correctAnswer` được validate lại theo bộ options MỚI, không phải ' +
          `bộ cũ. ${ADMIN_AUTH_DESCRIPTION}`,
        security: [{ bearerAuth: [] }]
      },
      response: {
        200: ApiOk(ReadingQuestionRecordSchema),
        400: ApiErrorSchema,
        404: ApiErrorSchema,
        ...COMMON_ERRORS
      }
    }
  )
  .delete('/reading-questions/:id', async ({ params }) => ok(await adminController.deleteReadingQuestion(params.id)), {
    params: IdParam,
    detail: {
      tags: ['Admin / Reading Questions'],
      summary: 'Delete reading question',
      description:
        'Xoá hẳn. Muốn giữ để tra cứu thì PATCH { isActive: false }. Lưu ý: xoá/tắt câu làm bài đọc trở thành ' +
        `"thiếu câu" và sẽ được cron sinh bù. ${ADMIN_AUTH_DESCRIPTION}`,
      security: [{ bearerAuth: [] }]
    },
    response: {
      200: ApiOk(t.Object({ id: t.Number(), deleted: t.Boolean() })),
      404: ApiErrorSchema,
      ...COMMON_ERRORS
    }
  });
