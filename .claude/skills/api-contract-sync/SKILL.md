---
name: api-contract-sync
description: Keep the english-quiz-api HTTP contract in sync with english-quiz-dashboard (OpenAPI → Orval generated client). Use whenever a route path, query/body schema, response schema, error code or OpenAPI tag changes in english-quiz-api, to know what must be regenerated and which dashboard features are affected.
---

# API contract sync (api → dashboard)

The dashboard (`english-quiz-dashboard`) never hand-writes API calls. It generates React Query hooks with **Orval** from this API's OpenAPI JSON (`http://localhost:3399/openapi/json`) into `src/apis/**`. So the OpenAPI output of this repo **is** the contract.

## What drives the generated client
- Route path + method → hook name (`useGetAdminReadings`, `usePostAdminPoolRefill`, ...).
- `detail.tags` → folder in dashboard `src/apis/<tag-kebab>/`. Renaming a tag moves files and breaks imports.
- TypeBox `params` / `query` / `body` → request types.
- `response` map (`ApiOk(X)`, `ApiList(X)` from `src/api/common/responseSchemas.ts`) → response types in `src/apis/model/*`. Missing response schema = `unknown` on the client.
- Error envelope `{ success:false, error:{ code, message } }` and codes in `src/api/common/errorCodes.ts` → dashboard `src/lib/api-error.ts` (`API_ERROR_CODE`, `isApiErrorCode`).

## Checklist when changing the contract
1. Change route + schemas here; keep `response` schemas complete for every status.
2. Prefer additive changes (new optional fields/params). For breaking changes, update the dashboard in the same effort.
3. Run the API locally (`bun run dev`), then in the dashboard run `bun run api:gen`, then `bun run typecheck`.
4. Fix affected dashboard features (see map below), query invalidation keys, and `src/lib/api-error.ts` if a new error code is exposed.

## Endpoint group → dashboard feature
| API group | Dashboard feature (`src/features/*`) |
|---|---|
| `/admin/models*`, `/english/pool/models` | `ai-models` |
| `/admin/tenants*` | `tenants` |
| `/admin/pool/buckets`, `/admin/pool/refill`, `/english/pool/*` | `question-pool`, `refill`, `beginner` |
| `/admin/pool/siblings/*` | `question-pool` (sibling dialog + sibling refill page) |
| `/admin/pool/reviews*` | `pool-review` |
| `/admin/readings*` | `readings` |
| `/admin/reading-questions*` | `reading-questions` |
| `/english/config*` | `config`, `beginner` |
| `/english/cron/*` | `cron-runs`, `dashboard` |
| `/english/generate/*`, `/english/generate-reading` | `generation` |
| `/english/topics*` | `topics`, `beginner` |
| `/english/quiz-types`, `/english/pool/pick-quiz-type`, `/health` | `metadata` |
| `/api/auth/*` (Better Auth) | `auth` (via `authClient`, not Orval) |
