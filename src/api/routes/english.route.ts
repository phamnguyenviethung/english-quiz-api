import { Elysia, t } from 'elysia';
import { ok, created } from '@/api/common/response';
import { EngLevelSchema, QuizTypeSchema, OptionCountSchema, PoolOptionCountSchema } from '@/api/common/schemas';
import { SCOPES } from '@/api/common/scopes';
import { tenantAuthPlugin } from '@/api/plugins/tenantAuth.plugin';
import englishController from '@/api/controllers/english.controller';

// Mọi route /english/* yêu cầu xác thực tenant qua Bearer API key (tenantAuthPlugin).
// Scope khai báo bằng `{ auth: { scope } }`. Handler chỉ wire schema + gọi controller.
export const englishRoute = new Elysia({ prefix: '/english' })
  .use(tenantAuthPlugin)

  // ── Meta ──────────────────────────────────────────────────────────────────
  .get('/quiz-types', () => ok(englishController.listQuizTypes()), { auth: { scope: SCOPES.QUIZ_READ } })

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
      })
    }
  )

  // ── Reading (loại đặc biệt, không nằm trong quiz pool distribution) ──────────
  .post('/generate-reading', async ({ body }) => ok(await englishController.generateReading(body)), {
    auth: { scope: SCOPES.QUIZ_READ },
    body: t.Object({
      engLevel: EngLevelSchema,
      optionCount: OptionCountSchema,
      model: t.Optional(t.String())
    })
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
      })
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
      })
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
    })
  })
  .get('/pool/pick-quiz-type', () => ok(englishController.pickPoolQuizType()), { auth: { scope: SCOPES.QUIZ_READ } })

  // ── Config (config:write nên chỉ cấp cho tenant admin/trusted) ───────────────
  .get('/config', () => ok(englishController.getConfigSnapshot()), { auth: { scope: SCOPES.CONFIG_READ } })
  .get('/config/records', async () => ok(await englishController.getConfigRecords()), {
    auth: { scope: SCOPES.CONFIG_READ }
  })
  .patch(
    '/config/:recordKey',
    async ({ params, body }) => ok(await englishController.updateConfig(params.recordKey, body.value)),
    {
      auth: { scope: SCOPES.CONFIG_WRITE },
      params: t.Object({ recordKey: t.String() }),
      body: t.Object({ value: t.Unknown() })
    }
  )
  .post('/config/:recordKey:reset', async ({ params }) => ok(await englishController.resetConfig(params.recordKey)), {
    auth: { scope: SCOPES.CONFIG_WRITE },
    params: t.Object({ recordKey: t.String() })
  })

  // ── Topics ──────────────────────────────────────────────────────────────────
  .get('/topics', async () => ok(await englishController.listTopics()), { auth: { scope: SCOPES.QUIZ_READ } })
  .get(
    '/topics/random-pairs',
    async ({ query }) => ok(await englishController.randomTopicPairs(query.pairCount ?? 1)),
    {
      auth: { scope: SCOPES.QUIZ_READ },
      query: t.Object({ pairCount: t.Optional(t.Numeric({ minimum: 1 })) })
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
      body: t.Object({ name: t.String(), description: t.Optional(t.String()) })
    }
  )

  // ── Cron tracking (admin/observability) ─────────────────────────────────────
  .get('/cron/runs', async ({ query }) => ok(await englishController.listCronRuns(query.limit ?? 8)), {
    auth: { scope: SCOPES.CRON_READ },
    query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1 })) })
  })
  .get('/cron/runs/:runId', async ({ params }) => ok(await englishController.getCronRun(params.runId)), {
    auth: { scope: SCOPES.CRON_READ },
    params: t.Object({ runId: t.String() })
  });
