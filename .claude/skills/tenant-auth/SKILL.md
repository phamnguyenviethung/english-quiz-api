---
name: tenant-auth
description: Multi-tenant API-key auth in english-quiz-api — tenants, eqk_ API keys, topic / quiz-type allow-lists, tenantAuthPlugin macro on /english/*, admin session acting as super key. Use when touching tenant.service.ts, apiKey.service.ts, tenantAuth.plugin.ts, /admin/tenants* or permission checks on /english/* routes.
---

# Tenant auth

Full spec: `docs/tenant-auth.md`.

## Rules
- Each client (bot/server) is a tenant, authenticating with `Authorization: Bearer eqk_<48 hex>`. Keys are stored plaintext in a unique column; `lastUsedAt` updates are throttled.
- Tenants may only **read** quiz data. Data is global (no `tenantId` on `english_*` tables); tenants are only **restricted** by allow-lists: topics (or `allowAllTopics`) and quiz types (or `allowAllQuizTypes`).
- An admin Better Auth session on `/english/*` becomes `ADMIN_TENANT` (super key).
- Route guard: `.use(tenantAuthPlugin)` then per route `auth: true` (any valid key) or `auth: { admin: true }` (admin session only — tenant keys must never escalate).
- Resource checks in controllers: `assertTopicAllowed(tenant, topicId)`, `assertQuizTypeAllowed(tenant, quizType)` → 403 `FORBIDDEN`.

## File map
| Concern | Path |
|---|---|
| Plugin + asserts | `src/api/plugins/tenantAuth.plugin.ts` (`tenantAuthPlugin`, `ADMIN_TENANT`, `extractBearer`, `assertTopicAllowed`, `assertQuizTypeAllowed`) |
| Tenant CRUD + grants | `src/core/services/tenant/tenant.service.ts` (`TenantContext`) |
| API keys | `src/core/services/tenant/apiKey.service.ts` (`API_KEY_PREFIX`, `PublicApiKey`) |
| Tables | `tenant`, `tenantApiKey`, `tenantTopicAccess`, `tenantQuizTypeAccess` |
| Seed | `src/core/db/seeds/tenant.seed.ts` (`bun run db:seed:tenant`) |
| Routes | `/admin/tenants` (GET/POST), `/admin/tenants/:id` (GET/PATCH), `/admin/tenants/:id/keys` (GET/POST), `/admin/tenants/:id/keys/:apiKeyId` (DELETE), `/admin/tenants/:id/{topics,quiz-types}` (GET/PUT) |

## Recipe: new tenant-scoped resource type
Add an access table + `allowAll*` flag, extend `TenantContext` loading, add `assert<X>Allowed`, call it in every controller touching that resource, grant endpoints under `/admin/tenants/:id/*`, docs §5–§7, dashboard `tenants` grants panel.

## Tests
Integration `tenant-apikey`; unit `tenant-permission`; e2e `j1-tenant-serving`, `j2-tenant-permission`. Helper `createTestTenant({ topicIds, quizTypes })`.
