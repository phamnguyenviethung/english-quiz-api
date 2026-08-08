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
        scheduleProvider: t.Optional(t.Nullable(ProviderPreferencesSchema)),
        manualProvider: t.Optional(t.Nullable(ProviderPreferencesSchema))
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
      scheduleProvider: t.Optional(t.Nullable(ProviderPreferencesSchema)),
      manualProvider: t.Optional(t.Nullable(ProviderPreferencesSchema))
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
  });
