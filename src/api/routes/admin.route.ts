import { Elysia, t } from 'elysia';
import { ok, created, list } from '@/api/common/response';
import { IdParam } from '@/api/common/schemas';
import { adminAuthPlugin } from '@/api/plugins/adminAuth.plugin';
import adminController from '@/api/controllers/admin.controller';

// Toàn bộ /admin/* yêu cầu ADMIN_API_KEY (adminAuthPlugin). Dùng để tạo tenant,
// cấp/thu hồi API key, và gán allow-list topic/quizType. Handler chỉ wire schema +
// gọi controller.
export const adminRoute = new Elysia({ prefix: '/admin' })
  .use(adminAuthPlugin)

  // ── Tenants ─────────────────────────────────────────────────────────────────
  .get('/tenants', async () => list(await adminController.listTenants()))
  .get('/tenants/:id', async ({ params }) => ok(await adminController.getTenant(params.id)), { params: IdParam })
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
      })
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
    })
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
      body: t.Object({ label: t.Optional(t.Nullable(t.String())) })
    }
  )
  .get('/tenants/:id/keys', async ({ params }) => list(await adminController.listKeys(params.id)), { params: IdParam })
  .delete('/tenants/:id/keys/:apiKeyId', async ({ params }) => ok(await adminController.revokeKey(params.apiKeyId)), {
    params: t.Object({ id: t.Numeric(), apiKeyId: t.Numeric() })
  })

  // ── Grants (allow-list) ──────────────────────────────────────────────────────
  .put(
    '/tenants/:id/topics',
    async ({ params, body }) => ok(await adminController.setTopicAccess(params.id, body.topicIds)),
    {
      params: IdParam,
      body: t.Object({ topicIds: t.Array(t.Number()) })
    }
  )
  .put(
    '/tenants/:id/quiz-types',
    async ({ params, body }) => ok(await adminController.setQuizTypeAccess(params.id, body.quizTypes)),
    {
      params: IdParam,
      body: t.Object({ quizTypes: t.Array(t.String()) })
    }
  );
